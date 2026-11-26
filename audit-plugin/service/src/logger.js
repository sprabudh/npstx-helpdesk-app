const config = require('./config');

const LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = LEVELS[config.logLevel] !== undefined ? LEVELS[config.logLevel] : 1;

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

function formatMessage(level, msg, meta) {
  const timestamp = new Date().toISOString();
  const color = {
    debug: COLORS.dim,
    info: COLORS.cyan,
    warn: COLORS.yellow,
    error: COLORS.red,
  }[level] || COLORS.reset;

  let out = `${COLORS.dim}[${timestamp}]${COLORS.reset} ${color}[${level.toUpperCase()}]${COLORS.reset} [auditr] ${msg}`;
  if (meta !== undefined) {
    if (meta instanceof Error) {
      out += `\n${COLORS.red}${meta.stack || meta.message}${COLORS.reset}`;
    } else if (typeof meta === 'object') {
      out += ` ${COLORS.dim}${JSON.stringify(meta)}${COLORS.reset}`;
    } else {
      out += ` ${meta}`;
    }
  }
  return out;
}

const logger = {
  debug(msg, meta) {
    if (currentLevel <= LEVELS.debug) console.log(formatMessage('debug', msg, meta));
  },
  info(msg, meta) {
    if (currentLevel <= LEVELS.info) console.log(formatMessage('info', msg, meta));
  },
  warn(msg, meta) {
    if (currentLevel <= LEVELS.warn) console.warn(formatMessage('warn', msg, meta));
  },
  error(msg, meta) {
    if (currentLevel <= LEVELS.error) console.error(formatMessage('error', msg, meta));
  },
};

module.exports = logger;
