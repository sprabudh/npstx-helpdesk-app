import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { clock, fdt } from '../common/clock';
import { env } from '../common/env';
import { AsgRecord, EscRecord, EventEntity, TicketEntity } from '../database/entities';
import { HelpdeskConfigService } from '../helpdesk-config/config.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Background SLA job (every 60 s when SLA_SCHEDULER_ENABLED=true; also runnable from the Admin console):
 * marks first-response breaches, escalates by the ladder's share of resolution time, records resolution
 * breaches, and warns the assignee 2 hours before the resolution target. Salesforce is skipped: its
 * escalation rules run in Salesforce.
 */
@Injectable()
export class SlaScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('SlaScheduler');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly cfg: HelpdeskConfigService, private readonly notes: NotificationsService) {}

  onModuleInit() {
    if (env.slaSchedulerEnabled && env.nodeEnv !== 'test') this.timer = setInterval(() => void this.tick().catch((e) => this.log.error(e.message)), 60000);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<{ escalated: number; responseBreaches: number; resolutionBreaches: number; warnings: number }> {
    const res = { escalated: 0, responseBreaches: 0, resolutionBreaches: 0, warnings: 0 };
    if (this.running) return res;
    this.running = true;
    try {
      const now = clock.nowMs();
      const all = await this.ds.getRepository(TicketEntity).find({ where: { helpdesk: In(['HR', 'LND', 'IT', 'ADM']) } });
      const open = all.filter((t) => !this.cfg.statusModel(t.helpdesk).closed.includes(t.status) && t.status !== 'Pending approval');
      const evs = open.length ? await this.ds.getRepository(EventEntity).find({ where: { ticketKey: In(open.map((t) => t.key)), kind: 'sla' } }) : [];
      const had = (key: string, prefix: string) => evs.some((e) => e.ticketKey === key && e.text.startsWith(prefix));
      const ev = (key: string, text: string, kind: string) => this.ds.getRepository(EventEntity).insert({ ticketKey: key, at: clock.now(), text, kind });
      for (const t of open) {
        const tk = { key: t.key, confidential: t.confidential };
        const cat = this.cfg.category(t.helpdesk, t.categoryKey);
        if (t.responseMet === null && t.responseDue.getTime() < now) {
          await this.ds.getRepository(TicketEntity).update(t.key, { responseMet: false });
          await ev(t.key, 'Response SLA breached · lead notified', 'sla');
          await this.notes.notify([cat?.leadId], `${t.key} missed its first-response target`, tk, null);
          res.responseBreaches++;
        }
        if (t.paused) continue;
        const span = Math.max(1, t.resolutionDue.getTime() - t.createdAt.getTime());
        const used = ((now - t.createdAt.getTime()) / span) * 100;
        const ladder = this.cfg.ladder(t.helpdesk, t.categoryKey, t.slaVer);
        const base = t.ladderBase ?? 0;
        const reached = ladder.slice(base).filter((l) => used >= l.pct).length;
        if (reached > t.escalationLevel) {
          const asgHist: AsgRecord[] = [...(t.asgHist ?? [])];
          const escLog: EscRecord[] = [...(t.escLog ?? [])];
          for (let lvl = t.escalationLevel + 1; lvl <= reached; lvl++) {
            const l = ladder[base + lvl - 1];
            await ev(t.key, `Escalated to Level ${lvl} · ${this.cfg.name(l.who)} (${l.role.toLowerCase()})`, 'esc');
            await this.notes.notify([l.who, t.assigneeId], `${t.key} escalated to Level ${lvl}`, tk, null);
            const at = clock.now().toISOString();
            asgHist.push({ u: l.who, at, how: 'escalation', coverFor: null });
            escLog.push({ level: lvl, at, from: t.assigneeId, to: l.who, how: 'auto', by: null });
            res.escalated++;
          }
          await this.ds.getRepository(TicketEntity).update(t.key, { escalationLevel: reached, asgHist, escLog });
        }
        if (t.resolutionDue.getTime() < now && !had(t.key, 'Resolution SLA breached')) {
          await ev(t.key, 'Resolution SLA breached', 'sla');
          res.resolutionBreaches++;
        } else if (t.resolutionDue.getTime() >= now && t.resolutionDue.getTime() - now < 2 * 3600000 && !had(t.key, 'Resolution due soon')) {
          await ev(t.key, `Resolution due soon · ${fdt(t.resolutionDue)}`, 'sla');
          await this.notes.notify([t.assigneeId], `${t.key} is due ${fdt(t.resolutionDue)}`, tk, null);
          res.warnings++;
        }
      }
      if (res.escalated || res.responseBreaches) this.log.log(`sla tick: ${JSON.stringify(res)}`);
      return res;
    } finally {
      this.running = false;
    }
  }
}
