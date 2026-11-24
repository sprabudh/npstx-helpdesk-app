import 'reflect-metadata';
import dataSource from '../database/data-source';
import { SeedService } from './seed.service';

/** CLI: `npm run db:seed` loads (or restores) the artifact sample data. */
async function main() {
  await dataSource.initialize();
  const pending = await dataSource.showMigrations();
  if (pending) {
    console.error('Pending migrations found. Run `npm run db:migrate` first.');
    process.exit(1);
  }
  if (process.argv.includes('--if-empty')) {
    const [{ users, tickets }] = await dataSource.query('SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM tickets) AS tickets');
    if (Number(users) > 0 || Number(tickets) > 0) {
      console.log('Database already has data; seed skipped (--if-empty).');
      await dataSource.destroy();
      return;
    }
  }
  const res = await new SeedService(dataSource).run();
  console.log(`Seed loaded: ${res.users} people and queues, ${res.tickets} tickets, ${res.faqs} FAQs, ${res.notifications} notifications.`);
  await dataSource.destroy();
}
main().catch((e) => {
  console.error('Seed failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
