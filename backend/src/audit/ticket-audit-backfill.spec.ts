import { buildTicketAuditBackfill, TICKET_AUDIT_BACKFILL_MARKER } from './ticket-audit-backfill';

describe('buildTicketAuditBackfill', () => {
  const ticket = { key: 'LND-000054', helpdesk: 'LND' as const, categoryKey: 'CERT', requesterId: 'u5' };
  const events = [
    { id: 247, at: new Date('2026-11-26T05:20:59.000Z'), text: 'Raised by Rohan Das', kind: 'raise' },
    { id: 248, at: new Date('2026-11-26T05:20:59.000Z'), text: 'Routed to Kavya Nair', kind: 'assign' },
  ];

  it('maps ticket timeline events to audit actions with safe metadata', () => {
    const rows = buildTicketAuditBackfill(ticket, events, []);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      actorId: 'u5',
      action: 'ticket.create',
      summary: 'Raised by Rohan Das',
      at: events[0].at,
      detail: {
        backfill: TICKET_AUDIT_BACKFILL_MARKER,
        eventId: 247,
        eventKind: 'raise',
        ticket: 'LND-000054',
        helpdesk: 'LND',
        category: 'CERT',
      },
    });
    expect(rows[1].action).toBe('ticket.assign');
  });

  it('does not duplicate events that were already backfilled', () => {
    const existing = [
      {
        action: 'ticket.create',
        target: 'LND-000054',
        detail: { backfill: TICKET_AUDIT_BACKFILL_MARKER, eventId: 247 },
      },
      {
        action: 'ticket.assign',
        target: 'ADM-000066',
        detail: { backfill: TICKET_AUDIT_BACKFILL_MARKER, eventId: 248 },
      },
    ];

    const rows = buildTicketAuditBackfill(ticket, events, existing);

    expect(rows.map((row) => row.detail.eventId)).toEqual([248]);
  });
});
