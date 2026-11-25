#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const { c, banner, formatEventLine, formatSeverity } = require('../formatter');

// Load .env from project root or current directory
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const args = process.argv.slice(2);
const command = args[0] || 'tail';

function parseFlags(argv) {
  const flags = {
    interval: 1000,
    limit: 10,
    service: null,
    severity: null,
    action: null,
    verbose: false,
    mode: 'db', // 'db' or 'api'
    url: process.env.AUDITR_URL || 'http://localhost:5050',
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3308', 10),
    user: process.env.DB_USER || 'auditr_user',
    password: process.env.DB_PASSWORD || 'auditr_secret',
    database: process.env.DB_NAME || 'auditr_db',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--interval' && argv[i + 1]) flags.interval = parseInt(argv[++i], 10);
    else if (arg === '--limit' && argv[i + 1]) flags.limit = parseInt(argv[++i], 10);
    else if (arg === '--service' && argv[i + 1]) flags.service = argv[++i];
    else if (arg === '--severity' && argv[i + 1]) flags.severity = argv[++i].toUpperCase();
    else if (arg === '--action' && argv[i + 1]) flags.action = argv[++i];
    else if (arg === '--mode' && argv[i + 1]) flags.mode = argv[++i].toLowerCase();
    else if (arg === '--url' && argv[i + 1]) flags.url = argv[++i];
    else if (arg === '--host' && argv[i + 1]) flags.host = argv[++i];
    else if (arg === '--port' && argv[i + 1]) flags.port = parseInt(argv[++i], 10);
    else if (arg === '--verbose' || arg === '-v') flags.verbose = true;
  }
  return flags;
}

const flags = parseFlags(args.slice(1));

async function getDbConnection() {
  return await mysql.createConnection({
    host: flags.host,
    port: flags.port,
    user: flags.user,
    password: flags.password,
    database: flags.database,
    timezone: 'Z',
  });
}

/**
 * Live Tail Polling Mode
 */
