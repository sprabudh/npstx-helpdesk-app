import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { clock } from '../common/clock';
import { AuditEntity } from '../database/entities';

/** Append-only audit log: denied access, confidential reads by admins, approvals, config changes, resets, sign-ins. */
@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditEntity) private readonly repo: Repository<AuditEntity>) {}

  async record(actorId: string | null, action: string, summary: string, opts: { target?: string; outcome?: 'ok' | 'denied'; detail?: Record<string, any> } = {}) {
    await this.repo.insert({ at: clock.now(), actorId, action, summary: summary.slice(0, 400), target: opts.target ?? null, outcome: opts.outcome ?? 'ok', detail: opts.detail ?? null });
  }

  async list(limit = 50, action?: string) {
    return this.repo.find({ where: action ? { action } : {}, order: { at: 'DESC', id: 'DESC' }, take: limit });
  }
}
