import { Helpdesk, HD_ORDER, Principal, Role, TicketCtx } from './types';

/**
 * Access policy, deny by default. A direct port of the artifact's RBAC rules (SDD v1.0 section 9).
 * Pure functions so the full role-by-action matrix can be unit tested without a database.
 */
export const SF_DEPTS = ['Sales', 'Presales', 'Solutions'];
export const WORK_ROLES: Role[] = ['HR_AGENT', 'LND_HEAD', 'LND_COORD', 'SF_ADMIN', 'IT_AGENT', 'IT_HEAD', 'ADM_AGENT', 'ADM_HEAD', 'HD_ADMIN'];
export const HEAD_ROLES: Role[] = ['LND_HEAD', 'IT_HEAD', 'ADM_HEAD', 'HD_ADMIN', 'AUDITOR', 'SF_ADMIN', 'HRLND_ADMIN'];
export const APPROVER_ROLES: Role[] = ['MANAGER', 'LND_HEAD', 'HRLND_ADMIN', 'IT_HEAD', 'ADM_HEAD', 'HD_ADMIN'];
/** TC: when false, priority is hidden from plain requesters everywhere (staff still see it). */
export const PRIORITY_VISIBLE_TO_REQUESTER = true;
/** Helpdesks that use the Resolve → confirm → Closed model (the L&D style). */
export const STM_HDS: Helpdesk[] = ['LND', 'IT', 'ADM'];

export const has = (u: Principal, r: Role) => u.roles.has(r);
export const hdAllowed = (u: Pick<Principal, 'dept'>, hd: string) => hd !== 'SF' || SF_DEPTS.includes(u.dept ?? '');
export const allowedHds = (u: Principal): Helpdesk[] => HD_ORDER.filter((h) => hdAllowed(u, h));
export function workHds(u: Principal, extraHds: string[] = []): Helpdesk[] {
  const set = new Set<Helpdesk>();
  if (has(u, 'HD_ADMIN')) for (const h of allowedHds(u)) set.add(h);
  if (has(u, 'HR_AGENT') && u.hrCats.size) set.add('HR');
  if (has(u, 'LND_HEAD') || has(u, 'LND_COORD')) set.add('LND');
  if (has(u, 'IT_AGENT') || has(u, 'IT_HEAD')) set.add('IT');
  if (has(u, 'ADM_AGENT') || has(u, 'ADM_HEAD')) set.add('ADM');
  if (has(u, 'SF_ADMIN')) set.add('SF');
  for (const h of extraHds) if (HD_ORDER.includes(h as Helpdesk)) set.add(h as Helpdesk);
  return HD_ORDER.filter((h) => set.has(h) && hdAllowed(u, h));
}
export const adminHds = (u: Principal): Helpdesk[] => (has(u, 'HD_ADMIN') ? [...HD_ORDER] : allowedHds(u));
export const isWorker = (u: Principal) => WORK_ROLES.some((r) => has(u, r));
export const isHeadish = (u: Principal) => HEAD_ROLES.some((r) => has(u, r));
export const isApprover = (u: Principal) => APPROVER_ROLES.some((r) => has(u, r));
export const stm = (t: Pick<TicketCtx, 'helpdesk'>) => STM_HDS.includes(t.helpdesk);

export const relOf = (t: TicketCtx, id: string) => t.followers.find((f) => f.userId === id)?.relation;
export const chainOf = (t: TicketCtx) => [...t.approvals].sort((a, b) => a.seq - b.seq);
export const apMgr = (t: TicketCtx) => t.approvals.find((a) => a.step === 'mgr')?.approverId || t.requesterManagerId;

export function canApproveStep(u: Principal, t: TicketCtx, step: string): boolean {
  // A requester with no manager has the manager step routed to a Helpdesk admin (TC).
  if (step === 'mgr') return (has(u, 'MANAGER') || has(u, 'HD_ADMIN')) && apMgr(t) === u.id;
  if (step === 'lnd') return has(u, 'LND_HEAD') || has(u, 'HRLND_ADMIN');
  if (step === 'ith') return has(u, 'IT_HEAD');
  if (step === 'adm') return has(u, 'ADM_HEAD');
  return false;
}

/** The approval step the user can act on now, or null. */
export function approvalStage(u: Principal, t: TicketCtx): string | null {
  if (!t.approvals.length || t.status !== 'Pending approval') return null;
  const cur = chainOf(t).find((a) => a.status !== 'Approved');
  if (!cur || cur.status !== 'Pending') return null;
  return canApproveStep(u, t, cur.step) ? cur.step : null;
}

