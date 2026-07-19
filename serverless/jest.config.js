'use strict';

module.exports = {
  testEnvironment: 'node',

  // 30 seconds per test — generous for Lambda cold starts on first invocation
  testTimeout: 30000,

  // Only run integration tests (keeps unit tests separate if added later)
  testMatch: ['**/tests/integration/**/*.test.js'],

  // Run test FILES sequentially (--maxWorkers=1) to avoid API rate limiting.
  // Individual tests within a file still run in order by default.
  maxWorkers: 1,

  // Print each test name as it runs — useful for debugging CI failures
  verbose: true,

  // Don't stop on first failure — see the full picture before fixing
  bail: false,

  // Detect open handles (e.g. axios keep-alive connections) and force close
  forceExit: true,

  // Clear mock state between tests (good practice even if we're not mocking)
  clearMocks: true,
};
