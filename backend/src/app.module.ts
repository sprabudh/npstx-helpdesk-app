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
import { NotificationsService } from './notifications/notifications.service';
import { ProvidersRegistry } from './providers/providers.registry';
import { SlaScheduler } from './sla/sla.scheduler';
import { TicketActionsService } from './tickets/ticket-actions.service';
import { TicketCreateService } from './tickets/ticket-create.service';
import { TicketLoader } from './tickets/ticket-loader.service';
import { TicketQueryService } from './tickets/ticket-query.service';
import { TicketsController, TicketViewsController } from './tickets/tickets.controller';

@Module({
  imports: [TypeOrmModule.forRoot({ ...dataSourceOptions, migrationsRun: false }), TypeOrmModule.forFeature([...ENTITIES, AuditEntity]), AuthModule],
  controllers: [
    HealthController, AuthController, ConfigController, MeController, TicketsController, TicketViewsController, AnalyticsController, FaqController,
    AdminController, AiController, DemoController,
  ],
  providers: [
    AuditService, HelpdeskConfigService, NotificationsService, ProvidersRegistry, TicketLoader, TicketQueryService, TicketCreateService,
    TicketActionsService, AnalyticsService, FaqService, AdminService, SlaScheduler, AiService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
