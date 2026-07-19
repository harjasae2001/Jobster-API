'use strict';

// ── Jobs Stats Integration Tests ───────────────────────────────────────────────
//
// Validates the /jobs/stats endpoint which replaces MongoDB's aggregation pipeline
// with in-Lambda JavaScript reduce operations.
//
// KEY THINGS BEING TESTED:
//   1. Zero-state — stats when user has no jobs
//   2. Status count accuracy — exact counts per status
//   3. Monthly applications — current month appears in output
//   4. User isolation — stats are scoped to the requesting user only

const { apiClient, authClient } = require('../helpers/api-client');

const RUN_ID = Date.now();
const TEST_EMAIL = `test-stats-${RUN_ID}@jobster.dev`;
const TEST_PASSWORD = 'TestPass123!';

let client;

beforeAll(async () => {
  const res = await apiClient.post('/auth/register', {
    name: 'Stats',
    lastName: 'Tester',
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  expect(res.status).toBe(201);
  client = authClient(res.data.user.token);
});

describe('GET /jobs/stats', () => {
  it('returns zero counts when user has no jobs', async () => {
    const res = await client.get('/jobs/stats');

    expect(res.status).toBe(200);
    expect(res.data.defaultStats).toEqual({
      pending: 0,
      interview: 0,
      declined: 0,
    });
    expect(res.data.monthlyApplications).toEqual([]);
  });

  it('reflects exact counts after creating jobs with specific statuses', async () => {
    // Create: 3 pending, 2 interview, 1 declined = 6 total
    const jobSpecs = [
      { status: 'pending' },
      { status: 'pending' },
      { status: 'pending' },
      { status: 'interview' },
      { status: 'interview' },
      { status: 'declined' },
    ];

    for (const spec of jobSpecs) {
      const r = await client.post('/jobs', {
        company: 'Stats Corp',
        position: 'Test Role',
        jobType: 'full-time',
        ...spec,
      });
      expect(r.status).toBe(201);
    }

    const res = await client.get('/jobs/stats');

    expect(res.status).toBe(200);
    expect(res.data.defaultStats.pending).toBe(3);
    expect(res.data.defaultStats.interview).toBe(2);
    expect(res.data.defaultStats.declined).toBe(1);
  }, 45000); // Extended timeout for 6 sequential job creates

  it('monthlyApplications includes this month with correct count', async () => {
    const res = await client.get('/jobs/stats');
    expect(res.status).toBe(200);

    // At least one entry (the current month)
    expect(res.data.monthlyApplications.length).toBeGreaterThanOrEqual(1);

    // Last entry is the current month (array is oldest → newest)
    const latest = res.data.monthlyApplications[res.data.monthlyApplications.length - 1];
    expect(typeof latest.date).toBe('string');   // e.g. "Jul 2026"
    expect(typeof latest.count).toBe('number');
    expect(latest.count).toBeGreaterThanOrEqual(6); // We created 6 jobs above

    // Verify date format matches what the frontend expects (matches moment format)
    // Should be "MMM YYYY" e.g. "Jul 2026", "Aug 2026"
    expect(latest.date).toMatch(/^[A-Z][a-z]{2}\s\d{4}$/);
  });

  it('monthlyApplications has at most 6 entries (last 6 months)', async () => {
    const res = await client.get('/jobs/stats');
    expect(res.status).toBe(200);
    // Lambda mirrors Express: last 6 months only
    expect(res.data.monthlyApplications.length).toBeLessThanOrEqual(6);
  });

  it('stats are user-isolated — another user\'s jobs do not appear', async () => {
    // Create a second user with 10 jobs
    const otherRes = await apiClient.post('/auth/register', {
      name: 'Other',
      lastName: 'Stats User',
      email: `test-stats-isolation-${RUN_ID}@jobster.dev`,
      password: TEST_PASSWORD,
    });
    expect(otherRes.status).toBe(201);
    const otherClient = authClient(otherRes.data.user.token);

    for (let i = 0; i < 10; i++) {
      await otherClient.post('/jobs', {
        company: `Isolation Corp ${i}`,
        position: 'Noise Role',
      });
    }

    // Our user's stats should still show only their 6 jobs
    const res = await client.get('/jobs/stats');
    expect(res.status).toBe(200);

    const total =
      res.data.defaultStats.pending +
      res.data.defaultStats.interview +
      res.data.defaultStats.declined;

    expect(total).toBe(6); // Not 16
  }, 60000); // Extended timeout for creating 10 extra jobs
});
