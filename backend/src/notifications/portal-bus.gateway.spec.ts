import { env } from '../common/env';
import type { NotificationEvent } from './gateway';
import { PortalBusNotificationGateway, portalEvent } from './portal-bus.gateway';

const event = (over: Partial<NotificationEvent> = {}): NotificationEvent => ({
  eventType: 'TICKET_CREATED_DIRECT' as any, category: 'NOTIFICATION', ticketKey: 'HR-000131', ticketId: 'HR-000131',
  recipientUserId: 'u9', actorUserId: 'u1', channel: 'in-app', text: 'New ticket HR-000131 assigned to you',
  confidential: false, payload: {}, dedupeKey: 'TICKET_CREATED_DIRECT:HR-000131:u9', occurredAt: '2026-11-26T10:00:00.000Z', ...over,
});

describe('portal notification bus', () => {
  const saved = { ...env.portal };
  beforeAll(() => Object.assign(env.portal, { tenantId: 'a0000000-0000-0000-0000-000000000001', publicUrl: 'http://helpdesk.npst.localhost:8080' }));
  afterAll(() => Object.assign(env.portal, saved));

  const setup = (recipient: any) => {
    const local: any = { publish: jest.fn(async () => undefined) };
    const ds: any = { getRepository: () => ({ findOne: async () => recipient }) };
    const gw = new PortalBusNotificationGateway(local, ds);
    const bus = { xadd: jest.fn(async () => '1-0') };
    gw.useBus(bus);
    return { gw, local, bus };
  };

  it('keeps the local notification and adds the portal one for a linked person', async () => {
    const { gw, local, bus } = setup({ id: 'u9', portalUserId: 'p-uuid', isQueue: false });
    await gw.publish(event());
    expect(local.publish).toHaveBeenCalled();
    expect(bus.xadd).toHaveBeenCalledWith('notifications:events:helpdesk', '*', 'event', expect.any(String));
    const sent = JSON.parse((bus.xadd.mock.calls[0] as any[])[3]);
    expect(sent).toMatchObject({
      specversion: 1, type: 'notification.requested', tenantId: 'a0000000-0000-0000-0000-000000000001',
      data: { title: 'New ticket HR-000131 assigned to you', link: 'http://helpdesk.npst.localhost:8080/ticket/HR-000131',
        sourceRef: 'TICKET_CREATED_DIRECT:HR-000131:u9', sensitive: false, audience: { userIds: ['p-uuid'] } },
    });
  });

  it('skips people without a portal link', async () => {
    const { gw, local, bus } = setup({ id: 'u9', portalUserId: null, isQueue: false });
    await gw.publish(event());
    expect(local.publish).toHaveBeenCalled();
    expect(bus.xadd).not.toHaveBeenCalled();
  });

  it('never fails the ticket action when the bus is down', async () => {
    const { gw, bus } = setup({ id: 'u9', portalUserId: 'p-uuid', isQueue: false });
    bus.xadd.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(gw.publish(event())).resolves.toBeUndefined();
  });

  it('marks confidential tickets sensitive and keeps long dedupe keys within 128 characters', () => {
    const e = portalEvent(event({ confidential: true, dedupeKey: 'X'.repeat(160) }), 'p', 't', 'http://h');
    expect(e.data.sensitive).toBe(true);
    expect(e.data.sourceRef).toHaveLength(64);
  });
});
