const crypto = require('crypto');
const config = require('./config');

const GENESIS_PREV_HASH = '0'.repeat(64);

/**
 * Deterministically stringify an object with sorted keys
 */
function canonicalStringify(obj) {
  if (obj === null || obj === undefined) return '';
  if (typeof obj !== 'object') return String(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`).join(',') + '}';
}

/**
 * Computes record_hash for an audit event
 */
function computeRecordHash(event, prevHash, secret = config.hashSecret) {
  const parts = [
    prevHash || GENESIS_PREV_HASH,
    event.event_id || '',
    event.service || '',
    event.action || '',
    event.actor_id || '',
    event.actor_type || '',
    event.target_id || '',
    event.target_type || '',
    event.status || 'SUCCESS',
    event.severity || 'INFO',
    canonicalStringify(event.changes),
    canonicalStringify(event.metadata),
    new Date(event.timestamp || Date.now()).toISOString(),
  ];

  const payload = parts.join('|');
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

module.exports = {
  GENESIS_PREV_HASH,
  computeRecordHash,
  canonicalStringify,
};
