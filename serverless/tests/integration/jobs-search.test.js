'use strict';

// ── Jobs Search, Filter, Sort & Pagination Tests ──────────────────────────────
//
// Creates a controlled dataset of 5 jobs with known attributes, then verifies
// that filter/sort/pagination parameters produce the exact expected results.
//
// WHY a controlled dataset matters:
//   Testing search with real-world data is non-deterministic (other tests
//   may add jobs). Using a dedicated test user with a fixed set of jobs
//   gives us exact count assertions.

const { apiClient, authClient } = require('../helpers/api-client');

const RUN_ID = Date.now();
const TEST_EMAIL = `test-search-${RUN_ID}@jobster.dev`;
const TEST_PASSWORD = 'TestPass123!';

let client;

// ── Known dataset — 5 jobs with specific attributes for precise assertions ────
const TEST_JOBS = [
  { company: 'Alpha Inc',    position: 'Backend Engineer',   jobType: 'full-time', status: 'pending'   },
  { company: 'Beta LLC',     position: 'Frontend Developer', jobType: 'part-time', status: 'interview' },
  { company: 'Gamma Co',     position: 'DevOps Engineer',    jobType: 'remote',    status: 'declined'  },
  { company: 'Delta Ltd',    position: 'Software Engineer',  jobType: 'full-time', status: 'pending'   },
  { company: 'Epsilon Corp', position: 'ML Engineer',        jobType: 'full-time', status: 'pending'   },
];

