import { JwtService } from '@nestjs/jwt';
import { env } from '../../common/env';
import { AuthGuard } from '../auth.guard';
import { AuthService } from '../auth.service';
import { sessionHash } from './portal-session';

/** AUTH_MODE=portal: a token is accepted only with the portal session it was issued for. */
describe('AuthGuard in portal mode', () => {
  const saved = env.authMode;
  beforeAll(() => ((env as any).authMode = 'portal'));
  afterAll(() => ((env as any).authMode = saved));

  const jwt = new JwtService({ secret: 'test-secret' });
  const auth = new AuthService({} as any, jwt);
  jest.spyOn(auth, 'loadPrincipal').mockImplementation(async (id: string) => ({ id, roles: new Set() }) as any);
  const reflector: any = { getAllAndOverride: () => undefined };
  const guard = new AuthGuard(reflector, auth, { enabled: () => false } as any);
  const ctx = (token: string, cookie?: string) => {
    const req: any = { headers: { authorization: `Bearer ${token}`, ...(cookie ? { cookie } : {}) }, query: {} };
    return { req, ctx: { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => req }) } as any };
  };

  it('accepts a bridge token with its own session', async () => {
    const token = auth.issueToken('u1', { psh: sessionHash('s1') }).accessToken;
    const { req, ctx: c } = ctx(token, 'session_id=s1');
    await expect(guard.canActivate(c)).resolves.toBe(true);
    expect(req.principal.id).toBe('u1');
  });

  it('refuses it with another session, without a session, and tokens without a binding', async () => {
    const token = auth.issueToken('u1', { psh: sessionHash('s1') }).accessToken;
    await expect(guard.canActivate(ctx(token, 'session_id=s2').ctx)).rejects.toMatchObject({ status: 401 });
    await expect(guard.canActivate(ctx(token).ctx)).rejects.toMatchObject({ status: 401 });
    const demo = auth.issueToken('u1').accessToken;
    await expect(guard.canActivate(ctx(demo, 'session_id=s1').ctx)).rejects.toMatchObject({ status: 401 });
  });
});
