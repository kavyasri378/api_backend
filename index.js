import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import mongoose from 'mongoose';
import { HistoryModel, CollectionModel, TestRunModel, EnvironmentModel, MockRouteModel } from './models.js';
import performanceRoutes from './routes/performanceRoutes.js';


dotenv.config();

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://api-frontend-owj6.vercel.app,https://api-frontend-ashen.vercel.app';
const allowedOrigins = FRONTEND_URL.split(',').map(origin => origin.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS origin denied: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json());
app.use('/api', performanceRoutes);

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/apitest')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

function isSubset(expected, actual) {
  if (expected === actual) return true;
  if (typeof expected !== 'object' || expected === null) return false;
  if (typeof actual !== 'object' || actual === null) return false;
  return Object.entries(expected).every(([key, value]) => {
    if (!(key in actual)) return false;
    return isSubset(value, actual[key]);
  });
}

function evaluateAssertions(response, assertions) {
  const hasAssertions = assertions && Object.keys(assertions).length > 0;
  if (!hasAssertions) return null;

  const results = [];

  if (assertions.status !== undefined) {
    const success = response.status === assertions.status;
    results.push({
      name: 'status',
      success,
      message: success
        ? `Status is ${assertions.status}`
        : `Expected ${assertions.status} but got ${response.status}`,
    });
  }

  if (assertions.headers && typeof assertions.headers === 'object') {
    Object.entries(assertions.headers).forEach(([key, expected]) => {
      const actual = response.headers[key.toLowerCase()];
      const success = actual !== undefined && actual === expected;
      results.push({
        name: `header:${key}`,
        success,
        message: success
          ? `Header ${key} matches expected value`
          : `Expected header ${key}=${expected} but got ${actual ?? 'missing'}`,
      });
    });
  }

  if (assertions.body && typeof assertions.body === 'object') {
    const success = isSubset(assertions.body, response.body);
    results.push({
      name: 'body',
      success,
      message: success
        ? 'Response body contains expected values'
        : 'Response body did not match expected values',
    });
  }

  if (assertions.bodyContains !== undefined) {
    const actualText = typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
    const success = actualText.includes(assertions.bodyContains);
    results.push({
      name: 'bodyContains',
      success,
      message: success
        ? `Response body contains '${assertions.bodyContains}'`
        : `Response body does not contain '${assertions.bodyContains}'`,
    });
  }

  return {
    config: assertions,
    results,
    passed: results.filter((item) => item.success).length,
    total: results.length,
  };
}

app.get('/api/sample-json', (req, res) => {
  res.json({
    message: 'Sample JSON response for API testing',
    ok: true,
    method: 'GET',
    timestamp: new Date().toISOString(),
    items: [
      { id: 1, name: 'alpha' },
      { id: 2, name: 'beta' },
      { id: 3, name: 'gamma' },
    ],
  });
});

app.post('/api/test', async (req, res) => {
  try {
    const { url, method = 'GET', headers = {}, body, auth = {}, assertions = {} } = req.body;

    if (!url) return res.status(400).json({ error: 'URL is required' });

    const normalizedMethod = method.toUpperCase();
    const parsedHeaders = typeof headers === 'string' ? JSON.parse(headers || '{}') : { ...headers };
    const hasAcceptHeader = Object.keys(parsedHeaders).some((key) => key.toLowerCase() === 'accept');
    if (!hasAcceptHeader) parsedHeaders.Accept = 'application/json';

    if (auth && auth.type) {
      if (auth.type === 'basic') {
        parsedHeaders.Authorization = `Basic ${Buffer.from(`${auth.username || ''}:${auth.password || ''}`).toString('base64')}`;
      } else if (auth.type === 'bearer') {
        parsedHeaders.Authorization = `Bearer ${auth.token || ''}`;
      } else if (auth.type === 'custom') {
        parsedHeaders.Authorization = auth.token || '';
      }
    }

    const options = { method: normalizedMethod, headers: parsedHeaders };
    if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(normalizedMethod)) {
      options.body = body;
    }

    const start = performance.now();
    const response = await fetch(url, options);
    const rawText = await response.text();
    const responseTime = Math.round(performance.now() - start);

    let parsedBody = rawText;
    try { parsedBody = JSON.parse(rawText); } catch { /* not JSON */ }

    const responseHeaders = {};
    response.headers.forEach((value, key) => { responseHeaders[key] = value; });

    const testResult = {
      url,
      method: normalizedMethod,
      timestamp: new Date().toISOString(),
      request: { url, method: normalizedMethod, headers: parsedHeaders, body, auth, assertions },
      response: { status: response.status, statusText: response.statusText, headers: responseHeaders, body: parsedBody },
      assertions: evaluateAssertions(
        { status: response.status, headers: responseHeaders, body: parsedBody },
        typeof assertions === 'string' ? JSON.parse(assertions || '{}') : assertions,
      ),
      responseTime,
    };

    const record = await HistoryModel.create(testResult);
    res.json(record);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Request failed', details: { code: error.code, name: error.name } });
  }
});

