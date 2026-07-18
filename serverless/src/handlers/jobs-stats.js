const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { StatusCodes } = require('http-status-codes');
const { docClient, TABLE_NAME } = require('../lib/dynamo-client');
const { verifyToken } = require('../lib/auth-middleware');
const { success, error } = require('../lib/response');

exports.handler = async (event) => {
  try {
    const { userId } = verifyToken(event);

    // Fetch all jobs for this user (same query as getAllJobs, no filters)
    let allJobs = [];
    let lastKey;
    do {
      const resp = await docClient.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':skPrefix': 'JOB#' },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }));
      allJobs = allJobs.concat(resp.Items || []);
      lastKey = resp.LastEvaluatedKey;
    } while (lastKey);

    // 1. Status counts — replaces: Job.aggregate([{ $group: { _id: '$status', count: {$sum:1} } }])
    const statusCounts = allJobs.reduce((acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1;
      return acc;
    }, {});

    const defaultStats = {
      pending:   statusCounts.pending   || 0,
      interview: statusCounts.interview || 0,
      declined:  statusCounts.declined  || 0,
    };

    // 2. Monthly applications — replaces: $group by { year, month } → $sort → $limit 6
    const monthMap = {};
    allJobs.forEach((job) => {
      const d = new Date(job.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthMap[key] = (monthMap[key] || 0) + 1;
    });

    const monthlyApplications = Object.entries(monthMap)
      .sort(([a], [b]) => b.localeCompare(a))   // sort descending by YYYY-MM string
      .slice(0, 6)                                // last 6 months
      .reverse()                                  // oldest→newest for chart display
      .map(([key, count]) => {
        const [year, month] = key.split('-');
        const date = new Date(parseInt(year), parseInt(month) - 1)
          .toLocaleString('en-US', { month: 'short', year: 'numeric' }); // "Jul 2026"
        return { date, count };
      });

    return success(StatusCodes.OK, { defaultStats, monthlyApplications });
  } catch (err) {
    return error(err);
  }
};