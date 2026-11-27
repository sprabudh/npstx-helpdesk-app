import { config as loadDotenv } from 'dotenv';
import { resolve } from 'path';

// Load the repo-root .env (local runs) and then backend/.env if present. Real environment variables win.
loadDotenv({ path: resolve(__dirname, '..', '..', '..', '.env') });
loadDotenv({ path: resolve(__dirname, '..', '..', '.env') });

const str = (k: string, d: string) => (process.env[k] ?? '').trim() || d;
const num = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== '' && process.env[k] !== undefined ? v : d;
};
const bool = (k: string, d: boolean) => {
  const v = (process.env[k] ?? '').trim().toLowerCase();
  return v === '' ? d : ['1', 'true', 'yes', 'on'].includes(v);
};

const authMode = str('AUTH_MODE', 'demo') as 'demo' | 'oidc' | 'portal';

export const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  port: num('BACKEND_PORT', 3000),
  corsOrigin: str('CORS_ORIGIN', 'http://localhost:5173'),
  db: {
    host: str('DB_HOST', '127.0.0.1'),
    port: num('DB_PORT', 3306),
    user: str('DB_USER', 'helpdesk'),
    password: str('DB_PASSWORD', 'helpdesk_dev_pw'),
    name: str('DB_NAME', 'helpdesk'),
  },
  /** demo = persona switcher; oidc = RS256 tokens from an IdP; portal = signed in through the NPST portal session. */
  authMode,
  jwtSecret: str('JWT_SECRET', 'change-me-in-.env'),
  jwtTtlSeconds: num('JWT_TTL_SECONDS', 1800),
  oidc: {
    issuer: str('OIDC_ISSUER', ''),
    clientId: str('OIDC_CLIENT_ID', ''),
    audience: str('OIDC_AUDIENCE', ''),
    userClaim: str('OIDC_USER_CLAIM', 'email'),
  },
  /** Never in portal mode: no persona switcher, demo states or reset next to real people. */
  demoMode: authMode === 'portal' ? false : bool('DEMO_MODE', true),
  /** AUTH_MODE=portal: the NPST portal (iam-api) signs people in; see docs/Portal_Integration.md. */
  portal: {
    iamUrl: str('PLATFORM_IAM_URL', 'http://iam-api:3000').replace(/\/$/, ''),
    serviceSecret: str('PLATFORM_SERVICE_SECRET', ''),
    /** Only sessions of this portal tenant get in (empty = any tenant). */
    tenantId: str('PLATFORM_TENANT_ID', ''),
    /** The portal's sign-in page, for the browser. */
    url: str('PORTAL_URL', 'http://portal.npst.localhost:8080/'),
    /** Where people open the Helpdesk; ticket links in portal notifications point here. */
    publicUrl: str('HELPDESK_PUBLIC_URL', 'http://helpdesk.npst.localhost:8080').replace(/\/$/, ''),
    sessionCookie: str('PORTAL_SESSION_COOKIE', 'session_id'),
    timeoutMs: num('PLATFORM_TIMEOUT_MS', 5000),
    /** redis://helpdesk:<password>@notification-bus:6379 (empty = portal bell off). */
    busUrl: str('NOTIFICATION_BUS_URL', ''),
    busStream: str('NOTIFICATION_BUS_STREAM', 'notifications:events:helpdesk'),
  },
  displayTimeZone: str('DISPLAY_TIME_ZONE', 'Asia/Kolkata'),
  uploadDir: resolve(str('UPLOAD_DIR', resolve(__dirname, '..', '..', 'uploads'))),
  seedDir: resolve(str('SEED_DIR', resolve(__dirname, '..', '..', '..', 'db', 'seed'))),
  slaSchedulerEnabled: bool('SLA_SCHEDULER_ENABLED', true),
  outboxIntervalMs: num('OUTBOX_INTERVAL_MS', 15000),
  emailAdapter: str('EMAIL_ADAPTER', 'console') as 'console' | 'smtp',
  ai: {
    provider: str('AI_PROVIDER', 'rules') as 'anthropic' | 'rules' | 'none',
    apiKey: str('ANTHROPIC_API_KEY', ''),
    model: str('AI_MODEL', 'claude-sonnet-5-5'),
    baseUrl: str('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
    timeoutMs: num('AI_TIMEOUT_MS', 20000),
  },
  salesforce: {
    adapter: str('SALESFORCE_ADAPTER', 'mock') as 'mock' | 'rest',
    instanceUrl: str('SALESFORCE_INSTANCE_URL', ''),
    clientId: str('SALESFORCE_CLIENT_ID', ''),
    clientSecret: str('SALESFORCE_CLIENT_SECRET', ''),
    apiVersion: str('SALESFORCE_API_VERSION', 'v61.0'),
  },
  logLevel: str('LOG_LEVEL', 'info'),
};

if (env.authMode === 'portal' && !env.portal.serviceSecret) {
  throw new Error('AUTH_MODE=portal needs PLATFORM_SERVICE_SECRET');
}
if (env.nodeEnv === 'production' && env.jwtSecret === 'change-me-in-.env') {
  throw new Error('JWT_SECRET must be set in production');
}
