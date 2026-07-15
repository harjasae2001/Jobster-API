// ─────────────────────────────────────────────────────────────────────────────
// auth-middleware.js — JWT verification for Lambda handlers
//
// Port of middleware/authentication.js from the Express app.
// In Express this was a middleware that called next() or threw.
// In Lambda we call this as a utility function that returns the payload
// or throws an UnauthenticatedError — the handler catches it.
// ─────────────────────────────────────────────────────────────────────────────

const jwt = require('jsonwebtoken');
const { UnauthenticatedError } = require('./errors');

/**
 * Extract and verify the JWT from an API Gateway event's Authorization header.
 *
 * @param {object} event  API Gateway proxy event
 * @returns {{ userId: string, name: string }}  Decoded JWT payload
 * @throws  {UnauthenticatedError}  If token is missing or invalid
 */
const verifyToken = (event) => {
  // API Gateway normalises headers to lowercase in HTTP API; REST API preserves case.
  // We handle both by checking both cases.
  const headers = event.headers || {};
  const authHeader =
    headers['Authorization'] || headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthenticatedError('Authentication invalid');
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return { userId: payload.userId, name: payload.name };
  } catch (err) {
    throw new UnauthenticatedError('Authentication invalid');
  }
};

module.exports = { verifyToken };
