import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/http-exception.filter';
import { HelpdeskConfigService } from '../src/helpdesk-config/config.service';
import { SeedService } from '../src/seed/seed.service';

/**
 * API tests against a real MySQL database (the one in .env). The seed is reloaded before each block,
 * so run them on a development database only.
 */
describe('Helpdesk API (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const tokens: Record<string, string> = {};
  const as = (id: string) => ({ Authorization: `Bearer ${tokens[id]}` });
  const http = () => request(app.getHttpServer());
  const reseed = async () => {
    await new SeedService(ds).run();
    await app.get(HelpdeskConfigService).reload();
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    ds = app.get(DataSource);
    await reseed();
    for (const id of ['u1', 'u2', 'u3', 'u5', 'u6', 'u20', 'u21', 'u26']) {
      const r = await http().post('/api/auth/demo-login').send({ userId: id }).expect(200);
      tokens[id] = r.body.accessToken;
    }
  });
  afterAll(async () => {
    await reseed();
    await app.close();
  });

  it('health is public; everything else needs a token (deny by default)', async () => {
    await http().get('/api/health').expect(200);
    const r = await http().get('/api/tickets').expect(401);
    expect(r.body).toMatchObject({ statusCode: 401, code: expect.any(String), path: '/api/tickets' });
  });

  it('the token carries only the user id', () => {
    const payload = JSON.parse(Buffer.from(tokens.u3.split('.')[1], 'base64url').toString());
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub']);
  });

  it('roles are read from the database on every request, not from the token', async () => {
    // IT-000057 sits in the IT Service Desk queue: u21 sees it only through the IT_AGENT role.
    await http().get('/api/tickets/IT-000057').set(as('u21')).expect(200);
    await ds.query("DELETE FROM user_roles WHERE user_id='u21' AND role='IT_AGENT'");
    const r = await http().get('/api/tickets/IT-000057').set(as('u21')).expect(403);
    expect(r.body.code).toBe('TICKET_FORBIDDEN');
    await ds.query("INSERT INTO user_roles (user_id, role) VALUES ('u21','IT_AGENT')");
    await http().get('/api/tickets/IT-000057').set(as('u21')).expect(200);
  });

  describe('Salesforce is refused outside Sales, Presales and Solutions (403 + audit)', () => {
    it.each([
      ['GET', '/api/tickets/SF-00330'],
      ['GET', '/api/faqs?helpdesk=SF'],
      ['GET', '/api/tickets/people?hd=SF'],
    ])('%s %s', async (method, url) => {
      const before = (await ds.query("SELECT COUNT(*) n FROM audit_log WHERE actor_id='u1' AND outcome='denied'"))[0].n;
      const r = await http()[method.toLowerCase() as 'get'](url).set(as('u1')).expect(403);
      expect(r.body.code).toBe('SALESFORCE_FORBIDDEN');
      const after = (await ds.query("SELECT COUNT(*) n FROM audit_log WHERE actor_id='u1' AND outcome='denied'"))[0].n;
      expect(Number(after)).toBe(Number(before) + 1);
    });
    it('raising a Salesforce case', async () => {
      const r = await http().post('/api/tickets').set(as('u1')).field('payload', JSON.stringify({ helpdesk: 'SF', fields: { cat: 'DATA', sub: 'Merge duplicates', title: 'x', desc: 'y', pri: 'Medium' } })).expect(403);
      expect(r.body.code).toBe('SALESFORCE_FORBIDDEN');
    });
    it('a helpdesk admin outside Sales is refused too; Sales users get through', async () => {
      await http().get('/api/tickets/SF-00330').set(as('u20')).expect(403);
      await http().get('/api/tickets/SF-00330').set(as('u2')).expect(200);
      await http().get('/api/tickets/SF-00330').set(as('u5')).expect(200);
    });
    it('Salesforce never appears in lists for others', async () => {
      const r = await http().get('/api/tickets?view=all&hd=ALL').set(as('u20')).expect(200);
      expect(r.body.rows.some((t: { helpdesk: string }) => t.helpdesk === 'SF')).toBe(false);
      const c = await http().get('/api/config').set(as('u1')).expect(200);
      expect(c.body.helpdesks.map((h: { key: string }) => h.key)).not.toContain('SF');
    });
  });

  it('confidential tickets: 403 for an unrelated agent, read-only for the auditor is refused too', async () => {
    await http().get('/api/tickets/HR-000126').set(as('u21')).expect(403);
    await http().get('/api/tickets/HR-000126').set(as('u26')).expect(403);
  });

  it('auditor reads but cannot change', async () => {
    const r = await http().get('/api/tickets/IT-000041').set(as('u26')).expect(200);
    expect(r.body.me).toMatchObject({ readOnly: true, canWork: false });
    await http().patch('/api/tickets/IT-000041/status').set(as('u26')).send({ status: 'Waiting for user' }).expect(403);
    await http().post('/api/tickets/IT-000041/comments').set(as('u26')).send({ body: 'hello' }).expect(403);
  });

  it('admin console is for helpdesk admins only', async () => {
    await http().get('/api/admin').set(as('u21')).expect(403);
    await http().get('/api/admin').set(as('u20')).expect(200);
  });

  it('API dates are UTC ISO-8601 strings with Z', async () => {
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    const d = await http().get('/api/tickets/IT-000041').set(as('u21')).expect(200);
    for (const k of ['createdAt', 'updatedAt']) expect(d.body[k]).toMatch(iso);
    const list = await http().get('/api/tickets?view=queues&size=100').set(as('u21')).expect(200);
    expect(list.body.rows[0].createdAt).toMatch(iso);
    const me = await http().get('/api/me').set(as('u21')).expect(200);
    expect(me.body.now).toMatch(iso);
  });

  it('following and CC are available to every employee and share one relation list', async () => {
    const me = await http().get('/api/me').set(as('u6')).expect(200);
    expect(me.body.views.map((v: [string, string]) => v[0])).toContain('following');
    expect(me.body.counts).toEqual(expect.objectContaining({ followingCount: expect.any(Number), ccCount: expect.any(Number) }));
    const list = await http().get('/api/tickets?view=following&size=100').set(as('u6')).expect(200);
    expect(list.body.rows.some((t: { key: string }) => t.key === 'HR-000127')).toBe(true);
    const following = await http().get('/api/following?rel=CC&grp=open').set(as('u6')).expect(200);
    expect(following.body.counts.ALL).toBe(following.body.counts.FOLLOWER + following.body.counts.CC);
    expect(following.body.rows.some((t: { key: string; relation: { relation: string } }) => t.key === 'HR-000127' && t.relation.relation === 'CC')).toBe(true);
  });

  it('a Helpdesk admin can govern Salesforce without ticket access', async () => {
    const admin = await http().get('/api/admin').set(as('u20')).expect(200);
    expect(admin.body.helpdesks).toContain('SF');
    expect(admin.body.categories.some((c: { helpdesk: string }) => c.helpdesk === 'SF')).toBe(true);
    expect(admin.body.priorities.SF).toBeDefined();
    expect(admin.body.coreFields.SF).toBeDefined();
    expect(admin.body.assignableRoles).toContain('SF_ADMIN');
    const sf = await http().put('/api/admin/sf-escalation').set(as('u20')).send({ who: 'q_sf_sr' }).expect(200);
    expect(sf.body.toast).toBeNull();
    await http().put('/api/admin/people/u27/roles').set(as('u20')).send({ roles: ['SF_ADMIN'], hrCategories: [] }).expect(200);
    const after = await http().get('/api/admin').set(as('u20')).expect(200);
    expect(after.body.sfEscalation.who).toBe('q_sf_sr');
    const roles = await ds.query("SELECT role FROM user_roles WHERE user_id='u27' ORDER BY role");
    expect(roles.map((r: { role: string }) => r.role)).toEqual(['EMP', 'SF_ADMIN']);
    await http().get('/api/tickets/SF-00330').set(as('u20')).expect(403);
  });

  it('admin toggles and role mapping stay consistent after each save', async () => {
    const overview = async () => (await http().get('/api/admin').set(as('u20')).expect(200)).body;
    const clientConfig = async () => (await http().get('/api/config').set(as('u20')).expect(200)).body;
    const before = await overview();
    const cat = before.categories.find((c: { helpdesk: string; key: string }) => c.helpdesk === 'HR' && c.key === 'PAY');
    const custom = before.fields.find((f: { helpdesk: string; custom: boolean; active: boolean }) => f.helpdesk === 'HR' && f.custom && f.active);
    const u3 = before.people.find((p: { id: string }) => p.id === 'u3');
    expect(cat).toBeDefined();
    expect(custom).toBeDefined();
    await http().patch(`/api/admin/categories/${cat.id}/active`).set(as('u20')).send({ active: false }).expect(200);
    let admin = await overview();
    let config = await clientConfig();
    expect(admin.categories.find((c: { id: number }) => c.id === cat.id).active).toBe(false);
    expect(config.categories.find((c: { key: string }) => c.key === cat.key).active).toBe(false);
    await http().patch(`/api/admin/categories/${cat.id}/active`).set(as('u20')).send({ active: true }).expect(200);
    await http().patch(`/api/admin/categories/${cat.id}/mgr-approval`).set(as('u20')).send({ on: true }).expect(200);
    admin = await overview();
    config = await clientConfig();
    expect(admin.categories.find((c: { id: number }) => c.id === cat.id).mgrApproval).toBe(true);
    expect(config.categories.find((c: { key: string }) => c.key === cat.key).mgrApproval).toBe(true);
    await http().patch(`/api/admin/categories/${cat.id}/mgr-approval`).set(as('u20')).send({ on: false }).expect(200);
    await http().patch(`/api/admin/fields/${custom.id}`).set(as('u20')).send({ required: false, active: false }).expect(200);
    admin = await overview();
    config = await clientConfig();
    expect(admin.fields.find((f: { id: number }) => f.id === custom.id)).toMatchObject({ required: false, active: false });
    expect(config.formFields.some((f: { id: number }) => f.id === custom.id)).toBe(false);
    await http().patch(`/api/admin/fields/${custom.id}`).set(as('u20')).send({ required: true, active: true }).expect(200);
    await http().put('/api/admin/people/u3/roles').set(as('u20')).send({ roles: ['HR_AGENT'], hrCategories: ['PAY'] }).expect(200);
    admin = await overview();
    expect(admin.people.find((p: { id: string }) => p.id === 'u3').hrCategories).toEqual(['PAY']);
    await http().put('/api/admin/people/u3/roles').set(as('u20')).send({
      roles: before.assignableRoles.filter((r: string) => u3.roles.includes(r)), hrCategories: u3.hrCategories,
    }).expect(200);
  });

  it('raises an IT ticket with a file, validates fields and rejects bad files', async () => {
    const bad = await http().post('/api/tickets').set(as('u1')).field('payload', JSON.stringify({ helpdesk: 'IT', fields: { cat: 'HW' } })).expect(400);
    expect(bad.body.details.fieldErrors).toMatchObject({ sub: 'Choose a sub-category.', title: 'Add a short title.', desc: 'Describe the issue.' });
    const exe = await http().post('/api/tickets').set(as('u1'))
      .field('payload', JSON.stringify({ helpdesk: 'IT', fields: { cat: 'HW', sub: 'Laptop or desktop issue', title: 'Fan noise', desc: 'Loud fan', pri: 'Low', deviceType: 'Laptop', assetTag: 'NPX-LT-1234', impact: 'Only me', location: 'Mumbai HQ' } }))
      .attach('files', Buffer.from('MZ'), 'tool.exe');
    expect(exe.status).toBe(400);
    const ok = await http().post('/api/tickets').set(as('u1'))
      .field('payload', JSON.stringify({ helpdesk: 'IT', fields: { cat: 'HW', sub: 'Laptop or desktop issue', title: 'Fan noise', desc: 'Loud fan', pri: 'Low', deviceType: 'Laptop', assetTag: 'NPX-LT-1234', impact: 'Only me', location: 'Mumbai HQ' } }))
      .attach('files', Buffer.from('log line'), 'fan.txt')
      .expect(201);
    expect(ok.body.key).toMatch(/^IT-\d{6}$/);
    const d = await http().get(`/api/tickets/${ok.body.key}`).set(as('u1')).expect(200);
    expect(d.body.files[0].name).toBe('fan.txt');
    await http().get(`/api/attachments/${d.body.files[0].id}/download`).set(as('u1')).expect(200);
    await http().get(`/api/attachments/${d.body.files[0].id}/download`).set(as('u2')).expect(403);
  });

  it('status workflow: waiting pauses the SLA, the requester reply resumes it', async () => {
    await http().patch('/api/tickets/IT-000041/status').set(as('u21')).send({ status: 'Waiting for user' }).expect(200);
    let d = await http().get('/api/tickets/IT-000041').set(as('u21')).expect(200);
    expect(d.body.paused).toBe(true);
    await http().post('/api/tickets/IT-000041/comments').set(as('u21')).send({ body: 'Need a screenshot', internal: false }).expect(201);
    // u12 is the requester; sign in as them
    const t12 = (await http().post('/api/auth/demo-login').send({ userId: 'u12' })).body.accessToken;
    await http().post('/api/tickets/IT-000041/comments').set({ Authorization: `Bearer ${t12}` }).send({ body: 'Here it is' }).expect(201);
    d = await http().get('/api/tickets/IT-000041').set(as('u21')).expect(200);
    expect(d.body.paused).toBe(false);
    expect(d.body.status).toBe('In Progress');
  });

  it('invalid transitions and approvals by the wrong person are refused', async () => {
    const r = await http().patch('/api/tickets/IT-000041/status').set(as('u21')).send({ status: 'Pending approval' }).expect(400);
    expect(r.body.code).toBe('INVALID_TRANSITION');
    await http().post('/api/tickets/LND-000048/approval').set(as('u3')).send({ decision: 'Approved' }).expect(403);
    await http().post('/api/tickets/LND-000048/approval').set(as('u6')).send({ decision: 'Approved' }).expect(200);
  });

  it('FAQ feedback is upserted and returned to the same person after a reload', async () => {
    const [faq] = await ds.query("SELECT id FROM faqs WHERE helpdesk='HR' ORDER BY sort_order LIMIT 1");
    expect(faq).toBeDefined();
    await http().post(`/api/faqs/${faq.id}/vote`).set(as('u1')).send({ helpful: true }).expect(200);
    let list = await http().get('/api/faqs?helpdesk=HR').set(as('u1')).expect(200);
    expect(list.body.faqs.find((f: { id: number }) => f.id === faq.id).myVote).toBe(true);
    await http().post(`/api/faqs/${faq.id}/vote`).set(as('u1')).send({ helpful: false }).expect(200);
    list = await http().get('/api/faqs?helpdesk=HR').set(as('u1')).expect(200);
    expect(list.body.faqs.find((f: { id: number }) => f.id === faq.id).myVote).toBe(false);
    const [{ n }] = await ds.query('SELECT COUNT(*) n FROM faq_votes WHERE faq_id=? AND user_id=?', [faq.id, 'u1']);
    expect(Number(n)).toBe(1);
    const other = await http().get('/api/faqs?helpdesk=HR').set(as('u3')).expect(200);
    expect(other.body.faqs.find((f: { id: number }) => f.id === faq.id).myVote).toBe(null);
  });

  it('manual SLA runs breach the first response, escalate by ladder and stay idempotent', async () => {
    const hour = 3600000;
    const now = Date.now();
    await ds.query('DELETE FROM ticket_events WHERE ticket_key=?', ['IT-000041']);
    await ds.query('DELETE FROM ticket_comments WHERE ticket_key=?', ['IT-000041']);
    await ds.query(
      `UPDATE tickets SET status='In Progress', paused=0, sla_started=1, assignee_id='u21', escalation_level=0,
       ladder_base=0, asg_hist=NULL, esc_log=NULL, response_met=NULL, response_due=?, sla_start=?, resolution_due=?
       WHERE ticket_key='IT-000041'`,
      [new Date(now - hour), new Date(now - 31 * hour), new Date(now + 30 * hour)],
    );
    const first = await http().post('/api/admin/sla/run').set(as('u20')).expect(200);
    expect(first.body.responseBreaches).toBeGreaterThan(0);
    expect(first.body.escalated).toBeGreaterThan(0);
    let [row] = await ds.query("SELECT assignee_id, escalation_level, response_met, JSON_LENGTH(esc_log) escCount FROM tickets WHERE ticket_key='IT-000041'");
    expect(Number(row.response_met)).toBe(0);
    expect(Number(row.escalation_level)).toBeGreaterThanOrEqual(1);
    expect(Number(row.escCount)).toBeGreaterThanOrEqual(1);
    const escalations = async () => Number((await ds.query("SELECT COUNT(*) n FROM ticket_events WHERE ticket_key='IT-000041' AND text LIKE 'Escalated to Level%'"))[0].n);
    const breaches = async () => Number((await ds.query("SELECT COUNT(*) n FROM ticket_events WHERE ticket_key='IT-000041' AND text LIKE 'Response SLA breached%'"))[0].n);
    const [esc1, br1, assignee, level] = [await escalations(), await breaches(), row.assignee_id, row.escalation_level];
    expect(esc1).toBeGreaterThan(0);
    expect(br1).toBe(1);
    await http().post('/api/admin/sla/run').set(as('u20')).expect(200);
    [row] = await ds.query("SELECT assignee_id, escalation_level, response_met FROM tickets WHERE ticket_key='IT-000041'");
    expect(row.assignee_id).toBe(assignee);
    expect(row.escalation_level).toBe(level);
    expect(await escalations()).toBe(esc1);
    expect(await breaches()).toBe(br1);
  });

  it('Salesforce admin governs SF categories, ladders and validated custom fields', async () => {
    const overview = (await http().get('/api/admin').set(as('u20')).expect(200)).body;
    expect(overview.escalation.SF.map((l: { pct: number }) => l.pct)).toEqual([50, 75, 100]);
    const cat = overview.categories.find((c: { helpdesk: string; key: string }) => c.helpdesk === 'SF' && c.key === 'ACCESS');
    const refused = await http().patch(`/api/admin/categories/${cat.id}/lead`).set(as('u20')).send({ userId: 'u21' }).expect(400);
    expect(refused.body.code).toBe('VALIDATION');
    await http().patch(`/api/admin/categories/${cat.id}/lead`).set(as('u20')).send({ userId: 'u5' }).expect(200);
    await http().post('/api/admin/fields').set(as('u20')).send({
      helpdesk: 'SF', categoryKey: 'ACCESS', label: 'SF Test Code', type: 'text', required: true,
      hint: 'Start with ABC', pattern: '^ABC', patternMessage: 'Use a code starting with ABC.',
    }).expect(201);
    const fields = (await http().get('/api/admin').set(as('u20')).expect(200)).body.fields;
    const field = fields.find((f: { label: string }) => f.label === 'SF Test Code');
    expect(field).toMatchObject({ helpdesk: 'SF', categoryKey: 'ACCESS', hint: 'Start with ABC', pattern: '^ABC' });
    const payload = (code: string) => JSON.stringify({
      helpdesk: 'SF', fields: { cat: 'ACCESS', sub: 'New Salesforce user', title: 'Access request', desc: 'Need access', pri: 'Medium', [field.key]: code },
    });
    const bad = await http().post('/api/tickets').set(as('u2')).field('payload', payload('XYZ')).expect(400);
    expect(bad.body.details.fieldErrors[field.key]).toBe('Use a code starting with ABC.');
    await http().post('/api/tickets').set(as('u2')).field('payload', payload('ABC123')).expect(201);
  });

  it('role categories are saved per helpdesk and returned on /me', async () => {
    await http().put('/api/admin/people/u27/roles').set(as('u20')).send({
      roles: ['SF_ADMIN', 'IT_AGENT'], hrCategories: [], roleCategories: { SF: ['ACCESS'], IT: ['HW'] },
    }).expect(200);
    const login = await http().post('/api/auth/demo-login').send({ userId: 'u27' }).expect(200);
    const me = await http().get('/api/me').set({ Authorization: `Bearer ${login.body.accessToken}` }).expect(200);
    expect(me.body.roleCategories).toMatchObject({ IT: ['HW'], SF: ['ACCESS'] });
  });

  it('demo reset restores the sample data', async () => {
    await http().post('/api/demo/reset').set(as('u1')).expect(200);
    const d = await http().get('/api/tickets/LND-000048').set(as('u1')).expect(200);
    expect(d.body.status).toBe('Pending approval');
  });
});
