import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { PerfCol, PerfRow, Performance } from '../../api/types';
import { HDL } from '../../lib/format';
import { Icon } from '../../lib/icons';
import { useUi } from '../../store/ui';
import { Avatar, HdBadge, Skeleton } from '../common/bits';

/** Column order, header and tooltip. Every count is a set of ticket keys you can open. */
export const PERF_COLS: [PerfCol, string, string][] = [
  ['assigned', 'Assigned', 'Tickets that reached this person by routing, absence cover or a queue claim. Equals the eight outcome columns added up.'],
  ['withinSla', 'Resolved within SLA', 'Resolved by this person before the resolution target.'],
  ['late', 'Resolved late', 'Resolved by this person after the resolution target.'],
  ['escSla', 'Escalated by SLA', 'Moved to the next level automatically because the escalation threshold was reached while this person held it.'],
  ['escManual', 'Escalated manually', 'Escalated by someone using Escalate while this person held it.'],
  ['reManual', 'Reassigned manually', 'Handed to someone else using Reassign.'],
  ['reAbsence', 'Reassigned for absence', 'Moved to a cover because this person was on leave when the ticket became workable. Not an escalation.'],
  ['open', 'Still open', 'Still with this person and not closed.'],
  ['rejected', 'Rejected or cancelled', 'Closed as Rejected, Cancelled or Duplicate while with this person. Left out of SLA metrics.'],
  ['respWithin', 'Response within', 'First public reply sent before the response target, credited to whoever held the ticket at that moment.'],
  ['respBreached', 'Response breached', 'First reply missed the response target while this person held the ticket.'],
  ['slaBreached', 'SLA breached', 'Derived: resolved late + escalated by SLA + still open and overdue.'],
  ['recvEsc', 'Received by escalation', 'Arrived from someone else through escalation. Not in Assigned, so nobody is counted twice.'],
  ['recvReasg', 'Received by reassignment', 'Arrived from someone else through a manual reassignment.'],
  ['covered', 'Covered', 'Of Assigned: tickets this person took as cover for an absent colleague.'],
  ['overdueNow', 'Overdue now', 'Live: open tickets this person holds that are past the resolution due time.'],
];
const OUTCOMES: PerfCol[] = ['withinSla', 'late', 'escSla', 'escManual', 'reManual', 'reAbsence', 'open', 'rejected'];
const dur = (ms: number | null) => (ms == null ? '—' : ms < 3600000 ? `${Math.max(1, Math.round(ms / 60000))} min` : `${(ms / 3600000).toFixed(1)} h`);
const RANGES = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['year', 'This year']];

type SortK = 'name' | PerfCol | 'avgFirstMs' | 'avgResolutionMs';

