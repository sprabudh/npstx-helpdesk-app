/**
 * The single source of truth for helpdesk notifications (Steps 1 & 2).
 *
 * Every ticket action emits one of these event types through `TicketEventEmitter.emitTicketEvent`.
 * Delivery is behind the `NotificationGateway` port so the notification module can be replaced
 * without touching helpdesk code (Step 6).
 *
 * NOTE (TC): the NOTIFICATION_MATRIX and NOTIFICATION_CATALOGUE were not supplied with the task.
 * This catalogue is derived from the existing code, SDD v1.0 §5.10 and the Step 0 gap audit. Event
 * names follow the `TICKET_*` / `*_ADDED` convention; copy that already shipped is preserved verbatim.
 * Anything marked `recommended: true` is an event the matrix needs but the (absent) catalogue lacks.
 */

export type EventCategory = 'NOTIFICATION' | 'REMINDER';
export type Channel = 'in-app' | 'email';
export type ChannelSet = 'in-app' | 'in-app+email';

export type EventType =
  // ---- 25 notification events ----
  | 'TICKET_CREATED_DIRECT'
  | 'TICKET_CREATED_QUEUE'
  | 'TICKET_CC_ADDED'
  | 'FOLLOWER_ADDED'
  | 'FOLLOWER_REMOVED'
  | 'TICKET_TAGGED'
  | 'TICKET_STATUS_CHANGED'
  | 'TICKET_PRIORITY_CHANGED'
  | 'TICKET_REASSIGNED'
  | 'TICKET_ESCALATED'
  | 'TICKET_QUEUE_CLAIMED'
  | 'TICKET_CLOSED'
  | 'TICKET_REOPENED'
  | 'TICKET_CANCELLED'
  | 'APPROVAL_NEEDED'
  | 'APPROVAL_PENDING'
  | 'APPROVAL_REJECTED'
  | 'APPROVAL_APPROVED'
  | 'INTERNAL_NOTE_ADDED'
  | 'PUBLIC_REPLY_ADDED'
  | 'ATTACHMENT_ADDED'
  | 'SLA_RESPONSE_BREACHED'
  | 'SLA_RESOLUTION_BREACHED'
  | 'UNATTENDED_NO_COVER'
  | 'TICKET_AUTO_CLOSED'
  // ---- 4 reminder events ----
  | 'SLA_AT_RISK'
  | 'APPROVAL_STUCK'
  | 'WAITING_FOR_EMPLOYEE'
  | 'UNATTENDED_REMINDER';

/**
 * How the emitter resolves recipients. Kept as data so the rule is documented next to the event.
 * The emitter switches on this value; it is the only place recipient policy lives.
 */
export type RecipientRule =
  | 'assignee' // the current/new assignee
  | 'queue-members' // every active member of the assigned queue
  | 'requester' // the requester
  | 'requester+followers'
  | 'requester+assignee+followers'
  | 'reassign' // new assignee + old assignee + requester + followers
  | 'escalation' // new owner + old assignee + requester + followers (+ HD admins at L2/L3)
  | 'approver-current' // the approver(s) who must decide now
  | 'approver-next' // the approver(s) of the next step
  | 'approval-reject' // requester + pre-assigned agent + followers
  | 'hd-admins' // every Helpdesk admin
  | 'category-lead' // the category lead
  | 'target' // the single person in context.targetUserId (CC / follower / tag / removal)
  | 'internal-staff' // current assignee (if not the author) + @mentioned staff
  | 'reopen' // assignee (or absence cover) + category lead
  | 'cancel' // assignee + pending approver + followers
  | 'auto-closed' // requester + assignee + followers
  | 'reminder-sla' // assignee (+ category lead for breaches)
  | 'reminder-approval' // current approver(s)
  | 'reminder-waiting' // assignee (+ category lead)
  | 'reminder-unattended'; // HD admins

/** Variables available to every template. Missing values are simply unused. */
export interface TemplateVars {
  key: string;
  actorName?: string;
  requesterName?: string;
  /** Cover suffix for absence reassignment, e.g. " (covering for Priya Rao)". */
  cover?: string;
  /** The person added / tagged / removed. */
  targetName?: string;
  status?: string;
  /** Lower-cased status for the Resolve/Reject/Closed wording. */
  statusLower?: string;
  /** Closing response, e.g. "Resolved" — combined with "closed · ". */
  closeResp?: string;
  priority?: string;
  /** Approval step label, e.g. "Manager". */
  label?: string;
  /** Next approval step label. */
  nextLabel?: string;
  /** Escalation level number (absolute, includes ladder base). */
  level?: number;
  /** Human date for a due target. */
  dueText?: string;
  /** Reminder threshold label, e.g. "24 hours". */
  threshold?: string;
  /** Which audience the escalation text is for. */
  variant?: 'agent' | 'requester';
}

