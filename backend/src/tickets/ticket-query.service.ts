import { Injectable } from '@nestjs/common';
import { In, IsNull } from 'typeorm';
import { clock, istDate } from '../common/clock';
import { badRequest } from '../common/errors';
import {
  AttachmentEntity, CommentEntity, EventEntity, NotificationEntity, SfCaseEntity, SfCaseTeamEntity, SfChildCaseEntity, TicketEntity,
} from '../database/entities';
import {
  allowedHds, apMgr, approvalStage, canAddPeople, canView, canWork, chainOf, has, isApprover, isHeadish, isReadOnly, isWorker, relOf,
  reopenDays, reopenInfo, stm, viewsFor, whyVisible,
} from '../domain/policy';
import { isAtRisk, isBreachedRes, isOverdue, slaCounts, slaInfo, uiOf } from '../domain/sla';
import { Principal } from '../domain/types';
import { HelpdeskConfigService } from '../helpdesk-config/config.service';
import { CoverService } from './cover.service';
import { Row, TicketLoader } from './ticket-loader.service';

export interface ListQuery {
  view?: string; hd?: string; tab?: 'open' | 'closed'; cat?: string; pri?: string; status?: string; reason?: string;
  flag?: string; q?: string; from?: string; to?: string; sort?: string; dir?: 'asc' | 'desc'; page?: number; size?: number;
}

const PR: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
export const FLAG_LABELS: Record<string, string> = {
  escalated: 'Escalated', breached: 'SLA breached', atrisk: 'At risk (due within 24 h)', overdue: 'Overdue', reopened: 'Reopened',
  unassigned: 'Unassigned (in a queue)', month: 'Closed this month', waitingme: 'Waiting for me',
  respbreached: 'Response SLA breached', resbreached: 'Resolution SLA breached', waitreq: 'Waiting for the requester', waitappr: 'Waiting for approval',
};

@Injectable()
export class TicketQueryService {
  constructor(private readonly loader: TicketLoader, private readonly cfg: HelpdeskConfigService, private readonly cover: CoverService) {}

