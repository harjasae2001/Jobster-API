# Contributing

Thanks for improving Jobster. Small, focused pull requests are easiest to review.

## Development workflow

1. Fork the repository and create a branch from `main`.
2. Copy `.env.example` to `.env` and use local-only credentials. Never commit secrets.
3. Install dependencies with `npm ci`, `npm ci --prefix client`, and `npm ci --prefix serverless`.
4. Run `npm run lint --prefix serverless`, `npm run test:unit --prefix serverless`, and `npm run build --prefix client`.
5. If API behavior changes, update `openapi.yaml` and add or update tests.
6. Open a pull request describing the change, its motivation, and how it was verified.

Integration tests target a deployed API and require `API_URL`; do not point them at production unless you intend to create and delete test data.

## Style and commits

- Follow the existing CommonJS and two-space indentation style.
- Keep handlers small and shared behavior in `serverless/src/lib`.
- Use clear, imperative commit messages.
- Do not include generated SAM output, dependency directories, `.env` files, or credentials.

By contributing, you agree that your contribution is licensed under the repository's ISC license.