export interface EventDef {
  type: EventType;
  category: EventCategory;
  /** Delivery channels (Step 2). */
  channels: Channel[];
  recipient: RecipientRule;
  /** True for the two events the matrix needs but the catalogue lacks. */
  recommended?: boolean;
  /** One-line description for the catalogue document. */
  summary: string;
  template: (v: TemplateVars) => string;
}

const cover = (v: TemplateVars) => v.cover ?? '';
const req = (v: TemplateVars) => v.requesterName ?? 'the requester';

/** The catalogue. The event name (key) is authoritative; copy here is the fixed template. */
export const EVENT_CATALOGUE: Record<EventType, EventDef> = {
  TICKET_CREATED_DIRECT: {
    type: 'TICKET_CREATED_DIRECT', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'assignee',
    summary: 'New ticket routed directly to a person.',
    template: (v) => `New ticket ${v.key} assigned to you${cover(v)}`,
  },
  TICKET_CREATED_QUEUE: {
    type: 'TICKET_CREATED_QUEUE', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'queue-members',
    summary: 'New ticket placed in a queue; every active member is notified.',
    template: (v) => `New ticket ${v.key} is in your queue`,
  },
  TICKET_CC_ADDED: {
    type: 'TICKET_CC_ADDED', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'target',
    summary: 'Someone was CC\'d on a ticket.',
    template: (v) => `You were CC'd on ${v.key}`,
  },
  FOLLOWER_ADDED: {
    type: 'FOLLOWER_ADDED', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'target',
    summary: 'Someone was added as a follower.',
    template: (v) => `You were added as a follower on ${v.key}`,
  },
  FOLLOWER_REMOVED: {
    type: 'FOLLOWER_REMOVED', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'target',
    summary: 'Someone was removed from a ticket.',
    template: (v) => `You were removed from ${v.key}`,
  },
  TICKET_TAGGED: {
    type: 'TICKET_TAGGED', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'target',
    summary: 'Someone was @mentioned in a reply.',
    template: (v) => `${v.actorName} tagged you on ${v.key}`,
  },
  TICKET_STATUS_CHANGED: {
    type: 'TICKET_STATUS_CHANGED', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'requester+followers',
    summary: 'The status changed.',
    template: (v) => `${v.actorName} changed ${v.key} to ${v.status}`,
  },
  TICKET_PRIORITY_CHANGED: {
    type: 'TICKET_PRIORITY_CHANGED', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'requester', recommended: true,
    summary: 'The priority changed (matrix event the catalogue lacks).',
    template: (v) => `Priority of ${v.key} changed to ${v.priority}`,
  },
  TICKET_REASSIGNED: {
    type: 'TICKET_REASSIGNED', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'assignee',
    summary: 'A ticket was reassigned to a new owner.',
    template: (v) => `${v.key} assigned to you`,
  },
  TICKET_ESCALATED: {
    type: 'TICKET_ESCALATED', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'escalation',
    summary: 'A ticket was escalated (manual or automatic).',
    template: (v) => (v.variant === 'requester' ? `${v.key} was escalated to Level ${v.level}` : `${v.key} escalated to Level ${v.level}`),
  },
  TICKET_QUEUE_CLAIMED: {
    type: 'TICKET_QUEUE_CLAIMED', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'requester',
    summary: 'A queue ticket was claimed by an agent; the requester is told.',
    template: (v) => `Your ticket ${v.key} was picked up by ${v.actorName}`,
  },
  TICKET_CLOSED: {
    type: 'TICKET_CLOSED', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'requester+followers',
    summary: 'A ticket was closed, resolved or rejected with a closing response.',
    template: (v) => `${v.key} ${v.closeResp ?? v.statusLower ?? 'closed'}`,
  },
  TICKET_REOPENED: {
    type: 'TICKET_REOPENED', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'reopen',
    summary: 'A closed ticket was reopened by the requester.',
    template: (v) => `${v.key} was reopened by ${v.actorName}`,
  },
  TICKET_CANCELLED: {
    type: 'TICKET_CANCELLED', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'cancel',
    summary: 'The requester cancelled a ticket.',
    template: (v) => `${v.key} was cancelled by the requester`,
  },
  APPROVAL_NEEDED: {
    type: 'APPROVAL_NEEDED', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'approver-current',
    summary: 'A ticket is waiting for approval.',
    template: (v) => `Approval needed: ${v.key} from ${req(v)}`,
  },
  APPROVAL_PENDING: {
    type: 'APPROVAL_PENDING', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'requester',
    summary: 'An intermediate approval step passed; the next approver has it.',
    template: (v) => `${v.key}: ${String(v.label ?? '').toLowerCase()} approved, now with ${v.nextLabel}`,
  },
  APPROVAL_REJECTED: {
    type: 'APPROVAL_REJECTED', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'approval-reject',
    summary: 'An approval was rejected.',
    template: (v) => `${v.key} was rejected at the ${(v.label ?? '').toLowerCase()} step`,
  },
  APPROVAL_APPROVED: {
    type: 'APPROVAL_APPROVED', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'requester+assignee+followers',
    summary: 'The last approval was given; work has started (SLA started).',
    template: (v) => `${v.key} approved; work has started${cover(v)}`,
  },
  INTERNAL_NOTE_ADDED: {
    type: 'INTERNAL_NOTE_ADDED', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'internal-staff',
    summary: 'An internal note was added (staff only, never the requester).',
    template: (v) => `Internal note on ${v.key}`,
  },
  PUBLIC_REPLY_ADDED: {
    type: 'PUBLIC_REPLY_ADDED', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'requester+assignee+followers',
    summary: 'A public reply was added.',
    template: (v) => `${v.actorName} replied on ${v.key}`,
  },
  ATTACHMENT_ADDED: {
    type: 'ATTACHMENT_ADDED', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'requester+assignee+followers',
    summary: 'A file was attached.',
    template: (v) => `${v.actorName} attached a file to ${v.key}`,
  },
  SLA_RESPONSE_BREACHED: {
    type: 'SLA_RESPONSE_BREACHED', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'category-lead',
    summary: 'The first-response target was missed; the category lead is notified.',
    template: (v) => `${v.key} missed its first-response target`,
  },
  SLA_RESOLUTION_BREACHED: {
    type: 'SLA_RESOLUTION_BREACHED', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'requester+assignee+followers',
    summary: 'The resolution target was missed.',
    template: (v) => `${v.key} missed its resolution target`,
  },
  UNATTENDED_NO_COVER: {
    type: 'UNATTENDED_NO_COVER', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'hd-admins',
    summary: 'No absence cover was available; Helpdesk admins are alerted.',
    template: (v) => `Unattended: ${v.key} has no available cover`,
  },
  TICKET_AUTO_CLOSED: {
    type: 'TICKET_AUTO_CLOSED', category: 'NOTIFICATION', channels: ['in-app', 'email'], recipient: 'auto-closed', recommended: true,
    summary: 'A ticket was closed automatically after inactivity (matrix event the catalogue lacks).',
    template: (v) => `${v.key} was closed automatically after inactivity`,
  },

  // ---- reminders ----
  SLA_AT_RISK: {
    type: 'SLA_AT_RISK', category: 'REMINDER', channels: ['in-app', 'email'], recipient: 'reminder-sla',
    summary: 'Resolution target at risk: 75% of the window elapsed, or due within 2 hours.',
    template: (v) => (v.threshold === '75%' ? `${v.key} is at risk of missing its target (due ${v.dueText})` : `${v.key} is due ${v.dueText}`),
  },
  APPROVAL_STUCK: {
    type: 'APPROVAL_STUCK', category: 'REMINDER', channels: ['in-app', 'email'], recipient: 'reminder-approval',
    summary: 'An approval has been pending over 24 hours (and again at 48 hours).',
    template: (v) => `${v.key} has been waiting for approval for ${v.threshold}`,
  },
  WAITING_FOR_EMPLOYEE: {
    type: 'WAITING_FOR_EMPLOYEE', category: 'REMINDER', channels: ['in-app', 'email'], recipient: 'reminder-waiting',
    summary: 'A ticket has been waiting for the employee over 48 hours.',
    template: (v) => `${v.key} has been waiting for the requester for 48 hours`,
  },
  UNATTENDED_REMINDER: {
    type: 'UNATTENDED_REMINDER', category: 'REMINDER', channels: ['in-app', 'email'], recipient: 'reminder-unattended',
    summary: 'An unattended ticket still has no cover after 4 hours.',
    template: (v) => `Unattended: ${v.key} still has no cover after 4 hours`,
  },
};

export const EVENT_TYPES = Object.keys(EVENT_CATALOGUE) as EventType[];
export const NOTIFICATION_EVENTS = EVENT_TYPES.filter((t) => EVENT_CATALOGUE[t].category === 'NOTIFICATION');
export const REMINDER_EVENTS = EVENT_TYPES.filter((t) => EVENT_CATALOGUE[t].category === 'REMINDER');
export const RECOMMENDED_EVENTS = EVENT_TYPES.filter((t) => EVENT_CATALOGUE[t].recommended);

export const channelSet = (def: EventDef): ChannelSet => (def.channels.includes('email') ? 'in-app+email' : 'in-app');

/** Confidential override (matrix rule, wins over every template): text and email carry the id only. */
export const confidentialText = (key: string) => `Update on ${key} (confidential)`;