  // ---------- shared helpers ----------
  uiStatus(r: Row) {
    return uiOf(this.cfg.statusModel(r.t.helpdesk), this.cfg.uiMap(r.t.helpdesk), r.t.status, r.t.closeResponse);
  }
  isWaiting(r: Row) {
    return r.t.status === this.cfg.statusModel(r.t.helpdesk).wait;
  }
  closedState(r: Row) {
    return stm(r.ctx) ? r.t.status : r.t.closeResponse || r.t.status;
  }
  pill(r: Row): { cls: string; label: string } {
    const s = r.t.status;
    let cls = 's-new';
    if (['In Progress', 'In progress', 'Working', 'Reopened', 'Scheduled'].includes(s)) cls = 's-prog';
    else if (this.isWaiting(r) || s === 'Pending approval') cls = 's-wait';
    else if (s === 'On hold' || s === 'On Hold') cls = 's-hold';
    else if (s === 'Escalated') cls = 's-esc';
    else if (r.closed) {
      const c = this.closedState(r);
      cls = c === 'Rejected' ? 's-bad' : c === 'Cancelled' ? 's-cancel' : 's-ok';
    }
    return { cls, label: r.closed && !stm(r.ctx) ? `Closed · ${r.t.closeResponse || ''}` : s };
  }
  wasReopened = async (keys: string[]): Promise<Set<string>> => {
    if (!keys.length) return new Set();
    const ev = await this.loader.ds.getRepository(EventEntity).createQueryBuilder('e').select('DISTINCT e.ticket_key', 'k')
      .where('e.ticket_key IN (:...keys)', { keys }).andWhere("e.text LIKE 'Reopened%'").getRawMany();
    return new Set(ev.map((x) => x.k));
  };
  flagFn(flag: string, u: Principal, reopened: Set<string>): (r: Row) => boolean {
    const now = clock.nowMs();
    const month = istDate(clock.now()).slice(0, 7);
    switch (flag) {
      case 'escalated': return (r) => !r.closed && (r.t.escalationLevel > 0 || r.t.status === 'Escalated');
      case 'breached': return (r) => slaCounts(r.t) && (r.t.responseMet === false || isBreachedRes(r.t, r.closed, now));
      case 'respbreached': return (r) => slaCounts(r.t) && r.t.responseMet === false;
      case 'resbreached': return (r) => isBreachedRes(r.t, r.closed, now);
      case 'waitreq': return (r) => !r.closed && this.isWaiting(r);
      case 'waitappr': return (r) => !r.closed && r.t.status === 'Pending approval';
      case 'atrisk': return (r) => isAtRisk(r.t, r.closed, now);
      case 'overdue': return (r) => isOverdue(r.t, r.closed, now);
      case 'reopened': return (r) => reopened.has(r.t.key);
      case 'unassigned': return (r) => !r.closed && !!this.cfg.person(r.t.assigneeId)?.isQueue;
      case 'month': return (r) => r.closed && !!r.t.closedAt && istDate(r.t.closedAt).slice(0, 7) === month;
      case 'waitingme': return (r) => (r.t.requesterId === u.id && this.isWaiting(r)) || !!approvalStage(u, r.ctx);
      default: throw badRequest(`Unknown filter "${flag}".`);
    }
  }
  person(id: string | null) {
    if (!id) return null;
    const p = this.cfg.person(id);
    return { id, name: p?.name ?? id, isQueue: !!p?.isQueue, dept: p?.dept ?? null, title: p?.title ?? null };
  }
  listItem(u: Principal, r: Row) {
    const t = r.t;
    const ro = reopenInfo({ ...r.ctx, closed: r.closed, categoryName: r.ctx.category?.name ?? t.categoryKey }, clock.nowMs());
    const f = r.ctx.followers.find((x) => x.userId === u.id);
    return {
      key: t.key, helpdesk: t.helpdesk, title: t.title, categoryKey: t.categoryKey, categoryName: r.ctx.category?.name ?? t.categoryKey,
      subCategory: t.subCategory, priority: t.priority, status: t.status, uiStatus: this.uiStatus(r), pill: this.pill(r), closed: r.closed,
      closeResponse: t.closeResponse, requester: this.person(t.requesterId), assignee: this.person(t.assigneeId), closedBy: this.person(t.closedById),
      createdAt: t.createdAt, updatedAt: t.updatedAt, closedAt: t.closedAt, sla: slaInfo(t, r.closed, clock.nowMs()),
      confidential: t.confidential, escalationLevel: t.escalationLevel, reopen: { ok: ro.ok && t.requesterId === u.id, short: ro.short },
      relation: f ? { relation: f.relation, addedBy: f.addedById === u.id ? 'you' : this.cfg.name(f.addedById) } : null,
      fields: { learningItem: t.fields?.learningItem ?? null, learningSource: t.fields?.learningSource ?? null },
    };
  }

