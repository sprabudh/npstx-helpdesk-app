import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAction, useAdmin, useConfig, useMe, usePerformance } from '../api/hooks';
import type { Condition } from '../api/types';
import { Avatar, Denied, HdBadge, PriFlag, Skeleton } from '../components/common/bits';
import { evalCond } from '../lib/cond';
import { fdt, fmtH, HDL } from '../lib/format';
import { Icon } from '../lib/icons';
import { useUi } from '../store/ui';

type Adm = any;
const TABS: [string, string, string][] = [['categories', 'Categories', 'file'], ['fields', 'Form fields', 'clip'], ['sla', 'SLA and escalation', 'clock'], ['roles', 'Role mapping', 'users'], ['perf', 'Assignee performance', 'chart']];
const PREVIEW: Record<string, string[]> = { HR: ['Category', 'Sub-category', 'Title', 'Description'], LND: ['Request type', 'Category', 'Sub-category', 'Learning source and item'], SF: ['Type', 'Reason', 'Account and opportunity', 'Record link'], IT: ['Category', 'Sub-category'], ADM: ['Category', 'Sub-category'] };
const ROUTING_NOTE: Record<string, string> = {
  HR: 'New tickets in a category route to its lead. Making someone a lead also gives them HR agent access to that category, including confidential ones.',
  IT: 'New tickets route to the category queue or lead. The lead of a confidential category is the only agent who sees it besides the IT head.',
  ADM: 'New tickets route to the category queue or lead. Purchases route to the Admin head.',
  LND: 'New L&D tickets route to this owner or queue. Course requests reach it after approval.',
  SF: 'Mirrors the Salesforce assignment rule owner for each type (mock).',
};

function HdSeg({ hds }: { hds: string[] }) {
  const a = useUi((s) => s.adm);
  const set = useUi((s) => s.set);
  return <div className="seg">{hds.map((h) => <button key={h} className={a.hd === h ? 'on' : ''} onClick={() => set((s) => ({ adm: { ...s.adm, hd: h as never, cat: '', flash: null } }))}>{HDL[h]}</button>)}</div>;
}

