import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useConfig, useFaqs, useFollowing, useHistory, useMe } from '../api/hooks';
import type { ListItem } from '../api/types';
import { Addition, HdBadge, Md, Pill, SlaCell, Skeleton, Who } from '../components/common/bits';
import { dur, fd, fdt, HDL, isoDate, p2 } from '../lib/format';
import { Icon } from '../lib/icons';
import { useUi } from '../store/ui';

const RL: Record<string, string> = { FOLLOWER: 'Following', CC: "CC'd" };
const relLabel = (rel?: string) => (rel === 'FOLLOWER' ? RL.FOLLOWER : rel ? RL.CC : '—');
const rowNav = (nav: (p: string) => void, t: ListItem) => ({ tabIndex: 0, onClick: () => nav(`/ticket/${t.key}`), onKeyDown: (e: React.KeyboardEvent) => e.key === 'Enter' && nav(`/ticket/${t.key}`) });

export function FollowingPage() {
  const { data: me } = useMe();
  const f = useUi((s) => s.fol);
  const set = useUi((s) => s.set);
  const nav = useNavigate();
  const { data } = useFollowing(f);
  if (!me || !data) return <Skeleton />;
  const upd = (p: Partial<typeof f>) => set((s) => ({ fol: { ...s.fol, ...p } }));
  const tabs = [['ALL', 'All'], ...Object.entries(RL)];
  return (
    <>
      <div className="toolbar" style={{ marginTop: 0 }}>
        <div className="seg">{tabs.map(([k, l]) => <button key={k} className={f.rel === k ? 'on' : ''} onClick={() => upd({ rel: k })}>{l} <span className="count">{data.counts[k] ?? 0}</span></button>)}</div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto', fontSize: 13 }}>Source{' '}
          <select className="in" id="f-fsrc" value={f.src} onChange={(e) => upd({ src: e.target.value })}>
            <option value="ALL">All sources</option>{me.helpdesks.map((h) => <option key={h} value={h}>{HDL[h]}</option>)}
          </select>
        </label>
        <div className="seg">{(['open', 'closed'] as const).map((k) => <button key={k} className={f.grp === k ? 'on' : ''} onClick={() => upd({ grp: k })}>{k === 'open' ? 'Open' : 'Closed'}</button>)}</div>
      </div>
      <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>Tickets you did not raise where you follow updates or were added as a CC, including @mentions. You see updates but cannot change status.</p>
      <div className="panel">
        {data.rows.length ? (
          <div className="tbl-wrap">
            <table className="t">
              <thead><tr><th>Ticket ID</th><th>Domain</th><th>Title</th><th>Why I see it</th><th>Raised by</th><th>Status</th><th>Owner</th><th>Updated</th><th>SLA</th><th></th></tr></thead>
              <tbody>
                {data.rows.map((t) => (
                  <tr key={t.key} {...rowNav(nav, t)}>
                    <td className="mono nowrap">{t.key}</td><td><HdBadge hd={t.helpdesk} /></td><td className="title">{t.title}</td>
                    <td><span className="chip">{relLabel(t.relation?.relation)}</span><div className="sub">by {t.relation?.addedBy}</div></td>
                    <td className="nowrap"><Who p={t.requester} /></td><td><Pill t={t} /></td><td className="nowrap"><Who p={t.assignee} /></td>
                    <td className="nowrap">{fdt(t.updatedAt)}</td><td><SlaCell t={t} /></td>
                    <td onClick={(e) => e.stopPropagation()}>{t.relation?.relation !== 'CASE_TEAM' ? <button className="btn sm" onClick={() => set({ modal: { type: 'unfollow', key: t.key } })}>Unfollow</button> : <span className="sub">Managed in Salesforce</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty"><Icon n="eye" s={32} /><b>Nothing to follow here</b><span>When a colleague adds you as a follower or CC, or tags you in a comment, the ticket appears here.</span></div>
        )}
      </div>
    </>
  );
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
function exportCsv(hd: string, rows: (ListItem & { closedState: string })[]) {
  const lines = [['Ticket ID', 'Title', 'Category', 'Closed state', 'Closed by', 'Closed on'], ...rows.map((t) => [t.key, t.title, `${t.categoryName} / ${t.subCategory}`, t.closedState, t.closedBy?.name ?? '', t.closedAt ? isoDate(t.closedAt) : ''])];
  const blob = new Blob([lines.map((r) => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${hd.toLowerCase()}-history.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function HistoryPage() {
  const { data: me } = useMe();
  const h = useUi((s) => s.hist);
  const set = useUi((s) => s.set);
  const nav = useNavigate();
  const hds = me?.helpdesks ?? [];
  const { data } = useHistory({ q: h.q, from: h.from, to: h.to, hds: hds.filter((x) => h.hds[x]).join(',') || 'NONE', states: Object.keys(h.states).filter((k) => h.states[k]).join(',') || 'NONE', cat: h.cat, scope: h.scope });
  if (!me || !data) return <Skeleton />;
  const upd = (p: Partial<typeof h>) => set((s) => ({ hist: { ...s.hist, ...p } }));
  const agent = me.flags.worker || me.flags.headish;
  const quick = (v: string) => {
    const now = new Date(me.now);
    upd({ quick: v, to: v === 'all' ? '' : isoDate(now), from: v === 'all' ? '' : v === 'year' ? `${isoDate(now).slice(0, 4)}-01-01` : isoDate(new Date(now.getTime() - Number(v) * 86400000)) });
  };
  const secs = data.sections.filter((s) => h.hds[s.helpdesk]);
  return (
    <div className="hist">
      <aside className="panel fpanel" aria-label="Filters">
        <div className="fgroup"><span>Search</span><input className="in" id="h-q" type="search" placeholder="ID or title" value={h.q} onChange={(e) => upd({ q: e.target.value })} /></div>
        {agent && (
          <div className="fgroup"><span>Scope</span>
            <div className="seg">
              <button className={h.scope === 'mine' ? 'on' : ''} onClick={() => upd({ scope: 'mine' })}>Raised by me</button>
              <button className={h.scope === 'handled' ? 'on' : ''} onClick={() => upd({ scope: 'handled' })}>Handled by me</button>
              {me.flags.headish && <button className={h.scope === 'all' ? 'on' : ''} onClick={() => upd({ scope: 'all' })}>All I can see</button>}
            </div>
          </div>
        )}
        <div className="fgroup"><span>Closed date</span>
          <div className="quick">{[['all', 'All time'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['year', '2026']].map(([k, l]) => <button key={k} className={h.quick === k ? 'on' : ''} onClick={() => quick(k)}>{l}</button>)}</div>
          <div className="row2">
            <label className="sr" htmlFor="h-from">From</label><input className="in" type="date" id="h-from" value={h.from} onChange={(e) => upd({ from: e.target.value, quick: '' })} />
            <label className="sr" htmlFor="h-to">To</label><input className="in" type="date" id="h-to" value={h.to} onChange={(e) => upd({ to: e.target.value, quick: '' })} />
          </div>
        </div>
        <div className="fgroup"><span>Helpdesk</span>{hds.map((x) => <label key={x} className="check"><input type="checkbox" id={`h-hd-${x}`} checked={!!h.hds[x]} onChange={(e) => upd({ hds: { ...h.hds, [x]: e.target.checked } })} /><HdBadge hd={x} /></label>)}</div>
        <div className="fgroup"><span>Closed state</span>{Object.keys(h.states).map((s) => <label key={s} className="check"><input type="checkbox" id={`h-st-${s}`} checked={h.states[s]} onChange={(e) => upd({ states: { ...h.states, [s]: e.target.checked } })} />{s}</label>)}</div>
        <div className="fgroup"><span>Category</span>
          <select className="in" id="h-cat" value={h.cat} onChange={(e) => upd({ cat: e.target.value })}><option value="">All categories</option>{data.categories.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </div>
        <button className="btn sm" onClick={() => upd({ q: '', from: '', to: '', quick: 'all', hds: { HR: true, LND: true, IT: true, ADM: true, SF: true }, states: { Resolved: true, Rejected: true, Cancelled: true, Closed: true, Duplicate: true }, cat: '' })}>Reset filters</button>
      </aside>
      <div>
        {secs.length ? secs.map((s) => (
          <section key={s.helpdesk} className="panel hsec">
            <header>
              <HdBadge hd={s.helpdesk} /><h3>{HDL[s.helpdesk]} <span className="count">{s.rows.length}</span></h3>
              <span className="muted" style={{ fontSize: 12 }}>{s.helpdesk === 'HR' ? 'Closed with closing response' : s.helpdesk === 'SF' ? 'Salesforce statuses with IsClosed = true' : 'Resolved, Closed, Rejected, Cancelled'}</span>
              <button className="btn sm" style={{ marginLeft: 'auto' }} disabled={!s.rows.length} onClick={() => exportCsv(s.helpdesk, s.rows)}><Icon n="down" s={14} />Export CSV</button>
            </header>
            {s.rows.length ? (
              <div className="tbl-wrap">
                <table className="t">
                  <thead><tr><th>Ticket ID</th><th>Title</th><th>Category</th><th>Closed state</th><th>Closed by</th><th>Closed on</th><th>Resolution time</th><th>Reopen</th></tr></thead>
                  <tbody>
                    {s.rows.map((t) => (
                      <tr key={t.key} {...rowNav(nav, t)}>
                        <td className="mono nowrap">{t.key}</td>
                        <td className="title">{t.title}{t.requester.id !== me.id && <div className="sub">Raised by {t.requester.name}</div>}</td>
                        <td><div>{t.categoryName}</div><div className="sub">{t.subCategory}</div></td>
                        <td><Pill t={t} /></td><td className="nowrap"><Who p={t.closedBy} /></td><td className="nowrap">{fd(t.closedAt)}</td>
                        <td className="nowrap mono">{dur(t.resolutionMs)}</td>
                        <td onClick={(e) => e.stopPropagation()}>{t.requester.id === me.id && t.reopen.ok ? <button className="btn sm" onClick={() => set({ modal: { type: 'reopen', key: t.key } })}><Icon n="reopen" s={13} />Reopen</button> : <span className="sub">{t.reopen.short}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="empty" style={{ padding: 24 }}>No closed {HDL[s.helpdesk]} tickets match these filters.</div>}
          </section>
        )) : <div className="panel empty"><Icon n="help" s={32} /><b>No helpdesk selected</b><span>Tick at least one helpdesk on the left.</span></div>}
      </div>
    </div>
  );
}

export function FaqPage() {
  const { data: me } = useMe();
  const { data: cfg } = useConfig();
  const f = useUi((s) => s.faq);
  const set = useUi((s) => s.set);
  const toast = useUi((s) => s.toast);
  const qc = useQueryClient();
  const hd = me && !me.helpdesks.includes(f.hd) ? 'HR' : f.hd;
  const { data } = useFaqs(hd);
  if (!me || !cfg || !data) return <Skeleton />;
  const upd = (p: Partial<typeof f>) => set((s) => ({ faq: { ...s.faq, ...p } }));
  const q = f.q.trim().toLowerCase();
  const list = data.faqs.map((x, i) => ({ ...x, i })).filter((x) => !q || `${x.question} ${x.answer}`.toLowerCase().includes(q));
  const vote = async (id: number, helpful: boolean, cat: string | null) => {
    const backendVote = data.faqs.find((x) => x.id === id)?.myVote;
    const previous = f.voted[id] ?? (backendVote === true ? 'yes' : backendVote === false ? 'no' : undefined);
    upd({ voted: { ...f.voted, [id]: helpful ? 'yes' : 'no' } });
    try {
      await api(`/faqs/${id}/vote`, { body: { helpful } });
      qc.invalidateQueries({ queryKey: ['faqs'] });
    } catch (e) {
      const restored = { ...f.voted };
      if (previous) restored[id] = previous;
      else delete restored[id];
      upd({ voted: restored });
      toast(e instanceof Error ? e.message : 'Could not save your feedback', 'bad');
      return;
    }
    if (helpful) toast('Thanks for the feedback', 'ok');
    else set({ drawer: { hd, cat } });
  };
  const st = cfg.statuses[hd];
  const isCase = hd === 'SF';
  return (
    <>
      <div className="toolbar" style={{ marginTop: 0 }}>
        <div className="seg">{me.helpdesks.map((h) => <button key={h} className={hd === h ? 'on' : ''} onClick={() => upd({ hd: h, q: '' })}>{HDL[h]} FAQs</button>)}</div>
        <div className="gsearch" style={{ marginLeft: 'auto' }}><Icon n="search" s={15} /><input id="faq-q" type="search" aria-label={`Search ${HDL[hd]} FAQs`} placeholder={`Search ${HDL[hd]} FAQs`} value={f.q} onChange={(e) => upd({ q: e.target.value })} /></div>
        {data.canEdit && <span className="muted" style={{ fontSize: 12.5 }}>Select an answer, then Edit to change it.</span>}
      </div>
      <div className="faq">
        <div className="panel">
          {list.length ? list.map((x) => {
            const open = !!f.open[x.id];
            const v = f.voted[x.id] ?? (x.myVote === true ? 'yes' : x.myVote === false ? 'no' : undefined);
            return (
              <div key={x.id} className={`acc ${open ? 'open' : ''}`}>
                <button aria-expanded={open} onClick={() => upd({ open: { ...f.open, [x.id]: !open } })}><span className="qn">{p2(x.i + 1)}</span><span>{x.question}</span><span className="chev"><Icon n="chev" s={16} /></span></button>
                {open && (
                  <div className="ans">
                    <p><Md text={x.answer} /></p>
                    <div className="helped">
                      {v === 'yes' ? <><Icon n="check" s={15} /><span>Thanks. Marked as helpful.</span></>
                        : v === 'no' ? <span>Sorry this did not answer it. The raise form is open with {HDL[hd]} preselected.</span>
                        : <><span>Did this help?</span><span className="r"><button className="btn sm" onClick={() => vote(x.id, true, x.categoryKey)}>Yes</button><button className="btn sm primary" onClick={() => vote(x.id, false, x.categoryKey)}>No, raise a ticket</button></span></>}
                      {data.canEdit && <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => set({ modal: { type: 'faq', id: x.id } })}><Icon n="file" s={13} />Edit<Addition title="Addition beyond the v2 mock: the mock only showed a 'Manage FAQs' toast" /></button>}
                    </div>
                  </div>
                )}
              </div>
            );
          }) : (
            <div className="empty">No {HDL[hd]} FAQ matches “{f.q}”.<button className="btn primary" onClick={() => set({ drawer: { hd } })}>Raise a {HDL[hd]} ticket</button></div>
          )}
        </div>
        <aside className="stack">
          <div className="panel side-card"><h3>Still need help?</h3><p>Raise a {HDL[hd]} {isCase ? 'case' : 'ticket'}. You get an ID and can track it on My tickets.</p><button className="btn primary" onClick={() => set({ drawer: { hd } })}><Icon n="plus" s={15} />Raise {isCase ? 'case' : 'ticket'}</button></div>
          {st && (
            <div className="panel side-card"><h3>{HDL[hd]} statuses</h3><p>Each status and the status you see on My tickets.</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{[...st.open, ...st.closed].map((s) => <span key={s} className="chip">{s} → {st.closed.includes(s) ? (s === 'Rejected' ? 'Rejected' : s === 'Cancelled' ? 'Cancelled' : 'Resolved') : cfg.uiMap[hd]?.[s] ?? 'Open'}</span>)}</div>
              <p>Answers marked <mark className="tc">TC</mark> are company decisions still to be confirmed.</p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
