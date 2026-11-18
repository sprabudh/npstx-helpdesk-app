import { Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { clock, istDate } from '../common/clock';
import { env } from '../common/env';
import { CurrentUser } from '../common/decorators';
import { AbsenceEntity } from '../database/entities';
import { allowedHds, has, isApprover, isHeadish, isWorker, permList, viewsFor } from '../domain/policy';
import type { Principal } from '../domain/types';
import { HelpdeskConfigService } from '../helpdesk-config/config.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TicketQueryService } from '../tickets/ticket-query.service';

@ApiTags('me')
@ApiBearerAuth()
@Controller()
export class MeController {
  constructor(private readonly q: TicketQueryService, private readonly cfg: HelpdeskConfigService, private readonly notes: NotificationsService, @InjectDataSource() private readonly ds: DataSource) {}

  @Get('me') @ApiOperation({ summary: 'Signed-in person, roles, helpdesks, views, permission list and shell counts' })
  async me(@CurrentUser() u: Principal) {
    const hrNames = Object.fromEntries(this.cfg.categories('HR').map((c) => [c.key, c.name]));
    const today = istDate(clock.now());
    const away = await this.ds.getRepository(AbsenceEntity).findOne({ where: { userId: u.id, fromDate: today, status: 'Approved' } });
    return {
      id: u.id, name: u.name, dept: u.dept, title: u.title, location: u.location, managerId: u.managerId, managerName: u.managerId ? this.cfg.name(u.managerId) : null,
      roles: [...u.roles], hrCategories: [...u.hrCats], helpdesks: allowedHds(u),
      flags: { worker: isWorker(u), headish: isHeadish(u), approver: isApprover(u), helpdeskAdmin: has(u, 'HD_ADMIN'), auditor: has(u, 'AUDITOR') },
      views: viewsFor(u), permissions: permList(u, hrNames), counts: await this.q.summary(u),
      now: clock.now(), demo: { enabled: env.demoMode, clockStart: null }, outOfOffice: !!away,
    };
  }

  @Get('notifications') list(@CurrentUser() u: Principal) {
    return this.notes.list(u.id);
  }
  @Post('notifications/read-all') @HttpCode(200) async readAll(@CurrentUser() u: Principal) {
    await this.notes.markAll(u.id);
    return { ok: true };
  }
  @Post('notifications/:id/read') @HttpCode(200) async read(@CurrentUser() u: Principal, @Param('id', ParseIntPipe) id: number) {
    await this.notes.markRead(u.id, id);
    return { ok: true };
  }
}
