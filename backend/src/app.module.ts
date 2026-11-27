import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { AiController } from './ai/ai.controller';
import { AiService } from './ai/ai.service';
import { AnalyticsController } from './analytics/analytics.controller';
import { AnalyticsService } from './analytics/analytics.service';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthModule } from './auth/auth.module';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { dataSourceOptions } from './database/data-source';
import { AuditEntity, ENTITIES } from './database/entities';
import { DemoController } from './demo/demo.controller';
import { FaqController } from './faq/faq.controller';
import { FaqService } from './faq/faq.service';
import { HealthController } from './health.controller';
import { ConfigController } from './helpdesk-config/config.controller';
import { HelpdeskConfigService } from './helpdesk-config/config.service';
import { MeController } from './me/me.controller';
import { TicketEventEmitter } from './notifications/event-emitter.service';
import { LocalNotificationGateway, NOTIFICATION_GATEWAY } from './notifications/gateway';
import { PortalBusNotificationGateway } from './notifications/portal-bus.gateway';
import { PortalClient } from './auth/portal/portal.client';
import { PortalSsoController } from './auth/portal/portal-sso.controller';
import { PortalSsoService } from './auth/portal/portal-sso.service';
import { env } from './common/env';
import { NotificationsService } from './notifications/notifications.service';
import { PerformanceController } from './performance/performance.controller';
import { PerformanceService } from './performance/performance.service';
import { ProvidersRegistry } from './providers/providers.registry';
import { SlaScheduler } from './sla/sla.scheduler';
import { CoverService } from './tickets/cover.service';
import { TicketActionsService } from './tickets/ticket-actions.service';
import { TicketCreateService } from './tickets/ticket-create.service';
import { TicketLoader } from './tickets/ticket-loader.service';
import { TicketQueryService } from './tickets/ticket-query.service';
import { TicketsController, TicketViewsController } from './tickets/tickets.controller';

@Module({
  imports: [TypeOrmModule.forRoot({ ...dataSourceOptions, migrationsRun: false }), TypeOrmModule.forFeature([...ENTITIES, AuditEntity]), AuthModule],
  controllers: [
    HealthController, AuthController, ConfigController, MeController, TicketsController, TicketViewsController, AnalyticsController, FaqController,
    AdminController, AiController, DemoController, PerformanceController, PortalSsoController,
  ],
  providers: [
    AuditService, HelpdeskConfigService, NotificationsService, ProvidersRegistry, TicketLoader, TicketQueryService, TicketCreateService,
    TicketActionsService, AnalyticsService, FaqService, AdminService, SlaScheduler, AiService, CoverService, PerformanceService,
    LocalNotificationGateway, PortalBusNotificationGateway, TicketEventEmitter, PortalClient, PortalSsoService,
    // Portal mode also sends each notification to the portal's bell (notification bus).
    { provide: NOTIFICATION_GATEWAY, useExisting: env.authMode === 'portal' ? PortalBusNotificationGateway : LocalNotificationGateway },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
