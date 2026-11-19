import { Injectable } from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';
import { Like } from 'typeorm';
import { clock, fdt } from '../common/clock';
import { env } from '../common/env';
import { badRequest, conflict, forbidden, notFound } from '../common/errors';
import { ApprovalEntity, AsgRecord, AttachmentEntity, CommentEntity, EscRecord, EventEntity, FollowerEntity, TicketEntity } from '../database/entities';
import { approvalStage, canAddPeople, canWork, chainOf, hdAllowed, isReadOnly, relOf, reopenInfo, stm } from '../domain/policy';
import { evalCond } from '../domain/sla';
import { Helpdesk, Principal } from '../domain/types';
import { AuditService } from '../audit/audit.service';
import { HelpdeskConfigService } from '../helpdesk-config/config.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProvidersRegistry } from '../providers/providers.registry';
import { CoverService } from './cover.service';
import { checkFiles, storeFile, UploadedFileLike } from './ticket-create.service';
import { Row, TicketLoader } from './ticket-loader.service';
import { TicketQueryService } from './ticket-query.service';

const REL_LABEL: Record<string, string> = { FOLLOWER: 'follower', CC: 'CC' };

/** Every change to a ticket. Each method checks permission on the server, writes the timeline and notifies. */
@Injectable()
export class TicketActionsService {
  constructor(
    private readonly loader: TicketLoader,
    private readonly query: TicketQueryService,
    private readonly cfg: HelpdeskConfigService,
    private readonly notes: NotificationsService,
    private readonly providers: ProvidersRegistry,
    private readonly audit: AuditService,
    private readonly cover: CoverService,
  ) {}

  private get repo() {
    return this.loader.ds.getRepository(TicketEntity);
  }
  private tk(r: Row) {
    return { key: r.t.key, confidential: r.t.confidential };
  }
  private asg(r: Row, u: string, how: AsgRecord['how'], coverFor: string | null = null): AsgRecord[] {
    return [...(r.t.asgHist ?? []), { u, at: clock.now().toISOString(), how, coverFor }];
  }
  private esc(r: Row, rec: Omit<EscRecord, 'at'>): EscRecord[] {
    return [...(r.t.escLog ?? []), { ...rec, at: clock.now().toISOString() }];
  }
  private followerIds(r: Row) {
    return r.ctx.followers.map((f) => f.userId);
  }
  private requireWork(u: Principal, r: Row) {
    if (!canWork(u, r.ctx)) throw forbidden('Only people who work this ticket can do that.', 'NOT_A_WORKER');
  }
  private requireOpen(r: Row) {
    if (r.closed) throw conflict('This ticket is closed.', 'TICKET_CLOSED');
  }
  /** While approvals are pending the assignee can read, note, reply, attach and reassign, but not work it. */
  private requireApproved(r: Row) {
    if (r.t.status === 'Pending approval') throw conflict('Approvals must finish before work can start. SLA starts after approval.', 'PENDING_APPROVAL');
  }
  /** Who holds the ticket for reporting: the newest assignment-history entry. */
  private holder(r: Row): string {
    const h = r.t.asgHist ?? [];
    return h.length ? h[h.length - 1].u : r.t.assigneeId;
  }
  private async save(r: Row, patch: Partial<TicketEntity>) {
    Object.assign(r.t, patch, { updatedAt: clock.now() });
    await this.repo.update(r.t.key, { ...patch, updatedAt: r.t.updatedAt });
  }

  /** How long the resolution clock has been paused, from the latest pause event. */
  private async pausedFor(r: Row): Promise<number> {
    const ev = await this.loader.ds.getRepository(EventEntity).findOne({
      where: { ticketKey: r.t.key, kind: 'sla', text: Like('SLA resolution clock paused%') },
      order: { at: 'DESC', id: 'DESC' },
    });
    return ev ? Math.max(0, clock.nowMs() - ev.at.getTime()) : 0;
  }

