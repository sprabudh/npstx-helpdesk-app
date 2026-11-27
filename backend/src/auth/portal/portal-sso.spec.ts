import { JwtService } from '@nestjs/jwt';
import { env } from '../../common/env';
import { AuthService } from '../auth.service';
import { cookieValue, portalSessionId, sessionHash } from './portal-session';
import { PORTAL_DEFAULT_ROLE, PortalSsoService } from './portal-sso.service';

const PORTAL_ID = '11111111-1111-1111-1111-111111111103';
const TENANT = 'a0000000-0000-0000-0000-000000000001';

/** Minimal stand-ins for the database, the portal and the config cache. */
function setup(opts: { users?: any[]; session?: any; person?: any; introspectError?: Error } = {}) {
  const users: any[] = opts.users ?? [];
  const roles: any[] = [];
  const userRepo = {
    findOne: async ({ where }: any) => users.find((u) => Object.entries(where).every(([k, v]) => u[k] === v)) ?? null,
    update: async ({ id }: any, patch: any) => Object.assign(users.find((u) => u.id === id), patch),
    insert: async (row: any) => {
      if (users.some((u) => u.id === row.id || (row.portalUserId && u.portalUserId === row.portalUserId))) throw Object.assign(new Error('Duplicate'), { code: 'ER_DUP_ENTRY' });
      users.push({ ...row });
    },
  };
  const roleRepo = { insert: async (row: any) => roles.push(row) };
  const repo = (e: any) => (e.name === 'UserEntity' ? userRepo : roleRepo);
  const ds: any = { getRepository: repo, transaction: async (fn: any) => fn({ getRepository: repo }) };
  const jwt = new JwtService({ secret: 'test-secret' });
  const auth = new AuthService(ds, jwt);
  jest.spyOn(auth, 'loadPrincipal').mockImplementation(async (id: string) => {
    const u = users.find((x) => x.id === id);
    return u && u.active ? ({ id, roles: new Set() } as any) : null;
  });
  jest.spyOn(auth, 'userIdByEmail').mockImplementation(async (email: string) => users.find((u) => u.email === email.toLowerCase() && !u.isQueue)?.id ?? null);
  const portal: any = {
    introspect: jest.fn(async () => {
      if (opts.introspectError) throw opts.introspectError;
      return opts.session === undefined ? { userId: PORTAL_ID, tenantId: TENANT } : opts.session;
    }),
    user: jest.fn(async () => opts.person ?? { id: PORTAL_ID, name: 'Employee User', email: 'Employee@acme.local' }),
  };
  const cfg: any = { reload: jest.fn(async () => undefined) };
  const audit: any = { record: jest.fn(async () => undefined) };
  return { sso: new PortalSsoService(ds, portal, auth, cfg, audit), users, roles, auth, jwt, cfg };
}

describe('portal bridge', () => {
  const saved = { ...env.portal };
  beforeEach(() => Object.assign(env.portal, { tenantId: TENANT }));
  afterAll(() => Object.assign(env.portal, saved));

  it('creates a requester on the first visit and binds the token to the session', async () => {
    const { sso, users, roles, jwt, cfg } = setup();
    const { accessToken } = await sso.signIn('sess-1');
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: 'employee@acme.local', portalUserId: PORTAL_ID, active: true });
    expect(users[0].id).toHaveLength(32);
    expect(roles).toEqual([{ userId: users[0].id, role: PORTAL_DEFAULT_ROLE }]);
    expect(cfg.reload).toHaveBeenCalled();
    expect(jwt.verify(accessToken)).toMatchObject({ sub: users[0].id, psh: sessionHash('sess-1') });
  });

  it('links an existing helpdesk person by email', async () => {
    const { sso, users } = setup({ users: [{ id: 'u1', email: 'employee@acme.local', active: true, isQueue: false, portalUserId: null }] });
    await sso.signIn('sess-1');
    expect(users).toHaveLength(1);
    expect(users[0].portalUserId).toBe(PORTAL_ID);
  });

  it('uses the linked person even when the email changed', async () => {
    const { sso, users, jwt } = setup({ users: [{ id: 'u6', email: 'old@acme.local', active: true, isQueue: false, portalUserId: PORTAL_ID }] });
    const { accessToken } = await sso.signIn('sess-1');
    expect(users).toHaveLength(1);
    expect(jwt.verify(accessToken).sub).toBe('u6');
  });

  it('refuses without a session, with an ended session, another tenant, or an inactive person', async () => {
    await expect(setup().sso.signIn(null)).rejects.toMatchObject({ status: 401 });
    await expect(setup({ session: null }).sso.signIn('x')).rejects.toMatchObject({ status: 401 });
    await expect(setup({ session: { userId: PORTAL_ID, tenantId: 'other' } }).sso.signIn('x')).rejects.toMatchObject({ status: 403 });
    const inactive = setup({ users: [{ id: 'u1', email: 'e@x', active: false, isQueue: false, portalUserId: PORTAL_ID }] });
    await expect(inactive.sso.signIn('x')).rejects.toMatchObject({ status: 403 });
  });

  it('passes on a portal outage instead of signing anyone in', async () => {
    const outage = Object.assign(new Error('down'), { status: 503 });
    await expect(setup({ introspectError: outage }).sso.signIn('x')).rejects.toBe(outage);
  });
});

describe('portal session cookie', () => {
  it('reads one cookie from the header', () => {
    expect(cookieValue('a=1; session_id=abc%3D; b=2', 'session_id')).toBe('abc=');
    expect(cookieValue('session_idx=1', 'session_id')).toBeNull();
    expect(cookieValue(undefined, 'session_id')).toBeNull();
    expect(portalSessionId({ headers: { cookie: 'session_id=s1' } })).toBe('s1');
  });
});
