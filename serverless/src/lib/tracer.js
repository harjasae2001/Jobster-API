'use strict';

// ── AWS X-Ray Tracer ───────────────────────────────────────────────────────────
//
// When template.yaml sets Tracing: Active, Lambda automatically creates an X-Ray
// trace for each invocation (showing cold start vs. init vs. handler time).
//
// This module EXTENDS that automatic tracing with:
//   1. captureAWSv3Client — wraps any AWS SDK v3 client so each SDK call
//      appears as a named subsegment in the X-Ray trace timeline.
//      → "DynamoDB GetItem took 23ms" becomes visible in the service map.
//
//   2. captureAsyncFunc — manually annotates arbitrary async code sections
//      as named subsegments for custom performance breakdown.
//
// INTERVIEW NOTE — Why instrument at the client level (not per handler)?
//   The DynamoDB client is initialized once in dynamo-client.js (module scope).
//   Wrapping it there means ALL handlers that import dynamo-client.js get
//   DynamoDB X-Ray tracing automatically — zero changes per handler.
//
// INTERVIEW NOTE — Cold start detection in X-Ray:
//   Lambda's automatic trace includes an "Initialization" segment that only
//   appears on cold starts. In the X-Ray timeline, you can see exactly how
//   long the Node.js module loading + layer extraction took vs. handler execution.

let AWSXRay;

try {
  AWSXRay = require('aws-xray-sdk-core');

  // In Lambda local invocation (sam local), there's no X-Ray daemon.
  // IGNORE_ERROR prevents the SDK from throwing when the daemon is unreachable.
  if (process.env.AWS_SAM_LOCAL === 'true' || process.env.NODE_ENV === 'test') {
    AWSXRay.setContextMissingStrategy('IGNORE_ERROR');
  }
} catch {
  // aws-xray-sdk-core not installed — silently degrade (shouldn't happen in Lambda)
  AWSXRay = null;
}

const isTracingEnabled = () =>
  AWSXRay !== null &&
  process.env.AWS_SAM_LOCAL !== 'true' &&
  process.env.NODE_ENV !== 'test';

/**
 * Wraps an AWS SDK v3 client with X-Ray instrumentation.
 * Each SDK call is captured as a subsegment in the active X-Ray trace.
 *
 * If tracing is disabled (local dev, tests), returns the original client unchanged.
 *
 * @param {object} client - AWS SDK v3 client instance
 * @returns {object}      - Instrumented client (same interface)
 */
const captureAWSv3Client = (client) => {
  if (!isTracingEnabled()) return client;
  return AWSXRay.captureAWSv3Client(client);
};

/**
 * Wraps an async function as a named X-Ray subsegment.
 * Use this to measure and label specific sections of handler logic.
 *
 * Example:
 *   const result = await captureAsyncFunc('hash-password', () => bcrypt.hash(pw, 10));
 *   → Shows "hash-password: 45ms" in the X-Ray trace timeline
 *
 * @param {string}   name - Subsegment name (visible in X-Ray console)
 * @param {Function} fn   - Async function to execute and measure
 * @returns {Promise<any>}
 */
const captureAsyncFunc = async (name, fn) => {
  if (!isTracingEnabled()) return fn();

  const segment = AWSXRay.getSegment();
  if (!segment) return fn(); // No active segment (shouldn't happen in Lambda with Tracing: Active)

  const subsegment = segment.addNewSubsegment(name);
  try {
    const result = await fn();
    subsegment.close();
    return result;
  } catch (err) {
    subsegment.addError(err);
    subsegment.close();
    throw err;
  }
};

module.exports = { captureAWSv3Client, captureAsyncFunc };
