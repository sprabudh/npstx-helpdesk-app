import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAction, useAnalytics, useApprovals, useConfig, useMe } from '../api/hooks';
import type { AskResult, Draft, ListItem, Me } from '../api/types';
import { HdBadge, Parts, Pill, Who } from '../components/common/bits';
import { cardStamp, fd, fdt, HDL, notifyChannel } from '../lib/format';
import { Icon } from '../lib/icons';
import { emptyFilters, useUi } from '../store/ui';

type SR = { new (): any };
const speechCtor = (): SR | null => (typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null) : null);

function AiBar() {
  const { data: cfg } = useConfig();
  const ask = useUi((s) => s.ask);
  const set = useUi((s) => s.set);
  const toast = useUi((s) => s.toast);
  const nav = useNavigate();
  const timer = useRef<number>();
  const aiOn = !!cfg?.ai.enabled;
  const setAsk = (p: Partial<typeof ask>) => set((s) => ({ ask: { ...s.ask, ...p } }));

  const search = async (q: string, full: boolean) => {
    try {
      if (aiOn) return await api<AskResult>('/ai/ask', { body: { q, full } });
      const tickets = await api<ListItem[]>(`/tickets/search?q=${encodeURIComponent(q)}`);
      return { q, tickets, total: tickets.length, faqs: [], answer: null } as AskResult;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Search failed', 'bad');
      return null;
    }
  };
  const onChange = (q: string) => {
    setAsk({ q });
    window.clearTimeout(timer.current);
    if (q.trim().length < 2) return setAsk({ q, res: null });
    timer.current = window.setTimeout(async () => setAsk({ res: await search(q.trim(), false) }), 250);
  };
  const submit = async (qIn?: string) => {
    const q = (qIn ?? useUi.getState().ask.q).trim();
    if (!q) {
      toast('Type a question or a ticket ID first', 'bad');
      document.getElementById('ai-q')?.focus();
      return;
    }
    const res = await search(q, true);
    set((s) => ({ ask: { ...s.ask, q, res, recent: [q, ...s.ask.recent.filter((x) => x !== q)].slice(0, 4) } }));
  };
  const mic = () => {
    if (ask.listen) return;
    const Ctor = speechCtor();
    if (Ctor) {
      const rec = new Ctor();
      rec.lang = 'en-IN';
      rec.interimResults = false;
      setAsk({ listen: true, q: '' });
      rec.onresult = (e: any) => submit(e.results[0][0].transcript);
      rec.onerror = () => toast('Could not hear that. Type your question instead.', 'bad');
      rec.onend = () => setAsk({ listen: false });
      rec.start();
      return;
    }
    setAsk({ listen: true, q: '' });
    window.setTimeout(() => {
      setAsk({ listen: false });
      submit('What is the status of my laptop ticket?');
    }, 1800);
  };
  const raiseWithText = async () => {
    const q = ask.q.trim();
    let hd: string | null = null, cat: string | null = null, sub: string | undefined;
    if (q && aiOn) {
      try {
        const r = await api<{ ok: boolean; draft?: Draft }>('/ai/draft', { body: { transcript: q } });
        if (r.ok && r.draft) ({ hd, cat } = r.draft), (sub = r.draft.f.sub);
      } catch {
        /* the drawer opens on step 1 */
      }
    }
    set({ drawer: { hd: hd as never, cat, pre: { title: q.slice(0, 150), desc: q, sub } } });
    toast('Raise form opened with your question filled in. Review it before submitting.');
  };
  const chips: [string, string | null][] = aiOn
    ? [['Check my ticket status', 'What is the status of my open tickets?'], ['Raise a ticket', null], ['Pending tickets', 'Which of my tickets are pending input?'], ['Escalated tickets', 'Show escalated tickets'], ['Reimbursement SLA', 'How many days for a reimbursement?']]
    : [['Raise a ticket', null]];
  const res = ask.res;
  return (
    <section className="aiwrap" aria-label="Ask or search">
      <div className="aibar">
        <Icon n={aiOn ? 'spark' : 'search'} s={22} />
        <label className="sr" htmlFor="ai-q">Ask a question or search tickets</label>
        <input id="ai-q" type="text" autoComplete="off" value={ask.q} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submit())}
          placeholder={ask.listen ? `Listening…${speechCtor() ? '' : ' (mock)'}` : aiOn ? 'Ask anything or search tickets: “What is the status of my laptop ticket?”' : 'Search tickets by ID or title'} />
        {ask.listen && <span className="wave" aria-hidden="true">{Array.from({ length: 7 }, (_, i) => <i key={i} />)}</span>}
        {ask.q && <button className="ib" aria-label="Clear" onClick={() => { setAsk({ q: '', res: null }); document.getElementById('ai-q')?.focus(); }}><Icon n="x" s={18} /></button>}
        {aiOn && <button className={`ib ${ask.listen ? 'on' : ''}`} aria-label={`Speak your question${speechCtor() ? '' : ' (mock)'}`} onClick={mic}><Icon n={ask.listen ? 'stop' : 'mic'} s={18} /></button>}
        <button className="ib send" aria-label="Ask" onClick={() => submit()}><Icon n="send" s={18} /></button>
      </div>
      <div className="aichips">
        <span className="lbl">Try</span>
        {chips.map(([l, q]) => <button key={l} onClick={() => (q ? (setAsk({ q }), submit(q)) : set({ drawer: {} }))}>{l}</button>)}
        {ask.recent.length > 0 && (
          <>
            <span className="lbl" style={{ marginLeft: 8 }}>Recent</span>
            {ask.recent.map((r) => <button key={r} onClick={() => (setAsk({ q: r }), submit(r))}><Icon n="clock" s={12} />{r}</button>)}
            <button className="linkbtn" style={{ border: 0, padding: '0 4px' }} onClick={() => setAsk({ recent: [] })}>Clear recent</button>
          </>
        )}
      </div>
      {res && (
        <div className="aires">
          <div className="answer">
            {res.answer ? (
              <>
                <span className="q">You asked: “{res.q}”</span>
                <div className="a"><Parts parts={res.answer.parts} /></div>
                {res.answer.sources.length > 0 && (
                  <div className="src">Sources:{' '}
                    {res.answer.sources.map((x, i) =>
                      x.type === 'ticket' ? <button key={i} onClick={() => nav(`/ticket/${x.key}`)}>{x.key}</button>
                        : x.type === 'faq' ? <button key={i} onClick={() => { set((s) => ({ faq: { ...s.faq, hd: x.helpdesk, q: '', open: { ...s.faq.open, [x.id]: true } } })); nav('/faqs'); }}>FAQ · {HDL[x.helpdesk]}: {x.label}</button>
                        : <span key={i} className="chip">{x.label}</span>)}
                  </div>
                )}
                <span className="muted" style={{ fontSize: 11.5 }}>Answers use the FAQs, helpdesk rules and your own tickets only.{res.answer.mode === 'rules' ? ' Rules mode: no model call.' : ''}</span>
              </>
            ) : <span className="q">Searching for “{res.q}”. Press Enter for {aiOn ? 'an AI answer' : 'results'}.</span>}
          </div>
          <div className="rlist">
            <h4>Matching tickets ({res.total})</h4>
            {res.tickets.length ? res.tickets.map((t) => (
              <button key={t.key} onClick={() => nav(`/ticket/${t.key}`)}><span className="mono">{t.key}</span><HdBadge hd={t.helpdesk} /><span className="tt">{t.title}</span><Pill t={t} /></button>
            )) : <span className="muted" style={{ fontSize: 13, padding: '4px 8px' }}>No tickets you can see match.</span>}
            {aiOn && (
              <>
                <h4>Matching FAQs</h4>
                {res.faqs.length ? res.faqs.map((f) => (
                  <button key={f.id} onClick={() => { set((s) => ({ faq: { ...s.faq, hd: f.helpdesk, q: '', open: { ...s.faq.open, [f.id]: true } } })); nav('/faqs'); }}><HdBadge hd={f.helpdesk} /><span className="tt">{f.question}</span></button>
                )) : <span className="muted" style={{ fontSize: 13, padding: '4px 8px' }}>No FAQ matches.</span>}
              </>
            )}
          </div>
          <div className="aifoot"><Icon n="help" s={16} /><span>Not solved?</span><button className="btn primary sm" onClick={raiseWithText}><Icon n="plus" s={14} />Raise a ticket with this text</button></div>
        </div>
      )}
      {cfg && !aiOn && <span className="muted" style={{ fontSize: 12 }}>AI answers are turned off on this server ({cfg.ai.reason}). Search still works.</span>}
    </section>
  );
}

