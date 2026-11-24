import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { useAbsences, useAction, useAdmin, useConfig, useDetail, useFaqs, useMe, usePeople } from '../../api/hooks';
import type { Detail } from '../../api/types';
import { Icon } from '../../lib/icons';
import { HDL } from '../../lib/format';
import { useUi, type Modal } from '../../store/ui';
import { Dialog, PriFlag } from '../common/bits';

type Errs = Record<string, string>;
/** Field wrapper with the artifact's modal ids (m-<id>) and error text. */
function MF({ id, label, req, err, children }: { id: string; label: string; req?: boolean; err?: string; children: ReactNode }) {
  return (
    <div className={`fld ${err ? 'bad' : ''}`}>
      <label htmlFor={`m-${id}`}>{label}{req && <> <span className="req">*</span></>}</label>
      {children}
      {err && <span className="err">{err}</span>}
    </div>
  );
}
const TA = ({ id, value, onChange, ph = '', rows = 3 }: { id: string; value: string; onChange: (v: string) => void; ph?: string; rows?: number }) => (
  <textarea className="in" id={`m-${id}`} rows={rows} placeholder={ph} value={value} onChange={(e) => onChange(e.target.value)} />
);
const Cancel = ({ onClose, label = 'Cancel' }: { onClose: () => void; label?: string }) => <button className="btn" onClick={onClose}>{label}</button>;

/** Runs a modal action: closes on success, shows server field errors inline. */
function useSubmit(setErr: (e: Errs) => void, onClose: () => void) {
  const act = useAction();
  return {
    pending: act.pending,
    go: async (fn: () => Promise<unknown>, after?: (res: any) => void) => {
      try {
        const res = await act.run(fn, { silent: true });
        onClose();
        after?.(res);
      } catch (e) {
        if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErr(e.fieldErrors);
        else useUi.getState().toast(e instanceof Error ? e.message : 'Something went wrong', 'bad');
      }
    },
  };
}