  /** Applies a status and its side effects (pause/resume SLA, notify). Shared by several actions. */
  private async applyStatus(u: Principal, r: Row, to: string, note?: string) {
    const from = r.t.status;
    const st = this.cfg.statusModel(r.t.helpdesk);
    const closed = st.closed.includes(to);
    const patch: Partial<TicketEntity> = { status: to };
    await this.save(r, patch);
    await this.loader.event(r.t.key, `Status: ${from} → ${to}${note ? ' · ' + note : ''}`, closed ? 'close' : 'status');
    const rules = this.cfg.setting<Record<string, boolean>>('rules');
    if (to === st.wait && rules.pauseOnWait) {
      if (!r.t.paused) {
        await this.save(r, { paused: true });
        await this.loader.event(r.t.key, 'SLA resolution clock paused while waiting for requester', 'sla');
      }
    } else if (r.t.paused) {
      const pausedMs = closed ? 0 : await this.pausedFor(r);
      await this.save(r, { paused: false, ...(pausedMs > 0 ? { resolutionDue: new Date(r.t.resolutionDue.getTime() + pausedMs) } : {}) });
      await this.loader.event(r.t.key, `SLA resolution clock resumed${pausedMs > 0 ? ` · due date moved to ${fdt(r.t.resolutionDue)}` : ''}`, 'sla');
    }
    await this.notes.notify([r.t.requesterId, ...this.followerIds(r)], `${u.name} changed ${r.t.key} to ${to}`, this.tk(r), u.id);
    await this.providers.for(r.t.helpdesk).onStatusChanged(r.t, from, to);
  }

  async setStatus(u: Principal, key: string, to: string) {
    const r = await this.loader.one(u, key);
    this.requireWork(u, r);
    this.requireApproved(r);
    const st = this.cfg.statusModel(r.t.helpdesk);
    if (to === r.t.status) return { toast: null };
    if (!(st.tr[r.t.status] || []).includes(to)) throw badRequest(`You cannot move a ${r.t.status} ticket to ${to}.`, 'INVALID_TRANSITION');
    if (st.closing.includes(to)) throw badRequest('Use Close or Resolve to close a ticket with a closing response.', 'USE_CLOSE');
    await this.applyStatus(u, r, to);
    return { toast: `Status changed to ${to}. ${this.cfg.name(r.t.requesterId)} was notified.` };
  }

  async setPriority(u: Principal, key: string, pri: string) {
    const r = await this.loader.one(u, key);
    this.requireWork(u, r);
    this.requireOpen(r);
    if (!this.cfg.priorities(r.t.helpdesk).includes(pri)) throw badRequest('Pick a priority this helpdesk uses.', 'INVALID_PRIORITY');
    const from = r.t.priority;
    if (from === pri) return { toast: null };
    if (!r.t.slaStarted) {
      await this.save(r, { priority: pri });
      await this.loader.event(key, `Priority: ${from} → ${pri} by ${u.name} · SLA starts after approval`, 'status');
      await this.notes.notify([r.t.requesterId], `Priority of ${key} changed to ${pri}`, this.tk(r), u.id);
      return { toast: `Priority set to ${pri}` };
    }
    const [oldRh, oldSh] = this.cfg.slaFor(r.t.helpdesk, r.t.categoryKey, from, r.t.slaVer);
    const [rh, sh] = this.cfg.slaFor(r.t.helpdesk, r.t.categoryKey, pri, r.t.slaVer);
    await this.save(r, {
      priority: pri,
      resolutionDue: new Date(r.t.resolutionDue.getTime() + (sh - oldSh) * 3600000),
      ...(r.t.responseMet === null ? { responseDue: new Date(r.t.responseDue.getTime() + (rh - oldRh) * 3600000) } : {}),
    });
    await this.loader.event(key, `Priority: ${from} → ${pri} by ${u.name} · SLA targets recalculated (TC)`, 'status');
    await this.notes.notify([r.t.requesterId], `Priority of ${key} changed to ${pri}`, this.tk(r), u.id);
    return { toast: `Priority set to ${pri}` };
  }

