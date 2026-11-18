import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { fmtH } from '../common/clock';
import { CategoryEntity, FormFieldEntity, SettingEntity, SlaVersionEntity, UserEntity, UserHrCategoryEntity, UserRoleEntity } from '../database/entities';
import { evalCond } from '../domain/sla';
import { Helpdesk, PersonRef, Role, StatusModel } from '../domain/types';

type Sla = Record<string, [number, number]>;
export interface SlaTables { shared: Sla; IT: Sla; ADM: Sla }

/**
 * Cached view of the helpdesk configuration: categories, form fields, settings and people.
 * Everything the Admin console changes lives in the database; call reload() after a change.
 */
@Injectable()
export class HelpdeskConfigService implements OnModuleInit {
  private cats: CategoryEntity[] = [];
  private fields: FormFieldEntity[] = [];
  private settings = new Map<string, any>();
  private people = new Map<string, PersonRef>();
  private versions: SlaVersionEntity[] = [];

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async onModuleInit() {
    await this.reload();
  }

  async reload(): Promise<void> {
    const [cats, fields, settings, users, roles, hr] = await Promise.all([
      this.ds.getRepository(CategoryEntity).find({ order: { helpdesk: 'ASC', sortOrder: 'ASC' } }),
      this.ds.getRepository(FormFieldEntity).find({ order: { sortOrder: 'ASC', id: 'ASC' } }),
      this.ds.getRepository(SettingEntity).find(),
      this.ds.getRepository(UserEntity).find(),
      this.ds.getRepository(UserRoleEntity).find(),
      this.ds.getRepository(UserHrCategoryEntity).find(),
    ]);
    this.cats = cats;
    this.fields = fields;
    this.settings = new Map(settings.map((s) => [s.key, s.value]));
    this.versions = await this.ds.getRepository(SlaVersionEntity).find({ order: { effectiveFrom: 'ASC', id: 'ASC' } });
    this.people = new Map(
      users.map((u) => [
        u.id,
        {
          id: u.id, name: u.name, dept: u.dept, title: u.title, managerId: u.managerId, isQueue: u.isQueue,
          roles: roles.filter((r) => r.userId === u.id).map((r) => r.role as Role),
          hrCats: hr.filter((h) => h.userId === u.id).map((h) => h.categoryKey),
        },
      ]),
    );
  }