export function PerfReport({ p, loading, error, mine, ctl }: {
  p: Performance | undefined; loading: boolean; error: unknown; mine?: boolean;
  ctl: { scope?: string; setScope?: (v: string) => void; range: string; setRange: (v: string) => void; q: string; setQ: (v: string) => void; group?: string; setGroup?: (v: string) => void };
}) {
  const nav = useNavigate();
  const toast = useUi((s) => s.toast);
  const [sort, setSort] = useState<{ k: SortK; d: 1 | -1 }>({ k: 'assigned', d: -1 });
  const [drill, setDrill] = useState<{ label: string; keys: string[] } | null>(null);
  const log = (event: 'open' | 'filter' | 'export', detail = '') => !mine && api('/admin/performance/log', { body: { event, detail } }).catch(() => undefined);
  const first = useRef(true);
  useEffect(() => {
    if (!mine) log('open');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    const t = window.setTimeout(() => log('filter', `helpdesk ${ctl.scope ?? 'ALL'}, range ${ctl.range}, group ${ctl.group ?? 'assignee'}${ctl.q ? `, search "${ctl.q}"` : ''}`), 800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl.scope, ctl.range, ctl.q, ctl.group]);

  const rows = useMemo(() => {
    const v = (r: PerfRow) => (sort.k === 'name' ? `${r.name} ${r.category ?? ''}` : sort.k === 'avgFirstMs' || sort.k === 'avgResolutionMs' ? r[sort.k] ?? -1 : r.counts[sort.k]);
    return [...(p?.rows ?? [])].sort((a, b) => { const x = v(a), y = v(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.d || a.name.localeCompare(b.name); });
  }, [p, sort]);
  const byCat = p?.group === 'category';
  const label = (r: PerfRow) => (byCat ? `${r.name} · ${r.category}` : r.name);

  const exportCsv = () => {
    if (!p) return;
    const head = [byCat ? 'Assignee · category' : 'Assignee', 'Helpdesk', ...PERF_COLS.map((c) => c[1]), 'Avg first response (h)', 'Avg resolution (h)'];
    const body = rows.map((r) => [label(r), r.helpdesk ? HDL[r.helpdesk] : '', ...PERF_COLS.map(([k]) => r.counts[k]), r.avgFirstMs == null ? '' : (r.avgFirstMs / 3600000).toFixed(2), r.avgResolutionMs == null ? '' : (r.avgResolutionMs / 3600000).toFixed(2)]);
    if (p.unassigned) body.push(['Unassigned (queues)', '', ...PERF_COLS.map(([k]) => p.unassigned!.counts[k]), '', '']);
    const csv = [head, ...body].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const el = document.createElement('a');
    el.href = url; el.download = `${mine ? 'my' : 'assignee'}-performance-${ctl.range}.csv`; el.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    log('export', `${rows.length} rows`);
    toast('CSV exported');
  };
  const th = (k: SortK, l: string, tip: string, num = true) => (
    <th key={k} className={num ? 'num' : ''} data-tip={tip} aria-sort={sort.k === k ? (sort.d === 1 ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => setSort((s) => ({ k, d: s.k === k ? (-s.d as 1 | -1) : k === 'name' ? 1 : -1 }))}>{l}</button>
    </th>
  );
  const cell = (who: string, c: PerfCol, n: number, keys: string[]) => (
    <td key={c} className="num">{n ? <button onClick={() => setDrill({ label: `${who} · ${PERF_COLS.find((x) => x[0] === c)![1]}`, keys })}>{n}</button> : <span className="muted">0</span>}</td>
  );
  const rc = p?.reconciliation;
  const okA = rc && rc.peopleAssigned + rc.queueAssigned === rc.directTotal;
  const okE = rc && rc.escDirect + rc.escInherited === rc.escHandovers;
  const okO = rc && rc.overdueRows === rc.overdueCard;

  return (
    <section className="panel adm-sec">
      <div className="adm-head">
        <h3>{mine ? 'My performance' : 'Assignee performance'}</h3>
        {!mine && p && <div className="seg" aria-label="Helpdesk">{p.scopes.map(([k, l]) => <button key={k} className={ctl.scope === k ? 'on' : ''} onClick={() => ctl.setScope?.(k)}>{l}</button>)}</div>}
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>Range
          <select className="in" id="perf-range" value={ctl.range} onChange={(e) => ctl.setRange(e.target.value)}>{RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        {!mine && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>Group by
            <select className="in" id="perf-group" value={ctl.group} onChange={(e) => ctl.setGroup?.(e.target.value)}><option value="assignee">Assignee</option><option value="category">Assignee and category</option></select>
          </label>
        )}
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>Search
          <input className="in" type="search" id="perf-q" value={ctl.q} placeholder={mine ? 'Category' : 'Name or category'} onChange={(e) => ctl.setQ(e.target.value)} />
        </label>
        <span className="r"><button className="btn sm" onClick={exportCsv} disabled={!p}><Icon n="down" s={14} />Export CSV</button></span>
        <p>{mine
          ? 'Your tickets by category, counted only for the time you held each one. Tickets you received from a colleague are shown separately.'
          : 'How each assignee’s tickets ended, counted only for the time they held each one. Hover a column for its definition; select a number to see the tickets.'}</p>
      </div>
      {loading && !p ? <Skeleton /> : error ? (
        <div className="note bad" style={{ margin: 16 }}><Icon n="info" s={15} /><p>The report could not be loaded. {(error as Error).message}</p></div>
      ) : p ? (
        <>
          <div className="kpis k6" style={{ padding: '4px 16px 0' }}>
            {p.cards.map((c) => <div key={c.k} className={`kpi tone-${c.tone ?? 'info'}`} data-tip={c.h}><span className="l"><span className="ki"><Icon n={c.ic} s={16} /></span>{c.l}<span className="kchip rng">In date range</span></span><span className="n">{c.n}</span><span className="h">{c.h}</span></div>)}
          </div>
          <div className="tbl-wrap" style={{ marginTop: 12 }}>
            <table className="t perf-t">
              <thead><tr>{th('name', byCat || mine ? 'Assignee · category' : 'Assignee', 'The person who held the ticket', false)}{PERF_COLS.map(([k, l, tip]) => th(k, l, tip))}{th('avgFirstMs', 'Avg first response', 'Average time from SLA start to the first public reply, for replies credited to this person.')}{th('avgResolutionMs', 'Avg resolution', 'Average time from SLA start to resolution, for tickets this person resolved.')}</tr></thead>
              <tbody>
                {rows.length ? rows.map((r) => (
                  <tr key={r.id} style={{ cursor: 'default' }}>
                    <td className="nowrap"><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Avatar name={r.name} sm />{r.name}</span><div className="sub">{byCat ? <>{r.helpdesk && <HdBadge hd={r.helpdesk} />} {r.category}</> : r.title}</div></td>
                    {PERF_COLS.map(([k]) => cell(label(r), k, r.counts[k], r.drill[k]))}
                    <td className="num nowrap">{dur(r.avgFirstMs)}</td><td className="num nowrap">{dur(r.avgResolutionMs)}</td>
                  </tr>
                )) : <tr style={{ cursor: 'default' }}><td colSpan={PERF_COLS.length + 3} className="muted">No tickets reached {mine ? 'you' : 'anyone'} in this range.</td></tr>}
                {p.unassigned && (
                  <tr className="q" style={{ cursor: 'default' }}>
                    <td><b>Unassigned (queues)</b><div className="sub">Time tickets spent in a queue before someone claimed them</div></td>
                    {PERF_COLS.map(([k]) => cell('Unassigned (queues)', k, p.unassigned!.counts[k], p.unassigned!.drill[k]))}
                    <td className="num muted">—</td><td className="num muted">—</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {drill && (
            <div className="note info" style={{ margin: '0 16px 12px' }}><Icon n="file" s={15} /><p><b>{drill.label}</b> · {drill.keys.length} ticket{drill.keys.length === 1 ? '' : 's'}:{' '}{drill.keys.map((k, i) => <span key={k}>{i > 0 && ', '}<button className="linkbtn" onClick={() => nav(`/ticket/${k}`)}>{k}</button></span>)}<button className="linkbtn" style={{ marginLeft: 10 }} onClick={() => setDrill(null)}>Close</button></p></div>
          )}
          <div className="note info" style={{ margin: '0 16px 12px' }}><Icon n="users" s={15} /><p><b>How this stays fair.</b> Each ticket counts once per person who held it, and only for their own time with it. Outcomes ({OUTCOMES.length} columns from Resolved within SLA to Rejected or cancelled) add up to Assigned. A ticket received by escalation or reassignment is listed under Received, not Assigned, so a ticket that arrives already late is not blamed on the receiver. Cover for a colleague on leave is a reassignment, never an escalation. There is no single compliance score.</p></div>
          {!mine && rc && (
            <div className="recon" style={{ margin: '0 16px 12px' }} aria-label="Reconciliation">
              <span className={okA ? 'ok' : 'bad'}>Assigned: {rc.peopleAssigned} to people + {rc.queueAssigned} to queues = {rc.directTotal}</span>
              <span className={okE ? 'ok' : 'bad'}>Escalation handovers: {rc.escDirect} from direct holders + {rc.escInherited} from received tickets = {rc.escHandovers}</span>
              <span className={okO ? 'ok' : 'bad'}>Overdue now: {rc.overdueRows} in rows = {rc.overdueCard} on the dashboard Overdue card</span>
            </div>
          )}
          {!mine && (
            <div style={{ padding: '0 16px 16px' }}>
              <b style={{ fontSize: 13 }}>Unattended</b>
              <p className="muted" style={{ fontSize: 12.5, margin: '4px 0' }}>Open tickets that became workable while no eligible cover was available. They stay with the category lead; Helpdesk admins were notified.</p>
              <div className="tbl-wrap"><table className="t"><thead><tr><th>Ticket</th><th>Helpdesk</th><th>Title</th><th>Held by</th><th>Status</th></tr></thead>
                <tbody>{p.unattended.length ? p.unattended.map((u) => <tr key={u.key} style={{ cursor: 'pointer' }} onClick={() => nav(`/ticket/${u.key}`)}><td className="mono">{u.key}</td><td><HdBadge hd={u.helpdesk} /></td><td>{u.title}</td><td>{u.assignee}</td><td>{u.status}</td></tr>) : <tr style={{ cursor: 'default' }}><td colSpan={5} className="muted">No unattended tickets.</td></tr>}</tbody>
              </table></div>
            </div>
          )}
          {!mine && <p className="muted" style={{ fontSize: 12, margin: '0 16px 16px' }}>Opening, filtering and exporting this report are written to the audit log. Showing {p.scope === 'ALL' ? 'all helpdesks' : HDL[p.scope]} · {p.rangeLabel}.</p>}
        </>
      ) : null}
    </section>
  );
}
