import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { clock, istDate } from '../common/clock';
import { forbidden } from '../common/errors';
import { CommentEntity, EventEntity, TicketEntity } from '../database/entities';
import { allowedHds, isWorker } from '../domain/policy';
import { isOverdue, isResponseBreached, slaCounts } from '../domain/sla';
import { Principal } from '../domain/types';
import { AnalyticsService } from '../analytics/analytics.service';
import { AuditService } from '../audit/audit.service';
import { HelpdeskConfigService } from '../helpdesk-config/config.service';
import { holderAt, intervals, startsIn } from './intervals';

const HDL: Record<string, string> = { HR: 'HR', LND: 'L&D', IT: 'IT and Support', ADM: 'Admin Desk', SF: 'Salesforce' };

/** Report columns. Assigned = the eight outcomes added up; SLA breached is derived. */
export const COLS = [
  'assigned', 'withinSla', 'late', 'escSla', 'escManual', 'reManual', 'reAbsence', 'open', 'rejected',
  'respWithin', 'respBreached', 'slaBreached', 'recvEsc', 'recvReasg', 'covered', 'overdueNow',
] as const;
export type Col = (typeof COLS)[number];

export interface PerfRow {
  id: string; userId: string; name: string; title: string | null; helpdesk: string | null; category: string | null; isQueue: boolean;
  counts: Record<Col, number>; drill: Record<Col, string[]>; avgFirstMs: number | null; avgResolutionMs: number | null;
}

const blank = (): { counts: Record<Col, number>; drill: Record<Col, string[]> } => ({
  counts: Object.fromEntries(COLS.map((c) => [c, 0])) as Record<Col, number>,
  drill: Object.fromEntries(COLS.map((c) => [c, [] as string[]])) as Record<Col, string[]>,
});

/**
 * Assignee performance from holder intervals. A direct interval (routed, cover, queue claim) has
 * exactly one outcome; received tickets (by escalation or reassignment) are counted separately, so
 * nobody is blamed for time a ticket spent with someone else.
 */
