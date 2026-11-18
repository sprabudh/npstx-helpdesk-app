import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { env } from '../common/env';
import { AppError } from '../common/errors';
import { Public } from '../common/decorators';
import { AuditService } from '../audit/audit.service';
import { HelpdeskConfigService } from '../helpdesk-config/config.service';
import { AuthService } from './auth.service';

export class DemoLoginDto {
  @IsString() @Length(1, 32) userId: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly cfg: HelpdeskConfigService, private readonly audit: AuditService) {}

  /** Personas offered by the demo "Demo role" switcher, grouped as in the artifact. */
  @Public()
  @Get('personas')
  personas() {
    if (env.authMode !== 'demo') throw new AppError(404, 'NOT_FOUND', 'Demo sign-in is turned off.');
    const groups = this.cfg.setting<[string, string[]][]>('personaGroups');
    return {
      defaultUserId: groups[0][1][0],
      groups: groups.map(([label, ids]) => ({ label, people: ids.map((id) => ({ id, name: this.cfg.name(id), title: this.cfg.person(id)?.title ?? '' })) })),
    };
  }

  /** Demo sign-in: pick a persona, get a short-lived JWT carrying only the user id. */
  @Public()
  @Post('demo-login')
  @HttpCode(200)
  @ApiOkResponse({ description: '{ accessToken, expiresIn }' })
  async demoLogin(@Body() dto: DemoLoginDto) {
    if (env.authMode !== 'demo') throw new AppError(403, 'DEMO_LOGIN_DISABLED', 'Demo sign-in is turned off. Use single sign-on.');
    const p = await this.auth.loadPrincipal(dto.userId);
    if (!p) throw new AppError(404, 'NOT_FOUND', 'No such person.');
    await this.audit.record(p.id, 'auth.demo_login', `${p.name} signed in (demo)`);
    return this.auth.issueToken(p.id);
  }
}