/** Number input that saves on blur or Enter, like the artifact's change event. */
function NumIn({ id, value, min, max, step, width, label, onSave }: { id: string; value: number; min: number; max?: number; step?: number; width: number; label: string; onSave: (n: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => {
    setV(String(value));
  }, [value]);
  const commit = () => v !== String(value) && onSave(Number(v));
  return <input className="in" type="number" min={min} max={max} step={step} style={{ width }} id={id} aria-label={label} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}

function Categories({ adm, leadHd }: { adm: Adm; leadHd: boolean }) {
  const a = useUi((s) => s.adm);
  const set = useUi((s) => s.set);
  const act = useAction();
  const cats = adm.categories.filter((c: any) => c.helpdesk === a.hd);
  const ownerL = leadHd ? 'Category lead' : a.hd === 'SF' ? 'Assignment owner' : 'Owner / queue';
  const name = (id: string) => adm.people.find((p: any) => p.id === id)?.name ?? adm.queues.find((q: any) => q.id === id)?.name ?? id;
  return (
    <section className="panel adm-sec">
      <div className="adm-head">
        <h3>Category management</h3><HdSeg hds={adm.helpdesks} />
        <span className="r"><button className="btn primary sm" onClick={() => set({ modal: { type: 'cat', hd: a.hd } })}><Icon n="plus" s={14} />Add category</button></span>
        <p>Categories and sub-categories drive the Raise ticket form, routing and default priority. A disabled category is hidden from the form; existing tickets keep it.</p>
      </div>
      <div className="tbl-wrap">
        <table className="t">
          <thead><tr><th>Category</th><th>Sub-categories</th>{a.hd === 'LND' && <th>Type</th>}<th>Default priority</th><th>{ownerL}</th>{leadHd && <><th>Confidential</th><th>Reopen</th></>}<th>Open</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {cats.map((c: any) => {
              const owner = c.leadId || c.ownerId;
              return (
                <tr key={c.key} style={{ cursor: 'default' }} className={`${c.active ? '' : 'off'} ${a.flash === c.key ? 'flash' : ''}`}>
                  <td><b style={{ fontWeight: 600 }}>{c.name}</b><div className="sub mono">{c.key}</div></td>
                  <td><div className="subs">{c.subs.map((x: string) => <span key={x} className="chip">{x}</span>)}</div></td>
                  {a.hd === 'LND' && <td className="nowrap">{c.requestType === 'course' ? 'Course request' : 'Portal problem'}</td>}
                  <td><PriFlag p={c.defaultPriority || 'Medium'} /></td>
                  <td className="nowrap">{owner ? <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Avatar name={name(owner)} queue={!!adm.queues.find((q: any) => q.id === owner)} sm />{name(owner)}</span> : '—'}</td>
                  {leadHd && (
                    <>
                      <td>{c.confidential ? <span className="lock"><Icon n="lock" s={12} />Yes{c.restricted ? ' · restricted' : ''}</span> : <span className="muted">No</span>}</td>
                      <td className="nowrap">{c.reopenAllowed !== false ? '30 days' : <span className="muted">Off</span>}</td>
                    </>
                  )}
                  <td className="mono">{c.openCount}</td>
                  <td><label className="sw"><input type="checkbox" id={`cat-on-${a.hd}-${c.key}`} checked={c.active} aria-label={`Active: ${c.name}`} onChange={(e) => act.run(() => api(`/admin/categories/${c.id}/active`, { method: 'PATCH', body: { active: e.target.checked } }))} /></label></td>
                  <td><button className="btn sm" onClick={() => set({ modal: { type: 'cat', hd: a.hd, key: c.key } })}>Edit</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Fields({ adm, cfg }: { adm: Adm; cfg: any }) {
  const a = useUi((s) => s.adm);
  const set = useUi((s) => s.set);
  const act = useAction();
  const cats = adm.categories.filter((c: any) => c.helpdesk === a.hd);
  const cat = cats.find((c: any) => c.key === a.cat) ?? cats[0];
  const all = adm.fields.filter((f: any) => f.helpdesk === a.hd && f.categoryKey === cat.key).sort((x: any, y: any) => x.sortOrder - y.sortOrder);
  const custom = all.filter((f: any) => f.custom);
  const schema = all.filter((f: any) => !f.custom && f.active);
  const reqOf = (f: any) => evalCond(f.required as Condition | boolean | null, { sub: '' });
  return (
    <section className="panel adm-sec">
      <div className="adm-head">
        <h3>Field configuration</h3><HdSeg hds={adm.helpdesks} />
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>Category{' '}
          <select className="in" id="adm-fcat" value={cat.key} onChange={(e) => set((s) => ({ adm: { ...s.adm, cat: e.target.value } }))}>{cats.map((x: any) => <option key={x.key} value={x.key}>{x.name}{x.active ? '' : ' (disabled)'}</option>)}</select>
        </label>
        <span className="r"><button className="btn primary sm" onClick={() => set({ modal: { type: 'field', hd: a.hd, cat: cat.key } })}><Icon n="plus" s={14} />Add field</button></span>
        <p>Custom fields appear in the Raise ticket form for this category after the core fields. Core fields come from the SDD and are locked.</p>
      </div>
      <div className="cfg-grid">
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="tbl-wrap">
            <table className="t">
              <thead><tr><th>Custom field</th><th>Type</th><th>Required</th><th>Active</th><th></th></tr></thead>
              <tbody>
                {custom.length ? custom.map((x: any) => (
                  <tr key={x.id} style={{ cursor: 'default' }} className={x.active ? '' : 'off'}>
                    <td><b style={{ fontWeight: 600 }}>{x.label}</b><div className="sub mono">{x.key}{x.options ? ` · ${x.options.join(', ')}` : ''}</div></td>
                    <td className="nowrap">{cfg.fieldTypes[x.type || 'text']}</td>
                    <td><label className="sw"><input type="checkbox" id={`f-req-${x.key}`} checked={x.required === true} aria-label={`Required: ${x.label}`} onChange={(e) => act.run(() => api(`/admin/fields/${x.id}`, { method: 'PATCH', body: { required: e.target.checked } }))} /></label></td>
                    <td><label className="sw"><input type="checkbox" id={`f-on-${x.key}`} checked={x.active} aria-label={`Active: ${x.label}`} onChange={(e) => act.run(() => api(`/admin/fields/${x.id}`, { method: 'PATCH', body: { active: e.target.checked } }))} /></label></td>
                    <td className="nowrap"><button className="btn sm" onClick={() => set({ modal: { type: 'field', hd: a.hd, cat: cat.key, id: x.id } })}>Edit</button> <button className="btn sm danger" onClick={() => act.run(() => api(`/admin/fields/${x.id}`, { method: 'DELETE' }))}>Remove</button></td>
                  </tr>
                )) : <tr style={{ cursor: 'default' }}><td colSpan={5} className="muted">No custom fields for {cat.name} yet. Add one to collect extra details when someone raises a ticket.</td></tr>}
              </tbody>
            </table>
          </div>
          <div>
            <b style={{ fontSize: 13 }}>Core fields</b>
            <div className="subs" style={{ maxWidth: 'none', marginTop: 6 }}>{[...(cfg.coreFields[a.hd] ?? []), ...schema.map((x: any) => `${x.label} (category field)`)].map((n: string) => <span key={n} className="chip"><Icon n="lock" s={11} />{n}</span>)}</div>
          </div>
        </div>
        <aside className="panel preview" aria-label="Form preview">
          <b style={{ fontSize: 13 }}>Form preview · {cat.name}</b>
          {PREVIEW[a.hd].map((n) => <div key={n} className="pf"><span>{n}</span><i /></div>)}
          {schema.map((x: any) => <div key={x.id} className="pf"><span>{x.label}{reqOf(x) && <> <b style={{ color: 'var(--bad)' }}>*</b></>}{x.showWhen && <> <span className="muted">(conditional)</span></>}</span><i /></div>)}
          {custom.filter((x: any) => x.active).map((x: any) => <div key={x.id} className="pf custom"><span>{x.label}{x.required === true && <> <b style={{ color: 'var(--bad)' }}>*</b></>}</span><i /></div>)}
          {['IT', 'ADM'].includes(a.hd) && <div className="pf"><span>Title, Description</span><i /></div>}
          <div className="pf"><span>Attachments</span><i /></div>
          <button className="btn sm" onClick={() => set({ drawer: { hd: a.hd, cat: cat.key } })}>Open the real form</button>
        </aside>
      </div>
    </section>
  );
}

function Sla({ adm, cfg }: { adm: Adm; cfg: any }) {
  const act = useAction();
  const hds: string[] = adm.helpdesks;
  const saveSla = (table: string, priority: string, index: 0 | 1, hours: number) => act.run(() => api('/admin/sla', { method: 'PUT', body: { table, priority, index, hours: Math.max(0.5, hours || 1) } }));
  const tbl = (title: string, obj: Record<string, [number, number]>, table: string, used: (p: string) => JSX.Element) => (
    <section className="panel adm-sec">
      <div className="adm-head"><h3>{title}</h3><p>Response and resolution targets by priority, in hours. New tickets use the new values; open tickets keep their due dates. Values are TC until sign-off.</p></div>
      <div className="tbl-wrap">
        <table className="t">
          <thead><tr><th>Priority</th><th>First response (h)</th><th>Resolution (h)</th><th>Used by</th></tr></thead>
          <tbody>
            {Object.entries(obj).map(([p, [r, x]]) => (
              <tr key={p} style={{ cursor: 'default' }}>
                <td><PriFlag p={p} /></td>
                <td><NumIn id={`sla-${table}-${p}-0`} value={r} min={0.5} step={0.5} width={90} label={`${p} first response hours`} onSave={(n) => saveSla(table, p, 0, n)} /></td>
                <td className="nowrap"><NumIn id={`sla-${table}-${p}-1`} value={x} min={1} width={90} label={`${p} resolution hours`} onSave={(n) => saveSla(table, p, 1, n)} /> <span className="muted" style={{ fontSize: 12 }}>{fmtH(x)}</span></td>
                <td>{used(p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
  const ov = (h: string) => {
    const list = adm.categories.filter((c: any) => c.helpdesk === h && c.slaOverride);
    return list.length ? list.map((c: any, i: number) => <span key={c.key}>{i > 0 && '; '}<b>{c.name}</b>: {Object.entries(c.slaOverride as Record<string, [number, number]>).map(([p, [r, x]]) => `${p} ${fmtH(r)} / ${fmtH(x)}`).join(' · ')}</span>) : 'none';
  };
  const people = adm.people;
  return (
    <>
      <div className="note info" style={{ margin: '0 0 16px' }}><Icon n="info" s={15} /><p>Changes apply to tickets raised after you save. Open tickets keep the SLA they were raised under. Each save creates a new version below; older versions stay readable.</p></div>
      {tbl('SLA targets · HR and L&D (shared)', adm.sla.shared, 'shared', (p) => <>{['HR', 'LND'].filter((h) => (cfg.priorities[h] ?? []).includes(p)).map((h) => <span key={h}><HdBadge hd={h} /> </span>)}</>)}
      {tbl('SLA targets · IT and Support', adm.sla.IT, 'IT', () => <HdBadge hd="IT" />)}
      <div className="note info" style={{ margin: '-6px 0 16px' }}><Icon n="info" s={15} /><p>Category overrides: {ov('IT')}. Security and incident tickets always start at Critical.</p></div>
      {tbl('SLA targets · Admin Desk', adm.sla.ADM, 'ADM', () => <HdBadge hd="ADM" />)}
      <div className="note info" style={{ margin: '-6px 0 16px' }}><Icon n="info" s={15} /><p>Category overrides: {ov('ADM')}.</p></div>
      <section className="panel adm-sec">
        <div className="adm-head"><h3>SLA rules</h3><p>Apply to {hds.includes('SF') ? 'every helpdesk except Salesforce' : 'every helpdesk'}.</p></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, padding: '12px 16px' }}>
          {Object.keys(adm.rules).map((k) => (
            <label key={k} className="sw"><input type="checkbox" id={`r-${k}`} checked={!!adm.rules[k]} onChange={(e) => act.run(() => api('/admin/rules', { method: 'PUT', body: { key: k, value: e.target.checked } }))} />{adm.ruleLabels[k]}{k === 'businessHours' && <> (Mon–Fri, 09:30–18:30 IST) <mark className="tc">TC</mark></>}</label>
          ))}
        </div>
        {hds.includes('SF') && <div className="note sf" style={{ margin: '0 16px 16px' }}><Icon n="cloud" s={15} /><p>Salesforce cases use entitlement milestones and escalation rules set in Salesforce. They are mirrored here read-only.</p></div>}
      </section>
      {['HR', 'LND', 'IT', 'ADM'].map((h) => (
        <section key={h} className="panel adm-sec">
          <div className="adm-head"><HdBadge hd={h} /><h3>{HDL[h]} escalation ladder</h3><p>Tickets escalate automatically when this share of the resolution time is used. Agents can also escalate manually from the ticket.</p></div>
          <div className="tbl-wrap">
            <table className="t">
              <thead><tr><th>Level</th><th>Escalate to</th><th>Role shown on ticket</th><th>Trigger at</th></tr></thead>
              <tbody>
                {(adm.escalation[h] as { who: string; role: string; pct: number }[]).map((l, i) => (
                  <tr key={i} style={{ cursor: 'default' }}>
                    <td className="mono">L{i + 1}</td>
                    <td>
                      <select className="in" id={`esc-${h}-${i}`} aria-label={`L${i + 1} escalation target`} value={l.who} onChange={(e) => act.run(() => api('/admin/escalation', { method: 'PUT', body: { helpdesk: h, level: i, who: e.target.value } }))}>
                        {h !== 'LND' && <option value="lead">Category lead (per category)</option>}
                        {people.map((x: any) => <option key={x.id} value={x.id}>{x.name} · {x.title}</option>)}
                      </select>
                    </td>
                    <td>{l.role}</td>
                    <td className="nowrap"><NumIn id={`escp-${h}-${i}`} value={l.pct} min={10} max={100} width={80} label={`L${i + 1} trigger percent`} onSave={(n) => act.run(() => api('/admin/escalation', { method: 'PUT', body: { helpdesk: h, level: i, pct: Math.min(100, Math.max(10, Math.round(n) || l.pct)) } }))} /> % of resolution time</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <SlaVersions adm={adm} />
    </>
  );
}

function SlaVersions({ adm }: { adm: Adm }) {
  const vers = (adm.slaVersions ?? []) as any[];
  return (
    <section className="panel adm-sec">
      <div className="adm-head"><h3>Version history</h3><p>Every SLA or escalation change freezes a new version. Tickets raised after a save bind to it; the number of open tickets on each version is shown.</p></div>
      <div className="tbl-wrap">
        <table className="t">
          <thead><tr><th>Version</th><th>Effective from</th><th>Changed by</th><th>Change</th><th>Open tickets</th></tr></thead>
          <tbody>
            {vers.length ? vers.map((v) => (
              <tr key={v.id} style={{ cursor: 'default' }}>
                <td className="mono">v{v.id}</td>
                <td className="nowrap">{fdt(v.effectiveFrom)}</td>
                <td>{v.setByName}</td>
                <td>{v.note ?? '—'}</td>
                <td className="mono">{v.openOnVersion}</td>
              </tr>
            )) : <tr style={{ cursor: 'default' }}><td colSpan={5} className="muted">No versions yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Performance() {
  const nav = useNavigate();
  const toast = useUi((s) => s.toast);
  const [scope, setScope] = useState('ALL');
  const [range, setRange] = useState('30');
  const [q, setQ] = useState('');
  const [drill, setDrill] = useState<{ label: string; keys: string[] } | null>(null);
  const [showData, setShowData] = useState(false);
  const { data: p, isLoading, error } = usePerformance({ hd: scope, range, q }, true);
  const dur = (ms: number | null) => (ms == null ? '—' : ms < 3600000 ? `${Math.max(1, Math.round(ms / 60000))}m` : `${(ms / 3600000).toFixed(1)}h`);
  const exportCsv = () => {
    if (!p) return;
    const head = ['Assignee', 'Helpdesk', 'Handled', 'Within SLA', 'Within SLA after manual escalation', 'Resolved late', 'Response breached', 'Resolution breached', 'Escalated (auto)', 'Escalated (manual)', 'Covered for absence', 'Received via escalation', 'Open', 'Overdue', 'At risk', 'Reopened', 'Avg first response (h)', 'Avg resolution (h)', 'Compliance %'];
    const body = p.rows.map((r) => [r.name, HDL[r.helpdesk], r.handled, r.withinSla, r.withinAfterManual, r.resolvedLate, r.responseBreached, r.resolutionBreached, r.escalatedAuto, r.escalatedManual, r.coveredForAbsence, r.receivedViaEscalation, r.open, r.overdue, r.atRisk, r.reopened, r.avgFirstMs == null ? '' : (r.avgFirstMs / 3600000).toFixed(2), r.avgResolutionMs == null ? '' : (r.avgResolutionMs / 3600000).toFixed(2), r.compliancePct ?? '']);
    const csv = [head, ...body].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const el = document.createElement('a');
    el.href = url; el.download = `assignee-performance-${range}.csv`; el.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('CSV exported');
  };
  const maxC = Math.max(1, ...(p?.chart.map((x) => x.n) ?? [1]));
  return (
    <section className="panel adm-sec">
      <div className="adm-head">
        <h3>Assignee performance</h3>
        <div className="seg" aria-label="Helpdesk">{p?.scopes.map(([k, l]) => <button key={k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)}>{l}</button>)}</div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>Range
          <select className="in" value={range} onChange={(e) => setRange(e.target.value)}>{[['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['year', 'This year']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>Search
          <input className="in" type="search" value={q} placeholder="Name" onChange={(e) => setQ(e.target.value)} />
        </label>
        <span className="r"><button className="btn sm" onClick={exportCsv} disabled={!p}><Icon n="down" s={14} />Export CSV</button></span>
        <p>How each assignee's tickets ended: inside the SLA, late, breached, escalated, covered for an absence or reopened. Compliance counts resolved tickets only. Everyone sees the same numbers.</p>
      </div>
      {isLoading && !p ? <Skeleton /> : error ? (
        <div className="note bad" style={{ margin: 16 }}><Icon n="info" s={15} /><p>The report could not be loaded. {(error as Error).message}</p></div>
      ) : p ? (
        <>
          <div className="kpis" style={{ padding: '4px 16px 0' }}>
            {p.cards.map((c) => <div key={c.l} className={`kpi tone-${c.tone ?? 'info'}`} data-tip={c.h}><span className="l"><span className="ki"><Icon n={c.ic} s={16} /></span>{c.l}</span><span className="n">{c.n}</span><span className="h">{c.h}</span></div>)}
          </div>
          <div style={{ padding: '4px 16px 0' }}>
            <b style={{ fontSize: 13 }}>Compliance by assignee</b>
            <div className="hbars" style={{ marginTop: 8 }}>
              {p.chart.map((x) => <div key={x.label} className="hbar" data-tip={`${x.label}: ${x.n}%`}><span className="lb">{x.label}</span><span className="tk">{x.n > 0 && <i style={{ width: `${(x.n / maxC) * 100}%` }} />}</span><span className="v">{x.n}%</span></div>)}
            </div>
            <button className="linkbtn" style={{ marginTop: 6 }} onClick={() => setShowData(!showData)}>{showData ? 'Hide data' : 'Show data'}</button>
            {showData && <div className="tbl-wrap"><table className="t"><thead><tr><th>Assignee</th><th>Compliance %</th></tr></thead><tbody>{p.chart.map((x) => <tr key={x.label} style={{ cursor: 'default' }}><td>{x.label}</td><td className="mono">{x.n}</td></tr>)}</tbody></table></div>}
          </div>
          <div className="tbl-wrap">
            <table className="t">
              <thead><tr><th>Assignee</th><th>Helpdesk</th><th>Handled</th><th>Within SLA</th><th>Late</th><th>Esc (auto)</th><th>Esc (manual)</th><th>Covered</th><th>Open</th><th>Overdue</th><th>At risk</th><th>Reopened</th><th>Avg first</th><th>Avg resolve</th><th>Compliance</th></tr></thead>
              <tbody>
                {p.rows.length ? p.rows.map((r) => (
                  <tr key={r.userId} style={{ cursor: 'default' }}>
                    <td className="nowrap"><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Avatar name={r.name} sm />{r.name}</span>{r.title && <div className="sub">{r.title}</div>}</td>
                    <td><HdBadge hd={r.helpdesk} /></td>
                    <td className="mono"><button className="linkbtn" onClick={() => setDrill({ label: `${r.name} · handled`, keys: r.keys })}>{r.handled}</button></td>
                    <td className="mono">{r.withinSla + r.withinAfterManual}</td>
                    <td className="mono">{r.resolvedLate}</td>
                    <td className="mono">{r.escalatedAuto}</td>
                    <td className="mono">{r.escalatedManual}</td>
                    <td className="mono">{r.coveredForAbsence}</td>
                    <td className="mono">{r.open}</td>
                    <td className="mono">{r.overdue}</td>
                    <td className="mono">{r.atRisk}</td>
                    <td className="mono">{r.reopened}</td>
                    <td className="nowrap">{dur(r.avgFirstMs)}</td>
                    <td className="nowrap">{dur(r.avgResolutionMs)}</td>
                    <td className="mono">{r.compliancePct == null ? '—' : `${r.compliancePct}%`}</td>
                  </tr>
                )) : <tr style={{ cursor: 'default' }}><td colSpan={15} className="muted">No tickets in this range.</td></tr>}
                <tr style={{ cursor: 'default' }} className="off">
                  <td><b>Unassigned (queues)</b></td><td className="muted">—</td>
                  <td className="mono"><button className="linkbtn" onClick={() => setDrill({ label: 'Unassigned (queues) · handled', keys: p.unassigned.keys })}>{p.unassigned.handled}</button></td>
                  <td colSpan={5} className="muted">—</td>
                  <td className="mono">{p.unassigned.open}</td><td className="mono">{p.unassigned.overdue}</td><td className="mono">{p.unassigned.atRisk}</td>
                  <td colSpan={4} className="muted">—</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="note info" style={{ margin: '0 16px 12px' }}><Icon n="info" s={15} /><p>Reconciliation: {p.reconciliation.handled} handled by named assignees + {p.reconciliation.unassigned} unassigned in queues = {p.reconciliation.total} tickets in scope. This matches the dashboard total for the same range and helpdesk.</p></div>
          <div style={{ padding: '0 16px 16px' }}>
            <b style={{ fontSize: 13 }}>Unattended <mark className="tc">TC</mark></b>
            <p className="muted" style={{ fontSize: 12.5, margin: '4px 0' }}>Tickets raised while no eligible cover was available, kept with the category lead.</p>
            <div className="tbl-wrap"><table className="t"><thead><tr><th>Ticket</th><th>Helpdesk</th><th>Title</th><th>Held by</th></tr></thead>
              <tbody>{p.unattended.length ? p.unattended.map((u) => <tr key={u.key} style={{ cursor: 'pointer' }} onClick={() => nav(`/ticket/${u.key}`)}><td className="mono">{u.key}</td><td><HdBadge hd={u.helpdesk} /></td><td>{u.title}</td><td>{u.assignee}</td></tr>) : <tr style={{ cursor: 'default' }}><td colSpan={4} className="muted">No unattended tickets.</td></tr>}</tbody>
            </table></div>
          </div>
          {drill && (
            <div className="note info" style={{ margin: '0 16px 16px' }}><Icon n="file" s={15} /><p><b>{drill.label}</b> · {drill.keys.length} ticket{drill.keys.length === 1 ? '' : 's'}{drill.keys.length > 0 && ':'}{' '}{drill.keys.map((k, i) => <span key={k}>{i > 0 && ', '}<button className="linkbtn" onClick={() => nav(`/ticket/${k}`)}>{k}</button></span>)}<button className="linkbtn" style={{ marginLeft: 10 }} onClick={() => setDrill(null)}>Close</button></p></div>
          )}
        </>
      ) : null}
    </section>
  );
}

function Roles({ adm, cfg, leadHd }: { adm: Adm; cfg: any; leadHd: boolean }) {
  const a = useUi((s) => s.adm);
  const set = useUi((s) => s.set);
  const act = useAction();
  const cats = adm.categories.filter((c: any) => c.helpdesk === a.hd);
  const cand = leadHd ? adm.people : [...((adm.agents[a.hd] ?? []) as any[]).filter((x) => x.isQueue), ...adm.people];
  const staff = adm.people.filter((x: any) => x.roles.some((r: string) => r !== 'EMP' && r !== 'MANAGER'));
  const hrName = (k: string) => cfg.categories.find((c: any) => c.helpdesk === 'HR' && c.key === k)?.name ?? k;
  return (
    <>
      <section className="panel adm-sec">
        <div className="adm-head"><h3>Category leads and routing</h3><HdSeg hds={adm.helpdesks} /><p>{ROUTING_NOTE[a.hd]}</p></div>
        <div className="tbl-wrap">
          <table className="t">
            <thead><tr><th>Category</th><th>{leadHd ? 'Category lead' : 'Owner / queue'}</th><th>Open tickets</th>{leadHd && <th>Confidential</th>}</tr></thead>
            <tbody>
              {cats.map((c: any) => (
                <tr key={c.key} style={{ cursor: 'default' }} className={`${a.flash === c.key ? 'flash' : ''} ${c.active ? '' : 'off'}`}>
                  <td>{c.name}</td>
                  <td>
                    <select className="in" id={`lead-${a.hd}-${c.key}`} aria-label={`Lead for ${c.name}`} value={c.leadId || c.ownerId || ''} onChange={(e) => { set((s) => ({ adm: { ...s.adm, flash: c.key } })); act.run(() => api(`/admin/categories/${c.id}/lead`, { method: 'PATCH', body: { userId: e.target.value } })); }}>
                      {cand.map((x: any) => <option key={x.id} value={x.id}>{x.name}{x.title ? ` · ${x.title}` : ''}</option>)}
                    </select>
                  </td>
                  <td className="mono">{c.openCount}</td>
                  {leadHd && <td>{c.confidential ? <span className="lock"><Icon n="lock" s={12} />Yes</span> : <span className="muted">No</span>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel adm-sec">
        <div className="adm-head"><h3>People with helpdesk roles</h3><span className="r"><button className="btn sm primary" onClick={() => set({ modal: { type: 'role' } })}><Icon n="plus" s={14} />Assign role</button></span><p>Managers come from reporting lines in NPSTX and are not edited here.</p></div>
        <div className="tbl-wrap">
          <table className="t">
            <thead><tr><th>Employee</th><th>Department</th><th>Helpdesk roles</th><th>HR categories worked</th><th>Lead / owner of</th><th></th></tr></thead>
            <tbody>
              {staff.map((x: any) => (
                <tr key={x.id} style={{ cursor: 'default' }}>
                  <td className="nowrap"><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Avatar name={x.name} sm />{x.name}</span><div className="sub">{x.title}</div></td>
                  <td>{x.dept}</td>
                  <td><div className="subs">{x.roles.filter((r: string) => r !== 'EMP').map((r: string) => <span key={r} className="chip">{cfg.roleLabels[r] ?? r}</span>)}</div></td>
                  <td><div className="subs">{x.hrCategories.length ? x.hrCategories.map((k: string) => <span key={k} className="chip">{hrName(k)}</span>) : <span className="muted">—</span>}</div></td>
                  <td><div className="subs">{x.leads.length ? x.leads.map((l: string) => <span key={l} className="chip">{l}</span>) : <span className="muted">—</span>}</div></td>
                  <td><button className="btn sm" onClick={() => set({ modal: { type: 'role', userId: x.id } })}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export default function AdminPage() {
  const { data: me } = useMe();
  const { data: cfg } = useConfig();
  const ok = !!me?.flags.helpdeskAdmin;
  const { data: adm } = useAdmin(ok);
  const a = useUi((s) => s.adm);
  const set = useUi((s) => s.set);
  useEffect(() => {
    if (adm && !adm.helpdesks.includes(a.hd)) set((s) => ({ adm: { ...s.adm, hd: adm.helpdesks[0] } }));
  }, [adm, a.hd, set]);
  if (!me) return <Skeleton />;
  if (!ok) return <Denied code="403" title="The Admin console is for Helpdesk admins only." text="Switch the demo role to Asha Kulkarni (Helpdesk Admin) to open it." />;
  if (!adm || !cfg) return <Skeleton />;
  const leadHd = cfg.leadHelpdesks.includes(a.hd);
  return (
    <div className="adm">
      <nav className="panel adm-nav" aria-label="Admin sections">
        {TABS.map(([k, l, i]) => <button key={k} className={a.tab === k ? 'on' : ''} onClick={() => set((s) => ({ adm: { ...s.adm, tab: k as never, flash: null } }))}><Icon n={i} s={16} />{l}</button>)}
      </nav>
      <div style={{ minWidth: 0 }}>
        {a.tab === 'categories' && <Categories adm={adm} leadHd={leadHd} />}
        {a.tab === 'fields' && <Fields adm={adm} cfg={cfg} />}
        {a.tab === 'sla' && <Sla adm={adm} cfg={cfg} />}
        {a.tab === 'roles' && <Roles adm={adm} cfg={cfg} leadHd={leadHd} />}
        {a.tab === 'perf' && <Performance />}
        <section className="panel">
          <div className="adm-head"><h3>Configuration audit log</h3><p>Every change is recorded with who made it and when.</p></div>
          <ul className="audit">{adm.audit.map((l: any, i: number) => <li key={i}><Avatar name={l.actorName} sm /><span>{l.text}</span><time>{fdt(l.at)} · {l.actorName}</time></li>)}</ul>
        </section>
      </div>
    </div>
  );
}
