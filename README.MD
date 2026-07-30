# Jobster API

**A full-stack Job Tracking application — Express + MongoDB (original) alongside a production AWS Serverless stack.**

[![Deploy to Production](https://github.com/harjasae2001/Jobster-API/actions/workflows/deploy.yml/badge.svg)](https://github.com/harjasae2001/Jobster-API/actions/workflows/deploy.yml)
[![PR Checks](https://github.com/harjasae2001/Jobster-API/actions/workflows/pr-check.yml/badge.svg)](https://github.com/harjasae2001/Jobster-API/actions/workflows/pr-check.yml)

**Live Frontend:** https://d2t3sgj258ubhc.cloudfront.net/landing

---

## Table of Contents

- [Project Overview](#project-overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [What Was Migrated](#what-was-migrated)
- [DynamoDB Data Model](#dynamodb-data-model)
- [API Reference](#api-reference)
- [Observability Stack](#observability-stack)
- [CI/CD Pipeline](#cicd-pipeline)
- [Integration Tests](#integration-tests)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Deployment to AWS](#deployment-to-aws)
- [Environment Variables](#environment-variables)
- [Cost Estimate](#cost-estimate)

---

## Project Overview

Jobster started as a conventional Express + MongoDB REST API deployed on Render. It was subsequently re-architected into a **production-grade AWS Serverless stack** to demonstrate:

- **Serverless-first design** — Lambda, API Gateway, DynamoDB, S3, CloudFront
- **Infrastructure as Code** — the entire AWS stack is defined in a single `template.yaml` (AWS SAM)
- **Automated CI/CD** — push to `main` triggers validate → deploy → integration test automatically via GitHub Actions
- **Enterprise observability** — AWS X-Ray distributed tracing, CloudWatch EMF custom metrics, structured JSON logging, automated SNS alarm emails
- **Data modelling migration** — MongoDB document model re-designed as DynamoDB Single-Table Design

Both stacks are live and maintained in this repository.

---

## Architecture

### Original Stack — Express + MongoDB

```
React Frontend (Vite)
        |
        v
Express.js Server (Node.js)
        |
   Mongoose ODM
        |
        v
  MongoDB Atlas

Deployed on: Render
```

### Serverless Stack — AWS

```
Browser
  |
  v
CloudFront CDN  <---  S3 Bucket (React SPA)
  |
  v
API Gateway (REST)
  |
  v
Lambda Functions (Node.js 24, arm64)
  |
  v
DynamoDB (Single-Table Design, PAY_PER_REQUEST)

Observability:
  - AWS X-Ray        (distributed traces)
  - CloudWatch Logs  (structured JSON)
  - CloudWatch EMF   (custom metrics)
  - CloudWatch Alarms + SNS Email
  - CloudWatch Dashboard
```

**Region:** `ap-south-1` (Mumbai)

---

## Tech Stack

### Express App (Original)

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express 4 |
| Database | MongoDB Atlas (Mongoose 6) |
| Auth | JSON Web Tokens |
| Passwords | bcryptjs |
| Validation | Joi |
| Security | helmet, cors, express-rate-limit, xss-clean |
| API Docs | Swagger UI |
| Hosting | Render |

### Serverless Stack (AWS)

| Layer | Technology |
|---|---|
| Runtime | Node.js 24 on AWS Lambda (arm64 / Graviton2) |
| API | Amazon API Gateway (REST API) |
| Database | Amazon DynamoDB (Single-Table Design) |
| Frontend CDN | Amazon CloudFront + S3 |
| IaC | AWS SAM (`template.yaml`) |
| Auth | JSON Web Tokens (same as Express) |
| Tracing | AWS X-Ray (`aws-xray-sdk-core`) |
| Metrics | CloudWatch Embedded Metrics Format (EMF) |
| Logging | Structured JSON to CloudWatch Logs |
| Alarms | CloudWatch Alarms → SNS → Email |
| CI/CD | GitHub Actions |
| Testing | Jest + Axios (39 integration tests) |

---

## What Was Migrated

| Endpoint | Express Handler | Lambda Handler | Key Difference |
|---|---|---|---|
| `POST /auth/register` | `controllers/auth.js` | `handlers/auth-register.js` | DynamoDB `ConditionExpression` replaces Mongoose unique index |
| `POST /auth/login` | `controllers/auth.js` | `handlers/auth-login.js` | `GetItem` by email (GSI lookup) |
| `PATCH /auth/updateUser` | `controllers/auth.js` | `handlers/auth-update-user.js` | `UpdateItem` on both PK items |
| `POST /jobs` | `controllers/jobs.js` | `handlers/jobs-create.js` | UUID replaces MongoDB ObjectId; stores `positionLower` for search |
| `GET /jobs` | `controllers/jobs.js` | `handlers/jobs-get-all.js` | DynamoDB `Query` + in-memory filter/sort/paginate |
| `GET /jobs/:id` | `controllers/jobs.js` | `handlers/jobs-get-one.js` | `GetItem` by composite key |
| `PATCH /jobs/:id` | `controllers/jobs.js` | `handlers/jobs-update.js` | `UpdateItem` with ownership check |
| `DELETE /jobs/:id` | `controllers/jobs.js` | `handlers/jobs-delete.js` | `DeleteItem` with ownership check |
| `GET /jobs/stats` | `controllers/jobs.js` | `handlers/jobs-stats.js` | MongoDB `$group/$sum` aggregation replaced by JS `Array.reduce()` |

---

## DynamoDB Data Model

**Single-Table Design** — Users and Jobs share one table. All entity types are separated by their `PK` and `SK` prefixes.

### Table: `JobsterTable-production`

| Key | Type | Description |
|---|---|---|
| `PK` | String (Partition Key) | Entity identifier |
| `SK` | String (Sort Key) | Entity sub-type |
| `GSI1PK` / `GSI1SK` | String | Global Secondary Index for alternate lookups |

### Access Patterns

| Pattern | PK | SK |
|---|---|---|
| Get user by email (login) | `USER#<email>` | `PROFILE` |
| Get user by ID (auth middleware) | `USERID#<userId>` | `PROFILE` |
| Get single job | `USER#<userId>` | `JOB#<jobId>` |
| Get all jobs for a user | `USER#<userId>` | `begins_with('JOB#')` |

### User Item

```json
{
  "PK": "USER#harjas@example.com",
  "SK": "PROFILE",
  "userId": "e618efbe-...",
  "name": "Harjas",
  "email": "harjas@example.com",
  "password": "<bcrypt hash>",
  "lastName": "Singh",
  "location": "Mumbai",
  "createdAt": "2026-07-15T10:00:00.000Z",
  "entityType": "USER"
}
```

### Job Item

```json
{
  "PK": "USER#e618efbe-...",
  "SK": "JOB#a1b2c3d4-...",
  "jobId": "a1b2c3d4-...",
  "company": "Google",
  "position": "Software Engineer",
  "positionLower": "software engineer",
  "status": "pending",
  "jobType": "full-time",
  "jobLocation": "Remote",
  "createdAt": "2026-07-15T10:00:00.000Z",
  "entityType": "JOB"
}
```

> **`positionLower`** is a lowercase copy of `position` stored at write time. DynamoDB `contains()` in FilterExpressions is case-sensitive, so this field enables case-insensitive search without a full-table scan.

---

## API Reference

**Base URL (production):**

```
https://6hqcka29e6.execute-api.ap-south-1.amazonaws.com/production/api/v1
```

All protected routes require the header:

```
Authorization: Bearer <JWT token>
```

**Session timeout:** JWT tokens expire after **1 day (`1d`)**.

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | No | Create a new user account |
| `POST` | `/auth/login` | No | Login and receive a JWT |
| `PATCH` | `/auth/updateUser` | Yes | Update name, email, location, lastName |

### Jobs

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/jobs` | Yes | List all jobs (supports filters, sort, pagination) |
| `POST` | `/jobs` | Yes | Create a new job |
| `GET` | `/jobs/stats` | Yes | Status counts + monthly applications chart |
| `GET` | `/jobs/:id` | Yes | Get a single job by ID |
| `PATCH` | `/jobs/:id` | Yes | Update a job |
| `DELETE` | `/jobs/:id` | Yes | Delete a job |

### GET /jobs — Query Parameters

| Parameter | Values | Default | Description |
|---|---|---|---|
| `status` | `pending`, `interview`, `declined`, `all` | `all` | Filter by status |
| `jobType` | `full-time`, `part-time`, `remote`, `internship`, `all` | `all` | Filter by type |
| `search` | Any string | — | Case-insensitive position title search |
| `sort` | `latest`, `oldest`, `a-z`, `z-a` | `latest` | Sort order |
| `page` | Number | `1` | Page number |
| `limit` | Number (max 100) | `10` | Results per page |

---

## Observability Stack

### AWS X-Ray — Distributed Tracing

All 9 Lambda functions have `Tracing: Active`. The DynamoDB client is wrapped with `captureAWSv3Client` once in `lib/dynamo-client.js`, giving every handler automatic DynamoDB subsegments with no per-handler changes needed.

The X-Ray Service Map shows:

```
API Gateway --> Lambda --> DynamoDB
    (5ms)       (45ms)     (18ms)
```

**Console:** AWS Console > X-Ray > Service Map

### Structured JSON Logging

`lib/logger.js` writes one JSON object per log call to stdout, queryable in CloudWatch Logs Insights.

```json
{
  "timestamp": "2026-07-19T11:45:00.000Z",
  "level": "INFO",
  "message": "User registered successfully",
  "requestId": "abc-123",
  "functionName": "jobster-auth-register-production",
  "coldStart": false,
  "userId": "e618efbe-...",
  "duration": 47
}
```

**Sample Logs Insights query:**

```
fields @timestamp, level, message, userId, duration
| filter level = "ERROR"
| sort @timestamp desc
| limit 20
```

### Custom Metrics — CloudWatch EMF

`lib/metrics.js` emits custom metrics as JSON to stdout with zero extra API calls (no `PutMetricData` cost or latency). Metrics appear in the `Jobster/API` CloudWatch namespace.

| Metric | Unit | Description |
|---|---|---|
| `UserRegistered` | Count | Successful new registrations |
| `HandlerDuration` | Milliseconds | End-to-end handler execution time |
| `HandlerError` | Count | Unhandled errors |
| `RegistrationConflict` | Count | Duplicate email attempts |

### CloudWatch Alarms

| Alarm Name | Threshold | Notification |
|---|---|---|
| `Jobster-LambdaErrors-production` | > 5 Lambda errors in 5 min | SNS email |
| `Jobster-ApiGateway5xx-production` | > 3 API 5xx errors in 5 min | SNS email |
| `Jobster-DynamoDBThrottles-production` | > 0 throttled requests | SNS email |
| `Jobster-LambdaDuration-p99-production` | p99 > 3000ms | SNS email |

### CloudWatch Dashboard

A 6-widget operational dashboard is deployed automatically with the stack.

**Direct link:**

```
https://ap-south-1.console.aws.amazon.com/cloudwatch/home?region=ap-south-1#dashboards:name=JobsterDashboard-production
```

Widgets: Alarm status strip · Lambda invocations & errors · Lambda p50/p99 duration · API Gateway traffic · DynamoDB consumed capacity · Custom EMF metrics

---

## CI/CD Pipeline

Defined in `.github/workflows/deploy.yml`. Triggers on every push to `main` that touches `serverless/`.

```
Push to main
     |
     v
[1] Validate  (~45s, no AWS cost)
     - Node.js syntax check on all src/ files
     - sam validate --lint
     |
     v
[2] Deploy  (~3-4 min)
     - sam build --parallel
     - sam deploy --no-confirm-changeset
     - Capture API URL from CloudFormation outputs
     |
     v
[3] Integration Tests  (~4-5 min)
     - 39 Jest tests against the live deployed API
     - Test results uploaded as GitHub Actions artifact
```

### Required GitHub Secrets

Go to: `https://github.com/harjasae2001/Jobster-API/settings/secrets/actions`

| Secret Name | Description |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM user access key |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret key |
| `JWT_SECRET` | JWT signing secret (must match deployed stack) |

### PR Check Workflow

`.github/workflows/pr-check.yml` runs on every PR targeting `main` — syntax check + SAM lint only, never deploys. Posts a status comment on the PR automatically.

---

## Integration Tests

39 tests across 4 files, all running against the live production API.

```
serverless/tests/integration/
  auth.test.js        (13 tests)  Register, login, JWT validation + error cases
  jobs-crud.test.js   (13 tests)  Full Create > Read > Update > Delete lifecycle
  jobs-search.test.js (15 tests)  Filters, search, sort modes, pagination
  jobs-stats.test.js   (5 tests)  Status counts, monthly grouping, user isolation
```

Each test run registers a unique email using `Date.now()` as a suffix so runs never collide in DynamoDB.

**Run locally:**

```bash
cd serverless
export API_URL="https://6hqcka29e6.execute-api.ap-south-1.amazonaws.com/production/api/v1"
npm test
```

---

## Project Structure

```
Jobster-API/
|
|-- .github/
|   |-- workflows/
|       |-- deploy.yml        # CI/CD: validate > deploy > integration test
|       |-- pr-check.yml      # PR gate: syntax + SAM lint
|       |-- destroy.yml       # Manual stack teardown
|
|-- app.js                    # Express entry point
|-- routes/                   # Express route definitions
|-- controllers/              # Express handlers (auth.js, jobs.js)
|-- models/                   # Mongoose schemas (User.js, Job.js)
|-- middleware/               # Express middleware (auth, error handler)
|-- errors/                   # Custom error classes
|-- db/                       # MongoDB connection
|-- client/                   # React frontend (build output)
|-- package.json              # Express dependencies
|
|-- serverless/               # AWS Serverless Stack
    |-- template.yaml         # SAM IaC — ALL AWS resources defined here
    |-- samconfig.toml        # SAM deploy defaults (region, stack name)
    |-- package.json          # Lambda dependencies
    |-- jest.config.js        # Jest config for integration tests
    |-- .env.example          # Local dev environment template
    |
    |-- src/
    |   |-- handlers/         # One Lambda handler per endpoint
    |   |   |-- auth-register.js
    |   |   |-- auth-login.js
    |   |   |-- auth-update-user.js
    |   |   |-- jobs-create.js
    |   |   |-- jobs-get-all.js
    |   |   |-- jobs-get-one.js
    |   |   |-- jobs-update.js
    |   |   |-- jobs-delete.js
    |   |   |-- jobs-stats.js
    |   |
    |   |-- lib/              # Shared utilities (used by all handlers)
    |       |-- auth-middleware.js   # JWT verify
    |       |-- dynamo-client.js     # DynamoDB DocumentClient (X-Ray instrumented)
    |       |-- errors.js            # Custom error classes
    |       |-- logger.js            # Structured JSON logger
    |       |-- metrics.js           # EMF custom metrics
    |       |-- response.js          # API Gateway response builder
    |       |-- tracer.js            # X-Ray wrapper (no-op in local/test)
    |
    |-- tests/
    |   |-- helpers/
    |   |   |-- api-client.js       # Axios client factory
    |   |-- integration/
    |       |-- auth.test.js
    |       |-- jobs-crud.test.js
    |       |-- jobs-search.test.js
    |       |-- jobs-stats.test.js
    |
    |-- events/               # Sample JSON payloads for sam local invoke
    |-- scripts/              # Utility scripts (seed data, etc.)
```

---

## Getting Started

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | >= 20 | https://nodejs.org |
| AWS CLI | v2 | https://aws.amazon.com/cli |
| AWS SAM CLI | latest | https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html |
| Docker | latest | Required only for `sam local` |
| Git | any | — |

### Clone the Repository

```bash
git clone https://github.com/harjasae2001/Jobster-API.git
cd Jobster-API
```

---

### Run the Express App

```bash
# 1. Install dependencies
npm install

# 2. Create .env file in the project root
# MONGO_URL=mongodb+srv://<user>:<password>@cluster.mongodb.net/jobster
# JWT_SECRET=your_jwt_secret_here_min_16_chars
# JWT_LIFETIME=1d
# PORT=5000

# 3. Start development server
npm run dev
# API available at http://localhost:5000/api/v1

# 4. (Optional) Seed mock data
node populate.js
```

---

### Run the Serverless Stack Locally

SAM CLI emulates Lambda and API Gateway locally using Docker.

```bash
# 1. Install dependencies
cd serverless
npm install

# 2. Copy and fill in environment variables
cp .env.example .env
# Edit .env — set JWT_SECRET (minimum 16 characters)

# 3. Configure AWS credentials (needed for real DynamoDB)
aws configure

# 4. Build
sam build

# 5. Start local API (requires Docker)
sam local start-api
# API available at http://127.0.0.1:3000/api/v1
```

**Test a single function directly:**

```bash
sam local invoke RegisterFunction -e events/auth-register.json
sam local invoke LoginFunction -e events/auth-login.json
```

> **Tip:** To avoid using real AWS DynamoDB locally, run `docker run -p 8000:8000 amazon/dynamodb-local` and set `DYNAMODB_ENDPOINT=http://localhost:8000` in your `.env`.

---

## Deployment to AWS

### First Deploy (interactive)

```bash
cd serverless
sam build
sam deploy --guided
```

Respond to the prompts:

```
Stack Name: jobster-serverless
Region: ap-south-1
Parameter JwtSecret: <your secret, min 16 chars>
Parameter JwtLifetime: 1d
Parameter FrontendBucketSuffix: <any 6-char string, e.g. a7f3k9>
```

### Subsequent Deploys

```bash
sam build
sam deploy
# Type 'y' at the changeset confirmation prompt
```

### Upload the React Frontend

```bash
# Build the React app
cd client
npm install && npm run build

# Get your S3 bucket name from CloudFormation outputs
aws cloudformation describe-stacks \
  --stack-name jobster-serverless \
  --region ap-south-1 \
  --query "Stacks[0].Outputs"

# Sync to S3
aws s3 sync dist/ s3://jobster-frontend-<your-suffix>/ --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id <your-distribution-id> \
  --paths "/*"
```

### Tear Down

```bash
# Empty the S3 bucket first (CloudFormation cannot delete non-empty buckets)
aws s3 rm s3://jobster-frontend-<your-suffix>/ --recursive

# Delete the entire stack
sam delete --stack-name jobster-serverless --region ap-south-1
```

---

## Environment Variables

### Express App (root `.env`)

| Variable | Required | Example | Description |
|---|---|---|---|
| `MONGO_URL` | Yes | `mongodb+srv://...` | MongoDB Atlas connection string |
| `JWT_SECRET` | Yes | `my_super_secret_key` | JWT signing secret (min 16 chars) |
| `JWT_LIFETIME` | No | `1d` | Token expiry (default: `1d`) |
| `PORT` | No | `5000` | Express listen port (default: `5000`) |

### Serverless Stack (SAM Parameters)

These are passed as CloudFormation parameters during `sam deploy --guided` and injected automatically into Lambda at runtime.

| Variable | Set by | Example | Description |
|---|---|---|---|
| `JWT_SECRET` | SAM parameter | `my_secret` | JWT signing secret |
| `JWT_LIFETIME` | SAM parameter | `1d` | Token expiry for all auth handlers |
| `TABLE_NAME` | Auto-injected by SAM | `JobsterTable-production` | DynamoDB table name — never set manually |
| `ENVIRONMENT` | SAM parameter | `production` | Used as a dimension in EMF metrics |
| `AWS_REGION` | Auto-set by Lambda | `ap-south-1` | Available in all Lambda environments |

---

## Cost Estimate

Estimated monthly cost at portfolio/demo traffic levels:

| Service | Estimated Cost |
|---|---|
| AWS Lambda (1M requests, avg 100ms, 128MB) | ~$0.40 |
| API Gateway (1M API calls) | ~$3.50 |
| DynamoDB (PAY_PER_REQUEST, ~1M reads, ~200K writes) | ~$1.50 |
| S3 (static hosting, ~1GB) | ~$0.02 |
| CloudFront (~10GB transfer) | ~$0.85 |
| CloudWatch (logs, metrics, dashboard) | ~$2.00 |
| X-Ray (100K traces at 5% sampling) | ~$0.50 |
| SNS (alarm emails) | < $0.01 |
| **Total** | **~$8.80 / month** |

At $8.80/month, $120 in AWS credits covers approximately **13 months** of portfolio-level traffic.

The AWS Free Tier also covers the first 12 months for new accounts: 1M Lambda requests, 25GB DynamoDB storage, and 1M API Gateway calls per month.
