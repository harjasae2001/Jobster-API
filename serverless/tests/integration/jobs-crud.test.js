'use strict';

// ── Jobs CRUD Integration Tests ────────────────────────────────────────────────
//
// Tests the complete job lifecycle: create → read → update → delete.
// Also tests ownership isolation — a user cannot read or modify another user's jobs.
//
// NOTE: updateJob (PATCH) and deleteJob (DELETE) handlers are included here.
// If those handlers are not yet deployed, those test blocks will still run but
// will return 403/404 — the test output shows exactly what's missing.

const { apiClient, authClient } = require('../helpers/api-client');

const RUN_ID = Date.now();
const TEST_EMAIL = `test-crud-${RUN_ID}@jobster.dev`;
const TEST_PASSWORD = 'TestPass123!';

let client;         // Authenticated client for primary test user
let createdJobId;   // Set during create test, reused by get/update/delete tests

// ── Setup — Register and login once for all tests in this file ────────────────
beforeAll(async () => {
  const res = await apiClient.post('/auth/register', {
    name: 'CRUD',
    lastName: 'Tester',
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  expect(res.status).toBe(201);
  client = authClient(res.data.user.token);
});

// ── Create Job ────────────────────────────────────────────────────────────────
describe('POST /jobs — create', () => {
  it('201 — creates job and returns correct shape', async () => {
    const res = await client.post('/jobs', {
      company: 'Integration Corp',
      position: 'Software Engineer',
      jobType: 'full-time',
      jobLocation: 'Remote',
    });

    expect(res.status).toBe(201);
    expect(res.data.job).toBeDefined();
    expect(res.data.job.jobId).toBeDefined();
    expect(res.data.job.company).toBe('Integration Corp');
    expect(res.data.job.position).toBe('Software Engineer');
    expect(res.data.job.status).toBe('pending'); // Default status
    expect(res.data.job.createdAt).toBeDefined();

    // DynamoDB internals must NOT leak into the response
    expect(res.data.job.PK).toBeUndefined();
    expect(res.data.job.SK).toBeUndefined();

    createdJobId = res.data.job.jobId;
  });

  it('400 — rejects request missing company', async () => {
    const res = await client.post('/jobs', { position: 'Engineer' });
    expect(res.status).toBe(400);
  });

  it('400 — rejects request missing position', async () => {
    const res = await client.post('/jobs', { company: 'Corp' });
    expect(res.status).toBe(400);
  });

  it('400 — rejects empty company string', async () => {
    const res = await client.post('/jobs', { company: '', position: 'Engineer' });
    expect(res.status).toBe(400);
  });
});

// ── Get Single Job ────────────────────────────────────────────────────────────
describe('GET /jobs/:id — get single', () => {
  it('200 — returns the created job with all fields', async () => {
    const res = await client.get(`/jobs/${createdJobId}`);

    expect(res.status).toBe(200);
    expect(res.data.job.jobId).toBe(createdJobId);
    expect(res.data.job.company).toBe('Integration Corp');
    expect(res.data.job.position).toBe('Software Engineer');
    expect(res.data.job.jobType).toBe('full-time');
  });

  it('404 — returns 404 for a non-existent job ID', async () => {
    const res = await client.get('/jobs/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});

// ── Get All Jobs ──────────────────────────────────────────────────────────────
describe('GET /jobs — list all', () => {
  it('200 — returns jobs array with pagination metadata', async () => {
    const res = await client.get('/jobs');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.jobs)).toBe(true);
    expect(typeof res.data.totalJobs).toBe('number');
    expect(typeof res.data.numOfPages).toBe('number');
    expect(res.data.totalJobs).toBeGreaterThanOrEqual(1);

    // Verify our created job appears
    const found = res.data.jobs.find(j => j.jobId === createdJobId);
    expect(found).toBeDefined();
  });

  it('200 — returns empty jobs array when user has no matching jobs', async () => {
    // Filter by a specific status our test job doesn't have
    const res = await client.get('/jobs?status=declined');
    expect(res.status).toBe(200);
    expect(res.data.totalJobs).toBe(0);
    expect(res.data.jobs).toHaveLength(0);
  });
});

// ── Update Job ────────────────────────────────────────────────────────────────
describe('PATCH /jobs/:id — update', () => {
  it('200 — updates job fields and reflects changes', async () => {
    const res = await client.patch(`/jobs/${createdJobId}`, {
      company: 'Updated Corp',
      position: 'Senior Software Engineer',
      status: 'interview',
      jobType: 'remote',
    });

    expect(res.status).toBe(200);
    expect(res.data.job.company).toBe('Updated Corp');
    expect(res.data.job.position).toBe('Senior Software Engineer');
    expect(res.data.job.status).toBe('interview');
    expect(res.data.job.jobType).toBe('remote');
    expect(res.data.job.jobId).toBe(createdJobId); // ID unchanged
  });

  it('200 — partial update only changes specified fields', async () => {
    const res = await client.patch(`/jobs/${createdJobId}`, {
      company: 'Partial Update Corp',
      position: 'Senior Software Engineer', // required
    });
    expect(res.status).toBe(200);
    expect(res.data.job.company).toBe('Partial Update Corp');
    expect(res.data.job.status).toBe('interview'); // Unchanged from previous update
  });

  it('400 — rejects empty company string', async () => {
    const res = await client.patch(`/jobs/${createdJobId}`, {
      company: '',
      position: 'Engineer',
    });
    expect(res.status).toBe(400);
  });

  it('404 — returns 404 for updating a non-existent job', async () => {
    const res = await client.patch('/jobs/00000000-0000-0000-0000-000000000000', {
      company: 'Ghost Corp',
      position: 'Ghost Role',
    });
    expect(res.status).toBe(404);
  });
});

// ── User Isolation ────────────────────────────────────────────────────────────
describe('Ownership isolation — users cannot access each other\'s jobs', () => {
  it('404 — user B cannot read user A\'s job', async () => {
    // Create a second user
    const otherRes = await apiClient.post('/auth/register', {
      name: 'Other',
      lastName: 'User',
      email: `test-other-${RUN_ID}@jobster.dev`,
      password: TEST_PASSWORD,
    });
    expect(otherRes.status).toBe(201);
    const otherClient = authClient(otherRes.data.user.token);

    // Try to read primary user's job as the second user
    // Returns 404 (not 403) to prevent enumeration attacks
    const accessRes = await otherClient.get(`/jobs/${createdJobId}`);
    expect(accessRes.status).toBe(404);
  });
});

// ── Delete Job ────────────────────────────────────────────────────────────────
// Run last — these tests destroy the job created in 'create' tests
describe('DELETE /jobs/:id — delete', () => {
  it('200 — deletes the job successfully', async () => {
    const res = await client.delete(`/jobs/${createdJobId}`);
    expect(res.status).toBe(200);
  });

  it('404 — GET the deleted job returns 404', async () => {
    const res = await client.get(`/jobs/${createdJobId}`);
    expect(res.status).toBe(404);
  });

  it('404 — DELETE an already-deleted job returns 404', async () => {
    const res = await client.delete(`/jobs/${createdJobId}`);
    expect(res.status).toBe(404);
  });
});
