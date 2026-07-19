'use strict';

// ── Structured JSON Logger ─────────────────────────────────────────────────────
//
// Outputs one JSON object per log call to stdout. CloudWatch Logs picks it up
// automatically — no special configuration needed.
//
// WHY structured logs (not console.log strings)?
//   CloudWatch Logs Insights can query JSON fields directly:
//     fields @timestamp, level, message, userId
//     | filter level = "ERROR"
//     | sort @timestamp desc
//   String logs require regex parsing, which is slower and error-prone.
//
// Usage:
//   const { logger } = require('../lib/logger');
//   logger.setContext({ requestId: context.awsRequestId });
//   logger.info('User registered', { userId, email });
//   logger.error('DynamoDB failed', { error: err });

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const currentLevel = LOG_LEVELS[(process.env.LOG_LEVEL || 'INFO').toUpperCase()] ?? LOG_LEVELS.INFO;

// Mutable context — set once per invocation from Lambda context object
let _requestId = 'unset';
let _functionName = process.env.AWS_LAMBDA_FUNCTION_NAME || 'local';
let _coldStart = true; // First invocation is always a cold start

const log = (level, message, meta = {}) => {
  if (LOG_LEVELS[level] < currentLevel) return;

  // Serialize Error objects into queryable fields (stack traces as strings)
  let errorFields = {};
  if (meta.error instanceof Error) {
    errorFields = {
      errorName: meta.error.name,
      errorMessage: meta.error.message,
      errorStack: meta.error.stack,
    };
    delete meta.error; // Don't double-serialize
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    requestId: _requestId,
    functionName: _functionName,
    coldStart: _coldStart,
    ...meta,
    ...errorFields,
  };

  // Always use console.log — Lambda's CloudWatch integration captures stdout.
  // console.error goes to stderr which is a separate stream in some setups.
  console.log(JSON.stringify(entry));
};

const logger = {
  /**
   * Call at the start of each Lambda handler with the Lambda context object.
   * Sets the requestId (unique per invocation) and tracks cold starts.
   *
   * @param {object} ctx - Lambda context object ({ awsRequestId, functionName })
   */
  setContext: (ctx = {}) => {
    if (ctx.awsRequestId) _requestId = ctx.awsRequestId;
    if (ctx.functionName) _functionName = ctx.functionName;
    // After the first call, this invocation is no longer cold
    _coldStart = false;
  },

  debug: (message, meta) => log('DEBUG', message, meta),
  info:  (message, meta) => log('INFO',  message, meta),
  warn:  (message, meta) => log('WARN',  message, meta),
  error: (message, meta) => log('ERROR', message, meta),
};

module.exports = { logger };
