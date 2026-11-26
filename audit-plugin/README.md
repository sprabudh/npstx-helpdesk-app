# Auditr

Auditr is a decoupled, containerized audit logging microservice for JavaScript backends and distributed tools.

Services send audit events to Auditr via HTTP. Auditr stores the records in MySQL, links them in a cryptographic SHA-256 hash chain, and provides a developer CLI for live log tailing and integrity verification.

---

## Features

- Decoupled REST Ingestion: Send single or batched events over standard HTTP endpoints.
- Tamper-Evident Hash Chain: Every record stores prev_hash and record_hash. Unauthorized changes or deletions break the chain.
- Non-Blocking Client Queue: Buffers events in memory and flushes in batches without blocking request handlers.
- Automated Changeset Diffs: Built-in diff helper computes field-level changes (before, after, modified).
- Express Middleware: Automatically audits routes, actors, latency, and status codes.
- Developer CLI: Polls the database or HTTP API live with colored output, filtering, and integrity verification.
- Containerized: Docker Compose boots MySQL and the Auditr microservice in one command.

---

## Architecture

```
Your Services (Auth, Billing, Express API, etc.)
                   |
                   | HTTP POST /api/v1/events
                   v
             auditr-service (Node.js microservice on port 5050)
                   |
                   | HMAC-SHA256 Hash Chaining
                   v
             MySQL Database (Port 3308 host / 3306 internal)
                   ^
                   | Direct DB or HTTP polling
             auditr-cli (Developer live tail tool)
```

---

## Quick Start

### 1. Start the Containers

```bash
docker compose up -d --build
```

Verify service status:
```bash
curl http://localhost:5050/health
```

### 2. Run the Demo

The demo runs 5 real-world scenarios across auth, documents, billing, Express middleware, and integrity verification:

```bash
npm run demo
```

### 3. Live Tail Logs (Developer CLI)

Start the live database tail:
```bash
node cli/bin/auditr.js tail
```

Additional CLI options:
```bash
# Filter by service with verbose diffs
node cli/bin/auditr.js tail --service billing-service --verbose

# Filter by severity
node cli/bin/auditr.js tail --severity CRITICAL

# Filter by action wildcard
node cli/bin/auditr.js tail --action "user.*" --interval 500

# Poll via HTTP API instead of direct DB
node cli/bin/auditr.js tail --mode api

# Cryptographically verify database hash chain integrity
node cli/bin/auditr.js verify

# View system statistics breakdown
node cli/bin/auditr.js stats
```

---

## Client Usage

Install or reference the SDK in your backend:

```javascript
const AuditrClient = require('./sdk');

const auditr = new AuditrClient({
  url: 'http://localhost:5050',
  service: 'payment-service',
  batchSize: 20,
  flushIntervalMs: 2000
});

// Asynchronous non-blocking log
auditr.log({
  action: 'payment.refund',
  actor: { id: 'usr_admin', name: 'Support Agent', email: 'agent@corp.com' },
  target: { id: 'txn_9001', type: 'transaction' },
  status: 'SUCCESS',
  severity: 'CRITICAL',
  metadata: { amount: 250.0, currency: 'USD' }
});

// Calculate and log changeset diff
const before = { status: 'pending', role: 'member' };
const after = { status: 'active', role: 'admin' };
const changes = auditr.diff(before, after);

await auditr.logNow({
  action: 'user.role.updated',
  actor: { id: 'usr_admin' },
  target: { id: 'usr_42' },
  status: 'SUCCESS',
  severity: 'AUDIT',
  changes
});
```

See [INTEGRATION.md](file:///home/rishi-raj/Desktop/audit-mgmt/INTEGRATION.md) for complete framework integration examples (Express, Fastify, NestJS, Next.js, and raw HTTP).

---

## REST API Reference

| Method | Endpoint | Description |
|---|---|---|
| GET | /health | Service healthcheck and uptime |
| POST | /api/v1/events | Ingest single or batch audit events |
| GET | /api/v1/events | Query events with filters (service, action, actor, severity, sinceId) |
| GET | /api/v1/events/stream | Server-Sent Events (SSE) live event stream |
| GET | /api/v1/audit/verify | Cryptographic hash chain integrity check |
| GET | /api/v1/audit/stats | Aggregate statistics by service, severity, and status |

---

## Configuration (.env)

| Variable | Default | Description |
|---|---|---|
| PORT | 5050 | HTTP port for Auditr microservice |
| HOST | 0.0.0.0 | Binding host address |
| LOG_LEVEL | info | Logging level (debug, info, warn, error) |
| AUDITR_API_KEY | (empty) | Optional API key requirement |
| AUDITR_HASH_SECRET | (default secret) | HMAC salt used for hash chain generation |
| DB_HOST | 127.0.0.1 | MySQL host address |
| DB_PORT | 3308 | MySQL host mapped port (3306 internal) |
| DB_USER | auditr_user | MySQL username |
| DB_PASSWORD | auditr_secret | MySQL password |
| DB_NAME | auditr_db | MySQL database name |
| AUDITR_URL | http://localhost:5050 | Service URL for SDK and CLI |
