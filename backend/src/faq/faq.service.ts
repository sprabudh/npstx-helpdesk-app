import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { clock } from '../common/clock';
import { forbidden, notFound } from '../common/errors';
import { FaqEntity, FaqVoteEntity } from '../database/entities';
import { allowedHds, canEditFaq } from '../domain/policy';
import { Principal } from '../domain/types';
import { AuditService } from '../audit/audit.service';
import { HelpdeskConfigService } from '../helpdesk-config/config.service';

@Injectable()
export class FaqService {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly cfg: HelpdeskConfigService, private readonly audit: AuditService) {}

  private policyLead() {
    return this.cfg.category('HR', 'POL')?.leadId ?? null;
  }
  async list(u: Principal, hd: string) {
    if (!allowedHds(u).includes(hd as never)) {
      await this.audit.record(u.id, 'faq.view', `Denied ${hd} FAQs`, { outcome: 'denied' });
      throw forbidden(hd === 'SF' ? 'The Salesforce helpdesk is available only to Sales, Presales and Solutions.' : 'Unknown helpdesk.', hd === 'SF' ? 'SALESFORCE_FORBIDDEN' : 'FORBIDDEN');
    }
    const faqs = await this.ds.getRepository(FaqEntity).find({ where: { helpdesk: hd }, order: { sortOrder: 'ASC' } });
    return { helpdesk: hd, canEdit: canEditFaq(u, hd, this.policyLead()), faqs };
  }
  /** All FAQs of the helpdesks this person may use (for the AI knowledge base and dashboard search). */
  async visible(u: Principal) {
    const hds = allowedHds(u);
    return (await this.ds.getRepository(FaqEntity).find({ order: { helpdesk: 'ASC', sortOrder: 'ASC' } })).filter((f) => hds.includes(f.helpdesk as never));
  }
  async vote(u: Principal, id: number, helpful: boolean) {
    const f = await this.ds.getRepository(FaqEntity).findOne({ where: { id } });
    if (!f || !allowedHds(u).includes(f.helpdesk as never)) throw notFound('FAQ');
    await this.ds.getRepository(FaqVoteEntity).insert({ faqId: id, userId: u.id, helpful, createdAt: clock.now() });
    return { ok: true, categoryKey: f.categoryKey, helpdesk: f.helpdesk };
  }
  async update(u: Principal, id: number, body: { question: string; answer: string; categoryKey?: string | null }) {
    const f = await this.ds.getRepository(FaqEntity).findOne({ where: { id } });
    if (!f) throw notFound('FAQ');
    if (!canEditFaq(u, f.helpdesk, this.policyLead())) throw forbidden('Only the helpdesk owner can edit these FAQs.', 'NOT_FAQ_EDITOR');
    await this.ds.getRepository(FaqEntity).update(id, { question: body.question.trim(), answer: body.answer.trim(), categoryKey: body.categoryKey ?? f.categoryKey });
    await this.audit.record(u.id, 'config.change', `Edited ${this.cfg.helpdeskLabel(f.helpdesk)} FAQ "${body.question.trim().slice(0, 80)}"`, { target: `faq:${id}` });
    return { toast: 'FAQ saved' };
  }
}
