import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

/** JSON condition used by the form schema and approval rules (see helpdesk-config/conditions.ts). */
export type Condition =
  | { field: string; op: 'eq' | 'neq' | 'in' | 'notIn' | 'set'; value: string | string[] | boolean }
  | { all: Condition[] }
  | { any: Condition[] };

@Entity('users')
export class UserEntity {
  @PrimaryColumn({ type: 'varchar', length: 32 }) id: string;
  @Column({ type: 'varchar', length: 120 }) name: string;
  @Column({ type: 'varchar', length: 160, nullable: true }) email: string | null;
  @Column({ type: 'varchar', length: 80, nullable: true }) dept: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true }) title: string | null;
  @Column({ type: 'varchar', length: 80, nullable: true }) location: string | null;
  @Column({ name: 'manager_id', type: 'varchar', length: 32, nullable: true }) managerId: string | null;
  @Column({ name: 'is_queue', type: 'boolean', default: false }) isQueue: boolean;
  @Column({ type: 'boolean', default: true }) active: boolean;
}

@Entity('user_roles')
export class UserRoleEntity {
  @PrimaryColumn({ name: 'user_id', type: 'varchar', length: 32 }) userId: string;
  @PrimaryColumn({ type: 'varchar', length: 24 }) role: string;
}

@Entity('user_hr_categories')
export class UserHrCategoryEntity {
  @PrimaryColumn({ name: 'user_id', type: 'varchar', length: 32 }) userId: string;
  @PrimaryColumn({ name: 'category_key', type: 'varchar', length: 24 }) categoryKey: string;
}

@Entity('categories')
@Index('uq_category', ['helpdesk', 'key'], { unique: true })
export class CategoryEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar', length: 8 }) helpdesk: string;
  @Column({ name: 'cat_key', type: 'varchar', length: 24 }) key: string;
  @Column({ type: 'varchar', length: 120 }) name: string;
  @Column({ type: 'json' }) subs: string[];
  @Column({ name: 'default_priority', type: 'varchar', length: 12, nullable: true }) defaultPriority: string | null;
  @Column({ name: 'lead_id', type: 'varchar', length: 32, nullable: true }) leadId: string | null;
  @Column({ name: 'owner_id', type: 'varchar', length: 32, nullable: true }) ownerId: string | null;
  @Column({ name: 'queue_id', type: 'varchar', length: 32, nullable: true }) queueId: string | null;
  @Column({ type: 'boolean', default: false }) confidential: boolean;
  @Column({ type: 'boolean', default: false }) restricted: boolean;
  @Column({ name: 'reopen_allowed', type: 'boolean', nullable: true }) reopenAllowed: boolean | null;
  @Column({ name: 'request_type', type: 'varchar', length: 12, nullable: true }) requestType: string | null;
  @Column({ name: 'needs_record', type: 'boolean', default: false }) needsRecord: boolean;
  @Column({ name: 'needs_impact', type: 'boolean', default: false }) needsImpact: boolean;
  @Column({ name: 'sla_override', type: 'json', nullable: true }) slaOverride: Record<string, [number, number]> | null;
  @Column({ name: 'approval_rule', type: 'json', nullable: true })
  approvalRule: { when: Condition | null; chain: string[] }[] | null;
  @Column({ name: 'mgr_approval', type: 'boolean', default: false }) mgrApproval: boolean;
  /** Sub-categories the manager step applies to; null means every sub-category. */
  @Column({ name: 'mgr_approval_subs', type: 'json', nullable: true }) mgrApprovalSubs: string[] | null;
  @Column({ type: 'boolean', default: true }) active: boolean;
  @Column({ name: 'sort_order', type: 'int', default: 0 }) sortOrder: number;
}

