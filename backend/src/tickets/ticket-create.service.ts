import { Injectable } from '@nestjs/common';
import { mkdirSync, writeFileSync } from 'fs';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { clock, fdt, istDate } from '../common/clock';
import { env } from '../common/env';
import { badRequest, forbidden } from '../common/errors';
import { AsgRecord, ApprovalEntity, AttachmentEntity, CategoryEntity, EventEntity, FollowerEntity, SequenceEntity, TicketEntity, UserEntity } from '../database/entities';
import { allowedHds, hdAllowed } from '../domain/policy';
import { evalCond } from '../domain/sla';
import { Helpdesk, Principal } from '../domain/types';
import { AuditService } from '../audit/audit.service';
import { HelpdeskConfigService } from '../helpdesk-config/config.service';
import { TicketEventEmitter, TicketRef } from '../notifications/event-emitter.service';
import { ProvidersRegistry } from '../providers/providers.registry';
import { CoverService } from './cover.service';
import { TicketLoader } from './ticket-loader.service';
import { TicketQueryService } from './ticket-query.service';

export interface CreateTicketInput {
  helpdesk: Helpdesk;
  fields: Record<string, string>;
  cc?: string[];
  mgrCc?: boolean;
  related?: string | null;
  aiTranscript?: string | null;
}
export interface UploadedFileLike {
  originalname: string;
  size: number;
  mimetype: string;
  buffer: Buffer;
}

/** Files: up to 5 per ticket, 10 MB each, these types (same as the artifact). */
export const FILE_RULES = { maxFiles: 5, maxBytes: 10 * 1024 * 1024, allowed: /\.(pdf|png|jpe?g|gif|docx?|xlsx?|pptx?|txt|csv)$/i };
const HD_FIELD_KEYS: Record<string, string[]> = {
  HR: ['payMonth', 'datesAffected', 'claimId', 'location'],
  LND: ['learningSource', 'learningItem', 'sessionAt', 'justification', 'problem', 'device'],
  SF: ['account', 'oppId', 'record', 'impact'],
};
const LND_SOURCE_CATS = ['CONTENT', 'CERT', 'SESSION', 'ACCESS', 'ENROL'];
const URGENCY_PRI: Record<string, string> = { 'Can wait': 'Low', Today: 'Medium', 'Immediately (safety risk)': 'High' };

export function checkFiles(files: UploadedFileLike[], already = 0) {
  if (files.length + already > FILE_RULES.maxFiles) throw badRequest(`Maximum ${FILE_RULES.maxFiles} files per ticket`, 'FILE_LIMIT');
  for (const f of files) {
    if (f.size > FILE_RULES.maxBytes) throw badRequest(`${f.originalname} is over 10 MB`, 'FILE_TOO_LARGE');
    if (!FILE_RULES.allowed.test(f.originalname)) throw badRequest(`${f.originalname}: file type not allowed`, 'FILE_TYPE');
  }
}
export function storeFile(key: string, f: UploadedFileLike): string {
  const dir = join(env.uploadDir, key);
  mkdirSync(dir, { recursive: true });
  const name = `${randomUUID()}${extname(f.originalname).toLowerCase()}`;
  writeFileSync(join(dir, name), f.buffer);
  return join(key, name);
}

@Injectable()
export class TicketCreateService {
  constructor(
    private readonly loader: TicketLoader,
    private readonly query: TicketQueryService,
    private readonly cfg: HelpdeskConfigService,
    private readonly events: TicketEventEmitter,
    private readonly providers: ProvidersRegistry,
    private readonly audit: AuditService,
    private readonly cover: CoverService,
  ) {}

  /**
   * Priority is not chosen in the raise form; it is set internally: the category default (HR, IT,
   * Admin Desk, Salesforce), the Facilities urgency mapping, the L&D session-date rule, and AI voice
   * analysis, which may only raise it for urgent speech.
   */
  private priorityFor(hd: Helpdesk, c: CategoryEntity, f: Record<string, string>, ai: boolean): string {
    const order = ['Low', 'Medium', 'High', 'Critical'];
    const base = hd === 'LND' ? this.lndPriority(f) : hd === 'ADM' && f.urgency ? URGENCY_PRI[f.urgency] ?? c.defaultPriority ?? 'Medium' : c.defaultPriority || 'Medium';
    const voice = ai && hd !== 'HR' && f.pri && this.cfg.priorities(hd).includes(f.pri) ? f.pri : null;
    return voice && order.indexOf(voice) > order.indexOf(base) ? voice : base;
  }
  private lndPriority(f: Record<string, string>): string {
    const raw = f.sessionAt;
    if (!raw) return 'Medium';
    const at = Date.parse(String(raw).length === 16 ? `${raw}:00+05:30` : String(raw));
    if (Number.isNaN(at)) return 'Medium';
    const diff = at - clock.nowMs();
    if (istDate(new Date(at)) === istDate(clock.now())) return 'Critical';
    return diff >= 0 && diff < 2 * 86400000 ? 'High' : 'Medium';
  }

