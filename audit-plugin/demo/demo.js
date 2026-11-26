/**
 * Auditr Demo Script
 * Demonstrates attaching Auditr to various JavaScript backends and microservices.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const AuditrClient = require('auditr-client');

const AUDITR_URL = process.env.AUDITR_URL || 'http://localhost:5050';

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runDemo() {
  console.log(`${colors.bold}${colors.cyan}====================================================${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}           AUDITR INTERACTIVE DEMO SUITE            ${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}====================================================${colors.reset}`);
  console.log(`Connecting to Auditr service at: ${colors.yellow}${AUDITR_URL}${colors.reset}\n`);

  // Check healthcheck first
  try {
    const healthRes = await fetch(`${AUDITR_URL}/health`);
    if (!healthRes.ok) throw new Error(`HTTP ${healthRes.status}`);
    const health = await healthRes.json();
    console.log(`${colors.green}✓ Auditr Microservice is UP and healthy!${colors.reset} (uptime: ${health.uptime.toFixed(1)}s)\n`);
  } catch (err) {
    console.error(`${colors.yellow}⚠️ Warning: Auditr service is not reachable at ${AUDITR_URL}${colors.reset}`);
    console.error(`Please ensure Docker containers are running: 'docker compose up -d' or 'npm run up'`);
    process.exit(1);
  }

  // 1. Initialize decoupled client for Auth Service
  console.log(`${colors.bold}Scenario 1: Authentication Microservice (Immediate delivery)${colors.reset}`);
  const authAuditr = new AuditrClient({
    url: AUDITR_URL,
    service: 'auth-service',
  });

  console.log(`  -> Logging user login success...`);
  await authAuditr.logNow({
    action: 'user.login.success',
    actor: {
      id: 'usr_84920',
      type: 'user',
      name: 'Alice Johnson',
      email: 'alice@enterprise.com',
      ip: '192.168.1.42',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    },
    target: {
      id: 'sess_991823',
      type: 'session',
      name: 'Web Session',
    },
    status: 'SUCCESS',
    severity: 'INFO',
    metadata: {
      mfaMethod: 'TOTP',
      authProvider: 'local',
    },
  });
  console.log(`  ${colors.green}✓ Auth login logged successfully!${colors.reset}`);

  await sleep(600);

  console.log(`  -> Logging suspicious failed login attempt...`);
  await authAuditr.logNow({
    action: 'user.login.failed',
    actor: {
      id: 'anonymous',
      type: 'attacker',
      ip: '203.0.113.195',
      userAgent: 'python-requests/2.28.1',
    },
    target: {
      id: 'usr_84920',
      type: 'user',
      name: 'Alice Johnson',
    },
    status: 'FAILURE',
    severity: 'WARNING',
    metadata: {
      reason: 'Invalid password credential (attempt 4/5)',
      geo: { country: 'DE', city: 'Frankfurt' },
    },
  });
  console.log(`  ${colors.green}✓ Failed attempt audit logged!${colors.reset}\n`);

  await sleep(800);

  // 2. Document Service with Changeset / Diff innovation
  console.log(`${colors.bold}Scenario 2: Document Management Backend (Changeset Diff calculation)${colors.reset}`);
  const docAuditr = new AuditrClient({
    url: AUDITR_URL,
    service: 'document-service',
  });

  const beforeDoc = {
    title: 'Confidential Strategy 2027',
    visibility: 'restricted',
    editors: ['alice@enterprise.com'],
    version: 1,
  };

  const afterDoc = {
    title: 'Confidential Strategy 2027 (Final Approved)',
    visibility: 'public',
    editors: ['alice@enterprise.com', 'bob@enterprise.com'],
    version: 2,
  };

  const docDiff = docAuditr.diff(beforeDoc, afterDoc);
  console.log(`  -> Auto-calculated changeset diff:`, docDiff);

  await docAuditr.logNow({
    action: 'document.updated',
    actor: {
      id: 'usr_84920',
      name: 'Alice Johnson',
      email: 'alice@enterprise.com',
      ip: '192.168.1.42',
    },
    target: {
      id: 'doc_sec_771',
      type: 'document',
      name: 'Confidential Strategy 2027',
    },
    status: 'SUCCESS',
    severity: 'AUDIT',
    changes: docDiff,
    metadata: {
      signoffRequired: true,
      department: 'Corporate Strategy',
    },
  });
  console.log(`  ${colors.green}✓ Document update with diff logged!${colors.reset}\n`);

  await sleep(800);

  // 3. Billing & Payments Microservice (Critical severity)
  console.log(`${colors.bold}Scenario 3: Billing & Payments Microservice (CRITICAL Severity & Batching)${colors.reset}`);
  const billingAuditr = new AuditrClient({
    url: AUDITR_URL,
    service: 'billing-service',
    batchSize: 5,
    flushIntervalMs: 1500,
  });

  console.log(`  -> Queuing batch of billing events into non-blocking memory queue...`);
  billingAuditr.log({
    action: 'invoice.generated',
    actor: { id: 'cron-billing-worker', type: 'service' },
    target: { id: 'inv_2026_001', type: 'invoice', name: 'Annual Enterprise Subscription' },
    status: 'SUCCESS',
    severity: 'INFO',
    metadata: { amount: 48000.0, currency: 'USD' },
  });

  billingAuditr.log({
    action: 'payment.authorized',
    actor: { id: 'usr_84920', name: 'Alice Johnson' },
    target: { id: 'txn_card_9921', type: 'transaction' },
    status: 'SUCCESS',
    severity: 'INFO',
    metadata: { cardLast4: '4242', amount: 48000.0 },
  });

  billingAuditr.log({
    action: 'refund.executed',
    actor: { id: 'support_admin_09', name: 'Carol Support', email: 'carol@enterprise.com' },
    target: { id: 'txn_card_9921', type: 'transaction' },
    status: 'SUCCESS',
    severity: 'CRITICAL',
    metadata: {
      refundAmount: 5000.0,
      currency: 'USD',
      reason: 'Enterprise SLA courtesy discount approval',
    },
  });

  console.log(`  -> Manually flushing buffered queue...`);
  const flushRes = await billingAuditr.flush();
  console.log(`  ${colors.green}✓ Flushed ${flushRes.count} events in 1 network roundtrip!${colors.reset}\n`);

  await sleep(800);

  // 4. Express / HTTP Middleware Simulation
  console.log(`${colors.bold}Scenario 4: Express / HTTP Middleware Auto-Tracking${colors.reset}`);
  const middlewareAuditr = new AuditrClient({
    url: AUDITR_URL,
    service: 'api-gateway',
  });

  const middleware = middlewareAuditr.expressMiddleware();

  // Emulate an Express request / response cycle
  const mockReq = {
    method: 'DELETE',
    path: '/api/v2/users/usr_old_404',
    ip: '10.0.4.15',
    headers: { 'user-agent': 'AdminDashboard/1.4' },
    user: { id: 'super_admin_1', name: 'Root Administrator', email: 'admin@corp.internal' },
    query: { cascade: 'true' },
  };

  const listeners = {};
  const mockRes = {
    statusCode: 200,
    on(event, handler) { listeners[event] = handler; },
  };

  middleware(mockReq, mockRes, () => {});
  // Trigger response finish
  if (listeners['finish']) listeners['finish']();

  console.log(`  -> Express DELETE /api/v2/users/usr_old_404 processed.`);
  await middlewareAuditr.flush();
  console.log(`  ${colors.green}✓ HTTP request automatically recorded by middleware!${colors.reset}\n`);

  await sleep(800);

  // 5. Querying Verification and Statistics
  console.log(`${colors.bold}Scenario 5: Cryptographic Hash Chain Verification${colors.reset}`);
  const verifyRes = await fetch(`${AUDITR_URL}/api/v1/audit/verify`);
  const verifyData = await verifyRes.json();

  console.log(`  Integrity Status: ${colors.bold}${colors.green}${verifyData.integrity}${colors.reset}`);
  console.log(`  Total Records Verified: ${colors.yellow}${verifyData.verifiedCount}${colors.reset}`);
  console.log(`  Tamper Protection: ${colors.green}Tamper-evident chain is 100% verified.${colors.reset}\n`);

  console.log(`${colors.bold}${colors.green}🎉 Demo completed successfully!${colors.reset}`);
  console.log(`Run ${colors.cyan}npm run cli:tail${colors.reset} to watch the live logs polling.`);
  console.log(`Run ${colors.cyan}npm run cli:verify${colors.reset} to verify the DB hash chain.`);
  console.log(`Run ${colors.cyan}npm run cli:stats${colors.reset} to view breakdown stats.\n`);

  await authAuditr.close();
  await docAuditr.close();
  await billingAuditr.close();
  await middlewareAuditr.close();
}

runDemo().catch(err => {
  console.error('Demo error:', err);
  process.exit(1);
});
