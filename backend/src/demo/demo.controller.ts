import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { clock, istDate } from '../common/clock';
import { env } from '../common/env';
import { CurrentUser } from '../common/decorators';
import { AppError } from '../common/errors';
import { AbsenceEntity } from '../database/entities';
import { hdAllowed } from '../domain/policy';
import type { Principal } from '../domain/types';
import { CoverService } from '../tickets/cover.service';
import { AuditService } from '../audit/audit.service';
import { HelpdeskConfigService } from '../helpdesk-config/config.service';
import { SeedService } from '../seed/seed.service';

@ApiTags('demo')
@ApiBearerAuth()
@Controller('demo')
export class DemoController {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly cfg: HelpdeskConfigService,
    private readonly audit: AuditService,
    private readonly cover: CoverService,
  ) {}

  private demoOnly() {
    if (!env.demoMode) throw new AppError(403, 'DEMO_DISABLED', 'This control is only available in demo mode.');
  }

  /**
   * Out of office (demo): every assignee, category lead and escalation-ladder person, by helpdesk,
   * with today's availability. Simulates what the Attendance and Leave modules would supply.
   */
  @Get('absences') @ApiOperation({ summary: 'People who can receive tickets, with on-leave status (DEMO_MODE only)' })
  async absences(@CurrentUser() u: Principal) {
    this.demoOnly();
    const now = clock.now();
    const away = await this.cover.awayFn(now);
    const tomorrow = await this.cover.awayFn(new Date(now.getTime() + 86400000));
    const agents = this.cfg.setting<Record<string, string[]>>('agents');
    const esc = this.cfg.setting<Record<string, { who: string }[]>>('escalation');
    const hds = this.cfg.setting<{ key: string; label: string }[]>('helpdesks').filter((h) => hdAllowed(u, h.key));
    return {
      note: 'Simulates the Attendance and Leave modules. Changes last until Reset.',
      groups: hds.map((h) => {
        const ids = new Set<string>([
          ...(agents[h.key] ?? []),
          ...this.cfg.categories(h.key).flatMap((c) => [c.leadId, c.ownerId]),
          ...(esc[h.key] ?? []).map((l) => l.who),
          ...(h.key === 'SF' ? this.cfg.queueMembers(this.cfg.ladder('SF', '')[0]?.who ?? '') : []),
        ].filter((x): x is string => !!x && x !== 'lead'));
        const people = [...ids].map((id) => this.cfg.person(id)).filter((p): p is NonNullable<typeof p> => !!p && !p.isQueue);
        return { hd: h.key, label: h.label, people: people.map((p) => ({ id: p.id, name: p.name, title: p.title, onLeaveToday: away(p.id), onLeaveTomorrow: tomorrow(p.id) })) };
      }),
    };
  }

  @Put('absences/:userId') @HttpCode(200) @ApiOperation({ summary: 'Set or clear "on leave today" for a person (DEMO_MODE only)' })
  async setAbsence(@CurrentUser() u: Principal, @Param('userId') userId: string, @Body() b: { on?: boolean }) {
    this.demoOnly();
    const p = this.cfg.person(userId);
    if (!p || p.isQueue) throw new AppError(404, 'NOT_FOUND', 'No such person.');
    const on = b?.on !== false;
    await this.markToday(userId, on);
    await this.audit.record(u.id, 'demo.ooo', `${u.name} ${on ? 'set' : 'cleared'} "on leave today" for ${p.name} (demo)`, { target: userId });
    return { on, toast: on ? `${p.name} is on leave today. Tickets that become workable now go to the next available person.` : `${p.name} is available again.` };
  }

  private async markToday(userId: string, on: boolean) {
    const repo = this.ds.getRepository(AbsenceEntity);
    const today = istDate(clock.now());
    await repo.delete({ userId, fromDate: today });
    if (on) await repo.save(repo.create({ userId, fromDate: today, toDate: today, type: 'Leave', status: 'Approved' }));
  }

  /** "Reset demo data": restores the artifact's sample data. Only when DEMO_MODE=true. */
  @Post('reset') @HttpCode(200) @ApiOperation({ summary: 'Restore the sample data (DEMO_MODE only)' })
  async reset(@CurrentUser() u: Principal) {
    if (!env.demoMode) throw new AppError(403, 'DEMO_DISABLED', 'Reset is only available in demo mode.');
    const res = await new SeedService(this.ds).run({ preserveAudit: true });
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
    this.demoOnly();
    const on = b?.on !== false;
    await this.markToday(u.id, on);
    await this.audit.record(u.id, 'demo.ooo', `${u.name} ${on ? 'set' : 'cleared'} out of office (demo)`);
    return { on, toast: on ? `${u.name} is out of office today. New tickets route to the next available person.` : `${u.name} is available again.` };
  }
}
