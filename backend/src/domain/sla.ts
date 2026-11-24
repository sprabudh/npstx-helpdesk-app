import { dur } from '../common/clock';
import type { Condition, EscRecord } from '../database/entities';
import type { StatusModel } from './types';

/** Minimal ticket shape for SLA and flag calculations. */
export interface SlaTicket {
  helpdesk: string;
  status: string;
  createdAt: Date;
  closedAt: Date | null;
  resolutionDue: Date;
  responseDue: Date;
  responseMet: boolean | null;
  paused: boolean;
  escalationLevel: number;
  closeResponse: string | null;
  /** False until the last approval; such tickets never had an SLA clock. */
  slaStarted?: boolean;
  /** First public reply by someone other than the requester, when known. */
  firstReply?: Date | null;
  /** Escalation records, used so a manual escalation still counts as escalated. */
  escLog?: EscRecord[] | null;
}

/** Rejected, Cancelled and never-started tickets are left out of every SLA metric. */
export const slaCounts = (t: SlaTicket) =>
  t.slaStarted !== false && !['Rejected', 'Cancelled'].includes(t.status) && !['Rejected', 'Cancelled'].includes(t.closeResponse ?? '');

export const isClosed = (st: StatusModel, s: string) => st.closed.includes(s);

export interface SlaInfo {
  cls: 'ok' | 'soon' | 'over' | 'pause';
  txt: string;
  due: Date;
}

/** Same rules as the artifact's slaInfo(): Met/Breached when closed; Paused; Awaiting approval; Overdue; Due in; On track. */
export function slaInfo(t: SlaTicket, closed: boolean, nowMs: number): SlaInfo {
  if (closed && t.slaStarted === false) return { cls: 'pause', txt: 'Not started', due: t.resolutionDue };
  if (closed) {
    const met = !!t.closedAt && t.closedAt.getTime() <= t.resolutionDue.getTime();
    return { cls: met ? 'ok' : 'over', txt: met ? 'Met' : 'Breached', due: t.resolutionDue };
  }
  if (t.status === 'Pending approval') return { cls: 'pause', txt: 'Awaiting approval', due: t.resolutionDue };
  if (t.paused) return { cls: 'pause', txt: 'Paused', due: t.resolutionDue };
  const left = t.resolutionDue.getTime() - nowMs;
  if (left < 0) return { cls: 'over', txt: 'Overdue ' + dur(left), due: t.resolutionDue };
  if (left < 86400000) return { cls: 'soon', txt: 'Due in ' + dur(left), due: t.resolutionDue };
  return { cls: 'ok', txt: 'On track', due: t.resolutionDue };
}

export const isOverdue = (t: SlaTicket, closed: boolean, nowMs: number) =>
  !closed && !t.paused && t.status !== 'Pending approval' && t.slaStarted !== false && t.resolutionDue.getTime() < nowMs;
export const isAtRisk = (t: SlaTicket, closed: boolean, nowMs: number) =>
  !closed && !t.paused && t.status !== 'Pending approval' && t.slaStarted !== false && t.resolutionDue.getTime() >= nowMs && t.resolutionDue.getTime() - nowMs < 86400000;
export const isBreachedRes = (t: SlaTicket, closed: boolean, nowMs: number) =>
  slaCounts(t) && (closed ? !!t.closedAt && t.closedAt.getTime() > t.resolutionDue.getTime() : isOverdue(t, closed, nowMs));

/**
 * First response outcome. ResponseMet can be NULL on imported/Salesforce-shaped tickets, so derive
 * the outcome from the first public reply (or the due time when there was no reply).
 */
export const isResponseBreached = (t: SlaTicket, nowMs: number) => {
  if (!slaCounts(t) || t.slaStarted === false || t.status === 'Pending approval') return false;
  if (t.responseMet !== null) return !t.responseMet;
  return (t.firstReply?.getTime() ?? nowMs) > t.responseDue.getTime();
};

/** A ticket counts as escalated if it moved up the ladder or anyone escalated it manually. */
export const hasEscalation = (t: SlaTicket) =>
  t.escalationLevel > 0 || t.status === 'Escalated' || !!t.escLog?.length;

/** How many ladder levels a ticket has crossed, capped at the levels after its cover base. */
export function escalationReached(usedPct: number, base: number, currentLevel: number, thresholds: number[]): number {
  const available = Math.max(0, thresholds.length - Math.max(0, base));
  const crossed = thresholds.slice(Math.max(0, base)).filter((pct) => usedPct >= pct).length;
  return Math.max(currentLevel, Math.min(available, crossed));
}

/** UI status (Open, In Progress, Pending Input, Resolved, Rejected, Cancelled) for a helpdesk status. */
export function uiOf(st: StatusModel, uiMap: Record<string, string>, s: string, closeResponse?: string | null): string {
  if (st.closed.includes(s)) {
    const c = s === 'Closed' && closeResponse ? closeResponse : s;
    return c === 'Rejected' ? 'Rejected' : c === 'Cancelled' ? 'Cancelled' : 'Resolved';
  }
  return uiMap[s] || 'Open';
}

/** Evaluates a schema condition against form values. */
export function evalCond(c: Condition | boolean | null | undefined, f: Record<string, unknown>): boolean {
  if (c === null || c === undefined) return false;
  if (typeof c === 'boolean') return c;
  if ('all' in c) return c.all.every((x) => evalCond(x, f));
  if ('any' in c) return c.any.some((x) => evalCond(x, f));
  const v = f[c.field];
  switch (c.op) {
    case 'eq': return v === c.value;
    case 'neq': return v !== c.value;
    case 'in': return Array.isArray(c.value) && c.value.includes(v as string);
    case 'notIn': return Array.isArray(c.value) && !c.value.includes(v as string);
    case 'set': return c.value ? !!v : !v;
    default: return false;
  }
}
