import { SeedService } from './seed.service';

describe('SeedService audit preservation', () => {
  let queries: string[];
  let runner: any;

  beforeEach(() => {
    queries = [];
    runner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        return [];
      }),
    };
    jest.spyOn(SeedService, 'loadFiles').mockReturnValue({
      data: {
        users: [],
        tickets: [],
        notifications: [],
        faqs: [],
        adminLog: [{ at: '2026-11-26T05:17:59+05:30', who: 'u20', text: 'Config change' }],
        sequences: {},
      },
      cfg: { categories: [], formFields: [], config: { sla: {}, escalation: {} } },
    } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('preserves the audit_log during demo reset', async () => {
    await new SeedService({ createQueryRunner: () => runner } as any).run({ preserveAudit: true });

    expect(queries).not.toContain('DELETE FROM audit_log');
    expect(queries).not.toContain('ALTER TABLE audit_log AUTO_INCREMENT = 1');
    expect(queries.some((sql) => sql.startsWith('INSERT INTO audit_log'))).toBe(false);
    expect(queries).toContain('DELETE FROM tickets');
  });

  it('still reloads the seeded admin log on a full seed', async () => {
    await new SeedService({ createQueryRunner: () => runner } as any).run();

    expect(queries).toContain('DELETE FROM audit_log');
    expect(queries).toContain('ALTER TABLE audit_log AUTO_INCREMENT = 1');
    expect(queries.some((sql) => sql.startsWith('INSERT INTO audit_log'))).toBe(true);
  });
});
