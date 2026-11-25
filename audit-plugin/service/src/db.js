const mysql = require('mysql2/promise');
const config = require('./config');
const logger = require('./logger');
const { computeRecordHash, GENESIS_PREV_HASH } = require('./integrity');
const crypto = require('crypto');

let pool = null;

async function getPool() {
  if (!pool) {
    pool = mysql.createPool(config.db);
  }
  return pool;
}

/**
 * Wait for database connection with retries (essential for Docker startup)
 */
async function waitForDatabase(maxRetries = 30, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const p = await getPool();
      const [rows] = await p.query('SELECT 1 as alive');
      logger.info('Database connection established successfully.', {
        host: config.db.host,
        port: config.db.port,
        database: config.db.database,
      });
      await initSchema(p);
      return true;
    } catch (err) {
      logger.warn(`Waiting for database (attempt ${attempt}/${maxRetries}): ${err.message}`);
      if (attempt === maxRetries) {
        logger.error('Failed to connect to database after max retries', err);
        throw err;
      }
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

/**
 * Initialize schema if not exists
 */
async function initSchema(p) {
  const ddl = `
    CREATE TABLE IF NOT EXISTS audit_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      event_id VARCHAR(64) NOT NULL UNIQUE,
      service VARCHAR(100) NOT NULL,
      action VARCHAR(120) NOT NULL,
      actor_id VARCHAR(128) NOT NULL,
      actor_type VARCHAR(50) DEFAULT 'user',
      actor_name VARCHAR(150) NULL,
      actor_email VARCHAR(150) NULL,
      actor_ip VARCHAR(45) NULL,
      actor_user_agent TEXT NULL,
      target_id VARCHAR(128) NULL,
      target_type VARCHAR(64) NULL,
      target_name VARCHAR(150) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
      severity VARCHAR(20) NOT NULL DEFAULT 'INFO',
      changes JSON NULL,
      metadata JSON NULL,
      timestamp DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      prev_hash VARCHAR(64) NULL,
      record_hash VARCHAR(64) NOT NULL,
      INDEX idx_service (service),
      INDEX idx_action (action),
      INDEX idx_actor_id (actor_id),
      INDEX idx_target_id (target_id),
      INDEX idx_status (status),
      INDEX idx_severity (severity),
      INDEX idx_created_at (created_at),
      INDEX idx_service_created (service, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
  await p.query(ddl);
  logger.debug('Schema verification / initialization completed.');
}

/**
 * Ingest one or more audit events with tamper-evident hash chaining inside a transaction
 */
async function ingestEvents(events) {
  if (!Array.isArray(events)) {
    events = [events];
  }
  if (events.length === 0) return [];

  const p = await getPool();
  const conn = await p.getConnection();

  try {
    await conn.beginTransaction();

    // Lock latest record for consistent hash chain
    const [latestRows] = await conn.query(
      'SELECT id, record_hash FROM audit_events ORDER BY id DESC LIMIT 1 FOR UPDATE'
    );
    let lastHash = latestRows.length > 0 ? latestRows[0].record_hash : GENESIS_PREV_HASH;

    const insertedEvents = [];

    for (const raw of events) {
      const event_id = raw.event_id || raw.id || crypto.randomUUID();
      const service = (raw.service || 'default').trim();
      const action = (raw.action || 'unknown.action').trim();
      const actor_id = String(raw.actor?.id || raw.actor_id || 'anonymous').trim();
      const actor_type = raw.actor?.type || raw.actor_type || 'user';
      const actor_name = raw.actor?.name || raw.actor_name || null;
      const actor_email = raw.actor?.email || raw.actor_email || null;
      const actor_ip = raw.actor?.ip || raw.actor_ip || raw.ip || null;
      const actor_user_agent = raw.actor?.userAgent || raw.actor_user_agent || raw.userAgent || null;
      const target_id = raw.target?.id || raw.target_id || null;
      const target_type = raw.target?.type || raw.target_type || null;
      const target_name = raw.target?.name || raw.target_name || null;
      const status = (raw.status || 'SUCCESS').toUpperCase();
      const severity = (raw.severity || 'INFO').toUpperCase();
      const changes = raw.changes ? JSON.stringify(raw.changes) : null;
      const metadata = raw.metadata ? JSON.stringify(raw.metadata) : null;
      const ts = raw.timestamp ? new Date(raw.timestamp) : new Date();

      const normalizedEvent = {
        event_id,
        service,
        action,
        actor_id,
        actor_type,
        actor_name,
        actor_email,
        actor_ip,
        actor_user_agent,
        target_id,
        target_type,
        target_name,
        status,
        severity,
        changes: raw.changes || null,
        metadata: raw.metadata || null,
        timestamp: ts,
      };

      const record_hash = computeRecordHash(normalizedEvent, lastHash);
      const prev_hash = lastHash;
      lastHash = record_hash;

      const [res] = await conn.query(
        `INSERT INTO audit_events (
          event_id, service, action, actor_id, actor_type, actor_name, actor_email,
          actor_ip, actor_user_agent, target_id, target_type, target_name,
          status, severity, changes, metadata, timestamp, prev_hash, record_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event_id,
          service,
          action,
          actor_id,
          actor_type,
          actor_name,
          actor_email,
          actor_ip,
          actor_user_agent,
          target_id,
          target_type,
          target_name,
          status,
          severity,
          changes,
          metadata,
          ts,
          prev_hash,
          record_hash,
        ]
      );

      insertedEvents.push({
        id: res.insertId,
        event_id,
        service,
        action,
        actor_id,
        target_id,
        status,
        severity,
        timestamp: ts.toISOString(),
        record_hash,
      });
    }

    await conn.commit();
    return insertedEvents;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Query audit events with rich filters & cursor support
 */
