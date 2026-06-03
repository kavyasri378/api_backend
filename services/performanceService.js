import { HistoryModel } from '../models.js';

const PERFORMANCE_SAMPLE_SIZE = 20;
const PERFORMANCE_TREND_SIZE = 5;

function buildHistoryQuery(url) {
  return {
    $or: [
      { url },
      { 'request.url': url },
    ],
    responseTime: { $type: 'number' },
  };
}

function calculateAverage(values) {
  if (values.length === 0) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round(total / values.length);
}

export async function getPerformanceSnapshot(url) {
  const recentExecutions = await HistoryModel.find(buildHistoryQuery(url))
    .sort({ timestamp: -1, _id: -1 })
    .limit(PERFORMANCE_SAMPLE_SIZE)
    .select({ responseTime: 1, timestamp: 1 })
    .lean();

  if (recentExecutions.length === 0) {
    return {
      current: null,
      average: null,
      min: null,
      max: null,
      lastFive: [],
    };
  }

  const responseTimes = recentExecutions.map((entry) => entry.responseTime);

  return {
    current: responseTimes[0],
    average: calculateAverage(responseTimes),
    min: Math.min(...responseTimes),
    max: Math.max(...responseTimes),
    lastFive: recentExecutions
      .slice(0, PERFORMANCE_TREND_SIZE)
      .reverse()
      .map((entry) => entry.responseTime),
  };
}
