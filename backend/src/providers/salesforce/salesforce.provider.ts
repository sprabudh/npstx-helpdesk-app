import { Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { fdt } from '../../common/clock';
import { SfCaseEntity, TicketEntity, UserEntity } from '../../database/entities';
import { TicketProvider } from '../ticket-provider';
import { SalesforceAdapter } from './salesforce.adapter';

/** Salesforce helpdesk: every ticket is a Service Cloud Case. The sf_cases table mirrors the case locally. */
export class SalesforceProvider implements TicketProvider {
  readonly helpdesk = 'SF';
  readonly native = false;
  private readonly log = new Logger('SalesforceProvider');
  constructor(private readonly adapter: SalesforceAdapter, private readonly lookup: (em: EntityManager, key: string) => Promise<SfCaseEntity | null>) {}

  async onCreated(em: EntityManager, t: TicketEntity) {
    const requester = await em.getRepository(UserEntity).findOne({ where: { id: t.requesterId } });
    const { externalId } = await this.adapter.createCase({
      subject: t.title, description: t.description, type: t.categoryKey, reason: t.subCategory, priority: t.priority, origin: 'NPSTX platform', requesterEmail: requester?.email ?? null,
    });
    await em.getRepository(SfCaseEntity).insert({
      ticketKey: t.key, caseNo: t.key.slice(3), entitlement: 'Internal Sales Support', externalId,
      milestones: [['First response', `In progress · due ${fdt(t.responseDue)}`]],
    });
  }
  async onStatusChanged(t: TicketEntity, _from: string, to: string) {
    const c = await this.lookup(null as never, t.key);
    await this.adapter.updateStatus(c?.externalId ?? null, to).catch((e) => this.log.warn(`status sync failed: ${e.message}`));
  }
  async onComment(t: TicketEntity, body: string, internal: boolean) {
    const c = await this.lookup(null as never, t.key);
    await this.adapter.addComment(c?.externalId ?? null, body, !internal).catch((e) => this.log.warn(`comment sync failed: ${e.message}`));
  }
}
