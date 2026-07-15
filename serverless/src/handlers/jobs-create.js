// ─────────────────────────────────────────────────────────────────────────────
// jobs-create.js — POST /api/v1/jobs
//
// Port of controllers/jobs.js → createJob() from the Express app.
//
// MongoDB differences replaced:
//   - req.body.createdBy = req.user.userId → derived from JWT (not from body)
//   - Job.create(req.body)                 → DynamoDB PutItem
//   - Mongoose schema defaults/enums       → manual validation + JS defaults
//   - Auto-generated _id                   → uuid v4
// ─────────────────────────────────────────────────────────────────────────────

const { v4: uuidv4 } = require('uuid');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { StatusCodes } = require('http-status-codes');

const { docClient, TABLE_NAME } = require('../lib/dynamo-client');
const { verifyToken } = require('../lib/auth-middleware');
const { success, error } = require('../lib/response');
const { BadRequestError } = require('../lib/errors');

// Mirrors Job.js schema enums
const VALID_STATUSES = ['interview', 'declined', 'pending'];
const VALID_JOB_TYPES = ['full-time', 'part-time', 'remote', 'internship'];

exports.handler = async (event) => {
  try {
    // ── 1. Authenticate ────────────────────────────────────────────────────────
    const { userId } = verifyToken(event);

    // ── 2. Parse & validate request body ──────────────────────────────────────
    const body = JSON.parse(event.body || '{}');
    const {
      company,
      position,
      status = 'pending',
      jobType = 'full-time',
      jobLocation = 'my city',
    } = body;

    // Required field validation (mirrors Mongoose required: true)
    if (!company || company.trim() === '') {
      throw new BadRequestError('Please provide company name');
    }
    if (!position || position.trim() === '') {
      throw new BadRequestError('Please provide position');
    }
    if (company.length > 50) {
      throw new BadRequestError('Company name cannot exceed 50 characters');
    }
    if (position.length > 100) {
      throw new BadRequestError('Position cannot exceed 100 characters');
    }

    // Enum validation (mirrors Mongoose enum constraint)
    if (!VALID_STATUSES.includes(status)) {
      throw new BadRequestError(`Status must be one of: ${VALID_STATUSES.join(', ')}`);
    }
    if (!VALID_JOB_TYPES.includes(jobType)) {
      throw new BadRequestError(`Job type must be one of: ${VALID_JOB_TYPES.join(', ')}`);
    }

    // ── 3. Build the job item ──────────────────────────────────────────────────
    const jobId = uuidv4();
    const now = new Date().toISOString();

    const jobItem = {
      // DynamoDB composite keys
      PK: `USER#${userId}`,              // Partition key — groups all jobs for a user
      SK: `JOB#${jobId}`,               // Sort key — uniquely identifies the job
      // Job data (mirrors Job.js schema)
      jobId,
      company: company.trim(),
      position: position.trim(),
      positionLower: position.trim().toLowerCase(), // for case-insensitive search
      status,
      jobType,
      jobLocation: jobLocation.trim(),
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
      entityType: 'JOB',
    };

    // ── 4. Write to DynamoDB ───────────────────────────────────────────────────
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: jobItem,
      })
    );

    // ── 5. Return the created job (strip DDB key fields from response) ─────────
    const { PK, SK, positionLower, entityType, ...job } = jobItem;

    return success(StatusCodes.CREATED, { job });
  } catch (err) {
    return error(err);
  }
};
