import { Logger } from '@nestjs/common';

describe('AuditPluginService', () => {
  const originalFetch = global.fetch;
  const pluginVars = ['AUDIT_PLUGIN_ENABLED', 'AUDIT_PLUGIN_URL', 'AUDIT_PLUGIN_API_KEY', 'AUDIT_PLUGIN_SERVICE_NAME', 'AUDIT_PLUGIN_TIMEOUT_MS'];
  let savedVars: Record<string, string | undefined>;

  const serviceWith = async (vars: Record<string, string>) => {
    for (const key of pluginVars) delete process.env[key];
    Object.assign(process.env, vars);
    jest.resetModules();
    const { AuditPluginService } = await import('./audit-plugin.service');
    return new AuditPluginService();
  };

  beforeEach(() => {
    savedVars = Object.fromEntries(pluginVars.map((key) => [key, process.env[key]]));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const key of pluginVars) {
      if (savedVars[key] === undefined) delete process.env[key];
      else process.env[key] = savedVars[key];
    }
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('posts a normalized event to the configured plugin URL with the API key', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => '', json: async () => ({}) });
    global.fetch = fetchMock as any;
    const service = await serviceWith({
      AUDIT_PLUGIN_ENABLED: 'true',
      AUDIT_PLUGIN_URL: 'http://plugin:5050/',
      AUDIT_PLUGIN_API_KEY: 'plugin-key',
      AUDIT_PLUGIN_SERVICE_NAME: 'helpdesk',
      AUDIT_PLUGIN_TIMEOUT_MS: '1000',
    });

    await service.record({
      eventId: 'evt-1',
      action: 'ticket.create',
      actorId: 'u1',
      targetId: 'SE-1',
      targetType: 'ticket',
      status: 'SUCCESS',
      severity: 'AUDIT',
      summary: 'Created SE-1',
      detail: { source: 'api' },
      helpdeskAuditId: 7,
      timestamp: '2026-11-25T10:00:00.000Z',
    });

    expect(fetchMock).toHaveBeenCalledWith('http://plugin:5050/api/v1/events', expect.objectContaining({ method: 'POST' }));
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', 'X-Api-Key': 'plugin-key' });
    expect(init.signal).toBeDefined();
    expect(JSON.parse(init.body)).toEqual({
      event_id: 'evt-1',
      service: 'helpdesk',
      action: 'ticket.create',
      actor: { id: 'u1', type: 'user' },
      target: { id: 'SE-1', type: 'ticket' },
      status: 'SUCCESS',
      severity: 'AUDIT',
      metadata: { source: 'api', summary: 'Created SE-1', helpdeskAuditId: 7 },
      timestamp: '2026-11-25T10:00:00.000Z',
    });
  });

  it('skips delivery when the plugin is disabled', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;
    const service = await serviceWith({ AUDIT_PLUGIN_ENABLED: 'false', AUDIT_PLUGIN_URL: 'http://plugin:5050' });

    await service.record({
      eventId: 'evt-2',
      action: 'auth.demo_login',
      actorId: 'u1',
      status: 'SUCCESS',
      severity: 'AUDIT',
      summary: 'Signed in',
      timestamp: '2026-11-25T10:00:00.000Z',
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows plugin HTTP errors', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    global.fetch = fetchMock as any;
    const service = await serviceWith({
      AUDIT_PLUGIN_ENABLED: 'true',
      AUDIT_PLUGIN_URL: 'http://plugin:5050',
      AUDIT_PLUGIN_TIMEOUT_MS: '1000',
    });

    await expect(service.record({
      eventId: 'evt-3',
      action: 'ticket.view',
      actorId: 'u1',
      status: 'FAILURE',
      severity: 'WARNING',
      summary: 'Denied',
      timestamp: '2026-11-25T10:00:00.000Z',
    })).resolves.toBeUndefined();
  });
});