async function runTail() {
  console.log(banner());
  console.log(`${c.bold}Connecting to Auditr...${c.reset}`);
  console.log(` Mode:     ${c.cyan}${flags.mode.toUpperCase()}${c.reset} (${flags.mode === 'db' ? `${flags.host}:${flags.port}/${flags.database}` : flags.url})`);
  console.log(` Interval: ${c.yellow}${flags.interval}ms${c.reset} | Initial Backlog: ${c.yellow}${flags.limit}${c.reset}`);
  if (flags.service) console.log(` Filter:   service = ${c.magenta}${flags.service}${c.reset}`);
  if (flags.severity) console.log(` Filter:   severity = ${c.magenta}${flags.severity}${c.reset}`);
  if (flags.action) console.log(` Filter:   action = ${c.magenta}${flags.action}${c.reset}`);
  console.log(`${c.dim}────────────────────────────────────────────────────────────────────────────${c.reset}`);
  console.log(`${c.green}● Live tail started. Press Ctrl+C to stop.${c.reset}\n`);

  let lastSeenId = 0;
  let isFirstPoll = true;

  if (flags.mode === 'db') {
    let conn = null;
    try {
      conn = await getDbConnection();
    } catch (err) {
      console.error(`${c.red}Database connection failed:${c.reset} ${err.message}`);
      console.log(`${c.yellow}Hint: Check if Docker container is up: 'docker compose up -d'${c.reset}`);
      process.exit(1);
    }

    // Polling loop
    const pollDb = async () => {
      try {
        const conditions = [];
        const params = [];

        if (isFirstPoll) {
          // Fetch last N events on startup
          if (flags.service) { conditions.push('service = ?'); params.push(flags.service); }
          if (flags.severity) { conditions.push('severity = ?'); params.push(flags.severity); }
          if (flags.action) { conditions.push('action LIKE ?'); params.push(flags.action.replace(/\*/g, '%')); }

          let sql = 'SELECT * FROM audit_events';
          if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
          sql += ' ORDER BY id DESC LIMIT ?';
          params.push(flags.limit);

          const [rows] = await conn.query(sql, params);
          rows.reverse().forEach(row => {
            console.log(formatEventLine(row, { verbose: flags.verbose }));
            if (row.id > lastSeenId) lastSeenId = row.id;
          });

          if (rows.length === 0) {
            // Find max id anyway
            const [maxRows] = await conn.query('SELECT MAX(id) as maxId FROM audit_events');
            lastSeenId = maxRows[0]?.maxId || 0;
          }
          isFirstPoll = false;
        } else {
          // Subsequent polls: only rows with id > lastSeenId
          conditions.push('id > ?');
          params.push(lastSeenId);

          if (flags.service) { conditions.push('service = ?'); params.push(flags.service); }
          if (flags.severity) { conditions.push('severity = ?'); params.push(flags.severity); }
          if (flags.action) { conditions.push('action LIKE ?'); params.push(flags.action.replace(/\*/g, '%')); }

          const sql = `SELECT * FROM audit_events WHERE ${conditions.join(' AND ')} ORDER BY id ASC LIMIT 100`;
          const [rows] = await conn.query(sql, params);

          for (const row of rows) {
            console.log(formatEventLine(row, { verbose: flags.verbose }));
            if (row.id > lastSeenId) lastSeenId = row.id;
          }
        }
      } catch (pollErr) {
        console.error(`${c.red}[Poll Error]${c.reset} ${pollErr.message}`);
        try {
          conn = await getDbConnection();
        } catch (_) {}
      }
    };

    await pollDb();
    const intervalTimer = setInterval(pollDb, flags.interval);

    process.on('SIGINT', async () => {
      clearInterval(intervalTimer);
      if (conn) await conn.end();
      console.log(`\n${c.dim}Disconnected. Goodbye!${c.reset}`);
      process.exit(0);
    });
  } else {
    // API Polling mode
    const pollApi = async () => {
      try {
        const queryParams = new URLSearchParams();
        if (isFirstPoll) {
          queryParams.set('limit', String(flags.limit));
          queryParams.set('order', 'DESC');
        } else {
          queryParams.set('sinceId', String(lastSeenId));
        }
        if (flags.service) queryParams.set('service', flags.service);
        if (flags.severity) queryParams.set('severity', flags.severity);
        if (flags.action) queryParams.set('action', flags.action);

        const res = await fetch(`${flags.url}/api/v1/events?${queryParams.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const rows = data.data || [];

        if (isFirstPoll) {
          rows.reverse().forEach(row => {
            console.log(formatEventLine(row, { verbose: flags.verbose }));
            if (row.id > lastSeenId) lastSeenId = row.id;
          });
          isFirstPoll = false;
        } else {
          for (const row of rows) {
            console.log(formatEventLine(row, { verbose: flags.verbose }));
            if (row.id > lastSeenId) lastSeenId = row.id;
          }
        }
      } catch (err) {
        console.error(`${c.red}[API Error]${c.reset} ${err.message}`);
      }
    };

    await pollApi();
    const intervalTimer = setInterval(pollApi, flags.interval);

    process.on('SIGINT', () => {
      clearInterval(intervalTimer);
      console.log(`\n${c.dim}Disconnected. Goodbye!${c.reset}`);
      process.exit(0);
    });
  }
}

/**
 * Verify Hash Chain Integrity
 */
async function runVerify() {
  console.log(banner());
  console.log(`${c.bold}Verifying Cryptographic Hash Chain Integrity...${c.reset}\n`);

  try {
    const conn = await getDbConnection();
    const [rows] = await conn.query('SELECT * FROM audit_events ORDER BY id ASC');
    await conn.end();

    const crypto = require('crypto');
    const secret = process.env.AUDITR_HASH_SECRET || 'auditr-production-integrity-secret-salt-2026';
    const GENESIS = '0'.repeat(64);

    let expectedPrev = GENESIS;
    let valid = true;
    let checked = 0;

    for (const row of rows) {
      if (row.prev_hash !== expectedPrev) {
        console.log(`${c.bgRed}${c.white}${c.bold} INTEGRITY BREACH DETECTED! ${c.reset}`);
        console.log(`Record #${row.id} (${row.event_id}) has broken hash chain pointer.`);
        console.log(` Expected Prev Hash: ${expectedPrev}`);
        console.log(` Actual Prev Hash:   ${row.prev_hash}`);
        valid = false;
        break;
      }

      function canonical(obj) {
        if (!obj) return '';
        if (typeof obj !== 'object') return String(obj);
        if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
        return '{' + Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',') + '}';
      }

      const parts = [
        expectedPrev,
        row.event_id || '',
        row.service || '',
        row.action || '',
        row.actor_id || '',
        row.actor_type || '',
        row.target_id || '',
        row.target_type || '',
        row.status || 'SUCCESS',
        row.severity || 'INFO',
        canonical(typeof row.changes === 'string' ? JSON.parse(row.changes) : row.changes),
        canonical(typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata),
        new Date(row.timestamp).toISOString(),
      ];
      const recomputed = crypto.createHmac('sha256', secret).update(parts.join('|')).digest('hex');

      if (recomputed !== row.record_hash) {
        console.log(`${c.bgRed}${c.white}${c.bold} TAMPERING DETECTED! ${c.reset}`);
        console.log(`Record #${row.id} (${row.event_id}) content was modified in database!`);
        console.log(` Stored Hash:     ${row.record_hash}`);
        console.log(` Recomputed Hash:  ${recomputed}`);
        valid = false;
        break;
      }

      expectedPrev = row.record_hash;
      checked++;
    }

    if (valid) {
      console.log(`${c.green}${c.bold}✓ HASH CHAIN 100% VERIFIED & INTACT${c.reset}`);
      console.log(`  Records checked: ${c.bold}${checked}${c.reset}`);
      console.log(`  Latest Hash:     ${c.dim}${expectedPrev}${c.reset}`);
      console.log(`  Tamper status:   ${c.green}SECURE (No unauthorized insertions, edits, or deletions)${c.reset}\n`);
    } else {
      process.exit(2);
    }
  } catch (err) {
    console.error(`${c.red}Verification failed:${c.reset} ${err.message}`);
    process.exit(1);
  }
}

