import { AuditService } from './audit.service';

describe('AuditService', () => {
  const repo = { insert: jest.fn(), find: jest.fn() } as any;
  const plugin = { record: jest.fn() } as any;
  let service: AuditService;

  beforeEach(() => {
    repo.insert.mockResolvedValue({ identifiers: [{ id: 42 }], raw: [{ id: 42 }] });
    plugin.record.mockResolvedValue(undefined);
    service = new AuditService(repo, plugin);
  });

  afterEach(() => jest.clearAllMocks());

  it('writes the local audit log and mirrors the event to the plugin', async () => {
    await service.record('u1', 'ticket.create', 'Created SE-1', { target: 'SE-1', detail: { ticket: 'SE-1' } });

    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'u1', action: 'ticket.create', summary: 'Created SE-1', target: 'SE-1', outcome: 'ok' }));
    expect(plugin.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ticket.create',
      actorId: 'u1',
      targetId: 'SE-1',
      targetType: 'ticket',
      status: 'SUCCESS',
      severity: 'AUDIT',
      summary: 'Created SE-1',
      detail: { ticket: 'SE-1' },
      helpdeskAuditId: 42,
    }));
    const event = plugin.record.mock.calls[0][0];
    expect(event.eventId).toEqual(expect.any(String));
    expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
  });

  it('maps denied and auth events to plugin status and severity', async () => {
    await service.record('u2', 'ticket.view', 'Denied access to SE-2', { target: 'SE-2', outcome: 'denied' });
    await service.record('u3', 'auth.demo_login', 'Signed in (demo)');

    expect(plugin.record.mock.calls[0][0]).toMatchObject({ status: 'FAILURE', severity: 'WARNING', targetType: 'ticket' });
    expect(plugin.record.mock.calls[1][0]).toMatchObject({ status: 'SUCCESS', severity: 'AUDIT', targetId: null });
  });

  it('maps every helpdesk ticket key to an Auditr ticket target', async () => {
    for (const target of ['LND-000054', 'ADM-000066', 'HR-000001', 'IT-000001', 'SF-00001']) {
      await service.record('u1', 'ticket.status', `Changed ${target}`, { target });
    }
    await service.record('u1', 'people.view', 'Viewed user', { target: 'u5' });

    expect(plugin.record.mock.calls.slice(0, 5).map((call: any[]) => call[0].targetType)).toEqual(['ticket', 'ticket', 'ticket', 'ticket', 'ticket']);
    expect(plugin.record.mock.calls[5][0].targetType).toBe('user');
  });

  it('honours an explicit timestamp for backfilled events', async () => {
    const at = new Date('2026-11-26T05:17:59.000Z');
    await service.record('u5', 'ticket.create', 'Created LND-000054', { target: 'LND-000054', at });

    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ at }));
    expect(plugin.record).toHaveBeenCalledWith(expect.objectContaining({ timestamp: at.toISOString() }));
  });

  it('does not fail the local audit write when the plugin is unavailable', async () => {
    plugin.record.mockRejectedValue(new Error('plugin offline'));

    await expect(service.record('u1', 'config.change', 'Changed setting')).resolves.toBeUndefined();
    expect(repo.insert).toHaveBeenCalledTimes(1);
  });
});