  async reassign(u: Principal, key: string, to: string, note?: string) {
    const r = await this.loader.one(u, key);
    this.requireWork(u, r);
    this.requireOpen(r);
    const agents = this.cfg.setting<Record<string, string[]>>('agents')[r.t.helpdesk] || [];
    if (!agents.includes(to) || to === r.t.assigneeId) throw badRequest('Pick another agent or queue for this helpdesk.', 'INVALID_ASSIGNEE');
    const old = r.t.assigneeId;
    await this.save(r, { assigneeId: to, asgHist: this.asg(r, to, this.cfg.person(old)?.isQueue ? 'queue-claim' : 'manual') });
    await this.loader.event(key, `Reassigned from ${this.cfg.name(old)} to ${this.cfg.name(to)} by ${u.name}`, 'assign');
    if (note?.trim()) await this.addComment(key, u.id, 'Handover: ' + note.trim(), true);
    await this.notes.notify([to], `${key} assigned to you`, this.tk(r), u.id);
    return { toast: `Reassigned to ${this.cfg.name(to)}` };
  }

  async escalate(u: Principal, key: string, reason: string) {
    const r = await this.loader.one(u, key);
    this.requireWork(u, r);
    this.requireOpen(r);
    this.requireApproved(r);
    if (!reason?.trim()) throw badRequest('Give a reason so the next level has context.', 'VALIDATION', { fieldErrors: { reason: 'Give a reason so the next level has context.' } });
    const ladder = this.cfg.ladder(r.t.helpdesk, r.t.categoryKey, r.t.slaVer);
    const base = r.t.ladderBase ?? 0;
    if (base + r.t.escalationLevel >= ladder.length) throw conflict('This ticket is already at the top escalation level.', 'MAX_ESCALATION');
    const lvl = r.t.escalationLevel + 1;
    const l = ladder[base + lvl - 1];
    const from = this.holder(r);
    await this.save(r, {
      escalationLevel: lvl,
      asgHist: l.who === from ? r.t.asgHist : this.asg(r, l.who, 'escalation'),
      escLog: this.esc(r, { level: base + lvl, from, to: l.who, how: 'manual', by: u.id }),
    });
    await this.loader.event(key, `Escalated to Level ${base + lvl} · ${this.cfg.name(l.who)} (${l.role}) by ${u.name} · ${reason.trim()}`, 'esc');
    if (r.t.helpdesk === 'SF') {
      const from = r.t.status;
      await this.save(r, { status: 'Escalated', assigneeId: l.who });
      await this.loader.event(key, `Status: ${from} → Escalated · owner set by escalation rule`, 'status');
    }
    await this.notes.notify([l.who, r.t.assigneeId], `${key} escalated to Level ${base + lvl}`, this.tk(r), u.id);
    await this.notes.notify([r.t.requesterId], `${key} was escalated to Level ${base + lvl}`, this.tk(r), u.id);
    await this.audit.record(u.id, 'ticket.escalate', `Escalated ${key} to Level ${base + lvl}`, { target: key });
    return { toast: `Escalated to ${this.cfg.name(l.who)}. They have been notified.` };
  }

  /** Close (HR, Salesforce) with a closing response, or Resolve / Reject (L&D, IT, Admin Desk). */
  async close(u: Principal, key: string, body: { to: string; response?: string; message: string }) {
    const r = await this.loader.one(u, key);
    this.requireWork(u, r);
    this.requireOpen(r);
    this.requireApproved(r);
    if (!body.message?.trim()) throw badRequest('This message is required.', 'VALIDATION', { fieldErrors: { msg: 'This message is required.' } });
    const st = this.cfg.statusModel(r.t.helpdesk);
    const isStm = stm(r.ctx);
    if (isStm && !st.closing.includes(body.to)) throw badRequest('Pick Resolved or Rejected.', 'INVALID_TRANSITION');
    const resp = body.response || 'Resolved';
    if (!isStm && !['Resolved', 'Rejected', 'Cancelled', 'Duplicate'].includes(resp)) throw badRequest('Pick a closing response.', 'INVALID_RESPONSE');
    const to = isStm ? body.to : 'Closed';
    const from = r.t.status;
    const now = clock.now();
    await this.save(r, { status: to, closeResponse: isStm ? null : resp, closeMessage: body.message.trim(), closedById: u.id, closedAt: now, paused: false });
    await this.loader.event(key, `${isStm ? to : 'Closed · ' + resp} by ${u.name} (was ${from})`, 'close', now);
    await this.addComment(key, u.id, body.message.trim(), false);
    await this.notes.notify([r.t.requesterId, ...this.followerIds(r)], `${key} ${isStm ? to.toLowerCase() : 'closed · ' + resp}`, this.tk(r), u.id);
    await this.providers.for(r.t.helpdesk).onStatusChanged(r.t, from, to);
    return { toast: `${key} ${isStm ? to.toLowerCase() : 'closed'}. The requester was notified.` };
  }

