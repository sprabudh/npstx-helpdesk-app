import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull } from 'typeorm';
import { clock } from '../common/clock';
import { env } from '../common/env';
import { NotificationEntity, OutboxEntity, UserEntity } from '../database/entities';

/** Email delivery behind an interface. Locally the console adapter prints the email to the log. */
export interface EmailAdapter {
  send(to: string, subject: string, body: string): Promise<void>;
}
export class ConsoleEmailAdapter implements EmailAdapter {
  private readonly log = new Logger('Email');
  async send(to: string, subject: string, _body: string) {
    // Recipient domain only: no personal data or ticket text in logs.
    this.log.log(`email queued to *@${to.split('@')[1] ?? 'unknown'}: ${subject}`);
  }
}
export const EMAIL_ADAPTER = 'EMAIL_ADAPTER';

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Notifications');
  private timer: NodeJS.Timeout | null = null;
  private readonly email: EmailAdapter = new ConsoleEmailAdapter();

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  onModuleInit() {
    if (env.nodeEnv !== 'test') this.timer = setInterval(() => void this.flushOutbox(), env.outboxIntervalMs);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * In-app notification plus an email in the outbox for each recipient. The actor and queues are skipped.
   * Confidential tickets carry only the ticket id (SDD 9.6).
   */
  async notify(ids: (string | null | undefined)[], text: string, ticket: { key: string; confidential: boolean }, actorId: string | null) {
    const uniq = [...new Set(ids.filter((x): x is string => !!x && x !== actorId))];
    if (!uniq.length) return;
    const users = await this.ds.getRepository(UserEntity).find({ where: { id: In(uniq) } });
    const msg = ticket.confidential ? `Update on ${ticket.key} (confidential)` : text;
    const at = clock.now();
    for (const u of users.filter((x) => !x.isQueue)) {
      await this.ds.getRepository(NotificationEntity).insert({ userId: u.id, text: msg, ticketKey: ticket.key, createdAt: at, readAt: null });
      if (u.email)
        await this.ds.getRepository(OutboxEntity).insert({
          channel: 'email', recipient: u.email, subject: `[NPSTX Helpdesk] ${ticket.key}`,
          body: `${msg}\n\nOpen the ticket in NPSTX Helpdesk to see the details.`, status: 'pending', attempts: 0, lastError: null, sentAt: null,
        });
    }
  }

  list(userId: string) {
    return this.ds.getRepository(NotificationEntity).find({ where: { userId }, order: { createdAt: 'DESC', id: 'DESC' }, take: 50 });
  }
  unread(userId: string) {
    return this.ds.getRepository(NotificationEntity).count({ where: { userId, readAt: IsNull() } });
  }
  async markRead(userId: string, id: number) {
    await this.ds.getRepository(NotificationEntity).update({ id, userId }, { readAt: clock.now() });
  }
  async markAll(userId: string) {
    await this.ds.getRepository(NotificationEntity).update({ userId, readAt: IsNull() }, { readAt: clock.now() });
  }

  /** Sends pending outbox emails; failed sends retry up to 5 times. */
  async flushOutbox(): Promise<number> {
    const repo = this.ds.getRepository(OutboxEntity);
    const batch = await repo.find({ where: { status: 'pending' }, order: { id: 'ASC' }, take: 50 });
    for (const m of batch) {
      try {
        await this.email.send(m.recipient, m.subject, m.body);
        await repo.update(m.id, { status: 'sent', sentAt: new Date(), attempts: m.attempts + 1 });
      } catch (e) {
        const attempts = m.attempts + 1;
        await repo.update(m.id, { attempts, status: attempts >= 5 ? 'failed' : 'pending', lastError: (e instanceof Error ? e.message : 'error').slice(0, 300) });
        this.log.warn(`outbox ${m.id} failed (attempt ${attempts})`);
      }
    }
    return batch.length;
  }
}