export function canView(u: Principal, t: TicketCtx): boolean {
  const id = u.id;
  if (!hdAllowed(u, t.helpdesk)) return false;
  if (has(u, 'HD_ADMIN')) return true;
  if (t.requesterId === id || t.assigneeId === id || relOf(t, id)) return true;
  if (t.helpdesk === 'HR' && has(u, 'HRLND_ADMIN')) return true;
  if (t.confidential) return t.category?.leadId === id || (t.helpdesk === 'IT' && has(u, 'IT_HEAD'));
  if (has(u, 'AUDITOR')) return true;
  if (t.approvals.length && chainOf(t).some((a) => (a.step === 'mgr' ? apMgr(t) === id && has(u, 'MANAGER') : canApproveStep(u, t, a.step))))
    return true;
  switch (t.helpdesk) {
    case 'HR': return has(u, 'HR_AGENT') && u.hrCats.has(t.categoryKey);
    case 'LND': return has(u, 'LND_HEAD') || has(u, 'LND_COORD');
    case 'IT': return has(u, 'IT_AGENT') || has(u, 'IT_HEAD');
    case 'ADM': return has(u, 'ADM_AGENT') || has(u, 'ADM_HEAD');
    case 'SF': return has(u, 'SF_ADMIN');
    default: return false;
  }
}

/** Can change status, priority, assignee; post internal notes; escalate; resolve. */
export function canWork(u: Principal, t: TicketCtx): boolean {
  if (!canView(u, t)) return false;
  if (has(u, 'HD_ADMIN')) return true;
  if (has(u, 'AUDITOR')) return false;
  if (t.requesterId === u.id && !(['LND_HEAD', 'SF_ADMIN', 'IT_HEAD', 'ADM_HEAD'] as Role[]).some((r) => has(u, r))) return false;
  switch (t.helpdesk) {
    case 'HR': return has(u, 'HR_AGENT') && (u.hrCats.has(t.categoryKey) || t.assigneeId === u.id);
    case 'LND': return has(u, 'LND_HEAD') || has(u, 'LND_COORD');
    case 'IT':
      if (t.category?.restricted) return has(u, 'IT_HEAD') || t.category.leadId === u.id || t.assigneeId === u.id;
      return has(u, 'IT_AGENT') || has(u, 'IT_HEAD');
    case 'ADM': return has(u, 'ADM_AGENT') || has(u, 'ADM_HEAD');
    case 'SF': return has(u, 'SF_ADMIN');
    default: return false;
  }
}

/** Read-only viewers: HR / L&D admins on HR tickets and auditors, when they have no other relation. */
export function isReadOnly(u: Principal, t: TicketCtx): boolean {
  return canView(u, t) && ((t.helpdesk === 'HR' && has(u, 'HRLND_ADMIN')) || has(u, 'AUDITOR')) && !canWork(u, t) && t.requesterId !== u.id && !relOf(t, u.id) && t.assigneeId !== u.id;
}

/** Who may add followers or CC: anyone with view access, except on confidential tickets (requester or assignee only). */
export const canAddPeople = (u: Principal, t: TicketCtx) => !t.confidential || t.requesterId === u.id || t.assigneeId === u.id;

const AP_LABEL: Record<string, string> = { mgr: 'Manager', lnd: 'L&D', ith: 'IT head', adm: 'Admin head' };

