// ─────────────────────────────────────────────────────────────────────────────
// auth-login.js — POST /api/v1/auth/login
//
// Port of controllers/auth.js → login() from the Express app.
//
// MongoDB differences replaced:
//   - User.findOne({ email })  → DynamoDB GetItem on GSI1 (email-keyed PK)
//   - user.comparePassword()   → bcrypt.compare() called directly
// ─────────────────────────────────────────────────────────────────────────────

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { GetCommand } = require('@aws-sdk/lib-dynamodb');
const { StatusCodes } = require('http-status-codes');

const { docClient, TABLE_NAME } = require('../lib/dynamo-client');
const { success, error } = require('../lib/response');
const { BadRequestError, UnauthenticatedError } = require('../lib/errors');

exports.handler = async (event) => {
  try {
    // ── 1. Parse & validate request body ──────────────────────────────────────
    const body = JSON.parse(event.body || '{}');
    const { email, password } = body;

    if (!email || !password) {
      throw new BadRequestError('Please provide email and password');
    }

    // ── 2. Look up user by email ───────────────────────────────────────────────
    // INTERVIEW NOTE: We stored the email-keyed item with PK=USER#<email>.
    // This is a direct GetItem (O(1) key lookup), not a Query or Scan.
    // No GSI needed for this pattern because email IS the PK.
    const { Item: user } = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${email.toLowerCase()}`,
          SK: 'PROFILE',
        },
      })
    );

    if (!user) {
      // Never reveal whether the email exists — same message for both failure modes
      throw new UnauthenticatedError('Invalid Credentials');
    }

    // ── 3. Compare password (mirrors user.comparePassword() from User.js) ──────
    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      throw new UnauthenticatedError('Invalid Credentials');
    }

    // ── 4. Generate JWT ────────────────────────────────────────────────────────
    const token = jwt.sign(
      { userId: user.userId, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_LIFETIME || '1d' }
    );

    return success(StatusCodes.OK, {
      user: {
        email: user.email,
        lastName: user.lastName,
        location: user.location,
        name: user.name,
        token,
      },
    });
  } catch (err) {
    return error(err);
  }
};
