import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { clock, istDate } from '../common/clock';
import { CommentEntity, NotificationEntity } from '../database/entities';
import { allowedHds, canWork, hdAllowed, isHeadish, isWorker, PRIORITY_VISIBLE_TO_REQUESTER } from '../domain/policy';
import { Principal } from '../domain/types';
import { HelpdeskConfigService } from '../helpdesk-config/config.service';
import { Row, TicketLoader } from '../tickets/ticket-loader.service';
import { TicketQueryService } from '../tickets/ticket-query.service';
import { inRange, Metrics, metrics } from './metrics';

const HD_ORDER = ['HR', 'LND', 'IT', 'ADM', 'SF'];
const durTxt = (ms: number | null) => (ms == null ? '—' : ms < 3600000 ? `${Math.max(1, Math.round(ms / 60000))} min` : ms < 86400000 ? `${(ms / 3600000).toFixed(1)} h` : `${(ms / 86400000).toFixed(1)} days`);

/** Dashboard analytics, scoped by role. Every number comes from metrics(), so cards, charts and lists agree. */
@Injectable()
export class AnalyticsService {
  constructor(private readonly loader: TicketLoader, private readonly q: TicketQueryService, private readonly cfg: HelpdeskConfigService) {}

  scopes(u: Principal): [string, string][] {
    const s: [string, string][] = [['own', 'My tickets']];
    if (isWorker(u)) s.push(['work', 'My work and queues']);
    if (isHeadish(u)) s.push(['org', 'Helpdesk-wide']);
    return s;
  }

