import { Inject, Injectable } from '@nestjs/common';
import { FollowerRef } from '../domain/types';
import { Helpdesk } from '../domain/types';
import { PRIORITY_VISIBLE_TO_REQUESTER } from '../domain/policy';
import { HelpdeskConfigService } from '../helpdesk-config/config.service';
import {
  channelSet, confidentialText, EVENT_CATALOGUE, EventType, RecipientRule, TemplateVars,
} from './event-catalogue';
import { NOTIFICATION_GATEWAY, NotificationGateway } from './gateway';

/** Minimal ticket view the emitter needs. Callers build this from the loaded Row. */
export interface TicketRef {
  key: string;
  helpdesk: Helpdesk;
  categoryKey: string;
  requesterId: string;
  assigneeId: string;
  confidential: boolean;
  status: string;
  priority: string;
  followers?: FollowerRef[];
  requesterManagerId?: string | null;
}

export interface ActorRef {
  id: string;
  name: string;
}

/** Everything a caller can pass to shape recipients and the template. All optional. */
export interface EmitContext {
  /** The single person for target rules (CC / follower / tag / removal). */
  targetUserId?: string;
  targetName?: string;
  /** Escalation / reassignment. */
  oldAssigneeId?: string;
  newAssigneeId?: string;
  /** Absolute escalation level number (includes ladder base). */
  level?: number;
  /** Approver ids for the current / next approval step. */
  approverIds?: string[];
  /** Pre-assigned agent (used on rejection). */
  preAssignedId?: string;
  /** Approval step label and the next step label. */
  label?: string;
  nextLabel?: string;
  /** Cover suffix text, e.g. " (covering for Priya Rao)". */
  cover?: string;
  /** Which audience the escalation text is for. */
  variant?: 'agent' | 'requester';
  /** Reminder threshold label ("24 hours", "75%", "2 hours", "4 hours"). */
  threshold?: string;
  /** Human date for a due target. */
  dueText?: string;
  /** Staff ids that should receive an internal-note notification (@mentions). */
  staffIds?: string[];
  /** Explicit recipient override; when set the rule is bypassed (still deduped / actor-skipped). */
  recipients?: string[];
  /** Extra recipients appended to the rule result. */
  extraRecipients?: string[];
  /** Close wording: the combined status/response segment, e.g. "closed · Resolved" or "resolved". */
  closeResp?: string;
}

/**
 * The one entry point every ticket action uses (Step 1). It resolves recipients, channels, template,
 * dedupe and confidentiality from the catalogue, then hands the event to the NotificationGateway.
 * It never notifies the actor, never stores a queue id, and never reveals absence wording.
 */
@Injectable()
export class TicketEventEmitter {
  constructor(
    private readonly cfg: HelpdeskConfigService,
    @Inject(NOTIFICATION_GATEWAY) private readonly gateway: NotificationGateway,
  ) {}

  async emitTicketEvent(type: EventType, ticket: TicketRef, actor: ActorRef | null, context: EmitContext = {}): Promise<void> {
    const def = EVENT_CATALOGUE[type];
    if (!def) return;

    const followerIds = (ticket.followers ?? []).map((f) => f.userId);
    const leadId = this.cfg.category(ticket.helpdesk, ticket.categoryKey)?.leadId ?? null;

    let recipients = context.recipients ?? this.resolveRecipients(def.recipient, ticket, context, followerIds, leadId);
    recipients = [...recipients, ...(context.extraRecipients ?? [])];

    // Dedupe, drop empties, drop queues, drop the actor (a person is never told about their own action).
    const seen = new Set<string>();
    const final: string[] = [];
    for (const id of recipients) {
      if (!id || id === actor?.id || seen.has(id)) continue;
      if (this.cfg.person(id)?.isQueue) continue;
      seen.add(id);
      final.push(id);
    }
    if (!final.length) return;

    const vars: TemplateVars = {
      key: ticket.key,
      actorName: actor?.name,
      requesterName: this.cfg.name(ticket.requesterId),
      cover: context.cover,
      targetName: context.targetName,
      status: ticket.status,
      priority: ticket.priority,
      label: context.label,
      nextLabel: context.nextLabel,
      level: context.level,
      dueText: context.dueText,
      threshold: context.threshold,
      variant: context.variant,
    };
    const plain = def.template(vars);
    const channel = channelSet(def);
    const text = ticket.confidential ? confidentialText(ticket.key) : plain;
    const payload = this.buildPayload(type, ticket, actor, context, plain);

    for (const recipient of final) {
      // Hidden priority (TC): never send a priority value to a plain requester.
      if (type === 'TICKET_PRIORITY_CHANGED' && !PRIORITY_VISIBLE_TO_REQUESTER && recipient === ticket.requesterId) continue;
      const threshold = context.threshold ? `:${context.threshold}` : '';
      const level = context.level != null ? `:L${context.level}` : '';
      await this.gateway.publish({
        eventType: type,
        category: def.category,
        ticketKey: ticket.key,
        ticketId: ticket.key,
        recipientUserId: recipient,
        actorUserId: actor?.id ?? null,
        channel,
        text,
        confidential: ticket.confidential,
        payload,
        dedupeKey: `${type}:${ticket.key}:${recipient}${level}${threshold}`,
        occurredAt: new Date().toISOString(),
      });
    }
  }