  // ---------- My tickets / Assigned to me ----------
  async list(u: Principal, q: ListQuery) {
    const views = viewsFor(u);
    const assignedViews: [string, string][] = [['assigned', 'Assigned to me'], ['queues', 'My queues'], ['unassigned', 'Unassigned in my queues']];
    const valid = [...views, ...(isWorker(u) ? assignedViews : [])].map((v) => v[0]);
    const view = q.view && valid.includes(q.view) ? q.view : 'mine';
    let rows = await this.loader.visible(u);
    if (view === 'mine') rows = rows.filter((r) => r.t.requesterId === u.id);
    else if (view === 'assigned') rows = rows.filter((r) => r.t.assigneeId === u.id);
    else if (view === 'queue' || view === 'queues') rows = rows.filter((r) => canWork(u, r.ctx));
    else if (view === 'unassigned') rows = rows.filter((r) => canWork(u, r.ctx) && !!this.cfg.person(r.t.assigneeId)?.isQueue);
    else if (view === 'approvals') rows = rows.filter((r) => approvalStage(u, r.ctx));
    else if (view === 'hrall') rows = rows.filter((r) => r.t.helpdesk === 'HR');
    if (q.hd && q.hd !== 'ALL') rows = rows.filter((r) => r.t.helpdesk === q.hd);
    if (q.from) rows = rows.filter((r) => istDate(r.t.createdAt) >= q.from!);
    if (q.to) rows = rows.filter((r) => istDate(r.t.createdAt) <= q.to!);
    if (q.q) {
      const s = q.q.toLowerCase();
      rows = rows.filter((r) => [r.t.key, r.t.title, r.ctx.category?.name, r.t.subCategory, this.cfg.name(r.t.requesterId), this.cfg.name(r.t.assigneeId)].join(' ').toLowerCase().includes(s));
    }
    if (q.flag) {
      const fn = this.flagFn(q.flag, u, await this.wasReopened(rows.map((r) => r.t.key)));
      rows = rows.filter(fn);
    }
    // Category and priority apply to both tabs, so the tab counts add up to what a dashboard bar shows.
    const tab = q.tab === 'closed' ? 'closed' : 'open';
    const catRows = rows.filter((r) => (tab === 'open' ? !r.closed : r.closed));
    if (q.cat) rows = rows.filter((r) => `${r.t.helpdesk}.${r.t.categoryKey}` === q.cat);
    if (q.pri) rows = rows.filter((r) => r.t.priority === q.pri);
    const open = rows.filter((r) => !r.closed), closed = rows.filter((r) => r.closed);
    let list = tab === 'open' ? open : closed;
    if (tab === 'open') {
      if (q.status) list = list.filter((r) => (q.status!.startsWith('ui:') ? this.uiStatus(r) === q.status!.slice(3) : r.t.status === q.status));
    } else if (q.reason) list = list.filter((r) => this.closedState(r) === q.reason);
    const sort = q.sort || 'updated';
    const d = q.dir === 'asc' ? 1 : q.dir === 'desc' ? -1 : ['key', 'pri', 'sla'].includes(sort) ? 1 : -1;
    const key: Record<string, (r: Row) => number | string> = {
      key: (r) => r.t.key, pri: (r) => PR[r.t.priority] ?? 9, updated: (r) => r.t.updatedAt.getTime(), created: (r) => r.t.createdAt.getTime(),
      sla: (r) => r.t.resolutionDue.getTime(), closed: (r) => (r.t.closedAt ?? r.t.updatedAt).getTime(),
    };
    const kf = key[sort] ?? key.updated;
    list = [...list].sort((a, b) => (kf(a) > kf(b) ? 1 : kf(a) < kf(b) ? -1 : 0) * d);
    const size = Math.min(Math.max(Number(q.size) || 8, 1), 100);
    const pages = Math.max(1, Math.ceil(list.length / size));
    const page = Math.min(Math.max(Number(q.page) || 1, 1), pages);
    const cats = [...new Map(catRows.map((r) => [`${r.t.helpdesk}.${r.t.categoryKey}`, `${this.cfg.helpdeskLabel(r.t.helpdesk)} · ${r.ctx.category?.name ?? r.t.categoryKey}`])).entries()];
    return {
      view, tab, sort, dir: d === 1 ? 'asc' : 'desc', page, pages, size, total: list.length,
      counts: { open: open.length, closed: closed.length },
      rows: list.slice((page - 1) * size, page * size).map((r) => this.listItem(u, r)),
      options: { views: view === 'assigned' || view === 'queues' || view === 'unassigned' ? assignedViews : views, categories: cats, statuses: [...new Set(open.map((r) => r.t.status))] },
      flagLabel: q.flag ? FLAG_LABELS[q.flag] ?? null : null,
    };
  }

