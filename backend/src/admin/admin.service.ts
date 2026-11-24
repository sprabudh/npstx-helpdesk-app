import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { clock, fmtH } from '../common/clock';
import { badRequest, forbidden, notFound } from '../common/errors';
import { CategoryEntity, FormFieldEntity, SettingEntity, SlaChange, SlaVersionEntity, TicketEntity, UserHrCategoryEntity, UserRoleEntity } from '../database/entities';
import { adminHds } from '../domain/policy';
import { Principal, Role } from '../domain/types';
import { AuditService } from '../audit/audit.service';
import { HelpdeskConfigService } from '../helpdesk-config/config.service';

const LEAD_HDS = ['HR', 'IT', 'ADM'];
const SLA_LABEL: Record<string, string> = { IT: 'IT and Support', ADM: 'Admin Desk', shared: 'HR and L&D' };
const MERGE_MS = 60000;
const STEP_LABEL: Record<string, string> = { lnd: 'L&D', ith: 'IT head', adm: 'Admin head' };

/** Admin console (Helpdesk admin only). Every change is audited and applies to new tickets straight away. */
@Injectable()
export class AdminService {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly cfg: HelpdeskConfigService, private readonly audit: AuditService) {}

  private log(u: Principal, text: string, target?: string) {
    return this.audit.record(u.id, 'config.change', text, { target });
  }
  private guardHd(u: Principal, hd: string) {
    if (adminHds(u).includes(hd as never)) return;
    void this.audit.record(u.id, 'salesforce.denied', `Denied ${hd} configuration change`, { outcome: 'denied', target: hd });
    throw forbidden('The Salesforce helpdesk is available only to Sales, Presales and Solutions.', 'SALESFORCE_FORBIDDEN');
  }
  private async setSetting(key: string, value: unknown) {
    await this.ds.getRepository(SettingEntity).save({ key, value });
  }
  private async openCounts(): Promise<Map<string, number>> {
    const rows = await this.ds.getRepository(TicketEntity).find({ select: { helpdesk: true, categoryKey: true, status: true } });
    const m = new Map<string, number>();
    for (const r of rows) if (!this.cfg.statusModel(r.helpdesk).closed.includes(r.status)) m.set(`${r.helpdesk}.${r.categoryKey}`, (m.get(`${r.helpdesk}.${r.categoryKey}`) || 0) + 1);
    return m;
  }
  private async grantHr(userId: string, catKey: string) {
    const p = this.cfg.person(userId);
    if (!p || p.isQueue) return;
    await this.ds.getRepository(UserRoleEntity).save({ userId, role: 'HR_AGENT' });
    await this.ds.getRepository(UserHrCategoryEntity).save({ userId, categoryKey: catKey });
    const agents = this.cfg.setting<Record<string, string[]>>('agents');
    if (!agents.HR.includes(userId)) await this.setSetting('agents', { ...agents, HR: [...agents.HR, userId] });
  }

  /**
   * Freezes the current SLA policy as a new immutable version; tickets raised from now bind to it.
   * A same-admin edit of the same cell within 60 s updates the newest version instead, but only while
   * no ticket has been raised under it.
   */
  private async snapshotVersion(setBy: string, change: SlaChange): Promise<SlaVersionEntity> {
    const sla = this.cfg.setting<Record<string, Record<string, [number, number]>>>('sla');
    const esc = this.cfg.setting<Record<string, { who: string; role: string; pct: number }[]>>('escalation');
    const ladderPct: Record<string, number[]> = {};
    for (const h of ['HR', 'LND', 'IT', 'ADM']) if (esc[h]) ladderPct[h] = esc[h].map((l) => l.pct);
    const catOv: Record<string, Record<string, [number, number]>> = {};
    for (const c of this.cfg.categories()) if (c.slaOverride) catOv[`${c.helpdesk}:${c.key}`] = c.slaOverride;
    const repo = this.ds.getRepository(SlaVersionEntity);
    // DATETIME keeps whole seconds and MySQL rounds, so truncate: the version must already be effective.
    const now = new Date(Math.floor(clock.nowMs() / 1000) * 1000);
    const snap = { tables: JSON.parse(JSON.stringify(sla)), categoryOverrides: Object.keys(catOv).length ? catOv : null, ladderPct };
    const last = await repo.findOne({ where: {}, order: { id: 'DESC' } });
    const sameCell = last && last.id > 1 && last.setBy === setBy && now.getTime() - last.effectiveFrom.getTime() < MERGE_MS
      && last.changes?.length === 1 && last.changes[0].what === change.what;
    if (sameCell && !(await this.ds.getRepository(TicketEntity).count({ where: { slaVer: last.id } }))) {
      const merged: SlaChange = { what: change.what, before: last.changes![0].before, after: change.after };
      Object.assign(last, snap, { changes: [merged], note: describe(merged) });
      return repo.save(last);
    }
    return repo.save(repo.create({ effectiveFrom: now, setBy, ...snap, changes: [change], note: describe(change) }));
  }

  private async openPerVersion(): Promise<Map<number, number>> {
    const rows = await this.ds.getRepository(TicketEntity).find({ select: { slaVer: true, helpdesk: true, status: true } });
    const m = new Map<number, number>();
    for (const r of rows) if (!this.cfg.statusModel(r.helpdesk).closed.includes(r.status)) m.set(r.slaVer ?? 1, (m.get(r.slaVer ?? 1) || 0) + 1);
    return m;
  }

  async overview(u: Principal) {
    const counts = await this.openCounts();
    const hds = adminHds(u);
    const sfOk = hds.includes('SF');
    const people = this.cfg.peopleList();
    const openVer = await this.openPerVersion();
    return {
      helpdesks: hds,
      categories: this.cfg.categories().filter((c) => hds.includes(c.helpdesk as never)).map((c) => ({
        ...c, leadName: this.cfg.name(c.leadId), ownerName: c.ownerId ? this.cfg.name(c.ownerId) : null, openCount: counts.get(`${c.helpdesk}.${c.key}`) || 0,
        extraSteps: this.cfg.additionalSteps(c.helpdesk, c.key).map((x) => STEP_LABEL[x] ?? x),
      })),
      fields: this.cfg.allFields().filter((f) => hds.includes(f.helpdesk as never)),
      sla: this.cfg.setting('sla'), escalation: this.cfg.setting('escalation'), rules: this.cfg.setting('rules'), ruleLabels: this.cfg.setting('ruleLabels'),
      priorities: this.cfg.setting('priorities'), coreFields: this.cfg.setting('coreFields'), sfEscalation: this.cfg.setting('sfEscalation'),
      slaVersions: this.cfg.slaVersions().map((v) => ({
        id: v.id, effectiveFrom: v.effectiveFrom, setBy: v.setBy, setByName: this.cfg.name(v.setBy), note: v.note, changes: v.changes ?? [],
        tables: v.tables, ladderPct: v.ladderPct, openOnVersion: openVer.get(v.id) || 0,
      })),
      agents: Object.fromEntries(Object.entries(this.cfg.setting<Record<string, string[]>>('agents')).filter(([h]) => hds.includes(h as never))
        .map(([h, ids]) => [h, ids.map((id) => ({ id, name: this.cfg.name(id), isQueue: !!this.cfg.person(id)?.isQueue, title: this.cfg.person(id)?.title ?? null }))])),
      people: people.filter((p) => !p.isQueue).map((p) => ({
        id: p.id, name: p.name, dept: p.dept, title: p.title, roles: p.roles.filter((r) => r !== 'SF_ADMIN' || sfOk), hrCategories: p.hrCats,
        leads: [
          ...this.cfg.categories('HR').filter((c) => c.leadId === p.id).map((c) => 'HR · ' + c.name),
          ...this.cfg.categories('LND').filter((c) => c.ownerId === p.id).map((c) => 'L&D · ' + c.name),
          ...this.cfg.categories('IT').filter((c) => c.leadId === p.id).map((c) => 'IT · ' + c.name),
          ...this.cfg.categories('ADM').filter((c) => c.leadId === p.id).map((c) => 'Admin · ' + c.name),
          ...(sfOk ? this.cfg.categories('SF').filter((c) => c.ownerId === p.id).map((c) => 'SF · ' + c.name) : []),
        ],
      })),
      queues: people.filter((p) => p.isQueue).map((p) => ({ id: p.id, name: p.name })),
      audit: (await this.audit.list(6, 'config.change')).map((a) => ({ at: a.at, actorId: a.actorId, actorName: this.cfg.name(a.actorId), text: a.summary })),
      assignableRoles: (this.cfg.setting<string[]>('assignableRoles')).filter((r) => r !== 'SF_ADMIN' || sfOk),
    };
  }

  async saveCategory(u: Principal, id: number | null, b: {
    helpdesk: string; name: string; subs: string[]; defaultPriority?: string; ownerId?: string; confidential?: boolean; reopenAllowed?: boolean; requestType?: string;
    mgrApproval?: boolean; mgrApprovalSubs?: string[] | null; slaOverride?: Record<string, [number, number]>;
  }) {
    this.guardHd(u, b.helpdesk);
    const subs = (b.subs || []).map((s) => s.trim()).filter(Boolean);
    const err: Record<string, string> = {};
    if (!b.name?.trim()) err.n = 'Name the category.';
    if (!subs.length) err.subs = 'Add at least one sub-category.';
    if (b.helpdesk === 'SF' && !b.ownerId) err.owner = 'Choose the Salesforce assignment owner or queue.';
    if (b.helpdesk === 'SF' && b.slaOverride) {
      const bad = Object.values(b.slaOverride).some((v) => !Array.isArray(v) || v.length !== 2 || v.some((n) => !Number.isFinite(Number(n)) || Number(n) <= 0));
      if (bad) err.slaOverride = 'Enter both targets as positive hours.';
    }
    if (Object.keys(err).length) throw badRequest('Fix the highlighted fields.', 'VALIDATION', { fieldErrors: err });
    const repo = this.ds.getRepository(CategoryEntity);
    let c = id ? await repo.findOne({ where: { id } }) : null;
    if (id && !c) throw notFound('Category');
    const isNew = !c;
    if (!c) {
      const list = this.cfg.categories(b.helpdesk);
      let key = b.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 12) || 'CAT';
      while (list.find((x) => x.key === key)) key += '2';
      const other = list.find((x) => x.key === 'OTHER');
      c = repo.create({ helpdesk: b.helpdesk, key, active: true, sortOrder: other ? other.sortOrder : list.length, needsRecord: false, needsImpact: false, restricted: false, confidential: false });
      if (other) await repo.update(other.id, { sortOrder: other.sortOrder + 1 });
    }
    Object.assign(c, { name: b.name.trim(), subs, defaultPriority: b.defaultPriority || 'Medium' });
    if (LEAD_HDS.includes(b.helpdesk)) Object.assign(c, { leadId: b.ownerId || null, confidential: !!b.confidential, reopenAllowed: !!b.reopenAllowed });
    else c.ownerId = b.ownerId || null;
    if (b.helpdesk === 'LND') c.requestType = b.requestType || 'portal';
    if (b.helpdesk === 'SF' && b.slaOverride !== undefined) c.slaOverride = Object.keys(b.slaOverride).length ? b.slaOverride : null;
    const mgrBefore = isNew ? null : mgrText(c);
    if (b.mgrApproval !== undefined) {
      c.mgrApproval = b.mgrApproval;
      const picked = (b.mgrApprovalSubs ?? []).filter((x) => subs.includes(x));
      c.mgrApprovalSubs = b.mgrApproval && picked.length && picked.length < subs.length ? picked : null;
    } else if (isNew) Object.assign(c, { mgrApproval: false, mgrApprovalSubs: null });
    else if (c.mgrApprovalSubs) {
      const kept = c.mgrApprovalSubs.filter((x) => subs.includes(x));
      c.mgrApprovalSubs = kept.length ? kept : null;
    }
    await repo.save(c);
    if (mgrBefore !== null && mgrBefore !== mgrText(c)) await this.log(u, `${this.cfg.helpdeskLabel(b.helpdesk)} · ${c.name}: manager approval ${mgrBefore} → ${mgrText(c)}`, `category:${c.id}`);
    if (b.helpdesk === 'HR' && b.ownerId) await this.grantHr(b.ownerId, c.key);
    await this.log(u, `${isNew ? 'Added' : 'Edited'} ${this.cfg.helpdeskLabel(b.helpdesk)} category "${c.name}"`, `category:${c.id}`);
    await this.cfg.reload();
    return { id: c.id, key: c.key, toast: `${c.name} ${isNew ? 'added' : 'saved'}. The Raise ticket form uses it now.` };
  }

  async setCategoryActive(u: Principal, id: number, active: boolean) {
    const c = await this.ds.getRepository(CategoryEntity).findOne({ where: { id } });
    if (!c) throw notFound('Category');
    this.guardHd(u, c.helpdesk);
    await this.ds.getRepository(CategoryEntity).update(id, { active });
    const n = (await this.openCounts()).get(`${c.helpdesk}.${c.key}`) || 0;
    await this.log(u, `${active ? 'Enabled' : 'Disabled'} ${this.cfg.helpdeskLabel(c.helpdesk)} category "${c.name}"`, `category:${id}`);
    await this.cfg.reload();
    return { toast: active ? `${c.name} is active and back in the Raise ticket form` : `${c.name} disabled. Hidden from the form; ${n} open ticket${n === 1 ? '' : 's'} keep it.` };
  }

  async setMgrApproval(u: Principal, id: number, on: boolean, subs: string[] | null) {
    const c = await this.ds.getRepository(CategoryEntity).findOne({ where: { id } });
    if (!c) throw notFound('Category');
    this.guardHd(u, c.helpdesk);
    const before = mgrText(c);
    const picked = (subs ?? []).filter((x) => c.subs.includes(x));
    c.mgrApproval = on;
    c.mgrApprovalSubs = on && picked.length && picked.length < c.subs.length ? picked : on ? null : c.mgrApprovalSubs;
    await this.ds.getRepository(CategoryEntity).save(c);
    await this.log(u, `${this.cfg.helpdeskLabel(c.helpdesk)} · ${c.name}: manager approval ${before} → ${mgrText(c)}`, `category:${id}`);
    await this.cfg.reload();
    return { toast: `Manager approval ${on ? 'on' : 'off'} for ${c.name}. Applies to tickets raised from now.` };
  }

  async setCategoryLead(u: Principal, id: number, userId: string) {
    const c = await this.ds.getRepository(CategoryEntity).findOne({ where: { id } });
    if (!c) throw notFound('Category');
    this.guardHd(u, c.helpdesk);
    if (!this.cfg.person(userId)) throw badRequest('Pick a person or queue.', 'VALIDATION');
    const lead = LEAD_HDS.includes(c.helpdesk);
    await this.ds.getRepository(CategoryEntity).update(id, lead ? { leadId: userId } : { ownerId: userId });
    if (c.helpdesk === 'HR') await this.grantHr(userId, c.key);
    await this.log(u, `${this.cfg.helpdeskLabel(c.helpdesk)} · ${c.name}: ${lead ? 'lead' : 'owner'} set to ${this.cfg.name(userId)}`, `category:${id}`);
    await this.cfg.reload();
    return { toast: `${this.cfg.name(userId)} now ${lead ? 'leads' : 'owns'} ${c.name}. New tickets route there.` };
  }

  async saveField(u: Principal, id: number | null, b: { helpdesk: string; categoryKey: string; label: string; type: string; placeholder?: string; options?: string[]; required?: boolean }) {
    this.guardHd(u, b.helpdesk);
    const err: Record<string, string> = {};
    if (!b.label?.trim()) err.l = 'Add a label.';
    const opts = (b.options || []).map((s) => s.trim()).filter(Boolean);
    if (b.type === 'select' && !opts.length) err.opts = 'Add at least one option.';
    if (Object.keys(err).length) throw badRequest('Fix the highlighted fields.', 'VALIDATION', { fieldErrors: err });
    const cat = this.cfg.category(b.helpdesk, b.categoryKey);
    if (!cat) throw notFound('Category');
    const repo = this.ds.getRepository(FormFieldEntity);
    const def = { label: b.label.trim(), type: b.type || 'text', placeholder: b.placeholder || null, options: b.type === 'select' ? opts : null, required: !!b.required };
    let isNew = false;
    if (id) {
      const f = await repo.findOne({ where: { id } });
      if (!f || !f.custom) throw notFound('Custom field');
      await repo.update(id, def);
    } else {
      isNew = true;
      let key = b.label.trim().toLowerCase().replace(/[^a-z0-9]+(.)?/g, (_m: string, ch?: string) => (ch ? ch.toUpperCase() : '')).slice(0, 24) || 'field';
      while (this.cfg.allFields().some((x) => x.key === key) || this.cfg.setting<Record<string, string>>('fieldLabels')[key]) key += 'X';
      await repo.insert({ ...def, helpdesk: b.helpdesk, categoryKey: b.categoryKey, key, custom: true, active: true, sortOrder: 100 + this.cfg.formFields(b.helpdesk, b.categoryKey, true).length, min: null, pattern: null, patternFlags: null, patternMessage: null, defaultValue: null, hint: null, showWhen: null, validation: null });
    }
    await this.log(u, `${isNew ? 'Added' : 'Edited'} field "${def.label}" on ${this.cfg.helpdeskLabel(b.helpdesk)} · ${cat.name}`);
    await this.cfg.reload();
    return { toast: `${def.label} ${isNew ? 'added to' : 'updated in'} the form` };
  }

  async patchField(u: Principal, id: number, b: { required?: boolean; active?: boolean }) {
    const f = await this.ds.getRepository(FormFieldEntity).findOne({ where: { id } });
    if (!f || !f.custom) throw notFound('Custom field');
    this.guardHd(u, f.helpdesk);
    const patch: Partial<FormFieldEntity> = {};
    if (b.required !== undefined) patch.required = b.required;
    if (b.active !== undefined) patch.active = b.active;
    await this.ds.getRepository(FormFieldEntity).update(id, patch);
    const what = b.required !== undefined ? (b.required ? 'made required' : 'made optional') : b.active ? 'activated' : 'deactivated';
    await this.log(u, `Field "${f.label}" ${what}`);
    await this.cfg.reload();
    return { toast: null };
  }

  async deleteField(u: Principal, id: number) {
    const f = await this.ds.getRepository(FormFieldEntity).findOne({ where: { id } });
    if (!f || !f.custom) throw notFound('Custom field');
    this.guardHd(u, f.helpdesk);
    await this.ds.getRepository(FormFieldEntity).delete(id);
    await this.log(u, `Removed field "${f.label}" from ${this.cfg.helpdeskLabel(f.helpdesk)} · ${this.cfg.category(f.helpdesk, f.categoryKey)?.name ?? f.categoryKey}`);
    await this.cfg.reload();
    return { toast: `${f.label} removed from the form` };
  }

  async setSla(u: Principal, b: { table: 'shared' | 'IT' | 'ADM'; priority: string; index: 0 | 1; hours: number }) {
    const sla = this.cfg.setting<Record<string, Record<string, [number, number]>>>('sla');
    if (!sla[b.table]?.[b.priority] || ![0, 1].includes(b.index)) throw badRequest('Unknown SLA target.', 'VALIDATION');
    const n = Math.max(0.5, Number(b.hours) || 1);
    const before = sla[b.table][b.priority][b.index];
    sla[b.table][b.priority][b.index] = n;
    await this.setSetting('sla', sla);
    if (before === n) return { toast: null };
    const what = `${SLA_LABEL[b.table]} · ${b.priority} ${b.index ? 'resolution' : 'first response'}`;
    const v = await this.snapshotVersion(u.id, { what, before, after: n });
    await this.log(u, `${what} target: ${fmtH(before)} → ${fmtH(n)} (SLA v${v.id})`);
    await this.cfg.reload();
    return { toast: `${b.priority}: ${b.index ? 'resolution' : 'first response'} target is now ${n} h for tickets raised from now (SLA v${v.id})`, version: v.id };
  }

  async setRule(u: Principal, key: string, value: boolean) {
    const rules = this.cfg.setting<Record<string, boolean>>('rules');
    if (!(key in rules)) throw badRequest('Unknown rule.', 'VALIDATION');
    rules[key] = value;
    await this.setSetting('rules', rules);
    await this.log(u, `Rule "${this.cfg.setting<Record<string, string>>('ruleLabels')[key]}" turned ${value ? 'on' : 'off'}`);
    await this.cfg.reload();
    return { toast: null };
  }

  async setEscalation(u: Principal, b: { helpdesk: string; level: number; who?: string; pct?: number }) {
    const esc = this.cfg.setting<Record<string, { who: string; role: string; pct: number }[]>>('escalation');
    const l = esc[b.helpdesk]?.[b.level];
    if (!l) throw badRequest('Unknown escalation level.', 'VALIDATION');
    if (b.who !== undefined) {
      if (b.who !== 'lead' && !this.cfg.person(b.who)) throw badRequest('Pick a person.', 'VALIDATION');
      l.who = b.who;
      l.role = b.who === 'lead' ? 'Category lead' : this.cfg.person(b.who)!.title ?? 'Escalation contact';
      await this.log(u, `${this.cfg.helpdeskLabel(b.helpdesk)} escalation L${b.level + 1} now goes to ${b.who === 'lead' ? 'the category lead' : this.cfg.name(b.who)}`);
    }
    if (b.pct !== undefined) {
      const before = l.pct;
      l.pct = Math.min(100, Math.max(10, Math.round(Number(b.pct)) || l.pct));
      if (before === l.pct) return { toast: null };
      const what = `${this.cfg.helpdeskLabel(b.helpdesk)} escalation L${b.level + 1} trigger`;
      await this.setSetting('escalation', esc);
      const v = await this.snapshotVersion(u.id, { what, before: `${before}%`, after: `${l.pct}%` });
      await this.log(u, `${what}: ${before}% → ${l.pct}% (SLA v${v.id})`);
      await this.cfg.reload();
      return { toast: 'Escalation ladder updated' };
    }
    await this.setSetting('escalation', esc);
    await this.cfg.reload();
    return { toast: 'Escalation ladder updated' };
  }

  async setSfEscalation(u: Principal, b: { who: string }) {
    if (!adminHds(u).includes('SF')) throw forbidden('The Salesforce helpdesk is available only to Sales, Presales and Solutions.', 'SALESFORCE_FORBIDDEN');
    const target = this.cfg.person(b.who);
    if (!target) throw notFound('Person or queue');
    const sf = this.cfg.setting<{ who: string; role: string }>('sfEscalation');
    const before = sf.who;
    sf.who = b.who;
    sf.role = target.title ?? 'Salesforce escalation rule';
    await this.setSetting('sfEscalation', sf);
    await this.log(u, `Salesforce escalation rule now goes to ${this.cfg.name(b.who)}`, 'sfEscalation');
    await this.cfg.reload();
    return { toast: before === b.who ? null : `Salesforce escalation now goes to ${this.cfg.name(b.who)}.` };
  }

  async setRoles(u: Principal, userId: string, b: { roles: string[]; hrCategories: string[] }) {
    const p = this.cfg.person(userId);
    if (!p || p.isQueue) throw notFound('Person');
    const assignable = this.cfg.setting<string[]>('assignableRoles');
    if (userId === u.id && p.roles.includes('HD_ADMIN') && !b.roles.includes('HD_ADMIN')) throw badRequest('You cannot remove your own Helpdesk admin role', 'SELF_DEMOTION');
    if (b.roles.some((r) => !assignable.includes(r))) throw badRequest('Unknown role.', 'VALIDATION');
    const sfOk = adminHds(u).includes('SF');
    const keep = p.roles.filter((r) => r === 'EMP' || r === 'MANAGER' || (r === 'SF_ADMIN' && !sfOk));
    const next = [...new Set([...keep, ...b.roles.filter((r) => r !== 'SF_ADMIN' || sfOk)])] as Role[];
    await this.ds.transaction(async (em) => {
      await em.getRepository(UserRoleEntity).delete({ userId });
      for (const r of next) await em.getRepository(UserRoleEntity).insert({ userId, role: r });
      await em.getRepository(UserHrCategoryEntity).delete({ userId });
      if (next.includes('HR_AGENT')) for (const c of b.hrCategories || []) await em.getRepository(UserHrCategoryEntity).insert({ userId, categoryKey: c });
    });
    const agents = this.cfg.setting<Record<string, string[]>>('agents');
    const addTo = (hd: string, cond: boolean) => cond && !agents[hd].includes(userId) && agents[hd].push(userId);
    addTo('HR', next.includes('HR_AGENT'));
    addTo('LND', next.includes('LND_COORD') || next.includes('LND_HEAD'));
    addTo('IT', next.includes('IT_AGENT') || next.includes('IT_HEAD'));
    addTo('ADM', next.includes('ADM_AGENT') || next.includes('ADM_HEAD'));
    addTo('SF', next.includes('SF_ADMIN'));
    await this.setSetting('agents', agents);
    const labels = this.cfg.setting<Record<string, string>>('roleLabels');
    await this.log(u, `Helpdesk roles for ${p.name}: ${next.filter((r) => r !== 'EMP').map((r) => labels[r]).join(', ') || 'none'}`, `user:${userId}`);
    await this.cfg.reload();
    return { toast: `Roles saved for ${p.name}` };
  }
}

const fmtVal = (v: number | string | null) => (typeof v === 'number' ? fmtH(v) : v ?? '—');
const describe = (c: SlaChange) => `${c.what}: ${fmtVal(c.before)} → ${fmtVal(c.after)}`;
const mgrText = (c: Pick<CategoryEntity, 'mgrApproval' | 'mgrApprovalSubs'>) =>
  !c.mgrApproval ? 'off' : c.mgrApprovalSubs?.length ? `on for ${c.mgrApprovalSubs.join(', ')}` : 'on for all sub-categories';
