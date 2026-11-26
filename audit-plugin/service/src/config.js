const path = require('path');
require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || path.resolve(process.cwd(), '.env') });

const config = {
  port: parseInt(process.env.PORT || '5050', 10),
  host: process.env.HOST || '0.0.0.0',
  logLevel: (process.env.LOG_LEVEL || 'info').toLowerCase(),
  apiKey: process.env.AUDITR_API_KEY || null,
  hashSecret: process.env.AUDITR_HASH_SECRET || 'auditr-tamper-evident-chain-v1',
  maxBatchSize: parseInt(process.env.MAX_BATCH_SIZE || '500', 10),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'auditr_user',
    password: process.env.DB_PASSWORD || 'auditr_secret',
    database: process.env.DB_NAME || 'auditr_db',
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
    waitForConnections: true,
    queueLimit: 0,
    connectTimeout: 10000,
    timezone: 'Z',
  }
};

module.exports = config;
