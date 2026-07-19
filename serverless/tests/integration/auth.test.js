'use strict';

// ── Auth Integration Tests ─────────────────────────────────────────────────────
//
// Tests the complete authentication flow against the live API Gateway + Lambda.
//
// ISOLATION STRATEGY:
//   Each test run uses a timestamp-unique email so parallel CI runs (if ever added)
//   and repeated local runs never collide in DynamoDB.
//
// COVERAGE:
//   - Happy path: register → login → access protected route
//   - Error cases: duplicate email, missing fields, wrong password, bad/missing token

const { apiClient, authClient } = require('../helpers/api-client');

// Unique per test run — prevents DynamoDB collision across runs
const RUN_ID = Date.now();
const TEST_EMAIL = `test-auth-${RUN_ID}@jobster.dev`;
const TEST_PASSWORD = 'TestPass123!';

let registeredToken; // Set during register test, reused by subsequent tests

// ── Register ──────────────────────────────────────────────────────────────────
describe('POST /auth/register', () => {
  it('201 — creates user and returns JWT with correct shape', async () => {
    const res = await apiClient.post('/auth/register', {
      name: 'Integration',
      lastName: 'Tester',
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    expect(res.status).toBe(201);
    expect(res.data.user).toBeDefined();
    expect(res.data.user.email).toBe(TEST_EMAIL);
    expect(res.data.user.name).toBe('Integration');
    expect(res.data.user.token).toBeDefined();
    expect(typeof res.data.user.token).toBe('string');
    expect(res.data.user.token.split('.')).toHaveLength(3); // Valid JWT has 3 parts

    // SECURITY: Password must NEVER be returned in any response
    expect(res.data.user.password).toBeUndefined();

    registeredToken = res.data.user.token;
  });

  it('409 — rejects duplicate email registration', async () => {
    const res = await apiClient.post('/auth/register', {
      name: 'Duplicate',
      lastName: 'User',
      email: TEST_EMAIL, // Same email as above
      password: TEST_PASSWORD,
    });
    expect(res.status).toBe(409);
    expect(res.data.msg).toBeDefined(); // Error message present
  });

  it('400 — rejects request with missing required fields', async () => {
    const res = await apiClient.post('/auth/register', {
      name: 'NoEmail',
      // email and password intentionally omitted
    });
    expect(res.status).toBe(400);
  });

  it('400 — rejects invalid email format', async () => {
    const res = await apiClient.post('/auth/register', {
      name: 'Bad',
      lastName: 'Email',
      email: 'not-a-valid-email',
      password: TEST_PASSWORD,
    });
    expect(res.status).toBe(400);
  });

  it('400 — rejects password shorter than 6 characters', async () => {
    const res = await apiClient.post('/auth/register', {
      name: 'Short',
      lastName: 'Pass',
      email: `short-pass-${RUN_ID}@jobster.dev`,
      password: '123',
    });
    expect(res.status).toBe(400);
  });
});

// ── Login ─────────────────────────────────────────────────────────────────────
describe('POST /auth/login', () => {
  it('200 — returns JWT on valid credentials', async () => {
    const res = await apiClient.post('/auth/login', {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.data.user.token).toBeDefined();
    expect(res.data.user.email).toBe(TEST_EMAIL);
    expect(res.data.user.password).toBeUndefined();
  });

  it('401 — rejects wrong password', async () => {
    const res = await apiClient.post('/auth/login', {
      email: TEST_EMAIL,
      password: 'definitely-wrong-password',
    });
    expect(res.status).toBe(401);
  });

  it('401 — rejects non-existent email', async () => {
    const res = await apiClient.post('/auth/login', {
      email: `ghost-${RUN_ID}@jobster.dev`,
      password: TEST_PASSWORD,
    });
    expect(res.status).toBe(401);
  });

  it('400 — rejects request missing email or password', async () => {
    const res = await apiClient.post('/auth/login', { email: TEST_EMAIL });
    expect(res.status).toBe(400);
  });
});

// ── Protected Route Authorization ────────────────────────────────────────────
describe('Protected route authorization (GET /jobs)', () => {
  it('401 — rejects request with no Authorization header', async () => {
    const res = await apiClient.get('/jobs');
    expect(res.status).toBe(401);
  });

  it('401 — rejects malformed Bearer token', async () => {
    const res = await apiClient.get('/jobs', {
      headers: { Authorization: 'Bearer this.is.not.valid' },
    });
    expect(res.status).toBe(401);
  });

  it('401 — rejects Authorization header without Bearer prefix', async () => {
    const res = await apiClient.get('/jobs', {
      headers: { Authorization: registeredToken }, // Missing "Bearer " prefix
    });
    expect(res.status).toBe(401);
  });

  it('200 — accepts valid JWT from register', async () => {
    const client = authClient(registeredToken);
    const res = await client.get('/jobs');
    expect(res.status).toBe(200);
  });
});
