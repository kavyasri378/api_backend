import mongoose from 'mongoose';

const authSchema = new mongoose.Schema({
  type: String,
  token: String,
  username: String,
  password: String
}, { _id: false });

const requestSchema = new mongoose.Schema({
  url: String,
  method: String,
  headers: { type: Map, of: mongoose.Schema.Types.Mixed },
  body: mongoose.Schema.Types.Mixed,
  auth: authSchema,
  assertions: mongoose.Schema.Types.Mixed
}, { _id: false });

const responseSchema = new mongoose.Schema({
  status: Number,
  statusText: String,
  headers: { type: Map, of: mongoose.Schema.Types.Mixed },
  body: mongoose.Schema.Types.Mixed
}, { _id: false });

const historySchema = new mongoose.Schema({
  url: { type: String, trim: true },
  method: { type: String, trim: true, uppercase: true },
  timestamp: { type: Date, default: Date.now },
  request: requestSchema,
  response: responseSchema,
  assertions: mongoose.Schema.Types.Mixed,
  responseTime: Number,
});

historySchema.index({ url: 1, timestamp: -1 });

const collectionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  requests: [{
    name: String,
    request: requestSchema
  }]
}, { timestamps: true });

const testRunResultSchema = new mongoose.Schema({
  name: String,
  url: String,
  method: String,
  status: Number,
  responseTime: Number,
  passed: Number,
  total: Number,
  assertionResults: mongoose.Schema.Types.Mixed,
  error: String,
}, { _id: false });

const testRunSchema = new mongoose.Schema({
  collectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Collection' },
  collectionName: String,
  results: [testRunResultSchema],
  totalRequests: Number,
  passedRequests: Number,
  totalTime: Number,
  timestamp: { type: Date, default: Date.now },
});

const environmentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  variables: [{ key: String, value: String }],
}, { timestamps: true });

const mockRouteSchema = new mongoose.Schema({
  method: { type: String, required: true, uppercase: true },
  path: { type: String, required: true },
  statusCode: { type: Number, default: 200 },
  responseBody: { type: String, default: '{}' },
  responseHeaders: { type: Map, of: String, default: { 'Content-Type': 'application/json' } },
  enabled: { type: Boolean, default: true },
}, { timestamps: true });

export const HistoryModel = mongoose.model('History', historySchema);
export const CollectionModel = mongoose.model('Collection', collectionSchema);
export const TestRunModel = mongoose.model('TestRun', testRunSchema);
export const EnvironmentModel = mongoose.model('Environment', environmentSchema);
export const MockRouteModel = mongoose.model('MockRoute', mockRouteSchema);
