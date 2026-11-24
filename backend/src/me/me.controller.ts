import { Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { clock, istDate } from '../common/clock';
import { env } from '../common/env';
import { CurrentUser } from '../common/decorators';
import { AbsenceEntity } from '../database/entities';
import { allowedHds, has, isApprover, isHeadish, isWorker, permList, viewsFor, workHds } from '../domain/policy';
import { HD_ORDER, type Principal } from '../domain/types';
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
    const { assignedHds, ...counts } = await this.q.summary(u);
    const leadHds = [...new Set(this.cfg.categories().filter((c) => c.leadId === u.id || c.ownerId === u.id).map((c) => c.helpdesk))];
    const roleByHd: Record<string, ('HR_AGENT' | 'LND_COORD' | 'LND_HEAD' | 'IT_AGENT' | 'IT_HEAD' | 'ADM_AGENT' | 'ADM_HEAD' | 'SF_ADMIN')[]> = {
      HR: ['HR_AGENT'], LND: ['LND_COORD', 'LND_HEAD'], IT: ['IT_AGENT', 'IT_HEAD'],
      ADM: ['ADM_AGENT', 'ADM_HEAD'], SF: ['SF_ADMIN'],
    };
    const roleCategories = Object.fromEntries(HD_ORDER.filter((hd) => roleByHd[hd]?.some((r) => has(u, r)))
      .map((hd) => [hd, this.cfg.categories(hd).filter((c) => c.active && u.hrCats.has(c.key)).map((c) => c.key)]));
    return {
      id: u.id, name: u.name, dept: u.dept, title: u.title, location: u.location, managerId: u.managerId, managerName: u.managerId ? this.cfg.name(u.managerId) : null,
      roles: [...u.roles], hrCategories: [...u.hrCats], roleCategories, helpdesks: allowedHds(u), workHelpdesks: workHds(u, [...assignedHds, ...leadHds]),
      flags: { worker: isWorker(u), headish: isHeadish(u), approver: isApprover(u), helpdeskAdmin: has(u, 'HD_ADMIN'), auditor: has(u, 'AUDITOR') },
      views: viewsFor(u), permissions: permList(u, hrNames), counts,
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