beforeAll(async () => {
  // Register test user
  const res = await apiClient.post('/auth/register', {
    name: 'Search',
    lastName: 'Tester',
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  expect(res.status).toBe(201);
  client = authClient(res.data.user.token);

  // Create all 5 test jobs sequentially
  for (const job of TEST_JOBS) {
    const r = await client.post('/jobs', job);
    expect(r.status).toBe(201);
  }
}, 60000); // Extended timeout for creating 5 jobs sequentially

// ── Status Filter ─────────────────────────────────────────────────────────────
describe('Filter by status', () => {
  it('?status=pending — returns only pending jobs (3 of 5)', async () => {
    const res = await client.get('/jobs?status=pending');
    expect(res.status).toBe(200);
    expect(res.data.totalJobs).toBe(3);
    res.data.jobs.forEach(job => expect(job.status).toBe('pending'));
  });

  it('?status=interview — returns only interview jobs (1 of 5)', async () => {
    const res = await client.get('/jobs?status=interview');
    expect(res.status).toBe(200);
    expect(res.data.totalJobs).toBe(1);
    expect(res.data.jobs[0].company).toBe('Beta LLC');
  });

  it('?status=declined — returns only declined jobs (1 of 5)', async () => {
    const res = await client.get('/jobs?status=declined');
    expect(res.status).toBe(200);
    expect(res.data.totalJobs).toBe(1);
  });

  it('?status=all — returns all 5 jobs', async () => {
    const res = await client.get('/jobs?status=all');
    expect(res.status).toBe(200);
    expect(res.data.totalJobs).toBe(5);
  });
});

// ── Job Type Filter ───────────────────────────────────────────────────────────
describe('Filter by jobType', () => {
  it('?jobType=full-time — returns 3 full-time jobs', async () => {
    const res = await client.get('/jobs?jobType=full-time');
    expect(res.status).toBe(200);
    expect(res.data.totalJobs).toBe(3);
    res.data.jobs.forEach(job => expect(job.jobType).toBe('full-time'));
  });

  it('?jobType=part-time — returns 1 part-time job', async () => {
    const res = await client.get('/jobs?jobType=part-time');
    expect(res.status).toBe(200);
    expect(res.data.totalJobs).toBe(1);
  });

  it('?jobType=remote — returns 1 remote job', async () => {
    const res = await client.get('/jobs?jobType=remote');
    expect(res.status).toBe(200);
    expect(res.data.totalJobs).toBe(1);
    expect(res.data.jobs[0].company).toBe('Gamma Co');
  });

  it('?jobType=all — returns all 5 jobs', async () => {
    const res = await client.get('/jobs?jobType=all');
    expect(res.status).toBe(200);
    expect(res.data.totalJobs).toBe(5);
  });
});

// ── Position Search ───────────────────────────────────────────────────────────
describe('Search by position keyword', () => {
  it('?search=engineer — matches 4 of 5 positions (case-insensitive)', async () => {
    const res = await client.get('/jobs?search=engineer');
    expect(res.status).toBe(200);
    // Backend Engineer, DevOps Engineer, Software Engineer, ML Engineer = 4
    expect(res.data.totalJobs).toBe(4);
    res.data.jobs.forEach(job =>
      expect(job.position.toLowerCase()).toContain('engineer')
    );
  });

  it('?search=developer — matches 1 position', async () => {
    const res = await client.get('/jobs?search=developer');
    expect(res.status).toBe(200);
    expect(res.data.totalJobs).toBe(1);
    expect(res.data.jobs[0].company).toBe('Beta LLC');
  });

  it('?search=ENGINEER — search is case-insensitive', async () => {
    const res = await client.get('/jobs?search=ENGINEER');
    expect(res.status).toBe(200);
    expect(res.data.totalJobs).toBe(4); // Same as lowercase
  });

  it('?search=zzznomatch — returns empty results', async () => {
    const res = await client.get('/jobs?search=zzznomatch');
    expect(res.status).toBe(200);
    expect(res.data.totalJobs).toBe(0);
    expect(res.data.jobs).toHaveLength(0);
  });
});

// ── Sort Order ────────────────────────────────────────────────────────────────
describe('Sort order', () => {
  it('?sort=a-z — sorted alphabetically by company (ascending)', async () => {
    const res = await client.get('/jobs?sort=a-z');
    expect(res.status).toBe(200);
    const companies = res.data.jobs.map(j => j.company);
    const sorted = [...companies].sort((a, b) => a.localeCompare(b));
    expect(companies).toEqual(sorted);
  });

  it('?sort=z-a — sorted reverse alphabetically by company (descending)', async () => {
    const res = await client.get('/jobs?sort=z-a');
    expect(res.status).toBe(200);
    const companies = res.data.jobs.map(j => j.company);
    const sorted = [...companies].sort((a, b) => b.localeCompare(a));
    expect(companies).toEqual(sorted);
  });

  it('?sort=latest — most recently created job is first', async () => {
    const res = await client.get('/jobs?sort=latest');
    expect(res.status).toBe(200);
    const dates = res.data.jobs.map(j => new Date(j.createdAt).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
    }
  });

  it('?sort=oldest — oldest created job is first', async () => {
    const res = await client.get('/jobs?sort=oldest');
    expect(res.status).toBe(200);
    const dates = res.data.jobs.map(j => new Date(j.createdAt).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeLessThanOrEqual(dates[i]);
    }
  });
});

// ── Pagination ────────────────────────────────────────────────────────────────
describe('Pagination', () => {
  it('?page=1&limit=2 — returns 2 jobs and correct page metadata', async () => {
    const res = await client.get('/jobs?page=1&limit=2');
    expect(res.status).toBe(200);
    expect(res.data.jobs).toHaveLength(2);
    expect(res.data.totalJobs).toBe(5);
    expect(res.data.numOfPages).toBe(3); // ceil(5/2) = 3 pages
  });

  it('?page=3&limit=2 — returns the final 1 job on last page', async () => {
    const res = await client.get('/jobs?page=3&limit=2');
    expect(res.status).toBe(200);
    expect(res.data.jobs).toHaveLength(1); // 5 jobs, 2 per page, page 3 has 1
  });

  it('page 1 and page 2 return non-overlapping job IDs', async () => {
    const page1 = await client.get('/jobs?page=1&limit=2&sort=a-z');
    const page2 = await client.get('/jobs?page=2&limit=2&sort=a-z');
    const ids1 = page1.data.jobs.map(j => j.jobId);
    const ids2 = page2.data.jobs.map(j => j.jobId);
    ids2.forEach(id => expect(ids1).not.toContain(id));
  });
});

// ── Combined Filters ──────────────────────────────────────────────────────────
describe('Combined filters', () => {
  it('?status=pending&jobType=full-time — returns 2 matching jobs', async () => {
    const res = await client.get('/jobs?status=pending&jobType=full-time');
    expect(res.status).toBe(200);
    // Alpha Inc (pending, full-time) + Delta Ltd (pending, full-time) = 2
    expect(res.data.totalJobs).toBe(2);
    res.data.jobs.forEach(job => {
      expect(job.status).toBe('pending');
      expect(job.jobType).toBe('full-time');
    });
  });

  it('?search=engineer&status=pending — narrows results to pending engineers', async () => {
    const res = await client.get('/jobs?search=engineer&status=pending');
    expect(res.status).toBe(200);
    // Backend Engineer (pending) + Software Engineer (pending) + ML Engineer (pending) = 3
    expect(res.data.totalJobs).toBe(3);
  });
});
