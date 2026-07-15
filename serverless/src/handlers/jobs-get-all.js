// ─────────────────────────────────────────────────────────────────────────────
// jobs-get-all.js — GET /api/v1/jobs
//
// Port of controllers/jobs.js → getAllJobs() from the Express app.
//
// Supports query params: search, status, jobType, sort, page, limit
//
// MongoDB → DynamoDB differences:
//   - Job.find(queryObject)          → DynamoDB Query by userId PK + FilterExpression
//   - { $regex: search, $options:'i' } → contains() inside FilterExpression (case-folded)
//   - result.sort('-createdAt')       → in-memory sort (DDB only sorts by SK)
//   - result.skip(skip).limit(limit)  → in-memory slice after filtering
//   - Job.countDocuments(queryObject) → derived from filtered results length
//
// INTERVIEW NOTE — DynamoDB sort limitation:
//   DynamoDB's Query operation returns items sorted by SK, not by arbitrary
//   attributes. Since our SK is JOB#<uuid>, there is no meaningful sort order
//   from SK. For sort-by-date we include a 'createdAt' attribute and sort
//   in-memory after fetching. For per-user job sets (typically < 500 items)
//   this is perfectly acceptable. For massive datasets the right solution would
//   be a separate GSI with a date-based SK (e.g., GSI2PK=USER#<id>, GSI2SK=<ISO date>).
// ─────────────────────────────────────────────────────────────────────────────

const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { StatusCodes } = require('http-status-codes');

const { docClient, TABLE_NAME } = require('../lib/dynamo-client');
const { verifyToken } = require('../lib/auth-middleware');
const { success, error } = require('../lib/response');

exports.handler = async (event) => {
  try {
    // ── 1. Authenticate ────────────────────────────────────────────────────────
    const { userId } = verifyToken(event);

    // ── 2. Extract query params ────────────────────────────────────────────────
    const qp = event.queryStringParameters || {};
    const { search, status, jobType, sort = 'latest' } = qp;
    const page = Math.max(1, parseInt(qp.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(qp.limit, 10) || 10));

    // ── 3. Build DynamoDB Query ────────────────────────────────────────────────
    // Primary access pattern: get all jobs for a user using PK=USER#<userId>
    // SK begins_with 'JOB#' to exclude the PROFILE item from results
    const queryParams = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':skPrefix': 'JOB#',
      },
    };

    // ── 4. Build FilterExpression for optional filters ─────────────────────────
    const filterParts = [];
    const exprAttrNames = {};

    // Filter by status (exact match)
    if (status && status !== 'all') {
      filterParts.push('#status = :status');
      exprAttrNames['#status'] = 'status'; // 'status' is a DDB reserved word
      queryParams.ExpressionAttributeValues[':status'] = status;
    }

    // Filter by jobType (exact match)
    if (jobType && jobType !== 'all') {
      filterParts.push('jobType = :jobType');
      queryParams.ExpressionAttributeValues[':jobType'] = jobType;
    }

    // Filter by position (case-insensitive contains)
    // DynamoDB contains() IS case-sensitive, so we store positionLower and compare
    // against lowercased search term.
    if (search) {
      filterParts.push('contains(positionLower, :search)');
      queryParams.ExpressionAttributeValues[':search'] = search.toLowerCase();
    }

    if (filterParts.length > 0) {
      queryParams.FilterExpression = filterParts.join(' AND ');
    }
    if (Object.keys(exprAttrNames).length > 0) {
      queryParams.ExpressionAttributeNames = exprAttrNames;
    }

    // ── 5. Fetch all matching items (paginate through DDB LastEvaluatedKey) ─────
    // We need the total count for numOfPages, so we fetch all filtered results,
    // then apply our own page/limit slice. This is fine for per-user datasets.
    let allJobs = [];
    let lastEvaluatedKey;

    do {
      if (lastEvaluatedKey) {
        queryParams.ExclusiveStartKey = lastEvaluatedKey;
      }
      const response = await docClient.send(new QueryCommand(queryParams));
      allJobs = allJobs.concat(response.Items || []);
      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    // ── 6. Sort in-memory ──────────────────────────────────────────────────────
    // Mirrors the Express sort options from getAllJobs
    switch (sort) {
      case 'latest':
        allJobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        break;
      case 'oldest':
        allJobs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        break;
      case 'a-z':
        allJobs.sort((a, b) => a.position.localeCompare(b.position));
        break;
      case 'z-a':
        allJobs.sort((a, b) => b.position.localeCompare(a.position));
        break;
      default:
        allJobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    // ── 7. Apply page/limit slice ──────────────────────────────────────────────
    const totalJobs = allJobs.length;
    const numOfPages = Math.ceil(totalJobs / limit);
    const skip = (page - 1) * limit;
    const jobs = allJobs.slice(skip, skip + limit).map(cleanJob);

    return success(StatusCodes.OK, { jobs, totalJobs, numOfPages });
  } catch (err) {
    return error(err);
  }
};

// Strip internal DynamoDB key fields from the response shape
const cleanJob = ({ PK, SK, GSI1PK, GSI1SK, positionLower, entityType, ...job }) => job;
