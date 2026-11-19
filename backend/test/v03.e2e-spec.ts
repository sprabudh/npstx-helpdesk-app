import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/http-exception.filter';
import { HelpdeskConfigService } from '../src/helpdesk-config/config.service';
import { SeedService } from '../src/seed/seed.service';

/**
 * v0.3 acceptance tests: absence cover, SLA versions, manager approval toggle, no priority in the
 * raise form, one source for dashboard metrics, and the assignee performance interval model.
 * Runs against the development database in .env and reseeds it.
 */
describe('v0.3 change request (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const tokens: Record<string, string> = {};
  const as = (id: string) => ({ Authorization: `Bearer ${tokens[id]}` });
  const http = () => request(app.getHttpServer());
  const reseed = async () => {
    await new SeedService(ds).run();
    await app.get(HelpdeskConfigService).reload();
  };
  const raise = (who: string, helpdesk: string, fields: Record<string, string>, extra: Record<string, unknown> = {}) =>
    http().post('/api/tickets').set(as(who)).field('payload', JSON.stringify({ helpdesk, fields, ...extra }));
  const detail = async (who: string, key: string) => (await http().get(`/api/tickets/${key}`).set(as(who)).expect(200)).body;
  const away = (id: string, on = true) => http().put(`/api/demo/absences/${id}`).set(as('u20')).send({ on }).expect(200);
  const LEAVE = { cat: 'LEAVE', sub: 'Leave balance', title: 'Balance looks wrong', desc: 'Two days missing', location: 'Mumbai HQ' };
  const SW = { cat: 'SW', sub: 'Install new software', title: 'Need Figma', desc: 'For design reviews', swName: 'Figma', justification: 'Design work' };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    ds = app.get(DataSource);
    await reseed();
    for (const id of ['u1', 'u2', 'u3', 'u5', 'u6', 'u8', 'u9', 'u13', 'u20', 'u21', 'u22', 'u23', 'u27', 'u26']) {
      tokens[id] = (await http().post('/api/auth/demo-login').send({ userId: id }).expect(200)).body.accessToken;
    }
  });
  afterAll(async () => {
    await reseed();
    await app.close();
  });

  describe('1 · demo roles and out of office', () => {
    it('groups personas by department, adds the Senior SFO case admin and marks people on leave', async () => {
      const r = await http().get('/api/auth/personas').expect(200);
      expect(r.body.groups.map((g: { label: string }) => g.label)).toEqual(['Employees', 'Managers', 'HR', 'L&D', 'IT and Support', 'Admin Desk', 'Sales Front Office', 'Governance']);
      const all = r.body.groups.flatMap((g: { people: { id: string; onLeave: boolean; title: string }[] }) => g.people);
      expect(all.map((p: { id: string }) => p.id)).toEqual(['u1', 'u12', 'u6', 'u7', 'u3', 'u10', 'u9', 'u13', 'u8', 'u4', 'u21', 'u22', 'u23', 'u24', 'u25', 'u2', 'u15', 'u16', 'u5', 'u27', 'u20', 'u26']);
      expect(all.find((p: { id: string }) => p.id === 'u27')).toMatchObject({ title: 'Senior SFO Case Admin' });
      expect(all.find((p: { id: string }) => p.id === 'u3').onLeave).toBe(true);
      expect(all.find((p: { id: string }) => p.id === 'u8').onLeave).toBe(false);
    });
    it('the Out of office panel lists assignees, leads and ladder people by helpdesk', async () => {
      const r = await http().get('/api/demo/absences').set(as('u20')).expect(200);
      const hr = r.body.groups.find((g: { hd: string }) => g.hd === 'HR');
      expect(hr.people.find((p: { id: string }) => p.id === 'u3')).toMatchObject({ onLeaveToday: true });
      const lnd = r.body.groups.find((g: { hd: string }) => g.hd === 'LND');
      expect(lnd.people.find((p: { id: string }) => p.id === 'u8')).toMatchObject({ onLeaveToday: false, onLeaveTomorrow: true });
      expect(r.body.groups.some((g: { hd: string }) => g.hd === 'SF')).toBe(false);
      const sf = await http().get('/api/demo/absences').set(as('u5')).expect(200);
      expect(sf.body.groups.find((g: { hd: string }) => g.hd === 'SF').people.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(['u5', 'u27']));
    });
  });

  describe('2 · absence-based reassignment', () => {
    beforeAll(reseed);
    let hrKey = '';
    it('A1: HR lead away → next ladder person, neutral event, no escalation', async () => {
      const r = await raise('u1', 'HR', LEAVE).expect(201);
      hrKey = r.body.key;
      const t = await detail('u9', hrKey);
      expect(t.assignee.id).toBe('u9');
      expect(t.escalationLevel).toBe(0);
      expect(t.ladderBase).toBe(2);
      expect(t.asgHist[0]).toMatchObject({ u: 'u9', how: 'absence', coverFor: 'u3' });
      const mine = await detail('u1', hrKey);
      expect(mine.events.map((e: { text: string }) => e.text)).toContain('Reassigned to Anil Gupta (assignee unavailable)');
      expect(JSON.stringify(mine.events)).not.toMatch(/leave|sick/i);
      const n = await http().get('/api/notifications').set(as('u9')).expect(200);
      expect(n.body[0].text).toBe(`New ticket ${hrKey} assigned to you (covering for Priya Rao)`);
    });
    it('A8: escalation from the cover goes to the level above them, never back to the absent lead', async () => {
      const t = await detail('u9', hrKey);
      expect(t.me.canEscalate).toBe(true);
      await http().post(`/api/tickets/${hrKey}/escalate`).set(as('u9')).send({ reason: 'Needs HR head' }).expect(200);
      const after = await detail('u9', hrKey);
      expect(after.events.map((e: { text: string }) => e.text).some((x: string) => x.startsWith('Escalated to Level 3 · Lata Verma'))).toBe(true);
      expect(after.me.canEscalate).toBe(false);
    });
    it('A2: lead and next person away → the one after', async () => {
      await away('u9');
      const r = await raise('u1', 'HR', LEAVE).expect(201);
      expect((await detail('u13', r.body.key)).assignee.id).toBe('u13');
      await away('u9', false);
    });
    it('A4: L&D coordinator away → L&D head; both away → the HR head is skipped as ineligible and it falls back', async () => {
      const enrol = { cat: 'ENROL', sub: 'Cannot enrol', title: 'Cannot enrol', desc: 'Enrolment fails', reqType: 'Portal problem', problem: 'Cannot enrol in a course', learningSource: 'LinkedIn Learning' };
      await away('u8');
      const r = await raise('u1', 'LND', enrol).expect(201);
      const t = await detail('u20', r.body.key);
      expect(t.assignee.id).toBe('u4');
      expect(t.escalationLevel).toBe(0);
      expect(t.ladderBase).toBe(2);
      expect(t.asgHist[0]).toMatchObject({ u: 'u4', how: 'absence', coverFor: 'u8' });
      await away('u4');
      const r2 = await raise('u1', 'LND', enrol).expect(201);
      const t2 = await detail('u20', r2.body.key);
      // u13 (HR head) is in the L&D ladder but cannot work L&D tickets, so the ladder is exhausted.
      expect(t2.assignee.id).toBe('u8');
      expect(t2.events.map((e: { text: string }) => e.text)).toContain('No cover available, kept with the category lead');
      await away('u8', false);
      await away('u4', false);
    });
    it('A3: Grievance with the HR head away stays put, admins are alerted, nobody else gains access', async () => {
      await away('u13');
      const r = await raise('u1', 'HR', { cat: 'GRV', sub: 'Manager concerns', title: 'Concern', desc: 'Private', location: 'Mumbai HQ' }).expect(201);
      const t = await detail('u13', r.body.key);
      expect(t.assignee.id).toBe('u13');
      expect(t.events.map((e: { text: string }) => e.text)).toContain('No cover available, kept with the category lead');
      await http().get(`/api/tickets/${r.body.key}`).set(as('u9')).expect(403);
      const n = await http().get('/api/notifications').set(as('u20')).expect(200);
      // Confidential tickets are masked in notifications; the alert still reaches the Helpdesk admin.
      expect(n.body.filter((x: { ticketKey: string }) => x.ticketKey === r.body.key).length).toBeGreaterThan(0);
      const perf = await http().get('/api/admin/performance?range=7').set(as('u20')).expect(200);
      expect(perf.body.unattended.map((x: { key: string }) => x.key)).toContain(r.body.key);
      await away('u13', false);
    });
    it('A5: IT security with Farhan away → IT head', async () => {
      await away('u22');
      const r = await raise('u1', 'IT', { cat: 'SEC', sub: 'Phishing email reported', title: 'Phish', desc: 'Odd mail', incidentAt: '2026-11-18T10:00' }).expect(201);
      expect((await detail('u23', r.body.key)).assignee.id).toBe('u23');
      await away('u22', false);
    });
    it('A6: queue categories are unaffected', async () => {
      await away('u21');
      const r = await raise('u1', 'IT', { cat: 'HW', sub: 'Laptop or desktop issue', title: 'Fan', desc: 'Loud', deviceType: 'Laptop', assetTag: 'NPX-LT-1234', impact: 'Only me', location: 'Mumbai HQ' }).expect(201);
      const t = await detail('u20', r.body.key);
      expect(t.assignee.id).toBe('q_it');
      expect(t.ladderBase).toBe(0);
      await away('u21', false);
    });
    it('A7: Salesforce owner away → Senior admin queue person', async () => {
      await away('u5');
      const r = await raise('u2', 'SF', { cat: 'ACCESS', sub: 'New Salesforce user', title: 'New user', desc: 'Please add' }).expect(201);
      const t = await detail('u27', r.body.key);
      expect(t.assignee.id).toBe('u27');
      expect(t.events.map((e: { text: string }) => e.text)).toContain('Assignment rule: owner unavailable → Senior admin queue (Karan Mehta)');
      await away('u5', false);
    });
    it('confidential category (PAY): the lead away → the next ladder person now covers it, still no escalation', async () => {
      const r = await raise('u2', 'HR', { cat: 'PAY', sub: 'Payslip', title: 'Payslip missing', desc: 'No payslip this month', location: 'Mumbai HQ', payMonth: 'November 2026' }).expect(201);
      const t = await detail('u9', r.body.key);
      expect(t.assignee.id).toBe('u9');
      expect(t.escalationLevel).toBe(0);
      expect(t.ladderBase).toBe(2);
      expect(t.asgHist[0]).toMatchObject({ u: 'u9', how: 'absence', coverFor: 'u3' });
      const mine = await detail('u2', r.body.key);
      expect(mine.events.map((e: { text: string }) => e.text)).toContain('Reassigned to Anil Gupta (assignee unavailable)');
      expect(JSON.stringify(mine.events)).not.toMatch(/leave|sick/i);
    });
    it('seeded Admin Desk lead and next person both away → kept with the lead and listed as unattended', async () => {
      const r = await raise('u1', 'ADM', { cat: 'FAC', sub: 'Air conditioning', title: 'AC', desc: 'Too warm', building: 'Mumbai HQ · Tower A', floor: '3', spot: 'Bay 4', urgency: 'Today' }).expect(201);
      const t = await detail('u20', r.body.key);
      expect(t.assignee.id).toBe('u24');
      expect(t.priority).toBe('Medium');
      expect(t.events.map((e: { text: string }) => e.text)).toContain('No cover available, kept with the category lead');
    });
    it('A9: approval category: the absence check runs at the last approval and the SLA starts there', async () => {
      const r = await raise('u1', 'IT', SW).expect(201);
      expect(r.body.toast).toMatch(/SLA starts after approval/);
      const before = await detail('u21', r.body.key);
      expect(before).toMatchObject({ status: 'Pending approval', slaStarted: false });
      expect(before.assignee.id).toBe('u21');
      await away('u21');
      await http().post(`/api/tickets/${r.body.key}/approval`).set(as('u6')).send({ decision: 'Approved' }).expect(200);
      const t = await detail('u23', r.body.key);
      expect(t.assignee.id).toBe('u23');
      expect(t.slaStarted).toBe(true);
      const texts = t.events.map((e: { text: string }) => e.text);
      expect(texts.some((x: string) => x.startsWith('SLA started on approval'))).toBe(true);
      expect(texts).toContain('Reassigned to Suresh Pai (assignee unavailable)');
      expect(new Date(t.resolutionDue).getTime()).toBeGreaterThan(new Date(t.slaStart).getTime());
      await away('u21', false);
    });
    it('the Reassign list marks people unavailable today', async () => {
      const t = await detail('u3', 'HR-000121');
      expect(t.me.agents.find((a: { id: string }) => a.id === 'u3')).toBeUndefined();
      const t2 = await detail('u9', hrKey);
      expect(t2.me.agents.find((a: { id: string }) => a.id === 'u3')).toMatchObject({ away: true });
    });
  });

  describe('3 · SLA versioning', () => {
    beforeAll(reseed);
    it('each save appends a version; tickets bind at raise; open tickets keep theirs', async () => {
      const open = await detail('u3', 'HR-000121');
      const s = await http().put('/api/admin/sla').set(as('u20')).send({ table: 'shared', priority: 'Medium', index: 1, hours: 12 }).expect(200);
      expect(s.body.version).toBe(2);
      const again = await http().put('/api/admin/sla').set(as('u20')).send({ table: 'shared', priority: 'Medium', index: 1, hours: 10 }).expect(200);
      expect(again.body.version).toBe(2);
      const r = await raise('u1', 'HR', LEAVE).expect(201);
      const t = await detail('u1', r.body.key);
      expect(Math.round((new Date(t.resolutionDue).getTime() - new Date(t.createdAt).getTime()) / 3600000)).toBe(10);
      const third = await http().put('/api/admin/sla').set(as('u20')).send({ table: 'shared', priority: 'Medium', index: 1, hours: 9 }).expect(200);
      expect(third.body.version).toBe(3);
      expect((await detail('u3', 'HR-000121')).resolutionDue).toBe(open.resolutionDue);
      const adm = await http().get('/api/admin').set(as('u20')).expect(200);
      const v2 = adm.body.slaVersions.find((v: { id: number }) => v.id === 2);
      expect(v2.changes).toEqual([{ what: 'HR and L&D · Medium resolution', before: 72, after: 10 }]);
      expect(v2.openOnVersion).toBe(1);
      expect(adm.body.slaVersions[0]).toMatchObject({ id: 1 });
      expect(adm.body.audit[0].text).toMatch(/→ 9 h \(SLA v3\)/);
    });
  });

  describe('4 · manager approval toggle', () => {
    beforeAll(reseed);
    const catId = async (hd: string, key: string) => (await http().get('/api/admin').set(as('u20'))).body.categories.find((c: { helpdesk: string; key: string }) => c.helpdesk === hd && c.key === key);
    it('migrated values: SW on for two subs, Access, Travel, Purchase and Course on; others off', async () => {
      const cfg = (await http().get('/api/config').set(as('u1')).expect(200)).body;
      const c = (hd: string, k: string) => cfg.categories.find((x: { helpdesk: string; key: string }) => x.helpdesk === hd && x.key === k);
      expect(c('IT', 'SW')).toMatchObject({ mgrApproval: true, mgrApprovalSubs: ['Install new software', 'Software licence request'] });
      for (const [h, k] of [['IT', 'ACC'], ['ADM', 'TRAVEL'], ['ADM', 'PUR'], ['LND', 'COURSE']]) expect(c(h, k)).toMatchObject({ mgrApproval: true, mgrApprovalSubs: null });
      expect(c('HR', 'LEAVE').mgrApproval).toBe(false);
      expect(c('ADM', 'PUR').extraSteps).toEqual(['adm']);
    });
    it('M3: a sub-category outside "Applies to" raises without approval', async () => {
      const r = await raise('u1', 'IT', { ...SW, sub: 'Software not working', justification: '' }).expect(201);
      expect((await detail('u1', r.body.key)).approval).toBeNull();
    });
    it('M1/M2: toggling off removes the manager step for new tickets; additional steps still apply', async () => {
      const sw = await catId('IT', 'SW');
      await http().patch(`/api/admin/categories/${sw.id}/mgr-approval`).set(as('u20')).send({ on: false }).expect(200);
      const r = await raise('u1', 'IT', SW).expect(201);
      expect((await detail('u1', r.body.key)).approval).toBeNull();
      const pur = await catId('ADM', 'PUR');
      await http().patch(`/api/admin/categories/${pur.id}/mgr-approval`).set(as('u20')).send({ on: false }).expect(200);
      const p = await raise('u1', 'ADM', { cat: 'PUR', sub: 'New purchase', title: 'Chairs', desc: 'Ten chairs', itemService: 'Chairs', cost: '5000', justification: 'Team growth' }).expect(201);
      expect((await detail('u1', p.body.key)).approval.steps.map((s: { step: string }) => s.step)).toEqual(['adm']);
      await http().patch(`/api/admin/categories/${sw.id}/mgr-approval`).set(as('u20')).send({ on: true, subs: ['Install new software'] }).expect(200);
      const back = await raise('u1', 'IT', SW).expect(201);
      expect((await detail('u1', back.body.key)).approval.steps.map((s: { step: string }) => s.step)).toEqual(['mgr']);
      const adm = await http().get('/api/admin').set(as('u20')).expect(200);
      expect(adm.body.audit[0].text).toBe('IT and Support · Software and installation: manager approval off → on for Install new software');
    });
    it('M5: while pending the assignee can note and reassign but cannot start, resolve or escalate', async () => {
      const r = await raise('u1', 'IT', SW).expect(201);
      const k = r.body.key;
      const t = await detail('u21', k);
      expect(t.sla.usedPct).toBe(0);
      expect(t.me.canEscalate).toBe(false);
      await http().post(`/api/tickets/${k}/comments`).set(as('u21')).send({ body: 'Checking licence stock', internal: true }).expect(201);
      expect((await http().patch(`/api/tickets/${k}/status`).set(as('u21')).send({ status: 'In Progress' })).body.code).toBe('PENDING_APPROVAL');
      expect((await http().post(`/api/tickets/${k}/close`).set(as('u21')).send({ to: 'Resolved', message: 'Done' })).body.code).toBe('PENDING_APPROVAL');
      expect((await http().post(`/api/tickets/${k}/escalate`).set(as('u21')).send({ reason: 'x' })).body.code).toBe('PENDING_APPROVAL');
      await http().post(`/api/tickets/${k}/comments`).set(as('u21')).send({ body: 'Public reply while pending', internal: false }).expect(201);
      expect((await detail('u21', k)).responseMet).toBeNull();
    });
    it('M6: a requester without a manager has the manager step routed to the Helpdesk admin', async () => {
      const r = await raise('u13', 'IT', SW).expect(201);
      const t = await detail('u13', r.body.key);
      expect(t.approval.steps[0].who).toBe('Asha Kulkarni');
      await http().post(`/api/tickets/${r.body.key}/approval`).set(as('u20')).send({ decision: 'Approved' }).expect(200);
      expect((await detail('u13', r.body.key)).status).toBe('In Progress');
    });
    it('rejected at approval: never started, left out of SLA metrics', async () => {
      const r = await raise('u1', 'IT', SW).expect(201);
      await http().post(`/api/tickets/${r.body.key}/approval`).set(as('u6')).send({ decision: 'Rejected', note: 'Not needed' }).expect(200);
      const t = await detail('u1', r.body.key);
      expect(t.slaStarted).toBe(false);
      expect(t.sla.txt).toBe('Not started');
      const list = await http().get('/api/tickets?view=all&tab=closed&flag=breached').set(as('u20')).expect(200);
      expect(list.body.rows.map((x: { key: string }) => x.key)).not.toContain(r.body.key);
    });
  });

  describe('5 · priority is not chosen in the raise form', () => {
    beforeAll(reseed);
    const HW = { cat: 'HW', sub: 'Laptop or desktop issue', title: 'Fan', desc: 'Loud', deviceType: 'Laptop', assetTag: 'NPX-LT-1234', impact: 'Only me', location: 'Mumbai HQ' };
    it('a requester-sent priority is ignored; the category default applies', async () => {
      const r = await raise('u1', 'IT', { ...HW, pri: 'Critical' }).expect(201);
      expect((await detail('u1', r.body.key)).priority).toBe('Medium');
    });
    it('AI voice may raise priority for urgent speech', async () => {
      const r = await raise('u1', 'IT', { ...HW, pri: 'High' }, { aiTranscript: 'urgent my laptop fan is failing' }).expect(201);
      expect((await detail('u1', r.body.key)).priority).toBe('High');
    });
    it('the SLA answer does not name a priority for requesters', async () => {
      const r = await http().post('/api/ai/ask').set(as('u1')).send({ q: 'how long does a payroll ticket take', full: true }).expect(200);
      const text = (r.body.answer?.parts ?? []).map((p: { v?: string }) => p.v ?? '').join('');
      expect(text).toMatch(/first response within/);
      expect(text).not.toMatch(/priority/i);
    });
  });

  describe('6 · dashboard metrics', () => {
    beforeAll(reseed);
    it('Open = Not started + In progress + Pending input, and every card reproduces its count in the list', async () => {
      const a = (await http().get('/api/analytics?scope=org&range=90').set(as('u20')).expect(200)).body;
      const card = (k: string) => a.cards.find((c: { k: string }) => c.k === k);
      expect(card('open').n).toBe(card('notstarted').n + card('progress').n + card('pending').n);
      expect(a.cards.map((c: { k: string }) => c.k)).not.toContain('total');
      expect(a.charts.topCats.reduce((s: number, x: { n: number }) => s + x.n, 0)).toBe(card('raised').n);
      expect(a.charts.byHd.reduce((s: number, x: { n: number }) => s + x.n, 0)).toBe(card('raised').n);
      for (const c of a.cards.filter((x: { n: unknown }) => typeof x.n === 'number')) {
        const go = c.go as Record<string, string>;
        const qs = new URLSearchParams({ view: 'all', tab: go.tab ?? 'open', ...(go.flag ? { flag: go.flag } : {}), ...(go.status ? { status: go.status } : {}), ...(go.from ? { from: go.from } : {}) });
        const l = (await http().get(`/api/tickets?${qs}`).set(as('u20')).expect(200)).body;
        const n = c.g === 'range' ? (go.tab === 'closed' ? l.counts.closed : l.counts.open + l.counts.closed) : l.total;
        expect([c.k, n]).toEqual([c.k, c.n]);
      }
    });
  });

  describe('7 · assignee performance', () => {
    beforeAll(reseed);
    it('seeded escalations count as Escalated by SLA for the holder and Received by escalation for the next person', async () => {
      const p = (await http().get('/api/admin/performance?range=90').set(as('u20')).expect(200)).body;
      const row = (id: string) => p.rows.find((r: { userId: string }) => r.userId === id);
      for (const [key, from, to] of [['HR-000121', 'u3', 'u9'], ['IT-000050', 'u21', 'u23'], ['ADM-000052', 'u24', 'u25']]) {
        expect([key, row(from).drill.escSla]).toEqual([key, expect.arrayContaining([key])]);
        expect([key, row(to).drill.recvEsc]).toEqual([key, expect.arrayContaining([key])]);
      }
      expect(JSON.stringify(p)).not.toMatch(/compliance/i);
    });
    it('reconciles: outcomes add up to Assigned, assignments to the total, overdue to the dashboard card', async () => {
      const p = (await http().get('/api/admin/performance?range=90').set(as('u20')).expect(200)).body;
      for (const r of p.rows) {
        const c = r.counts;
        expect([r.name, c.withinSla + c.late + c.escSla + c.escManual + c.reManual + c.reAbsence + c.open + c.rejected]).toEqual([r.name, c.assigned]);
      }
      const x = p.reconciliation;
      expect(x.peopleAssigned + x.queueAssigned).toBe(x.directTotal);
      expect(x.escDirect + x.escInherited).toBe(x.escHandovers);
      expect(x.overdueRows).toBe(x.overdueCard);
      const a = (await http().get('/api/analytics?scope=org&range=90').set(as('u20')).expect(200)).body;
      expect(a.cards.find((c: { k: string }) => c.k === 'over').n).toBe(x.overdueCard);
    });
    it('My performance shows only your own data; others get 403', async () => {
      const mine = (await http().get('/api/performance/me?range=90').set(as('u21')).expect(200)).body;
      expect(mine.rows.length).toBeGreaterThan(0);
      expect(mine.rows.every((r: { userId: string }) => r.userId === 'u21')).toBe(true);
      await http().get('/api/performance/me').set(as('u1')).expect(403);
      await http().get('/api/performance/me').set(as('u26')).expect(403);
      await http().get('/api/admin/performance').set(as('u21')).expect(403);
      await http().post('/api/admin/performance/log').set(as('u20')).send({ event: 'export', detail: 'range 90' }).expect(200);
    });
  });
});
