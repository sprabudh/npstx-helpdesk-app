import 'reflect-metadata';
import dataSource from '../database/data-source';
import { AuditEntity, EventEntity, TicketEntity } from '../database/entities';
import { AuditPluginService } from './audit-plugin.service';
import { AuditService } from './audit.service';
import { buildTicketAuditBackfill } from './ticket-audit-backfill';

const keys = process.argv.slice(2);
const ticketKeys = keys.length ? keys : ['ADM-000066', 'LND-000054'];

async function main() {
  await dataSource.initialize();
  const audit = new AuditService(dataSource.getRepository(AuditEntity), new AuditPluginService());
  for (const key of ticketKeys) {
    const ticket = await dataSource.getRepository(TicketEntity).findOne({ where: { key } });
    if (!ticket) {
      console.warn(`Ticket ${key} not found; skipped.`);
      continue;
    }
    const [events, existing] = await Promise.all([
      dataSource.getRepository(EventEntity).find({ where: { ticketKey: key }, order: { at: 'ASC', id: 'ASC' } }),
      dataSource.getRepository(AuditEntity).find({ where: { target: key } }),
    ]);
    const rows = buildTicketAuditBackfill(ticket, events, existing);
    for (const row of rows) {
      await audit.record(row.actorId, row.action, row.summary, { target: key, detail: row.detail, at: row.at });
    }
    console.log(`${key}: wrote ${rows.length} audit event(s), mirrored to Auditr.`);
  }
  await dataSource.destroy();
}

main().catch(async (err) => {
  console.error('Ticket audit backfill failed:', err instanceof Error ? err.message : String(err));
  if (dataSource.isInitialized) await dataSource.destroy();
  process.exit(1);
});
