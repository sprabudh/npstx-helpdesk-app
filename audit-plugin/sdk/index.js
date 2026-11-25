/**
 * Auditr Client SDK
 * Decoupled audit logging client for any JavaScript backend (Node.js, Express, Fastify, NestJS, Next.js, etc.)
 */

class AuditrClient {
  /**
   * @param {Object} options
   * @param {string} options.url - Base URL of the Auditr microservice (e.g. 'http://localhost:5050')
   * @param {string} [options.service] - Default service name sending events (e.g. 'billing-svc')
   * @param {string} [options.apiKey] - Optional API key for authentication
   * @param {number} [options.batchSize=20] - Max events to buffer before auto-flushing
   * @param {number} [options.flushIntervalMs=2000] - Flush interval in milliseconds
   * @param {boolean} [options.debug=false] - Enable debug logging
   * @param {Function} [options.onError] - Error handler callback
   */
  constructor(options = {}) {
    this.url = (options.url || process.env.AUDITR_URL || 'http://localhost:5050').replace(/\/+$/, '');
    this.service = options.service || process.env.AUDITR_SERVICE_NAME || 'default-service';
    this.apiKey = options.apiKey || process.env.AUDITR_API_KEY || null;
    this.batchSize = options.batchSize || 20;
    this.flushIntervalMs = options.flushIntervalMs || 2000;
    this.debug = Boolean(options.debug);
    this.onError = options.onError || ((err) => {
      if (this.debug) console.error('[auditr-client] Delivery error:', err.message);
    });

    this.queue = [];
    this.timer = null;
    this._startFlushTimer();
  }

  _startFlushTimer() {
    if (this.flushIntervalMs > 0 && typeof setInterval !== 'undefined') {
      this.timer = setInterval(() => {
        if (this.queue.length > 0) {
          this.flush().catch(this.onError);
        }
      }, this.flushIntervalMs);

      // Don't keep Node process alive just for the flush timer
      if (this.timer.unref) {
        this.timer.unref();
      }
    }
  }

  /**
   * Log an audit event (asynchronously buffered for maximum throughput)
   * @param {Object} event
   * @param {string} event.action - e.g. 'user.login', 'payment.charge', 'document.delete'
   * @param {Object} [event.actor] - { id, type, name, email, ip, userAgent }
   * @param {Object} [event.target] - { id, type, name }
   * @param {string} [event.status='SUCCESS'] - 'SUCCESS', 'FAILURE', 'ATTEMPT'
   * @param {string} [event.severity='INFO'] - 'INFO', 'WARNING', 'CRITICAL', 'AUDIT'
   * @param {Object} [event.changes] - Diff / changeset ({ before, after } or custom object)
   * @param {Object} [event.metadata] - Extra context (traceId, tags, IP, etc.)
   * @param {string} [event.service] - Override service name
   */
  log(event) {
    if (!event || !event.action) {
      throw new Error('[auditr-client] event.action is required');
    }

    const payload = {
      event_id: event.event_id || event.id || this._uuid(),
      service: event.service || this.service,
      action: event.action,
      actor: event.actor || { id: 'anonymous', type: 'user' },
      target: event.target || null,
      status: (event.status || 'SUCCESS').toUpperCase(),
      severity: (event.severity || 'INFO').toUpperCase(),
      changes: event.changes || null,
      metadata: event.metadata || null,
      timestamp: event.timestamp || new Date().toISOString(),
    };

    this.queue.push(payload);

    if (this.queue.length >= this.batchSize) {
      this.flush().catch(this.onError);
    }

    return payload.event_id;
  }

  /**
   * Log an audit event immediately without buffering (awaits HTTP response)
   */
  async logNow(event) {
    if (!event || !event.action) {
      throw new Error('[auditr-client] event.action is required');
    }

    const payload = {
      event_id: event.event_id || event.id || this._uuid(),
      service: event.service || this.service,
      action: event.action,
      actor: event.actor || { id: 'anonymous', type: 'user' },
      target: event.target || null,
      status: (event.status || 'SUCCESS').toUpperCase(),
      severity: (event.severity || 'INFO').toUpperCase(),
      changes: event.changes || null,
      metadata: event.metadata || null,
      timestamp: event.timestamp || new Date().toISOString(),
    };

    return await this._sendBatch([payload]);
  }

  /**
   * Manually flush the buffered queue
   */
  async flush() {
    if (this.queue.length === 0) return { count: 0 };
    const batch = this.queue.splice(0, this.batchSize);
    try {
      return await this._sendBatch(batch);
    } catch (err) {
      // Re-insert un-sent events to front of queue on network failure
      this.queue.unshift(...batch);
      throw err;
    }
  }

  /**
   * Internal HTTP batch sender
   */
  async _sendBatch(events) {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['X-Api-Key'] = this.apiKey;
    }

    const res = await fetch(`${this.url}/api/v1/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify(events),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Auditr service HTTP ${res.status}: ${text}`);
    }

    return await res.json();
  }

  /**
   * Changeset / Diff helper: computes what changed between two states
   */
  diff(before = {}, after = {}) {
    const changes = {
      before: {},
      after: {},
      modified: [],
      added: [],
      removed: [],
    };

    const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);

    for (const key of allKeys) {
      const bVal = before ? before[key] : undefined;
      const aVal = after ? after[key] : undefined;

      if (bVal === undefined && aVal !== undefined) {
        changes.added.push(key);
        changes.after[key] = aVal;
      } else if (bVal !== undefined && aVal === undefined) {
        changes.removed.push(key);
        changes.before[key] = bVal;
      } else if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
        changes.modified.push(key);
        changes.before[key] = bVal;
        changes.after[key] = aVal;
      }
    }

    return changes;
  }

  /**
   * Express / Connect middleware to automatically record HTTP audit logs
   */
  expressMiddleware(options = {}) {
    const skipPaths = options.skipPaths || ['/health', '/metrics', '/favicon.ico'];
    const actorExtractor = options.actorExtractor || ((req) => {
      if (req.user) {
        return {
          id: req.user.id || req.user.sub || req.user.email || 'authenticated-user',
          type: 'user',
          name: req.user.name || null,
          email: req.user.email || null,
        };
      }
      return { id: 'anonymous', type: 'anonymous' };
    });

    return (req, res, next) => {
      if (skipPaths.some(p => req.path.startsWith(p))) {
        return next();
      }

      const startTime = Date.now();
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || req.ip;
      const userAgent = req.headers['user-agent'];

      res.on('finish', () => {
        const duration = Date.now() - startTime;
        const statusCode = res.statusCode;
        const status = statusCode >= 400 ? 'FAILURE' : 'SUCCESS';
        const severity = statusCode >= 500 ? 'CRITICAL' : statusCode >= 400 ? 'WARNING' : 'INFO';

        const actor = actorExtractor(req);
        actor.ip = ip;
        actor.userAgent = userAgent;

        this.log({
          service: options.service || this.service,
          action: `http.${req.method.toLowerCase()}`,
          actor,
          target: {
            id: req.path,
            type: 'route',
            name: `${req.method} ${req.path}`,
          },
          status,
          severity,
          metadata: {
            method: req.method,
            path: req.path,
            statusCode,
            durationMs: duration,
            query: req.query,
          },
        });
      });

      next();
    };
  }

  /**
   * Helper UUID generator without third-party dependency
   */
  _uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Graceful cleanup
   */
  async close() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}

module.exports = AuditrClient;
module.exports.AuditrClient = AuditrClient;
