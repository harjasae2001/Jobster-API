// ─────────────────────────────────────────────────────────────────────────────
// seed.js — Populate DynamoDB with mock data from mock-data.json
//
// Usage:
//   AWS (deployed table):  node scripts/seed.js
//   Local DDB:             DYNAMODB_ENDPOINT=http://localhost:8000 node scripts/seed.js
//
// Creates:
//   1. A test user (mirrors the hardcoded test user ID in the Express app)
//   2. All 75 job listings from mock-data.json, linked to that test user
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config({ path: '../.env.example' });

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, BatchWriteCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const mockData = require('../../mock-data.json'); // relative to project root

// ── DynamoDB client setup ─────────────────────────────────────────────────────
const clientConfig = { region: process.env.AWS_REGION || 'ap-south-1' };
if (process.env.DYNAMODB_ENDPOINT) {
  clientConfig.endpoint = process.env.DYNAMODB_ENDPOINT;
  clientConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'local',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'local',
  };
}

const rawClient = new DynamoDBClient(clientConfig);
const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE_NAME = process.env.TABLE_NAME || 'JobsterTable';

// Test user — same ID as hardcoded in Express middleware/authentication.js
// so the existing mock data (which uses createdBy: '62f801d0510a7c1ed2312d52') still works
const TEST_USER = {
  userId: 'test-user-62f801d0510a7c1ed2312d52', // maps the old ObjectId to our new UUID scheme
  name: 'Test',
  lastName: 'User',
  email: 'testuser@jobster.dev',
  password: 'secret123', // will be hashed
  location: 'Mumbai',
};

// ── Helper: batch write items (DDB limit: 25 per batch) ──────────────────────
const batchWrite = async (items) => {
  const BATCH_SIZE = 25;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const request = {
      RequestItems: {
        [TABLE_NAME]: batch.map((item) => ({ PutRequest: { Item: item } })),
      },
    };
    await docClient.send(new BatchWriteCommand(request));
    console.log(`  ✓ Wrote batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} items)`);
  }
};

// ── Main seed function ────────────────────────────────────────────────────────
const seed = async () => {
  console.log('🌱 Seeding DynamoDB table:', TABLE_NAME);
  console.log('   Region:', clientConfig.region);
  if (process.env.DYNAMODB_ENDPOINT) {
    console.log('   Endpoint (local):', process.env.DYNAMODB_ENDPOINT);
  }

  // 1. Create test user
  console.log('\n👤 Creating test user...');
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(TEST_USER.password, salt);
  const now = new Date().toISOString();

  // Email-keyed item (for login)
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `USER#${TEST_USER.email}`,
      SK: 'PROFILE',
      GSI1PK: `USER#${TEST_USER.email}`,
      GSI1SK: 'PROFILE',
      ...TEST_USER,
      password: hashedPassword,
      createdAt: now,
      updatedAt: now,
      entityType: 'USER',
    },
  }));

  // UserId-keyed item (for auth middleware)
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `USERID#${TEST_USER.userId}`,
      SK: 'PROFILE',
      ...TEST_USER,
      password: hashedPassword,
      createdAt: now,
      updatedAt: now,
      entityType: 'USER',
    },
  }));
  console.log('  ✓ Test user created');
  console.log('    Email:', TEST_USER.email);
  console.log('    Password:', TEST_USER.password, '(plain) →', hashedPassword.slice(0, 20) + '...');

  // 2. Create job listings from mock-data.json
  console.log(`\n📋 Creating ${mockData.length} job listings...`);
  const jobItems = mockData.map((job) => {
    const jobId = uuidv4();
    return {
      PK: `USER#${TEST_USER.userId}`,
      SK: `JOB#${jobId}`,
      jobId,
      company: job.company,
      position: job.position,
      positionLower: job.position.toLowerCase(),
      status: job.status,
      jobType: job.jobType,
      jobLocation: 'my city',
      createdBy: TEST_USER.userId,
      createdAt: job.createdAt || now,
      updatedAt: now,
      entityType: 'JOB',
    };
  });

  await batchWrite(jobItems);

  console.log('\n✅ Seed complete!');
  console.log(`   Users created: 1`);
  console.log(`   Jobs created: ${mockData.length}`);
  console.log('\n🔑 Test credentials:');
  console.log('   Email:', TEST_USER.email);
  console.log('   Password:', TEST_USER.password);
};

seed().catch((err) => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
