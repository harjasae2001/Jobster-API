// ─────────────────────────────────────────────────────────────────────────────
// response.js — API Gateway proxy response builder
//
// API Gateway Lambda Proxy Integration requires a specific response shape:
//   { statusCode, headers, body }
// where body MUST be a JSON string (not an object).
//
// This module centralises that so every handler stays clean.
// ─────────────────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',               // tighten to your CloudFront domain in prod
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
};

/**
 * Build a successful API Gateway response.
 * @param {number} statusCode  HTTP status code
 * @param {object} data        Response body (will be JSON-stringified)
 */
const success = (statusCode, data = {}) => ({
  statusCode,
  headers: CORS_HEADERS,
  body: JSON.stringify(data),
});

/**
 * Build an error API Gateway response from a caught error.
 * Handles both custom API errors (with .statusCode) and unexpected errors.
 * @param {Error} err  The caught error instance
 */
const error = (err) => {
  // Known operational errors (BadRequestError, NotFoundError, etc.)
  if (err.statusCode) {
    return {
      statusCode: err.statusCode,
      headers: CORS_HEADERS,
      body: JSON.stringify({ msg: err.message }),
    };
  }

  // DynamoDB ConditionalCheckFailedException — used for duplicate-email guard
  if (err.name === 'ConditionalCheckFailedException') {
    return {
      statusCode: 409,
      headers: CORS_HEADERS,
      body: JSON.stringify({ msg: 'Email already registered' }),
    };
  }

  // Unexpected errors — log and return 500
  console.error('Unhandled error:', err);
  return {
    statusCode: 500,
    headers: CORS_HEADERS,
    body: JSON.stringify({ msg: 'Something went wrong, try again later' }),
  };
};

module.exports = { success, error };
