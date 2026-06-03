import { getPerformanceSnapshot } from '../services/performanceService.js';

export async function getPerformanceMetrics(req, res) {
  try {
    const url = typeof req.query.url === 'string' ? req.query.url.trim() : '';

    if (!url) {
      return res.status(400).json({ error: 'URL query parameter is required' });
    }

    const metrics = await getPerformanceSnapshot(url);
    return res.json(metrics);
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Failed to load performance metrics',
      details: {
        code: error.code,
        name: error.name,
      },
    });
  }
}