  /** Header search box: ticket id or title, only tickets the user can see. */
  async search(u: Principal, q: string) {
    const s = q.trim().toLowerCase();
    if (s.length < 1) return [];
    const rows = (await this.loader.visible(u)).filter((r) => r.t.key.toLowerCase().includes(s) || r.t.title.toLowerCase().includes(s));
    return rows.slice(0, 7).map((r) => this.listItem(u, r));
  }

  // ---------- Following / CC'd ----------
  async following(u: Principal, q: { rel?: string; src?: string; grp?: string }) {
    const rows = (await this.loader.visible(u)).filter((r) => r.t.requesterId !== u.id && relOf(r.ctx, u.id));
    const counts: Record<string, number> = { ALL: rows.length, FOLLOWER: 0, CC: 0, TAGGED: 0, CASE_TEAM: 0 };
    rows.forEach((r) => (counts[relOf(r.ctx, u.id)!] = (counts[relOf(r.ctx, u.id)!] || 0) + 1));
    let list = rows;
    if (q.rel && q.rel !== 'ALL') list = list.filter((r) => relOf(r.ctx, u.id) === q.rel);
    if (q.src && q.src !== 'ALL') list = list.filter((r) => r.t.helpdesk === q.src);
    list = list.filter((r) => (q.grp === 'closed' ? r.closed : !r.closed)).sort((a, b) => b.t.updatedAt.getTime() - a.t.updatedAt.getTime());
    return { counts, rows: list.map((r) => this.listItem(u, r)) };
  }

  // ---------- History ----------
  async history(u: Principal, q: { q?: string; from?: string; to?: string; hds?: string; states?: string; cat?: string; scope?: string }) {
    const scope = q.scope === 'all' && isHeadish(u) ? 'all' : q.scope === 'handled' && (isWorker(u) || isHeadish(u)) ? 'handled' : 'mine';
    let rows = (await this.loader.visible(u)).filter((r) => r.closed);
    const allCats = [...new Map(rows.map((r) => [`${r.t.helpdesk}.${r.t.categoryKey}`, `${this.cfg.helpdeskLabel(r.t.helpdesk)} · ${r.ctx.category?.name ?? r.t.categoryKey}`])).entries()];
    rows = rows.filter((r) => (scope === 'all' ? true : scope === 'mine' ? r.t.requesterId === u.id : r.t.closedById === u.id || r.t.assigneeId === u.id));
    if (q.q) rows = rows.filter((r) => `${r.t.key} ${r.t.title}`.toLowerCase().includes(q.q!.toLowerCase()));
    if (q.from) rows = rows.filter((r) => !!r.t.closedAt && istDate(r.t.closedAt) >= q.from!);
    if (q.to) rows = rows.filter((r) => !!r.t.closedAt && istDate(r.t.closedAt) <= q.to!);
    const states = q.states ? q.states.split(',') : null;
    if (states) rows = rows.filter((r) => states.includes(this.closedState(r)));
    if (q.cat) rows = rows.filter((r) => `${r.t.helpdesk}.${r.t.categoryKey}` === q.cat);
    const hds = (q.hds ? q.hds.split(',') : allowedHds(u)).filter((h) => allowedHds(u).includes(h as never));
    return {
      scope,
      categories: allCats,
      sections: hds.map((h) => ({
        helpdesk: h,
        rows: rows.filter((r) => r.t.helpdesk === h).sort((a, b) => b.t.closedAt!.getTime() - a.t.closedAt!.getTime())
          .map((r) => ({ ...this.listItem(u, r), resolutionMs: r.t.closedAt!.getTime() - (r.t.slaStart ?? r.t.createdAt).getTime(), closedState: this.closedState(r) })),
      })),
    };
  }

