const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',

  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
};

function formatSeverity(sev) {
  const s = (sev || 'INFO').toUpperCase();
  switch (s) {
    case 'CRITICAL':
      return `${c.bgRed}${c.white}${c.bold} CRIT ${c.reset}`;
    case 'WARNING':
      return `${c.bgYellow}${c.black}${c.bold} WARN ${c.reset}`;
    case 'AUDIT':
      return `${c.bgMagenta}${c.white}${c.bold} AUDT ${c.reset}`;
    case 'INFO':
    default:
      return `${c.bgCyan}${c.black}${c.bold} INFO ${c.reset}`;
  }
}

function formatStatus(status) {
  const s = (status || 'SUCCESS').toUpperCase();
  if (s === 'SUCCESS') {
    return `${c.green}✓ SUCCESS${c.reset}`;
  } else if (s === 'FAILURE') {
    return `${c.red}✗ FAILURE${c.reset}`;
  } else {
    return `${c.yellow}⚡ ${s}${c.reset}`;
  }
}

function formatTimestamp(ts) {
  const date = ts instanceof Date ? ts : new Date(ts);
  const iso = date.toISOString();
  // e.g. 11:32:05.123
  return `${c.dim}${iso.slice(11, 23)}${c.reset}`;
}

function formatEventLine(event, { verbose = false } = {}) {
  const time = formatTimestamp(event.timestamp || event.created_at);
  const sev = formatSeverity(event.severity);
  const stat = formatStatus(event.status);
  const service = `${c.blue}[${event.service}]${c.reset}`;
  const action = `${c.bold}${event.action}${c.reset}`;

  const actorParts = [event.actor_id];
  if (event.actor_name) actorParts.push(`(${event.actor_name})`);
  if (event.actor_ip) actorParts.push(`@${event.actor_ip}`);
  const actorStr = `${c.magenta}actor:${c.reset}${actorParts.join('')}`;

  let targetStr = '';
  if (event.target_id) {
    const tParts = [event.target_id];
    if (event.target_type) tParts.push(`:${event.target_type}`);
    targetStr = ` ${c.cyan}target:${c.reset}${tParts.join('')}`;
  }

  const hashSnippet = event.record_hash
    ? `${c.dim}#${event.record_hash.slice(0, 8)}${c.reset}`
    : '';

  let line = `${time} ${sev} ${service} ${action.padEnd(20)} ${stat} ${actorStr}${targetStr} ${hashSnippet}`;

  if (verbose) {
    const changes = typeof event.changes === 'string' ? JSON.parse(event.changes) : event.changes;
    const metadata = typeof event.metadata === 'string' ? JSON.parse(event.metadata) : event.metadata;

    if (changes) {
      line += `\n    ${c.dim}Changes:${c.reset} ${JSON.stringify(changes)}`;
    }
    if (metadata) {
      line += `\n    ${c.dim}Metadata:${c.reset} ${JSON.stringify(metadata)}`;
    }
  }

  return line;
}

function banner() {
  return `
${c.bold}${c.cyan}     _             _ _ _         ${c.reset}
${c.bold}${c.cyan}    / \\  _   _  __| (_) |_ _ __  ${c.reset}
${c.bold}${c.cyan}   / _ \\| | | |/ _\` | | __| '__| ${c.reset}
${c.bold}${c.cyan}  / ___ \\ |_| | (_| | | |_| |    ${c.reset}
${c.bold}${c.cyan} /_/   \\_\\__,_|\\__,_|_|\\__|_|    ${c.reset}
${c.dim} Decoupled Tamper-Evident Audit Microservice${c.reset}
`;
}

module.exports = {
  c,
  formatSeverity,
  formatStatus,
  formatTimestamp,
  formatEventLine,
  banner,
};
