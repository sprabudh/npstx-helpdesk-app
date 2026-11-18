import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { clock, istDate } from '../common/clock';
import { env } from '../common/env';
import { CurrentUser } from '../common/decorators';
import { AppError } from '../common/errors';
import { AbsenceEntity } from '../database/entities';
import type { Principal } from '../domain/types';
import { AuditService } from '../audit/audit.service';
import { HelpdeskConfigService } from '../helpdesk-config/config.service';
import { SeedService } from '../seed/seed.service';

@ApiTags('demo')
@ApiBearerAuth()
@Controller('demo')
export class DemoController {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly cfg: HelpdeskConfigService, private readonly audit: AuditService) {}

  /** "Reset demo data": restores the artifact's sample data. Only when DEMO_MODE=true. */
  @Post('reset') @HttpCode(200) @ApiOperation({ summary: 'Restore the sample data (DEMO_MODE only)' })
  async reset(@CurrentUser() u: Principal) {
    if (!env.demoMode) throw new AppError(403, 'DEMO_DISABLED', 'Reset is only available in demo mode.');
    const res = await new SeedService(this.ds).run();
    await this.cfg.reload();
    await this.audit.record(u.id, 'demo.reset', `${u.name} reset the demo data`);
    return { ...res, toast: 'Demo data reset to the sample tickets' };
  }

  /**
   * Fix 1 demo control: mark the signed-in person out of office for today, or clear it.
   * New tickets that would route to them step down the escalation ladder to the next available person.
   */
  @Post('out-of-office') @HttpCode(200) @ApiOperation({ summary: 'Toggle out of office for the signed-in person today (DEMO_MODE only)' })
  async outOfOffice(@CurrentUser() u: Principal, @Body() b: { on?: boolean }) {
    if (!env.demoMode) throw new AppError(403, 'DEMO_DISABLED', 'This control is only available in demo mode.');
    const repo = this.ds.getRepository(AbsenceEntity);
    const today = istDate(clock.now());
    await repo.delete({ userId: u.id, fromDate: today });
    const on = b?.on !== false;
    if (on) await repo.save(repo.create({ userId: u.id, fromDate: today, toDate: today, type: 'Leave', status: 'Approved' }));
    await this.audit.record(u.id, 'demo.ooo', `${u.name} ${on ? 'set' : 'cleared'} out of office (demo)`);
    return { on, toast: on ? `${u.name} is out of office today. New tickets route to the next available person.` : `${u.name} is available again.` };
  }
}
