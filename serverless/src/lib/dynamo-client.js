// ─────────────────────────────────────────────────────────────────────────────
// dynamo-client.js — Shared DynamoDB DocumentClient
//
// KEY INTERVIEW TALKING POINT — Lambda Execution Context Reuse:
//   AWS reuses the Lambda execution environment for subsequent invocations of
//   the same function (while it stays "warm"). Any initialisation at module
//   scope — like creating this DynamoDB client — happens ONCE and is reused
//   across invocations. This is why we initialise the client here rather than
//   inside the handler function.
//
//   DocumentClient (from @aws-sdk/lib-dynamodb) automatically marshals JS
//   objects to DynamoDB's AttributeValue format, so we write { name: 'John' }
//   instead of { name: { S: 'John' } }.
// ─────────────────────────────────────────────────────────────────────────────

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

// Allow overriding endpoint for local DynamoDB (docker) during development
const clientConfig = {
  region: process.env.AWS_REGION || 'ap-south-1',
};

if (process.env.DYNAMODB_ENDPOINT) {
  // When running `sam local start-api` with DynamoDB Local docker container:
  //   docker run -p 8000:8000 amazon/dynamodb-local
  //   export DYNAMODB_ENDPOINT=http://localhost:8000
  clientConfig.endpoint = process.env.DYNAMODB_ENDPOINT;
  clientConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'local',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'local',
  };
}

const rawClient = new DynamoDBClient(clientConfig);

// DocumentClient wraps the raw client to handle JS↔DynamoDB type marshalling
const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: {
    // Omit undefined attributes when writing items (mirrors Mongoose behaviour)
    removeUndefinedValues: true,
    convertEmptyValues: false,
  },
});

const TABLE_NAME = process.env.TABLE_NAME || 'JobsterTable';

module.exports = { docClient, TABLE_NAME };
