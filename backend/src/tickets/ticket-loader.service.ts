import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Brackets, DataSource, In } from 'typeorm';
import { clock } from '../common/clock';
import { forbidden, notFound } from '../common/errors';
import { ApprovalEntity, EventEntity, FollowerEntity, TicketEntity } from '../database/entities';
import { allowedHds, canView, has, isApprover, isHeadish, isWorker } from '../domain/policy';
import { isClosed } from '../domain/sla';
import { Helpdesk, Principal, TicketCtx } from '../domain/types';
import { AuditService } from '../audit/audit.service';
import { HelpdeskConfigService } from '../helpdesk-config/config.service';

export interface Row {
  t: TicketEntity;
  ctx: TicketCtx;
  closed: boolean;
}

/** Loads tickets with the context the access policy needs. Row-level filter in SQL, object-level check in code. */
@Injectable()
export class TicketLoader {
  constructor(
    @InjectDataSource() readonly ds: DataSource,
    private readonly cfg: HelpdeskConfigService,
    private readonly audit: AuditService,
  ) {}

  async withCtx(tickets: TicketEntity[]): Promise<Row[]> {
    if (!tickets.length) return [];
    const keys = tickets.map((t) => t.key);
    const [fol, apr] = await Promise.all([
      this.ds.getRepository(FollowerEntity).find({ where: { ticketKey: In(keys) } }),
      this.ds.getRepository(ApprovalEntity).find({ where: { ticketKey: In(keys) } }),
    ]);
    return tickets.map((t) => {
      const cat = this.cfg.category(t.helpdesk, t.categoryKey);
      const ctx: TicketCtx = {
        key: t.key, helpdesk: t.helpdesk as Helpdesk, categoryKey: t.categoryKey, status: t.status, requesterId: t.requesterId,
        assigneeId: t.assigneeId, confidential: t.confidential, closeResponse: t.closeResponse, closedAt: t.closedAt,
        followers: fol.filter((f) => f.ticketKey === t.key).map((f) => ({ userId: f.userId, relation: f.relation, addedById: f.addedById })),
        approvals: apr.filter((a) => a.ticketKey === t.key).map((a) => ({ step: a.step, seq: a.seq, status: a.status, approverId: a.approverId, decidedById: a.decidedById, decidedAt: a.decidedAt })),
        category: cat ? { leadId: cat.leadId, ownerId: cat.ownerId, restricted: cat.restricted, reopenAllowed: cat.reopenAllowed, name: cat.name } : null,
        requesterManagerId: this.cfg.person(t.requesterId)?.managerId ?? null,
      };
      return { t, ctx, closed: isClosed(this.cfg.statusModel(t.helpdesk), t.status) };
    });
  }

  /**
   * Every ticket the user may see. SQL narrows by helpdesk (Salesforce never leaves the database for
   * other departments) and, for people with no working, head or approver role, by involvement.
   */
  async visible(u: Principal): Promise<Row[]> {
    const qb = this.ds.getRepository(TicketEntity).createQueryBuilder('t').where('t.helpdesk IN (:...hds)', { hds: allowedHds(u) });
    const leads = this.cfg.categories().some((c) => c.leadId === u.id);
    const broad = isWorker(u) || isHeadish(u) || isApprover(u) || has(u, 'HRLND_ADMIN') || leads;
    if (!broad)
      qb.andWhere(new Brackets((w) => {
        w.where('t.requester_id = :id', { id: u.id })
          .orWhere('t.assignee_id = :id', { id: u.id })
          .orWhere('EXISTS (SELECT 1 FROM ticket_followers f WHERE f.ticket_key = t.ticket_key AND f.user_id = :id)', { id: u.id });
      }));
    const rows = await this.withCtx(await qb.getMany());
    return rows.filter((r) => canView(u, r.ctx));
  }

  /** One ticket with an object-level check. Denials are audited and return 403 (or 404 when it does not exist). */
  async one(u: Principal, key: string, opts: { audit?: boolean } = {}): Promise<Row> {
    const t = await this.ds.getRepository(TicketEntity).findOne({ where: { key } });
    if (!t) throw notFound('Ticket');
    const [row] = await this.withCtx([t]);
    if (!canView(u, row.ctx)) {
      if (opts.audit !== false)
        await this.audit.record(u.id, 'ticket.view', `Denied access to ${key}`, { target: key, outcome: 'denied', detail: { helpdesk: t.helpdesk, confidential: t.confidential } });
      const sfDenied = t.helpdesk === 'SF';
      throw forbidden(
        t.confidential
          ? t.helpdesk === 'IT'
            ? 'This is a confidential security ticket. Only the requester, IT security, the IT head and helpdesk admins can open it.'
            : 'This is a confidential HR ticket. Only the requester, the assigned agent, the category lead and followers added by them can open it.'
          : sfDenied
            ? 'The Salesforce helpdesk is available only to Sales, Presales and Solutions.'
            : 'You are not the requester, assignee or a follower, and your role does not cover this helpdesk.',
        sfDenied ? 'SALESFORCE_FORBIDDEN' : 'TICKET_FORBIDDEN',
      );
    }
    return row;
  }

  async event(key: string, text: string, kind: string, at = clock.now()) {
    await this.ds.getRepository(EventEntity).insert({ ticketKey: key, at, text: text.slice(0, 400), kind });
  }
}