  // ---------- Approvals ----------
  async pendingApprovals(u: Principal) {
    if (!isApprover(u)) return [];
    const rows = (await this.loader.visible(u)).filter((r) => approvalStage(u, r.ctx)).sort((a, b) => a.t.updatedAt.getTime() - b.t.updatedAt.getTime());
    const steps = this.cfg.setting<Record<string, { l: string }>>('approvalSteps');
    return rows.map((r) => {
      const st = approvalStage(u, r.ctx)!;
      const ch = chainOf(r.ctx);
      const prev = ch[ch.findIndex((a) => a.step === st) - 1];
      return {
        ...this.listItem(u, r), stage: st,
        chain: ch.map((a, i) => ({ step: a.step, label: `${i + 1}. ${steps[a.step].l}`, status: a.status, current: a.step === st })),
        waitingSince: prev?.decidedAt ?? r.t.createdAt, requesterDept: this.cfg.person(r.t.requesterId)?.dept ?? null,
      };
    });
  }

  /** Approver names for a step, as shown on the ticket ("Meera Iyer (L&D Head) or Kavya Nair (HR / L&D admin)"). */
  approverIds(r: Row, step: string): string[] {
    if (step === 'mgr') return [apMgr(r.ctx)].filter((x): x is string => !!x);
    const roles: Record<string, string[]> = { lnd: ['LND_HEAD', 'HRLND_ADMIN'], ith: ['IT_HEAD'], adm: ['ADM_HEAD'] };
    return this.cfg.peopleList().filter((p) => !p.isQueue && p.roles.some((x) => roles[step]?.includes(x))).map((p) => p.id);
  }
  approverText(r: Row, step: string): string {
    if (step === 'mgr') return this.cfg.name(apMgr(r.ctx));
    const labels = this.cfg.setting<Record<string, string>>('roleLabels');
    const roles: Record<string, string[]> = { lnd: ['LND_HEAD', 'HRLND_ADMIN'], ith: ['IT_HEAD'], adm: ['ADM_HEAD'] };
    return this.approverIds(r, step).map((id) => {
      const p = this.cfg.person(id)!;
      const role = p.roles.find((x) => roles[step].includes(x))!;
      return `${p.name} (${role === 'LND_HEAD' ? 'L&D Head' : labels[role]})`;
    }).join(' or ');
  }

  // ---------- Ticket detail ----------
  /** MySQL JSON does not keep key order, so fields are shown in form order: category fields, custom fields, then the label list order. */
  orderedFields(hd: string, cat: string, f: Record<string, string>) {
    const form = this.cfg.allFields().filter((x) => x.helpdesk === hd && x.categoryKey === cat).sort((a, b) => Number(a.custom) - Number(b.custom) || a.sortOrder - b.sortOrder).map((x) => x.key);
    const labels = Object.keys(this.cfg.setting<Record<string, string>>('fieldLabels'));
    const rank = (k: string) => (form.includes(k) ? form.indexOf(k) : 1000 + (labels.includes(k) ? labels.indexOf(k) : 999));
    return Object.entries(f).filter(([, v]) => v).sort((a, b) => rank(a[0]) - rank(b[0])).map(([k, v]) => ({ key: k, label: this.cfg.fieldLabel(k), value: v }));
  }

