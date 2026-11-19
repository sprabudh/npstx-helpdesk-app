import { readFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { clock, fromIst, istDate } from '../common/clock';
import { env } from '../common/env';
import { AsgRecord, EscRecord } from '../database/entities';

interface SeedData {
  users: any[];
  tickets: any[];
  notifications: any[];
  faqs: any[];
  adminLog: { at: string; who: string; text: string }[];
  sequences: Record<string, number>;
}
interface ConfigData {
  categories: any[];
  formFields: any[];
  config: Record<string, unknown>;
}

const TABLES = [
  'audit_log', 'faq_votes', 'faqs', 'notification_outbox', 'notifications', 'sf_child_cases', 'sf_case_team', 'sf_cases',
  'attachments', 'ticket_approvals', 'ticket_followers', 'ticket_events', 'ticket_comments', 'tickets', 'settings',
  'form_fields', 'categories', 'user_hr_categories', 'user_roles', 'users', 'ticket_sequences',
  'absences', 'attendance', 'sla_versions',
];

const sizeBytes = (s: string) => {
  const m = /([\d.]+)\s*(KB|MB)/i.exec(s || '');
  return m ? Math.round(Number(m[1]) * (m[2].toUpperCase() === 'MB' ? 1048576 : 1024)) : 0;
};
const email = (name: string) => `${name.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '.')}@npstx.com`;

/** Loads the artifact's sample data (db/seed/*.json) into an empty or existing schema. Idempotent. */
export class SeedService {
  constructor(private readonly ds: DataSource) {}

  static loadFiles(dir = env.seedDir): { data: SeedData; cfg: ConfigData } {
    return {
      data: JSON.parse(readFileSync(join(dir, 'seed-data.json'), 'utf8')),
      cfg: JSON.parse(readFileSync(join(dir, 'helpdesk-config.json'), 'utf8')),
    };
  }

  async run(): Promise<{ users: number; tickets: number; faqs: number; notifications: number }> {
    const { data, cfg } = SeedService.loadFiles();
    // The sample data is authored relative to the mock's "now". Shift every timestamp forward so the
    // newest sample activity lands at the real current time; relative SLA/age states are preserved,
    // and new tickets, comments and events use the real system clock.
    const mockNow = Date.parse((data as { meta?: { demoClockStart?: string } }).meta?.demoClockStart ?? '');
    const offsetMs = Number.isFinite(mockNow) ? Date.now() - mockNow : 0;
    const at = (s: string | null | undefined): Date | null => {
      const d = fromIst(s);
      return d && offsetMs ? new Date(d.getTime() + offsetMs) : d;
    };
    const qr = this.ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await qr.query('SET FOREIGN_KEY_CHECKS=0');
      for (const t of TABLES) await qr.query(`DELETE FROM ${t}`);
      for (const t of ['categories', 'form_fields', 'ticket_comments', 'ticket_events', 'attachments', 'notifications', 'faqs', 'audit_log', 'sf_child_cases', 'faq_votes', 'notification_outbox', 'sla_versions', 'absences', 'attendance'])
        await qr.query(`ALTER TABLE ${t} AUTO_INCREMENT = 1`);

      for (const u of data.users) {
        await qr.query(
          'INSERT INTO users (id,name,email,dept,title,location,manager_id,is_queue,active) VALUES (?,?,?,?,?,?,?,?,1)',
          [u.id, u.name, u.isQueue ? null : email(u.name), u.dept, u.title, u.location, u.managerId, u.isQueue ? 1 : 0],
        );
        for (const r of u.roles) await qr.query('INSERT INTO user_roles (user_id,role) VALUES (?,?)', [u.id, r]);
        for (const c of u.hrCategories) await qr.query('INSERT INTO user_hr_categories (user_id,category_key) VALUES (?,?)', [u.id, c]);
      }
      for (const c of cfg.categories) {
        await qr.query(
          `INSERT INTO categories (helpdesk,cat_key,name,subs,default_priority,lead_id,owner_id,queue_id,confidential,restricted,
           reopen_allowed,request_type,needs_record,needs_impact,sla_override,approval_rule,mgr_approval,mgr_approval_subs,active,sort_order)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [c.helpdesk, c.key, c.name, JSON.stringify(c.subs), c.defaultPriority, c.leadId, c.ownerId, c.queueId, c.confidential, c.restricted,
            c.reopenAllowed, c.requestType, c.needsRecord, c.needsImpact, c.slaOverride ? JSON.stringify(c.slaOverride) : null,
            c.approvalRule ? JSON.stringify(c.approvalRule) : null, c.mgrApproval ? 1 : 0, c.mgrApprovalSubs ? JSON.stringify(c.mgrApprovalSubs) : null,
            c.active ? 1 : 0, c.sortOrder],
        );
      }
      for (const f of cfg.formFields) {
        await qr.query(
          `INSERT INTO form_fields (helpdesk,category_key,field_key,label,type,options,placeholder,hint,min_value,pattern,pattern_flags,
           pattern_message,default_value,required_rule,show_when,validation,is_custom,active,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [f.helpdesk, f.categoryKey, f.key, f.label, f.type, f.options ? JSON.stringify(f.options) : null, f.placeholder, f.hint, f.min,
            f.pattern, f.patternFlags, f.patternMessage, f.defaultValue, JSON.stringify(f.required ?? false),
            f.showWhen ? JSON.stringify(f.showWhen) : null, f.validation ? JSON.stringify(f.validation) : null, f.custom ? 1 : 0,
            f.active === false ? 0 : 1, f.sortOrder],
        );
      }
      for (const [k, v] of Object.entries(cfg.config)) await qr.query('INSERT INTO settings (setting_key,value) VALUES (?,?)', [k, JSON.stringify(v)]);

      // Fix 2: freeze the seeded SLA policy as version 1, so every sample ticket binds to the original
      // policy and the Admin console can append newer versions without touching it.
      const slaCfg = cfg.config.sla as Record<string, Record<string, [number, number]>>;
      const escCfg = cfg.config.escalation as Record<string, { who: string; role: string; pct: number }[]>;
      const ladderPct: Record<string, number[]> = {};
      for (const h of ['HR', 'LND', 'IT', 'ADM']) if (escCfg[h]) ladderPct[h] = escCfg[h].map((l) => l.pct);
      const catOv: Record<string, Record<string, [number, number]>> = {};
      for (const c of cfg.categories) if (c.slaOverride) catOv[`${c.helpdesk}:${c.key}`] = c.slaOverride;
      const v1At = data.tickets.reduce<Date | null>((m, t) => { const d = at(t.createdAt); return d && (!m || d < m) ? d : m; }, null) ?? clock.now();
      await qr.query(
        'INSERT INTO sla_versions (effective_from,set_by,note,tables,category_overrides,ladder_pct) VALUES (?,?,?,?,?,?)',
        [v1At, 'u20', 'Initial SLA policy (version 1).', JSON.stringify(slaCfg), Object.keys(catOv).length ? JSON.stringify(catOv) : null, JSON.stringify(ladderPct)],
      );

      const nameToId = new Map<string, string>(data.users.map((u) => [u.name, u.id]));
      for (const t of data.tickets) {
        const { asgHist, escLog } = SeedService.history(t, nameToId, at);
        const rejectedAtApproval = t.status === 'Rejected' && !!t.approval && Object.values(t.approval).includes('Rejected');
        const slaStarted = t.status !== 'Pending approval' && !rejectedAtApproval;
        await qr.query(
          `INSERT INTO tickets (ticket_key,helpdesk,category_key,sub_category,title,description,priority,status,close_response,close_message,
           requester_id,assignee_id,created_at,updated_at,closed_at,closed_by_id,response_due,resolution_due,response_met,confidential,
           escalation_level,paused,related_key,fields,ai_transcript,sla_ver,ladder_base,asg_hist,esc_log,sla_started,sla_start)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,NULL)`,
          [t.key, t.helpdesk, t.categoryKey, t.subCategory, t.title, t.description, t.priority, t.status, t.closeResponse, t.closeMessage,
            t.requesterId, t.assigneeId, at(t.createdAt), at(t.updatedAt), at(t.closedAt), t.closedById,
            at(t.responseDue), at(t.resolutionDue), t.responseMet, t.confidential, t.escalationLevel, t.paused, t.relatedKey,
            JSON.stringify(t.fields || {}), 1, 0, JSON.stringify(asgHist), escLog.length ? JSON.stringify(escLog) : null, slaStarted ? 1 : 0],
        );
        for (const c of t.comments)
          await qr.query('INSERT INTO ticket_comments (ticket_key,author_id,body,internal,created_at) VALUES (?,?,?,?,?)', [t.key, c.authorId, c.body, c.internal, at(c.createdAt)]);
        for (const e of t.events)
          await qr.query('INSERT INTO ticket_events (ticket_key,at,text,kind) VALUES (?,?,?,?)', [t.key, at(e.at), e.text, e.kind]);
        for (const f of t.followers)
          await qr.query('INSERT INTO ticket_followers (ticket_key,user_id,relation,added_by_id) VALUES (?,?,?,?)', [t.key, f.userId, f.relation, f.addedById]);
        for (const f of t.files || [])
          await qr.query('INSERT INTO attachments (ticket_key,file_name,size_bytes,mime_type,storage_path,uploaded_by_id,created_at) VALUES (?,?,?,?,NULL,?,?)',
            [t.key, f.n, sizeBytes(f.s), null, t.requesterId, at(t.createdAt)]);
        if (t.approval) {
          const a = t.approval;
          const chain: string[] = a.chain || ['mgr', 'lnd'];
          const requester = data.users.find((u) => u.id === t.requesterId);
          for (const [i, step] of chain.entries()) {
            await qr.query('INSERT INTO ticket_approvals (ticket_key,step,seq,status,approver_id,decided_by_id,decided_at) VALUES (?,?,?,?,?,?,?)', [
              t.key, step, i, a[step] || 'Pending', step === 'mgr' ? a.mgrId || requester?.managerId || null : null,
              a[`${step}By`] || null, at(a[`${step}At`]),
            ]);
          }
        }
        if (t.sf) {
          await qr.query('INSERT INTO sf_cases (ticket_key,case_no,entitlement,milestones,external_id) VALUES (?,?,?,?,NULL)', [t.key, t.sf.caseNo, t.sf.ent, JSON.stringify(t.sf.ms)]);
          for (const [uid, role] of t.sf.team) await qr.query('INSERT INTO sf_case_team (ticket_key,user_id,role) VALUES (?,?,?)', [t.key, uid, role]);
          for (const [no, title, status, owner] of t.sf.kids)
            await qr.query('INSERT INTO sf_child_cases (ticket_key,case_no,title,status,owner_name) VALUES (?,?,?,?,?)', [t.key, no, title, status, owner]);
        }
      }
      // Demo absences relative to today: HR lead Priya Rao is on leave today (Anil Gupta covers), Kavya Nair
      // is on leave tomorrow, and Admin Desk lead Pooja Shetty and the next ladder person Rahul Kapoor are
      // both away today, so new Admin Desk tickets show the "no cover available" path.
      const today = istDate(clock.now());
      const tomorrow = istDate(new Date(clock.nowMs() + 86400000));
      const absences: [string, string, string][] = [['u3', today, today], ['u8', tomorrow, tomorrow], ['u24', today, today], ['u25', today, today]];
      for (const [uid, from, to] of absences)
        await qr.query('INSERT INTO absences (user_id,from_date,to_date,type,status) VALUES (?,?,?,?,?)', [uid, from, to, 'Leave', 'Approved']);
      await qr.query('INSERT INTO attendance (user_id,date,status,marked_at) VALUES (?,?,?,?)', ['u22', today, 'WFH', clock.now()]);
      // newest first in the artifact; insert oldest first so ids increase with time
      for (const n of [...data.notifications].reverse())
        await qr.query('INSERT INTO notifications (user_id,text,ticket_key,created_at,read_at) VALUES (?,?,?,?,?)', [n.userId, n.text, n.ticketKey, at(n.createdAt), n.read ? at(n.createdAt) : null]);
      for (const f of data.faqs)
        await qr.query('INSERT INTO faqs (helpdesk,sort_order,question,answer,category_key) VALUES (?,?,?,?,?)', [f.helpdesk, f.sortOrder, f.question, f.answer, f.categoryKey]);
      for (const l of [...data.adminLog].reverse())
        await qr.query('INSERT INTO audit_log (at,actor_id,action,target,outcome,summary,detail) VALUES (?,?,?,?,?,?,NULL)', [at(l.at), l.who, 'config.change', null, 'ok', l.text]);
      for (const [hd, next] of Object.entries(data.sequences)) await qr.query('INSERT INTO ticket_sequences (helpdesk,next_value) VALUES (?,?)', [hd, next]);
      await qr.query('SET FOREIGN_KEY_CHECKS=1');
      await qr.commitTransaction();
      return { users: data.users.length, tickets: data.tickets.length, faqs: data.faqs.length, notifications: data.notifications.length };
    } catch (e) {
      await qr.rollbackTransaction();
      throw e;
    } finally {
      await qr.release();
    }
  }

  /**
   * Assignment history and escalation log rebuilt from a sample ticket's events, so the Assignee
   * performance report has data on day one (live tickets write both as things happen).
   * An escalation to the person already holding the ticket (Level 1 = category lead) is not a handover.
   */
  static history(t: any, nameToId: Map<string, string>, at: (s: string | null | undefined) => Date | null) {
    const iso = (s: string) => (at(s) ?? clock.now()).toISOString();
    const asgHist: AsgRecord[] = [];
    const escLog: EscRecord[] = [];
    let holder: string | null = null;
    const push = (u: string, when: string, how: AsgRecord['how']) => {
      asgHist.push({ u, at: when, how, coverFor: null });
      holder = u;
    };
    for (const e of t.events as { at: string; text: string; kind: string }[]) {
      if (e.kind === 'assign') {
        const picked = /^Placed in (.+?) · picked up by (.+)$/.exec(e.text);
        const moved = /^Reassigned from (.+?) to (.+?) by /.exec(e.text);
        if (picked && !holder) {
          push(nameToId.get(picked[1]) ?? t.assigneeId, iso(t.createdAt), 'routing');
          push(nameToId.get(picked[2]) ?? t.assigneeId, iso(e.at), 'queue-claim');
        } else if (moved && holder) {
          const to = nameToId.get(moved[2]);
          if (to && to !== holder) push(to, iso(e.at), String(holder).startsWith('q_') ? 'queue-claim' : 'manual');
        }
      } else if (e.kind === 'esc') {
        if (!holder) push(t.assigneeId, iso(t.createdAt), 'routing');
        const level = Number((/Level (\d+)/.exec(e.text) || [])[1] || 1);
        const name = e.text.replace(/^Escalated to Level \d+ · /, '').replace(/ \(.*$/, '').trim();
        const to = nameToId.get(name) ?? t.assigneeId;
        const by = /^by (.+?)( · |$)/.exec(e.text.replace(/^.*?\) /, ''));
        escLog.push({ level, at: iso(e.at), from: holder, to, how: by ? 'manual' : 'sla', by: by ? nameToId.get(by[1]) ?? null : null });
        if (to !== holder) push(to, iso(e.at), 'escalation');
      }
    }
    if (!holder) push(t.assigneeId, iso(t.createdAt), 'routing');
    return { asgHist, escLog };
  }
}