/**
 * Statistics
 */
async function runStats() {
  console.log(banner());
  try {
    const conn = await getDbConnection();
    const [totalRows] = await conn.query('SELECT COUNT(*) as count FROM audit_events');
    const [byService] = await conn.query('SELECT service, COUNT(*) as count FROM audit_events GROUP BY service ORDER BY count DESC');
    const [bySeverity] = await conn.query('SELECT severity, COUNT(*) as count FROM audit_events GROUP BY severity');
    const [byStatus] = await conn.query('SELECT status, COUNT(*) as count FROM audit_events GROUP BY status');
    await conn.end();

    console.log(`${c.bold}Auditr System Statistics${c.reset}`);
    console.log(`Total Events Recorded: ${c.bold}${c.cyan}${totalRows[0]?.count || 0}${c.reset}\n`);

    console.log(`${c.bold}Events by Service:${c.reset}`);
    byService.forEach(r => {
      console.log(`  ${c.magenta}• ${r.service.padEnd(20)}${c.reset} ${r.count}`);
    });

    console.log(`\n${c.bold}Events by Severity:${c.reset}`);
    bySeverity.forEach(r => {
      console.log(`  ${formatSeverity(r.severity)} : ${r.count}`);
    });

    console.log(`\n${c.bold}Events by Status:${c.reset}`);
    byStatus.forEach(r => {
      console.log(`  ${r.status === 'SUCCESS' ? c.green : c.red}${r.status}${c.reset}: ${r.count}`);
    });
    console.log();
  } catch (err) {
    console.error(`${c.red}Failed to fetch stats:${c.reset} ${err.message}`);
    process.exit(1);
  }
}

function showHelp() {
  console.log(banner());
  console.log(`
${c.bold}USAGE:${c.reset}
  auditr <command> [options]

${c.bold}COMMANDS:${c.reset}
  ${c.cyan}tail${c.reset}     (default) Live-poll database/service and stream audit logs in real-time
  ${c.cyan}verify${c.reset}   Cryptographically verify the tamper-evident hash chain across all rows
  ${c.cyan}stats${c.reset}    Display statistics breakdown (by service, severity, status)
  ${c.cyan}help${c.reset}     Show this help message

${c.bold}OPTIONS FOR tail:${c.reset}
  ${c.yellow}--mode <db|api>${c.reset}     Direct DB polling (default) or HTTP API polling
  ${c.yellow}--interval <ms>${c.reset}     Polling interval in milliseconds (default: 1000)
  ${c.yellow}--limit <n>${c.reset}         Initial backlog rows to show (default: 10)
  ${c.yellow}--service <name>${c.reset}    Filter events by service name
  ${c.yellow}--severity <level>${c.reset}  Filter events by severity (INFO, WARNING, CRITICAL, AUDIT)
  ${c.yellow}--action <pattern>${c.reset}  Filter events by action (supports wildcards, e.g. "user.*")
  ${c.yellow}--verbose, -v${c.reset}       Display diffs and metadata inline
  ${c.yellow}--host <ip>${c.reset}         MySQL host (default: 127.0.0.1)
  ${c.yellow}--port <port>${c.reset}       MySQL port (default: 3308)
  ${c.yellow}--url <url>${c.reset}         HTTP API URL (default: http://localhost:5050)

${c.bold}EXAMPLES:${c.reset}
  auditr tail
  auditr tail --service billing-svc --verbose
  auditr tail --severity CRITICAL --interval 500
  auditr verify
  auditr stats
`);
}

switch (command) {
  case 'tail':
  case 'live':
  case 'poll':
    runTail();
    break;
  case 'verify':
    runVerify();
    break;
  case 'stats':
    runStats();
    break;
  case 'help':
  case '--help':
  case '-h':
    showHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    showHelp();
    process.exit(1);
}
