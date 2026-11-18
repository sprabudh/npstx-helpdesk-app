import { principal, ticket } from '../test-support/fixtures';
import {
  allowedHds, approvalStage, canAddPeople, canApproveStep, canEditFaq, canView, canWork, hdAllowed, isReadOnly, reopenInfo, viewsFor, whyVisible,
} from './policy';
import type { TicketCtx } from './types';

/**
 * Role-by-action matrix (SDD v1.0 §9). Each row: persona, ticket, expected view / work / read-only.
 * Personas come from the seed: u1 employee (Engineering), u2 Sales employee, u3 HR agent (PAY, LEAVE), u4 L&D head,
 * u5 SF case admin (Sales), u6 manager (Engineering), u8 HR / L&D admin + L&D coordinator, u9 HR agent (REC, POL…),
 * u20 helpdesk admin (HR Operations), u21 IT agent, u22 IT agent (security lead), u23 IT head, u24 Admin desk agent,
 * u25 Admin head, u26 auditor.
 */
const HR_PAY = ticket({ key: 'HR-000901', helpdesk: 'HR', categoryKey: 'PAY', status: 'In Progress', requesterId: 'u12', assigneeId: 'u3', category: { leadId: 'u3', ownerId: null, restricted: false, reopenAllowed: true, name: 'Payroll and salary' } });
const HR_GRV = ticket({ key: 'HR-000902', helpdesk: 'HR', categoryKey: 'GRV', status: 'Open', requesterId: 'u12', assigneeId: 'u13', confidential: true, category: { leadId: 'u13', ownerId: null, restricted: true, reopenAllowed: false, name: 'Grievance' } });
const IT_HW = ticket({ key: 'IT-000901' });
const IT_SEC = ticket({ key: 'IT-000902', categoryKey: 'SEC', confidential: true, assigneeId: 'u22', category: { leadId: 'u22', ownerId: null, restricted: true, reopenAllowed: false, name: 'Security incident' } });
const LND = ticket({ key: 'LND-000901', helpdesk: 'LND', categoryKey: 'CONTENT', status: 'New', assigneeId: 'q_lnd', category: { leadId: null, ownerId: 'q_lnd', restricted: false, reopenAllowed: true, name: 'Content and playback' } });
const ADM = ticket({ key: 'ADM-000901', helpdesk: 'ADM', categoryKey: 'FAC', status: 'New', assigneeId: 'u24', category: { leadId: 'u24', ownerId: null, restricted: false, reopenAllowed: true, name: 'Facilities' } });
const SF = ticket({ key: 'SF-00901', helpdesk: 'SF', categoryKey: 'DATA', status: 'Working', requesterId: 'u2', assigneeId: 'u5', category: { leadId: null, ownerId: 'u5', restricted: false, reopenAllowed: null as unknown as boolean, name: 'Data change' } });

type Row = [persona: string, t: TicketCtx, view: boolean, work: boolean, readOnly: boolean];
const MATRIX: Row[] = [
  // HR payroll ticket raised by u12 and assigned to u3
  ['u12', HR_PAY, true, false, false], // requester
  ['u3', HR_PAY, true, true, false], // HR agent for PAY
  ['u9', HR_PAY, false, false, false], // HR agent for other categories
  ['u1', HR_PAY, false, false, false], // unrelated employee
  ['u6', HR_PAY, false, false, false], // requester's manager without a follower relation
  ['u8', HR_PAY, true, false, true], // HR / L&D admin: read-only
  ['u20', HR_PAY, true, true, false], // helpdesk admin
  ['u26', HR_PAY, true, false, true], // auditor: read-only
  ['u21', HR_PAY, false, false, false], // IT agent
  // Confidential HR grievance
  ['u13', HR_GRV, true, true, false], // category lead and assignee
  ['u3', HR_GRV, false, false, false], // other HR agent
  ['u26', HR_GRV, false, false, false], // auditor never opens confidential tickets
  ['u8', HR_GRV, true, false, true], // HR / L&D admin keeps audited read access
  ['u20', HR_GRV, true, true, false],
  // IT hardware
  ['u21', IT_HW, true, true, false],
  ['u22', IT_HW, true, true, false],
  ['u23', IT_HW, true, true, false],
  ['u24', IT_HW, false, false, false],
  ['u1', IT_HW, false, false, false],
  ['u26', IT_HW, true, false, true],
  // IT confidential security
  ['u21', IT_SEC, false, false, false], // other IT agent
  ['u22', IT_SEC, true, true, false], // security lead
  ['u23', IT_SEC, true, true, false], // IT head
  ['u26', IT_SEC, false, false, false],
  ['u20', IT_SEC, true, true, false],
  // L&D
  ['u4', LND, true, true, false],
  ['u8', LND, true, true, false], // L&D coordinator works L&D
  ['u3', LND, false, false, false],
  // Admin Desk
  ['u24', ADM, true, true, false],
  ['u25', ADM, true, true, false],
  ['u21', ADM, false, false, false],
  // Salesforce
  ['u2', SF, true, false, false], // Sales requester
  ['u5', SF, true, true, false], // SF case admin
  ['u1', SF, false, false, false], // Engineering: never
  ['u20', SF, false, false, false], // helpdesk admin outside Sales: never
  ['u26', SF, false, false, false], // auditor outside Sales: never
];

