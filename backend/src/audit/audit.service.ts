import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { clock } from '../common/clock';
import { AuditEntity } from '../database/entities';
import { AuditPluginService, AuditPluginSeverity } from './audit-plugin.service';

/** Append-only audit log: denied access, confidential reads by admins, approvals, config changes, resets, sign-ins. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditEntity) private readonly repo: Repository<AuditEntity>,
    private readonly plugin: AuditPluginService,
  ) {}

  async record(actorId: string | null, action: string, summary: string, opts: { target?: string; outcome?: 'ok' | 'denied'; detail?: Record<string, any>; at?: Date } = {}) {
    const at = opts.at ?? clock.now();
    const text = summary.slice(0, 400);
    const result = await this.repo.insert({ at, actorId, action, summary: text, target: opts.target ?? null, outcome: opts.outcome ?? 'ok', detail: opts.detail ?? null });
    const localId = Number(result.identifiers?.[0]?.id ?? result.raw?.[0]?.id ?? 0) || null;
    try {
      await this.plugin.record({
        eventId: randomUUID(),
        action,
        actorId: actorId ?? 'anonymous',
        targetId: opts.target ?? null,
        targetType: this.targetType(opts.target),
        status: opts.outcome === 'denied' ? 'FAILURE' : 'SUCCESS',
        severity: this.severity(action, opts.outcome),
        summary: text,
        detail: opts.detail ?? null,
        helpdeskAuditId: localId,
        timestamp: at.toISOString(),
      });
    } catch (err) {
      this.logger.warn(`Audit plugin delivery failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async list(limit = 50, action?: string) {
    return this.repo.find({ where: action ? { action } : {}, order: { at: 'DESC', id: 'DESC' }, take: limit });
  }

  private targetType(target?: string): string | null {
    if (!target) return null;
    if (/^(?:HR|HRD|LND|IT|ADM|SF|SE)-\d+/i.test(target)) return 'ticket';
    const separator = target.indexOf(':');
    if (separator > 0) return target.slice(0, separator);
    if (/^u\d+$/i.test(target)) return 'user';
    return null;
  }

  private severity(action: string, outcome?: 'ok' | 'denied'): AuditPluginSeverity {
    if (outcome === 'denied') return 'WARNING';
    if (action.startsWith('ticket.') || action.startsWith('auth.') || action.includes('.approval') || action === 'config.change') return 'AUDIT';
    return 'INFO';
  }
}