  /** Server-side validation, same rules and messages as the raise form. Returns field → message. */
  validate(u: Principal, input: CreateTicketInput): Record<string, string> {
    const hd = input.helpdesk;
    const f = input.fields || {};
    const err: Record<string, string> = {};
    const req = (k: string, m = 'This field is required.') => {
      if (!String(f[k] ?? '').trim()) err[k] = m;
    };
    req('cat', 'Choose a category.');
    req('sub', 'Choose a sub-category.');
    req('title', 'Add a short title.');
    req('desc', 'Describe the issue.');
    const c = f.cat ? this.cfg.category(hd, f.cat) : null;
    if (f.cat && (!c || !c.active)) err.cat = 'Choose a category.';
    if (c && f.sub && !c.subs.includes(f.sub)) err.sub = 'Choose a sub-category.';
    if ((f.title ?? '').length > 150) err.title = 'Keep the title to 150 characters.';
    if (hd === 'HR') req('location');
    if (hd === 'LND') {
      if (!f.reqType) err.reqType = 'Choose a request type.';
      if (f.reqType === 'course') {
        req('learningSource');
        req('learningItem');
        req('justification', 'Explain why you need this course.');
      } else if (f.cat) {
        req('problem', 'Describe the page, error and steps.');
        if (LND_SOURCE_CATS.includes(f.cat)) req('learningSource');
        if (f.cat === 'SESSION') req('sessionAt', 'Add the session date and time.');
      }
    }
    if (hd === 'SF') {
      if (c?.needsRecord) req('record', 'Add the record link or ID.');
      if (c?.needsImpact) req('impact', 'Describe the business need and impact.');
      if (f.oppId && !/^006[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$/.test(f.oppId.trim())) err.oppId = 'Opportunity IDs start with 006 and have 15 or 18 characters.';
    }
    if (c) {
      const today = istDate(clock.now());
      for (const x of this.cfg.formFields(hd, c.key)) {
        if (x.custom) {
          if (x.required === true) req(x.key);
          continue;
        }
        if (x.showWhen && !evalCond(x.showWhen, f)) continue;
        const v = String(f[x.key] ?? '').trim();
        if (!v) {
          if (evalCond(x.required, f)) err[x.key] = 'This field is required.';
          continue;
        }
        if (x.pattern && !new RegExp(x.pattern, x.patternFlags ?? '').test(v)) err[x.key] = x.patternMessage ?? 'Check the format.';
        else if (x.min !== null && Number(v) < x.min) err[x.key] = `Enter ${x.min} or more.`;
        else if (x.validation?.notPast && v < today) err[x.key] = x.validation.message;
        else if (x.validation?.gteField && f[x.validation.gteField] && v < f[x.validation.gteField]) err[x.key] = x.validation.message;
        else if (x.type === 'select' && x.options && !x.options.includes(v)) err[x.key] = 'Pick one of the options.';
      }
    }
    return err;
  }

  async create(u: Principal, input: CreateTicketInput, files: UploadedFileLike[] = []) {
    const hd = input.helpdesk;
    if (!allowedHds(u).includes(hd)) {
      await this.audit.record(u.id, 'ticket.create', `Denied raise in ${hd}`, { outcome: 'denied', detail: { helpdesk: hd } });
      throw forbidden(hd === 'SF' ? 'The Salesforce helpdesk is available only to Sales, Presales and Solutions.' : 'You cannot raise tickets in this helpdesk.', hd === 'SF' ? 'SALESFORCE_FORBIDDEN' : 'FORBIDDEN');
    }
    const err = this.validate(u, input);
    if (Object.keys(err).length) throw badRequest(`Fix ${Object.keys(err).length} field${Object.keys(err).length > 1 ? 's' : ''} to submit`, 'VALIDATION', { fieldErrors: err });
    checkFiles(files);
    const f = input.fields;
    const c = this.cfg.category(hd, f.cat)!;
    const pri = this.priorityFor(hd, c, f, !!input.aiTranscript?.trim());
    const now = clock.now();
    const slaVer = this.cfg.currentVersionId();
    const [rh, sh] = this.cfg.slaFor(hd, c.key, pri, slaVer);
    const course = hd === 'LND' && f.reqType === 'course';
    const chain = this.cfg.approvalChain(hd, c.key, f);
    // The absence check runs when the ticket becomes workable: now, or at the last approval.
    const base = hd === 'SF' ? c.ownerId! : c.queueId || c.leadId || c.ownerId!;
    const route = chain ? { asg: base, ladderBase: 0, coverFor: null, unattended: false, event: null } : await this.cover.cover(hd, c, base, now, slaVer);
    const asg = route.asg;
    const asgHist: AsgRecord[] = [{ u: asg, at: now.toISOString(), how: route.coverFor ? 'absence' : 'routing', coverFor: route.coverFor }];
    const steps = this.cfg.setting<Record<string, { l: string }>>('approvalSteps');

    // fields kept on the ticket
    const fields: Record<string, string> = {};
    const custom = this.cfg.formFields(hd, c.key).filter((x) => x.custom);
    if (['IT', 'ADM'].includes(hd)) {
      for (const x of this.cfg.formFields(hd, c.key).filter((x) => !x.custom && (!x.showWhen || evalCond(x.showWhen, f)))) {
        const v = f[x.key];
        if (v) fields[x.key] = x.type === 'person' ? this.cfg.name(v) : x.type === 'datetime-local' ? String(v).replace('T', ' ') : String(v);
      }
    } else {
      for (const k of HD_FIELD_KEYS[hd] ?? []) if (f[k]) fields[k] = k === 'sessionAt' ? String(f[k]).replace('T', ' ') : String(f[k]);
      if (hd === 'LND') fields.requestType = course ? 'Course request' : 'Portal problem';
    }
    for (const x of custom) if (f[x.key]) fields[x.key] = String(f[x.key]);

    // followers: CC list (only people who can use this helpdesk) and HR manager CC
    const ccIds = [...new Set(input.cc ?? [])].filter((id) => {
      const p = this.cfg.person(id);
      return p && !p.isQueue && id !== u.id && hdAllowed(p, hd);
    });
    const followers = ccIds.map((id) => ({ userId: id, relation: 'CC', addedById: u.id }));
    if (hd === 'HR' && input.mgrCc && u.managerId && !ccIds.includes(u.managerId)) followers.unshift({ userId: u.managerId, relation: 'CC', addedById: u.id });

    let related: string | null = null;
    if (input.related) {
      const rel = await this.loader.ds.getRepository(TicketEntity).findOne({ where: { key: input.related } });
      if (rel && rel.requesterId === u.id) related = rel.key;
    }
    // A requester without a manager has the manager step routed to a Helpdesk admin (TC).
    const mgrApprover = (f.approver && this.cfg.person(f.approver)?.roles.includes('MANAGER') ? f.approver : u.managerId) || this.cover.hdAdmins()[0] || null;

    const key = await this.loader.ds.transaction(async (em) => {
      const seq = await em.getRepository(SequenceEntity).createQueryBuilder('s').setLock('pessimistic_write').where('s.helpdesk = :hd', { hd }).getOne();
      const n = seq?.nextValue ?? 1;
      await em.getRepository(SequenceEntity).save({ helpdesk: hd, nextValue: n + 1 });
      const key = hd === 'SF' ? `SF-${String(n).padStart(5, '0')}` : `${hd}-${String(n).padStart(6, '0')}`;
      const t = em.getRepository(TicketEntity).create({
        key, helpdesk: hd, categoryKey: c.key, subCategory: f.sub, title: f.title.trim(), description: f.desc.trim(), priority: pri,
        status: chain ? 'Pending approval' : hd === 'HR' ? 'Open' : 'New', closeResponse: null, closeMessage: null, requesterId: u.id,
        assigneeId: asg, createdAt: now, updatedAt: now, closedAt: null, closedById: null, responseDue: new Date(now.getTime() + rh * 3600000),
        resolutionDue: new Date(now.getTime() + sh * 3600000), responseMet: null, confidential: hd !== 'SF' && c.confidential,
        escalationLevel: 0, paused: false, relatedKey: related, fields, aiTranscript: input.aiTranscript?.trim() || null,
        slaVer, ladderBase: route.ladderBase, asgHist, escLog: null, slaStarted: !chain, slaStart: chain ? null : now,
      });
      await em.getRepository(TicketEntity).insert(t);
      for (const fl of followers) await em.getRepository(FollowerEntity).insert({ ticketKey: key, ...fl });
      if (chain)
        for (const [i, step] of chain.entries())
          await em.getRepository(ApprovalEntity).insert({ ticketKey: key, step, seq: i, status: 'Pending', approverId: step === 'mgr' ? mgrApprover : null, decidedById: null, decidedAt: null });
      for (const file of files)
        await em.getRepository(AttachmentEntity).insert({ ticketKey: key, fileName: file.originalname, sizeBytes: file.size, mimeType: file.mimetype, storagePath: storeFile(key, file), uploadedById: u.id, createdAt: now });
      const ev = (text: string, kind: string) => em.getRepository(EventEntity).insert({ ticketKey: key, at: now, text, kind });
      const ccNames = followers.map((x) => this.cfg.name(x.userId)).join(', ');
      await ev(hd === 'SF' ? `Case created in Salesforce by ${u.name} (origin: NPSTX platform)` : `Raised by ${u.name}${followers.length ? ' · CC: ' + ccNames : ''}${t.aiTranscript ? ' · with AI voice assist (transcript saved, audio not stored)' : ''}`, 'raise');
      let routed: string;
      if (route.event) routed = route.event;
      else if (hd === 'SF') routed = `Assignment rule → ${this.cfg.name(asg)}`;
      else if (chain) {
        const tmpRow = { t, ctx: { approvals: [{ step: 'mgr', seq: 0, status: 'Pending', approverId: mgrApprover, decidedById: null, decidedAt: null }], requesterManagerId: u.managerId } } as never;
        routed = `Status: New → Pending approval · ${steps[chain[0]].l.toLowerCase()} approval requested from ${this.query.approverText(tmpRow, chain[0])}`;
      } else if (c.queueId) routed = `Placed in ${this.cfg.name(asg)} (category lead ${this.cfg.name(c.leadId)})`;
      else routed = `Routed to ${this.cfg.name(asg)}${c.leadId ? ` (category lead, ${c.name})` : ''}`;
      await ev(routed, chain ? 'status' : 'assign');
      if (related) {
        await ev(`Linked to related ticket ${related}`, 'assign');
        await em.getRepository(EventEntity).insert({ ticketKey: related, at: now, text: `Linked from ${key} (${this.cfg.helpdeskLabel(hd)})`, kind: 'assign' });
      }
      await this.providers.for(hd).onCreated(em, t, u.name);
      return key;
    });

    const actor = { id: u.id, name: u.name };
    const ticketRef: TicketRef = {
      key, helpdesk: hd, categoryKey: c.key, requesterId: u.id, assigneeId: asg, confidential: hd !== 'SF' && c.confidential,
      status: chain ? 'Pending approval' : hd === 'HR' ? 'Open' : 'New', priority: pri, followers,
    };
    const coverTxt = route.coverFor ? ` (covering for ${this.cfg.name(route.coverFor)})` : '';
    if (this.cfg.person(asg)?.isQueue) await this.events.emitTicketEvent('TICKET_CREATED_QUEUE', ticketRef, actor);
    else await this.events.emitTicketEvent('TICKET_CREATED_DIRECT', ticketRef, actor, { cover: coverTxt || undefined, newAssigneeId: asg });
    if (route.unattended) await this.events.emitTicketEvent('UNATTENDED_NO_COVER', ticketRef, actor, { recipients: this.cover.hdAdmins() });
    for (const fl of followers)
      await this.events.emitTicketEvent(fl.relation === 'CC' ? 'TICKET_CC_ADDED' : 'FOLLOWER_ADDED', ticketRef, actor, { targetUserId: fl.userId });
    if (chain) {
      const [row] = await this.loader.withCtx([(await this.loader.ds.getRepository(TicketEntity).findOne({ where: { key } }))!]);
      await this.events.emitTicketEvent('APPROVAL_NEEDED', ticketRef, actor, { approverIds: this.query.approverIds(row, chain[0]) });
    }
    const t = (await this.loader.ds.getRepository(TicketEntity).findOne({ where: { key } }))!;
    return {
      key,
      toast: `${key} raised · ${chain ? `waiting for ${steps[chain[0]].l.toLowerCase()} approval · SLA starts after approval` : `assigned to ${this.cfg.name(asg)} · resolution due ${fdt(t.resolutionDue)}`}`,
    };
  }

  /** Requester's own open tickets, for the "Related ticket" field. */
  async relatedOptions(u: Principal) {
    const rows = await this.loader.ds.getRepository(TicketEntity).find({ where: { requesterId: u.id }, order: { createdAt: 'DESC' } });
    const withCtx = await this.loader.withCtx(rows);
    return withCtx.filter((r) => !r.closed).map((r) => ({ key: r.t.key, title: r.t.title }));
  }

  async people(u: Principal, hd: string, exclude: string[]) {
    if (!allowedHds(u).includes(hd as Helpdesk)) {
      await this.audit.record(u.id, hd === 'SF' ? 'salesforce.denied' : 'people.denied', `Denied the ${hd} people list`, { outcome: 'denied', target: hd });
      throw forbidden(hd === 'SF' ? 'The Salesforce helpdesk is available only to Sales, Presales and Solutions.' : 'Unknown helpdesk.', hd === 'SF' ? 'SALESFORCE_FORBIDDEN' : 'FORBIDDEN');
    }
    return this.loader.ds.getRepository(UserEntity).find({ where: { isQueue: false, active: true }, order: { name: 'ASC' } }).then((us) =>
      us.filter((x) => !exclude.includes(x.id) && hdAllowed(x, hd)).map((x) => ({ id: x.id, name: x.name, dept: x.dept, title: x.title })),
    );
  }
}