function Welcome({ me }: { me: Me }) {
  const now = new Date(me.now);
  const hour = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(now));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const day = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(now);
  return (
    <section className="welcome" aria-label="Summary">
      <div className="wtxt">
        <span className="wday">{day}</span>
        <h2>{greet}, {me.name.split(' ')[0]}</h2>
        <p>{me.title}{me.dept ? ` · ${me.dept}` : ''}</p>
      </div>
    </section>
  );
}

/** Shortcuts only. Counts live in the Analytics cards so there is one source for every number. */
function BigButtons({ me }: { me: Me }) {
  const nav = useNavigate();
  const set = useUi((s) => s.set);
  return (
    <div className="bigbtns">
      <button className="bigbtn primary" onClick={() => set({ drawer: {} })}><span className="bi"><Icon n="plus" s={22} /></span><span className="bt"><b>Raise ticket</b><small>{me.helpdesks.map((h) => HDL[h]).join(' · ')}</small></span></button>
      <button className="bigbtn" onClick={() => nav('/tickets')}><span className="bi"><Icon n="file" s={22} /></span><span className="bt"><b>My tickets</b><small>Tickets you raised</small></span></button>
      {me.flags.worker ? (
        <button className="bigbtn" onClick={() => nav('/assigned')}><span className="bi"><Icon n="users" s={22} /></span><span className="bt"><b>Assigned to me</b><small>Your tickets and the queues you work</small></span></button>
      ) : (
        <button className="bigbtn" onClick={() => nav('/following')}><span className="bi"><Icon n="eye" s={22} /></span><span className="bt"><b>Following / CC'd</b><small>Tickets you watch</small></span></button>
      )}
    </div>
  );
}