describe('access matrix: canView / canWork / isReadOnly', () => {
  it.each(MATRIX)('%s on %s', (who, t, view, work, ro) => {
    const u = principal(who);
    expect(canView(u, t)).toBe(view);
    expect(canWork(u, t)).toBe(work);
    expect(isReadOnly(u, t)).toBe(ro);
  });

  it('never lets anyone work a ticket they cannot view (deny by default)', () => {
    const everyone = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u8', 'u9', 'u12', 'u13', 'u20', 'u21', 'u22', 'u23', 'u24', 'u25', 'u26'];
    for (const id of everyone) for (const t of [HR_PAY, HR_GRV, IT_HW, IT_SEC, LND, ADM, SF]) if (!canView(principal(id), t)) expect(canWork(principal(id), t)).toBe(false);
  });

  it('a follower can view but not work; adding a follower opens a confidential ticket to that person only', () => {
    const t = { ...HR_GRV, followers: [{ userId: 'u1', relation: 'FOLLOWER', addedById: 'u12' }] };
    expect(canView(principal('u1'), t)).toBe(true);
    expect(canWork(principal('u1'), t)).toBe(false);
    expect(canView(principal('u2'), t)).toBe(false);
  });

  it('a requester who is also an agent does not work their own HR ticket', () => {
    const t = { ...HR_PAY, requesterId: 'u3', assigneeId: 'u9' };
    expect(canView(principal('u3'), t)).toBe(true);
    expect(canWork(principal('u3'), t)).toBe(false);
  });
});

describe('Salesforce scope comes from the department, never from a role alone', () => {
  it.each([['Sales', true], ['Presales', true], ['Solutions', true], ['Engineering', false], ['HR Operations', false], [null, false]])('%s → %s', (dept, ok) => {
    expect(hdAllowed({ dept: dept as string | null }, 'SF')).toBe(ok);
  });
  it('a helpdesk admin moved into Sales gains SF; an SF admin moved out loses it', () => {
    expect(allowedHds(principal('u20', { dept: 'Sales' }))).toContain('SF');
    expect(canView(principal('u5', { dept: 'Engineering' }), SF)).toBe(false);
  });
});

describe('approvals', () => {
  const course = ticket({
    key: 'LND-000902', helpdesk: 'LND', categoryKey: 'COURSE', status: 'Pending approval', requesterId: 'u1', assigneeId: 'u8', requesterManagerId: 'u6',
    approvals: [
      { step: 'mgr', seq: 1, status: 'Pending', approverId: 'u6', decidedById: null, decidedAt: null },
      { step: 'lnd', seq: 2, status: 'Pending', approverId: null, decidedById: null, decidedAt: null },
    ],
  });
  it('only the requester manager acts on the manager step', () => {
    expect(approvalStage(principal('u6'), course)).toBe('mgr');
    expect(approvalStage(principal('u7'), course)).toBeNull();
    expect(approvalStage(principal('u4'), course)).toBeNull(); // L&D waits for the manager
    expect(approvalStage(principal('u1'), course)).toBeNull(); // never the requester
  });
  it('after the manager approves, L&D head or HR / L&D admin act; not the helpdesk admin', () => {
    const next = { ...course, approvals: [{ ...course.approvals[0], status: 'Approved' }, course.approvals[1]] };
    expect(approvalStage(principal('u4'), next)).toBe('lnd');
    expect(approvalStage(principal('u8'), next)).toBe('lnd');
    expect(approvalStage(principal('u20'), next)).toBeNull();
    expect(approvalStage(principal('u6'), next)).toBeNull();
  });
  it('a rejected step stops the chain', () => {
    const rej = { ...course, status: 'Rejected', approvals: [{ ...course.approvals[0], status: 'Rejected' }, course.approvals[1]] };
    expect(approvalStage(principal('u4'), rej)).toBeNull();
  });
  it('IT head and Admin head steps', () => {
    expect(canApproveStep(principal('u23'), IT_HW, 'ith')).toBe(true);
    expect(canApproveStep(principal('u21'), IT_HW, 'ith')).toBe(false);
    expect(canApproveStep(principal('u25'), ADM, 'adm')).toBe(true);
    expect(canApproveStep(principal('u24'), ADM, 'adm')).toBe(false);
  });
});

