import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { env } from '../common/env';
import { AppError, forbidden } from '../common/errors';
import { IS_PUBLIC, ROLES_ANY } from '../common/decorators';
import { Role } from '../domain/types';
import { AuthService } from './auth.service';
import { OidcAdapter } from './oidc.adapter';
import { portalSessionId, sessionHash } from './portal/portal-session';

/** Global guard: deny by default. Every route needs a valid token unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService, private readonly oidc: OidcAdapter) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const handlers = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, handlers)) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query?.access_token as string) || '';
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    let userId: string | null;
    if (env.authMode === 'portal') {
      // Only bridge tokens, and only with the portal session they were issued for.
      const claims = this.auth.verifyClaims(token);
      const session = portalSessionId(req);
      userId = claims?.psh && session && claims.psh === sessionHash(session) ? claims.sub : null;
    } else {
      userId = this.auth.verify(token);
    }
    if (!userId && env.authMode === 'oidc' && this.oidc.enabled()) {
      const claim = await this.oidc.verify(token);
      userId = claim ? await this.auth.userIdByEmail(claim) : null;
    }
    if (!userId) throw new AppError(401, 'UNAUTHENTICATED', 'Your session has expired. Sign in again.');
    const principal = await this.auth.loadPrincipal(userId);
    if (!principal) throw new AppError(401, 'UNAUTHENTICATED', 'This account is not active.');
    req.principal = principal;
    const needed = this.reflector.getAllAndOverride<Role[]>(ROLES_ANY, handlers);
    if (needed?.length && !needed.some((r) => principal.roles.has(r))) throw forbidden('Your role cannot do this.');
    return true;
  }
}
