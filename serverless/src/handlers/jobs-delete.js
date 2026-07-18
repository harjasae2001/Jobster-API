const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { StatusCodes } = require('http-status-codes');
const { docClient, TABLE_NAME } = require('../lib/dynamo-client');
const { verifyToken } = require('../lib/auth-middleware');
const { success, error } = require('../lib/response');

exports.handler = async (event) => {
  try {
    const { userId } = verifyToken(event);
    console.log(event.pathParameters);
    const jobId = event.pathParameters?.id;

    await docClient.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${userId}`, SK: `JOB#${jobId}` },
      ConditionExpression: 'attribute_exists(PK)',
    }));

    return success(StatusCodes.OK, {});
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return error({ statusCode: 404, message: `No job with id ${event.pathParameters?.id}` });
    }
    return error(err);
  }
};