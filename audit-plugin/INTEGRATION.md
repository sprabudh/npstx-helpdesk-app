# Integration Guide for Auditr

Auditr is a standalone microservice that collects, stores, and validates audit logs sent from any backend service over HTTP.

This guide explains how to connect your JavaScript or TypeScript backends to Auditr.

---

## 1. Connection Overview

Auditr runs independently and listens for HTTP requests. Your application backends send events to the `/api/v1/events` endpoint.

Base configuration required by client applications:
- Service URL: The base URL of Auditr (for example, `http://localhost:5050` or `http://auditr-service:5050`)
- Service Name: An identifier for your backend (for example, `auth-api`, `billing-service`)
- API Key (optional): If authentication is enabled, pass via `X-Api-Key` header

---

## 2. Installing the Client

You can either copy the `sdk/` directory into your project as a shared module or reference it locally:

```json
{
  "dependencies": {
    "auditr-client": "file:../path-to-auditr/sdk"
  }
}
```

Or import the file directly in vanilla Node.js:
```javascript
const AuditrClient = require('./sdk/index.js');
```

---

## 3. Initializing the Client

```javascript
const AuditrClient = require('auditr-client');

const auditr = new AuditrClient({
  url: process.env.AUDITR_URL || 'http://localhost:5050',
  service: 'auth-service',
  apiKey: process.env.AUDITR_API_KEY || null,
  batchSize: 20,          // Maximum events buffered in memory before sending
  flushIntervalMs: 2000,  // Periodic flush interval
  debug: false
});
```

Methods available:
- `auditr.log(event)`: Buffers event in an in-memory queue and flushes asynchronously. Non-blocking.
- `await auditr.logNow(event)`: Sends the event immediately and waits for HTTP confirmation.
- `await auditr.flush()`: Manually flushes all currently buffered events.
- `auditr.diff(before, after)`: Calculates field-level modifications between two objects.
- `auditr.expressMiddleware(options)`: Connect/Express middleware for automatic request tracking.
- `await auditr.close()`: Flushes queue and clears timers during application shutdown.

---

## 4. Standard Event Payload Schema

Every audit event accepts the following structure:

```typescript
interface AuditEvent {
  action: string;             // Required: dot-notation action (e.g. "user.login", "order.refund")
  service?: string;           // Optional: overrides default client service name
  actor?: {
    id: string;               // User ID, service account, or "anonymous"
    type?: string;            // "user", "service", "admin", "cron"
    name?: string;            // Display name
    email?: string;           // Email address
    ip?: string;              // Client IP address
    userAgent?: string;       // Client User-Agent header
  };
  target?: {
    id: string;               // Target resource ID (e.g. document ID, user ID)
    type?: string;            // Target type (e.g. "document", "invoice", "user")
    name?: string;            // Target descriptive name
  };
  status?: "SUCCESS" | "FAILURE" | "ATTEMPT";  // Default: "SUCCESS"
  severity?: "INFO" | "WARNING" | "CRITICAL" | "AUDIT"; // Default: "INFO"
  changes?: {                 // Before/after states or changeset diff
    before?: Record<string, any>;
    after?: Record<string, any>;
    modified?: string[];
  };
  metadata?: Record<string, any>; // Arbitrary key-value metadata
  timestamp?: string | Date;  // Optional ISO string; defaults to current time
}
```

---

## 5. Framework Integration Examples

### Express.js

```javascript
const express = require('express');
const AuditrClient = require('auditr-client');

const app = express();
app.use(express.json());

const auditr = new AuditrClient({
  url: process.env.AUDITR_URL || 'http://localhost:5050',
  service: 'api-gateway'
});

// 1. Automatic HTTP request audit logging
app.use(auditr.expressMiddleware({
  skipPaths: ['/health', '/metrics'],
  actorExtractor: (req) => {
    if (req.user) {
      return { id: req.user.id, name: req.user.name, email: req.user.email };
    }
    return { id: 'anonymous', type: 'anonymous' };
  }
}));

// 2. Manual action auditing inside route handlers
app.post('/api/users/:id/deactivate', async (req, res) => {
  const targetUserId = req.params.id;

  // Perform business logic...

  auditr.log({
    action: 'user.deactivated',
    actor: { id: req.user.id, name: req.user.name },
    target: { id: targetUserId, type: 'user' },
    status: 'SUCCESS',
    severity: 'AUDIT',
    metadata: { reason: req.body.reason }
  });

  res.json({ success: true });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await auditr.close();
  process.exit(0);
});
```

