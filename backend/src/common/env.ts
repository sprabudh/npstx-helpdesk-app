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
  authMode: str('AUTH_MODE', 'demo') as 'demo' | 'oidc',
  jwtSecret: str('JWT_SECRET', 'change-me-in-.env'),
  jwtTtlSeconds: num('JWT_TTL_SECONDS', 1800),
  oidc: {
    issuer: str('OIDC_ISSUER', ''),
    clientId: str('OIDC_CLIENT_ID', ''),
    audience: str('OIDC_AUDIENCE', ''),
    userClaim: str('OIDC_USER_CLAIM', 'email'),
  },
  demoMode: bool('DEMO_MODE', true),
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
  auditPlugin: {
    enabled: bool('AUDIT_PLUGIN_ENABLED', false),
    url: str('AUDIT_PLUGIN_URL', 'http://localhost:5050'),
    apiKey: str('AUDIT_PLUGIN_API_KEY', ''),
    serviceName: str('AUDIT_PLUGIN_SERVICE_NAME', 'npstx-helpdesk'),
    timeoutMs: num('AUDIT_PLUGIN_TIMEOUT_MS', 2000),
  },
  logLevel: str('LOG_LEVEL', 'info'),
};

if (env.nodeEnv === 'production' && env.jwtSecret === 'change-me-in-.env') {
  throw new Error('JWT_SECRET must be set in production');
}
