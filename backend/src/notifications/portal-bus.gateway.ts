import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { env } from '../common/env';
import { UserEntity } from '../database/entities';
import { LocalNotificationGateway, NotificationEvent, NotificationGateway } from './gateway';

/** The one command this publisher needs (its broker user may only XADD to its own stream). */
export interface BusPublisher {
  xadd(stream: string, id: '*', field: string, value: string): Promise<unknown>;
}

/** The portal's `notification.requested` event (auth_gateway: notifications/bus/notification-event.ts). */
export function portalEvent(event: NotificationEvent, portalUserId: string, tenantId: string, publicUrl: string) {
  return {
    specversion: 1 as const,
    id: randomUUID(),
    type: 'notification.requested' as const,
    occurredAt: event.occurredAt,
    tenantId,
    data: {
      title: event.text.slice(0, 200),
      kind: event.category === 'REMINDER' ? 'warning' : 'info',
      link: `${publicUrl}/ticket/${encodeURIComponent(event.ticketKey)}`,
      // The portal ignores a repeat with the same sourceRef (max 128 characters).
      sourceRef: event.dedupeKey.length <= 128 ? event.dedupeKey : createHash('sha256').update(event.dedupeKey).digest('hex'),
      // Confidential: the text is already masked; the portal also hides it at rest.
      sensitive: event.confidential,
      channels: ['in_app'],
      audience: { userIds: [portalUserId] },
    },
  };
}

/**
 * AUTH_MODE=portal: everything the local gateway does (helpdesk in-app list, email outbox), and the
 * same notification in the portal's bell. People who never opened the Helpdesk from the portal have no
 * portal id yet and get the local notification only. A bus problem never fails a ticket action.
 */
@Injectable()
export class PortalBusNotificationGateway implements NotificationGateway, OnApplicationShutdown {
  private readonly log = new Logger('PortalBus');
  private bus: (BusPublisher & { quit?: () => Promise<unknown> }) | null = null;

  constructor(private readonly local: LocalNotificationGateway, @InjectDataSource() private readonly ds: DataSource) {
    if (env.authMode !== 'portal') return;
    if (env.portal.busUrl) {
      const redis = new Redis(env.portal.busUrl, { connectionName: 'helpdesk-publisher', maxRetriesPerRequest: 3, lazyConnect: true });
      redis.on('error', (e) => this.log.warn(`Notification bus: ${e.message}`));
      this.bus = redis;
    } else {
      this.log.warn('NOTIFICATION_BUS_URL is not set: helpdesk notifications stay in the Helpdesk');
    }
  }

  /** For tests. */
  useBus(bus: BusPublisher | null) {
    this.bus = bus;
  }

  async publish(event: NotificationEvent): Promise<void> {
    await this.local.publish(event);
    if (!this.bus) return;
    try {
      const recipient = await this.ds.getRepository(UserEntity).findOne({ where: { id: event.recipientUserId } });
      if (!recipient?.portalUserId || recipient.isQueue) return;
      const tenantId = env.portal.tenantId;
      if (!tenantId) return; // the portal needs the tenant of the audience
      const message = portalEvent(event, recipient.portalUserId, tenantId, env.portal.publicUrl);
      await this.bus.xadd(env.portal.busStream, '*', 'event', JSON.stringify(message));
    } catch (e) {
      this.log.warn(`Could not send ${event.eventType} for ${event.ticketKey} to the portal: ${e instanceof Error ? e.message : 'error'}`);
    }
  }

  async onApplicationShutdown() {
    await this.bus?.quit?.().catch(() => undefined);
  }
}
