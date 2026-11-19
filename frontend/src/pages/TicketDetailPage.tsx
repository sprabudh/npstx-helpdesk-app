import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, getToken } from '../api/client';
import { useAction, useConfig, useDetail, useMe, usePeople } from '../api/hooks';
import type { Detail } from '../api/types';
import { Addition, Avatar, Denied, EscBadge, HdBadge, Lock, MentionText, Pill, PriFlag, Skeleton, Who } from '../components/common/bits';
import { fd, fdt, HDL, sizeLabel } from '../lib/format';
import { Icon } from '../lib/icons';
import { useUi } from '../store/ui';

const BACK_LABEL: Record<string, string> = { dashboard: 'Dashboard', tickets: 'My tickets', assigned: 'Assigned to me', following: "Following / CC'd", history: 'History', faqs: 'FAQs', admin: 'Admin console' };
const REL_LABEL: Record<string, string> = { FOLLOWER: 'Follower', CC: 'CC', TAGGED: 'Tagged', CASE_TEAM: 'Case team' };

async function download(id: number, name: string, toast: (m: string, k?: 'ok' | 'bad') => void) {
  try {
    const res = await fetch(`/api/attachments/${id}/download`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `Download failed (HTTP ${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    toast((e as Error).message, 'bad');
  }
}

function ConfigureMenu({ t }: { t: Detail }) {
  const [open, setOpen] = useState(false);
  const set = useUi((s) => s.set);
  const nav = useNavigate();
  const go = (tab: 'categories' | 'fields' | 'sla' | 'roles', withCat: boolean) => {
    set((s) => ({ adm: { ...s.adm, tab, hd: t.helpdesk, flash: withCat ? t.categoryKey : null, cat: withCat ? t.categoryKey : s.adm.cat }, ...(tab === 'categories' ? { modal: { type: 'cat', hd: t.helpdesk, key: t.categoryKey } } : {}) }));
    nav('/admin');
  };
  return (
    <div className="menu">
      <button className="btn" aria-expanded={open} onClick={() => setOpen(!open)}><Icon n="gear" s={15} />Edit / Configure<Icon n="chev" s={13} /></button>
      {open && (
        <div className="pop down">
          <button onClick={() => go('categories', true)}><Icon n="file" s={14} />Edit category · {t.categoryName}</button>
          <button onClick={() => go('fields', true)}><Icon n="clip" s={14} />Form fields for this category</button>
          <button onClick={() => go('sla', false)}><Icon n="clock" s={14} />SLA and escalation rules</button>
          <button onClick={() => go('roles', true)}><Icon n="users" s={14} />Category lead and routing</button>
        </div>
      )}
    </div>
  );
}

function ActionBar({ t }: { t: Detail }) {
  const m = t.me;
  const set = useUi((s) => s.set);
  const act = useAction();
  const follow = () => act.run(() => api(`/tickets/${t.key}/follow`, { method: 'POST' }));
  if (m.canWork) {
    return (
      <div className="actionbar">
        <label>Status{' '}
          <select className="in" id="st-sel" value={t.status} disabled={!m.transitions.length || m.pending} title={m.pending ? 'Work starts after approval' : undefined} onChange={(e) => {
            const val = e.target.value;
            if (val === t.status) return;
            if (m.closing.includes(val)) set({ modal: { type: 'close', key: t.key, to: val } });
            else act.run(() => api(`/tickets/${t.key}/status`, { method: 'PATCH', body: { status: val } }));
          }}>
            <option value={t.status}>{t.status} · {t.uiStatus} (current)</option>
            {m.transitions.map((x) => <option key={x.status} value={x.status}>→ {x.status} · {x.ui}</option>)}
          </select>
        </label>
        <label>Priority{' '}
          <select className="in" id="pri-sel" value={t.priority} disabled={t.closed} onChange={(e) => act.run(() => api(`/tickets/${t.key}/priority`, { method: 'PATCH', body: { priority: e.target.value } }))}>
            {m.priorities.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <button className="btn" disabled={t.closed} onClick={() => set({ modal: { type: 'reassign', key: t.key } })}><Icon n="users" s={15} />Reassign</button>
        <button className="btn warn" disabled={t.closed || !m.canEscalate} onClick={() => set({ modal: { type: 'escalate', key: t.key } })}><Icon n="up" s={15} />Escalate{t.escalationLevel ? ` (L${(t.ladderBase ?? 0) + t.escalationLevel})` : ''}</button>
        {!t.closed && !m.pending && <button className="btn" onClick={() => set({ modal: { type: 'close', key: t.key, to: m.closing[0] } })}><Icon n="check" s={15} />{m.stm ? 'Resolve' : 'Close'}</button>}
        {m.pending && <span className="muted" style={{ fontSize: 12.5 }}>SLA starts after approval</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {m.canFollow && <button className="btn" onClick={follow}><Icon n="eye" s={15} />Follow</button>}
          {m.isHelpdeskAdmin && <ConfigureMenu t={t} />}
        </span>
      </div>
    );
  }
  const b: JSX.Element[] = [];
  if (m.canCancel) b.push(<button key="c" className="btn danger" onClick={() => set({ modal: { type: 'cancel', key: t.key } })}><Icon n="x" s={15} />Cancel request</button>);
  if (m.canConfirm) b.push(<button key="cf" className="btn primary" onClick={() => act.run(() => api(`/tickets/${t.key}/confirm`, { method: 'POST' }))}><Icon n="check" s={15} />Confirm resolution</button>);
  if (m.isRequester && t.closed) b.push(m.reopen.ok ? <button key="r" className="btn" onClick={() => set({ modal: { type: 'reopen', key: t.key } })}><Icon n="reopen" s={15} />Reopen ticket</button> : <span key="r" className="muted" style={{ fontSize: 12.5 }}>{m.reopen.why ?? ''}</span>);
  if (m.relation) b.push(<button key="u" className="btn" onClick={() => set({ modal: { type: 'unfollow', key: t.key } })}><Icon n="eye" s={15} />Unfollow</button>);
  else if (m.canFollow) b.push(<button key="f" className="btn" onClick={follow}><Icon n="eye" s={15} />Follow</button>);
  return b.length ? <div className="actionbar">{b}</div> : null;
}

function Banners({ t }: { t: Detail }) {
  const m = t.me;
  const out: JSX.Element[] = [];
  if (m.isRequester && m.waiting) out.push(<div key="w" className="banner warn"><Icon n="info" s={18} /><p><b>{t.assignee.name} needs more information from you.</b> Reply below to resume work. The SLA clock is paused until you reply.</p></div>);
  if (m.pending && m.canWork) out.push(<div key="p" className="banner info"><Icon n="clock" s={18} /><p><b>Waiting for approval. SLA starts after approval.</b> You can add notes, reply, attach files and reassign now. Starting work, resolving and escalating unlock once it is approved.</p></div>);
  if (t.confidential)
    out.push(
      <div key="c" className="banner conf"><Icon n="lock" s={18} />
        <p>{t.helpdesk === 'IT'
          ? <><b>Confidential security ticket.</b> Visible only to the requester, IT security ({t.category.leadName}), the IT head and helpdesk admins. Email notifications carry the ticket ID only.</>
          : <><b>Confidential {t.categoryName} ticket.</b> Visible only to the requester, the assigned agent, the category lead ({t.category.leadName}) and followers added by the requester or agent. HR / L&amp;D admins and helpdesk admins have audited read access. Email notifications carry the ticket ID only.</>}
        </p>
      </div>,
    );
  if (m.relation && !m.canWork) out.push(<div key="f" className="banner info"><Icon n="eye" s={18} /><p>You see this ticket because you are <b>{m.role}</b>. You get updates and can comment, but cannot change status or priority.</p></div>);
  if (m.stm && t.status === 'Resolved' && m.isRequester) out.push(<div key="r" className="banner ok"><Icon n="check" s={18} /><p><b>{HDL[t.helpdesk]} marked this resolved.</b> Confirm to close it, or reopen within {m.reopenDays} days if the problem is back. It auto-closes after a quiet period (TC).</p></div>);
  if (t.helpdesk === 'SF') out.push(<div key="s" className="banner info"><Icon n="cloud" s={18} /><p>Salesforce is the system of record for this case. Status, owner, milestones and escalation are mirrored from Salesforce · last synced 2 min ago.</p></div>);
  return <>{out}</>;
}

function ApprovalBox({ t }: { t: Detail }) {
  const a = t.approval!;
  const [note, setNote] = useState('');
  const act = useAction();
  const st = (v: string) => (v === 'Approved' ? 's-ok' : v === 'Rejected' ? 's-bad' : 's-wait');
  const decide = (decision: string) => act.run(() => api(`/tickets/${t.key}/approval`, { body: { decision, note: note.trim() || undefined } })).then(() => setNote(''));
  return (
    <section className="box">
      <h3>Approval · {a.what}</h3>
      <div className="approval" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
        {a.steps.map((s, i) => (
          <div key={s.step} className={`astep ${s.current ? 'cur' : ''}`}>
            <b>{i + 1}. {s.label}</b><span className="who">{s.who}</span>
            <span className={`pill ${s.skipped ? 's-cancel' : st(s.status)}`}>{s.skipped ? 'Skipped' : s.status}</span>
            {s.decidedAt && <span className="who">{fdt(s.decidedAt)}</span>}
          </div>
        ))}
      </div>
      {a.myStage ? (
        <>
          <div className="fld"><label htmlFor="ap-note">Note for {t.requester.name} (optional)</label><textarea className="in" id="ap-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary" onClick={() => decide('Approved')}><Icon n="check" s={15} />Approve</button>
            <button className="btn danger" onClick={() => decide('Rejected')}><Icon n="x" s={15} />Reject</button>
          </div>
        </>
      ) : a.waitingFor ? <span className="muted" style={{ fontSize: 12.5 }}>Waiting for {a.waitingFor}. Switch the demo role to approve.</span> : null}
    </section>
  );
}

function SfBox({ t }: { t: Detail }) {
  const s = t.sf!;
  return (
    <section className="box">
      <h3>Salesforce case</h3>
      <dl className="kv">
        <dt>Case number</dt><dd className="mono">{s.caseNo}</dd><dt>Owner / queue</dt><dd>{t.assignee.name}</dd><dt>Entitlement</dt><dd>{s.entitlement}</dd>
        {s.milestones.map(([n, v]) => <MsRow key={n} n={n} v={v} />)}
        <dt>Escalated flag</dt><dd>{s.escalated ? 'Yes' : 'No'}</dd>
        <dt>Case team</dt><dd>{s.team.length ? s.team.map((m, i) => <span key={m.name}>{i > 0 && <br />}{m.name} <span className="muted">({m.role})</span></span>) : '—'}</dd>
      </dl>
      {s.children.length > 0 && (
        <div>
          <b style={{ fontSize: 13 }}>Child cases</b>
          <div className="tbl-wrap"><table className="t" style={{ marginTop: 6 }}><tbody>
            {s.children.map((k) => <tr key={k.caseNo} style={{ cursor: 'default' }}><td className="mono">{k.caseNo}</td><td>{k.title}</td><td><span className="pill s-prog">{k.status}</span></td><td className="nowrap">{k.owner}</td></tr>)}
          </tbody></table></div>
        </div>
      )}
    </section>
  );
}
const MsRow = ({ n, v }: { n: string; v: string }) => (<><dt>Milestone · {n}</dt><dd><span className={`pill ${v === 'Compliant' ? 's-ok' : v === 'Violated' ? 's-bad' : 's-prog'}`}>{v}</span></dd></>);

function LeftColumn({ t }: { t: Detail }) {
  const m = t.me;
  const set = useUi((s) => s.set);
  const toast = useUi((s) => s.toast);
  const act = useAction();
  const nav = useNavigate();
  const sla = t.sla;
  const fillC = sla.cls === 'over' ? 'var(--bad)' : sla.cls === 'soon' ? 'var(--warn)' : sla.cls === 'pause' ? 'var(--line-strong)' : 'var(--ok)';
  const sf = t.helpdesk === 'SF';
  const shownFields = t.fields.filter((f) => f.value);
  const removeF = (uid: string) => (uid === useUi.getState().userId ? set({ modal: { type: 'unfollow', key: t.key } }) : act.run(() => api(`/tickets/${t.key}/followers/${uid}`, { method: 'DELETE' })));
  const myId = useUi((s) => s.userId);
  return (
    <div className="stack">
      <section className="box">
        <h3>Ticket details</h3>
        <dl className="kv">
          <dt>Helpdesk</dt><dd><HdBadge hd={t.helpdesk} /></dd>
          <dt>{sf ? 'Type' : 'Category'}</dt><dd>{t.categoryName}</dd>
          <dt>{sf ? 'Reason' : 'Sub-category'}</dt><dd>{t.subCategory}</dd>
          <dt>Priority</dt><dd><PriFlag p={t.priority} /> {t.helpdesk === 'HR' && <span className="muted" style={{ fontSize: 12 }}>set by category</span>}</dd>
          <dt>Raised by</dt><dd><Who p={t.requester} /> <span className="muted" style={{ fontSize: 12 }}>{t.requesterDept}</span></dd>
          <dt>{sf ? 'Case owner' : 'Assigned to'}</dt><dd><Who p={t.assignee} /></dd>
          <dt>Created</dt><dd>{fdt(t.createdAt)}</dd><dt>Last updated</dt><dd>{fdt(t.updatedAt)}</dd>
          {t.related.length > 0 && (
            <><dt>Related tickets</dt><dd>{t.related.map((x, i) => <span key={x.key}>{i > 0 && <br />}{x.canView ? <><button className="linkbtn" onClick={() => nav(`/ticket/${x.key}`)}>{x.key}</button> <HdBadge hd={x.helpdesk} /></> : <><span className="mono">{x.key}</span> <span className="muted">(no access)</span></>}</span>)}</dd></>
          )}
          {!t.slaStarted && !t.closed ? <><dt>SLA</dt><dd><b>Starts after approval</b> <span className="muted" style={{ fontSize: 12 }}>response and resolution due times are set when the last approver approves</span></dd></> : <>
          <dt>SLA response</dt><dd>{t.responseMet === true ? <span style={{ color: 'var(--ok)' }}>Met</span> : t.responseMet === false ? <span style={{ color: 'var(--bad)' }}>Breached</span> : `Due ${fdt(t.responseDue)}`}</dd>
          <dt>SLA resolution</dt><dd>{fdt(t.resolutionDue)} · <b style={{ color: fillC === 'var(--line-strong)' ? 'var(--fg-3)' : fillC }}>{sla.txt}</b></dd></>}
          {t.escalationLevel > 0 && <><dt>Escalation</dt><dd><EscBadge lvl={t.escalationLevel} label={`Level ${(t.ladderBase ?? 0) + t.escalationLevel}`} /> {t.ladder[(t.ladderBase ?? 0) + t.escalationLevel - 1]?.whoName}</dd></>}
          {t.closed && (
            <>
              <dt>Closing response</dt><dd><Pill t={t} /><div style={{ marginTop: 4 }}>{t.closeMessage ?? ''}</div></dd>
              <dt>Closed by</dt><dd><Who p={t.closedBy} /> · {fdt(t.closedAt)}</dd>
            </>
          )}
        </dl>
        {!t.closed && t.slaStarted && (
          <div>
            <div className="slabar" role="img" aria-label={`Resolution time used ${Math.round(sla.usedPct)} percent`}>
              <div className="fill" style={{ width: `${sla.usedPct}%`, background: fillC }} />
              {t.ladder.length > 1 && t.ladder.map((l, i) => l.pct >= 100
                ? <span key={i} className="mk" style={{ left: 'calc(100% - 8px)' }}>L{i + 1}</span>
                : <span key={i}><span className="tick" style={{ left: `${l.pct}%` }} /><span className="mk" style={{ left: `${l.pct}%` }}>L{i + 1}</span></span>)}
              <span className="ends" style={{ left: 0 }}>{t.slaStart ? `SLA started ${fd(t.slaStart)}` : `Created ${fd(t.createdAt)}`}</span>
              <span className="ends" style={{ right: 0 }}>Due {fdt(t.resolutionDue)}</span>
            </div>
          </div>
        )}
      </section>
      {t.approval && <ApprovalBox t={t} />}
      {t.sf && <SfBox t={t} />}
      <section className="box">
        <h3>Request</h3>
        <p className="desc">{t.description}</p>
        {t.aiTranscript && <div className="note info"><Icon n="mic" s={15} /><p><b>Raised by voice.</b> Transcript: “{t.aiTranscript}”. The audio was not stored.</p></div>}
        {shownFields.length > 0 && <dl className="kv">{shownFields.map((f) => <span key={f.key} style={{ display: 'contents' }}><dt>{f.label}</dt><dd>{f.value}</dd></span>)}</dl>}
        <div className="files">
          {t.files.length ? t.files.map((f) => (
            f.downloadable
              ? <button key={f.id} className="file" style={{ cursor: 'pointer' }} onClick={() => download(f.id, f.name, toast)} title="Download"><Icon n="clip" s={13} />{f.name} <span className="muted">{sizeLabel(f.sizeBytes)}</span></button>
              : <span key={f.id} className="file"><Icon n="clip" s={13} />{f.name} <span className="muted">{sizeLabel(f.sizeBytes)}</span></span>
          )) : <span className="muted" style={{ fontSize: 13 }}>No attachments</span>}
        </div>
      </section>
      <section className="box">
        <h3>People <span className="r">{m.canAddPeople && !t.closed && <button className="btn sm" onClick={() => set({ modal: { type: 'follower', key: t.key } })}><Icon n="plus" s={13} />Add follower / CC</button>}</span></h3>
        <div className="people">
          {t.followers.length ? t.followers.map((f) => (
            <span key={f.userId} className="person">
              <Avatar name={f.name} sm />{f.name}<span className="rel">{REL_LABEL[f.relation]}</span>
              {(m.isRequester || t.assignee.id === myId || f.userId === myId) && f.relation !== 'CASE_TEAM' && <button aria-label={`Remove ${f.name}`} onClick={() => removeF(f.userId)}><Icon n="x" s={12} /></button>}
            </span>
          )) : <span className="muted" style={{ fontSize: 13 }}>No followers yet.</span>}
        </div>
        {!m.canAddPeople && <span className="muted" style={{ fontSize: 12 }}><Icon n="lock" s={12} /> On confidential tickets only the requester or assigned agent can add people.</span>}
      </section>
      <section className="box">
        <h3>Status timeline</h3>
        <ol className="timeline">{t.events.map((e, i) => <li key={i} className={`k-${e.kind}`}>{e.text}<time>{fdt(e.at)}</time></li>)}</ol>
      </section>
    </div>
  );
}

type Sum = { mode: string; summary: string[]; note: string | null };
function SummaryButton({ t, res, setRes }: { t: Detail; res: Sum | null; setRes: (r: Sum | null) => void }) {
  const [busy, setBusy] = useState(false);
  const toast = useUi((s) => s.toast);
  const run = async () => {
    setBusy(true);
    try {
      setRes(await api<Sum>(`/ai/summarise/${t.key}`, { method: 'POST' }));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Summary failed', 'bad');
    } finally {
      setBusy(false);
    }
  };
  return <button className="btn sm" onClick={res ? () => setRes(null) : run} disabled={busy} aria-expanded={!!res}><Icon n="spark" s={13} />{busy ? 'Summarising…' : res ? 'Hide summary' : 'Summarise'}<Addition title="Addition beyond the v2 mock: AI feed summary" /></button>;
}
const SummaryBox = ({ res }: { res: Sum }) => (
  <div className="aisum" role="region" aria-label="Activity summary">
    <ul>{res.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
    <span className="muted" style={{ fontSize: 11.5 }}>{res.mode === 'model' ? 'Written by the AI model from the replies you can see. Check before relying on it.' : 'Basic summary built on the server without the AI model.'}{res.note ? ` ${res.note}` : ''}</span>
  </div>
);

function Activity({ t }: { t: Detail }) {
  const m = t.me;
  const { data: cfg } = useConfig();
  const { data: people } = usePeople(t.helpdesk);
  const { data: meQ } = useMe();
  const myId = useUi((s) => s.userId);
  const toast = useUi((s) => s.toast);
  const act = useAction();
  const [feed, setFeed] = useState<'all' | 'public' | 'internal'>('all');
  const [modeSel, setMode] = useState<'public' | 'internal'>('public');
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState<null | 'canned' | 'tag'>(null);
  const [sum, setSum] = useState<Sum | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const mode = m.canInternal ? modeSel : 'public';
  type Item = { type: 'c'; id: number; authorId: string; authorName: string; body: string; internal: boolean; at: string } | { type: 'e'; text: string; at: string };
  const items: Item[] = [
    ...t.comments.map((c) => ({ type: 'c' as const, ...c, at: c.createdAt })),
    ...t.events.filter((e) => ['status', 'esc', 'close'].includes(e.kind)).map((e) => ({ type: 'e' as const, text: e.text, at: e.at })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const shown = items.filter((i) => feed === 'all' || (i.type === 'c' && (feed === 'public' ? !i.internal : i.internal)));
  const send = async () => {
    const body = draft.trim();
    if (!body) return toast('Write a message first', 'bad');
    await act.run(() => api(`/tickets/${t.key}/comments`, { body: { body, internal: mode === 'internal' } }));
    setDraft('');
  };
  const attach = async (f: File | undefined) => {
    if (!f) return;
    if (cfg && f.size > cfg.fileRules.maxBytes) return toast(`${f.name} is over 10 MB`, 'bad');
    const fd = new FormData();
    fd.append('files', f);
    await act.run(() => api(`/tickets/${t.key}/attachments`, { form: fd })).catch(() => undefined);
  };
  const pick = (s: string) => {
    setDraft(s);
    setMenu(null);
    setTimeout(() => ta.current?.focus());
  };
  const closedLocked = t.closed && !(m.stm && t.status === 'Resolved');
  return (
    <section className="box" style={{ minHeight: 420 }}>
      <h3>Activity <span className="r" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {cfg?.ai.enabled && <SummaryButton t={t} res={sum} setRes={setSum} />}
        <span className="seg">{([['all', 'All'], ['public', 'Public replies'], ...(m.canInternal ? [['internal', 'Internal notes']] : [])] as [typeof feed, string][]).map(([k, l]) => <button key={k} className={feed === k ? 'on' : ''} onClick={() => setFeed(k)}>{l}</button>)}</span>
      </span></h3>
      {sum && <SummaryBox res={sum} />}
      <div className="feed">
        <div className={`msg ${t.requester.id === myId ? 'mine' : ''}`}>
          <Avatar name={t.requester.name} sm />
          <div className="bub"><div className="meta"><b>{t.requester.name}</b> raised this · {fdt(t.createdAt)}</div><p><b>{t.title}</b>{'\n'}{t.description}</p></div>
        </div>
        {shown.map((i, n) => i.type === 'e' ? <div key={`e${n}`} className="sysline">{i.text} · {fdt(i.at)}</div> : (
          <div key={`c${i.id}`} className={`msg ${i.internal ? 'internal' : ''} ${i.authorId === myId && !i.internal ? 'mine' : ''}`}>
            <Avatar name={i.authorName} sm />
            <div className="bub">
              <div className="meta"><b>{i.authorName}</b>{i.internal ? <span className="tag int">Internal note · agents only</span> : m.canInternal ? <span className="tag pub">Public reply</span> : null}<span>{fdt(i.at)}</span></div>
              <p><MentionText text={i.body} /></p>
            </div>
          </div>
        ))}
      </div>
      {m.readOnly ? (
        <div className="note conf"><Icon n="lock" s={15} /><p>{meQ?.roles.includes('AUDITOR') ? 'Read-only audit access. Auditors can view tickets but cannot reply, approve or change them. This view is audited.' : 'Read-only access. HR / L&D admins can view HR tickets, including confidential ones, but cannot reply or change them. This view is audited.'}</p></div>
      ) : closedLocked ? (
        <div className="note info"><Icon n="lock" s={15} /><p>This ticket is closed. {m.isRequester && m.reopen.ok ? 'Reopen it to continue the conversation.' : 'The conversation is read-only.'}</p></div>
      ) : (
        <div className={`composer ${mode === 'internal' ? 'internal' : ''}`}>
          {m.canInternal && (
            <div className="bar" style={{ borderTop: 0, borderBottom: '1px solid var(--line)' }}>
              <span className="seg"><button className={mode === 'public' ? 'on' : ''} onClick={() => setMode('public')}>Public reply</button><button className={mode === 'internal' ? 'on' : ''} onClick={() => setMode('internal')}>Internal note</button></span>
              <span className="muted" style={{ fontSize: 12 }}>{mode === 'public' ? `Visible to ${t.requester.name} and followers; notifies them.` : 'Visible only to agents on this helpdesk.'}</span>
            </div>
          )}
          <label className="sr" htmlFor="draft">Message</label>
          <textarea id="draft" ref={ta} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && send()}
            placeholder={mode === 'internal' ? 'Add an internal note for agents…' : m.isRequester && m.waiting ? 'Reply with the information requested…' : 'Write a reply. Type @ or use Tag to mention someone.'} />
          <div className="bar">
            {m.canInternal && cfg && (
              <div className="menu">
                <button className="btn sm" aria-expanded={menu === 'canned'} onClick={() => setMenu(menu === 'canned' ? null : 'canned')}><Icon n="file" s={14} />Canned response</button>
                {menu === 'canned' && <div className="pop">{cfg.canned.map(([l, body]) => <button key={l} onClick={() => pick((draft ? draft + '\n' : '') + body)}>{l}</button>)}</div>}
              </div>
            )}
            <div className="menu">
              <button className="btn sm" aria-expanded={menu === 'tag'} onClick={() => setMenu(menu === 'tag' ? null : 'tag')}><Icon n="at" s={14} />Tag</button>
              {menu === 'tag' && <div className="pop">{(people ?? []).filter((p) => p.id !== myId).map((p) => <button key={p.id} onClick={() => pick((draft ? draft.replace(/\s*$/, ' ') : '') + '@' + p.name + ' ')}><Avatar name={p.name} sm />{p.name}</button>)}</div>}
            </div>
            <label className="btn sm" style={{ position: 'relative' }}><Icon n="clip" s={14} />Attach<input type="file" id="c-file" aria-label="Attach a file" style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} onChange={(e) => { attach(e.target.files?.[0]); e.target.value = ''; }} /></label>
            <span className="r"><button className="btn primary sm" disabled={act.pending} onClick={send}>{mode === 'internal' ? 'Add note' : 'Send reply'}</button></span>
          </div>
        </div>
      )}
    </section>
  );
}

export default function TicketDetailPage() {
  const { key = '' } = useParams();
  const back = useUi((s) => s.back);
  const nav = useNavigate();
  const q = useDetail(key);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [key]);
  if (q.isLoading) return <Skeleton />;
  if (q.error) {
    const e = q.error as ApiError;
    if (e.status === 404) return <Denied code="404" title="Ticket not found" />;
    if (e.status === 403) return <Denied code="403" title="You do not have access to this ticket." text={`${e.message} This attempt is written to the audit log.`} />;
    return <Denied code={String(e.status || 'Error')} title="The ticket could not be loaded." text={e.message} />;
  }
  const t = q.data!;
  const m = t.me;
  return (
    <>
      <button className="back" onClick={() => nav(`/${back}`)}><Icon n="back" s={16} />Back to {BACK_LABEL[back] ?? 'My tickets'}</button>
      <div className="dhead">
        <div className="row">
          <HdBadge hd={t.helpdesk} /><span className="mono">{t.key}{t.sf ? ` · Case ${t.sf.caseNo}` : ''}</span>
          {t.confidential && <Lock label="Confidential" />}
          <span className="you">You: <b>{m.role}</b> · {m.roleTxt}</span>
        </div>
        <h2>{t.title}</h2>
        <div className="row">
          <Pill t={t} /><PriFlag p={t.priority} />
          {t.escalationLevel > 0 && <EscBadge lvl={t.escalationLevel} label={`Escalated · Level ${(t.ladderBase ?? 0) + t.escalationLevel}`} />}
          {!t.slaStarted && !t.closed
            ? <span className="sla pause" style={{ flexDirection: 'row', gap: 6, fontSize: 12.5 }}>SLA <small>starts after approval</small></span>
            : <span className={`sla ${t.sla.cls}`} style={{ flexDirection: 'row', gap: 6, fontSize: 12.5 }}>SLA <small>{t.sla.txt}</small></span>}
        </div>
        <ActionBar t={t} />
      </div>
      <Banners t={t} />
      <div className="split">
        <LeftColumn t={t} />
        <Activity t={t} />
      </div>
    </>
  );
}