  /** Recipient policy — the single place it lives. */
  private resolveRecipients(rule: RecipientRule, ticket: TicketRef, ctx: EmitContext, followerIds: string[], leadId: string | null): string[] {
    const assignee = ctx.newAssigneeId ?? ticket.assigneeId;
    switch (rule) {
      case 'assignee': return [assignee];
      case 'queue-members': return this.cfg.queueMembers(ticket.assigneeId);
      case 'requester': return [ticket.requesterId];
      case 'requester+followers': return [ticket.requesterId, ...followerIds];
      case 'requester+assignee+followers': return [ticket.requesterId, assignee, ...followerIds];
      case 'reassign': return [ctx.newAssigneeId ?? ticket.assigneeId, ctx.oldAssigneeId ?? '', ticket.requesterId, ...followerIds];
      case 'escalation': {
        const out = [ctx.newAssigneeId ?? ticket.assigneeId, ctx.oldAssigneeId ?? '', ticket.requesterId, ...followerIds];
        if ((ctx.level ?? 0) >= 2) out.push(...this.hdAdmins());
        return out;
      }
      case 'approver-current':
      case 'approver-next': return ctx.approverIds ?? [];
      case 'approval-reject': return [ticket.requesterId, ctx.preAssignedId ?? '', ...followerIds];
      case 'hd-admins': return this.hdAdmins();
      case 'category-lead': return [leadId ?? ''];
      case 'target': return [ctx.targetUserId ?? ''];
      case 'internal-staff': return [assignee, ...(ctx.staffIds ?? [])];
      case 'reopen': return [ctx.newAssigneeId ?? ticket.assigneeId, leadId ?? ''];
      case 'cancel': return [assignee, ...(ctx.approverIds ?? []), ...followerIds];
      case 'auto-closed': return [ticket.requesterId, assignee, ...followerIds];
      case 'reminder-sla': return [assignee];
      case 'reminder-approval': return ctx.approverIds ?? [];
      case 'reminder-waiting': return [assignee, leadId ?? ''];
      case 'reminder-unattended': return this.hdAdmins();
      default: return [];
    }
  }

  private hdAdmins(): string[] {
    return this.cfg.peopleList().filter((p) => !p.isQueue && p.roles.includes('HD_ADMIN')).map((p) => p.id);
  }

  /** Masked when confidential: only the event type and ticket id survive. */
  private buildPayload(type: EventType, ticket: TicketRef, actor: ActorRef | null, ctx: EmitContext, text: string): Record<string, any> {
    if (ticket.confidential) return { eventType: type, ticketKey: ticket.key };
    const p: Record<string, any> = { eventType: type, ticketKey: ticket.key, text };
    if (actor) p.actorId = actor.id;
    if (ctx.targetUserId) p.targetUserId = ctx.targetUserId;
    if (ctx.oldAssigneeId) p.oldAssigneeId = ctx.oldAssigneeId;
    if (ctx.newAssigneeId) p.newAssigneeId = ctx.newAssigneeId;
    if (ctx.level != null) p.level = ctx.level;
    if (ctx.threshold) p.threshold = ctx.threshold;
    if (ctx.cover) p.coverFor = ctx.cover.trim();
    return p;
  }
}
