import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { clock, fmtH } from '../common/clock';
import { badRequest, forbidden, notFound } from '../common/errors';
import { CategoryEntity, EventEntity, FormFieldEntity, SettingEntity, SlaVersionEntity, TicketEntity, UserHrCategoryEntity, UserRoleEntity } from '../database/entities';
import { allowedHds, hdAllowed } from '../domain/policy';
import { isAtRisk, isBreachedRes, isOverdue } from '../domain/sla';
import { Principal, Role } from '../domain/types';
import { AuditService } from '../audit/audit.service';
import { HelpdeskConfigService } from '../helpdesk-config/config.service';

const LEAD_HDS = ['HR', 'IT', 'ADM'];
const SLA_LABEL: Record<string, string> = { IT: 'IT and Support', ADM: 'Admin Desk', shared: 'HR and L&D' };
const HDL: Record<string, string> = { HR: 'HR', LND: 'L&D', IT: 'IT and Support', ADM: 'Admin Desk', SF: 'Salesforce' };

export interface PerfRow {
  userId: string | null; name: string; title: string | null; helpdesk: string;
  handled: number; withinSla: number; withinAfterManual: number; resolvedLate: number; responseBreached: number; resolutionBreached: number;
  escalatedAuto: number; escalatedManual: number; coveredForAbsence: number; receivedViaEscalation: number;
  open: number; overdue: number; atRisk: number; reopened: number; avgFirstMs: number | null; avgResolutionMs: number | null; compliancePct: number | null;
}

