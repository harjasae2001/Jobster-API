'use strict';

const axios = require('axios');

// ── API Client for Integration Tests ──────────────────────────────────────────
//
// Points to the live API Gateway endpoint. Set API_URL to run against different
// environments without changing test code:
//
//   Local:  export API_URL=https://6hqcka29e6.execute-api.ap-south-1.amazonaws.com/production/api/v1
//   CI:     Injected automatically from stack outputs in deploy.yml
//
// validateStatus: () => true — axios does NOT throw on 4xx/5xx.
// We check res.status in each test assertion instead (cleaner error messages).

const BASE_URL =
  process.env.API_URL ||
  'https://6hqcka29e6.execute-api.ap-south-1.amazonaws.com/production/api/v1';

if (!process.env.API_URL) {
  console.warn(
    '\n⚠️  [api-client] API_URL env var not set — using hardcoded production URL.\n' +
    '   Set API_URL to test against a different environment.\n'
  );
}

/**
 * Unauthenticated client — use for register/login and auth error tests.
 */
const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 20000,          // 20s — covers Lambda cold starts (typically < 800ms warm)
  validateStatus: () => true, // Never throw on HTTP errors — let tests assert status
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Authenticated client factory — creates an axios instance pre-loaded with a JWT.
 * Call this in beforeAll() after logging in, then use the returned client for
 * all protected endpoint calls in that test file.
 *
 * @param {string} token - JWT returned by /auth/register or /auth/login
 * @returns {AxiosInstance}
 */
const authClient = (token) =>
  axios.create({
    baseURL: BASE_URL,
    timeout: 20000,
    validateStatus: () => true,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

module.exports = { apiClient, authClient, BASE_URL };
