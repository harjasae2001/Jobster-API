<![CDATA[<div align="center">

# 🚀 Jobster API

**A full-stack Job Tracking application built with a hybrid architecture:**
**Express + MongoDB (original) alongside a production AWS Serverless stack (Lambda · DynamoDB · API Gateway · S3 · CloudFront)**

[![Deploy to Production](https://github.com/harjasae2001/Jobster-API/actions/workflows/deploy.yml/badge.svg)](https://github.com/harjasae2001/Jobster-API/actions/workflows/deploy.yml)
[![PR Checks](https://github.com/harjasae2001/Jobster-API/actions/workflows/pr-check.yml/badge.svg)](https://github.com/harjasae2001/Jobster-API/actions/workflows/pr-check.yml)

**Live Frontend →** [https://d2t3sgj258ubhc.cloudfront.net/landing](https://d2t3sgj258ubhc.cloudfront.net/landing)

</div>

---

## Table of Contents

- [Project Overview](#project-overview)
- [Architecture](#architecture)
  - [Original Stack (Express + MongoDB)](#original-stack-express--mongodb)
  - [Serverless Stack (AWS)](#serverless-stack-aws)
  - [What Was Migrated](#what-was-migrated)
- [Tech Stack](#tech-stack)
- [DynamoDB Data Model](#dynamodb-data-model)
- [API Reference](#api-reference)
- [Observability Stack](#observability-stack)
- [CI/CD Pipeline](#cicd-pipeline)
- [Integration Tests](#integration-tests)
- [Project Structure](#project-structure)
- [Getting Started (Local Development)](#getting-started-local-development)
  - [Prerequisites](#prerequisites)
  - [Clone & Install](#clone--install)
  - [Run the Express App](#run-the-express-app)
  - [Run the Serverless Stack Locally](#run-the-serverless-stack-locally)
- [Deployment to AWS](#deployment-to-aws)
- [Environment Variables](#environment-variables)
- [Cost Estimate](#cost-estimate)

---

## Project Overview

Jobster started as a conventional Express + MongoDB REST API deployed on Render. It was subsequently re-architected into a **production-grade AWS Serverless stack** to demonstrate:

- **Serverless-first design** with Lambda, API Gateway, DynamoDB (Single-Table Design), S3, and CloudFront
- **Infrastructure as Code** using AWS SAM (`template.yaml`) — the entire AWS stack is reproducible from a single file
- **Automated CI/CD** via GitHub Actions — push to `main` → validate → deploy → integration test, automatically
- **Enterprise observability** — AWS X-Ray distributed tracing, CloudWatch EMF custom metrics, structured JSON logging, and automated SNS alarm emails
- **Data modelling migration** — MongoDB document model → DynamoDB Single-Table Design with partition/sort key strategy

Both stacks are live and maintained in this repository. The Express app continues to serve as a reference implementation, while the serverless stack is the production deployment.

---

## Architecture

### Original Stack (Express + MongoDB)

```
Client (React / Vite)
        │
        ▼
  Express.js Server  ──── Mongoose ODM ───▶  MongoDB Atlas
  (REST API, Node.js)
        │
  Deployed on: Render (Web Service)
```

**Key libraries:** `express`, `mongoose`, `bcryptjs`, `jsonwebtoken`, `helmet`, `cors`, `express-rate-limit`, `swagger-ui-express`

---

### Serverless Stack (AWS)

```
                        ┌─────────────────────────────────────┐
                        │         AWS ap-south-1 (Mumbai)      │
                        │                                      │
  User Browser          │  CloudFront Distribution             │
       │   ─────────────▶  (d2t3sgj258ubhc.cloudfront.net)    │
       │                │         │           │                │
       │                │    S3 Bucket    API Gateway          │
       │                │  (React SPA)    (REST API)           │
       │                │                     │                │
       │                │              ┌──────┴──────┐         │
       │                │              │   Lambda    │         │
       │                │              │  Functions  │         │
       │                │              │  (Node 24)  │         │
       │                │              └──────┬──────┘         │
       │                │                     │                │
       │                │              DynamoDB Table          │
       │                │           (Single-Table Design)      │
       │                │                                      │
       │                │   Observability:                     │
       │                │   ├── X-Ray (distributed traces)     │
       │                │   ├── CloudWatch Logs (JSON)         │
       │                │   ├── CloudWatch Metrics (EMF)       │
       │                │   ├── CloudWatch Alarms (4)          │
       │                │   ├── CloudWatch Dashboard           │
       │                │   └── SNS → Email Alerts             │
       │                └─────────────────────────────────────┘
```

---

### What Was Migrated

| Feature | Express (MongoDB) | Serverless (AWS) | Notes |
|---|---|---|---|
| **Register** | `controllers/auth.js` → `POST /auth/register` | `handlers/auth-register.js` | Duplicate check via DDB ConditionExpression |
| **Login** | `controllers/auth.js` → `POST /auth/login` | `handlers/auth-login.js` | GetItem by email GSI |
| **Update User** | `controllers/auth.js` → `PATCH /auth/updateUser` | `handlers/auth-update-user.js` | UpdateItem on both PK items |
| **Create Job** | `controllers/jobs.js` → `POST /jobs` | `handlers/jobs-create.js` | PutItem with UUID + positionLower field |
| **Get All Jobs** | `controllers/jobs.js` → `GET /jobs` | `handlers/jobs-get-all.js` | DDB Query + in-memory filter/sort/paginate |
| **Get Single Job** | `controllers/jobs.js` → `GET /jobs/:id` | `handlers/jobs-get-one.js` | GetItem by USER#+JOB# composite key |
| **Update Job** | `controllers/jobs.js` → `PATCH /jobs/:id` | `handlers/jobs-update.js` | UpdateItem with ownership check |
| **Delete Job** | `controllers/jobs.js` → `DELETE /jobs/:id` | `handlers/jobs-delete.js` | DeleteItem with ownership check |
| **Job Stats** | `controllers/jobs.js` → `GET /jobs/stats` | `handlers/jobs-stats.js` | `$group/$sum` aggregation → JS `reduce()` |
| **Auth JWT Middleware** | `middleware/authentication.js` | `lib/auth-middleware.js` | Same JWT verify logic |
| **Database** | MongoDB Atlas (Mongoose) | DynamoDB (Single-Table Design) | |
| **Deployment** | Render (Web Service) | AWS Lambda + API Gateway | |
| **Frontend Hosting** | Render (Static Site) | S3 + CloudFront | |

---

## Tech Stack

### Express (Original Backend)
| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express 4 |
| Database | MongoDB Atlas via Mongoose 6 |
| Auth | JSON Web Tokens (jsonwebtoken) |
| Passwords | bcryptjs |
| Validation | Joi |
| Security | helmet, cors, express-rate-limit, xss-clean |
| Docs | Swagger UI + YAML |

### Serverless (AWS Stack)
| Layer | Technology |
|---|---|
| Runtime | Node.js 24 on AWS Lambda (arm64/Graviton2) |
| API | Amazon API Gateway (REST) |
| Database | Amazon DynamoDB (Single-Table Design, PAY_PER_REQUEST) |
| Frontend CDN | Amazon CloudFront + S3 |
| IaC | AWS SAM (`template.yaml`) |
| Auth | JSON Web Tokens — same as Express |
| Tracing | AWS X-Ray (`aws-xray-sdk-core`) |
| Metrics | CloudWatch EMF (Embedded Metrics Format) |
| Logging | Structured JSON → CloudWatch Logs |
| Alarms | CloudWatch Alarms → SNS → Email |
| CI/CD | GitHub Actions (validate → deploy → integration test) |
| Testing | Jest + Axios (39 integration tests against live API) |

---

## DynamoDB Data Model

This project uses **Single-Table Design** — all entity types (Users, Jobs) live in one DynamoDB table.

### Table Name
`JobsterTable-production`

### Key Schema

| Key | Type | Purpose |
|---|---|---|
| `PK` | String (Partition Key) | Entity identifier |
| `SK` | String (Sort Key) | Entity sub-type or child item |
| `GSI1PK` / `GSI1SK` | String | Global Secondary Index for alternate lookups |

### Access Patterns

| Pattern | PK | SK | Explanation |
|---|---|---|---|
| Register / Get user by email | `USER#<email>` | `PROFILE` | Login lookup — email is the natural unique key |
| Get user by ID (auth middleware) | `USERID#<userId>` | `PROFILE` | Fast O(1) lookup per request without GSI |
| Create / Get single job | `USER#<userId>` | `JOB#<jobId>` | Composite key for ownership enforcement |
| Get all jobs for a user | `USER#<userId>` | `begins_with('JOB#')` | Query returns all jobs for that user |

### Item Shape — User
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

### Item Shape — Job
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

> **`positionLower`** is a lowercase copy of `position` stored at write time. DynamoDB's `contains()` function in FilterExpressions is case-sensitive, so this field enables case-insensitive search without a full table scan.

---

## API Reference

**Base URL (production):** `https://6hqcka29e6.execute-api.ap-south-1.amazonaws.com/production/api/v1`

All protected routes require:
```
Authorization: Bearer <JWT token>
```

### Auth Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | ❌ | Create a new user account |
| `POST` | `/auth/login` | ❌ | Login and receive a JWT |
| `PATCH` | `/auth/updateUser` | ✅ | Update name, email, location, lastName |

### Jobs Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/jobs` | ✅ | List all jobs (filter, sort, paginate) |
| `POST` | `/jobs` | ✅ | Create a new job |
| `GET` | `/jobs/stats` | ✅ | Get status counts and monthly applications |
| `GET` | `/jobs/:id` | ✅ | Get a single job by ID |
| `PATCH` | `/jobs/:id` | ✅ | Update a job |
| `DELETE` | `/jobs/:id` | ✅ | Delete a job |

### GET /jobs — Query Parameters

| Parameter | Values | Default | Description |
|---|---|---|---|
| `status` | `pending`, `interview`, `declined`, `all` | `all` | Filter by application status |
| `jobType` | `full-time`, `part-time`, `remote`, `internship`, `all` | `all` | Filter by job type |
| `search` | Any string | — | Case-insensitive position title search |
| `sort` | `latest`, `oldest`, `a-z`, `z-a` | `latest` | Sort order |
| `page` | Number | `1` | Page number |
| `limit` | Number (max 100) | `10` | Results per page |

### Session Timeout
JWT tokens expire after **1 day (`1d`)**. There is no refresh token — the client must re-login after expiry.

---

## Observability Stack

### AWS X-Ray — Distributed Tracing

All 9 Lambda functions have `Tracing: Active` enabled. The DynamoDB client is wrapped with `captureAWSv3Client` in `lib/dynamo-client.js` — this is applied **once at the module level**, so every handler automatically gets DynamoDB subsegments in X-Ray without any per-handler changes.

**What you see in the X-Ray Service Map:**
```
API Gateway → Lambda (handler) → DynamoDB
    (5ms)         (45ms)           (18ms)
```

**X-Ray Console:** AWS Console → X-Ray → Service Map

### Structured JSON Logging

Every handler uses `lib/logger.js` which writes one JSON object per log call to stdout. CloudWatch Logs Insights can query these fields directly.

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

### Custom Metrics (EMF)

`lib/metrics.js` uses CloudWatch Embedded Metrics Format — custom metrics are emitted as JSON to stdout with zero extra API calls or latency. They appear in the `Jobster/API` CloudWatch namespace.

| Metric | Unit | Description |
|---|---|---|
| `UserRegistered` | Count | Successful new registrations |
| `HandlerDuration` | Milliseconds | End-to-end handler execution time |
| `HandlerError` | Count | Unhandled/unexpected errors |
| `RegistrationConflict` | Count | Duplicate email registration attempts |

### CloudWatch Alarms (4)

| Alarm | Threshold | Action |
|---|---|---|
| `Jobster-LambdaErrors-production` | > 5 Lambda errors in 5 min | SNS email |
| `Jobster-ApiGateway5xx-production` | > 3 API Gateway 5xx in 5 min | SNS email |
| `Jobster-DynamoDBThrottles-production` | > 0 throttled requests | SNS email |
| `Jobster-LambdaDuration-p99-production` | p99 > 3000ms | SNS email |

### CloudWatch Dashboard

A 6-widget operational dashboard is deployed automatically with the stack:

**Direct link:** `https://ap-south-1.console.aws.amazon.com/cloudwatch/home?region=ap-south-1#dashboards:name=JobsterDashboard-production`

Widgets: Alarm status strip · Lambda invocations & errors · Lambda p50/p99 duration · API Gateway traffic & error rates · DynamoDB consumed capacity · Custom EMF business metrics

---

## CI/CD Pipeline

Defined in `.github/workflows/deploy.yml`. Triggers on every push to `main` that touches the `serverless/` directory.

```
Push to main
      │
      ▼
  ✅ Validate (45s)
  ├── Node.js syntax check on all src/ files
  └── sam validate --lint (CloudFormation linter)
      │ (fails fast, no AWS cost)
      ▼
  🚀 Deploy (3-4 min)
  ├── sam build --parallel
  ├── sam deploy --no-confirm-changeset
  └── Capture API URL from CloudFormation outputs
      │
      ▼
  🧪 Integration Tests (4-5 min)
  ├── 39 Jest tests against the live deployed API
  └── Upload test artifacts to GitHub Actions
```

### GitHub Secrets Required

| Secret | Description |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM access key for the deploy user |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key for the deploy user |
| `JWT_SECRET` | JWT signing secret (must match deployed stack) |

**Add secrets at:** `https://github.com/harjasae2001/Jobster-API/settings/secrets/actions`

### PR Check Workflow

`.github/workflows/pr-check.yml` runs on every PR targeting `main` — syntax check + SAM lint only, no AWS deployment. Posts a summary comment on the PR automatically.

---

## Integration Tests

39 test cases across 4 files, all hitting the live production API:

```
serverless/tests/
└── integration/
    ├── auth.test.js        (13 tests) — Register, login, JWT validation
    ├── jobs-crud.test.js   (13 tests) — Full Create→Read→Update→Delete lifecycle
    ├── jobs-search.test.js (15 tests) — Filters, search, sort modes, pagination
    └── jobs-stats.test.js  (5 tests)  — Stats accuracy, monthly grouping, isolation
```

**Test isolation strategy:** Each test run registers a unique email using `Date.now()` as a suffix (`test-auth-<timestamp>@jobster.dev`). Multiple runs and parallel CI jobs never collide in DynamoDB.

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
│
├── .github/
│   └── workflows/
│       ├── deploy.yml          # CI/CD: validate → deploy → integration test
│       ├── pr-check.yml        # PR gate: syntax + SAM lint, posts PR comment
│       └── destroy.yml         # Manual: tear down the AWS stack
│
├── app.js                      # Express entry point
├── routes/                     # Express route definitions
├── controllers/                # Express route handlers (auth.js, jobs.js)
├── models/                     # Mongoose schemas (User.js, Job.js)
├── middleware/                 # Express middleware (authentication.js, error-handler.js)
├── errors/                     # Custom error classes (BadRequestError, etc.)
├── db/                         # MongoDB connection (connect.js)
├── client/                     # React frontend (build output served by Express)
├── package.json                # Express dependencies
│
└── serverless/                 # ── AWS Serverless Stack ──────────────────────
    ├── template.yaml           # SAM IaC: ALL AWS resources defined here
    ├── samconfig.toml          # SAM deploy defaults (region, stack name, params)
    ├── package.json            # Lambda dependencies
    ├── jest.config.js          # Jest config for integration tests
    ├── .env.example            # Local development environment template
    │
    ├── src/
    │   ├── handlers/           # Lambda function handlers (one file = one endpoint)
    │   │   ├── auth-register.js
    │   │   ├── auth-login.js
    │   │   ├── auth-update-user.js
    │   │   ├── jobs-create.js
    │   │   ├── jobs-get-all.js
    │   │   ├── jobs-get-one.js
    │   │   ├── jobs-update.js
    │   │   ├── jobs-delete.js
    │   │   └── jobs-stats.js
    │   │
    │   └── lib/                # Shared utilities (imported by all handlers)
    │       ├── auth-middleware.js  # JWT verify — called at top of each protected handler
    │       ├── dynamo-client.js    # DynamoDB DocumentClient (X-Ray instrumented)
    │       ├── errors.js           # Custom error classes (mirrors Express errors/)
    │       ├── logger.js           # Structured JSON logger → CloudWatch Logs
    │       ├── metrics.js          # EMF custom metrics → CloudWatch Metrics
    │       ├── response.js         # Standardized API Gateway response builder
    │       └── tracer.js           # X-Ray wrapper (no-op in local/test env)
    │
    ├── tests/
    │   ├── helpers/
    │   │   └── api-client.js   # Axios client factory (auth + unauth)
    │   └── integration/
    │       ├── auth.test.js
    │       ├── jobs-crud.test.js
    │       ├── jobs-search.test.js
    │       └── jobs-stats.test.js
    │
    ├── events/                 # Sample JSON payloads for `sam local invoke`
    └── scripts/                # Utility scripts (seed data, etc.)
```

---

## Getting Started (Local Development)

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org) |
| AWS CLI | v2 | [docs.aws.amazon.com/cli](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) |
| AWS SAM CLI | latest | [docs.aws.amazon.com/serverless-application-model](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) |
| Docker | latest | Required for `sam local` only |
| MongoDB | Atlas account | Only for the Express stack |
| Git | any | — |

---

### Clone & Install

```bash
# Clone the repository
git clone https://github.com/harjasae2001/Jobster-API.git
cd Jobster-API
```

---

### Run the Express App

The original Express + MongoDB backend runs independently of AWS.

**1. Install dependencies**
```bash
npm install
```

**2. Create a `.env` file in the project root**
```env
MONGO_URL=mongodb+srv://<user>:<password>@cluster.mongodb.net/jobster
JWT_SECRET=your_jwt_secret_here_min_16_chars
JWT_LIFETIME=1d
PORT=5000
```

**3. Start the development server**
```bash
npm run dev
# Server starts on http://localhost:5000
# API available at http://localhost:5000/api/v1
```

**4. (Optional) Seed mock data**
```bash
node populate.js
```

---

### Run the Serverless Stack Locally

SAM CLI emulates Lambda and API Gateway locally using Docker.

**1. Install serverless dependencies**
```bash
cd serverless
npm install
```

**2. Configure environment**
```bash
cp .env.example .env
# Edit .env and set JWT_SECRET (minimum 16 characters)
```

**3. Configure AWS credentials** (needed for DynamoDB — either real AWS or DynamoDB Local)
```bash
aws configure
# AWS Access Key ID: <your key>
# AWS Secret Access Key: <your secret>
# Default region: ap-south-1
# Output format: json
```

**4. Build the SAM application**
```bash
sam build
```

**5. Start the local API** (requires Docker running)
```bash
sam local start-api
# API available at http://127.0.0.1:3000/api/v1
```

> **Note on DynamoDB:** By default, `sam local start-api` uses your real AWS DynamoDB table (`TABLE_NAME` from `.env`). To use a local DynamoDB container instead, run `docker run -p 8000:8000 amazon/dynamodb-local` and uncomment the `DYNAMODB_ENDPOINT` line in `.env`.

**6. Test a single function directly (without full API Gateway)**
```bash
sam local invoke RegisterFunction -e events/auth-register.json
sam local invoke LoginFunction -e events/auth-login.json
```

---

## Deployment to AWS

> **First-time setup:** Run `sam deploy --guided` once to populate `samconfig.toml` with your S3 bucket name. After that, all subsequent deploys use `sam deploy` without flags.

### Prerequisites
- AWS account with programmatic access
- AWS CLI configured (`aws configure`)
- SAM CLI installed

### Deploy Steps

```bash
cd serverless

# 1. Build (compiles all Lambda functions and resolves dependencies)
sam build

# 2. First-time deploy (interactive — sets your JWT_SECRET and creates S3 bucket)
sam deploy --guided
# Stack name: jobster-serverless
# Region: ap-south-1
# Parameter JwtSecret: <your secret, min 16 chars>
# Parameter JwtLifetime: 1d
# Parameter FrontendBucketSuffix: <any random 6-char string, e.g. a7f3k9>

# 3. Subsequent deploys (uses samconfig.toml defaults)
sam deploy
```

### After Deploy — Upload the React Frontend

The SAM deploy creates the S3 bucket and CloudFront distribution, but doesn't upload frontend files. Build and sync the React app:

```bash
# In the project root
cd client
npm install
npm run build

# Sync to S3 (get bucket name from CloudFormation outputs)
aws s3 sync dist/ s3://jobster-frontend-<your-suffix>/ --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id <your-distribution-id> \
  --paths "/*"
```

Get the CloudFront distribution ID from:
```bash
aws cloudformation describe-stacks \
  --stack-name jobster-serverless \
  --region ap-south-1 \
  --query "Stacks[0].Outputs"
```

### Tear Down

To delete all AWS resources:
```bash
# Delete S3 objects first (CloudFormation can't delete non-empty buckets)
aws s3 rm s3://jobster-frontend-<your-suffix>/ --recursive

# Delete the CloudFormation stack (removes all Lambda, DDB, API GW, CloudFront resources)
sam delete --stack-name jobster-serverless --region ap-south-1
```

---

## Environment Variables

### Express App (root `.env`)

| Variable | Required | Example | Description |
|---|---|---|---|
| `MONGO_URL` | ✅ | `mongodb+srv://...` | MongoDB Atlas connection string |
| `JWT_SECRET` | ✅ | `my_super_secret_key_here` | JWT signing secret (min 16 chars) |
| `JWT_LIFETIME` | ❌ | `1d` | Token expiry (default: `1d`) |
| `PORT` | ❌ | `5000` | Express listen port (default: `5000`) |

### Serverless Stack (SAM Parameters / Lambda env vars)

These are set as CloudFormation parameters during `sam deploy --guided` and injected into Lambda at runtime:

| Variable | Source | Example | Description |
|---|---|---|---|
| `JWT_SECRET` | SAM parameter | `my_secret` | Stored as plain text in CloudFormation (consider SSM for production) |
| `JWT_LIFETIME` | SAM parameter | `1d` | Token expiry passed to all auth handlers |
| `TABLE_NAME` | Auto-injected by SAM | `JobsterTable-production` | DynamoDB table name — never set manually |
| `ENVIRONMENT` | SAM parameter | `production` | Used as a dimension in EMF metrics |
| `AWS_REGION` | Auto-set by Lambda | `ap-south-1` | Available in all Lambda environments automatically |

---

## Cost Estimate

Estimated monthly cost at **~120 USD credit** with light usage (portfolio/demo traffic):

| Service | Usage | Estimated Cost |
|---|---|---|
| **Lambda** | 1M requests/month, avg 100ms, 128MB | ~$0.40 |
| **API Gateway** | 1M API calls/month | ~$3.50 |
| **DynamoDB** | PAY_PER_REQUEST, ~1M reads, ~200K writes | ~$1.50 |
| **S3** | Static hosting, ~1GB storage | ~$0.02 |
| **CloudFront** | ~10GB data transfer/month | ~$0.85 |
| **CloudWatch** | Logs ingestion, metrics, dashboard | ~$2.00 |
| **X-Ray** | 100K traces/month (5% sampling) | ~$0.50 |
| **SNS** | Alarm emails | < $0.01 |
| **Total** | | **~$8.80/month** |

> At $8.80/month, your $120 AWS credits cover approximately **13 months** of portfolio-level traffic. The AWS Free Tier (1M Lambda requests, 25GB DynamoDB, 1M API Gateway calls per month) covers the first 12 months regardless of credits for new accounts.
]]>