@Entity('form_fields')
export class FormFieldEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar', length: 8 }) helpdesk: string;
  @Column({ name: 'category_key', type: 'varchar', length: 24 }) categoryKey: string;
  @Column({ name: 'field_key', type: 'varchar', length: 40 }) key: string;
  @Column({ type: 'varchar', length: 120 }) label: string;
  @Column({ type: 'varchar', length: 20 }) type: string;
  @Column({ type: 'json', nullable: true }) options: string[] | null;
  @Column({ type: 'varchar', length: 160, nullable: true }) placeholder: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) hint: string | null;
  @Column({ name: 'min_value', type: 'double', nullable: true }) min: number | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) pattern: string | null;
  @Column({ name: 'pattern_flags', type: 'varchar', length: 8, nullable: true }) patternFlags: string | null;
  @Column({ name: 'pattern_message', type: 'varchar', length: 200, nullable: true }) patternMessage: string | null;
  @Column({ name: 'default_value', type: 'varchar', length: 80, nullable: true }) defaultValue: string | null;
  @Column({ name: 'required_rule', type: 'json', nullable: true }) required: boolean | Condition | null;
  @Column({ name: 'show_when', type: 'json', nullable: true }) showWhen: Condition | null;
  @Column({ type: 'json', nullable: true }) validation: { notPast?: boolean; gteField?: string; message: string } | null;
  @Column({ name: 'is_custom', type: 'boolean', default: false }) custom: boolean;
  @Column({ type: 'boolean', default: true }) active: boolean;
  @Column({ name: 'sort_order', type: 'int', default: 0 }) sortOrder: number;
}

@Entity('settings')
export class SettingEntity {
  @PrimaryColumn({ name: 'setting_key', type: 'varchar', length: 64 }) key: string;
  @Column({ type: 'json' }) value: unknown;
}

@Entity('tickets')
export class TicketEntity {
  @PrimaryColumn({ name: 'ticket_key', type: 'varchar', length: 20 }) key: string;
  @Column({ type: 'varchar', length: 8 }) helpdesk: string;
  @Column({ name: 'category_key', type: 'varchar', length: 24 }) categoryKey: string;
  @Column({ name: 'sub_category', type: 'varchar', length: 120 }) subCategory: string;
  @Column({ type: 'varchar', length: 150 }) title: string;
  @Column({ type: 'text' }) description: string;
  @Column({ type: 'varchar', length: 12 }) priority: string;
  @Column({ type: 'varchar', length: 40 }) status: string;
  @Column({ name: 'close_response', type: 'varchar', length: 20, nullable: true }) closeResponse: string | null;
  @Column({ name: 'close_message', type: 'text', nullable: true }) closeMessage: string | null;
  @Column({ name: 'requester_id', type: 'varchar', length: 32 }) requesterId: string;
  @Column({ name: 'assignee_id', type: 'varchar', length: 32 }) assigneeId: string;
  @Column({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @Column({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
  @Column({ name: 'closed_at', type: 'datetime', nullable: true }) closedAt: Date | null;
  @Column({ name: 'closed_by_id', type: 'varchar', length: 32, nullable: true }) closedById: string | null;
  @Column({ name: 'response_due', type: 'datetime' }) responseDue: Date;
  @Column({ name: 'resolution_due', type: 'datetime' }) resolutionDue: Date;
  @Column({ name: 'response_met', type: 'boolean', nullable: true }) responseMet: boolean | null;
  @Column({ type: 'boolean', default: false }) confidential: boolean;
  @Column({ name: 'escalation_level', type: 'int', default: 0 }) escalationLevel: number;
  @Column({ type: 'boolean', default: false }) paused: boolean;
  @Column({ name: 'related_key', type: 'varchar', length: 20, nullable: true }) relatedKey: string | null;
  @Column({ type: 'json' }) fields: Record<string, string>;
  @Column({ name: 'ai_transcript', type: 'text', nullable: true }) aiTranscript: string | null;
  @Column({ name: 'sla_ver', type: 'int', default: 1 }) slaVer: number;
  @Column({ name: 'ladder_base', type: 'int', default: 0 }) ladderBase: number;
  @Column({ name: 'asg_hist', type: 'json', nullable: true }) asgHist: AsgRecord[] | null;
  @Column({ name: 'esc_log', type: 'json', nullable: true }) escLog: EscRecord[] | null;
  /** False while approvals are pending: no SLA clock exists until the last approval. */
  @Column({ name: 'sla_started', type: 'boolean', default: true }) slaStarted: boolean;
  @Column({ name: 'sla_start', type: 'datetime', nullable: true }) slaStart: Date | null;
}

/** One assignment step on a ticket (Fix 1 / Fix 4). `how` distinguishes routing, absence cover, manual, queue claim and escalation. */
export interface AsgRecord {
  u: string;
  at: string;
  how: 'routing' | 'absence' | 'manual' | 'queue-claim' | 'escalation';
  coverFor: string | null;
}
/** One escalation of a ticket (Fix 4). */
export interface EscRecord {
  level: number;
  at: string;
  from: string | null;
  to: string;
  /** 'sla' when a resolution-time threshold triggered it ('auto' in rows written before v0.3). */
  how: 'sla' | 'manual' | 'auto';
  by: string | null;
}

/** Approved / pending leave (Fix 1). Routing treats an approved leave day as unavailable. */
@Entity('absences')
export class AbsenceEntity {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'user_id', type: 'varchar', length: 32 }) userId: string;
  @Column({ name: 'from_date', type: 'date' }) fromDate: string;
  @Column({ name: 'to_date', type: 'date' }) toDate: string;
  @Column({ type: 'varchar', length: 20 }) type: string;
  @Column({ type: 'varchar', length: 12 }) status: string;
}

/** Attendance mark for a day (Fix 1). Absent after the 11:00 IST cut-off makes a person unavailable. */
@Entity('attendance')
export class AttendanceEntity {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'user_id', type: 'varchar', length: 32 }) userId: string;
  @Column({ type: 'date' }) date: string;
  @Column({ type: 'varchar', length: 20 }) status: string;
  @Column({ name: 'marked_at', type: 'datetime', nullable: true }) markedAt: Date | null;
}