export function whyVisible(u: Principal, t: TicketCtx): [string, string] {
  const id = u.id;
  if (t.requesterId === id) return ['Requester', 'comment, add followers, reopen or cancel where allowed'];
  if (t.assigneeId === id) return ['Assignee', 'change status and priority, reply, escalate, close'];
  const r = relOf(t, id);
  if (r) return [({ FOLLOWER: 'Follower', CC: "CC'd", TAGGED: 'Tagged', CASE_TEAM: 'Case team' } as Record<string, string>)[r] || r, 'read and comment; cannot change status'];
  const st = approvalStage(u, t);
  if (st) return ['Approver', `${AP_LABEL[st].toLowerCase()} approval step`];
  if (has(u, 'HD_ADMIN')) return ['Helpdesk admin', 'master access: work any ticket and configure the helpdesk (audited)'];
  if (t.helpdesk === 'HR' && has(u, 'HRLND_ADMIN') && !(t.confidential && t.category?.leadId === id))
    return ['HR / L&D admin', 'read-only view of HR tickets, including confidential (audited)'];
  if (t.helpdesk === 'LND' && has(u, 'LND_COORD')) return ['L&D coordinator', 'works L&D tickets'];
  if (has(u, 'AUDITOR')) return ['Auditor', 'read-only view for audit; confidential tickets are excluded'];
  if (t.helpdesk === 'IT' && (has(u, 'IT_AGENT') || has(u, 'IT_HEAD')))
    return has(u, 'IT_HEAD') ? ['IT head', 'sees and works all IT tickets; approves admin rights'] : ['IT agent', 'works IT and Support tickets'];
  if (t.helpdesk === 'ADM' && (has(u, 'ADM_AGENT') || has(u, 'ADM_HEAD')))
    return has(u, 'ADM_HEAD') ? ['Admin head', 'sees and works all Admin Desk tickets; approves purchases'] : ['Admin desk agent', 'works Admin Desk tickets'];
  if (t.approvals.length && apMgr(t) === id) return ['Approver', 'manager who decides this request'];
  if (t.confidential && t.category?.leadId === id) return ['Category lead', 'supervise and work confidential tickets in this category'];
  if (t.helpdesk === 'HR') return ['HR agent', 'works tickets in this category'];
  if (t.helpdesk === 'LND' && has(u, 'LND_HEAD')) return ['L&D Head', 'sees and works all L&D tickets'];
  if (t.helpdesk === 'LND' && has(u, 'MANAGER')) return ['Manager', 'sees team course requests for approval'];
  if (t.helpdesk === 'SF') return ['Salesforce case admin', 'sees and works all cases'];
  return ['—', ''];
}

export const reopenDays = (t: Pick<TicketCtx, 'helpdesk'>) => (t.helpdesk === 'LND' ? 14 : t.helpdesk === 'HR' ? 30 : 7);

export function reopenInfo(t: TicketCtx & { closed: boolean; categoryName: string }, nowMs: number): { ok: boolean; short: string; why?: string } {
  if (!t.closed) return { ok: false, short: '' };
  if (t.helpdesk === 'SF') return { ok: false, short: 'Raise a new case', why: 'Salesforce cases reopen by status change in Salesforce. Raise a new case and reference this one.' };
  const days = reopenDays(t);
  const within = !!t.closedAt && nowMs - t.closedAt.getTime() <= days * 86400000;
  const allowed = t.category?.reopenAllowed;
  if (stm(t)) {
    const hdName = { LND: 'L&D', IT: 'IT and Support', ADM: 'Admin Desk' }[t.helpdesk as 'LND' | 'IT' | 'ADM'];
    if (t.status !== 'Resolved') return { ok: false, short: 'Not reopenable', why: `${t.status} ${hdName} tickets cannot be reopened. Raise a new ticket.` };
    if (allowed === false) return { ok: false, short: 'Category disallows', why: `Reopening is disabled for ${t.categoryName}. Raise a new ticket.` };
    return within ? { ok: true, short: '' } : { ok: false, short: 'Window passed', why: `The ${days}-day reopen window has passed (TC).` };
  }
  if (!allowed) return { ok: false, short: 'Category disallows', why: `Reopening is disabled for ${t.categoryName}. Raise a new ticket.` };
  if (t.closeResponse === 'Cancelled') return { ok: false, short: 'Cancelled', why: 'Cancelled tickets cannot be reopened.' };
  return within ? { ok: true, short: '' } : { ok: false, short: 'Window passed', why: 'The 30-day reopen window has passed (TC).' };
}

/** Views offered in the My Tickets scope switch. */
export function viewsFor(u: Principal): [string, string][] {
  const v: [string, string][] = [['mine', 'Raised by me'], ['following', "Following / CC'd"]];
  const add = (k: string, l: string) => {
    if (!v.some((x) => x[0] === k)) v.push([k, l]);
  };
  if (isWorker(u)) add('assigned', 'Assigned to me');
  if (has(u, 'HR_AGENT')) add('queue', 'My categories');
  if (has(u, 'LND_HEAD') || has(u, 'LND_COORD')) add('queue', 'All L&D tickets');
  if (has(u, 'IT_AGENT') || has(u, 'IT_HEAD')) add('queue', 'All IT tickets');
  if (has(u, 'ADM_AGENT') || has(u, 'ADM_HEAD')) add('queue', 'All Admin Desk tickets');
  if (has(u, 'SF_ADMIN')) add('queue', 'All Salesforce cases');
  if (has(u, 'HRLND_ADMIN')) add('hrall', 'HR tickets (read-only)');
  if (has(u, 'HD_ADMIN')) add('all', 'All tickets');
  if (has(u, 'AUDITOR')) add('all', 'All tickets (read-only)');
  if (isHeadish(u) && !has(u, 'HD_ADMIN') && !has(u, 'AUDITOR')) add('org', 'All I can see');
  if (isApprover(u)) add('approvals', 'Pending my approval');
  return v;
}

