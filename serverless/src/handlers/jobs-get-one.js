// ─────────────────────────────────────────────────────────────────────────────
// jobs-get-one.js — GET /api/v1/jobs/{id}
//
// Port of controllers/jobs.js → getJob() from the Express app.
//
// MongoDB differences replaced:
//   - Job.findOne({ _id: jobId, createdBy: userId }) → DynamoDB GetItem
//     The composite key (PK=USER#userId, SK=JOB#jobId) inherently enforces
//     ownership — you can only get an item if both userId AND jobId match.
//     This replaces the two-field query and ownership check in a single op.
// ─────────────────────────────────────────────────────────────────────────────

const { GetCommand } = require('@aws-sdk/lib-dynamodb');
const { StatusCodes } = require('http-status-codes');

const { docClient, TABLE_NAME } = require('../lib/dynamo-client');
const { verifyToken } = require('../lib/auth-middleware');
const { success, error } = require('../lib/response');
const { NotFoundError } = require('../lib/errors');

exports.handler = async (event) => {
  try {
    // ── 1. Authenticate ────────────────────────────────────────────────────────
    const { userId } = verifyToken(event);

    // ── 2. Extract job ID from path parameters ─────────────────────────────────
    const jobId = event.pathParameters && event.pathParameters.id;
    if (!jobId) {
      throw new NotFoundError('Job ID is required');
    }

    // ── 3. Fetch from DynamoDB ─────────────────────────────────────────────────
    // INTERVIEW NOTE — Ownership enforcement via composite key:
    //   In MongoDB: Job.findOne({ _id: jobId, createdBy: userId })
    //   In DynamoDB: GetItem with PK=USER#<userId>, SK=JOB#<jobId>
    //
    //   If the job belongs to a DIFFERENT user, the PK won't match and DynamoDB
    //   simply returns null — no item found. Authorization is enforced at the
    //   data model layer, not in application code. This is a genuine advantage
    //   of single-table design with user-scoped PK.
    const { Item: job } = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: `JOB#${jobId}`,
        },
      })
    );

    if (!job) {
      throw new NotFoundError(`No job with id ${jobId}`);
    }

    // Strip DDB-internal fields from response
    const { PK, SK, positionLower, entityType, ...cleanedJob } = job;

    return success(StatusCodes.OK, { job: cleanedJob });
  } catch (err) {
    return error(err);
  }
};