@Injectable()
export class PerformanceService {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly cfg: HelpdeskConfigService, private readonly audit: AuditService) {}

  async report(u: Principal, b: { hd?: string; range?: string; q?: string; group?: string; only?: string }) {
    const hds = allowedHds(u);
    const scope = b.hd && hds.includes(b.hd as never) ? b.hd : 'ALL';
    const { rng, fromDate, label } = AnalyticsService.rangeStart(b.range ?? '30');
    const group = b.group === 'category' ? 'category' : 'assignee';
    const now = clock.nowMs();
    const all = await this.ds.getRepository(TicketEntity).find({ where: scope === 'ALL' ? { helpdesk: In(hds) } : { helpdesk: scope as never } });
    const closedOf = (t: TicketEntity) => this.cfg.statusModel(t.helpdesk).closed.includes(t.status);
    const keys = all.map((t) => t.key);
    const [comments, evs] = keys.length
      ? await Promise.all([
          this.ds.getRepository(CommentEntity).find({ where: { ticketKey: In(keys), internal: false }, order: { createdAt: 'ASC', id: 'ASC' } }),
          this.ds.getRepository(EventEntity).find({ where: { ticketKey: In(keys) } }),
        ])
      : [[], []];
    const firstReply = new Map<string, number>();
    const byKey = new Map(all.map((t) => [t.key, t]));
    for (const c of comments) if (c.authorId !== byKey.get(c.ticketKey)?.requesterId && !firstReply.has(c.ticketKey)) firstReply.set(c.ticketKey, c.createdAt.getTime());
    const noCover = new Set(evs.filter((e) => e.text.startsWith('No cover available')).map((e) => e.ticketKey));

    const rows = new Map<string, PerfRow & { fr: number[]; res: number[] }>();
    const queue = { ...blank(), tickets: new Set<string>() };
    const rowFor = (holder: string, hd: string, cat: string) => {
      const p = this.cfg.person(holder);
      const id = group === 'category' ? `${holder}|${hd}.${cat}` : holder;
      let r = rows.get(id);
      if (!r) {
        r = {
          id, userId: holder, name: p?.name ?? holder, title: p?.title ?? null, isQueue: false,
          helpdesk: group === 'category' ? hd : null, category: group === 'category' ? `${HDL[hd] ?? hd} · ${this.cfg.category(hd, cat)?.name ?? cat}` : null,
          ...blank(), avgFirstMs: null, avgResolutionMs: null, fr: [], res: [],
        };
        rows.set(id, r);
      }
      return r;
    };
    const add = (r: { counts: Record<Col, number>; drill: Record<Col, string[]> }, c: Col, key: string) => {
      r.counts[c]++;
      if (!r.drill[c].includes(key)) r.drill[c].push(key);
    };
    let escHandovers = 0, escInherited = 0, directTotal = 0;
    const tickets = new Set<string>();
    for (const t of all) {
      const closed = closedOf(t);
      const ivs = intervals(t, closed, now);
      for (const iv of ivs) {
        const isQ = !!this.cfg.person(iv.holder)?.isQueue;
        const target = isQ ? queue : null;
        if (!startsIn(iv, fromDate)) continue;
        if (iv.outcome === 'escSla' || iv.outcome === 'escManual') {
          escHandovers++;
          if (iv.kind !== 'direct') escInherited++;
        }
        if (iv.kind !== 'direct') {
          if (!isQ) add(rowFor(iv.holder, t.helpdesk, t.categoryKey), iv.kind === 'escalation' ? 'recvEsc' : 'recvReasg', t.key);
          if (!isQ && (iv.outcome === 'withinSla' || iv.outcome === 'late')) this.resolution(rowFor(iv.holder, t.helpdesk, t.categoryKey), t);
          continue;
        }
        directTotal++;
        tickets.add(t.key);
        const r = target ?? rowFor(iv.holder, t.helpdesk, t.categoryKey);
        add(r, 'assigned', t.key);
        add(r, iv.outcome as Col, t.key);
        if (iv.cover) add(r, 'covered', t.key);
        if (iv.outcome === 'late' || iv.outcome === 'escSla' || iv.overdue) add(r, 'slaBreached', t.key);
        if (isQ) queue.tickets.add(t.key);
        else if (iv.outcome === 'withinSla' || iv.outcome === 'late') this.resolution(r as PerfRow & { res: number[] }, t);
      }
      // First response: credited to whoever held the ticket when it was answered (or when it fell due).
      // Null responseMet is derived from the first public reply so Salesforce is not silently skipped.
      if (istDate(t.createdAt) >= fromDate && slaCounts(t)) {
        const at = firstReply.get(t.key) ?? t.responseDue.getTime();
        const breached = isResponseBreached({ ...t, firstReply: firstReply.has(t.key) ? new Date(firstReply.get(t.key)!) : null }, now);
        const who = holderAt(t, at);
        const col = breached ? 'respBreached' : 'respWithin';
        if (this.cfg.person(who)?.isQueue) add(queue, col, t.key);
        else {
          const r = rowFor(who, t.helpdesk, t.categoryKey);
          add(r, col, t.key);
          if (firstReply.has(t.key)) r.fr.push(firstReply.get(t.key)! - (t.slaStart ?? t.createdAt).getTime());
        }
      }
      // Overdue now: live, credited to the current holder, so it adds up to the dashboard Overdue card.
      if (!closed && isOverdue(t, false, now)) {
        const h = holderAt(t, now);
        if (this.cfg.person(h)?.isQueue) add(queue, 'overdueNow', t.key);
        else add(rowFor(h, t.helpdesk, t.categoryKey), 'overdueNow', t.key);
      }
    }
    const q = (b.q ?? '').trim().toLowerCase();
    let list = [...rows.values()].map(({ fr, res, ...r }) => ({ ...r, avgFirstMs: avg(fr), avgResolutionMs: avg(res) }));
    if (b.only) list = list.filter((r) => r.userId === b.only);
    if (q) list = list.filter((r) => `${r.name} ${r.category ?? ''}`.toLowerCase().includes(q));
    list.sort((a, c) => c.counts.assigned - a.counts.assigned || a.name.localeCompare(c.name));
    const sum = (c: Col) => list.reduce((s, r) => s + r.counts[c], 0);
    const peopleAssigned = [...rows.values()].reduce((s, r) => s + r.counts.assigned, 0);
    const overdueCard = all.filter((t) => !closedOf(t) && isOverdue(t, false, now)).length;
    const unattended = all.filter((t) => noCover.has(t.key) && !closedOf(t)).map((t) => ({
      key: t.key, title: t.title, helpdesk: t.helpdesk, assignee: this.cfg.name(t.assigneeId), status: t.status, createdAt: t.createdAt,
    }));
    return {
      scope, scopes: [['ALL', 'All helpdesks'], ...hds.map((h) => [h, HDL[h]] as [string, string])], range: rng, rangeLabel: label, fromDate, group,
      cards: [
        { k: 'assigned', l: 'Tickets assigned', n: sum('assigned'), h: `${list.length} ${group === 'category' ? 'rows' : `assignee${list.length === 1 ? '' : 's'}`} · ${queue.counts.assigned} in queues`, ic: 'file', tone: 'accent' },
        { k: 'withinSla', l: 'Resolved within SLA', n: sum('withinSla'), h: 'resolved before the resolution target', ic: 'check', tone: 'ok' },
        { k: 'late', l: 'Resolved late', n: sum('late'), h: 'resolved after the resolution target', ic: 'clock', tone: 'bad' },
        { k: 'escSla', l: 'Escalated', n: sum('escSla') + sum('escManual'), h: `${sum('escSla')} by SLA · ${sum('escManual')} manually`, ic: 'up', tone: 'esc' },
        { k: 'reManual', l: 'Reassigned', n: sum('reManual') + sum('reAbsence'), h: `${sum('reManual')} manually · ${sum('reAbsence')} for absence`, ic: 'users', tone: 'info' },
        { k: 'slaBreached', l: 'SLA breached', n: sum('slaBreached'), h: 'resolved late + escalated by SLA + overdue', ic: 'flag', tone: 'bad' },
      ],
      rows: list,
      unassigned: { counts: queue.counts, drill: queue.drill },
      unattended,
      reconciliation: {
        peopleAssigned, queueAssigned: queue.counts.assigned, directTotal, tickets: tickets.size,
        escHandovers, escDirect: escHandovers - escInherited, escInherited,
        overdueRows: [...rows.values()].reduce((s, r) => s + r.counts.overdueNow, 0) + queue.counts.overdueNow, overdueCard,
      },
    };
  }

  private resolution(r: { res?: number[] }, t: TicketEntity) {
    if (t.closedAt && r.res) r.res.push(t.closedAt.getTime() - (t.slaStart ?? t.createdAt).getTime());
  }

  /** My performance: the worker's own rows only, grouped by category. */
  async mine(u: Principal, b: { range?: string }) {
    if (!isWorker(u)) throw forbidden('My performance is for people who work tickets.', 'NOT_A_WORKER');
    const r = await this.report(u, { range: b.range, group: 'category', only: u.id });
    await this.audit.record(u.id, 'report.performance', 'Opened My performance', { target: u.id });
    return { ...r, unattended: [], unassigned: null, scopes: [] };
  }

  log(u: Principal, event: string, detail: string) {
    const what: Record<string, string> = { open: 'Opened Assignee performance', filter: 'Filtered Assignee performance', export: 'Exported Assignee performance as CSV' };
    return this.audit.record(u.id, 'report.performance', `${what[event] ?? 'Viewed Assignee performance'}${detail ? ` · ${detail}` : ''}`);
  }
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
