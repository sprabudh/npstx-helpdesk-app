const express = require('express');
const config = require('./config');
const logger = require('./logger');
const db = require('./db');

const router = express.Router();

// Optional API Key Authentication
function authenticate(req, res, next) {
  if (!config.apiKey) return next();
  const authHeader = req.headers['authorization'];
  const customHeader = req.headers['x-api-key'];
  const token = customHeader || (authHeader && authHeader.replace(/^Bearer\s+/i, ''));

  if (!token || token !== config.apiKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing API key',
    });
  }
  next();
}

/**
 * Healthcheck endpoint
 */
router.get('/health', async (req, res) => {
  try {
    const p = await db.getPool();
    await p.query('SELECT 1');
    res.json({
      status: 'UP',
      service: 'auditr',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Healthcheck failed', err);
    res.status(503).json({
      status: 'DOWN',
      error: err.message,
    });
  }
});

/**
 * Ingest single or batch audit events
 * POST /api/v1/events
 */
router.post('/api/v1/events', authenticate, async (req, res) => {
  const payload = req.body;
  if (!payload) {
    return res.status(400).json({ error: 'Payload body is required' });
  }

  const events = Array.isArray(payload) ? payload : [payload];
  if (events.length === 0) {
    return res.status(400).json({ error: 'At least one event is required' });
  }
  if (events.length > config.maxBatchSize) {
    return res.status(413).json({
      error: `Batch size exceeds limit of ${config.maxBatchSize}`,
    });
  }

  // Validate mandatory fields
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev.action) {
      return res.status(422).json({ error: `Event at index ${i} missing required 'action'` });
    }
  }

  try {
    const inserted = await db.ingestEvents(events);
    logger.info(`Ingested ${inserted.length} audit event(s) successfully.`, {
      firstId: inserted[0]?.id,
      count: inserted.length,
    });
    res.status(201).json({
      success: true,
      count: inserted.length,
      data: inserted,
    });
  } catch (err) {
    logger.error('Failed to ingest audit events', err);
    res.status(500).json({
      error: 'InternalServerError',
      message: err.message,
    });
  }
});

/**
 * Query audit events with rich filtering
 * GET /api/v1/events
 */
router.get('/api/v1/events', authenticate, async (req, res) => {
  try {
    const filters = {
      service: req.query.service,
      action: req.query.action,
      actor_id: req.query.actor_id || req.query.actor,
      target_id: req.query.target_id || req.query.target,
      status: req.query.status,
      severity: req.query.severity,
      sinceId: req.query.sinceId || req.query.since_id,
      since: req.query.since,
      limit: req.query.limit,
      order: req.query.order || 'ASC',
    };

    const events = await db.queryEvents(filters);
    res.json({
      success: true,
      count: events.length,
      data: events,
    });
  } catch (err) {
    logger.error('Failed to query events', err);
    res.status(500).json({
      error: 'QueryFailed',
      message: err.message,
    });
  }
});

/**
 * Live stream events using Server-Sent Events (SSE)
 * GET /api/v1/events/stream
 */
router.get('/api/v1/events/stream', authenticate, async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write(': connected\n\n');

  let lastSeenId = parseInt(req.query.sinceId || '0', 10);
  if (lastSeenId === 0) {
    // If not specified, get latest ID to stream only new ones
    try {
      const p = await db.getPool();
      const [rows] = await p.query('SELECT MAX(id) as maxId FROM audit_events');
      lastSeenId = rows[0]?.maxId || 0;
    } catch (e) {
      lastSeenId = 0;
    }
  }

  const pollIntervalMs = Math.max(parseInt(req.query.interval || '1000', 10), 200);

  const timer = setInterval(async () => {
    try {
      const rows = await db.queryEvents({
        sinceId: lastSeenId,
        service: req.query.service,
        severity: req.query.severity,
        limit: 50,
      });

      for (const row of rows) {
        lastSeenId = Math.max(lastSeenId, row.id);
        res.write(`data: ${JSON.stringify(row)}\n\n`);
      }
    } catch (err) {
      logger.error('SSE polling error', err);
    }
  }, pollIntervalMs);

  req.on('close', () => {
    clearInterval(timer);
  });
});

/**
 * Verify cryptographic hash integrity of the audit chain
 * GET /api/v1/audit/verify
 */
router.get('/api/v1/audit/verify', authenticate, async (req, res) => {
  try {
    const result = await db.verifyIntegrity();
    res.json({
      success: true,
      integrity: result.valid ? 'INTACT' : 'COMPROMISED',
      ...result,
    });
  } catch (err) {
    logger.error('Integrity verification failed', err);
    res.status(500).json({
      error: 'VerificationFailed',
      message: err.message,
    });
  }
});

/**
 * Statistics
 * GET /api/v1/audit/stats
 */
router.get('/api/v1/audit/stats', authenticate, async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json({
      success: true,
      stats,
    });
  } catch (err) {
    logger.error('Stats query failed', err);
    res.status(500).json({
      error: 'StatsFailed',
      message: err.message,
    });
  }
});

module.exports = router;
