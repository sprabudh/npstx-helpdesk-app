export type Hd = 'HR' | 'LND' | 'IT' | 'ADM' | 'SF';
export interface PersonRef { id: string; name: string; isQueue: boolean; dept: string | null; title: string | null }
export interface Sla { cls: 'ok' | 'soon' | 'over' | 'pause'; txt: string; due: string; usedPct?: number }
export interface ListItem {
  key: string; helpdesk: Hd; title: string; categoryKey: string; categoryName: string; subCategory: string; priority: string; status: string;
  uiStatus: string; pill: { cls: string; label: string }; closed: boolean; closeResponse: string | null; requester: PersonRef; assignee: PersonRef;
  closedBy: PersonRef | null; createdAt: string; updatedAt: string; closedAt: string | null; sla: Sla; confidential: boolean; escalationLevel: number;
  reopen: { ok: boolean; short: string }; relation: { relation: string; addedBy: string } | null; fields: { learningItem: string | null; learningSource: string | null };
}
export interface ListResponse {
  view: string; tab: 'open' | 'closed'; sort: string; dir: 'asc' | 'desc'; page: number; pages: number; size: number; total: number;
  counts: { open: number; closed: number }; rows: ListItem[];
  options: { views: [string, string][]; categories: [string, string][]; statuses: string[] }; flagLabel: string | null;
}
export interface Me {
  id: string; name: string; dept: string | null; title: string | null; location: string | null; managerId: string | null; managerName: string | null;
  roles: string[]; hrCategories: string[]; helpdesks: Hd[];
  flags: { worker: boolean; headish: boolean; approver: boolean; helpdeskAdmin: boolean; auditor: boolean };
  views: [string, string][]; permissions: { can: string[]; no: string[] };
  counts: { followCount: number; waiting: number; assignedOpen: number; unassignedInQueues: number; myOpen: number; myClosed: number; notifications: number };
  now: string; demo: { enabled: boolean; clockStart: string | null }; outOfOffice: boolean;
}
export type Condition = { field: string; op: 'eq' | 'neq' | 'in' | 'notIn' | 'set'; value: any } | { all: Condition[] } | { any: Condition[] };
export interface Category {
  id?: number; openCount?: number; helpdesk: Hd; key: string; name: string; subs: string[]; defaultPriority: string | null; leadId: string | null; leadName: string; ownerId: string | null; ownerName: string | null;
  queueId: string | null; queueName: string | null; confidential: boolean; restricted: boolean; reopenAllowed: boolean | null; requestType: string | null;
  needsRecord: boolean; needsImpact: boolean; slaOverride: Record<string, [number, number]> | null; approvalRule: { when: Condition | null; chain: string[] }[] | null; active: boolean;
}
export interface FormField {
  id: number; helpdesk: Hd; categoryKey: string; key: string; label: string; type: string; options: string[] | null; placeholder: string | null; hint: string | null;
  min: number | null; pattern: string | null; patternFlags: string | null; patternMessage: string | null; defaultValue: string | null;
  required: boolean | Condition | null; showWhen: Condition | null; validation: { notPast?: boolean; gteField?: string; message: string } | null; custom: boolean; active: boolean; sortOrder: number;
}
export interface StatusModel { open: string[]; closed: string[]; tr: Record<string, string[]>; closing: string[]; work: string; wait: string }
export interface AiStatus { enabled: boolean; provider: string; mode: 'off' | 'rules' | 'model'; model: string | null; reason: string | null }
export interface Config {
  helpdesks: { key: Hd; label: string }[]; categories: Category[]; formFields: FormField[]; statuses: Record<string, StatusModel>; uiMap: Record<string, Record<string, string>>;
  priorities: Record<string, string[]>; sla: { shared: Record<string, [number, number]>; IT: Record<string, [number, number]>; ADM: Record<string, [number, number]> };
  escalation: Record<string, { who: string; role: string; pct: number }[]>; rules: Record<string, boolean>; ruleLabels: Record<string, string>; canned: [string, string][];
  closing: Record<string, string>; fieldLabels: Record<string, string>; locations: string[]; buildings: string[]; learningSources: string[]; coreFields: Record<string, string[]>;
  fieldTypes: Record<string, string>; approvalSteps: Record<string, { l: string }>; roleLabels: Record<string, string>; leadHelpdesks: string[]; assignableRoles: string[];
  aiSamples: { hd: Hd; l: string; t: string; i: number }[]; redirect: Record<string, string>; fileRules: { maxFiles: number; maxBytes: number; pattern: string };
  managers: { id: string; name: string }[]; displayTimeZone: string; demoMode: boolean; ai: AiStatus;
}
export interface Detail extends Omit<ListItem, 'fields'> {
  description: string; fields: { key: string; label: string; value: string }[]; responseDue: string; resolutionDue: string; responseMet: boolean | null; paused: boolean;
  closeMessage: string | null; aiTranscript: string | null; requesterDept: string | null;
  category: { key: string; name: string; leadId: string | null; leadName: string; restricted: boolean };
  files: { id: number; name: string; sizeBytes: number; downloadable: boolean }[];
  followers: { userId: string; name: string; relation: string; addedById: string }[];
  comments: { id: number; authorId: string; authorName: string; body: string; internal: boolean; createdAt: string }[];
  events: { at: string; text: string; kind: string }[]; related: { key: string; helpdesk: Hd; canView: boolean }[];
  approval: null | { what: string; steps: { step: string; label: string; who: string; skipped: boolean; status: string; decidedAt: string | null; current: boolean }[]; myStage: string | null; waitingFor: string | null };
  sf: null | { caseNo: string; entitlement: string; milestones: [string, string][]; escalated: boolean; team: { name: string; role: string }[]; children: { caseNo: string; title: string; status: string; owner: string }[] };
  ladder: { who: string; whoName: string; role: string; pct: number; th: string }[]; ladderBase: number; sla: Sla & { usedPct: number };
  me: {
    role: string; roleTxt: string; canWork: boolean; isRequester: boolean; relation: string | null; readOnly: boolean; canAddPeople: boolean; canInternal: boolean;
    approvalStage: string | null; isHelpdeskAdmin: boolean; transitions: { status: string; ui: string }[]; closing: string[]; priorities: string[]; canEscalate: boolean;
    canCancel: boolean; canConfirm: boolean; reopen: { ok: boolean; short: string; why?: string }; canFollow: boolean; canComment: boolean; reopenDays: number; stm: boolean;
    waiting: boolean; agents: { id: string; name: string; title: string | null }[];
  };
}
export type Part = { t: 'text' | 'b' | 'ticket' | 'br' | 'tc'; v?: string };
export interface AskResult {
  q: string; tickets: ListItem[]; total: number; faqs: { id: number; helpdesk: Hd; question: string; categoryKey: string | null }[];
  answer: null | { parts: Part[]; sources: ({ type: 'ticket'; key: string } | { type: 'faq'; id: number; helpdesk: Hd; label: string } | { type: 'policy'; label: string })[]; mode: string };
}
export interface Faq { id: number; helpdesk: Hd; sortOrder: number; question: string; answer: string; categoryKey: string | null }
export interface Notification { id: number; userId: string; text: string; ticketKey: string | null; createdAt: string; readAt: string | null }
export interface Card { k: string; l: string; n: number | string; h: string; ic: string; cls?: string; tone?: string; f: string; go?: Record<string, string>; route?: string }
export interface Analytics {
  scope: string; scopes: [string, string][]; hd: string; range: string; rangeLabel: string; openCount: number; note: string; cards: Card[];
  charts: { byHd: { label: string; n: number; color: string; v: string }[]; byPri: { label: string; n: number; v: string }[]; topCats: { label: string; n: number; v: string }[]; series: { d: string; n: number }[]; ageing: { label: string; n: number }[] };
  updates: Notification[];
}
export interface Draft { hd: Hd; cat: string; f: Record<string, string>; cc: string[]; mgr: boolean; unsure: string[] }