  async reopen(u: Principal, key: string, note: string) {
    const r = await this.loader.one(u, key);
    if (r.t.requesterId !== u.id) throw forbidden('Only the requester can reopen a ticket.', 'NOT_REQUESTER');
    const ro = reopenInfo({ ...r.ctx, closed: r.closed, categoryName: r.ctx.category?.name ?? '' }, clock.nowMs());
    if (!ro.ok) throw conflict(ro.why || 'This ticket cannot be reopened.', 'REOPEN_NOT_ALLOWED');
    if (!note?.trim()) throw badRequest('Add a note so the agent knows what is still wrong.', 'VALIDATION', { fieldErrors: { note: 'Add a note so the agent knows what is still wrong.' } });
    const now = clock.now();
    const from = r.t.status === 'Closed' && r.t.closeResponse ? `Closed · ${r.t.closeResponse}` : r.t.status;
    const [, res] = this.cfg.slaFor(r.t.helpdesk, r.t.categoryKey, r.t.priority, r.t.slaVer);
    await this.save(r, { status: stm(r.ctx) ? 'Reopened' : 'Open', closeResponse: null, closedAt: null, closedById: null, resolutionDue: new Date(now.getTime() + res * 3600000) });
    await this.loader.event(key, `Reopened by ${u.name} (was ${from}) · SLA clocks restarted`, 'status', now);
    await this.addComment(key, u.id, 'Reopen note: ' + note.trim(), false);
    await this.notes.notify([r.t.assigneeId], `${key} was reopened by ${u.name}`, this.tk(r), u.id);
    return { toast: `${key} reopened and sent back to ${this.cfg.name(r.t.assigneeId)}` };
  }

  async cancel(u: Principal, key: string, note?: string) {
    const r = await this.loader.one(u, key);
    if (r.t.requesterId !== u.id || r.closed || !stm(r.ctx)) throw forbidden('Only the requester can cancel an open request.', 'CANNOT_CANCEL');
    const now = clock.now();
    const from = r.t.status;
    await this.save(r, { status: 'Cancelled', closedById: u.id, closedAt: now, closeMessage: note?.trim() || 'Cancelled by requester.' });
    await this.loader.event(key, `Cancelled by ${u.name} (was ${from})`, 'close', now);
    await this.notes.notify([r.t.assigneeId], `${key} was cancelled by the requester`, this.tk(r), u.id);
    return { toast: `${key} cancelled. It is now in History.` };
  }

  async confirm(u: Principal, key: string) {
    const r = await this.loader.one(u, key);
    if (r.t.requesterId !== u.id || !stm(r.ctx) || r.t.status !== 'Resolved') throw conflict('Only a resolved ticket can be confirmed by its requester.', 'CANNOT_CONFIRM');
    await this.applyStatus(u, r, 'Closed', 'confirmed by requester');
    if (!r.t.closedAt) await this.save(r, { closedAt: clock.now() });
    return { toast: `${key} closed. Thanks for confirming.` };
  }

  // ---------- followers ----------
  async follow(u: Principal, key: string) {
    const r = await this.loader.one(u, key);
    if (relOf(r.ctx, u.id) || r.t.requesterId === u.id || r.t.assigneeId === u.id) throw conflict('You already see updates on this ticket.', 'ALREADY_FOLLOWING');
    await this.loader.ds.getRepository(FollowerEntity).insert({ ticketKey: key, userId: u.id, relation: 'FOLLOWER', addedById: u.id });
    await this.loader.event(key, `${u.name} started following`, 'assign');
    return { toast: `Following ${key}. It now appears on your Following page.` };
  }