/** Immutable SLA policy version (Fix 2). Tickets bind to the version effective when they were raised. */
@Entity('sla_versions')
export class SlaVersionEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'effective_from', type: 'datetime' }) effectiveFrom: Date;
  @Column({ name: 'set_by', type: 'varchar', length: 32, nullable: true }) setBy: string | null;
  @Column({ type: 'json' }) tables: Record<string, Record<string, [number, number]>>;
  @Column({ name: 'category_overrides', type: 'json', nullable: true }) categoryOverrides: Record<string, Record<string, [number, number]>> | null;
  @Column({ name: 'ladder_pct', type: 'json', nullable: true }) ladderPct: Record<string, number[]> | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) note: string | null;
  @Column({ type: 'json', nullable: true }) changes: SlaChange[] | null;
}

/** One cell changed by an SLA version: which value, and its value before and after. */
export interface SlaChange {
  what: string;
  before: number | string | null;
  after: number | string | null;
}

@Entity('ticket_comments')
export class CommentEntity {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'ticket_key', type: 'varchar', length: 20 }) ticketKey: string;
  @Column({ name: 'author_id', type: 'varchar', length: 32 }) authorId: string;
  @Column({ type: 'text' }) body: string;
  @Column({ type: 'boolean', default: false }) internal: boolean;
  @Column({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}

@Entity('ticket_events')
export class EventEntity {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'ticket_key', type: 'varchar', length: 20 }) ticketKey: string;
  @Column({ type: 'datetime' }) at: Date;
  @Column({ type: 'varchar', length: 400 }) text: string;
  @Column({ type: 'varchar', length: 12 }) kind: string;
}

@Entity('ticket_followers')
export class FollowerEntity {
  @PrimaryColumn({ name: 'ticket_key', type: 'varchar', length: 20 }) ticketKey: string;
  @PrimaryColumn({ name: 'user_id', type: 'varchar', length: 32 }) userId: string;
  @Column({ type: 'varchar', length: 12 }) relation: string;
  @Column({ name: 'added_by_id', type: 'varchar', length: 32 }) addedById: string;
}

@Entity('ticket_approvals')
export class ApprovalEntity {
  @PrimaryColumn({ name: 'ticket_key', type: 'varchar', length: 20 }) ticketKey: string;
  @PrimaryColumn({ type: 'varchar', length: 8 }) step: string;
  @Column({ type: 'int' }) seq: number;
  @Column({ type: 'varchar', length: 12 }) status: string;
  @Column({ name: 'approver_id', type: 'varchar', length: 32, nullable: true }) approverId: string | null;
  @Column({ name: 'decided_by_id', type: 'varchar', length: 32, nullable: true }) decidedById: string | null;
  @Column({ name: 'decided_at', type: 'datetime', nullable: true }) decidedAt: Date | null;
}

