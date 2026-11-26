const express = require('express');
const cors = require('cors');
const config = require('./config');
const logger = require('./logger');
const db = require('./db');
const routes = require('./routes');

const app = express();

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path !== '/health') {
      logger.debug(`${req.method} ${req.originalUrl} ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Mount routes
app.use('/', routes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'NotFound', message: `Route ${req.method} ${req.url} does not exist` });
});

// Error handling
app.use((err, req, res, next) => {
  logger.error('Unhandled server error', err);
  res.status(500).json({ error: 'InternalServerError', message: err.message });
});

async function start() {
  logger.info(`Starting Auditr microservice on port ${config.port}...`);
  try {
    await db.waitForDatabase();
    app.listen(config.port, config.host, () => {
      logger.info(`🚀 Auditr microservice is live and listening on http://${config.host}:${config.port}`);
      logger.info(`   - Healthcheck: http://${config.host}:${config.port}/health`);
      logger.info(`   - Ingestion:   POST http://${config.host}:${config.port}/api/v1/events`);
      logger.info(`   - Query:       GET  http://${config.host}:${config.port}/api/v1/events`);
      logger.info(`   - Live Stream: GET  http://${config.host}:${config.port}/api/v1/events/stream`);
      logger.info(`   - Verify:      GET  http://${config.host}:${config.port}/api/v1/audit/verify`);
      logger.info(`   - Stats:       GET  http://${config.host}:${config.port}/api/v1/audit/stats`);
    });
  } catch (err) {
    logger.error('Fatal initialization error. Exiting.', err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, closing database pool and shutting down...');
  try {
    const p = await db.getPool();
    await p.end();
  } catch (_) {}
  process.exit(0);
});

start();
