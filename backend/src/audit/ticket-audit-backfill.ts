import { AuditEntity, EventEntity, TicketEntity } from '../database/entities';

export const TICKET_AUDIT_BACKFILL_MARKER = 'ticket-audit-backfill-2026-11-26';

const ACTION_BY_KIND: Record<string, string> = {
  raise: 'ticket.create',
  status: 'ticket.status',
  assign: 'ticket.assign',
  close: 'ticket.close',
  esc: 'ticket.escalate',
  sla: 'ticket.sla',
};

export interface TicketAuditBackfillEvent {
  actorId: string | null;
  action: string;
  summary: string;
  at: Date;
  detail: Record<string, any>;
}

const detailObject = (detail: AuditEntity['detail']): Record<string, any> => {
  if (!detail) return {};
  if (typeof detail === 'string') {
    try {
      return JSON.parse(detail);
    } catch {
      return {};
    }
  }
  return detail;
};

export function buildTicketAuditBackfill(
  ticket: Pick<TicketEntity, 'key' | 'helpdesk' | 'categoryKey' | 'requesterId'>,
  events: Pick<EventEntity, 'id' | 'at' | 'text' | 'kind'>[],
  existing: Pick<AuditEntity, 'action' | 'target' | 'detail'>[],
): TicketAuditBackfillEvent[] {
  const written = new Set(
    existing
      .filter((row) => row.target === ticket.key && detailObject(row.detail).backfill === TICKET_AUDIT_BACKFILL_MARKER)
      .map((row) => `${row.action}:${detailObject(row.detail).eventId ?? ''}`),
  );
  return events
    .map((event) => {
      const action = ACTION_BY_KIND[event.kind] ?? 'ticket.event';
      return {
        actorId: ticket.requesterId ?? null,
        action,
        summary: event.text.slice(0, 400),
        at: event.at,
        detail: {
          backfill: TICKET_AUDIT_BACKFILL_MARKER,
          eventId: event.id,
          eventKind: event.kind,
          ticket: ticket.key,
          helpdesk: ticket.helpdesk,
          category: ticket.categoryKey,
        },
      };
    })
    .filter((row) => !written.has(`${row.action}:${row.detail.eventId}`));
}