/** Fix 2: one immutable SLA policy version. Tickets bind to the version effective when they were raised. */
export interface SlaVersion {
  id: number; effectiveFrom: string; setBy: string | null; setByName: string; note: string | null;
  tables: { shared: Record<string, [number, number]>; IT: Record<string, [number, number]>; ADM: Record<string, [number, number]> };
  ladderPct: Record<string, number[]> | null; openOnVersion: number;
}
/** Fix 4: one assignee's row in the Assignee performance report. */
export interface PerfRow {
  userId: string; name: string; title: string | null; helpdesk: Hd;
  handled: number; withinSla: number; withinAfterManual: number; resolvedLate: number; responseBreached: number; resolutionBreached: number;
  escalatedAuto: number; escalatedManual: number; coveredForAbsence: number; receivedViaEscalation: number;
  open: number; overdue: number; atRisk: number; reopened: number;
  avgFirstMs: number | null; avgResolutionMs: number | null; compliancePct: number | null; keys: string[];
}
export interface Performance {
  scope: string; scopes: [string, string][]; range: string; rangeLabel: string; helpdesks: Hd[];
  cards: { l: string; n: number | string; h: string; ic: string; tone?: string }[];
  rows: PerfRow[]; unassigned: { handled: number; open: number; overdue: number; atRisk: number; keys: string[] };
  unattended: { key: string; title: string; helpdesk: Hd; assignee: string; status: string; priority: string; createdAt: string }[];
  reconciliation: { handled: number; unassigned: number; total: number };
  chart: { label: string; n: number; v: string }[];
}
