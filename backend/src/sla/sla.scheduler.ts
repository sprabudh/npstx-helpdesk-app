import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Like } from 'typeorm';
import { clock, fdt } from '../common/clock';
import { env } from '../common/env';
import { ApprovalEntity, AsgRecord, EscRecord, EventEntity, ReminderStateEntity, TicketEntity } from '../database/entities';
import { Helpdesk } from '../domain/types';
import { HelpdeskConfigService } from '../helpdesk-config/config.service';
import { TicketEventEmitter, TicketRef } from '../notifications/event-emitter.service';

/**
 * Background SLA + reminder job (every 60 s when SLA_SCHEDULER_ENABLED=true; also runnable from the
 * Admin console). It marks first-response breaches, escalates by the ladder's share of resolution
 * time, records resolution breaches, and fires the four reminder events (Step 3) exactly once per
 * ticket/type/threshold. Salesforce is skipped: its escalation rules run in Salesforce.
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
  ) {}

  onModuleInit() {
    if (env.slaSchedulerEnabled && env.nodeEnv !== 'test') this.timer = setInterval(() => void this.tick().catch((e) => this.log.error(e.message)), 60000);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private ref(t: TicketEntity): TicketRef {
    return {
      key: t.key, helpdesk: t.helpdesk as Helpdesk, categoryKey: t.categoryKey, requesterId: t.requesterId, assigneeId: t.assigneeId,
      confidential: t.confidential, status: t.status, priority: t.priority,
    };
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
      const all = await this.ds.getRepository(TicketEntity).find({ where: { helpdesk: In(['HR', 'LND', 'IT', 'ADM']) } });
      const open = all.filter((t) => !this.cfg.statusModel(t.helpdesk).closed.includes(t.status) && t.status !== 'Pending approval' && t.slaStarted);
      const evs = all.length ? await this.ds.getRepository(EventEntity).find({ where: { ticketKey: In(all.map((t) => t.key)), kind: 'sla' } }) : [];
      const had = (key: string, prefix: string) => evs.some((e) => e.ticketKey === key && e.text.startsWith(prefix));
      const ev = (key: string, text: string, kind: string) => this.ds.getRepository(EventEntity).insert({ ticketKey: key, at: clock.now(), text, kind });

      for (const t of open) {
        const cat = this.cfg.category(t.helpdesk, t.categoryKey);
        const tref = this.ref(t);
        if (t.responseMet === null && t.responseDue.getTime() < now) {
          await this.ds.getRepository(TicketEntity).update(t.key, { responseMet: false });
          await ev(t.key, 'Response SLA breached · lead notified', 'sla');
          await this.events.emitTicketEvent('SLA_RESPONSE_BREACHED', tref, null, { recipients: cat?.leadId ? [cat.leadId] : [] });
          res.responseBreaches++;
        }
        if (t.paused) continue;
        const start = (t.slaStart ?? t.createdAt).getTime();
        const span = Math.max(1, t.resolutionDue.getTime() - start);
        const used = ((now - start) / span) * 100;
        const ladder = this.cfg.ladder(t.helpdesk, t.categoryKey, t.slaVer);
        const base = t.ladderBase ?? 0;
        const reached = ladder.slice(base).filter((l) => used >= l.pct).length;
        if (reached > t.escalationLevel) {
          const asgHist: AsgRecord[] = [...(t.asgHist ?? [])];
          const escLog: EscRecord[] = [...(t.escLog ?? [])];
          for (let lvl = t.escalationLevel + 1; lvl <= reached; lvl++) {
            const l = ladder[base + lvl - 1];
            await ev(t.key, `Escalated to Level ${base + lvl} · ${this.cfg.name(l.who)} (${l.role.toLowerCase()})`, 'esc');
            const at = clock.now().toISOString();
            const from = asgHist.length ? asgHist[asgHist.length - 1].u : t.assigneeId;
            const lvlAbs = base + lvl;
            await this.events.emitTicketEvent('TICKET_ESCALATED', tref, null, {
              recipients: [l.who, from, ...(lvlAbs >= 2 ? this.hdAdmins() : [])], variant: 'agent', level: lvlAbs,
            });
            await this.events.emitTicketEvent('TICKET_ESCALATED', tref, null, { recipients: [t.requesterId], variant: 'requester', level: lvlAbs });
            if (l.who !== from) asgHist.push({ u: l.who, at, how: 'escalation', coverFor: null });
            escLog.push({ level: base + lvl, at, from, to: l.who, how: 'sla', by: null });
            res.escalated++;
          }
          await this.ds.getRepository(TicketEntity).update(t.key, { escalationLevel: reached, asgHist, escLog });
        }
        if (t.resolutionDue.getTime() < now && !had(t.key, 'Resolution SLA breached')) {
          await ev(t.key, 'Resolution SLA breached', 'sla');
          await this.events.emitTicketEvent('SLA_RESOLUTION_BREACHED', tref, null);
          res.resolutionBreaches++;
        } else if (t.resolutionDue.getTime() >= now) {
          const dueIn = t.resolutionDue.getTime() - now;
          // Reminder: at risk at 75% elapsed, or due within 2 h.
          if (used >= 75 && (await this.remindOnce(t.key, 'SLA_AT_RISK', '75%', () => this.events.emitTicketEvent('SLA_AT_RISK', tref, null, { threshold: '75%', dueText: fdt(t.resolutionDue) }))))
            res.reminders++;
          if (dueIn < 2 * 3600000 && !had(t.key, 'Resolution due soon')) {
            await ev(t.key, `Resolution due soon · ${fdt(t.resolutionDue)}`, 'sla');
            if (await this.remindOnce(t.key, 'SLA_AT_RISK', '2 hours', () => this.events.emitTicketEvent('SLA_AT_RISK', tref, null, { threshold: '2 hours', dueText: fdt(t.resolutionDue) })))
              res.reminders++;
            res.warnings++;
          }
        }
        // Reminder: waiting for the employee over 48 h (paused tickets only).
        const wait = this.cfg.statusModel(t.helpdesk).wait;
        if (t.paused && t.status === wait && now - t.updatedAt.getTime() > 48 * 3600000) {
          if (await this.remindOnce(t.key, 'WAITING_FOR_EMPLOYEE', '48 hours', () => this.events.emitTicketEvent('WAITING_FOR_EMPLOYEE', tref, null, { threshold: '48 hours' })))
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
          if (await this.remindOnce(t.key, 'UNATTENDED_REMINDER', '4 hours', () => this.events.emitTicketEvent('UNATTENDED_REMINDER', this.ref(t), null, { recipients: this.hdAdmins(), threshold: '4 hours' })))
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