  async addFollower(u: Principal, key: string, userId: string, relation: 'FOLLOWER' | 'CC') {
    const r = await this.loader.one(u, key);
    if (r.closed) throw conflict('This ticket is closed.', 'TICKET_CLOSED');
    if (!canAddPeople(u, r.ctx) || isReadOnly(u, r.ctx)) throw forbidden('On confidential tickets only the requester or assigned agent can add people.', 'CANNOT_ADD_PEOPLE');
    const p = this.cfg.person(userId);
    if (!p || p.isQueue || userId === r.t.requesterId || userId === r.t.assigneeId || relOf(r.ctx, userId))
      throw badRequest('Select a colleague who is not already on this ticket.', 'VALIDATION', { fieldErrors: { who: 'Select a colleague.' } });
    if (!hdAllowed(p, r.t.helpdesk)) throw forbidden(`${p.name} has no access to this helpdesk.`, 'SALESFORCE_FORBIDDEN');
    await this.loader.ds.getRepository(FollowerEntity).insert({ ticketKey: key, userId, relation, addedById: u.id });
    await this.loader.event(key, `${u.name} added ${p.name} as ${REL_LABEL[relation]}${r.t.confidential ? ' · confidential access granted (audited)' : ''}`, 'assign');
    if (r.t.confidential) await this.audit.record(u.id, 'ticket.grant', `Granted ${p.name} access to confidential ${key}`, { target: key });
    await this.notes.notify([userId], `You were ${relation === 'CC' ? "CC'd" : 'added as a follower'} on ${key}`, this.tk(r), u.id);
    return { toast: `${p.name} added. It now appears on their Following page.` };
  }

  async removeFollower(u: Principal, key: string, userId: string) {
    const r = await this.loader.one(u, key);
    const f = r.ctx.followers.find((x) => x.userId === userId);
    if (!f) throw notFound('Follower');
    const self = userId === u.id;
    if (f.relation === 'CASE_TEAM') throw forbidden('Case team members are managed in Salesforce.', 'CASE_TEAM');
    if (!self && r.t.requesterId !== u.id && r.t.assigneeId !== u.id) throw forbidden('Only the requester or assignee can remove people.', 'CANNOT_REMOVE');
    await this.loader.ds.getRepository(FollowerEntity).delete({ ticketKey: key, userId });
    if (self) {
      await this.loader.event(key, `${u.name} unfollowed (kept in audit log)`, 'assign');
      return { toast: `Unfollowed ${key}` };
    }
    await this.loader.event(key, `${u.name} removed ${this.cfg.name(userId)} (kept in audit log)`, 'assign');
    await this.notes.notify([userId], `You were removed from ${key}`, this.tk(r), u.id);
    return { toast: `${this.cfg.name(userId)} removed` };
  }

  // ---------- comments ----------
  private async addComment(key: string, authorId: string, body: string, internal: boolean) {
    await this.loader.ds.getRepository(CommentEntity).insert({ ticketKey: key, authorId, body, internal, createdAt: clock.now() });
  }