describe('people, reopen, views and FAQ editing', () => {
  it('confidential tickets: only requester or assignee add people', () => {
    expect(canAddPeople(principal('u12'), HR_GRV)).toBe(true);
    expect(canAddPeople(principal('u13'), HR_GRV)).toBe(true);
    expect(canAddPeople(principal('u20'), HR_GRV)).toBe(false);
    expect(canAddPeople(principal('u1'), IT_HW)).toBe(true);
  });
  const now = new Date('2026-11-04T06:16:00Z').getTime();
  it('HR reopen within 30 days unless the category disallows or it was cancelled', () => {
    const closed = { ...HR_PAY, status: 'Closed', closeResponse: 'Resolved', closedAt: new Date(now - 5 * 864e5), closed: true, categoryName: 'Payroll and salary' };
    expect(reopenInfo(closed, now).ok).toBe(true);
    expect(reopenInfo({ ...closed, closedAt: new Date(now - 31 * 864e5) }, now).short).toBe('Window passed');
    expect(reopenInfo({ ...closed, closeResponse: 'Cancelled' }, now).short).toBe('Cancelled');
    expect(reopenInfo({ ...closed, category: { ...closed.category!, reopenAllowed: false } }, now).short).toBe('Category disallows');
  });
  it('IT reopen only from Resolved, within 7 days; Salesforce never', () => {
    const res = { ...IT_HW, status: 'Resolved', closedAt: new Date(now - 3 * 864e5), closed: true, categoryName: 'Hardware' };
    expect(reopenInfo(res, now).ok).toBe(true);
    expect(reopenInfo({ ...res, closedAt: new Date(now - 8 * 864e5) }, now).ok).toBe(false);
    expect(reopenInfo({ ...res, status: 'Closed' }, now).short).toBe('Not reopenable');
    expect(reopenInfo({ ...SF, status: 'Closed', closedAt: new Date(now), closed: true, categoryName: 'Data' }, now).short).toBe('Raise a new case');
  });
  it('scope views per role', () => {
    expect(viewsFor(principal('u1')).map((v) => v[0])).toEqual(['mine']);
    expect(viewsFor(principal('u20')).map((v) => v[0])).toEqual(expect.arrayContaining(['mine', 'assigned', 'all']));
    expect(viewsFor(principal('u6')).map((v) => v[0])).toEqual(['mine', 'approvals']);
    expect(viewsFor(principal('u26')).map((v) => v[1])).toContain('All tickets (read-only)');
  });
  it('FAQ editors', () => {
    expect(canEditFaq(principal('u9'), 'HR', 'u9')).toBe(true);
    expect(canEditFaq(principal('u3'), 'HR', 'u9')).toBe(false);
    expect(canEditFaq(principal('u4'), 'LND', null)).toBe(true);
    expect(canEditFaq(principal('u20'), 'SF', null)).toBe(false); // admin outside Sales
    expect(canEditFaq(principal('u5'), 'SF', null)).toBe(true);
  });
  it('whyVisible explains the relation shown on the ticket header', () => {
    expect(whyVisible(principal('u12'), HR_PAY)[0]).toBe('Requester');
    expect(whyVisible(principal('u3'), HR_PAY)[0]).toBe('Assignee');
    expect(whyVisible(principal('u26'), IT_HW)[0]).toBe('Auditor');
  });
});
