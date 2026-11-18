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

  it('demo reset restores the sample data', async () => {
    await http().post('/api/demo/reset').set(as('u1')).expect(200);
    const d = await http().get('/api/tickets/LND-000048').set(as('u1')).expect(200);
    expect(d.body.status).toBe('Pending approval');
  });
});