  async detail(u: Principal, key: string) {
    const r = await this.loader.one(u, key);
    const t = r.t;
    const ds = this.loader.ds;
    const work = canWork(u, r.ctx);
    const [comments, events, files, sf, team, kids, relatedRows] = await Promise.all([
      ds.getRepository(CommentEntity).find({ where: { ticketKey: key }, order: { createdAt: 'ASC', id: 'ASC' } }),
      ds.getRepository(EventEntity).find({ where: { ticketKey: key }, order: { at: 'ASC', id: 'ASC' } }),
      ds.getRepository(AttachmentEntity).find({ where: { ticketKey: key }, order: { id: 'ASC' } }),
      ds.getRepository(SfCaseEntity).findOne({ where: { ticketKey: key } }),
      ds.getRepository(SfCaseTeamEntity).find({ where: { ticketKey: key } }),
      ds.getRepository(SfChildCaseEntity).find({ where: { ticketKey: key } }),
      ds.getRepository(TicketEntity).find({ where: [{ key: t.relatedKey ?? '__none__' }, { relatedKey: key }] }),
    ]);
    const relCtx = await this.loader.withCtx(relatedRows);
    const st = this.cfg.statusModel(t.helpdesk);
    const [role, roleTxt] = whyVisible(u, r.ctx);
    const stage = approvalStage(u, r.ctx);
    const steps = this.cfg.setting<Record<string, { l: string }>>('approvalSteps');
    const ladder = this.cfg.ladder(t.helpdesk, t.categoryKey, t.slaVer).map((l) => ({ ...l, whoName: this.cfg.name(l.who) }));
    const ro = reopenInfo({ ...r.ctx, closed: r.closed, categoryName: r.ctx.category?.name ?? t.categoryKey }, clock.nowMs());
    const sla = slaInfo(t, r.closed, clock.nowMs());
    const cat = this.cfg.category(t.helpdesk, t.categoryKey);
    const ch = chainOf(r.ctx);
    const rejIdx = ch.findIndex((a) => a.status === 'Rejected');
    const cur = t.status === 'Pending approval' ? ch.find((a) => a.status === 'Pending') : undefined;
    const readOnly = isReadOnly(u, r.ctx);
    const isReq = t.requesterId === u.id;
    const fol = relOf(r.ctx, u.id) ?? null;
    const slaFrom = (t.slaStart ?? t.createdAt).getTime();
    const pending = t.status === 'Pending approval';
    const away = work ? await this.cover.awayFn(clock.now()) : () => false;
    return {
      ...this.listItem(u, r),
      description: t.description,
      fields: this.orderedFields(t.helpdesk, t.categoryKey, t.fields || {}),
      responseDue: t.responseDue, resolutionDue: t.resolutionDue, responseMet: t.responseMet, paused: t.paused, closeMessage: t.closeMessage,
      aiTranscript: t.aiTranscript, requesterDept: this.cfg.person(t.requesterId)?.dept ?? null,
      category: { key: t.categoryKey, name: cat?.name ?? t.categoryKey, leadId: cat?.leadId ?? null, leadName: this.cfg.name(cat?.leadId), restricted: !!cat?.restricted },
      files: files.map((f) => ({ id: f.id, name: f.fileName, sizeBytes: f.sizeBytes, downloadable: !!f.storagePath })),
      followers: r.ctx.followers.map((f) => ({ userId: f.userId, name: this.cfg.name(f.userId), relation: f.relation, addedById: f.addedById })),
      comments: comments.filter((c) => work || !c.internal).map((c) => ({ id: c.id, authorId: c.authorId, authorName: this.cfg.name(c.authorId), body: c.body, internal: c.internal, createdAt: c.createdAt })),
      events: events.map((e) => ({ at: e.at, text: e.text, kind: e.kind })),
      related: relCtx.filter((x) => allowedHds(u).includes(x.t.helpdesk as never)).map((x) => ({ key: x.t.key, helpdesk: x.t.helpdesk, canView: this.canSee(u, x) })),
      approval: ch.length
        ? {
            what: t.helpdesk === 'LND' ? 'course request' : t.helpdesk === 'IT' ? (t.categoryKey === 'SW' ? 'software request' : 'access request') : t.categoryKey === 'PUR' ? 'purchase request' : 'travel request',
            steps: ch.map((a, i) => ({
              step: a.step, label: `${i + 1}. ${steps[a.step].l}`, who: this.approverText(r, a.step), skipped: rejIdx >= 0 && i > rejIdx,
              status: a.status, decidedAt: a.decidedAt, current: cur?.step === a.step,
            })),
            myStage: stage, waitingFor: cur ? this.approverText(r, cur.step) : null,
          }
        : null,
      sf: sf
        ? {
            caseNo: sf.caseNo, entitlement: sf.entitlement, milestones: sf.milestones, escalated: t.status === 'Escalated' || t.escalationLevel > 0,
            team: team.map((m) => ({ name: this.cfg.name(m.userId), role: m.role })), children: kids.map((k) => ({ caseNo: k.caseNo, title: k.title, status: k.status, owner: k.ownerName })),
          }
        : null,
      ladder,
      ladderBase: t.ladderBase ?? 0,
      asgHist: t.asgHist ?? [],
      sla: { ...sla, usedPct: t.slaStarted ? Math.min(100, Math.max(0, (((r.closed && t.closedAt ? t.closedAt.getTime() : clock.nowMs()) - slaFrom) / Math.max(1, t.resolutionDue.getTime() - slaFrom)) * 100)) : 0 },
      slaStarted: t.slaStarted, slaStart: t.slaStart,
      me: {
        role, roleTxt, canWork: work, isRequester: isReq, relation: fol, readOnly, canAddPeople: canAddPeople(u, r.ctx),
        canInternal: work, approvalStage: stage, isHelpdeskAdmin: has(u, 'HD_ADMIN'),
        transitions: (st.tr[t.status] || []).map((s) => ({ status: s, ui: uiOf(st, this.cfg.uiMap(t.helpdesk), s) })),
        closing: st.closing, priorities: this.cfg.priorities(t.helpdesk),
        canEscalate: work && !r.closed && !pending && (t.ladderBase ?? 0) + t.escalationLevel < ladder.length, pending, canCancel: isReq && !r.closed && stm(r.ctx),
        canConfirm: isReq && stm(r.ctx) && t.status === 'Resolved', reopen: isReq ? ro : { ok: false, short: ro.short, why: ro.why },
        canFollow: !fol && !isReq && t.assigneeId !== u.id, canComment: !readOnly && (!r.closed || (stm(r.ctx) && t.status === 'Resolved')),
        reopenDays: reopenDays(r.ctx), stm: stm(r.ctx), waiting: this.isWaiting(r),
        agents: work ? (this.cfg.setting<Record<string, string[]>>('agents')[t.helpdesk] || []).filter((a) => a !== t.assigneeId).map((a) => ({ id: a, name: this.cfg.name(a), title: this.cfg.person(a)?.title ?? null, away: away(a) })) : [],
      },
    };
  }