const HDL: Record<string, string> = { HR: 'HR', LND: 'L&D', IT: 'IT and Support', ADM: 'Admin Desk', SF: 'Salesforce' };

/** "What can this role do?" panel. */
export function permList(u: Principal, hrCatNames: Record<string, string>): { can: string[]; no: string[] } {
  const can: string[] = [];
  const no: string[] = [];
  can.push(`Raise tickets in ${allowedHds(u).map((h) => HDL[h]).join(', ')}`, 'View own tickets, comment and attach files', 'Follow, CC and @tag colleagues', 'Reopen own closed tickets where the category allows');
  if (has(u, 'HR_AGENT'))
    can.push(`Work HR tickets in: ${[...u.hrCats].map((k) => hrCatNames[k] || k).join(', ')}`, 'Change status and priority, reassign, escalate, close with a closing response', 'Post internal notes and use canned responses');
  if (has(u, 'LND_HEAD')) can.push('See and work all L&D tickets', 'Approve course requests (L&D step)', 'Manage L&D categories, SLA and FAQs (admin console)');
  if (has(u, 'SF_ADMIN')) can.push('See and work all Salesforce cases', 'Manage the SF Ops and Senior admin queues (reassign, escalate)', 'Manage Salesforce helpdesk FAQs');
  if (has(u, 'HRLND_ADMIN')) can.push('Approve L&D course requests (L&D step)', 'View every HR ticket read-only, including confidential (audited)');
  if (has(u, 'LND_COORD')) can.push('Work L&D tickets routed to the coordinator');
  if (has(u, 'HD_ADMIN'))
    can.push('Open the Admin console: categories, form fields, SLA and escalation, role mapping', 'See and work every ticket in the helpdesks they can see (audited); Salesforce stays limited to Sales, Presales and Solutions');
  if (has(u, 'MANAGER'))
    can.push("Approve team members' requests at the manager step: course requests, software and access, travel, purchases", 'See team tickets only when added as follower or CC');
  if (has(u, 'IT_AGENT')) can.push('Work IT and Support tickets (confidential security tickets only as category lead)', 'Post internal notes, reassign, escalate, resolve');
  if (has(u, 'IT_HEAD')) can.push('See and work all IT tickets, including confidential security', 'Approve admin-rights access (IT head step)');
  if (has(u, 'ADM_AGENT')) can.push('Work Admin Desk tickets: facilities, seating, travel, transport, ID cards, visitors, courier, pantry');
  if (has(u, 'ADM_HEAD')) can.push('See and work all Admin Desk tickets', 'Approve purchase and vendor requests (Admin head step)');
  if (has(u, 'AUDITOR')) can.push('Read every non-confidential ticket in the helpdesks they can see', 'See helpdesk-wide analytics and History');
  if (!hdAllowed(u, 'SF')) no.push('See the Salesforce helpdesk (Sales, Presales, Solutions only)');
  if (has(u, 'AUDITOR')) no.push('Reply, change status, approve or escalate', 'Open confidential tickets');
  if (!isWorker(u)) no.push('Change status, priority or assignee', 'See internal notes', 'Escalate tickets manually');
  if (!has(u, 'HD_ADMIN') && !has(u, 'HRLND_ADMIN')) no.push('Open confidential HR tickets unless requester, assignee, category lead or an added follower');
  if (has(u, 'HRLND_ADMIN')) no.push('Reply to or change HR tickets they are not assigned to');
  if (has(u, 'HD_ADMIN')) no.push('Approve course requests (that decision stays with the manager and L&D)');
  else no.push('Open the Admin console or change helpdesk configuration');
  return { can, no };
}

/** FAQ editors (Proposal: the artifact shows "Manage FAQs" for these roles). */
export function canEditFaq(u: Principal, hd: string, hrPolicyLeadId: string | null): boolean {
  if (!hdAllowed(u, hd)) return false;
  if (has(u, 'HD_ADMIN')) return true;
  return (hd === 'HR' && u.id === hrPolicyLeadId) || (hd === 'LND' && has(u, 'LND_HEAD')) || (hd === 'SF' && has(u, 'SF_ADMIN')) || (hd === 'IT' && has(u, 'IT_HEAD')) || (hd === 'ADM' && has(u, 'ADM_HEAD'));
}
