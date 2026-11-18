import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMe, useTickets } from '../api/hooks';
import type { ListItem } from '../api/types';
import { Denied, EscBadge, ErrorState, HdBadge, Lock, Pill, PriFlag, SlaCell, Skeleton, Who } from '../components/common/bits';
import { fd, fdt, HDL } from '../lib/format';
import { Icon } from '../lib/icons';
import { emptyFilters, useUi, type TicketFilters } from '../store/ui';

const SORT_LABEL: Record<string, string> = { key: 'ticket ID', pri: 'priority', updated: 'last updated', created: 'created', sla: 'SLA due', closed: 'resolution date' };
const ASSIGNED_VIEWS: [string, string][] = [['assigned', 'Assigned to me'], ['queues', 'My queues'], ['unassigned', 'Unassigned in my queues']];

function Th({ k, l, f, onSort }: { k: string; l: string; f: TicketFilters; onSort: (k: string) => void }) {
  return (
    <th aria-sort={f.sort.k === k ? (f.sort.d < 0 ? 'descending' : 'ascending') : undefined}>
      <button className={f.sort.k === k ? 'on' : ''} onClick={() => onSort(k)}>{l}{f.sort.k === k ? (f.sort.d < 0 ? ' ↓' : ' ↑') : ''}</button>
    </th>
  );
}

