import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { clock } from '../common/clock';
import { NotificationEntity, OutboxEntity, UserEntity } from '../database/entities';
import { ChannelSet, EventCategory, EventType } from './event-catalogue';

/**
 * The integration boundary (Step 6). Helpdesk code only ever calls `NotificationGateway.publish`.
 * The notification team can replace the local implementation with their own module by rebinding the
 * `NOTIFICATION_GATEWAY` token — no helpdesk code changes.
 *
 * `text`, `payload` and the email body are already confidentiality-masked by the emitter.
 */
export interface NotificationEvent {
  eventType: EventType;
  category: EventCategory;
  ticketKey: string;
  ticketId: string | null;
  recipientUserId: string;
  actorUserId: string | null;
  channel: ChannelSet;
  /** Short message, already masked when the ticket is confidential. */
  text: string;
  confidential: boolean;
  /** Masked structured data. Never contains title, names, comment text or file names when confidential. */
  payload: Record<string, any>;
  /** Unique per (event, ticket, recipient, threshold). Idempotency key. */
  dedupeKey: string;
  /** ISO timestamp the event occurred. */
  occurredAt: string;
}

export interface NotificationGateway {
  publish(event: NotificationEvent): Promise<void>;
}
export const NOTIFICATION_GATEWAY = 'NOTIFICATION_GATEWAY';

const SUBJECT = (key: string) => `[NPSTX Helpdesk] ${key}`;
const DEEP_LINK = (key: string) => `/helpdesk/tickets/${key}`;

/**
 * Local implementation: writes an in-app notification row and, when the event's channel includes
 * email, a pending outbox row. Duplicate `dedupeKey`s are ignored (idempotent). This mirrors the
 * legacy `NotificationsService.notify` write path but adds the event-model columns.
 */
@Injectable()
export class LocalNotificationGateway implements NotificationGateway {
  private readonly log = new Logger('NotificationGateway');
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async publish(event: NotificationEvent): Promise<void> {
    const at = clock.now();
    const repo = this.ds.getRepository(NotificationEntity);
    const email = event.channel === 'in-app+email';
    const recipient = await this.ds.getRepository(UserEntity).findOne({ where: { id: event.recipientUserId } });
    if (!recipient || recipient.isQueue) return; // never store a queue as a recipient

    try {
      await repo.insert({
        userId: event.recipientUserId,
        recipientUserId: event.recipientUserId,
        text: event.text,
        ticketKey: event.ticketKey,
        ticketId: event.ticketId,
        eventType: event.eventType,
        category: event.category,
        actorUserId: event.actorUserId,
        channel: event.channel,
        dedupeKey: event.dedupeKey,
        payload: event.payload,
        createdAt: at,
        readAt: null,
        emailStatus: email ? 'queued' : null,
        emailSentAt: null,
        error: null,
      });
    } catch (e: any) {
      // Unique dedupe_key violation: the same event for the same recipient already exists.
      if (e?.code === 'ER_DUP_ENTRY' || /duplicate/i.test(e?.message ?? '')) return;
      throw e;
    }

    if (email && recipient.email) {
      await this.ds.getRepository(OutboxEntity).insert({
        channel: 'email',
        recipient: recipient.email,
        subject: SUBJECT(event.ticketKey),
        body: `${event.text}\n\nOpen the ticket in NPSTX Helpdesk to see the details.\n${DEEP_LINK(event.ticketKey)}`,
        status: 'pending',
        attempts: 0,
        lastError: null,
        sentAt: null,
      });
    }
  }
}
