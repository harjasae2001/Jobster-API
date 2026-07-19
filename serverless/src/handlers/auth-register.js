// ─────────────────────────────────────────────────────────────────────────────
// auth-register.js — POST /api/v1/auth/register
//
// Port of controllers/auth.js → register() from the Express app.
//
// MongoDB differences replaced:
//   - User.create({ ...req.body })    → DynamoDB PutItem with ConditionExpression
//   - Mongoose unique index on email  → ConditionalCheckFailedException from DDB
//   - Mongoose validation             → Manual field validation
//   - mongoose ObjectId (_id)         → uuid v4 string
//
// Observability additions (SDE-2 standard):
//   - Structured JSON logging via logger.js (queryable in CloudWatch Logs Insights)
//   - Custom CloudWatch metric via EMF: UserRegistered count
//   - X-Ray tracing applied automatically via instrumented DDB client (dynamo-client.js)
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { StatusCodes } = require('http-status-codes');

const { docClient, TABLE_NAME } = require('../lib/dynamo-client');
const { success, error } = require('../lib/response');
const { BadRequestError } = require('../lib/errors');
const { logger } = require('../lib/logger');
const { createMetrics } = require('../lib/metrics');

exports.handler = async (event, context) => {
  // ── Observability setup — one-time per invocation ──────────────────────────
  logger.setContext(context); // Sets requestId, tracks cold start
  const metrics = createMetrics();
  const startTime = Date.now();

  logger.info('Register handler invoked', {
    path: event.path,
    httpMethod: event.httpMethod,
  });

  try {
    // ── 1. Parse & validate request body ──────────────────────────────────────
    const body = JSON.parse(event.body || '{}');
    const { name, email, password, lastName = 'lastName', location = 'my city' } = body;

    if (!name || !email || !password) {
      throw new BadRequestError('Please provide name, email and password');
    }
    if (name.length < 3 || name.length > 50) {
      throw new BadRequestError('Name must be between 3 and 50 characters');
    }
    if (password.length < 6) {
      throw new BadRequestError('Password must be at least 6 characters');
    }
    const emailRegex =
      /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    if (!emailRegex.test(email)) {
      throw new BadRequestError('Please provide a valid email');
    }

    // ── 2. Hash password (mirrors User.js pre-save hook) ──────────────────────
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // ── 3. Generate user ID ────────────────────────────────────────────────────
    const userId = uuidv4();
    const now = new Date().toISOString();

    // ── 4. Write to DynamoDB ───────────────────────────────────────────────────
    // Single-table design — two items for one user:
    //   Item 1: PK=USERID#<userId>  SK=PROFILE  → looked up by ID (auth middleware)
    //   Item 2: PK=USER#<email>     SK=PROFILE  → looked up by email (login)
    //
    // INTERVIEW NOTE: DynamoDB doesn't have a built-in unique constraint on
    // non-key attributes. We enforce email uniqueness by using the email as the
    // PK in a dedicated item and using ConditionExpression to fail if it exists.
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${email.toLowerCase()}`,
          SK: 'PROFILE',
          GSI1PK: `USER#${email.toLowerCase()}`,
          GSI1SK: 'PROFILE',
          userId,
          name,
          email: email.toLowerCase(),
          password: hashedPassword,
          lastName,
          location,
          createdAt: now,
          updatedAt: now,
          entityType: 'USER',
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      })
    );

    // Write the userId-keyed lookup item (used by auth middleware for fast O(1) get)
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USERID#${userId}`,
          SK: 'PROFILE',
          userId,
          name,
          email: email.toLowerCase(),
          lastName,
          location,
          createdAt: now,
          updatedAt: now,
          entityType: 'USER',
        },
      })
    );

    // ── 5. Generate JWT (mirrors User.createJWT method from User.js) ───────────
    const token = jwt.sign(
      { userId, name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_LIFETIME || '1d' }
    );

    // ── 6. Emit observability signals ─────────────────────────────────────────
    const duration = Date.now() - startTime;
    logger.info('User registered successfully', { userId, email: email.toLowerCase(), duration });
    metrics
      .record('UserRegistered', 1)
      .record('HandlerDuration', duration, 'Milliseconds')
      .flush();

    return success(StatusCodes.CREATED, {
      user: { email: email.toLowerCase(), lastName, location, name, token },
    });
  } catch (err) {
    const duration = Date.now() - startTime;

    if (err.name === 'ConditionalCheckFailedException') {
      logger.warn('Registration rejected — duplicate email', { duration });
      metrics.record('RegistrationConflict', 1).flush();
      return error({ statusCode: 409, message: 'Email already in use' });
    }

    logger.error('Register handler error', { error: err, duration });
    metrics.record('HandlerError', 1).flush();
    return error(err);
  }
};