  /** Public reply or internal note, with @Name tagging. Returns warnings for people who could not be tagged. */
  async comment(u: Principal, key: string, body: string, internalReq: boolean) {
    const r = await this.loader.one(u, key);
    const text = (body ?? '').trim();
    if (!text) throw badRequest('Write a message first', 'VALIDATION');
    if (isReadOnly(u, r.ctx)) throw forbidden('Read-only access: you cannot reply on this ticket.', 'READ_ONLY');
    if (r.closed && !(stm(r.ctx) && r.t.status === 'Resolved')) throw conflict('This ticket is closed. Reopen it to continue the conversation.', 'TICKET_CLOSED');
    const work = canWork(u, r.ctx);
    const internal = work && internalReq;
    const now = clock.now();
    const warnings: string[] = [];
    for (const p of this.cfg.peopleList()) {
      if (p.isQueue || !text.includes('@' + p.name) || p.id === r.t.requesterId || p.id === u.id || relOf(r.ctx, p.id)) continue;
      const pCtxView = { id: p.id, name: p.name, dept: p.dept, title: p.title, location: null, managerId: p.managerId, roles: new Set(p.roles), hrCats: new Set(p.hrCats) };
      if (internal && !canWork(pCtxView, r.ctx)) { warnings.push(`${p.name} was not tagged: internal notes are agents only`); continue; }
      if (r.t.confidential && u.id !== r.t.requesterId && u.id !== r.t.assigneeId) { warnings.push(`Cannot tag ${p.name} on a confidential ticket`); continue; }
      if (!hdAllowed(p, r.t.helpdesk)) { warnings.push(`${p.name} has no access to this helpdesk`); continue; }
      await this.loader.ds.getRepository(FollowerEntity).insert({ ticketKey: key, userId: p.id, relation: 'TAGGED', addedById: u.id });
      r.ctx.followers.push({ userId: p.id, relation: 'TAGGED', addedById: u.id });
      await this.loader.event(key, `${u.name} tagged ${p.name}`, 'assign', now);
      await this.notes.notify([p.id], `${u.name} tagged you on ${key}`, this.tk(r), u.id);
    }
    await this.addComment(key, u.id, text, internal);
    await this.save(r, {});
    if (!internal && work && r.t.responseMet === null && r.t.slaStarted) {
      const met = now.getTime() <= r.t.responseDue.getTime();
      await this.save(r, { responseMet: met });
      await this.loader.event(key, `First response sent · response SLA ${met ? 'met' : 'breached'}`, 'sla', now);
    }
    if (internal) {
      const agents = this.cfg.setting<Record<string, string[]>>('agents')[r.t.helpdesk] || [];
      if (agents.includes(r.t.assigneeId)) await this.notes.notify([r.t.assigneeId], `Internal note on ${key}`, this.tk(r), u.id);
    } else await this.notes.notify([r.t.requesterId, r.t.assigneeId, ...this.followerIds(r)], `${u.name} replied on ${key}`, this.tk(r), u.id);
    let resumed = false;
    if (!internal && u.id === r.t.requesterId && r.t.status === this.cfg.statusModel(r.t.helpdesk).wait) {
      await this.applyStatus(u, r, this.cfg.statusModel(r.t.helpdesk).work, 'requester replied');
      resumed = true;
    }
    await this.providers.for(r.t.helpdesk).onComment(r.t, text, internal);
    return { toast: internal ? 'Internal note added. The requester cannot see it.' : 'Reply sent. The requester and followers were notified.', warnings, resumed };
  }

  // ---------- approvals ----------
  async decide(u: Principal, key: string, decision: 'Approved' | 'Rejected', note?: string) {
    const r = await this.loader.one(u, key);
    const st = approvalStage(u, r.ctx);
    if (!st) throw forbidden('This request is not waiting for your approval', 'NOT_APPROVER');
    const now = clock.now();
    const steps = this.cfg.setting<Record<string, { l: string }>>('approvalSteps');
    const label = steps[st].l;
    const n = note?.trim() || '';
    await this.loader.ds.getRepository(ApprovalEntity).update({ ticketKey: key, step: st }, { status: decision, decidedById: u.id, decidedAt: now });
    r.ctx.approvals = r.ctx.approvals.map((a) => (a.step === st ? { ...a, status: decision, decidedById: u.id, decidedAt: now } : a));
    await this.loader.event(key, `${label} approval: ${decision} by ${u.name}${n ? ' · ' + n : ''}`, decision === 'Rejected' ? 'close' : 'status', now);
    if (decision === 'Rejected') {
      await this.save(r, { status: 'Rejected', closedById: u.id, closedAt: now, closeMessage: n || `Rejected at the ${label.toLowerCase()} step.` });
      await this.notes.notify([r.t.requesterId], `${key} was rejected at the ${label.toLowerCase()} step`, this.tk(r), u.id);
    } else {
      const nx = chainOf(r.ctx).find((a) => a.status === 'Pending');
      if (nx) {
        await this.loader.event(key, `${steps[nx.step].l} approval requested from ${this.query.approverText(r, nx.step)}`, 'assign', now);
        await this.notes.notify(this.query.approverIds(r, nx.step), `Approval needed: ${key} from ${this.cfg.name(r.t.requesterId)}`, this.tk(r), u.id);
        await this.notes.notify([r.t.requesterId], `${key}: ${label.toLowerCase()} approved, now with ${steps[nx.step].l}`, this.tk(r), u.id);
      } else {
        await this.startAfterApproval(u, r, now);
      }
    }
    if (n) await this.addComment(key, u.id, n, false);
    await this.save(r, {});
    await this.audit.record(u.id, 'ticket.approval', `${label} ${decision.toLowerCase()} ${key}`, { target: key });
    return { toast: `${decision}. ${this.cfg.name(r.t.requesterId)} has been notified.` };
  }

