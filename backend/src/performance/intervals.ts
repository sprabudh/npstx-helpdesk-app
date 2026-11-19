import { istDate } from '../common/clock';
import type { AsgRecord, EscRecord, TicketEntity } from '../database/entities';
import { isAtRisk, isOverdue, slaCounts } from '../domain/sla';

/** How an interval ended. Every direct interval has exactly one outcome. */
export type Outcome = 'withinSla' | 'late' | 'escSla' | 'escManual' | 'reManual' | 'reAbsence' | 'open' | 'rejected';
export const OUTCOMES: Outcome[] = ['withinSla', 'late', 'escSla', 'escManual', 'reManual', 'reAbsence', 'open', 'rejected'];

/** One stretch of time a ticket spent with one holder (person or queue). */
export interface Interval {
  key: string;
  helpdesk: string;
  categoryKey: string;
  holder: string;
  /** direct = routed at raise, absence cover or queue claim; inherited = received by escalation or manual reassignment. */
  kind: 'direct' | 'escalation' | 'reassignment';
  how: AsgRecord['how'];
  start: Date;
  end: Date | null;
  outcome: Outcome;
  /** For an open outcome: the ticket is past its resolution due time / due within 24 h. */
  overdue: boolean;
  atRisk: boolean;
  cover: boolean;
}

export const DIRECT: AsgRecord['how'][] = ['routing', 'absence', 'queue-claim'];
export const isSlaEsc = (e: Pick<EscRecord, 'how'>) => e.how === 'sla' || e.how === 'auto';

/** Assignment history, with a single routing entry for tickets written before history existed. */
export function history(t: TicketEntity): AsgRecord[] {
  return t.asgHist?.length ? t.asgHist : [{ u: t.assigneeId, at: t.createdAt.toISOString(), how: 'routing', coverFor: null }];
}

/** Holder at a moment: the newest history entry that started at or before it. */
export function holderAt(t: TicketEntity, at: number): string {
  const h = history(t);
  let who = h[0].u;
  for (const e of h) if (Date.parse(e.at) <= at) who = e.u;
  return who;
}

/** Splits a ticket's life into holder intervals and gives each one its outcome. */
export function intervals(t: TicketEntity, closed: boolean, now: number): Interval[] {
  const h = history(t);
  const esc = t.escLog ?? [];
  return h.map((e, i) => {
    const next = h[i + 1];
    let outcome: Outcome;
    if (next) {
      if (next.how === 'escalation') {
        const rec = esc.find((x) => x.to === next.u && Math.abs(Date.parse(x.at) - Date.parse(next.at)) < 60000) ?? esc.find((x) => x.to === next.u);
        outcome = rec && !isSlaEsc(rec) ? 'escManual' : 'escSla';
      } else outcome = next.how === 'absence' ? 'reAbsence' : 'reManual';
    } else if (closed) {
      outcome = !slaCounts(t) ? 'rejected' : t.closedAt && t.closedAt.getTime() <= t.resolutionDue.getTime() ? 'withinSla' : 'late';
    } else outcome = 'open';
    return {
      key: t.key, helpdesk: t.helpdesk, categoryKey: t.categoryKey, holder: e.u,
      kind: DIRECT.includes(e.how) ? 'direct' : e.how === 'escalation' ? 'escalation' : 'reassignment',
      how: e.how, start: new Date(e.at), end: next ? new Date(next.at) : null, outcome,
      overdue: outcome === 'open' && isOverdue(t, false, now), atRisk: outcome === 'open' && isAtRisk(t, false, now), cover: e.how === 'absence',
    };
  });
}

export const startsIn = (iv: Pick<Interval, 'start'>, fromDate: string) => istDate(iv.start) >= fromDate;
