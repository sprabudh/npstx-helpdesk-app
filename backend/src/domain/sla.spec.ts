import { evalCond, isAtRisk, isBreachedRes, isOverdue, slaInfo, uiOf, type SlaTicket } from './sla';

const now = Date.UTC(2026, 10, 4, 6, 16);
const h = 3600000;
const t = (o: Partial<SlaTicket> = {}): SlaTicket => ({ helpdesk: 'IT', status: 'In Progress', createdAt: new Date(now - 10 * h), closedAt: null, resolutionDue: new Date(now + 48 * h), responseMet: true, paused: false, escalationLevel: 0, closeResponse: null, ...o });

describe('slaInfo', () => {
  it('on track, due soon, overdue', () => {
    expect(slaInfo(t(), false, now)).toMatchObject({ cls: 'ok', txt: 'On track' });
    expect(slaInfo(t({ resolutionDue: new Date(now + 5 * h) }), false, now)).toMatchObject({ cls: 'soon', txt: 'Due in 5h 0m' });
    expect(slaInfo(t({ resolutionDue: new Date(now - 26 * h) }), false, now)).toMatchObject({ cls: 'over', txt: 'Overdue 1d 2h' });
  });
  it('paused while waiting and awaiting approval', () => {
    expect(slaInfo(t({ paused: true }), false, now).txt).toBe('Paused');
    expect(slaInfo(t({ status: 'Pending approval' }), false, now).txt).toBe('Awaiting approval');
  });
  it('closed tickets show Met or Breached', () => {
    expect(slaInfo(t({ closedAt: new Date(now) }), true, now).txt).toBe('Met');
    expect(slaInfo(t({ closedAt: new Date(now + 49 * h) }), true, now).txt).toBe('Breached');
  });
  it('overdue, at risk and breached flags ignore paused tickets', () => {
    expect(isOverdue(t({ resolutionDue: new Date(now - h), paused: true }), false, now)).toBe(false);
    expect(isAtRisk(t({ resolutionDue: new Date(now + h) }), false, now)).toBe(true);
    expect(isBreachedRes(t({ status: 'Cancelled', closedAt: new Date(now + 99 * h) }), true, now)).toBe(false);
  });
});

describe('uiOf', () => {
  const st = { open: ['New', 'In Progress', 'Waiting for user'], closed: ['Resolved', 'Closed', 'Rejected', 'Cancelled'], tr: {}, closing: ['Resolved', 'Rejected'], work: 'In Progress', wait: 'Waiting for user' };
  const map = { New: 'Open', 'In Progress': 'In Progress', 'Waiting for user': 'Pending Input' };
  it('maps helpdesk statuses to the six employee statuses', () => {
    expect(uiOf(st, map, 'Waiting for user')).toBe('Pending Input');
    expect(uiOf(st, map, 'Closed', 'Rejected')).toBe('Rejected');
    expect(uiOf(st, map, 'Closed', 'Resolved')).toBe('Resolved');
    expect(uiOf(st, map, 'Cancelled')).toBe('Cancelled');
  });
});

describe('evalCond (form rules)', () => {
  it('eq, neq, in, notIn, set, all, any', () => {
    const f = { sub: 'Shared folder access', duration: '30 days', approver: '' };
    expect(evalCond({ field: 'sub', op: 'eq', value: 'Shared folder access' }, f)).toBe(true);
    expect(evalCond({ field: 'sub', op: 'neq', value: 'VPN access' }, f)).toBe(true);
    expect(evalCond({ field: 'duration', op: 'in', value: ['30 days', '90 days'] }, f)).toBe(true);
    expect(evalCond({ field: 'duration', op: 'notIn', value: ['Permanent'] }, f)).toBe(true);
    expect(evalCond({ field: 'approver', op: 'set', value: true }, f)).toBe(false);
    expect(evalCond({ all: [{ field: 'sub', op: 'eq', value: 'Shared folder access' }, { field: 'approver', op: 'set', value: false }] }, f)).toBe(true);
    expect(evalCond({ any: [{ field: 'sub', op: 'eq', value: 'x' }, { field: 'duration', op: 'eq', value: 'y' }] }, f)).toBe(false);
    expect(evalCond(null, f)).toBe(false);
    expect(evalCond(true, f)).toBe(true);
  });
});