  /** Range → first IST date it covers. "Last 7 days" is today and the six days before it. */
  static rangeStart(range: string, now = clock.now()): { rng: string; fromDate: string; label: string; days: number } {
    const rng = ['7', '30', '90', 'year'].includes(range) ? range : '30';
    if (rng === 'year') {
      const fromDate = `${istDate(now).slice(0, 4)}-01-01`;
      const days = Math.round((Date.parse(`${istDate(now)}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000) + 1;
      return { rng, fromDate, label: 'this year', days };
    }
    const days = Number(rng);
    return { rng, fromDate: istDate(new Date(now.getTime() - (days - 1) * 86400000)), label: `last ${rng} days`, days };
  }

  /** First public reply by someone other than the requester, for each ticket. */
  async firstReplies(rows: Row[]): Promise<Map<string, Date>> {
    const keys = rows.map((r) => r.t.key);
    const out = new Map<string, Date>();
    if (!keys.length) return out;
    const req = new Map(rows.map((r) => [r.t.key, r.t.requesterId]));
    const cs = await this.loader.ds.getRepository(CommentEntity).find({ where: { ticketKey: In(keys), internal: false }, order: { createdAt: 'ASC', id: 'ASC' } });
    for (const c of cs) if (c.authorId !== req.get(c.ticketKey) && !out.has(c.ticketKey)) out.set(c.ticketKey, c.createdAt);
    return out;
  }

  /** Rows for a scope: own = raised by me, work = tickets I can work, org = everything I may see. */
  async scopeRows(u: Principal, scope: string, hd: string): Promise<Row[]> {
    const visible = await this.loader.visible(u);
    let rows = scope === 'work' ? visible.filter((r) => canWork(u, r.ctx)) : scope === 'org' ? visible : visible.filter((r) => r.t.requesterId === u.id);
    if (hd !== 'ALL') rows = rows.filter((r) => r.t.helpdesk === hd);
    return rows;
  }

  async compute(u: Principal, rows: Row[], fromDate: string): Promise<Metrics> {
    return metrics(rows, {
      now: clock.nowMs(), fromDate, uiStatus: (r) => this.q.uiStatus(r), isWaiting: (r) => this.q.isWaiting(r),
      isQueue: (id) => !!this.cfg.person(id)?.isQueue, reopened: await this.q.wasReopened(rows.map((r) => r.t.key)),
      firstReply: await this.firstReplies(rows.filter((r) => inRange(r, fromDate))),
    });
  }

  async get(u: Principal, scopeIn?: string, hdIn = 'ALL', range = '30') {
    const scopes = this.scopes(u);
    const scope = scopes.some((x) => x[0] === scopeIn) ? scopeIn! : scopes[scopes.length - 1][0];
    const hds = allowedHds(u);
    const hd = hdIn !== 'ALL' && hds.includes(hdIn as never) ? hdIn : 'ALL';
    const rows = await this.scopeRows(u, scope, hd);
    const now = clock.nowMs();
    const { rng, fromDate, label: rl, days } = AnalyticsService.rangeStart(range);
    const m = await this.compute(u, rows, fromDate);
    const L = m.live, P = m.period;
    const sfOk = hdAllowed(u, 'SF');
    const R = { from: fromDate };
    const cards = [
      { k: 'open', g: 'live', chip: 'Live', l: 'Open', n: L.open, h: `${L.notStarted} not started · ${L.inProgress} in progress · ${L.pendingInput} pending input`, ic: 'file', tone: 'accent', f: 'Every ticket that is not closed: Not started + In progress + Pending input.', go: {} },
      { k: 'notstarted', g: 'live', chip: 'Live', l: 'Not started', n: L.notStarted, h: 'Waiting to be picked up', ic: 'file', tone: 'info', f: 'Open tickets whose status maps to Not started: New, Open, Assigned, Reopened.', go: { status: 'ui:Open' } },
      { k: 'progress', g: 'live', chip: 'Live', l: 'In progress', n: L.inProgress, h: 'Being worked on, on hold or scheduled', ic: 'clock', tone: 'info', f: 'Open tickets whose status maps to In progress.', go: { status: 'ui:In Progress' } },
      { k: 'pending', g: 'live', chip: 'Live', l: 'Pending input', n: L.pendingInput, h: `${L.waitRequester} waiting for requester · ${L.waitApproval} waiting for approval`, ic: 'users', tone: 'warn', f: 'Open tickets waiting for the requester or for an approval.', go: { status: 'ui:Pending Input' } },
      { k: 'esc', g: 'attention', chip: 'Live', l: 'Escalated', n: L.escalated, h: `of ${L.open} open`, ic: 'up', tone: 'esc', f: `Open tickets at escalation level 1 or higher${sfOk ? ', or with Salesforce status Escalated' : ''}.`, go: { flag: 'escalated' } },
      { k: 'over', g: 'attention', chip: 'Live', l: 'Overdue', n: L.overdue, h: `of ${L.open} open`, ic: 'flag', tone: 'over', f: 'Open, SLA running, not paused, past the resolution due time.', go: { flag: 'overdue' } },
      { k: 'risk', g: 'attention', chip: 'Live', l: 'At risk', n: L.atRisk, h: `of ${L.open} open`, ic: 'clock', tone: 'warn', f: 'Open, SLA running, not paused, resolution due within the next 24 hours.', go: { flag: 'atrisk' } },
      { k: 'unasg', g: 'attention', chip: 'Live', l: 'Unassigned', n: L.unassigned, h: `of ${L.open} open`, ic: 'users', tone: 'info', f: 'Open tickets still held by a queue.', go: { flag: 'unassigned' } },
      { k: 'raised', g: 'range', chip: 'In date range', l: 'Raised', n: P.raised, h: `Raised ${rl}`, ic: 'plus', tone: 'accent', f: 'Tickets raised in the date range, open or closed.', go: R },
      { k: 'closed', g: 'range', chip: 'In date range', l: 'Closed', n: P.closed, h: `${P.resolved} resolved · ${P.rejected} rejected · ${P.cancelled} cancelled`, ic: 'check', tone: 'ok', f: 'Tickets raised in the date range that are now closed.', go: { ...R, tab: 'closed' } },
      { k: 'reopened', g: 'range', chip: 'In date range', l: 'Reopened', n: P.reopened, h: 'Raised in range, reopened at least once', ic: 'up', tone: 'warn', f: 'Tickets raised in the date range that were reopened by the requester.', go: { ...R, flag: 'reopened' } },
      { k: 'breach', g: 'range', chip: 'In date range', l: 'SLA breached', n: P.breached, h: `${P.responseBreached} response · ${P.resolutionBreached} resolution`, ic: 'flag', tone: 'bad', f: 'Tickets raised in the date range that missed the first-response or resolution target. Rejected, cancelled and never-started tickets are left out.', go: { ...R, flag: 'breached' } },
      { k: 'first', g: 'range', chip: 'In date range', l: 'Avg first response', n: durTxt(P.avgFirstMs), h: `${P.firstN} ticket${P.firstN === 1 ? '' : 's'} answered`, ic: 'clock', tone: 'info', f: 'Average time from SLA start to the first public reply by staff, for tickets raised in the date range.', go: R },
      { k: 'resolve', g: 'range', chip: 'In date range', l: 'Avg resolution', n: durTxt(P.avgResolutionMs), h: `${P.resolutionN} ticket${P.resolutionN === 1 ? '' : 's'} resolved`, ic: 'check', tone: 'info', f: 'Average time from SLA start to resolution, for resolved tickets raised in the date range.', go: { ...R, tab: 'closed' } },
    ];
    const cohort = rows.filter((r) => inRange(r, fromDate));
    const open = rows.filter((r) => !r.closed);
    const visHds = hds.filter((h) => hd === 'ALL' || h === hd);
    const byHd = visHds.map((h) => ({ label: this.cfg.helpdeskLabel(h), n: cohort.filter((r) => r.t.helpdesk === h).length, color: `var(--c-${h})`, v: 'hd:' + h }));
    const pris = ['Critical', 'High', 'Medium', 'Low'].filter((p) => visHds.some((h) => this.cfg.priorities(h).includes(p)));
    const priOk = PRIORITY_VISIBLE_TO_REQUESTER || isWorker(u) || isHeadish(u);
    const byPri = priOk ? pris.map((p) => ({ label: p, n: cohort.filter((r) => r.t.priority === p).length, v: 'pri:' + p })) : [];
    const cm = new Map<string, number>();
    cohort.forEach((r) => cm.set(`${r.t.helpdesk}.${r.t.categoryKey}`, (cm.get(`${r.t.helpdesk}.${r.t.categoryKey}`) || 0) + 1));
    const rank = (k: string) => { const [h, c] = k.split('.'); return HD_ORDER.indexOf(h) * 1000 + this.cfg.categories(h).findIndex((x) => x.key === c); };
    const sorted = [...cm.entries()].sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]));
    const topCats: { label: string; n: number; v?: string }[] = sorted.slice(0, 5).map(([k, n]) => {
      const [h, c] = k.split('.');
      return { label: `${this.cfg.helpdeskLabel(h)} · ${this.cfg.category(h, c)?.name ?? c}`, n, v: 'cat:' + k };
    });
    const other = sorted.slice(5).reduce((a, [, n]) => a + n, 0);
    if (other) topCats.push({ label: 'Other categories', n: other });
    const series = Array.from({ length: days }, (_, i) => {
      const d = istDate(new Date(now - (days - 1 - i) * 86400000));
      return { d, n: cohort.filter((r) => istDate(r.t.createdAt) === d).length };
    });
    const ageing = ([['Under 1 day', 0, 1], ['1 to 3 days', 1, 3], ['3 to 7 days', 3, 7], ['Over 7 days', 7, 1e9]] as [string, number, number][]).map(([label, lo, hi]) => ({
      label, n: open.filter((r) => { const d = (now - r.t.createdAt.getTime()) / 864e5; return d >= lo && d < hi; }).length,
    }));
    const updates = await this.loader.ds.getRepository(NotificationEntity).find({ where: { userId: u.id }, order: { createdAt: 'DESC', id: 'DESC' }, take: 6 });
    return {
      scope, scopes, hd, range: rng, rangeLabel: rl, fromDate, openCount: open.length, priorityVisible: priOk,
      note: { own: 'Tickets you raised', work: 'Tickets assigned to you and in the queues you work', org: 'Every ticket you are allowed to see' }[scope],
      cards, metrics: m, charts: { byHd, byPri, topCats, series, ageing }, updates,
    };
  }
}