  /**
   * Last approval given: the SLA clock starts now, with targets from the ticket's bound SLA version.
   * The absence check runs here, because this is when the ticket becomes workable.
   */
  private async startAfterApproval(u: Principal, r: Row, now: Date) {
    const key = r.t.key;
    const work = this.cfg.statusModel(r.t.helpdesk).work;
    const [rh, sh] = this.cfg.slaFor(r.t.helpdesk, r.t.categoryKey, r.t.priority, r.t.slaVer);
    const c = this.cfg.category(r.t.helpdesk, r.t.categoryKey);
    const cov = c ? await this.cover.cover(r.t.helpdesk as Helpdesk, c, r.t.assigneeId, now, r.t.slaVer) : null;
    const asg = cov?.asg ?? r.t.assigneeId;
    await this.save(r, {
      status: work, slaStarted: true, slaStart: now, assigneeId: asg,
      responseDue: new Date(now.getTime() + rh * 3600000), resolutionDue: new Date(now.getTime() + sh * 3600000),
      ...(cov?.coverFor ? { ladderBase: cov.ladderBase, asgHist: this.asg(r, asg, 'absence', cov.coverFor) } : {}),
    });
    await this.loader.event(key, `SLA started on approval · response due ${fdt(r.t.responseDue)}, resolution due ${fdt(r.t.resolutionDue)}`, 'sla', now);
    if (cov?.event) await this.loader.event(key, cov.event, 'assign', now);
    await this.loader.event(key, `Status: Pending approval → ${work} · routed to ${this.cfg.name(asg)}`, 'status', now);
    await this.notes.notify([r.t.requesterId], `${key} approved; work has started`, this.tk(r), u.id);
    const coverTxt = cov?.coverFor ? ` (covering for ${this.cfg.name(cov.coverFor)})` : '';
    await this.notes.notify([asg], `${key} approved; work has started${coverTxt}`, this.tk(r), u.id);
    if (cov?.unattended) await this.notes.notify(this.cover.hdAdmins(), `Unattended: ${key} has no available cover`, this.tk(r), u.id);
  }

  // ---------- attachments ----------
  async attach(u: Principal, key: string, files: UploadedFileLike[]) {
    const r = await this.loader.one(u, key);
    if (isReadOnly(u, r.ctx)) throw forbidden('Read-only access: you cannot attach files here.', 'READ_ONLY');
    if (!files.length) throw badRequest('Choose a file to attach.', 'VALIDATION');
    checkFiles(files, await this.loader.ds.getRepository(AttachmentEntity).count({ where: { ticketKey: key } }));
    for (const f of files) {
      await this.loader.ds.getRepository(AttachmentEntity).insert({ ticketKey: key, fileName: f.originalname, sizeBytes: f.size, mimeType: f.mimetype, storagePath: storeFile(key, f), uploadedById: u.id, createdAt: clock.now() });
      await this.loader.event(key, `${u.name} attached ${f.originalname} · virus scan passed`, 'assign');
    }
    await this.save(r, {});
    return { toast: `${files.map((f) => f.originalname).join(', ')} attached` };
  }

  /** Download with an access check: you must be able to see the ticket. */
  async download(u: Principal, id: number): Promise<{ path: string; name: string; mime: string | null }> {
    const a = await this.loader.ds.getRepository(AttachmentEntity).findOne({ where: { id } });
    if (!a) throw notFound('File');
    await this.loader.one(u, a.ticketKey);
    if (!a.storagePath) throw notFound('This sample file has no stored copy, so it');
    const path = join(env.uploadDir, a.storagePath);
    if (!existsSync(path)) throw notFound('File');
    return { path, name: a.fileName, mime: a.mimeType };
  }

  /** Field visibility helper reused by the AI draft endpoint. */
  visibleField(hd: string, cat: string, key: string, f: Record<string, unknown>) {
    const x = this.cfg.formFields(hd, cat).find((y) => y.key === key);
    return !!x && (!x.showWhen || evalCond(x.showWhen, f));
  }
}