export function ApprovalSection({ me }: { me: Me }) {
  const { data: rows } = useApprovals(me.flags.approver);
  const act = useAction();
  const nav = useNavigate();
  if (!me.flags.approver) return null;
  const r = me.roles;
  const steps = [r.includes('MANAGER') ? "Manager step for your team's requests" : '', r.includes('LND_HEAD') || r.includes('HRLND_ADMIN') ? 'L&D step after the manager approves' : '', r.includes('IT_HEAD') ? 'IT head step for admin rights' : '', r.includes('ADM_HEAD') ? 'Admin head step for purchases' : ''].filter(Boolean).join(' · ');
  const decide = (key: string, decision: string) => act.run(() => api(`/tickets/${key}/approval`, { body: { decision } }));
  return (
    <section className="panel apsec" style={{ marginTop: 18 }}>
      <header><Icon n="users" s={18} /><h3>Pending my approval <span className="count">{rows?.length ?? 0}</span></h3><span style={{ fontSize: 12.5 }}>{steps}</span></header>
      {rows?.length ? (
        <div className="tbl-wrap">
          <table className="t">
            <thead><tr><th>Ticket ID</th><th>Domain type</th><th>Request</th><th>Requester</th><th>Approval step</th><th>Waiting since</th><th>Decision</th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.key} tabIndex={0} onClick={() => nav(`/ticket/${t.key}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/ticket/${t.key}`)}>
                  <td className="mono nowrap">{t.key}</td><td><HdBadge hd={t.helpdesk} /></td>
                  <td className="title">{t.fields.learningItem || t.title}<div className="sub">{t.fields.learningSource || t.categoryName}</div></td>
                  <td className="nowrap"><Who p={t.requester} /><div className="sub">{t.requesterDept}</div></td>
                  <td className="nowrap">{t.chain.map((c) => <span key={c.step} className={`pill ${c.status === 'Approved' ? 's-ok' : c.current ? 's-wait' : 's-new'}`} style={{ marginRight: 4 }}>{c.label}</span>)}</td>
                  <td className="nowrap">{fdt(t.waitingSince)}</td>
                  <td className="nowrap" onClick={(e) => e.stopPropagation()}>
                    <button className="btn sm primary" onClick={() => decide(t.key, 'Approved')}><Icon n="check" s={13} />Approve</button>{' '}
                    <button className="btn sm danger" onClick={() => decide(t.key, 'Rejected')}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty" style={{ padding: 20 }}><Icon n="check" s={24} /><b>No approvals waiting</b><span>Requests that need your sign-off appear here: course requests, software and access requests, travel and purchases.</span></div>
      )}
    </section>
  );
}

