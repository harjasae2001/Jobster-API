'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { captureAWSv3Client } = require('./tracer');

// ── DynamoDB Client (module-scope — reused across warm Lambda invocations) ────
//
// INTERVIEW NOTE — Why module scope matters:
//   Lambda execution environments are reused between invocations ("warm starts").
//   Code at module scope runs ONCE when the container is created, then the handler
//   is called repeatedly. Initializing the DDB client here saves ~50-100ms per
//   warm invocation vs creating it inside the handler function.
//
// INTERVIEW NOTE — Why X-Ray wrapping lives here (not in each handler):
//   All 9 handlers import this shared module. Wrapping the client once at the
//   source means every handler automatically gets DynamoDB X-Ray tracing —
//   zero changes needed per handler file. This is the "instrument at the
//   infrastructure layer" pattern.

const rawClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'ap-south-1',
  ...(process.env.DYNAMODB_ENDPOINT
    ? { endpoint: process.env.DYNAMODB_ENDPOINT }
    : {}),
  // AWS_NODEJS_CONNECTION_REUSE_ENABLED=1 is set as a Lambda env var in template.yaml.
  // It configures the underlying HTTP agent to use keep-alive (persistent TCP connections),
  // saving ~5-20ms per warm invocation by reusing existing connections to DynamoDB.
});

// ── X-Ray Instrumentation ─────────────────────────────────────────────────────
// captureAWSv3Client wraps the client so every DDB call becomes a named subsegment
// in the X-Ray trace. In the X-Ray service map you'll see:
//   API Gateway → Lambda → DynamoDB (with exact ms latency on each arrow)
//
// captureAWSv3Client is a no-op in local dev / test environments (see tracer.js).
const xrayClient = captureAWSv3Client(rawClient);

// ── DocumentClient ────────────────────────────────────────────────────────────
// DynamoDBDocumentClient is a higher-level wrapper that automatically:
//   - Marshals JS objects → DynamoDB AttributeValues (S, N, BOOL, L, M types)
//   - Unmarshals DynamoDB AttributeValues → plain JS objects on read
// Without this, you'd write: { S: 'value' } instead of 'value' everywhere.
const docClient = DynamoDBDocumentClient.from(xrayClient, {
  marshallOptions: {
    removeUndefinedValues: true,  // Silently drop undefined fields (don't write null)
    convertEmptyValues: false,    // Explicit: don't convert '' to null automatically
  },
});

const TABLE_NAME = process.env.TABLE_NAME;

module.exports = { docClient, TABLE_NAME };