---

### Fastify

```javascript
const Fastify = require('fastify');
const AuditrClient = require('auditr-client');

const fastify = Fastify({ logger: true });
const auditr = new AuditrClient({
  url: 'http://localhost:5050',
  service: 'order-service'
});

// Fastify hook for tracking completed requests
fastify.addHook('onResponse', async (request, reply) => {
  if (request.url.startsWith('/health')) return;

  auditr.log({
    action: `http.${request.method.toLowerCase()}`,
    actor: {
      id: request.user?.id || 'anonymous',
      ip: request.ip
    },
    target: {
      id: request.url,
      type: 'endpoint'
    },
    status: reply.statusCode < 400 ? 'SUCCESS' : 'FAILURE',
    severity: reply.statusCode >= 500 ? 'CRITICAL' : 'INFO',
    metadata: {
      statusCode: reply.statusCode,
      responseTimeMs: reply.elapsedTime
    }
  });
});
```

---

### NestJS

Create an injectable audit service:

```typescript
// audit.service.ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import AuditrClient, { AuditEventInput } from 'auditr-client';

@Injectable()
export class AuditService implements OnModuleDestroy {
  private client: AuditrClient;

  constructor() {
    this.client = new AuditrClient({
      url: process.env.AUDITR_URL || 'http://localhost:5050',
      service: 'nest-backend'
    });
  }

  log(event: AuditEventInput) {
    return this.client.log(event);
  }

  async logNow(event: AuditEventInput) {
    return await this.client.logNow(event);
  }

  diff(before: any, after: any) {
    return this.client.diff(before, after);
  }

  async onModuleDestroy() {
    await this.client.close();
  }
}
```

---

### Next.js (Server Actions & Route Handlers)

```typescript
// app/actions/update-profile.ts
'use server';

import AuditrClient from 'auditr-client';

const auditr = new AuditrClient({
  url: process.env.AUDITR_URL || 'http://localhost:5050',
  service: 'web-portal'
});

export async function updateProfile(userId: string, formData: FormData) {
  const previousData = await getUserFromDb(userId);
  const updatedData = {
    displayName: formData.get('displayName') as string,
    role: formData.get('role') as string,
  };

  const changes = auditr.diff(previousData, updatedData);

  await updateUserInDb(userId, updatedData);

  // Use logNow in server actions to ensure logs dispatch before serverless exit
  await auditr.logNow({
    action: 'profile.updated',
    actor: { id: userId },
    target: { id: userId, type: 'user' },
    status: 'SUCCESS',
    severity: 'INFO',
    changes
  });

  return { success: true };
}
```

---

## 6. Raw HTTP Integration (Without SDK)

If your service does not use the JavaScript SDK, you can send standard HTTP POST requests from Python, Go, Java, or raw `fetch`:

```bash
curl -X POST http://localhost:5050/api/v1/events \
  -H "Content-Type: application/json" \
  -d '{
    "service": "billing-service",
    "action": "subscription.cancelled",
    "actor": {
      "id": "usr_9921",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "ip": "203.0.113.10"
    },
    "target": {
      "id": "sub_441",
      "type": "subscription"
    },
    "status": "SUCCESS",
    "severity": "WARNING",
    "metadata": {
      "reason": "Customer request"
    }
  }'
```

Batch payload format:
```json
[
  { "action": "user.login", "actor": { "id": "user_1" } },
  { "action": "file.download", "actor": { "id": "user_1" } }
]
```

---

## 7. Best Practices

1. Asynchronous Logging: For standard events, use `auditr.log()` instead of `auditr.logNow()` to avoid adding latency to critical user paths.
2. Serverless Environments: In AWS Lambda, Cloud Run, or Vercel Serverless Functions, invoke `await auditr.flush()` or `await auditr.logNow()` before the function returns to avoid execution freeze.
3. Sensitive Data: Avoid putting plain text passwords, credit card numbers, or full tokens into the `metadata` or `changes` fields. Hash or redact secrets before sending.
4. Error Handling: Auditr client includes safe failure defaults; delivery errors trigger `onError` without crashing the parent application.
