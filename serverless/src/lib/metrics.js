'use strict';

// ── CloudWatch Embedded Metrics Format (EMF) ───────────────────────────────────
//
// EMF lets Lambda emit custom CloudWatch metrics with ZERO extra API calls.
// The Lambda CloudWatch Logs agent detects the _aws key in stdout JSON and
// automatically parses it into CloudWatch custom metrics.
//
// WHY EMF over PutMetricData SDK call?
//   - No extra AWS API call (PutMetricData costs ~$0.01/1000 calls)
//   - No extra latency added to the handler response
//   - Metrics are batched per invocation automatically
//   - Works in Lambda's execution model without IAM changes
//
// Docs: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html
//
// Usage:
//   const { createMetrics } = require('../lib/metrics');
//   const metrics = createMetrics();
//   metrics.record('JobsCreated', 1);
//   metrics.record('HandlerDuration', durationMs, 'Milliseconds');
//   metrics.flush(); // Call once at the END of each handler

const NAMESPACE = 'Jobster/API';

class MetricsEmitter {
  constructor() {
    this._metrics = {};      // name → { values: [], unit }
    this._dimensions = {
      Environment: process.env.ENVIRONMENT || 'production',
      FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME || 'local',
    };
  }

  /**
   * Record a metric value. Can be called multiple times for the same metric
   * within one invocation — EMF will emit an array of values.
   *
   * @param {string} name  - Metric name (appears in CloudWatch namespace Jobster/API)
   * @param {number} value - Metric value
   * @param {string} unit  - CloudWatch unit: 'Count', 'Milliseconds', 'Bytes', 'Percent', etc.
   */
  record(name, value, unit = 'Count') {
    if (!this._metrics[name]) {
      this._metrics[name] = { values: [], unit };
    }
    this._metrics[name].values.push(value);
    return this; // Chainable: metrics.record('A', 1).record('B', 2)
  }

  /**
   * Emit all recorded metrics as a single EMF JSON line to stdout.
   * Call this ONCE at the end of each Lambda handler.
   * After flush, the internal state is reset — safe to reuse the instance.
   */
  flush() {
    if (Object.keys(this._metrics).length === 0) return;

    const metricDefinitions = Object.entries(this._metrics).map(([name, { unit }]) => ({
      Name: name,
      Unit: unit,
    }));

    const metricValues = {};
    Object.entries(this._metrics).forEach(([name, { values }]) => {
      // Single value → scalar; multiple values → array (EMF supports both)
      metricValues[name] = values.length === 1 ? values[0] : values;
    });

    // The _aws key is what CloudWatch Logs agent looks for
    const emfPayload = {
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: NAMESPACE,
            Dimensions: [Object.keys(this._dimensions)],
            Metrics: metricDefinitions,
          },
        ],
      },
      ...this._dimensions,
      ...metricValues,
    };

    console.log(JSON.stringify(emfPayload));
    this._metrics = {}; // Reset — ready for next flush
  }
}

/**
 * Factory function — create a fresh MetricsEmitter per handler invocation.
 * This ensures metrics from one invocation don't leak into the next.
 */
const createMetrics = () => new MetricsEmitter();

module.exports = { createMetrics };