@Entity('attachments')
export class AttachmentEntity {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'ticket_key', type: 'varchar', length: 20 }) ticketKey: string;
  @Column({ name: 'file_name', type: 'varchar', length: 200 }) fileName: string;
  @Column({ name: 'size_bytes', type: 'int' }) sizeBytes: number;
  @Column({ name: 'mime_type', type: 'varchar', length: 120, nullable: true }) mimeType: string | null;
  @Column({ name: 'storage_path', type: 'varchar', length: 300, nullable: true }) storagePath: string | null;
  @Column({ name: 'uploaded_by_id', type: 'varchar', length: 32 }) uploadedById: string;
  @Column({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}

@Entity('sf_cases')
export class SfCaseEntity {
  @PrimaryColumn({ name: 'ticket_key', type: 'varchar', length: 20 }) ticketKey: string;
  @Column({ name: 'case_no', type: 'varchar', length: 20 }) caseNo: string;
  @Column({ type: 'varchar', length: 80 }) entitlement: string;
  @Column({ type: 'json' }) milestones: [string, string][];
  @Column({ name: 'external_id', type: 'varchar', length: 40, nullable: true }) externalId: string | null;
}

@Entity('sf_case_team')
export class SfCaseTeamEntity {
  @PrimaryColumn({ name: 'ticket_key', type: 'varchar', length: 20 }) ticketKey: string;
  @PrimaryColumn({ name: 'user_id', type: 'varchar', length: 32 }) userId: string;
  @Column({ type: 'varchar', length: 60 }) role: string;
}

@Entity('sf_child_cases')
export class SfChildCaseEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'ticket_key', type: 'varchar', length: 20 }) ticketKey: string;
  @Column({ name: 'case_no', type: 'varchar', length: 20 }) caseNo: string;
  @Column({ type: 'varchar', length: 200 }) title: string;
  @Column({ type: 'varchar', length: 40 }) status: string;
  @Column({ name: 'owner_name', type: 'varchar', length: 120 }) ownerName: string;
}

@Entity('notifications')
export class NotificationEntity {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'user_id', type: 'varchar', length: 32 }) userId: string;
  @Column({ type: 'varchar', length: 300 }) text: string;
  @Column({ name: 'ticket_key', type: 'varchar', length: 20, nullable: true }) ticketKey: string | null;
  @Column({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @Column({ name: 'read_at', type: 'datetime', nullable: true }) readAt: Date | null;
}

@Entity('notification_outbox')
export class OutboxEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar', length: 12 }) channel: string;
  @Column({ type: 'varchar', length: 160 }) recipient: string;
  @Column({ type: 'varchar', length: 200 }) subject: string;
  @Column({ type: 'text' }) body: string;
  @Column({ type: 'varchar', length: 12, default: 'pending' }) status: string;
  @Column({ type: 'int', default: 0 }) attempts: number;
  @Column({ name: 'last_error', type: 'varchar', length: 300, nullable: true }) lastError: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @Column({ name: 'sent_at', type: 'datetime', nullable: true }) sentAt: Date | null;
}

@Entity('faqs')
export class FaqEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar', length: 8 }) helpdesk: string;
  @Column({ name: 'sort_order', type: 'int' }) sortOrder: number;
  @Column({ type: 'text' }) question: string;
  @Column({ type: 'text' }) answer: string;
  @Column({ name: 'category_key', type: 'varchar', length: 24, nullable: true }) categoryKey: string | null;
}

@Entity('faq_votes')
export class FaqVoteEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'faq_id', type: 'int' }) faqId: number;
  @Column({ name: 'user_id', type: 'varchar', length: 32 }) userId: string;
  @Column({ type: 'boolean' }) helpful: boolean;
  @Column({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}

@Entity('audit_log')
export class AuditEntity {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ type: 'datetime' }) at: Date;
  @Column({ name: 'actor_id', type: 'varchar', length: 32, nullable: true }) actorId: string | null;
  @Column({ type: 'varchar', length: 60 }) action: string;
  @Column({ type: 'varchar', length: 120, nullable: true }) target: string | null;
  @Column({ type: 'varchar', length: 12 }) outcome: string;
  @Column({ type: 'varchar', length: 400 }) summary: string;
  @Column({ type: 'json', nullable: true }) detail: Record<string, any> | null;
}

@Entity('ticket_sequences')
export class SequenceEntity {
  @PrimaryColumn({ type: 'varchar', length: 8 }) helpdesk: string;
  @Column({ name: 'next_value', type: 'int' }) nextValue: number;
}

export const ENTITIES = [
  UserEntity, UserRoleEntity, UserHrCategoryEntity, CategoryEntity, FormFieldEntity, SettingEntity, TicketEntity,
  CommentEntity, EventEntity, FollowerEntity, ApprovalEntity, AttachmentEntity, SfCaseEntity, SfCaseTeamEntity,
  SfChildCaseEntity, NotificationEntity, OutboxEntity, FaqEntity, FaqVoteEntity, AuditEntity, SequenceEntity,
  AbsenceEntity, AttendanceEntity, SlaVersionEntity,
];