/** Admin console (Helpdesk admin only). Every change is audited and applies to new tickets straight away. */
@Injectable()
export class AdminService {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly cfg: HelpdeskConfigService, private readonly audit: AuditService) {}

  private log(u: Principal, text: string, target?: string) {
    return this.audit.record(u.id, 'config.change', text, { target });
  }
  private guardHd(u: Principal, hd: string) {
    if (allowedHds(u).includes(hd as never)) return;
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

  /** Fix 2: freeze the current SLA policy as a new immutable version. Tickets raised from now bind to it. */
  private async snapshotVersion(setBy: string, note: string): Promise<SlaVersionEntity> {
    const sla = this.cfg.setting<Record<string, Record<string, [number, number]>>>('sla');
    const esc = this.cfg.setting<Record<string, { who: string; role: string; pct: number }[]>>('escalation');
    const ladderPct: Record<string, number[]> = {};
    for (const h of ['HR', 'LND', 'IT', 'ADM']) if (esc[h]) ladderPct[h] = esc[h].map((l) => l.pct);
    const catOv: Record<string, Record<string, [number, number]>> = {};
    for (const c of this.cfg.categories()) if (c.slaOverride) catOv[`${c.helpdesk}:${c.key}`] = c.slaOverride;
    const repo = this.ds.getRepository(SlaVersionEntity);
    return repo.save(repo.create({
      effectiveFrom: clock.now(), setBy, tables: JSON.parse(JSON.stringify(sla)),
      categoryOverrides: Object.keys(catOv).length ? catOv : null, ladderPct, note,
    }));
  }

  private async openPerVersion(): Promise<Map<number, number>> {
    const rows = await this.ds.getRepository(TicketEntity).find({ select: { slaVer: true, helpdesk: true, status: true } });
    const m = new Map<number, number>();
    for (const r of rows) if (!this.cfg.statusModel(r.helpdesk).closed.includes(r.status)) m.set(r.slaVer ?? 1, (m.get(r.slaVer ?? 1) || 0) + 1);
    return m;
  }

  async overview(u: Principal) {
    const counts = await this.openCounts();
    const hds = allowedHds(u);
    const sfOk = hdAllowed(u, 'SF');
    const people = this.cfg.peopleList();
    const openVer = await this.openPerVersion();
    return {
      helpdesks: hds,
      categories: this.cfg.categories().filter((c) => hds.includes(c.helpdesk as never)).map((c) => ({ ...c, leadName: this.cfg.name(c.leadId), ownerName: c.ownerId ? this.cfg.name(c.ownerId) : null, openCount: counts.get(`${c.helpdesk}.${c.key}`) || 0 })),
      fields: this.cfg.allFields().filter((f) => hds.includes(f.helpdesk as never)),
      sla: this.cfg.setting('sla'), escalation: this.cfg.setting('escalation'), rules: this.cfg.setting('rules'), ruleLabels: this.cfg.setting('ruleLabels'),
      slaVersions: this.cfg.slaVersions().map((v) => ({
        id: v.id, effectiveFrom: v.effectiveFrom, setBy: v.setBy, setByName: this.cfg.name(v.setBy), note: v.note,
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

  async saveCategory(u: Principal, id: number | null, b: { helpdesk: string; name: string; subs: string[]; defaultPriority?: string; ownerId?: string; confidential?: boolean; reopenAllowed?: boolean; requestType?: string }) {
    this.guardHd(u, b.helpdesk);
    const subs = (b.subs || []).map((s) => s.trim()).filter(Boolean);
    const err: Record<string, string> = {};
    if (!b.name?.trim()) err.n = 'Name the category.';
    if (!subs.length) err.subs = 'Add at least one sub-category.';
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
    await repo.save(c);
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
    const v = await this.snapshotVersion(u.id, `${SLA_LABEL[b.table]} · ${b.priority} ${b.index ? 'resolution' : 'first response'}: ${fmtH(before)} → ${fmtH(n)}`);
    await this.log(u, `${SLA_LABEL[b.table]} · ${b.priority} priority ${b.index ? 'resolution' : 'first response'} target set to ${fmtH(n)} (SLA v${v.id})`);
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
      l.pct = Math.min(100, Math.max(10, Math.round(Number(b.pct)) || l.pct));
      await this.log(u, `${this.cfg.helpdeskLabel(b.helpdesk)} escalation L${b.level + 1} now triggers at ${l.pct}%`);
      await this.setSetting('escalation', esc);
      await this.snapshotVersion(u.id, `${this.cfg.helpdeskLabel(b.helpdesk)} escalation L${b.level + 1} trigger → ${l.pct}%`);
      await this.cfg.reload();
      return { toast: 'Escalation ladder updated' };
    }
    await this.setSetting('escalation', esc);
    await this.cfg.reload();
    return { toast: 'Escalation ladder updated' };
  }

  async setRoles(u: Principal, userId: string, b: { roles: string[]; hrCategories: string[] }) {
    const p = this.cfg.person(userId);
    if (!p || p.isQueue) throw notFound('Person');
    const assignable = this.cfg.setting<string[]>('assignableRoles');
    if (userId === u.id && p.roles.includes('HD_ADMIN') && !b.roles.includes('HD_ADMIN')) throw badRequest('You cannot remove your own Helpdesk admin role', 'SELF_DEMOTION');
    if (b.roles.some((r) => !assignable.includes(r))) throw badRequest('Unknown role.', 'VALIDATION');
    const sfOk = hdAllowed(u, 'SF');
    // keep roles this admin cannot see or set (managers come from reporting lines; SF_ADMIN only for Salesforce-eligible admins)
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

  /**
   * Fix 4: Assignee performance. Aggregates each person's handled tickets by SLA outcome, escalation,
   * absence cover and reopening. Reconciliation: Σ Handled + Unassigned = every ticket in scope.
   */
  async performance(u: Principal, b: { hd?: string; range?: string; q?: string }) {
    const hds = allowedHds(u);
    const scope = b.hd && hds.includes(b.hd as never) ? b.hd : 'ALL';
    const range = ['7', '30', '90', 'year'].includes(b.range ?? '') ? b.range! : '30';
    const days = range === 'year' ? 365 : Number(range);
    const now = clock.nowMs();
    const since = now - days * 86400000;
    const all = await this.ds.getRepository(TicketEntity).find({ where: scope === 'ALL' ? { helpdesk: In(hds) } : { helpdesk: scope as never } });
    const rows = all.filter((t) => t.createdAt.getTime() >= since || (!!t.closedAt && t.closedAt.getTime() >= since));
    const keys = rows.map((r) => r.key);
    const evs = keys.length ? await this.ds.getRepository(EventEntity).find({ where: { ticketKey: In(keys) } }) : [];
    const firstResp = new Map<string, number>();
    const reopened = new Set<string>();
    const unattended = new Set<string>();
    for (const e of evs) {
      if (e.text.startsWith('First response sent')) firstResp.set(e.ticketKey, e.at.getTime());
      if (e.text.startsWith('Reopened')) reopened.add(e.ticketKey);
      if (e.text.startsWith('No cover available')) unattended.add(e.ticketKey);
    }
    const map = new Map<string, any>();
    const un = { handled: 0, open: 0, overdue: 0, atRisk: 0, keys: [] as string[] };
    for (const t of rows) {
      const closed = this.cfg.statusModel(t.helpdesk).closed.includes(t.status);
      const p = this.cfg.person(t.assigneeId);
      if (!p || p.isQueue) {
        un.handled++;
        un.keys.push(t.key);
        if (!closed) {
          un.open++;
          if (isOverdue(t, closed, now)) un.overdue++;
          else if (isAtRisk(t, closed, now)) un.atRisk++;
        }
        continue;
      }
      const row = map.get(p.id) ?? {
        userId: p.id, name: p.name, title: p.title, helpdesk: t.helpdesk,
        handled: 0, withinSla: 0, withinAfterManual: 0, resolvedLate: 0, responseBreached: 0, resolutionBreached: 0,
        escalatedAuto: 0, escalatedManual: 0, coveredForAbsence: 0, receivedViaEscalation: 0, open: 0, overdue: 0, atRisk: 0, reopened: 0,
        frSum: 0, frN: 0, resSum: 0, resN: 0, keys: [] as string[],
      };
      row.handled++;
      row.keys.push(t.key);
      const breachedRes = isBreachedRes(t, closed, now);
      const hasManual = (t.escLog ?? []).some((e) => e.how === 'manual');
      if (closed) {
        if (breachedRes) row.resolvedLate++;
        else if (hasManual) row.withinAfterManual++;
        else row.withinSla++;
        if (t.closedAt) { row.resSum += t.closedAt.getTime() - t.createdAt.getTime(); row.resN++; }
      } else {
        row.open++;
        if (isOverdue(t, closed, now)) row.overdue++;
        else if (isAtRisk(t, closed, now)) row.atRisk++;
      }
      if (t.responseMet === false) row.responseBreached++;
      if (breachedRes) row.resolutionBreached++;
      const fr = firstResp.get(t.key);
      if (fr) { row.frSum += fr - t.createdAt.getTime(); row.frN++; }
      if (reopened.has(t.key)) row.reopened++;
      for (const e of t.escLog ?? []) if (e.how === 'manual') row.escalatedManual++; else row.escalatedAuto++;
      for (const a of t.asgHist ?? []) {
        if (a.how === 'absence' && a.u === p.id) row.coveredForAbsence++;
        if (a.how === 'escalation' && a.u === p.id) row.receivedViaEscalation++;
      }
      map.set(p.id, row);
    }
    let list: PerfRow[] = [...map.values()].map((r) => {
      const resolved = r.withinSla + r.withinAfterManual + r.resolvedLate;
      const { frSum, frN, resSum, resN, ...rest } = r;
      return {
        ...rest,
        avgFirstMs: frN ? Math.round(frSum / frN) : null,
        avgResolutionMs: resN ? Math.round(resSum / resN) : null,
        compliancePct: resolved ? Math.round(((r.withinSla + r.withinAfterManual) / resolved) * 100) : null,
      };
    });
    const handled = [...map.values()].reduce((s, r) => s + r.handled, 0);
    const q = (b.q ?? '').trim().toLowerCase();
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q));
    list.sort((a, b2) => (b2.compliancePct ?? -1) - (a.compliancePct ?? -1) || b2.handled - a.handled);
    const sum = (k: keyof PerfRow) => list.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    const unattendedList = rows.filter((t) => unattended.has(t.key)).map((t) => ({
      key: t.key, title: t.title, helpdesk: t.helpdesk, assignee: this.cfg.name(t.assigneeId),
      status: t.status, priority: t.priority, createdAt: t.createdAt,
    }));
    const resolvedAll = sum('withinSla') + sum('withinAfterManual') + sum('resolvedLate');
    return {
      scope, scopes: [['ALL', 'All helpdesks'], ...hds.map((h) => [h, HDL[h]] as [string, string])],
      range, rangeLabel: range === 'year' ? 'This year' : `Last ${range} days`, helpdesks: hds,
      cards: [
        { l: 'Handled', n: handled, h: `${list.length} assignee${list.length === 1 ? '' : 's'}`, ic: 'inbox', tone: 'info' },
        { l: 'Within SLA', n: sum('withinSla') + sum('withinAfterManual'), h: 'resolved inside target', ic: 'check', tone: 'ok' },
        { l: 'Resolved late', n: sum('resolvedLate'), h: 'resolution target missed', ic: 'clock', tone: 'bad' },
        { l: 'Escalated (auto)', n: sum('escalatedAuto'), h: 'by SLA threshold', ic: 'up', tone: 'warn' },
        { l: 'Escalated (manual)', n: sum('escalatedManual'), h: 'by an agent', ic: 'up', tone: 'warn' },
        { l: 'Compliance', n: resolvedAll ? `${Math.round(((sum('withinSla') + sum('withinAfterManual')) / resolvedAll) * 100)}%` : '—', h: 'resolved within SLA', ic: 'target', tone: 'accent' },
      ],
      rows: list, unassigned: un, unattended: unattendedList,
      reconciliation: { handled, unassigned: un.handled, total: rows.length },
      chart: list.slice(0, 12).map((r) => ({ label: r.name, n: r.compliancePct ?? 0, v: `${r.compliancePct ?? 0}%` })),
    };
  }
}