app.get('/api/history', async (req, res) => {
  const items = await HistoryModel.find().sort({ timestamp: -1 }).limit(50);
  res.json(items);
});

app.delete('/api/history', async (req, res) => {
  await HistoryModel.deleteMany({});
  res.json({ success: true });
});

app.get('/api/collections', async (req, res) => {
  res.json(await CollectionModel.find().sort({ createdAt: -1 }));
});

app.post('/api/collections', async (req, res) => {
  try {
    const col = await CollectionModel.create(req.body);
    res.json(col);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/collections/:id/requests', async (req, res) => {
  try {
    const col = await CollectionModel.findById(req.params.id);
    if (!col) return res.status(404).json({ error: 'Not found' });
    col.requests.push(req.body);
    await col.save();
    res.json(col);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/collections/:id', async (req, res) => {
  try {
    await CollectionModel.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/collections/:id/run', async (req, res) => {
  try {
    const col = await CollectionModel.findById(req.params.id);
    if (!col) return res.status(404).json({ error: 'Collection not found' });

    const runStart = performance.now();
    const results = [];

    for (const reqItem of col.requests) {
      const { url, method = 'GET', headers = {}, body, auth = {}, assertions = {} } = reqItem.request || {};
      if (!url) { results.push({ name: reqItem.name, error: 'No URL defined' }); continue; }

      const parsedHeaders = { Accept: 'application/json', ...headers };
      if (auth.type === 'basic') {
        parsedHeaders.Authorization = `Basic ${Buffer.from(`${auth.username || ''}:${auth.password || ''}`).toString('base64')}`;
      } else if (auth.type === 'bearer') {
        parsedHeaders.Authorization = `Bearer ${auth.token || ''}`;
      } else if (auth.type === 'custom') {
        parsedHeaders.Authorization = auth.token || '';
      }

      try {
        const fetchOptions = { method: method.toUpperCase(), headers: parsedHeaders };
        if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) {
          fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
        }
        const start = performance.now();
        const response = await fetch(url, fetchOptions);
        const responseTime = Math.round(performance.now() - start);
        const rawText = await response.text();
        let parsedBody = rawText;
        try { parsedBody = JSON.parse(rawText); } catch { /* not JSON */ }

        const responseHeaders = {};
        response.headers.forEach((value, key) => { responseHeaders[key] = value; });

        const assertionResult = evaluateAssertions(
          { status: response.status, headers: responseHeaders, body: parsedBody },
          typeof assertions === 'string' ? JSON.parse(assertions || '{}') : assertions
        );

        results.push({
          name: reqItem.name,
          url,
          method: method.toUpperCase(),
          status: response.status,
          responseTime,
          passed: assertionResult?.passed ?? 0,
          total: assertionResult?.total ?? 0,
          assertionResults: assertionResult?.results ?? [],
        });
      } catch (err) {
        results.push({ name: reqItem.name, url, method: method.toUpperCase(), error: err.message });
      }
    }

    const totalTime = Math.round(performance.now() - runStart);
    const passedRequests = results.filter(r => !r.error && (r.total === 0 || r.passed === r.total)).length;

    const testRun = await TestRunModel.create({
      collectionId: col._id,
      collectionName: col.name,
      results,
      totalRequests: results.length,
      passedRequests,
      totalTime,
    });

    res.json(testRun);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/environments', async (req, res) => {
  res.json(await EnvironmentModel.find().sort({ createdAt: -1 }));
});

app.post('/api/environments', async (req, res) => {
  try {
    const env = await EnvironmentModel.create(req.body);
    res.json(env);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/api/environments/:id', async (req, res) => {
  try {
    const env = await EnvironmentModel.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(env);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/environments/:id', async (req, res) => {
  await EnvironmentModel.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

app.post('/api/loadtest', async (req, res) => {
  try {
    const { url, method = 'GET', headers = {}, body, auth = {}, virtualUsers = 10, duration = 10 } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const parsedHeaders = { Accept: 'application/json', ...headers };
    if (auth.type === 'basic') {
      parsedHeaders.Authorization = `Basic ${Buffer.from(`${auth.username || ''}:${auth.password || ''}`).toString('base64')}`;
    } else if (auth.type === 'bearer') {
      parsedHeaders.Authorization = `Bearer ${auth.token || ''}`;
    } else if (auth.type === 'custom') {
      parsedHeaders.Authorization = auth.token || '';
    }

    const fetchOptions = { method: method.toUpperCase(), headers: parsedHeaders };
    if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const durationMs = Math.min(duration, 60) * 1000;
    const users = Math.min(virtualUsers, 50);
    const results = [];
    const startTime = Date.now();

    const runUser = async () => {
      while (Date.now() - startTime < durationMs) {
        const t0 = performance.now();
        try {
          const r = await fetch(url, fetchOptions);
          const responseTime = Math.round(performance.now() - t0);
          results.push({ responseTime, status: r.status, success: r.status < 400 });
        } catch {
          results.push({ responseTime: Math.round(performance.now() - t0), status: 0, success: false });
        }
      }
    };

    await Promise.all(Array.from({ length: users }, runUser));

    const responseTimes = results.map(r => r.responseTime).sort((a, b) => a - b);
    const totalRequests = results.length;
    const successCount = results.filter(r => r.success).length;
    const avg = Math.round(responseTimes.reduce((s, v) => s + v, 0) / totalRequests);
    const p95 = responseTimes[Math.floor(totalRequests * 0.95)] ?? 0;
    const p99 = responseTimes[Math.floor(totalRequests * 0.99)] ?? 0;
    const throughput = parseFloat((totalRequests / Math.min(duration, 60)).toFixed(2));

    // bucket response times into 10 intervals for chart
    const bucketCount = 10;
    const min = responseTimes[0];
    const max = responseTimes[responseTimes.length - 1];
    const bucketSize = Math.max(1, Math.ceil((max - min) / bucketCount));
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({
      label: `${min + i * bucketSize}ms`,
      count: 0,
    }));
    responseTimes.forEach(rt => {
      const idx = Math.min(Math.floor((rt - min) / bucketSize), bucketCount - 1);
      buckets[idx].count++;
    });

    res.json({
      totalRequests,
      successCount,
      errorCount: totalRequests - successCount,
      errorRate: parseFloat(((totalRequests - successCount) / totalRequests * 100).toFixed(1)),
      avg,
      min: responseTimes[0],
      max: responseTimes[responseTimes.length - 1],
      p95,
      p99,
      throughput,
      buckets,
      virtualUsers: users,
      duration: Math.min(duration, 60),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mock Server routes
app.get('/api/mocks', async (req, res) => {
  res.json(await MockRouteModel.find().sort({ createdAt: -1 }));
});

app.post('/api/mocks', async (req, res) => {
  try {
    const mock = await MockRouteModel.create(req.body);
    res.json(mock);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/api/mocks/:id', async (req, res) => {
  try {
    const mock = await MockRouteModel.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(mock);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/mocks/:id', async (req, res) => {
  await MockRouteModel.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// Dynamic mock handler — matches any /mock/* request
app.all('/mock/*', async (req, res) => {
  const mockPath = '/' + req.params[0];
  const mock = await MockRouteModel.findOne({ method: req.method.toUpperCase(), path: mockPath, enabled: true });
  if (!mock) return res.status(404).json({ error: `No mock found for ${req.method} ${mockPath}` });
  const headers = Object.fromEntries(mock.responseHeaders || new Map([['Content-Type', 'application/json']]));
  res.set(headers).status(mock.statusCode);
  try { res.json(JSON.parse(mock.responseBody)); } catch { res.send(mock.responseBody); }
});

// Security testing endpoint
app.post('/api/securitytest', async (req, res) => {
  try {
    const { url, method = 'GET', headers = {} } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const parsedHeaders = { Accept: 'application/json', ...headers };
    const sqlPayloads = ["' OR '1'='1", "'; DROP TABLE users;--", "1' OR 1=1--", "admin'--"];
    const xssPayloads = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', 'javascript:alert(1)'];
    const authBypassPayloads = ['', 'null', 'undefined', 'true', '0'];

    const results = [];

    const testPayload = async (category, payload, targetUrl) => {
      try {
        const start = performance.now();
        const r = await fetch(targetUrl, { method: method.toUpperCase(), headers: parsedHeaders });
        const responseTime = Math.round(performance.now() - start);
        const text = await r.text();
        const suspicious = r.status === 200 && (text.includes('error') || text.includes('syntax') || text.includes('SQL') || text.includes('mysql') || text.includes('ORA-'));
        results.push({ category, payload, status: r.status, responseTime, suspicious, note: suspicious ? 'Possible vulnerability detected' : 'No obvious vulnerability' });
      } catch (err) {
        results.push({ category, payload, status: null, responseTime: null, suspicious: false, note: err.message });
      }
    };

    const baseUrl = new URL(url);

    for (const p of sqlPayloads) {
      const testUrl = new URL(url);
      testUrl.searchParams.set('id', p);
      await testPayload('SQL Injection', p, testUrl.toString());
    }
    for (const p of xssPayloads) {
      const testUrl = new URL(url);
      testUrl.searchParams.set('q', p);
      await testPayload('XSS', p, testUrl.toString());
    }
    for (const p of authBypassPayloads) {
      const testUrl = new URL(url);
      testUrl.searchParams.set('token', p);
      await testPayload('Auth Bypass', p, testUrl.toString());
    }

    const suspicious = results.filter(r => r.suspicious).length;
    res.json({ totalTests: results.length, suspicious, safe: results.length - suspicious, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ramp-up load test endpoint
app.post('/api/loadtest/rampup', async (req, res) => {
  try {
    const { url, method = 'GET', headers = {}, body, auth = {}, maxUsers = 20, stepUsers = 5, stepDuration = 5 } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const parsedHeaders = { Accept: 'application/json', ...headers };
    if (auth.type === 'basic') parsedHeaders.Authorization = `Basic ${Buffer.from(`${auth.username||''}:${auth.password||''}`).toString('base64')}`;
    else if (auth.type === 'bearer') parsedHeaders.Authorization = `Bearer ${auth.token||''}`;
    else if (auth.type === 'custom') parsedHeaders.Authorization = auth.token||'';

    const fetchOptions = { method: method.toUpperCase(), headers: parsedHeaders };
    if (body && ['POST','PUT','PATCH','DELETE'].includes(method.toUpperCase())) fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);

    const steps = [];
    const totalSteps = Math.ceil(Math.min(maxUsers, 50) / Math.min(stepUsers, 10));

    for (let step = 1; step <= totalSteps; step++) {
      const users = Math.min(step * stepUsers, maxUsers);
      const stepResults = [];
      const stepStart = Date.now();
      const durationMs = Math.min(stepDuration, 30) * 1000;

      const runUser = async () => {
        while (Date.now() - stepStart < durationMs) {
          const t0 = performance.now();
          try {
            const r = await fetch(url, fetchOptions);
            stepResults.push({ responseTime: Math.round(performance.now() - t0), success: r.status < 400 });
          } catch {
            stepResults.push({ responseTime: Math.round(performance.now() - t0), success: false });
          }
        }
      };
      await Promise.all(Array.from({ length: users }, runUser));

      const times = stepResults.map(r => r.responseTime).sort((a, b) => a - b);
      const avg = times.length ? Math.round(times.reduce((s, v) => s + v, 0) / times.length) : 0;
      const errorRate = times.length ? parseFloat(((stepResults.filter(r => !r.success).length / times.length) * 100).toFixed(1)) : 0;
      steps.push({ users, totalRequests: stepResults.length, avg, min: times[0] ?? 0, max: times[times.length - 1] ?? 0, errorRate });
    }
    res.json({ steps, maxUsers: Math.min(maxUsers, 50), stepUsers: Math.min(stepUsers, 10), stepDuration: Math.min(stepDuration, 30) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`API testing server listening on http://localhost:${port}`);
});
