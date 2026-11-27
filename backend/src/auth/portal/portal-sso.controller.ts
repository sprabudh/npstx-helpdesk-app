import { Controller, Get, Header, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { env } from '../../common/env';
import { AppError } from '../../common/errors';
import { Public } from '../../common/decorators';
import { portalSessionId } from './portal-session';
import { PortalSsoService } from './portal-sso.service';

@ApiTags('auth')
@Controller('auth')
export class PortalSsoController {
  constructor(private readonly sso: PortalSsoService) {}

  /** Bridge: the portal session cookie → a helpdesk token bound to that session. AUTH_MODE=portal only. */
  @Public()
  @Get('platform-sso')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: '{ accessToken, expiresIn }' })
  async platformSso(@Req() req: { headers: Record<string, any> }) {
    if (env.authMode !== 'portal') throw new AppError(404, 'NOT_FOUND', 'Portal sign-in is turned off.');
    return this.sso.signIn(portalSessionId(req));
  }
}
