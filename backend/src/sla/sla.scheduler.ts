import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Like } from 'typeorm';
import { clock, fdt } from '../common/clock';
import { env } from '../common/env';
import { ApprovalEntity, AsgRecord, CategoryEntity, CommentEntity, EscRecord, EventEntity, ReminderStateEntity, TicketEntity } from '../database/entities';
import { canWork, hdAllowed } from '../domain/policy';
import { escalationReached, isResponseBreached } from '../domain/sla';
import { Helpdesk, HD_ORDER, Principal, TicketCtx } from '../domain/types';
import { HelpdeskConfigService } from '../helpdesk-config/config.service';
import { TicketEventEmitter, TicketRef } from '../notifications/event-emitter.service';
import { CoverService } from '../tickets/cover.service';

/**
 * Background SLA + reminder job (on boot and every 60 s when SLA_SCHEDULER_ENABLED=true; also
 * runnable from the Admin console). It marks first-response breaches, escalates by the ladder's
 * share of resolution time, records resolution breaches, and fires the four reminder events (Step 3)
 * exactly once per ticket/type/threshold. Salesforce now uses the same ladder and cover rules, with
 * its own per-category targets and escalation rule as the fallback target.
 *
 * Reminders: SLA at risk (75% elapsed, or due within 2 h), approval stuck (24 h and 48 h), waiting
 * for the employee (48 h), unattended with no cover (4 h). All are idempotent via
 * `notification_reminders`, pause with the SLA clock, and never fire before the SLA has started.
 */