  setting<T = any>(key: string): T {
    return this.settings.get(key) as T;
  }
  categories(hd?: string): CategoryEntity[] {
    return hd ? this.cats.filter((c) => c.helpdesk === hd) : this.cats;
  }
  category(hd: string, key: string): CategoryEntity | null {
    return this.cats.find((c) => c.helpdesk === hd && c.key === key) ?? null;
  }
  formFields(hd: string, cat: string, includeInactive = false): FormFieldEntity[] {
    return this.fields.filter((f) => f.helpdesk === hd && f.categoryKey === cat && (includeInactive || f.active));
  }
  allFields(): FormFieldEntity[] {
    return this.fields;
  }
  person(id: string | null | undefined): PersonRef | null {
    return id ? this.people.get(id) ?? null : null;
  }
  name(id: string | null | undefined): string {
    return (id && this.people.get(id)?.name) || '—';
  }
  peopleList(): PersonRef[] {
    return [...this.people.values()];
  }
  statusModel(hd: string): StatusModel {
    return this.setting<Record<string, StatusModel>>('statuses')[hd];
  }
  uiMap(hd: string): Record<string, string> {
    return this.setting<Record<string, Record<string, string>>>('uiMap')[hd];
  }
  priorities(hd: string): string[] {
    return this.setting<Record<string, string[]>>('priorities')[hd];
  }
  helpdeskLabel(hd: string): string {
    return this.setting<{ key: string; label: string }[]>('helpdesks').find((h) => h.key === hd)?.label ?? hd;
  }
  slaTable(hd: string): Sla {
    const s = this.setting<{ shared: Sla; IT: Sla; ADM: Sla }>('sla');
    return hd === 'IT' ? s.IT : hd === 'ADM' ? s.ADM : s.shared;
  }
  /** Immutable SLA versions (Fix 2), oldest first. */
  slaVersions(): SlaVersionEntity[] {
    return this.versions;
  }
  slaVersion(id: number | null | undefined): SlaVersionEntity | null {
    if (!id) return null;
    return this.versions.find((v) => v.id === id) ?? null;
  }
  /** The version a ticket raised now would bind to: the newest effective version, else version 1. */
  currentVersionId(): number {
    const now = Date.now();
    const eff = this.versions.filter((v) => v.effectiveFrom.getTime() <= now);
    return (eff.length ? eff[eff.length - 1] : this.versions[0])?.id ?? 1;
  }
  private versionTable(hd: string, v: SlaVersionEntity): Sla {
    const t = v.tables as unknown as SlaTables;
    return hd === 'IT' ? t.IT : hd === 'ADM' ? t.ADM : t.shared;
  }
  /**
   * [first response hours, resolution hours] for a helpdesk, category and priority.
   * When versionId is given (a ticket's bound SLA version), that immutable version is used.
   * Without a version, the live configuration is used (new tickets, admin preview).
   */
  slaFor(hd: string, cat: string | null, pri: string, versionId?: number | null): [number, number] {
    const c = cat ? this.category(hd, cat) : null;
    const v = this.slaVersion(versionId);
    if (v) {
      const ov = (v.categoryOverrides ?? {})[`${hd}:${cat}`];
      const t = this.versionTable(hd, v);
      return (ov && ov[pri]) || t[pri] || this.versionTable('HR', v)[pri] || this.versionTable('HR', v).Medium;
    }
    const t = this.slaTable(hd);
    return (c?.slaOverride && c.slaOverride[pri]) || t[pri] || this.slaTable('HR')[pri] || this.slaTable('HR').Medium;
  }
  slaText(hd: string, cat: string | null, pri: string): string {
    const [a, b] = this.slaFor(hd, cat, pri);
    return `response within ${fmtH(a)}, resolution within ${fmtH(b)}`;
  }
  /** Escalation ladder: levels with the resolved person or queue for a ticket's category. */
  ladder(hd: string, cat: string, versionId?: number | null): { who: string; role: string; pct: number; th: string }[] {
    const esc = this.setting<Record<string, { who: string; role: string; pct: number }[]>>('escalation');
    if (esc[hd]) {
      const c = this.category(hd, cat);
      const snap = (this.slaVersion(versionId)?.ladderPct as Record<string, number[]> | null)?.[hd];
      return esc[hd].map((l, i) => {
        const pct = snap && snap[i] != null ? snap[i] : l.pct;
        return {
          who: l.who === 'lead' ? c?.leadId || c?.ownerId || '' : l.who,
          role: l.role,
          pct,
          th: pct >= 100 ? '100% · breach' : `${pct}% of resolution time`,
        };
      });
    }
    const sf = this.setting<{ who: string; role: string }>('sfEscalation');
    return [{ who: sf.who, role: sf.role, pct: 100, th: 'Resolution milestone at risk' }];
  }
  /** Approval chain for a new ticket, from the category's rule and the form values. */
  approvalChain(hd: Helpdesk, cat: string, f: Record<string, unknown>): string[] | null {
    if (hd === 'LND') return f.reqType === 'course' ? ['mgr', 'lnd'] : null;
    const c = this.category(hd, cat);
    for (const r of c?.approvalRule ?? []) if (r.when === null || evalCond(r.when, f)) return r.chain;
    return null;
  }
  fieldLabel(key: string): string {
    const fromDb = this.fields.find((f) => f.key === key)?.label;
    return this.setting<Record<string, string>>('fieldLabels')[key] || fromDb || key;
  }
}
