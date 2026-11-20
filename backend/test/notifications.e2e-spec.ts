import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/http-exception.filter';
import { HelpdeskConfigService } from '../src/helpdesk-config/config.service';
import { SeedService } from '../src/seed/seed.service';
import { OutboxEntity } from '../src/database/entities';

describe('notification catalogue (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const tokens: Record<string, string> = {};
  const as = (id: string) => ({ Authorization: `Bearer ${tokens[id]}` });
  const http = () => request(app.getHttpServer());
  const reseed = async () => {
    await new SeedService(ds).run();
    await app.get(HelpdeskConfigService).reload();
  };
  const raise = (who: string, helpdesk: string, fields: Record<string, string>) =>
    http().post('/api/tickets').set(as(who)).field('payload', JSON.stringify({ helpdesk, fields }));
  const notes = async (who: string) => (await http().get('/api/notifications').set(as(who)).expect(200)).body;
  const LEAVE = { cat: 'LEAVE', sub: 'Leave balance', title: 'Balance looks wrong', desc: 'Two days missing', location: 'Mumbai HQ' };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    ds = app.get(DataSource);
    await reseed();
    for (const id of ['u1', 'u2', 'u9', 'u20']) {
      tokens[id] = (await http().post('/api/auth/demo-login').send({ userId: id }).expect(200)).body.accessToken;
    }
  });
  afterAll(async () => {
    await reseed();
    await app.close();
  });

  beforeEach(reseed);

  it('emits a typed, deduplicated direct-creation notification to the assignee, never the actor', async () => {
    const r = await raise('u1', 'HR', LEAVE).expect(201);
    const key = r.body.key as string;
    const mine = (await notes('u9')).filter((n: { ticketId?: string }) => n.ticketId === key);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      eventType: 'TICKET_CREATED_DIRECT', category: 'NOTIFICATION', channel: 'in-app+email',
      recipientUserId: 'u9', actorUserId: 'u1',
      dedupeKey: `TICKET_CREATED_DIRECT:${key}:u9`,
    });
    expect(mine[0].text).toMatch(new RegExp(`^New ticket ${key} assigned to you`));
    expect(mine[0].payload).toMatchObject({ ticketKey: key, text: mine[0].text });
    expect((await notes('u1')).some((n: { ticketId?: string }) => n.ticketId === key)).toBe(false);
  });

  it('masks confidential text, payload and email body but never the ticket key', async () => {
    const r = await raise('u1', 'HR', { ...LEAVE, cat: 'PAY', sub: 'Payslip', title: 'Payslip salary is wrong', desc: 'My salary credit is short', payMonth: '2026-10' }).expect(201);
    const key = r.body.key as string;
    const n = (await notes('u9')).find((x: { ticketId?: string }) => x.ticketId === key);
    expect(n.text).toBe(`Update on ${key} (confidential)`);
    expect(n.payload).toEqual({ eventType: 'TICKET_CREATED_DIRECT', ticketKey: key });
    const outbox = await ds.getRepository(OutboxEntity).find({ where: { subject: `[NPSTX Helpdesk] ${key}` } });
    expect(outbox.length).toBeGreaterThan(0);
    for (const m of outbox) {
      expect(m.body).toBe(`Update on ${key} (confidential)\n\nOpen the ticket in NPSTX Helpdesk to see the details.\n/helpdesk/tickets/${key}`);
    }
  });

  it('sends internal notes to staff only, never to the requester', async () => {
    const r = await raise('u1', 'HR', LEAVE).expect(201);
    const key = r.body.key as string;
    await http().post(`/api/tickets/${key}/comments`).set(as('u20')).send({ body: 'Checked the ledger, will fix Monday', internal: true }).expect(201);
    const staff = (await notes('u9')).find((n: { eventType?: string; ticketId?: string }) => n.eventType === 'INTERNAL_NOTE_ADDED' && n.ticketId === key);
    expect(staff).toMatchObject({ channel: 'in-app+email', text: `Internal note on ${key}`, actorUserId: 'u20', recipientUserId: 'u9' });
    expect((await notes('u1')).some((n: { eventType?: string; ticketId?: string }) => n.eventType === 'INTERNAL_NOTE_ADDED' && n.ticketId === key)).toBe(false);
    const outbox = await ds.getRepository(OutboxEntity).find();
    expect(outbox.some((m) => m.body.includes(`Internal note on ${key}`) && m.recipient === 'anil.gupta@npstx.com')).toBe(true);
    expect(outbox.some((m) => m.body.includes(`Internal note on ${key}`) && m.recipient === 'arjun.kumar@npstx.com')).toBe(false);
  });

  it('sends public replies to the requester through both channels and does not self-notify', async () => {
    const r = await raise('u1', 'HR', LEAVE).expect(201);
    const key = r.body.key as string;
    await http().post(`/api/tickets/${key}/comments`).set(as('u9')).send({ body: 'We will restore the two days shortly', internal: false }).expect(201);
    const n = (await notes('u1')).find((x: { eventType?: string; ticketId?: string }) => x.eventType === 'PUBLIC_REPLY_ADDED' && x.ticketId === key);
    expect(n).toMatchObject({ channel: 'in-app+email', actorUserId: 'u9', recipientUserId: 'u1' });
    expect(n.text).toBe(`Anil Gupta replied on ${key}`);
    expect((await notes('u9')).some((x: { eventType?: string; ticketId?: string }) => x.eventType === 'PUBLIC_REPLY_ADDED' && x.ticketId === key)).toBe(false);
  });
});
