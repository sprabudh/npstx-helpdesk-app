import { istDate } from '../common/clock';
import { hasEscalation, isAtRisk, isBreachedRes, isOverdue, isResponseBreached, slaCounts } from '../domain/sla';
import type { Row } from '../tickets/ticket-loader.service';

/** What metrics() needs besides the rows; kept as plain functions so the numbers can be unit tested. */
export interface MetricsCtx {
  now: number;
  /** First IST date of the date range (inclusive), the same value the ticket list's "from" filter uses. */
  fromDate: string;
  uiStatus: (r: Row) => string;
  isWaiting: (r: Row) => boolean;
  isQueue: (id: string) => boolean;
  reopened: Set<string>;
  /** First public reply by someone other than the requester, per ticket key. */
  firstReply: Map<string, Date>;
}

export interface Metrics {
  live: {
    open: number; notStarted: number; inProgress: number; pendingInput: number; waitRequester: number; waitApproval: number;
    escalated: number; overdue: number; atRisk: number; unassigned: number;
  };
  period: {
    raised: number; closed: number; resolved: number; rejected: number; cancelled: number; reopened: number;
    breached: number; responseBreached: number; resolutionBreached: number;
    avgFirstMs: number | null; firstN: number; avgResolutionMs: number | null; resolutionN: number;
  };
}

/** UI group of a closed ticket: Resolved, Rejected or Cancelled. */
const closedGroup = (ui: string) => (ui === 'Rejected' ? 'rejected' : ui === 'Cancelled' ? 'cancelled' : 'resolved');
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
export const inRange = (r: Row, fromDate: string) => istDate(r.t.createdAt) >= fromDate;
export const slaFrom = (r: Row) => (r.t.slaStart ?? r.t.createdAt).getTime();

/**
 * The one definition of every dashboard number. Live numbers describe tickets open right now;
 * period numbers describe the cohort raised in the date range. Open = Not started + In progress + Pending input.
 */
export function metrics(rows: Row[], c: MetricsCtx): Metrics {
  const open = rows.filter((r) => !r.closed);
  const ui = (b: string) => open.filter((r) => c.uiStatus(r) === b).length;
  const cohort = rows.filter((r) => inRange(r, c.fromDate));
  const closed = cohort.filter((r) => r.closed);
  const groups = closed.map((r) => closedGroup(c.uiStatus(r)));
  const counted = cohort.filter((r) => slaCounts(r.t));
  const respB = counted.filter((r) => isResponseBreached({ ...r.t, firstReply: c.firstReply.get(r.t.key) ?? null }, c.now));
  const resB = counted.filter((r) => isBreachedRes(r.t, r.closed, c.now));
  const first = counted.map((r) => (c.firstReply.has(r.t.key) ? c.firstReply.get(r.t.key)!.getTime() - slaFrom(r) : null)).filter((x): x is number => x !== null && x >= 0);
  const resolution = closed.filter((r) => slaCounts(r.t) && closedGroup(c.uiStatus(r)) === 'resolved' && r.t.closedAt).map((r) => r.t.closedAt!.getTime() - slaFrom(r));
  return {
    live: {
      open: open.length, notStarted: ui('Open'), inProgress: ui('In Progress'), pendingInput: ui('Pending Input'),
      waitRequester: open.filter((r) => c.isWaiting(r)).length, waitApproval: open.filter((r) => r.t.status === 'Pending approval').length,
      escalated: open.filter((r) => hasEscalation(r.t)).length,
      overdue: open.filter((r) => isOverdue(r.t, false, c.now)).length,
      atRisk: open.filter((r) => isAtRisk(r.t, false, c.now)).length,
      unassigned: open.filter((r) => c.isQueue(r.t.assigneeId)).length,
    },
    period: {
      raised: cohort.length, closed: closed.length,
      resolved: groups.filter((g) => g === 'resolved').length, rejected: groups.filter((g) => g === 'rejected').length, cancelled: groups.filter((g) => g === 'cancelled').length,
      reopened: cohort.filter((r) => c.reopened.has(r.t.key)).length,
      breached: new Set([...respB, ...resB]).size, responseBreached: respB.length, resolutionBreached: resB.length,
      avgFirstMs: avg(first), firstN: first.length, avgResolutionMs: avg(resolution), resolutionN: resolution.length,
    },
  };
}