export default function TicketsPage({ mode }: { mode: 'mine' | 'assigned' }) {
  const asg = mode === 'assigned';
  const { data: me } = useMe();
  const key = asg ? 'adash' : 'dash';
  const f = useUi((s) => s[key]);
  const { set, demo, hl } = useUi();
  const nav = useNavigate();
  const views = asg ? ASSIGNED_VIEWS : me?.views ?? [['mine', 'Raised by me']];
  const hdTabs = ['ALL', ...(me?.helpdesks ?? [])];
  const upd = (p: Partial<TicketFilters>) => set((s) => ({ [key]: { ...s[key], page: 1, ...p } }) as never);
  useEffect(() => {
    if (!me) return;
    if (!views.some((v) => v[0] === f.view)) upd({ view: views[0][0] });
    if (!hdTabs.includes(f.hd)) upd({ hd: 'ALL' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, f.view, f.hd]);
  useEffect(() => {
    if (!hl) return;
    const t = setTimeout(() => set({ hl: null }), 2600);
    return () => clearTimeout(t);
  }, [hl, set]);
  const q = useTickets(f);
  if (!me) return <Skeleton />;
  if (asg && !me.flags.worker)
    return <Denied code="403" title="Assigned to me is for people who work tickets." back="/tickets" backLabel="Go to My tickets" />;

  const onSort = (k: string) => upd({ sort: f.sort.k === k ? { k, d: (-f.sort.d) as 1 | -1 } : { k, d: k === 'key' || k === 'pri' || k === 'sla' ? 1 : -1 }, page: f.page });
  const open = (t: ListItem) => nav(`/ticket/${t.key}`);
  const rowKeys = (t: ListItem) => ({ onClick: () => open(t), onKeyDown: (e: React.KeyboardEvent) => e.key === 'Enter' && open(t), tabIndex: 0 });
  const top = (
    <div className="toolbar" style={{ marginTop: 0 }}>
      <div className="seg" aria-label="Domain type">
        {hdTabs.map((h) => <button key={h} className={f.hd === h ? 'on' : ''} onClick={() => upd({ hd: h })}>{h === 'ALL' ? 'All helpdesks' : HDL[h]}</button>)}
      </div>
      {views.length > 1 && (
        <div className="seg" aria-label="Scope" style={{ marginLeft: 'auto' }}>
          {views.map(([k, l]) => <button key={k} className={f.view === k ? 'on' : ''} onClick={() => upd({ view: k })}>{l}</button>)}
        </div>
      )}
    </div>
  );
  if (demo === 'loading' || (q.isLoading && !q.data)) return <>{top}<Skeleton /></>;
  if (demo === 'error' || q.isError) return <>{top}<ErrorState message={demo === 'error' ? undefined : (q.error as Error)?.message} onRetry={() => { set({ demo: null }); q.refetch(); }} /></>;
  const d = q.data!;
  const pid = asg ? 'adash' : 'dash';
  return (
    <>
      {top}
      {d.flagLabel && (
        <div style={{ margin: '-2px 0 10px' }}>
          <span className="flagchip"><Icon n="chart" s={13} />From Dashboard: {d.flagLabel}<button aria-label="Remove filter" onClick={() => upd({ flag: null })}><Icon n="x" s={12} /></button></span>
        </div>
      )}
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={f.tab === 'open'} className={f.tab === 'open' ? 'on' : ''} onClick={() => upd({ tab: 'open' })}>Open tickets <span className="count">{d.counts.open}</span></button>
        <button role="tab" aria-selected={f.tab === 'closed'} className={f.tab === 'closed' ? 'on' : ''} onClick={() => upd({ tab: 'closed' })}>Closed tickets <span className="count">{d.counts.closed}</span></button>
      </div>
      <div className="panel tabbed">
        <div className="filters">
          <label>Search <input className="in" type="search" id={`f-${pid}-q`} value={f.q} placeholder="ID, title, person" onChange={(e) => upd({ q: e.target.value })} /></label>
          <label>Category <select className="in" id={`f-${pid}-cat`} value={f.cat} onChange={(e) => upd({ cat: e.target.value })}><option value="">All categories</option>{d.options.categories.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          {f.tab === 'open' ? (
            <>
              <label>Priority <select className="in" id={`f-${pid}-pri`} value={f.pri} onChange={(e) => upd({ pri: e.target.value })}><option value="">All</option>{['Critical', 'High', 'Medium', 'Low'].map((p) => <option key={p}>{p}</option>)}</select></label>
              <label>Status <select className="in" id={`f-${pid}-st`} value={f.status} onChange={(e) => upd({ status: e.target.value })}>
                <option value="">All</option>
                <optgroup label="Status (what employees see)">{['Open', 'In Progress', 'Pending Input'].map((x) => <option key={x} value={`ui:${x}`}>{x}</option>)}</optgroup>
                <optgroup label="Helpdesk status">{d.options.statuses.map((x) => <option key={x}>{x}</option>)}</optgroup>
              </select></label>
            </>
          ) : (
            <label>Closing response <select className="in" id={`f-${pid}-rs`} value={f.reason} onChange={(e) => upd({ reason: e.target.value })}><option value="">All</option>{['Resolved', 'Rejected', 'Cancelled', 'Closed'].map((p) => <option key={p}>{p}</option>)}</select></label>
          )}
          <label>Raised from <input className="in" type="date" id={`f-${pid}-from`} value={f.from} onChange={(e) => upd({ from: e.target.value })} /></label>
          <label>Raised to <input className="in" type="date" id={`f-${pid}-to`} value={f.to} onChange={(e) => upd({ to: e.target.value })} /></label>
          <button className="btn sm clear" onClick={() => set((s) => ({ [key]: { ...emptyFilters(s[key].view), hd: s[key].hd, tab: s[key].tab, sort: s[key].sort } }) as never)}>Clear filters</button>
        </div>
        {d.rows.length ? (
          <>
            <div className="tbl-wrap">
              <table className="t">
                {f.tab === 'open' ? (
                  <>
                    <thead><tr><Th k="key" l="Ticket ID" f={f} onSort={onSort} /><th>Domain type</th><th>Title</th><th>Category</th><Th k="pri" l="Priority" f={f} onSort={onSort} /><th>Status</th><th>Assigned to</th><Th k="created" l="Created" f={f} onSort={onSort} /><Th k="updated" l="Last updated" f={f} onSort={onSort} /><Th k="sla" l="SLA due" f={f} onSort={onSort} /></tr></thead>
                    <tbody>
                      {d.rows.map((t) => (
                        <tr key={t.key} className={hl === t.key ? 'hl' : ''} {...rowKeys(t)}>
                          <td className="mono nowrap">{t.key}</td>
                          <td><HdBadge hd={t.helpdesk} /></td>
                          <td className="title">{t.title} {t.confidential && <Lock />}{t.escalationLevel > 0 && <> <EscBadge lvl={t.escalationLevel} /></>}{t.requester.id !== me.id && <div className="sub">Raised by {t.requester.name}</div>}</td>
                          <td><div>{t.categoryName}</div><div className="sub">{t.subCategory}</div></td>
                          <td><PriFlag p={t.priority} /></td>
                          <td><Pill t={t} /><div className="sub">{t.uiStatus}</div></td>
                          <td className="nowrap"><Who p={t.assignee} /></td>
                          <td className="nowrap">{fd(t.createdAt)}</td>
                          <td className="nowrap">{fdt(t.updatedAt)}</td>
                          <td><SlaCell t={t} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                ) : (
                  <>
                    <thead><tr><Th k="key" l="Ticket ID" f={f} onSort={onSort} /><th>Domain type</th><th>Title</th><th>Category</th><th>Closing response</th><th>Closed by</th><Th k="closed" l="Resolution date" f={f} onSort={onSort} /><th>Reopen</th></tr></thead>
                    <tbody>
                      {d.rows.map((t) => (
                        <tr key={t.key} {...rowKeys(t)}>
                          <td className="mono nowrap">{t.key}</td>
                          <td><HdBadge hd={t.helpdesk} /></td>
                          <td className="title">{t.title}</td>
                          <td><div>{t.categoryName}</div><div className="sub">{t.subCategory}</div></td>
                          <td><Pill t={t} /></td>
                          <td className="nowrap"><Who p={t.closedBy} /></td>
                          <td className="nowrap">{fdt(t.closedAt)}</td>
                          <td onClick={(e) => e.stopPropagation()}>
                            {t.requester.id === me.id && t.reopen.ok ? (
                              <button className="btn sm" onClick={() => set({ modal: { type: 'reopen', key: t.key } })}><Icon n="reopen" s={13} />Reopen</button>
                            ) : <span className="sub">{t.reopen.short}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
              </table>
            </div>
            <div className="pager">
              <span>Showing {(d.page - 1) * d.size + 1}–{(d.page - 1) * d.size + d.rows.length} of {d.total} · sorted by {SORT_LABEL[f.sort.k]}</span>
              <span className="sp">{Array.from({ length: d.pages }, (_, i) => <button key={i} className={d.page === i + 1 ? 'on' : ''} aria-label={`Page ${i + 1}`} onClick={() => upd({ page: i + 1 })}>{i + 1}</button>)}</span>
            </div>
          </>
        ) : (
          <div className="empty">
            <Icon n="help" s={32} />
            <b>{f.view === 'approvals' ? 'Nothing waiting for your approval' : f.tab === 'open' ? 'No open tickets here' : 'No closed tickets yet'}</b>
            <span>{f.view === 'mine' && !f.flag && !f.q ? 'Tickets you raise show up here with their status and SLA due date.' : 'Try another scope or clear the filters.'}</span>
            {f.view === 'mine' && <button className="btn primary" onClick={() => set({ drawer: {} })}><Icon n="plus" s={15} />Raise ticket</button>}
          </div>
        )}
      </div>
    </>
  );
}