function TicketModal({ m, t, onClose }: { m: Extract<Modal, { key: string }>; t: Detail; onClose: () => void }) {
  const { data: cfg } = useConfig();
  const { data: people } = usePeople(t.helpdesk);
  const myId = useUi((s) => s.userId);
  const nav = useNavigate();
  const [err, setErr] = useState<Errs>({});
  const [v, setV] = useState<Record<string, string>>(() => ({
    reason: '', note: '', who: '', rel: 'FOLLOWER',
    to: m.type === 'reassign' ? t.me.agents[0]?.id ?? '' : '',
    resp: 'Resolved', msg: m.type === 'close' && !t.me.stm ? cfg?.closing.Resolved ?? '' : '',
  }));
  const s = (k: string) => (x: string) => { setV((o) => ({ ...o, [k]: x })); setErr((e) => ({ ...e, [k]: '' })); };
  const sub = useSubmit(setErr, onClose);
  const base = `/tickets/${t.key}`;
  const nFol = t.followers.length;

  if (m.type === 'escalate') {
    const lbase = t.ladderBase ?? 0;
    const reached = lbase + t.escalationLevel;
    const nextIdx = reached;
    const nextLabel = nextIdx + 1;
    const doIt = () => (v.reason.trim() ? sub.go(() => api(`${base}/escalate`, { body: { reason: v.reason } })) : setErr({ reason: 'Give a reason so the next level has context.' }));
    return (
      <Dialog title={`Escalate ${t.key}`} onClose={onClose} footer={<><Cancel onClose={onClose} /><button className="btn primary" disabled={sub.pending} onClick={doIt}><Icon n="up" s={15} />Escalate to L{nextLabel}</button></>}>
        <p className="muted" style={{ margin: 0 }}>Tickets also escalate automatically when the share of resolution time below is used. Manual escalation notifies the next level now.</p>
        <div className="ladder">
          {t.ladder.map((l, i) => (
            <div key={i} className={`lv ${i < reached ? 'done' : i === nextIdx ? 'next' : ''}`}>
              <span className="n">L{i + 1}</span>
              <span><b>{l.whoName}</b><br /><span className="muted" style={{ fontSize: 12 }}>{l.role}</span></span>
              <span className="th">{l.th}{i < reached ? <><br />Escalated</> : i === nextIdx ? <><br /><b style={{ color: 'var(--bad)' }}>Next</b></> : null}</span>
            </div>
          ))}
        </div>
        <MF id="reason" label="Reason for escalation" req err={err.reason}><TA id="reason" value={v.reason} onChange={s('reason')} ph="e.g. Needs bank approval beyond my access" /></MF>
      </Dialog>
    );
  }
  if (m.type === 'close') {
    const to = m.to, stm = t.me.stm;
    const title = stm ? (to === 'Rejected' ? `Reject ${t.key}` : `Resolve ${t.key}`) : `Close ${t.key}`;
    const doIt = () => (v.msg.trim() ? sub.go(() => api(`${base}/close`, { body: { to, response: stm ? to : v.resp, message: v.msg } })) : setErr({ msg: 'This message is required.' }));
    return (
      <Dialog title={title} onClose={onClose} footer={<><Cancel onClose={onClose} /><button className="btn primary" disabled={sub.pending} onClick={doIt}><Icon n="check" s={15} />{stm ? (to === 'Rejected' ? 'Reject' : 'Mark resolved') : 'Close ticket'}</button></>}>
        {!stm && (
          <MF id="resp" label={t.helpdesk === 'HR' ? 'Closing response' : 'Closed status value'} req>
            <select className="in" id="m-resp" value={v.resp} onChange={(e) => s('resp')(e.target.value)}>{['Resolved', 'Rejected', 'Cancelled', 'Duplicate'].map((o) => <option key={o}>{o}</option>)}</select>
          </MF>
        )}
        <MF id="msg" label={stm ? (to === 'Rejected' ? 'Reason for rejection' : 'Resolution note') : 'Message to the requester'} req err={err.msg}><TA id="msg" rows={4} value={v.msg} onChange={s('msg')} /></MF>
        <div className="note info"><Icon n="bell" s={15} /><p>{t.requester.name} and {nFol} follower{nFol === 1 ? '' : 's'} are notified.{stm && to === 'Resolved' ? ` The requester is asked to confirm; reopen allowed for ${t.me.reopenDays} days.` : t.helpdesk === 'HR' && cfg?.categories.find((c) => c.helpdesk === 'HR' && c.key === t.categoryKey)?.reopenAllowed ? ' The requester can reopen within 30 days.' : ''}</p></div>
      </Dialog>
    );
  }
  if (m.type === 'reopen') {
    const doIt = () => (v.note.trim() ? sub.go(() => api(`${base}/reopen`, { body: { note: v.note } })) : setErr({ note: 'Add a note so the agent knows what is still wrong.' }));
    return (
      <Dialog title={`Reopen ${t.key}`} onClose={onClose} footer={<><Cancel onClose={onClose} /><button className="btn primary" disabled={sub.pending} onClick={doIt}><Icon n="reopen" s={15} />Reopen</button></>}>
        <p className="muted" style={{ margin: 0 }}>The ticket returns to {t.assignee.name} and the SLA clocks restart. Tell them what is still wrong.</p>
        <MF id="note" label="Reopen note" req err={err.note}><TA id="note" value={v.note} onChange={s('note')} ph="e.g. Comp-off shows again as 0 after the November run" /></MF>
      </Dialog>
    );
  }
  if (m.type === 'reassign') {
    return (
      <Dialog title={`Reassign ${t.key}`} onClose={onClose} footer={<><Cancel onClose={onClose} /><button className="btn primary" disabled={sub.pending} onClick={() => sub.go(() => api(`${base}/reassign`, { body: { assigneeId: v.to, note: v.note || undefined } }))}>Reassign</button></>}>
        <MF id="to" label="New assignee" req err={err.to}>
          <select className="in" id="m-to" value={v.to} onChange={(e) => s('to')(e.target.value)}>{t.me.agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.title ? ` · ${a.title}` : ''}{a.away ? ' · unavailable today' : ''}</option>)}</select>
        </MF>
        <MF id="note" label="Handover note (internal)"><TA id="note" value={v.note} onChange={s('note')} ph="Optional" /></MF>
        {t.me.agents.find((a) => a.id === v.to)?.away && <div className="note warn"><Icon n="cal" s={15} /><p>This person is on leave today. A manual reassignment is kept as you chose it.</p></div>}
      </Dialog>
    );
  }
  if (m.type === 'follower') {
    const on = new Set([t.requester.id, t.assignee.id, ...t.followers.map((f) => f.userId)]);
    const opts = (people ?? []).filter((p) => !on.has(p.id));
    const doIt = () => (v.who ? sub.go(() => api(`${base}/followers`, { body: { userId: v.who, relation: v.rel } })) : setErr({ who: 'Select a colleague.' }));
    return (
      <Dialog title="Add follower or CC" onClose={onClose} footer={<><Cancel onClose={onClose} /><button className="btn primary" disabled={sub.pending} onClick={doIt}>Add</button></>}>
        <MF id="who" label="Person" req err={err.who}>
          <select className="in" id="m-who" value={v.who} onChange={(e) => s('who')(e.target.value)}><option value="">Select a colleague…</option>{opts.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.dept}</option>)}</select>
        </MF>
        <MF id="rel" label="Add as"><div className="seg"><button className={v.rel !== 'CC' ? 'on' : ''} onClick={() => s('rel')('FOLLOWER')}>Follower</button><button className={v.rel === 'CC' ? 'on' : ''} onClick={() => s('rel')('CC')}>CC</button></div></MF>
        {t.confidential && <div className="note conf"><Icon n="lock" s={15} /><p>This is confidential. The person you add gets read access to the full ticket, and the grant is written to the audit log.</p></div>}
        {t.helpdesk === 'SF' && <div className="note info"><Icon n="info" s={15} /><p>Only Sales, Presales and Solutions colleagues are listed.</p></div>}
      </Dialog>
    );
  }
  if (m.type === 'unfollow') {
    return (
      <Dialog title={`Unfollow ${t.key}?`} onClose={onClose} footer={<><Cancel onClose={onClose} label="Keep following" /><button className="btn danger" disabled={sub.pending} onClick={() => sub.go(() => api(`${base}/followers/${myId}`, { method: 'DELETE' }), () => t.confidential && nav('/following'))}>Unfollow</button></>}>
        <p style={{ margin: 0 }}>You stop seeing this ticket on Following and stop getting updates.{t.confidential ? ' Because it is confidential, you lose access entirely until someone adds you again.' : ''} The audit log keeps the history.</p>
      </Dialog>
    );
  }
  // cancel
  return (
    <Dialog title={`Cancel ${t.key}?`} onClose={onClose} footer={<><Cancel onClose={onClose} label="Keep request" /><button className="btn danger" disabled={sub.pending} onClick={() => sub.go(() => api(`${base}/cancel`, { body: { note: v.note || undefined } }))}>Cancel request</button></>}>
      <p style={{ margin: 0 }}>The request moves to History as <b>Cancelled</b> and {HDL[t.helpdesk]} stops work on it.</p>
      <MF id="note" label="Reason (optional)"><TA id="note" value={v.note} onChange={s('note')} ph="e.g. No longer needed" /></MF>
    </Dialog>
  );
}

