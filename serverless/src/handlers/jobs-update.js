const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { StatusCodes } = require('http-status-codes');
const { docClient, TABLE_NAME } = require('../lib/dynamo-client');
const { verifyToken } = require('../lib/auth-middleware');
const { success, error } = require('../lib/response');
const { BadRequestError, NotFoundError } = require('../lib/errors');

const VALID_STATUSES = ['interview', 'declined', 'pending'];
const VALID_JOB_TYPES = ['full-time', 'part-time', 'remote', 'internship'];

exports.handler = async (event) => {
  try {
    const { userId } = verifyToken(event);
    const jobId = event.pathParameters?.id;
    const body = JSON.parse(event.body || '{}');
    const { company, position, status, jobType, jobLocation } = body;

    // Mirrors Express: company === '' || position === ''
    if (company === '' || position === '') {
      throw new BadRequestError('Company or Position fields cannot be empty');
    }
    if (status && !VALID_STATUSES.includes(status)) {
      throw new BadRequestError(`Status must be one of: ${VALID_STATUSES.join(', ')}`);
    }
    if (jobType && !VALID_JOB_TYPES.includes(jobType)) {
      throw new BadRequestError(`Job type must be one of: ${VALID_JOB_TYPES.join(', ')}`);
    }

    const now = new Date().toISOString();

    // Build UpdateExpression dynamically from provided fields
    const updates = { updatedAt: now };
    if (company !== undefined) updates.company = company;
    if (position !== undefined) {
      updates.position = position;
      updates.positionLower = position.toLowerCase(); // keep search field in sync
    }
    if (status !== undefined) updates.status = status;
    if (jobType !== undefined) updates.jobType = jobType;
    if (jobLocation !== undefined) updates.jobLocation = jobLocation;

    // Build SET expression — 'position' and 'status' are reserved in DynamoDB
    const reservedWords = { position: '#pos', status: '#stat' };
    const exprAttrNames = {};
    const exprAttrValues = {};
    const setParts = [];

    Object.entries(updates).forEach(([key, value]) => {
      const alias = reservedWords[key] || key;
      if (reservedWords[key]) exprAttrNames[reservedWords[key]] = key;
      setParts.push(`${alias} = :${key}`);
      exprAttrValues[`:${key}`] = value;
    });

    const { Attributes: updatedJob } = await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${userId}`, SK: `JOB#${jobId}` },
      UpdateExpression: `SET ${setParts.join(', ')}`,
      ExpressionAttributeValues: exprAttrValues,
      ...(Object.keys(exprAttrNames).length && { ExpressionAttributeNames: exprAttrNames }),
      // Fails with ConditionalCheckFailedException if item doesn't exist
      ConditionExpression: 'attribute_exists(PK)',
      ReturnValues: 'ALL_NEW',
    }));

    const { PK, SK, positionLower, entityType, ...job } = updatedJob;
    return success(StatusCodes.OK, { job });
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return error({ statusCode: 404, message: `No job with id ${event.pathParameters?.id}` });
    }
    return error(err);
  }
};