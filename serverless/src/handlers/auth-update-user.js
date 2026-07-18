const { GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { StatusCodes } = require('http-status-codes');
const jwt = require('jsonwebtoken');
const { docClient, TABLE_NAME } = require('../lib/dynamo-client');
const { verifyToken } = require('../lib/auth-middleware');
const { success, error } = require('../lib/response');
const { BadRequestError } = require('../lib/errors');

exports.handler = async (event) => {
  try {
    const { userId } = verifyToken(event);
    const body = JSON.parse(event.body || '{}');
    const { email, name, lastName, location } = body;

    if (!email || !name || !lastName || !location) {
      throw new BadRequestError('Please provide all values');
    }

    // Fetch the current user to get their existing email (needed to update the old PK)
    const { Item: currentUser } = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USERID#${userId}`, SK: 'PROFILE' },
    }));

    if (!currentUser) {
      throw new BadRequestError('User not found');
    }

    const now = new Date().toISOString();
    const newEmailLower = email.toLowerCase();
    const emailChanged = currentUser.email !== newEmailLower;

    // Build the transactional update — both user items must be consistent
    const transactItems = [
      // Update the userId-keyed item (always exists)
      {
        Update: {
          TableName: TABLE_NAME,
          Key: { PK: `USERID#${userId}`, SK: 'PROFILE' },
          UpdateExpression: 'SET #name = :name, lastName = :lastName, #loc = :loc, email = :email, updatedAt = :updatedAt',
          ExpressionAttributeNames: { '#name': 'name', '#loc': 'location' },
          ExpressionAttributeValues: {
            ':name': name, ':lastName': lastName,
            ':loc': location, ':email': newEmailLower, ':updatedAt': now,
          },
        },
      },
    ];

    if (emailChanged) {
      // Delete old email-keyed item and create new one
      transactItems.push({
        Delete: {
          TableName: TABLE_NAME,
          Key: { PK: `USER#${currentUser.email}`, SK: 'PROFILE' },
        },
      });
      transactItems.push({
        Put: {
          TableName: TABLE_NAME,
          Item: {
            PK: `USER#${newEmailLower}`, SK: 'PROFILE',
            GSI1PK: `USER#${newEmailLower}`, GSI1SK: 'PROFILE',
            userId, name, lastName, location,
            email: newEmailLower,
            password: currentUser.password,
            createdAt: currentUser.createdAt, updatedAt: now,
            entityType: 'USER',
          },
          ConditionExpression: 'attribute_not_exists(PK)', // prevent duplicate email
        },
      });
    } else {
      // Same email — just update the email-keyed item in place
      transactItems.push({
        Update: {
          TableName: TABLE_NAME,
          Key: { PK: `USER#${newEmailLower}`, SK: 'PROFILE' },
          UpdateExpression: 'SET #name = :name, lastName = :lastName, #loc = :loc, updatedAt = :updatedAt',
          ExpressionAttributeNames: { '#name': 'name', '#loc': 'location' },
          ExpressionAttributeValues: {
            ':name': name, ':lastName': lastName,
            ':loc': location, ':updatedAt': now,
          },
        },
      });
    }

    await docClient.send(new TransactWriteCommand({ TransactItems: transactItems }));

    // Issue a fresh JWT (mirrors Express: user.createJWT() after save)
    const token = jwt.sign(
      { userId, name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_LIFETIME || '1d' }
    );

    return success(StatusCodes.OK, {
      user: { email: newEmailLower, name, lastName, location, token },
    });
  } catch (err) {
    if (err.name === 'TransactionCanceledException') {
      return error({ statusCode: 409, message: 'Email already in use' });
    }
    return error(err);
  }
};