function TicketModalLoader({ m, onClose }: { m: Extract<Modal, { key: string }>; onClose: () => void }) {
  const q = useDetail(m.key);
  if (!q.data) return null;
  return <TicketModal m={m} t={q.data} onClose={onClose} />;
}

function CategoryModal({ m, onClose }: { m: Extract<Modal, { type: 'cat' }>; onClose: () => void }) {
  const { data: adm } = useAdmin(true);
  const { data: cfg } = useConfig();
  if (!adm || !cfg) return null;
  return <CategoryForm m={m} adm={adm} cfg={cfg} onClose={onClose} />;
}
function CategoryForm({ m, adm, cfg, onClose }: { m: Extract<Modal, { type: 'cat' }>; adm: any; cfg: any; onClose: () => void }) {
  const c = m.key ? adm.categories.find((x: any) => x.helpdesk === m.hd && x.key === m.key) : null;
  const leadHd = cfg.leadHelpdesks.includes(m.hd);
  const priList: string[] = adm.priorities?.[m.hd] ?? cfg.priorities[m.hd] ?? [];
  const sfOk = (x: any) => ['Sales', 'Presales', 'Solutions'].includes(x.dept) && (x.roles?.includes('SF_ADMIN') || x.roles?.includes('HD_ADMIN'));
  const owners = m.hd === 'SF'
    ? [...((adm.agents.SF ?? []) as any[]).filter((x) => x.isQueue), ...adm.people.filter(sfOk)]
    : [...adm.people, ...((adm.agents[m.hd] ?? []) as any[]).filter((x) => x.isQueue && m.hd !== 'HR')];
  const [v, setV] = useState({
    n: c?.name ?? '', subs: (c?.subs ?? []).join('\n'), pri: c?.defaultPriority ?? 'Medium', owner: (c ? c.leadId || c.ownerId : adm.agents[m.hd]?.[0]?.id) ?? '',
    ctype: c?.requestType === 'course' ? 'course' : 'portal', conf: !!c?.confidential, reopen: c ? c.reopenAllowed !== false : true,
    mgr: !!c?.mgrApproval, mgrSubs: new Set<string>(c?.mgrApproval ? c.mgrApprovalSubs ?? c.subs : []),
  });
  const [ovr, setOvr] = useState<Record<string, { r: string; x: string }>>(() => Object.fromEntries(priList.map((p) => [p, {
    r: String(c?.slaOverride?.[p]?.[0] ?? ''), x: String(c?.slaOverride?.[p]?.[1] ?? ''),
  }])));
  const [err, setErr] = useState<Errs>({});
  const sub = useSubmit(setErr, onClose);
  const set = (k: keyof typeof v) => (x: any) => { setV((o) => ({ ...o, [k]: x })); setErr((e) => ({ ...e, [k]: '' })); };
  const subList = (v.subs as string).split('\n').map((x) => x.trim()).filter(Boolean);
  const toggleSub = (x: string, on: boolean) => setV((o) => { const n = new Set(o.mgrSubs); if (on) n.add(x); else n.delete(x); return { ...o, mgrSubs: n }; });
  const save = () => {
    const subs = subList;
    const e: Errs = {};
    if (!v.n.trim()) e.n = 'Name the category.';
    if (!subs.length) e.subs = 'Add at least one sub-category.';
    if (m.hd === 'SF' && !v.owner) e.owner = 'Choose the assignment owner or queue.';
    const slaOverride: Record<string, [number, number]> = {};
    if (m.hd === 'SF') for (const p of priList) {
      const r = ovr[p]?.r ?? '';
      const x = ovr[p]?.x ?? '';
      if (!r && !x) continue;
      const rn = Number(r), xn = Number(x);
      if (!Number.isFinite(rn) || !Number.isFinite(xn) || rn <= 0 || xn <= 0) e.slaOverride = 'Enter both response and resolution targets in hours.';
      else slaOverride[p] = [rn, xn];
    }
    const picked = subs.filter((x) => v.mgrSubs.has(x));
    if (v.mgr && !picked.length) e.mgrSubs = 'Pick at least one sub-category, or turn manager approval off.';
    if (Object.keys(e).length) return setErr(e);
    const body = {
      helpdesk: m.hd, name: v.n.trim(), subs, defaultPriority: v.pri, ownerId: v.owner, confidential: leadHd ? v.conf : undefined, reopenAllowed: leadHd ? v.reopen : undefined, requestType: m.hd === 'LND' ? v.ctype : undefined,
      mgrApproval: v.mgr, mgrApprovalSubs: v.mgr ? picked : [], slaOverride: m.hd === 'SF' ? slaOverride : undefined,
    };
    sub.go(() => (c ? api(`/admin/categories/${c.id}`, { method: 'PUT', body }) : api('/admin/categories', { body })));
  };
  return (
    <Dialog title={c ? `Edit category · ${c.name}` : `Add ${HDL[m.hd]} category`} onClose={onClose} footer={<><Cancel onClose={onClose} /><button className="btn primary" disabled={sub.pending} onClick={save}>{c ? 'Save changes' : 'Add category'}</button></>}>
      <MF id="n" label="Category name" req err={err.n}><input className="in" id="m-n" value={v.n} placeholder="e.g. Relocation" onChange={(e) => set('n')(e.target.value)} /></MF>
      <MF id="subs" label="Sub-categories (one per line)" req err={err.subs}><TA id="subs" rows={4} value={v.subs} onChange={set('subs')} /></MF>
      <div className="row2">
        <MF id="pri" label="Default priority"><select className="in" id="m-pri" value={v.pri} onChange={(e) => set('pri')(e.target.value)}>{priList.map((p: string) => <option key={p}>{p}</option>)}</select></MF>
        <MF id="owner" label={leadHd ? 'Category lead' : m.hd === 'SF' ? 'Assignment owner / queue' : 'Owner / queue'} req={m.hd === 'SF'} err={err.owner}><select className="in" id="m-owner" value={v.owner} onChange={(e) => set('owner')(e.target.value)}>{owners.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></MF>
      </div>
      {m.hd === 'LND' && (
        <MF id="ctype" label="Request type"><select className="in" id="m-ctype" value={v.ctype} onChange={(e) => set('ctype')(e.target.value)}><option value="portal">Portal problem</option><option value="course">Course request (needs approval)</option></select></MF>
      )}
      {leadHd && (
        <>
          <label className="check"><input type="checkbox" id="m-conf" checked={v.conf} onChange={(e) => set('conf')(e.target.checked)} />Confidential: only requester, agent, lead and added followers can see it</label>
          <label className="check"><input type="checkbox" id="m-reopen" checked={v.reopen} onChange={(e) => set('reopen')(e.target.checked)} />Requester can reopen within 30 days</label>
        </>
      )}
      <label className="check"><input type="checkbox" id="m-mgr" checked={v.mgr} onChange={(e) => setV((o) => ({ ...o, mgr: e.target.checked, mgrSubs: e.target.checked && !o.mgrSubs.size ? new Set(subList) : o.mgrSubs }))} />Manager approval needed</label>
      {v.mgr && (
        <MF id="mgrSubs" label="Applies to" err={err.mgrSubs}>
          <div className="cbgrid">{subList.map((x) => <label key={x} className="check"><input type="checkbox" checked={v.mgrSubs.has(x)} onChange={(e) => { toggleSub(x, e.target.checked); setErr((o) => ({ ...o, mgrSubs: '' })); }} />{x}</label>)}</div>
        </MF>
      )}
      {m.hd === 'SF' && <MF id="slaOverride" label="Response / resolution targets by priority (hours, optional)" err={err.slaOverride}>
        <div className="tbl-wrap" id="m-slaOverride"><table className="t">
          <thead><tr><th>Priority</th><th>First response</th><th>Resolution</th></tr></thead>
          <tbody>{priList.map((p) => <tr key={p} style={{ cursor: 'default' }}>
            <td><PriFlag p={p} /></td>
            <td><input className="in" type="number" min={0.5} step={0.5} style={{ width: 90 }} aria-label={`${p} first response hours`} value={ovr[p]?.r ?? ''} onChange={(e) => setOvr((o) => ({ ...o, [p]: { ...o[p], r: e.target.value } }))} /></td>
            <td><input className="in" type="number" min={1} style={{ width: 90 }} aria-label={`${p} resolution hours`} value={ovr[p]?.x ?? ''} onChange={(e) => setOvr((o) => ({ ...o, [p]: { ...o[p], x: e.target.value } }))} /></td>
          </tr>)}</tbody>
        </table></div>
      </MF>}
      {!!c?.extraSteps?.length && <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Additional approval: {c.extraSteps.join(' → ')} (set by policy, not by this switch)</p>}
      <div className="note info"><Icon n="info" s={15} /><p>Changes apply to new tickets straight away and show in the Raise ticket form. When manager approval is on, the SLA starts once the last approver approves.</p></div>
    </Dialog>
  );
}

/** Demo stand-in for the Attendance and Leave modules: who is on leave today. */
function OooModal({ onClose }: { onClose: () => void }) {
  const { data } = useAbsences(true);
  const act = useAction();
  return (
    <Dialog title="Out of office (demo)" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <div className="note info"><Icon n="info" s={15} /><p>{data?.note ?? 'Simulates the Attendance and Leave modules.'} Tickets that become workable while someone is on leave go to the next available person; escalation is not used for this.</p></div>
      {!data ? <div className="gempty">Loading…</div> : data.groups.map((g) => (
        <div key={g.hd} className="ooo-grp">
          <h4>{g.label}</h4>
          {g.people.map((p) => (
            <label key={p.id} className="ooo-row">
              <span><b>{p.name}</b>{p.title && <span className="muted"> · {p.title}</span>}{p.onLeaveTomorrow && !p.onLeaveToday && <span className="chip" style={{ marginLeft: 6 }}>On leave tomorrow</span>}</span>
              <span className="ooo-tg">
                <span className="muted">On leave today</span>
                <input type="checkbox" role="switch" aria-label={`${p.name} on leave today`} checked={p.onLeaveToday} disabled={act.pending}
                  onChange={() => act.run(() => api(`/demo/absences/${p.id}`, { method: 'PUT', body: { on: !p.onLeaveToday } }))} />
              </span>
            </label>
          ))}
        </div>
      ))}
    </Dialog>
  );
}

function FieldModal({ m, onClose }: { m: Extract<Modal, { type: 'field' }>; onClose: () => void }) {
  const { data: adm } = useAdmin(true);
  const { data: cfg } = useConfig();
  const x = m.id ? adm?.fields.find((f: any) => f.id === m.id) : null;
  const cn = adm?.categories.find((c: any) => c.helpdesk === m.hd && c.key === m.cat)?.name ?? m.cat;
  const [v, setV] = useState({
    l: x?.label ?? '', ftype: x?.type ?? 'text', ph: x?.placeholder ?? '', opts: (x?.options ?? []).join(', '), req: x?.required === true,
    hint: x?.hint ?? '', min: x?.min == null ? '' : String(x.min), pattern: x?.pattern ?? '', patternMessage: x?.patternMessage ?? '', def: x?.defaultValue ?? '',
  });
  const [err, setErr] = useState<Errs>({});
  const sub = useSubmit(setErr, onClose);
  if (!adm || !cfg) return null;
  const set = (k: keyof typeof v) => (val: any) => { setV((o) => ({ ...o, [k]: val })); setErr((e) => ({ ...e, [k]: '' })); };
  const save = () => {
    const opts = (v.opts as string).split(',').map((o) => o.trim()).filter(Boolean);
    const e: Errs = {};
    if (!v.l.trim()) e.l = 'Add a label.';
    if (v.ftype === 'select' && !opts.length) e.opts = 'Add at least one option.';
    if (v.pattern) { try { new RegExp(v.pattern); } catch { e.pattern = 'Check the pattern syntax.'; } }
    if (Object.keys(e).length) return setErr(e);
    const body = {
      helpdesk: x?.helpdesk ?? m.hd, categoryKey: x?.categoryKey ?? m.cat, label: v.l.trim(), type: v.ftype,
      placeholder: v.ph || undefined, options: v.ftype === 'select' ? opts : undefined, required: v.req,
      hint: v.hint || undefined, min: v.min === '' ? null : Number(v.min), pattern: v.pattern || undefined,
      patternMessage: v.patternMessage || undefined, defaultValue: v.def || undefined,
    };
    sub.go(() => (x ? api(`/admin/fields/${x.id}`, { method: 'PUT', body }) : api('/admin/fields', { body })));
  };
  return (
    <Dialog title={x ? `Edit field · ${x.label}` : `Add field · ${cn}`} onClose={onClose} footer={<><Cancel onClose={onClose} /><button className="btn primary" disabled={sub.pending} onClick={save}>{x ? 'Save field' : 'Add field'}</button></>}>
      <MF id="l" label="Label" req err={err.l}><input className="in" id="m-l" value={v.l} placeholder="e.g. Employee ID of the person affected" onChange={(e) => set('l')(e.target.value)} /></MF>
      <div className="row2">
        <MF id="ftype" label="Type"><select className="in" id="m-ftype" value={v.ftype} onChange={(e) => set('ftype')(e.target.value)}>{Object.entries(cfg.fieldTypes).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></MF>
        <MF id="ph" label="Placeholder"><input className="in" id="m-ph" value={v.ph} onChange={(e) => set('ph')(e.target.value)} /></MF>
      </div>
      {v.ftype === 'select' && <MF id="opts" label="Options (comma separated)" req err={err.opts}><input className="in" id="m-opts" value={v.opts} placeholder="e.g. Mumbai, Pune, Bengaluru" onChange={(e) => set('opts')(e.target.value)} /></MF>}
      <div className="row2">
        <MF id="hint" label="Hint"><input className="in" id="m-hint" value={v.hint} onChange={(e) => set('hint')(e.target.value)} /></MF>
        <MF id="def" label="Default value"><input className="in" id="m-def" value={v.def} onChange={(e) => set('def')(e.target.value)} /></MF>
      </div>
      {v.ftype === 'number' && <MF id="min" label="Minimum"><input className="in" type="number" id="m-min" value={v.min} onChange={(e) => set('min')(e.target.value)} /></MF>}
      <MF id="pattern" label="Validation pattern" err={err.pattern}><input className="in" id="m-pattern" value={v.pattern} placeholder="Optional regular expression" onChange={(e) => set('pattern')(e.target.value)} /></MF>
      {v.pattern && <MF id="patternMessage" label="Validation message"><input className="in" id="m-patternMessage" value={v.patternMessage} onChange={(e) => set('patternMessage')(e.target.value)} /></MF>}
      <label className="check"><input type="checkbox" id="m-freq" checked={v.req} onChange={(e) => set('req')(e.target.checked)} />Required</label>
      <div className="note info"><Icon n="info" s={15} /><p>Shown in the {HDL[m.hd]} form for <b>{cn}</b>, after the core fields.</p></div>
    </Dialog>
  );
}

function RoleModal({ m, onClose }: { m: Extract<Modal, { type: 'role' }>; onClose: () => void }) {
  const { data: adm } = useAdmin(true);
  const { data: cfg } = useConfig();
  if (!adm || !cfg) return null;
  return <RoleForm m={m} adm={adm} cfg={cfg} onClose={onClose} />;
}
const CAT_ROLES: Record<string, string[]> = {
  HR: ['HR_AGENT'], LND: ['LND_COORD', 'LND_HEAD'], IT: ['IT_AGENT', 'IT_HEAD'],
  ADM: ['ADM_AGENT', 'ADM_HEAD'], SF: ['SF_ADMIN'],
};
export function RoleForm({ m, adm, cfg, onClose }: { m: Extract<Modal, { type: 'role' }>; adm: any; cfg: any; onClose: () => void }) {
  const prefill = (id: string) => {
    const p = adm.people.find((x: any) => x.id === id);
    const cats: Record<string, Set<string>> = {};
    for (const hd of Object.keys(CAT_ROLES)) cats[hd] = new Set<string>(p?.roleCategories?.[hd] ?? (hd === 'HR' ? p?.hrCategories ?? [] : []));
    return { roles: new Set<string>(p?.roles ?? []), cats };
  };
  const [pick, setPick] = useState(m.userId ?? '');
  const [st, setSt] = useState(() => prefill(m.userId ?? ''));
  const [err, setErr] = useState<Errs>({});
  const sub = useSubmit(setErr, onClose);
  const toggle = (v: string, on: boolean) => setSt((o) => { const n = new Set(o.roles); if (on) n.add(v); else n.delete(v); return { ...o, roles: n }; });
  const toggleCat = (hd: string, v: string, on: boolean) => setSt((o) => {
    const n = new Set(o.cats[hd] ?? []);
    if (on) n.add(v); else n.delete(v);
    return { ...o, cats: { ...o.cats, [hd]: n } };
  });
  const save = () => {
    if (!pick) return setErr({ pick: 'Select an employee.' });
    const keep = [...st.roles].filter((r) => !adm.assignableRoles.includes(r));
    const roles = [...new Set([...keep, ...adm.assignableRoles.filter((r: string) => st.roles.has(r))])];
    const roleCategories = Object.fromEntries(Object.entries(st.cats)
      .filter(([hd]) => CAT_ROLES[hd]?.some((r) => st.roles.has(r)))
      .map(([hd, keys]) => [hd, [...keys]]));
    const hrCategories = st.roles.has('HR_AGENT') ? [...(st.cats.HR ?? [])] : [];
    sub.go(() => api(`/admin/people/${pick}/roles`, { method: 'PUT', body: { roles, hrCategories, roleCategories } }));
  };
  const name = adm.people.find((x: any) => x.id === m.userId)?.name;
  return (
    <Dialog title={m.userId ? `Edit roles · ${name}` : 'Assign helpdesk role'} onClose={onClose} footer={<><Cancel onClose={onClose} /><button className="btn primary" disabled={sub.pending} onClick={save}>Save roles</button></>}>
      {!m.userId && (
        <MF id="pick" label="Employee" req err={err.pick}>
          <select className="in" id="m-pick" value={pick} onChange={(e) => { setPick(e.target.value); setSt(prefill(e.target.value)); setErr({}); }}>
            <option value="">Select an employee…</option>{adm.people.map((x: any) => <option key={x.id} value={x.id}>{x.name} · {x.dept}</option>)}
          </select>
        </MF>
      )}
      <div className="fld"><label>Helpdesk roles</label><div className="cbgrid">{adm.assignableRoles.map((r: string) => <label key={r} className="check"><input type="checkbox" id={`m-r-${r}`} checked={st.roles.has(r)} onChange={(e) => toggle(r, e.target.checked)} />{cfg.roleLabels[r] ?? r}</label>)}</div></div>
      {Object.entries(CAT_ROLES).filter(([, roles]) => roles.some((r) => st.roles.has(r))).map(([hd]) => {
        const cats = cfg.categories.filter((c: any) => c.helpdesk === hd && c.active !== false);
        if (!cats.length) return null;
        return <div className="fld" key={hd}><label>{hd === 'HR' ? 'HR categories worked' : `${HDL[hd] ?? hd} categories worked`}</label><div className="cbgrid">{cats.map((c: any) => <label key={c.key} className="check"><input type="checkbox" id={hd === 'HR' ? `m-hc-${c.key}` : `m-cat-${hd}-${c.key}`} checked={!!st.cats[hd]?.has(c.key)} onChange={(e) => toggleCat(hd, c.key, e.target.checked)} />{c.name}</label>)}</div></div>;
      })}
      {st.roles.has('HRLND_ADMIN') && <div className="note conf"><Icon n="lock" s={15} /><p>HR / L&amp;D admins approve L&amp;D course requests and can read every HR ticket, including confidential ones. Access is audited.</p></div>}
      {st.roles.has('HD_ADMIN') && <div className="note info"><Icon n="gear" s={15} /><p>Helpdesk admins see the Admin console and can work any ticket.</p></div>}
      <div className="note info"><Icon n="info" s={15} /><p>Manager access comes from reporting lines in NPSTX. Salesforce helpdesk access comes from the department (Sales, Presales, Solutions). Neither is set here.</p></div>
    </Dialog>
  );
}

function FaqModal({ m, onClose }: { m: Extract<Modal, { type: 'faq' }>; onClose: () => void }) {
  const hd = useUi((s) => s.faq.hd);
  const { data } = useFaqs(hd);
  const x = data?.faqs.find((f) => f.id === m.id);
  const [v, setV] = useState({ q: x?.question ?? '', a: x?.answer ?? '' });
  const [err, setErr] = useState<Errs>({});
  const sub = useSubmit(setErr, onClose);
  if (!x) return null;
  const save = () => {
    const e: Errs = {};
    if (!v.q.trim()) e.q = 'Write the question.';
    if (!v.a.trim()) e.a = 'Write the answer.';
    if (Object.keys(e).length) return setErr(e);
    sub.go(() => api(`/faqs/${x.id}`, { method: 'PUT', body: { question: v.q.trim(), answer: v.a.trim(), categoryKey: x.categoryKey } }));
  };
  return (
    <Dialog title={`Edit ${HDL[x.helpdesk]} FAQ`} onClose={onClose} footer={<><Cancel onClose={onClose} /><button className="btn primary" disabled={sub.pending} onClick={save}>Save FAQ</button></>}>
      <MF id="q" label="Question" req err={err.q}><input className="in" id="m-q" value={v.q} onChange={(e) => setV({ ...v, q: e.target.value })} /></MF>
      <MF id="a" label="Answer" req err={err.a}><TA id="a" rows={6} value={v.a} onChange={(a) => setV({ ...v, a })} /></MF>
      <div className="note info"><Icon n="info" s={15} /><p>Use **bold** for emphasis and [square brackets] for items still to be confirmed (TC). The change is written to the audit log and the AI knowledge base is refreshed.</p></div>
    </Dialog>
  );
}

export function ModalHost() {
  const modal = useUi((s) => s.modal);
  const set = useUi((s) => s.set);
  const { data: me } = useMe();
  if (!modal || !me) return null;
  const close = () => set({ modal: null });
  switch (modal.type) {
    case 'cat': return <CategoryModal key={JSON.stringify(modal)} m={modal} onClose={close} />;
    case 'field': return <FieldModal key={JSON.stringify(modal)} m={modal} onClose={close} />;
    case 'role': return <RoleModal key={JSON.stringify(modal)} m={modal} onClose={close} />;
    case 'faq': return <FaqModal key={modal.id} m={modal} onClose={close} />;
    case 'ooo': return <OooModal onClose={close} />;
    default: return <TicketModalLoader key={JSON.stringify(modal)} m={modal} onClose={close} />;
  }
}
