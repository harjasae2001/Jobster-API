# Jobster API

A full-stack job application tracker with two backends: the original Express/MongoDB application and an AWS serverless implementation using API Gateway, Lambda, DynamoDB, S3, and CloudFront.

[![PR checks](https://github.com/harjasae2001/Jobster-API/actions/workflows/pr-check.yml/badge.svg)](https://github.com/harjasae2001/Jobster-API/actions/workflows/pr-check.yml)
[![Deploy](https://github.com/harjasae2001/Jobster-API/actions/workflows/deploy.yml/badge.svg)](https://github.com/harjasae2001/Jobster-API/actions/workflows/deploy.yml)

- Live application: [Jobster on CloudFront](https://d2t3sgj258ubhc.cloudfront.net/landing)
- Production API: `https://6hqcka29e6.execute-api.ap-south-1.amazonaws.com/production/api/v1`
- API contract: [`openapi.yaml`](openapi.yaml)

## Architecture

The React client in `client/` can use either backend. `app.js` exposes an Express API backed by MongoDB through Mongoose. `serverless/template.yaml` deploys API Gateway routes to one Lambda per operation, backed by a DynamoDB single table, and hosts the React build in S3 behind CloudFront.

Protected job queries always derive the owner identifier from the verified JWT. Clients cannot choose another user's `createdBy` value.

## Key engineering decisions

### Idempotent request handling

The API does **not yet provide general idempotency keys**. `POST /jobs` generates a new MongoDB ObjectId or UUID on every successful call, so retrying the same request can create duplicates. Clients should not automatically retry writes until an `Idempotency-Key` store and conditional write path are added.

Registration is concurrency-safe for duplicate email addresses in the serverless stack: a DynamoDB conditional put on `USER#<normalized-email>` permits only the first write. This is uniqueness enforcement, not replay of a previous response, so it is not full request idempotency.

Updates and deletes are repeat-safe only in a limited sense: repeated identical updates converge, while the first delete succeeds and a repeat returns not found.

### JWT authentication and role-based access

Login and registration issue a signed JWT containing `userId` and `name`. Protected endpoints require `Authorization: Bearer <token>` and verify the signature and expiry using `JWT_SECRET`. Tokens default to a one-day lifetime.

Authorization is ownership-based: MongoDB queries include `createdBy`, while DynamoDB job keys are partitioned by the authenticated user ID. The Express demo account is treated as a read-only `testUser` by middleware.

There is **no general role-based access-control model**—no `admin`, `member`, permission table, or role claim. Add explicit roles and server-side permission checks before exposing administrative operations; hiding UI actions is not authorization.

### Retry/backoff for external APIs

The application does not call third-party business APIs. Serverless persistence uses AWS SDK v3, whose client applies its standard retry strategy to retryable AWS service failures. The code does not wrap requests in an additional retry loop.

If an external API is introduced, use bounded exponential backoff with jitter for timeouts, `429`, and retryable `5xx` responses; honor `Retry-After`; set timeouts; and retry writes only when the provider supports an idempotency key. Authentication and validation failures must not be retried.

### Caching and invalidation

- Dynamic `/api/*` traffic is forwarded to API Gateway with caching disabled to avoid serving one user's data to another.
- CloudFront caches the S3-hosted SPA with a one-day default TTL and compression. Deployments synchronize the new build and issue a CloudFront invalidation.
- Lambda creates the DynamoDB client at module scope so warm invocations reuse connections. This is connection reuse, not a data cache.
- There is no Redis or in-process response cache. MongoDB and DynamoDB remain the source of truth, so writes require no application-cache invalidation today.

Any future user-data cache must include the authenticated user and all query parameters in its key, use a short TTL, and invalidate that user's list, item, and stats keys after create, update, or delete operations.

## API

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| `POST` | `/auth/register` | No | Register and receive a JWT |
| `POST` | `/auth/login` | No | Log in and receive a JWT |
| `PATCH` | `/auth/updateUser` | Yes | Update the current profile |
| `GET` | `/jobs` | Yes | Search, filter, sort, and paginate owned jobs |
| `POST` | `/jobs` | Yes | Create a job |
| `GET` | `/jobs/stats` | Yes | Get status and monthly totals |
| `GET` | `/jobs/{id}` | Yes | Get an owned job |
| `PATCH` | `/jobs/{id}` | Yes | Update an owned job |
| `DELETE` | `/jobs/{id}` | Yes | Delete an owned job |

The OpenAPI 3.0 contract is in [`openapi.yaml`](openapi.yaml). With Express running, Swagger UI is at [http://localhost:5000/api-docs](http://localhost:5000/api-docs), with JSON at `/api-docs.json`. `GET /jobs` accepts `search`, `status`, `jobType`, `sort`, `page`, and `limit`.

## Run locally

### Prerequisites

- Node.js 20 or newer for the serverless project (deployed Lambda runtime: Node.js 24)
- Docker with Docker Compose
- AWS SAM CLI for local Lambda emulation
- AWS CLI credentials only when using deployed AWS resources

### Express + MongoDB (recommended)

```bash
docker compose up -d mongodb
cp .env.example .env
npm ci
npm ci --prefix client
npm run build --prefix client
npm run dev
```

On PowerShell use `Copy-Item .env.example .env` instead of `cp`. The application is served at `http://localhost:5000`; the API base is `http://localhost:5000/api/v1`.

| Variable | Required | Local value | Purpose |
|---|---:|---|---|
| `MONGO_URI` | Yes | `mongodb://localhost:27017/jobster` | MongoDB connection |
| `JWT_SECRET` | Yes | long random value | JWT signing secret |
| `JWT_LIFETIME` | Yes | `1d` | Token lifetime |
| `PORT` | No | `5000` | HTTP port |

Generate a development secret with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. `.env` is ignored; commit only `.env.example` with placeholders. Never place production credentials in source, examples, issues, logs, or workflow files.

Create sample data through the API so every record belongs to a real user:

```bash
curl -X POST http://localhost:5000/api/v1/auth/register -H "Content-Type: application/json" -d '{"name":"Ada Lovelace","email":"ada@example.test","password":"local-password","lastName":"Lovelace","location":"London"}'
```

Copy `user.token` from the response, then run:

```bash
curl -X POST http://localhost:5000/api/v1/jobs -H "Content-Type: application/json" -H "Authorization: Bearer YOUR_TOKEN" -d '{"company":"Analytical Engines Ltd","position":"Software Engineer","status":"pending","jobType":"remote","jobLocation":"Remote"}'
```

`mock-data.json` is legacy seed data tied to a fixed demo user ID. Use `node populate.js` only when that user exists and `MONGO_URI` points to a disposable database.

### Serverless API + DynamoDB Local

```bash
docker compose up -d dynamodb-local
aws dynamodb create-table --table-name Jobster --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE --billing-mode PAY_PER_REQUEST --endpoint-url http://localhost:8000 --region ap-south-1
cd serverless
npm ci
cp .env.example .env
sam build
sam local start-api --env-vars env.local.json --docker-network jobster-api_default
```

Create untracked `serverless/env.local.json` because SAM expects JSON rather than dotenv syntax:

```json
{
  "Parameters": {
    "JWT_SECRET": "replace-with-a-long-random-secret",
    "JWT_LIFETIME": "1d",
    "TABLE_NAME": "Jobster",
    "DYNAMODB_ENDPOINT": "http://dynamodb-local:8000",
    "AWS_REGION": "ap-south-1"
  }
}
```

The SAM API is at `http://127.0.0.1:3000/api/v1`. The Compose network is normally `<repository-directory>_default`; check `docker network ls` and substitute the actual name when needed. Dummy AWS credentials are sufficient for DynamoDB Local.

## Quality

### Tests and linting

```bash
cd serverless
npm ci
npm run lint
npm run test:unit
API_URL=http://127.0.0.1:3000/api/v1 npm run test:integration
```

- Unit tests cover JWT middleware and run without infrastructure.
- Integration suites cover authentication, CRUD, search/filter/pagination, statistics, and user isolation against `API_URL`. They create data, so use local or staging—not production.
- `npm run lint --prefix serverless` performs deterministic Node syntax checks; `sam validate --lint` lints the infrastructure template.
- The React production build runs Create React App's ESLint checks and fails CI on warnings with `CI=true`.

### API docs, CI, and builds

- Swagger/OpenAPI: [`openapi.yaml`](openapi.yaml) and `/api-docs` on Express.
- `.github/workflows/pr-check.yml` installs locked dependencies, runs unit tests, syntax checks, SAM linting, and the React build on pull requests.
- `.github/workflows/deploy.yml` validates, builds, deploys changes from `main`, then runs integration tests against the deployed endpoint.
- The badges at the top show current GitHub workflow status. Run the local checks before opening a pull request.

## Deployment

```bash
cd serverless
npm ci
sam validate --lint
sam build
sam deploy --guided
```

The guided deployment asks for stack name, region, environment, JWT secret, JWT lifetime, and frontend bucket suffix. Subsequent releases can use `sam deploy`. GitHub Actions currently expects `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `JWT_SECRET` repository secrets; prefer GitHub OIDC for a production repository.

Deployment: [https://d2t3sgj258ubhc.cloudfront.net/landing](https://d2t3sgj258ubhc.cloudfront.net/landing).

## Repository layout

```text
controllers/, routes/, models/, middleware/  Express/MongoDB API
client/                                      React client
serverless/src/handlers/                     Lambda handlers
serverless/src/lib/                          Shared serverless utilities
serverless/tests/unit/                       Isolated unit tests
serverless/tests/integration/                End-to-end API tests
serverless/template.yaml                     AWS SAM infrastructure
openapi.yaml                                 OpenAPI 3.0 contract
.github/workflows/                           CI/CD workflows
```

## Contributing, issues, and license

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before submitting a change. Bug and feature forms are in `.github/ISSUE_TEMPLATE/`; sanitize logs and requests before posting them.

Licensed under the [ISC License](LICENSE).
