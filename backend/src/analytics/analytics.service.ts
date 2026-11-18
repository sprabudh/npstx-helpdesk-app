import { Injectable } from '@nestjs/common';
import { clock, istDate } from '../common/clock';
import { NotificationEntity } from '../database/entities';
import { allowedHds, canWork, hdAllowed, isHeadish, isWorker } from '../domain/policy';
import { isAtRisk, isBreachedRes, isOverdue } from '../domain/sla';
import { Principal } from '../domain/types';
import { HelpdeskConfigService } from '../helpdesk-config/config.service';
import { Row, TicketLoader } from '../tickets/ticket-loader.service';
import { TicketQueryService } from '../tickets/ticket-query.service';

/** Dashboard analytics: 6 headline cards and the charts, scoped by role (SDD 10.1, analytics card definitions). */
@Injectable()
export class AnalyticsService {
  constructor(private readonly loader: TicketLoader, private readonly q: TicketQueryService, private readonly cfg: HelpdeskConfigService) {}

  scopes(u: Principal): [string, string][] {
    const s: [string, string][] = [['own', 'My tickets']];
    if (isWorker(u)) s.push(['work', 'My work and queues']);
    if (isHeadish(u)) s.push(['org', 'Helpdesk-wide']);
    return s;
  }

  async get(u: Principal, scopeIn?: string, hdIn = 'ALL', range = '30') {
    const scopes = this.scopes(u);
    const scope = scopes.some((x) => x[0] === scopeIn) ? scopeIn! : scopes[scopes.length - 1][0];
    const hds = allowedHds(u);
    const hd = hdIn !== 'ALL' && hds.includes(hdIn as never) ? hdIn : 'ALL';
    const visible = await this.loader.visible(u);
    let rows = scope === 'work' ? visible.filter((r) => canWork(u, r.ctx)) : scope === 'org' ? visible : visible.filter((r) => r.t.requesterId === u.id);
    if (hd !== 'ALL') rows = rows.filter((r) => r.t.helpdesk === hd);
    const now = clock.nowMs();
    const rng = ['7', '30', '90', 'year'].includes(range) ? range : '30';
    const st = rng === 'year' ? Date.parse(`${istDate(clock.now()).slice(0, 4)}-01-01T00:00:00+05:30`) : now - Number(rng) * 86400000;
    const span = now - st;
    const inR = (r: Row) => r.t.createdAt.getTime() >= st;
    const prevR = (r: Row) => r.t.createdAt.getTime() >= st - span && r.t.createdAt.getTime() < st;
    const open = rows.filter((r) => !r.closed);
    const ui = (b: string) => open.filter((r) => this.q.uiStatus(r) === b);
    const total = rows.filter(inR).length, prev = rows.filter(prevR).length, delta = total - prev;
    const resp = rows.filter((r) => r.t.responseMet === false), resB = rows.filter((r) => isBreachedRes(r.t, r.closed, now));
    const br = new Set([...resp, ...resB]);
    const reopened = await this.q.wasReopened(rows.map((r) => r.t.key));
    const flag = (f: string) => this.q.flagFn(f, u, reopened);
    const escN = open.filter(flag('escalated')).length, risk = open.filter((r) => isAtRisk(r.t, r.closed, now)).length;
    const over = open.filter((r) => isOverdue(r.t, r.closed, now)).length;
    const rl = rng === 'year' ? 'this year' : `last ${rng} days`;
    const sfOk = hdAllowed(u, 'SF');
    const fromDate = istDate(new Date(st));
    const cards = [
      { k: 'total', l: 'Total tickets', n: total, h: `Raised ${rl} · ${delta === 0 ? 'same as' : delta > 0 ? `▲ ${delta} vs` : `▼ ${-delta} vs`} previous`, ic: 'file', tone: 'accent', f: 'Tickets raised in the date range. Trend compares with the period just before it.', go: { from: fromDate } },
      { k: 'open', l: 'Open', n: ui('Open').length, h: 'Waiting to be picked up', ic: 'file', tone: 'info', f: 'Open tickets whose status maps to Open: New, Open, Assigned, Reopened.', go: { status: 'ui:Open' } },
      { k: 'esc', l: 'Escalated', n: escN, h: 'Open, at any escalation level', ic: 'up', tone: 'esc', f: `Open tickets at escalation level 1 or higher${sfOk ? ', or with Salesforce status Escalated' : ''}.`, go: { flag: 'escalated' } },
      { k: 'breach', l: 'SLA breached', n: br.size, h: `${resp.length} response · ${resB.length} resolution`, ic: 'flag', tone: 'bad', f: 'Tickets that missed the first-response target, or the resolution target (open past due, or closed late).', go: { flag: 'breached' } },
      { k: 'over', l: 'Overdue', n: over, h: 'Open and past resolution due', ic: 'flag', tone: 'over', f: 'Open, not paused, past the resolution due time.', go: { flag: 'overdue' } },
      { k: 'risk', l: 'At risk', n: risk, h: 'Resolution due within 24 h', ic: 'clock', tone: 'warn', f: 'Open, not paused, resolution due within the next 24 hours.', go: { flag: 'atrisk' } },
    ];
    const visHds = hds.filter((h) => hd === 'ALL' || h === hd);
    const byHd = visHds.map((h) => ({ label: this.cfg.helpdeskLabel(h), n: rows.filter((r) => r.t.helpdesk === h && inR(r)).length, color: `var(--c-${h})`, v: 'hd:' + h }));
    const pris = ['Critical', 'High', 'Medium', 'Low'].filter((p) => visHds.some((h) => this.cfg.priorities(h).includes(p)));
    const byPri = pris.map((p) => ({ label: p, n: rows.filter((r) => r.t.priority === p && inR(r)).length, v: 'pri:' + p }));
    const cm = new Map<string, number>();
    rows.filter(inR).forEach((r) => cm.set(`${r.t.helpdesk}.${r.t.categoryKey}`, (cm.get(`${r.t.helpdesk}.${r.t.categoryKey}`) || 0) + 1));
    const HD_ORDER = ['HR', 'LND', 'IT', 'ADM', 'SF'];
    const rank = (k: string) => { const [h, c] = k.split('.'); return HD_ORDER.indexOf(h) * 1000 + this.cfg.categories(h).findIndex((x) => x.key === c); };
    // Ties: helpdesk order, then category order (the mock used its sample-data order).
    const topCats = [...cm.entries()].sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0])).slice(0, 5).map(([k, n]) => {
      const [h, c] = k.split('.');
      return { label: `${this.cfg.helpdeskLabel(h)} · ${this.cfg.category(h, c)?.name ?? c}`, n, v: 'cat:' + k };
    });
    const series = Array.from({ length: 30 }, (_, i) => {
      const d = istDate(new Date(now - (29 - i) * 86400000));
      return { d, n: rows.filter((r) => istDate(r.t.createdAt) === d).length };
    });
    const ageing = ([['Under 1 day', 0, 1], ['1 to 3 days', 1, 3], ['3 to 7 days', 3, 7], ['Over 7 days', 7, 1e9]] as [string, number, number][]).map(([label, lo, hi]) => ({
      label, n: open.filter((r) => { const d = (now - r.t.createdAt.getTime()) / 864e5; return d >= lo && d < hi; }).length,
    }));
    const updates = await this.loader.ds.getRepository(NotificationEntity).find({ where: { userId: u.id }, order: { createdAt: 'DESC', id: 'DESC' }, take: 6 });
    return {
      scope, scopes, hd, range: rng, rangeLabel: rl, openCount: open.length,
      note: { own: 'Tickets you raised', work: 'Tickets assigned to you and in the queues you work', org: 'Every ticket you are allowed to see' }[scope],
      cards, charts: { byHd, byPri, topCats, series, ageing }, updates,
    };
  }
}