async function queryEvents(filters = {}) {
  const p = await getPool();
  const conditions = [];
  const params = [];

  if (filters.service) {
    conditions.push('service = ?');
    params.push(filters.service);
  }
  if (filters.action) {
    if (filters.action.includes('*') || filters.action.includes('%')) {
      conditions.push('action LIKE ?');
      params.push(filters.action.replace(/\*/g, '%'));
    } else {
      conditions.push('action = ?');
      params.push(filters.action);
    }
  }
  if (filters.actor_id) {
    conditions.push('actor_id = ?');
    params.push(filters.actor_id);
  }
  if (filters.target_id) {
    conditions.push('target_id = ?');
    params.push(filters.target_id);
  }
  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status.toUpperCase());
  }
  if (filters.severity) {
    conditions.push('severity = ?');
    params.push(filters.severity.toUpperCase());
  }
  if (filters.sinceId) {
    conditions.push('id > ?');
    params.push(parseInt(filters.sinceId, 10));
  }
  if (filters.since) {
    conditions.push('created_at > ?');
    params.push(new Date(filters.since));
  }

  let sql = 'SELECT * FROM audit_events';
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  const order = (filters.order || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  sql += ` ORDER BY id ${order}`;

  const limit = Math.min(parseInt(filters.limit || '100', 10), 1000);
  sql += ' LIMIT ?';
  params.push(limit);

  const [rows] = await p.query(sql, params);
  return rows;
}

/**
 * Verify cryptographic hash integrity across the entire database
 */
async function verifyIntegrity() {
  const p = await getPool();
  const [rows] = await p.query('SELECT * FROM audit_events ORDER BY id ASC');

  let expectedPrevHash = GENESIS_PREV_HASH;
  let verifiedCount = 0;
  const violations = [];

  for (const row of rows) {
    // 1. Check prev_hash pointer
    if (row.prev_hash !== expectedPrevHash) {
      violations.push({
        id: row.id,
        event_id: row.event_id,
        reason: 'Broken hash chain pointer',
        expected_prev_hash: expectedPrevHash,
        actual_prev_hash: row.prev_hash,
      });
      break;
    }

    // 2. Recompute hash of this record
    const normalized = {
      event_id: row.event_id,
      service: row.service,
      action: row.action,
      actor_id: row.actor_id,
      actor_type: row.actor_type,
      target_id: row.target_id,
      target_type: row.target_type,
      status: row.status,
      severity: row.severity,
      changes: typeof row.changes === 'string' ? JSON.parse(row.changes) : row.changes,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      timestamp: row.timestamp,
    };

    const recomputed = computeRecordHash(normalized, row.prev_hash);
    if (recomputed !== row.record_hash) {
      violations.push({
        id: row.id,
        event_id: row.event_id,
        reason: 'Tampered record content (hash mismatch)',
        stored_hash: row.record_hash,
        recomputed_hash: recomputed,
      });
      break;
    }

    expectedPrevHash = row.record_hash;
    verifiedCount++;
  }

  return {
    valid: violations.length === 0,
    totalRecords: rows.length,
    verifiedCount,
    lastHash: expectedPrevHash,
    violations,
  };
}

/**
 * Fetch statistics
 */
async function getStats() {
  const p = await getPool();
  const [totalRows] = await p.query('SELECT COUNT(*) as total FROM audit_events');
  const [byService] = await p.query('SELECT service, COUNT(*) as count FROM audit_events GROUP BY service');
  const [bySeverity] = await p.query('SELECT severity, COUNT(*) as count FROM audit_events GROUP BY severity');
  const [byStatus] = await p.query('SELECT status, COUNT(*) as count FROM audit_events GROUP BY status');
  const [latestRows] = await p.query('SELECT id, event_id, action, service, created_at FROM audit_events ORDER BY id DESC LIMIT 5');

  return {
    totalEvents: totalRows[0]?.total || 0,
    byService: Object.fromEntries(byService.map(r => [r.service, r.count])),
    bySeverity: Object.fromEntries(bySeverity.map(r => [r.severity, r.count])),
    byStatus: Object.fromEntries(byStatus.map(r => [r.status, r.count])),
    latestEvents: latestRows,
  };
}

module.exports = {
  getPool,
  waitForDatabase,
  ingestEvents,
  queryEvents,
  verifyIntegrity,
  getStats,
};