function HBars({ items, onPick }: { items: { label: string; n: number; color?: string; v?: string }[]; onPick?: (v: string) => void }) {
  const max = Math.max(1, ...items.map((x) => x.n));
  return (
    <div className="hbars">
      {items.map((x) => {
        const inner = (<><span className="lb">{x.label}</span><span className="tk">{x.n > 0 && <i style={{ width: `${(x.n / max) * 100}%`, ...(x.color ? { background: x.color } : {}) }} />}</span><span className="v">{x.n}</span></>);
        return x.v && onPick ? <button key={x.label} className="hbar" data-tip={`${x.label}: ${x.n}`} onClick={() => onPick(x.v!)}>{inner}</button> : <div key={x.label} className="hbar" data-tip={`${x.label}: ${x.n}`}>{inner}</div>;
      })}
    </div>
  );
}
const Tag = ({ t }: { t: 'live' | 'range' }) => <span className={`kchip ${t === 'live' ? 'live' : 'rng'}`}>{t === 'live' ? 'Live' : 'In date range'}</span>;
const DataTable = ({ h1, h2, rows }: { h1: string; h2: string; rows: [string, number][] }) => (
  <details className="cdata"><summary>Show data</summary><table><thead><tr><th>{h1}</th><th>{h2}</th></tr></thead><tbody>{rows.map((r) => <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td></tr>)}</tbody></table></details>
);
function Trend({ series, label }: { series: { d: string; n: number }[]; label: string }) {
  const W = 600, H = 150, pl = 26, pr = 10, pt = 12, pb = 24, n = series.length, max = Math.max(2, ...series.map((x) => x.n));
  const step = (W - pl - pr) / (n - 1);
  const X = (i: number) => pl + i * step, Y = (v: number) => pt + (H - pt - pb) * (1 - v / max);
  const pts = series.map((x, i) => `${X(i).toFixed(1)},${Y(x.n).toFixed(1)}`).join(' ');
  const ticks = [...new Set([0, Math.round(max / 2), max])];
  return (
    <svg className="svgc" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Tickets raised per day, ${label}`}>
      {ticks.map((v) => <g key={v}><line x1={pl} x2={W - pr} y1={Y(v)} y2={Y(v)} style={{ stroke: 'var(--line)', strokeWidth: 1 }} /><text x={pl - 6} y={Y(v) + 3.5} textAnchor="end">{v}</text></g>)}
      <polygon points={`${X(0)},${Y(0)} ${pts} ${X(n - 1)},${Y(0)}`} style={{ fill: 'var(--chart-1)', fillOpacity: 0.12 }} />
      <polyline points={pts} style={{ fill: 'none', stroke: 'var(--chart-1)', strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' }} />
      <circle cx={X(n - 1)} cy={Y(series[n - 1].n)} r={4} style={{ fill: 'var(--chart-1)', stroke: 'var(--surface)', strokeWidth: 2 }} />
      {[0, Math.floor(n / 2), n - 1].map((i) => <text key={i} x={X(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{fd(series[i].d + 'T12:00:00+05:30')}</text>)}
      {series.map((x, i) => <rect key={x.d} x={X(i) - step / 2} y={pt} width={step} height={H - pt - pb} style={{ fill: 'transparent' }} data-tip={`${fd(x.d + 'T12:00:00+05:30')}: ${x.n} raised`} />)}
    </svg>
  );
}

function AnalyticsSection({ me }: { me: Me }) {
  const an = useUi((s) => s.an);
  const set = useUi((s) => s.set);
  const nav = useNavigate();
  const { data } = useAnalytics(an);
  if (!data) return <div className="anhead"><h2>Analytics</h2></div>;
  const views = me.views.map((v) => v[0]);
  const target = (go: Record<string, string> = {}) => {
    const w = data.scope === 'work' && !go.view;
    const view = go.view || (data.scope === 'own' ? 'mine' : w ? 'queues' : views.includes('all') ? 'all' : views.includes('org') ? 'org' : 'mine');
    return { w, f: { ...emptyFilters(view), tab: (go.tab as 'open' | 'closed') || 'open', hd: data.hd, flag: go.flag || null, status: go.status || '', from: go.from || '', cat: go.cat || '', pri: go.pri || '' } };
  };
  const openWith = (go: Record<string, string>) => {
    const { w, f } = target(go);
    set(w ? { adash: f } : { dash: f });
    nav(w ? '/assigned' : '/tickets');
  };
  const onBar = (v: string) => {
    const [kind, val] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)];
    const { w, f } = target({ from: data.fromDate });
    f.hd = kind === 'hd' ? val : kind === 'cat' ? val.split('.')[0] : data.hd;
    if (kind === 'cat') f.cat = val;
    if (kind === 'pri') f.pri = val;
    set(w ? { adash: f } : { dash: f });
    nav(w ? '/assigned' : '/tickets');
  };
  const { byHd, byPri, topCats, series, ageing } = data.charts;
  const setAn = (p: Partial<typeof an>) => set((s) => ({ an: { ...s.an, ...p } }));
  return (
    <>
      <div className="anhead">
        <h2>Analytics</h2>
        <div className="seg" aria-label="Scope">{data.scopes.map(([k, l]) => <button key={k} className={data.scope === k ? 'on' : ''} onClick={() => setAn({ scope: k })}>{l}</button>)}</div>
        <div className="seg" aria-label="Helpdesk">{['ALL', ...me.helpdesks].map((h) => <button key={h} className={data.hd === h ? 'on' : ''} onClick={() => setAn({ hd: h })}>{h === 'ALL' ? 'All' : HDL[h]}</button>)}</div>
        <label className="sr" htmlFor="an-range">Date range</label>
        <select className="in" id="an-range" value={data.range} onChange={(e) => setAn({ range: e.target.value })}>
          {[['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['year', 'This year']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <p className="annote">{data.note} · {data.hd === 'ALL' ? 'all your helpdesks' : HDL[data.hd]}. Cards marked <b>Live</b> count tickets as they are now; cards marked <b>In date range</b> count tickets raised {data.rangeLabel}. Hover a card for its formula; select it to open the same tickets.</p>
      {([['live', 'Open tickets'], ['attention', 'Needs attention (subset of open)'], ['range', `Raised ${data.rangeLabel}`]] as const).map(([g, title]) => {
        const cards = data.cards.filter((c) => c.g === g);
        return cards.length ? (
          <div key={g} className="kgrp">
            <h3 className="kgrp-h">{title}</h3>
            <div className={`kpis k${cards.length}`}>
              {cards.map((c) => (
                <button key={c.k} className={`kpi tone-${c.tone ?? 'info'}`} data-tip={c.f} onClick={() => (c.route ? nav(`/${c.route}`) : openWith(c.go ?? {}))}>
                  <span className="l"><span className="ki"><Icon n={c.ic} s={16} /></span>{c.l}<span className={`kchip ${c.chip === 'Live' ? 'live' : 'rng'}`}>{c.chip}</span></span><span className="n">{c.n}</span><span className="h">{c.h}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null;
      })}
      <div className="charts">
        <section className="panel chart wide"><h3>Tickets raised, {data.rangeLabel}<Tag t="range" /></h3><p className="cs">{series.reduce((a, b) => a + b.n, 0)} raised · today {series[series.length - 1]?.n ?? 0}</p>{series.length > 1 && <Trend series={series} label={data.rangeLabel} />}<DataTable h1="Day" h2="Raised" rows={series.filter((x) => x.n).map((x) => [fd(x.d + 'T12:00:00+05:30'), x.n])} /></section>
        <section className="panel chart"><h3>By helpdesk<Tag t="range" /></h3><p className="cs">Raised {data.rangeLabel}, open and closed</p><HBars items={byHd} onPick={onBar} /><DataTable h1="Helpdesk" h2="Tickets" rows={byHd.map((x) => [x.label, x.n])} /></section>
        <section className="panel chart"><h3>Top categories<Tag t="range" /></h3><p className="cs">Raised {data.rangeLabel}, open and closed</p>{topCats.length ? <HBars items={topCats} onPick={onBar} /> : <span className="muted" style={{ fontSize: 13 }}>No tickets in this range.</span>}<DataTable h1="Category" h2="Tickets" rows={topCats.map((x) => [x.label, x.n])} /></section>
        {data.priorityVisible && byPri.length > 0 && <section className="panel chart"><h3>By priority<Tag t="range" /></h3><p className="cs">Raised {data.rangeLabel}, open and closed</p><HBars items={byPri} onPick={onBar} /><DataTable h1="Priority" h2="Tickets" rows={byPri.map((x) => [x.label, x.n])} /></section>}
        <section className="panel chart"><h3>Ageing of open tickets<Tag t="live" /></h3><p className="cs">{data.openCount} open, by time since raised</p><HBars items={ageing} /><DataTable h1="Age" h2="Open tickets" rows={ageing.map((x) => [x.label, x.n])} /></section>
        <section className="panel chart full"><h3>Latest updates</h3>
          {data.updates.length ? (
            <ul className="updates">{data.updates.map((x) => <li key={x.id}><button onClick={() => x.ticketKey && nav(`/ticket/${x.ticketKey}`)}><Icon n="bell" s={14} /><span>{x.text}<time>{cardStamp(x.createdAt)} · {notifyChannel(x.channel)}</time></span></button></li>)}</ul>
          ) : <span className="muted" style={{ fontSize: 13 }}>No updates yet.</span>}
        </section>
      </div>
    </>
  );
}

export default function DashboardPage() {
  const { data: me } = useMe();
  if (!me) return null;
  return (
    <>
      <Welcome me={me} />
      <AiBar />
      <BigButtons me={me} />
      <ApprovalSection me={me} />
      <AnalyticsSection me={me} />
    </>
  );
}