  private canSee(u: Principal, r: Row): boolean {
    return canView(u, r.ctx);
  }

  // ---------- counts for the shell ----------
  async summary(u: Principal) {
    const rows = await this.loader.visible(u);
    const followCount = rows.filter((r) => r.t.requesterId !== u.id && relOf(r.ctx, u.id) && !r.closed).length;
    const waiting = rows.filter((r) => !r.closed && ((r.t.requesterId === u.id && this.isWaiting(r)) || approvalStage(u, r.ctx))).length;
    const assignedOpen = rows.filter((r) => r.t.assigneeId === u.id && !r.closed).length;
    const unassignedInQueues = rows.filter((r) => canWork(u, r.ctx) && !r.closed && this.cfg.person(r.t.assigneeId)?.isQueue).length;
    const mine = rows.filter((r) => r.t.requesterId === u.id);
    const unread = await this.loader.ds.getRepository(NotificationEntity).count({ where: { userId: u.id, readAt: IsNull() } });
    return { followCount, waiting, assignedOpen, unassignedInQueues, myOpen: mine.filter((r) => !r.closed).length, myClosed: mine.filter((r) => r.closed).length, notifications: unread };
  }

  async keysIn(keys: string[]) {
    return keys.length ? this.loader.ds.getRepository(TicketEntity).find({ where: { key: In(keys) } }) : [];
  }
}