@Injectable()
export class SlaScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('SlaScheduler');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly cfg: HelpdeskConfigService,
    private readonly events: TicketEventEmitter,
    private readonly cover: CoverService,
  ) {}

  onModuleInit() {
    if (env.slaSchedulerEnabled && env.nodeEnv !== 'test') {
      void this.tick().catch((e) => this.log.error(e.message));
      this.timer = setInterval(() => void this.tick().catch((e) => this.log.error(e.message)), 60000);
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private ref(t: TicketEntity, assigneeId = t.assigneeId): TicketRef {
    return {
      key: t.key, helpdesk: t.helpdesk as Helpdesk, categoryKey: t.categoryKey, requesterId: t.requesterId, assigneeId,
      confidential: t.confidential, status: t.status, priority: t.priority,
    };
  }

  private principalOf(p: NonNullable<ReturnType<HelpdeskConfigService['person']>>): Principal {
    return { id: p.id, name: p.name, dept: p.dept, title: p.title, location: null, managerId: p.managerId, roles: new Set(p.roles), hrCats: new Set(p.hrCats) };
  }

  private ctxOf(t: TicketEntity, c: CategoryEntity | null, assigneeId: string): TicketCtx {
    return {
      key: t.key, helpdesk: t.helpdesk as Helpdesk, categoryKey: t.categoryKey, status: t.status, requesterId: t.requesterId,
      assigneeId, confidential: t.confidential, closeResponse: t.closeResponse, closedAt: t.closedAt,
      requesterManagerId: this.cfg.person(t.requesterId)?.managerId ?? null, followers: [], approvals: [],
      category: c ? { leadId: c.leadId, ownerId: c.ownerId, restricted: c.restricted, reopenAllowed: c.reopenAllowed, name: c.name } : null,
    };
  }

  private eligibleTarget(p: NonNullable<ReturnType<HelpdeskConfigService['person']>>, t: TicketEntity, c: CategoryEntity | null, from: string, away: (id: string) => boolean): boolean {
    if (p.isQueue || away(p.id) || !hdAllowed(p, t.helpdesk)) return false;
    return canWork(this.principalOf(p), this.ctxOf(t, c, from));
  }

  /** Resolve a ladder target, skipping unavailable people and continuing to the next eligible level. */
  private resolveTarget(
    t: TicketEntity, c: CategoryEntity | null, ladder: { who: string }[], index: number, from: string, away: (id: string) => boolean,
  ): string | null {
    for (let i = index; i < ladder.length; i++) {
      const raw = ladder[i].who === 'lead' ? c?.leadId || c?.ownerId || '' : ladder[i].who;
      const p = this.cfg.person(raw);
      if (!p) continue;
      if (p.isQueue) return (this.cfg.setting<Record<string, string[]>>('agents')[t.helpdesk] ?? []).includes(raw) ? raw : null;
      if (this.eligibleTarget(p, t, c, from, away)) return raw;
    }
    return null;
  }

  private hdAdminsFor(hd: string): string[] {
    return this.hdAdmins().filter((id) => hd !== 'SF' && hdAllowed(this.cfg.person(id)!, hd));
  }

  /** Expand queues and drop unavailable members; the emitter drops queues and the actor. */
  private recipientsFor(ids: string[], away: (id: string) => boolean): string[] {
    const out: string[] = [];
    for (const id of ids) {
      const p = this.cfg.person(id);
      if (!p) continue;
      if (!p.isQueue) out.push(id);
      else for (const m of this.cfg.queueMembers(id)) if (!away(m)) out.push(m);
    }
    return [...new Set(out)];
  }

  /** Fires a reminder once per (ticket, type, threshold). Returns true when it sent. */
  private async remindOnce(ticketKey: string, type: string, threshold: string, send: () => Promise<void>): Promise<boolean> {
    const repo = this.ds.getRepository(ReminderStateEntity);
    const seen = await repo.findOne({ where: { ticketKey, reminderType: type, threshold } });
    if (seen) return false;
    await send();
    await repo.insert({ ticketKey, reminderType: type, threshold, lastSentAt: clock.now() });
    return true;
  }

  private approverIdsFor(t: TicketEntity, step: string, approval: ApprovalEntity | null): string[] {
    if (step === 'mgr') {
      const mgr = approval?.approverId ?? this.cfg.person(t.requesterId)?.managerId ?? null;
      return mgr ? [mgr] : [];
    }
    const roles: Record<string, string[]> = { lnd: ['LND_HEAD', 'HRLND_ADMIN'], ith: ['IT_HEAD'], adm: ['ADM_HEAD'] };
    return this.cfg.peopleList().filter((p) => !p.isQueue && p.roles.some((r) => roles[step]?.includes(r))).map((p) => p.id);
  }

  async tick(): Promise<{ escalated: number; responseBreaches: number; resolutionBreaches: number; warnings: number; reminders: number }> {
    const res = { escalated: 0, responseBreaches: 0, resolutionBreaches: 0, warnings: 0, reminders: 0 };
    if (this.running) return res;
    this.running = true;
    try {
      const now = clock.nowMs();
      const all = await this.ds.getRepository(TicketEntity).find({ where: { helpdesk: In([...HD_ORDER]) } });
      const open = all.filter((t) => !this.cfg.statusModel(t.helpdesk).closed.includes(t.status) && t.status !== 'Pending approval' && t.slaStarted);
      const byKey = new Map(all.map((t) => [t.key, t]));
      const [evs, comments] = all.length
        ? await Promise.all([
            this.ds.getRepository(EventEntity).find({ where: { ticketKey: In(all.map((t) => t.key)) } }),
            this.ds.getRepository(CommentEntity).find({ where: { ticketKey: In(all.map((t) => t.key)), internal: false }, order: { createdAt: 'ASC', id: 'ASC' } }),
          ])
        : [[], []] as [EventEntity[], CommentEntity[]];
      const firstReply = new Map<string, Date>();
      for (const c of comments) if (c.authorId !== byKey.get(c.ticketKey)?.requesterId && !firstReply.has(c.ticketKey)) firstReply.set(c.ticketKey, c.createdAt);
      const had = (key: string, prefix: string) => evs.some((e) => e.ticketKey === key && e.text.startsWith(prefix));
      const ev = (key: string, text: string, kind: string) => this.ds.getRepository(EventEntity).insert({ ticketKey: key, at: clock.now(), text, kind });
      const away = await this.cover.awayFn(clock.now());

      for (const t of open) {
        const cat = this.cfg.category(t.helpdesk, t.categoryKey);
        const tref = this.ref(t);
        const reply = firstReply.get(t.key) ?? null;
        if (!had(t.key, 'Response SLA breached') && isResponseBreached({ ...t, firstReply: reply }, now)) {
          if (t.responseMet !== false) await this.ds.getRepository(TicketEntity).update(t.key, { responseMet: false });
          const lead = cat?.leadId || cat?.ownerId || '';
          await ev(t.key, 'Response SLA breached · lead notified', 'sla');
          await this.events.emitTicketEvent('SLA_RESPONSE_BREACHED', tref, null, { recipients: lead ? [lead] : [] });
          res.responseBreaches++;
        }
        if (t.paused) continue;
        const start = (t.slaStart ?? t.createdAt).getTime();
        const span = Math.max(1, t.resolutionDue.getTime() - start);
        const used = ((now - start) / span) * 100;
        const ladder = this.cfg.ladder(t.helpdesk, t.categoryKey, t.slaVer);
        const base = t.ladderBase ?? 0;
        const reached = escalationReached(used, base, t.escalationLevel, ladder.map((l) => l.pct));
        let assignee = t.assigneeId;
        if (reached > t.escalationLevel) {
          const asgHist: AsgRecord[] = [...(t.asgHist ?? [])];
          const escLog: EscRecord[] = [...(t.escLog ?? [])];
          for (let lvl = t.escalationLevel + 1; lvl <= reached; lvl++) {
            const absIdx = base + lvl - 1;
            const l = ladder[absIdx];
            if (!l) break;
            const from = assignee;
            const to = this.resolveTarget(t, cat, ladder, absIdx, from, away) ?? from;
            const lvlAbs = base + lvl;
            const at = clock.now().toISOString();
            const suffix = to === from ? 'no eligible next manager; kept with the current holder' : `${this.cfg.name(to)} (${l.role.toLowerCase()})`;
            await ev(t.key, `Escalated to Level ${lvlAbs} · ${suffix}`, 'esc');
            await this.events.emitTicketEvent('TICKET_ESCALATED', this.ref(t, to), null, {
              recipients: this.recipientsFor([to, from, ...(lvlAbs >= 2 ? this.hdAdminsFor(t.helpdesk) : [])], away),
              oldAssigneeId: from, newAssigneeId: to, variant: 'agent', level: lvlAbs,
            });
            await this.events.emitTicketEvent('TICKET_ESCALATED', this.ref(t, to), null, { recipients: [t.requesterId], variant: 'requester', level: lvlAbs });
            if (to !== from) asgHist.push({ u: to, at, how: 'escalation', coverFor: null });
            escLog.push({ level: lvlAbs, at, from, to, how: 'sla', by: null });
            assignee = to;
            res.escalated++;
          }
          const patch: Partial<TicketEntity> = { escalationLevel: reached, assigneeId: assignee, asgHist, escLog, updatedAt: clock.now() };
          if (t.helpdesk === 'SF' && this.cfg.statusModel('SF').open.includes('Escalated')) patch.status = 'Escalated';
          await this.ds.getRepository(TicketEntity).update(t.key, patch);
        }
        const afterRef = this.ref(t, assignee);
        if (t.resolutionDue.getTime() < now && !had(t.key, 'Resolution SLA breached')) {
          await ev(t.key, 'Resolution SLA breached', 'sla');
          await this.events.emitTicketEvent('SLA_RESOLUTION_BREACHED', afterRef, null);
          res.resolutionBreaches++;
        } else if (t.resolutionDue.getTime() >= now) {
          const dueIn = t.resolutionDue.getTime() - now;
          // Reminder: at risk at 75% elapsed, or due within 2 h.
          if (used >= 75 && (await this.remindOnce(t.key, 'SLA_AT_RISK', '75%', () => this.events.emitTicketEvent('SLA_AT_RISK', afterRef, null, { threshold: '75%', dueText: fdt(t.resolutionDue) }))))
            res.reminders++;
          if (dueIn < 2 * 3600000 && !had(t.key, 'Resolution due soon')) {
            await ev(t.key, `Resolution due soon · ${fdt(t.resolutionDue)}`, 'sla');
            if (await this.remindOnce(t.key, 'SLA_AT_RISK', '2 hours', () => this.events.emitTicketEvent('SLA_AT_RISK', afterRef, null, { threshold: '2 hours', dueText: fdt(t.resolutionDue) })))
              res.reminders++;
            res.warnings++;
          }
        }
        // Reminder: waiting for the employee over 48 h (paused tickets only).
        const wait = this.cfg.statusModel(t.helpdesk).wait;
        if (t.paused && t.status === wait && now - t.updatedAt.getTime() > 48 * 3600000) {
          if (await this.remindOnce(t.key, 'WAITING_FOR_EMPLOYEE', '48 hours', () => this.events.emitTicketEvent('WAITING_FOR_EMPLOYEE', afterRef, null, { threshold: '48 hours' })))
            res.reminders++;
        }
      }

      // Reminder: approval stuck over 24 h (and again at 48 h).
      const pending = all.filter((t) => t.status === 'Pending approval' && !this.cfg.statusModel(t.helpdesk).closed.includes(t.status));
      if (pending.length) {
        const approvals = await this.ds.getRepository(ApprovalEntity).find({ where: { ticketKey: In(pending.map((t) => t.key)) } });
        for (const t of pending) {
          const chain = approvals.filter((a) => a.ticketKey === t.key)
            .map((a) => ({ step: a.step, seq: a.seq, status: a.status, approverId: a.approverId, decidedById: a.decidedById, decidedAt: a.decidedAt }))
            .sort((a, b) => a.seq - b.seq);
          const cur = chain.find((a) => a.status !== 'Approved');
          if (!cur || cur.status !== 'Pending') continue;
          const idx = chain.findIndex((a) => a.step === cur.step);
          const waitingSince = (idx > 0 ? chain[idx - 1].decidedAt : null) ?? t.createdAt;
          const waited = now - waitingSince.getTime();
          const ap = approvals.find((a) => a.ticketKey === t.key && a.step === cur.step) ?? null;
          const approverIds = this.approverIdsFor(t, cur.step, ap);
          if (waited > 24 * 3600000 && (await this.remindOnce(t.key, 'APPROVAL_STUCK', '24 hours', () => this.events.emitTicketEvent('APPROVAL_STUCK', this.ref(t), null, { recipients: approverIds, threshold: '24 hours' }))))
            res.reminders++;
          if (waited > 48 * 3600000 && (await this.remindOnce(t.key, 'APPROVAL_STUCK', '48 hours', () => this.events.emitTicketEvent('APPROVAL_STUCK', this.ref(t), null, { recipients: approverIds, threshold: '48 hours' }))))
            res.reminders++;
        }
      }

      // Reminder: unattended (no cover) for over 4 h.
      const noCover = await this.ds.getRepository(EventEntity).find({ where: { ticketKey: In(all.map((t) => t.key)), text: Like('No cover available%') } });
      for (const e of noCover) {
        const t = all.find((x) => x.key === e.ticketKey);
        if (!t || this.cfg.statusModel(t.helpdesk).closed.includes(t.status)) continue;
        if (now - e.at.getTime() > 4 * 3600000) {
          if (await this.remindOnce(t.key, 'UNATTENDED_REMINDER', '4 hours', () => this.events.emitTicketEvent('UNATTENDED_REMINDER', this.ref(t), null, { recipients: this.hdAdminsFor(t.helpdesk), threshold: '4 hours' })))
            res.reminders++;
        }
      }

      if (res.escalated || res.responseBreaches || res.reminders) this.log.log(`sla tick: ${JSON.stringify(res)}`);
      return res;
    } finally {
      this.running = false;
    }
  }

  private hdAdmins(): string[] {
    return this.cfg.peopleList().filter((p) => !p.isQueue && p.roles.includes('HD_ADMIN')).map((p) => p.id);
  }
}
