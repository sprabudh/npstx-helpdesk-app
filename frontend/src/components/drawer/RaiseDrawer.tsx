import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { useAction, useConfig, useMe, usePeople, useRelatedOptions } from '../../api/hooks';
import type { Category, Config, Draft, FormField, Hd, Me } from '../../api/types';
import { evalCond, isRequired, isShown } from '../../lib/cond';
import { fmtH, HDL, isoDate, p2, sizeLabel } from '../../lib/format';
import { Icon } from '../../lib/icons';
import { emptyFilters, useUi, type DrawerState } from '../../store/ui';
import { Addition, Avatar, HdBadge, Md } from '../common/bits';

const HD_ORDER: Hd[] = ['HR', 'LND', 'IT', 'ADM', 'SF'];
const CARDS: [Hd, string, string, string][] = [
  ['HR', 'hr', 'HR helpdesk', 'Payroll, leave and attendance, benefits, letters, policies, onboarding and exit formalities'],
  ['LND', 'cap', 'L&D helpdesk', 'Course requests, LinkedIn Learning, Skillup Lounge, certificates, training sessions'],
  ['IT', 'laptop', 'IT and Support', 'Laptops and assets, software, access, passwords, network, email, security'],
  ['ADM', 'building', 'Admin Desk', 'Facilities, seating, travel, transport, ID cards, visitors, courier, pantry, purchases'],
  ['SF', 'cloud', 'Salesforce helpdesk', 'Access, data, reports, opportunities setup. Creates a Case in Salesforce'],
];
const SCHEMA_HDS = ['IT', 'ADM'];
const NEED_SRC = ['CONTENT', 'CERT', 'SESSION', 'ACCESS', 'ENROL'];
const FILE_OK = /\.(pdf|png|jpe?g|gif|docx?|xlsx?|pptx?|txt|csv)$/i;
const URGENCY_PRI: Record<string, string> = { 'Can wait': 'Low', Today: 'Medium', 'Immediately (safety risk)': 'High' };
const AI_ERR: Record<string, [string, string]> = {
  denied: ['Microphone access was blocked.', 'Allow the microphone for NPSTX in your browser settings, or type your request instead.'],
  nospeech: ['No speech detected.', 'Check that the right microphone is selected and try again, or type instead.'],
  unclear: ['Could not understand that.', 'Edit the transcript and select Re-analyse, or fill the form yourself.'],
  network: ['Network error while analysing.', 'Your transcript is kept. Try again, or fill the form yourself.'],
  blocked: ['That request is for a helpdesk you cannot use.', 'AI did not choose it. Pick one of your helpdesks, or edit the transcript and re-analyse.'],
};
const LIVE = -1;
type Vals = Record<string, any>;
interface Ai { st: 'idle' | 'listening' | 'transcribing' | 'analysing' | 'filled' | 'error'; tx: string; filled: Record<string, 1>; prev: Vals; unsure: string[]; sample: number | null; secs: number; err: string | null; used: boolean; hdAuto: boolean; ccPrev?: string[]; mgrPrev?: boolean }
const aiInit = (): Ai => ({ st: 'idle', tx: '', filled: {}, prev: {}, unsure: [], sample: null, secs: 0, err: null, used: false, hdAuto: false });
interface D { step: 1 | 2; hd: Hd | null; f: Vals; err: Record<string, string>; files: File[]; cc: string[]; redirOff: boolean; ai: Ai }
const speechCtor = (): any => (typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null : null);

function slaFor(cfg: Config, hd: string, cat: Category | undefined, pri: string): [number, number] {
  const shared = cfg.sla.shared;
  return cat?.slaOverride?.[pri] ?? (cfg.sla as any)[hd]?.[pri] ?? shared[pri] ?? shared.Medium;
}
const slaText = (cfg: Config, pri: string, hd = 'HR', cat?: Category) => {
  const [a, b] = slaFor(cfg, hd, cat, pri);
  return `response within ${fmtH(a)}, resolution within ${fmtH(b)}`;
};
/** Same rule as the server: manager step when the category toggle covers the sub-category, then any policy steps. */
const chainOf = (c: Category | undefined, f: Vals): string[] | null => {
  if (!c) return null;
  const mgr = !!c.mgrApproval && (!c.mgrApprovalSubs?.length || c.mgrApprovalSubs.includes(String(f.sub ?? '')));
  const rule = c.helpdesk === 'LND' ? null : (c.approvalRule ?? []).find((x) => !x.when || evalCond(x.when, f));
  const extra = c.helpdesk === 'LND' ? (f.reqType === 'course' ? ['lnd'] : []) : (rule?.chain ?? []).filter((x) => x !== 'mgr');
  const chain = [...(mgr ? ['mgr'] : []), ...extra];
  return chain.length ? chain : null;
};

function newForm(hd: Hd, cat: string | null | undefined, me: Me, cfg: Config, pre?: DrawerState['pre']): Vals {
  const c = cfg.categories.find((x) => x.helpdesk === hd && x.key === cat);
  const f: Vals = { cat: cat || '', sub: '', title: '', desc: '', location: me.location || 'Mumbai HQ', mgrCc: true, pri: hd === 'HR' ? '' : 'Medium', reqType: cat === 'COURSE' ? 'course' : cat ? 'portal' : '' };
  if (hd === 'HR' && c) { f.pri = c.defaultPriority; f.mgrCc = !c.confidential; }
  if (SCHEMA_HDS.includes(hd)) { f.pri = ''; f.mgrCc = false; if (c) applyDefaults(hd, c, f, me, cfg); }
  else if (c) applyCustomDefaults(cfg, hd, c, f);
  if (pre) Object.entries(pre).forEach(([k, v]) => v && (f[k] = v));
  return f;
}
function applyDefaults(hd: string, c: Category, f: Vals, me: Me, cfg: Config) {
  f.pri = c.defaultPriority;
  cfg.formFields.filter((x) => x.helpdesk === hd && x.categoryKey === c.key && !x.custom).forEach((x) => {
    if (x.defaultValue && !f[x.key]) f[x.key] = x.defaultValue === 'mgr' ? me.managerId || '' : x.defaultValue;
  });
  applyCustomDefaults(cfg, hd, c, f);
}
function applyCustomDefaults(cfg: Config, hd: string, c: Category, f: Vals) {
  cfg.formFields.filter((x) => x.helpdesk === hd && x.categoryKey === c.key && x.custom && x.active && x.defaultValue && !f[x.key] && isShown(x, f)).forEach((x) => {
    f[x.key] = x.defaultValue!;
  });
}

/** Field wrapper with the AI chip, review highlight and error, ids d-<field>. */
function F({ d, id, label, req, hint, children, onUndo }: { d: D; id: string; label: ReactNode; req?: boolean; hint?: ReactNode; children: ReactNode; onUndo: (k: string) => void }) {
  const e = d.err[id];
  const rev = d.ai.unsure.includes(id) && !e;
  return (
    <div className={`fld ${e ? 'bad' : ''} ${rev ? 'review' : ''}`}>
      <div className="fl">
        <label htmlFor={`d-${id}`}>{label}{req && <> <span className="req">*</span></>}</label>
        {d.ai.filled[id] && <AiChip k={id} onUndo={onUndo} />}
      </div>
      {children}
      {hint && <span className="hint">{hint}</span>}
      {rev && <span className="hint rv">AI was not sure about this. Please check it.</span>}
      {e && <span className="err">{e}</span>}
    </div>
  );
}
const AiChip = ({ k, onUndo }: { k: string; onUndo: (k: string) => void }) => (
  <span className="aichip"><Icon n="spark" s={11} />AI filled<button aria-label="Undo the AI value" onClick={() => onUndo(k)}><Icon n="x" s={11} /></button></span>
);

export default function RaiseDrawer({ init }: { init: DrawerState }) {
  const { data: me } = useMe();
  const { data: cfg } = useConfig();
  if (!me || !cfg) return null;
  return <DrawerInner init={init} me={me} cfg={cfg} />;
}

function DrawerInner({ init, me, cfg }: { init: DrawerState; me: Me; cfg: Config }) {
  const set = useUi((s) => s.set);
  const toast = useUi((s) => s.toast);
  const aiSim = useUi((s) => s.aiSim);
  const nav = useNavigate();
  const act = useAction();
  const aiOn = cfg.ai.enabled;
  const [d, setD] = useState<D>(() => {
    const hd = init.hd && me.helpdesks.includes(init.hd) ? init.hd : null;
    return { step: hd ? 2 : 1, hd, f: hd ? newForm(hd, init.cat, me, cfg, init.pre) : { ...(init.pre ?? {}) }, err: {}, files: [], cc: [], redirOff: false, ai: aiInit() };
  });
  const dRef = useRef(d);
  dRef.current = d;
  const timers = useRef<number[]>([]);
  const rec = useRef<any>(null);
  const aiGen = useRef(0);
  const { data: people } = usePeople(d.hd);
  const { data: related } = useRelatedOptions(!!d.f.cat);
  const stopAi = () => { timers.current.forEach((t) => { clearTimeout(t); clearInterval(t); }); timers.current = []; try { rec.current?.abort(); } catch { /* already stopped */ } rec.current = null; };
  useEffect(() => () => stopAi(), []);
  const close = () => { stopAi(); set({ drawer: null }); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !useUi.getState().modal && close();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Focus the first invalid field after a failed submit.
  const errCount = Object.keys(d.err).length;
  useEffect(() => {
    if (errCount) (document.querySelector('.drawer .fld.bad .in, .drawer .fld.bad button') as HTMLElement | null)?.focus();
  }, [errCount]);

  const cats = (hd: string) => cfg.categories.filter((c) => c.helpdesk === hd);
  const catOf = (hd: string | null, k: string) => cfg.categories.find((c) => c.helpdesk === hd && c.key === k);
  const schemaOf = (hd: string, cat: string) => cfg.formFields.filter((x) => x.helpdesk === hd && x.categoryKey === cat && !x.custom).sort((a, b) => a.sortOrder - b.sortOrder);
  const extraOf = (hd: string, cat: string) => cfg.formFields.filter((x) => x.helpdesk === hd && x.categoryKey === cat && x.custom && x.active).sort((a, b) => a.sortOrder - b.sortOrder);

  // ---------- field changes ----------
  const setF = (k: string, val: any) =>
    setD((o) => {
      const f = { ...o.f, [k]: val };
      const err = { ...o.err };
      delete err[k];
      const ai = { ...o.ai, filled: { ...o.ai.filled }, unsure: o.ai.unsure.filter((x) => x !== k) };
      delete ai.filled[k];
      if (k === 'cat') {
        f.sub = '';
        for (const x of cfg.formFields.filter((x) => x.helpdesk === o.hd && x.categoryKey !== val && x.custom)) delete f[x.key];
        const c = catOf(o.hd, val);
        if (o.hd === 'HR' && c) { f.pri = c.defaultPriority; f.mgrCc = !c.confidential; }
        if (o.hd && SCHEMA_HDS.includes(o.hd) && c) applyDefaults(o.hd, c, f, me, cfg);
        else if (o.hd && c) applyCustomDefaults(cfg, o.hd, c, f);
      }
      if (k === 'urgency') f.pri = URGENCY_PRI[val] || f.pri;
      return { ...o, f, err, ai };
    });
  const pickHd = (hd: Hd) => setD((o) => ({ ...o, step: 2, hd, f: newForm(hd, null, me, cfg, init.pre), err: {}, files: [], cc: [], redirOff: false, ai: { ...o.ai, hdAuto: false } }));
  const back = () => { stopAi(); setD((o) => ({ ...o, step: 1, hd: null, ai: aiInit() })); };
  const undo = (k: string) =>
    setD((o) => {
      const a = { ...o.ai, filled: { ...o.ai.filled }, unsure: o.ai.unsure.filter((x) => x !== k) };
      const f = { ...o.f };
      let cc = o.cc;
      if (k === 'cc') { cc = a.ccPrev ?? []; f.mgrCc = a.mgrPrev; }
      else { f[k] = a.prev[k] ?? ''; if (k === 'cat') { f.sub = a.prev.sub ?? ''; delete a.filled.sub; } }
      delete a.filled[k];
      return { ...o, f, cc, ai: a };
    });

  // ---------- inputs ----------
  const inp = (id: string, ph = '', type = 'text', extra: Record<string, unknown> = {}) => (
    <input className="in" id={`d-${id}`} type={type} value={d.f[id] ?? ''} placeholder={ph} onChange={(e) => setF(id, e.target.value)} {...extra} />
  );
  const dsel = (id: string, opts: (string | [string, string])[], ph: string) => (
    <select className="in" id={`d-${id}`} value={d.f[id] ?? ''} onChange={(e) => setF(id, e.target.value)}>
      <option value="">{ph}</option>
      {opts.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return <option key={v} value={v}>{l}</option>; })}
    </select>
  );
  const area = (id: string, rows: number, ph: string) => <textarea className="in" id={`d-${id}`} rows={rows} placeholder={ph} value={d.f[id] ?? ''} onChange={(e) => setF(id, e.target.value)} />;
  const ctl = (x: FormField) =>
    x.type === 'select' ? dsel(x.key, x.options ?? [], 'Select')
      : x.type === 'person' ? dsel(x.key, (cfg.managers ?? []).map((m) => [m.id, m.name] as [string, string]), 'Select a manager')
      : x.type === 'textarea' ? area(x.key, 3, x.placeholder ?? '')
      : inp(x.key, x.placeholder ?? '', x.type || 'text', x.min != null ? { min: x.min } : {});
  const extraFields = (hd: string, cat: string) => extraOf(hd, cat).filter((x) => isShown(x, d.f)).map((x) => <F d={d} onUndo={undo} key={x.key} id={x.key} label={x.label} req={isRequired(x, d.f)} hint={x.hint ?? undefined}>{ctl(x)}</F>);

  // ---------- common tail ----------
  const ccPeople = (people ?? []).filter((p) => !d.cc.includes(p.id) && p.id !== me.managerId);
  const [ccPick, setCcPick] = useState('');
  const pName = (id: string) => people?.find((p) => p.id === id)?.name ?? (id === me.managerId ? me.managerName : null) ?? id;
  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...d.files];
    for (const f of Array.from(list)) {
      if (next.length >= cfg.fileRules.maxFiles) { toast('Maximum 5 files per ticket', 'bad'); break; }
      if (f.size > cfg.fileRules.maxBytes) { toast(`${f.name} is over 10 MB`, 'bad'); continue; }
      if (!FILE_OK.test(f.name)) { toast(`${f.name}: file type not allowed`, 'bad'); continue; }
      next.push(f);
    }
    setD((o) => ({ ...o, files: next }));
  };
  const titleDesc = (
    <>
      <F d={d} onUndo={undo} id="title" label={d.hd === 'SF' ? 'Subject' : 'Title'} req>{inp('title', d.hd === 'SF' ? 'e.g. Cannot edit opportunities in West region' : 'Short summary of the issue', 'text', { maxLength: 150 })}<span className="counter">{(d.f.title || '').length}/150</span></F>
      <F d={d} onUndo={undo} id="desc" label="Description" req>{area('desc', 4, 'What happened, what you expected, and anything you already tried')}</F>
    </>
  );
  const ccBlock = (
    <div className="fld">
      <label>{d.hd === 'HR' ? 'Manager CC and followers' : 'CC colleagues'}</label>{d.ai.filled.cc && <AiChip k="cc" onUndo={undo} />}
      {d.hd === 'HR' && me.managerId && <label className="check"><input type="checkbox" id="d-mgrCc" checked={!!d.f.mgrCc} onChange={(e) => setF('mgrCc', e.target.checked)} />CC my manager ({me.managerName})</label>}
      <div className="fsel">
        <select className="in" id="d-ccpick" aria-label="Add a colleague" value={ccPick} onChange={(e) => setCcPick(e.target.value)}><option value="">Add a colleague…</option>{ccPeople.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.dept}</option>)}</select>
        <button className="btn sm" onClick={() => (ccPick ? (setD((o) => ({ ...o, cc: [...o.cc, ccPick] })), setCcPick('')) : toast('Pick a colleague first'))}>Add</button>
      </div>
      {d.cc.length > 0 && <div className="people">{d.cc.map((id) => <span key={id} className="person"><Avatar name={pName(id)} sm />{pName(id)}<span className="rel">CC</span><button aria-label="Remove" onClick={() => setD((o) => ({ ...o, cc: o.cc.filter((x) => x !== id) }))}><Icon n="x" s={12} /></button></span>)}</div>}
      <span className="hint">CC'd people see the ticket on their Following page and get updates. They cannot change status.{d.hd === 'SF' ? ' Only Sales, Presales and Solutions colleagues can be added.' : ''}</span>
    </div>
  );
  const filesBlock = (
    <F d={d} onUndo={undo} id="files" label="Attachments">
      <div className="drop">
        <Icon n="clip" s={18} />
        <span>Drop files or <b style={{ color: 'var(--accent)' }}>browse</b><br /><span className="hint">Up to 5 files, 10 MB each · PDF, images, Office, text. Scanned before download.</span></span>
        <input type="file" id="d-files" multiple accept=".pdf,.png,.jpg,.jpeg,.gif,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
      </div>
      {d.files.length > 0 && <div className="files">{d.files.map((x, i) => <span key={i} className="file"><Icon n="file" s={13} />{x.name} <span className="muted">{sizeLabel(x.size)}</span><button className="linkbtn" style={{ textDecoration: 'none' }} aria-label="Remove" onClick={() => setD((o) => ({ ...o, files: o.files.filter((_, j) => j !== i) }))}><Icon n="x" s={12} /></button></span>)}</div>}
    </F>
  );
  const commonTail = <>{titleDesc}{ccBlock}{filesBlock}</>;

  // ---------- forms ----------
  const apprNote = (c: Category | undefined) => {
    const ch = chainOf(c, d.f);
    if (!ch) return null;
    const mgrName = cfg.managers?.find((m) => m.id === d.f.approver)?.name ?? me.managerName;
    const who = (k: string) => (k === 'mgr' ? ` (${mgrName || 'Helpdesk admin, as you have no manager on record'})` : '');
    return (
      <div className="note appr" id="d-appr"><Icon n="users" s={15} /><p><b>Approval needed:</b> {ch.map((k) => (cfg.approvalSteps[k]?.l ?? k) + who(k)).join(' → ')}. The ticket starts as <b>Pending approval</b>. {ch.includes('mgr') ? 'Response and resolution times start once your manager approves.' : 'Response and resolution times start once it is approved.'} <mark className="tc">TC</mark></p></div>
    );
  };
  const hrForm = () => {
    const c = catOf('HR', d.f.cat);
    return (
      <>
        <F d={d} onUndo={undo} id="cat" label="Category" req>{dsel('cat', cats('HR').filter((x) => x.active).map((x) => [x.key, x.name]), 'Select a category')}</F>
        {c && <F d={d} onUndo={undo} id="sub" label="Sub-category" req>{dsel('sub', c.subs, 'Select a sub-category')}</F>}
        {c && <div className="note info"><Icon n="users" s={15} /><p>Routes to <b>{c.leadName}</b> (category lead) · {slaText(cfg, c.defaultPriority ?? 'Medium')} <mark className="tc">TC</mark>. {c.reopenAllowed !== false ? 'Reopen allowed for 30 days.' : 'This category does not allow reopening.'}</p></div>}
        {apprNote(c)}
        {c?.confidential && <div className="note conf"><Icon n="lock" s={15} /><p><b>Confidential category.</b> Only you, the assigned agent, the category lead and people you add can see this ticket.{c.restricted ? ' Grievance tickets are restricted further to the HR head.' : ''} Your manager is not CC'd unless you tick the box below.</p></div>}
        {titleDesc}
        {extraFields('HR', d.f.cat)}
        <F d={d} onUndo={undo} id="location" label="Location" req>{dsel('location', cfg.locations, 'Select location')}</F>
        {ccBlock}{filesBlock}
      </>
    );
  };
  const lndForm = () => {
    const course = d.f.reqType === 'course';
    const list = cats('LND').filter((c) => c.active && (course ? c.requestType === 'course' : d.f.reqType === 'portal' ? c.requestType !== 'course' : false));
    const c = catOf('LND', d.f.cat);
    const needSrc = course || NEED_SRC.includes(d.f.cat);
    const lreq = (v: string) => setD((o) => { const err = { ...o.err }; delete err.reqType; return { ...o, f: { ...o.f, reqType: v, cat: v === 'course' ? 'COURSE' : '', sub: '' }, err }; });
    return (
      <>
        <F d={d} onUndo={undo} id="reqType" label="Request type" req hint="Course requests need approval before work starts. Portal problems go straight to the support queue.">
          <div className="seg"><button id="d-reqType" className={course ? 'on' : ''} onClick={() => lreq('course')}>Course request</button><button className={d.f.reqType === 'portal' ? 'on' : ''} onClick={() => lreq('portal')}>Portal problem</button></div>
        </F>
        {d.f.reqType && <F d={d} onUndo={undo} id="cat" label="Category" req>{dsel('cat', list.map((x) => [x.key, x.name]), 'Select a category')}</F>}
        {c && <F d={d} onUndo={undo} id="sub" label="Sub-category" req>{dsel('sub', c.subs, 'Select a sub-category')}</F>}
        {c && (
          <>
            <div className="row2">
              {needSrc && <F d={d} onUndo={undo} id="learningSource" label="Platform / learning source" req>{dsel('learningSource', cfg.learningSources, 'Select')}</F>}
              <F d={d} onUndo={undo} id="learningItem" label="Course name / learning item" req={course || needSrc}>{inp('learningItem', 'e.g. Kubernetes Essentials')}</F>
            </div>
            {d.f.cat === 'SESSION' && <F d={d} onUndo={undo} id="sessionAt" label="Session date and time" req>{inp('sessionAt', '', 'datetime-local')}</F>}
            {course && <F d={d} onUndo={undo} id="justification" label="Business justification" req>{area('justification', 2, 'Why do you need this course?')}</F>}
            {!course && (
              <>
                <F d={d} onUndo={undo} id="problem" label="Problem details" req>{area('problem', 2, 'Page, error message, steps to repeat')}</F>
                <F d={d} onUndo={undo} id="device" label="Device and browser">{inp('device', 'e.g. Chrome 130 · Windows 11')}</F>
              </>
            )}
            {extraFields('LND', d.f.cat)}
            {d.f.cat === 'SESSION' && <div className="note info"><Icon n="info" s={15} /><p>Sessions within the next two days are handled first.</p></div>}
            {apprNote(c)}
            {!course && <div className="note info"><Icon n="users" s={15} /><p>Routes to <b>{c.ownerName ?? c.queueName ?? c.leadName}</b> · {slaText(cfg, d.f.pri || 'Medium')} <mark className="tc">TC</mark></p></div>}
            {commonTail}
          </>
        )}
      </>
    );
  };
  const sfForm = () => {
    const c = catOf('SF', d.f.cat);
    return (
      <>
        <div className="note sf"><Icon n="cloud" s={15} /><p>Submitting creates a <b>Case</b> in Salesforce. The active assignment rule picks the owner; status, milestones and escalation are mirrored here.</p></div>
        <div className="row2">
          <F d={d} onUndo={undo} id="cat" label="Type" req>{dsel('cat', cats('SF').filter((x) => x.active).map((x) => [x.key, x.name]), 'Select a type')}</F>
          {c && <F d={d} onUndo={undo} id="sub" label="Reason" req>{dsel('sub', c.subs, 'Select a reason')}</F>}
        </div>
        {c && (
          <>
            <div className="row2">
              <F d={d} onUndo={undo} id="account" label="Account name">{inp('account', 'e.g. Kestrel Logistics Pvt Ltd')}</F>
              <F d={d} onUndo={undo} id="oppId" label="Opportunity ID">{inp('oppId', '006… (15 or 18 characters)')}</F>
            </div>
            <F d={d} onUndo={undo} id="record" label="Record link or ID" req={c.needsRecord} hint={c.needsRecord ? 'Required for data and record changes.' : ''}>{inp('record', 'Paste the Salesforce record URL or ID')}</F>
            {c.needsImpact && <F d={d} onUndo={undo} id="impact" label="Business need and impact" req>{area('impact', 2, 'Who needs it, and what it unblocks')}</F>}
            {extraFields('SF', d.f.cat)}
            <div className="note info"><Icon n="users" s={15} /><p>Assignment rule routes this type to <b>{c.ownerName ?? c.queueName ?? c.leadName}</b>.</p></div>
            {commonTail}
          </>
        )}
      </>
    );
  };
  const schemaForm = (hd: Hd) => {
    const c = catOf(hd, d.f.cat);
    const sch = c ? schemaOf(hd, c.key) : [];
    return (
      <>
        <F d={d} onUndo={undo} id="cat" label="Category" req>{dsel('cat', cats(hd).filter((x) => x.active).map((x) => [x.key, x.name]), 'Select a category')}</F>
        {c && <F d={d} onUndo={undo} id="sub" label="Sub-category" req>{dsel('sub', c.subs, 'Select a sub-category')}</F>}
        {c && <div className="note info"><Icon n="users" s={15} /><p>Routes to <b>{c.queueId ? c.queueName : c.leadName}</b>{c.queueId ? ` (category lead ${c.leadName})` : ' (category lead)'} · {slaText(cfg, d.f.pri || c.defaultPriority || 'Medium', hd, c)} <mark className="tc">TC</mark>. {c.reopenAllowed !== false ? 'You can reopen within 7 days of resolution.' : 'This category does not allow reopening.'}</p></div>}
        {c?.confidential && <div className="note conf"><Icon n="lock" s={15} /><p><b>Confidential category.</b> Only you, IT security, the IT head and helpdesk admins can see this ticket. Do not forward suspicious emails to colleagues.</p></div>}
        {apprNote(c)}
        {sch.filter((x) => isShown(x, d.f)).map((x) => <F d={d} onUndo={undo} key={x.key} id={x.key} label={x.label} req={isRequired(x, d.f)} hint={x.hint ?? undefined}>{ctl(x)}</F>)}
        {c && extraFields(hd, d.f.cat)}
        {c && commonTail}
      </>
    );
  };
  const formFor = (hd: Hd) => (SCHEMA_HDS.includes(hd) ? schemaForm(hd) : hd === 'HR' ? hrForm() : hd === 'LND' ? lndForm() : sfForm());

  // ---------- redirect ----------
  const redirGuess = (): Hd | null => {
    if (!d.hd || d.redirOff) return null;
    const txt = `${d.f.title || ''} ${d.f.desc || ''}`;
    const re = (h: string) => (cfg.redirect[h] ? new RegExp(cfg.redirect[h], 'i') : null);
    if (txt.trim().length < 4 || !re(d.hd) || re(d.hd)!.test(txt)) return null;
    return HD_ORDER.find((h) => h !== d.hd && me.helpdesks.includes(h) && re(h)?.test(txt)) ?? null;
  };
  const redir = redirGuess();
  const switchTo = async (h: Hd) => {
    const keep = { title: d.f.title, desc: d.f.desc };
    let g: Draft | null = null;
    if (aiOn) {
      try {
        const r = await api<{ ok: boolean; draft?: Draft }>('/ai/draft', { body: { transcript: `${keep.title || ''}. ${keep.desc || ''}` } });
        g = r.ok && r.draft?.hd === h ? r.draft : null;
      } catch { /* switch without a category */ }
    }
    setD((o) => {
      const f: Vals = { ...newForm(h, g?.cat, me, cfg), ...keep };
      if (g?.f.sub) f.sub = g.f.sub;
      return { ...o, hd: h, f, err: {}, cc: o.cc.filter((id) => h !== 'SF' || people?.some((p) => p.id === id)), redirOff: false, ai: { ...o.ai, filled: {}, unsure: [] } };
    });
    toast(`Switched to ${HDL[h]}. Your title and description were kept.`);
  };

  // ---------- AI voice assist ----------
  const samples = cfg.aiSamples.filter((x) => me.helpdesks.includes(x.hd));
  const live = !!speechCtor();
  const sample = d.ai.sample ?? (samples.find((x) => x.hd === d.hd) ?? samples[0])?.i ?? 0;
  const setAi = (p: Partial<Ai>) => setD((o) => ({ ...o, ai: { ...o.ai, ...p } }));
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
  const applyDraft = (r: Draft, tx: string) =>
    setD((o) => {
      const files = o.files;
      let { hd, f, cc, step } = o;
      const a: Ai = { ...o.ai, filled: {}, prev: {}, unsure: [], tx };
      // undo any earlier AI values first (silent clear)
      Object.keys(o.ai.filled).forEach((k) => { if (k === 'cc') { cc = o.ai.ccPrev ?? []; f = { ...f, mgrCc: o.ai.mgrPrev }; } else f = { ...f, [k]: o.ai.prev[k] ?? '' }; });
      if (step === 1 || hd !== r.hd || f.cat !== r.cat) {
        const same = hd === r.hd && step === 2;
        const prevCat = f.cat;
        const keep = { title: f.title, desc: f.desc };
        hd = r.hd; step = 2;
        f = newForm(r.hd, r.cat, me, cfg);
        a.prev.cat = same ? prevCat : '';
        a.filled.cat = 1;
        a.hdAuto = !same;
        if (same) { a.prev.title = keep.title || ''; a.prev.desc = keep.desc || ''; }
      }
      f = { ...f };
      Object.entries(r.f).forEach(([k, v]) => { if (v == null || v === '') return; if (k === 'pri') { f[k] = v; return; } if (!(k in a.prev)) a.prev[k] = f[k] ?? ''; f[k] = v; a.filled[k] = 1; });
      if (r.mgr || r.cc.length) {
        a.ccPrev = [...cc]; a.mgrPrev = f.mgrCc; cc = [...cc];
        if (r.mgr) { if (hd === 'HR') f.mgrCc = true; else if (me.managerId && !cc.includes(me.managerId)) cc.push(me.managerId); }
        r.cc.forEach((id) => { if (hd === 'HR' && id === me.managerId) { f.mgrCc = true; return; } if (!cc.includes(id)) cc.push(id); });
        a.filled.cc = 1;
      }
      const reqEmpty = SCHEMA_HDS.includes(hd!) ? schemaOf(hd!, f.cat).filter((x) => isShown(x, f) && isRequired(x, f) && !f[x.key]).map((x) => x.key) : [];
      a.unsure = [...new Set([...r.unsure, ...reqEmpty])];
      a.st = 'filled';
      a.used = true;
      return { ...o, step, hd, f, cc, files, err: {}, ai: a };
    });
  const analyse = (tx: string, re: boolean, simulated = false) => {
    const gen = ++aiGen.current;
    setAi({ st: 'analysing', tx });
    later(async () => {
      if (gen !== aiGen.current) return;
      if (!re && simulated && aiSim === 'unclear') return setAi({ st: 'error', err: 'unclear' });
      try {
        const r = await api<{ ok: boolean; reason?: string; draft?: Draft }>('/ai/draft', { body: { transcript: tx } });
        if (gen !== aiGen.current) return;
        if (!r.ok || !r.draft) return setAi({ st: 'error', err: r.reason === 'blocked' ? 'blocked' : 'unclear' });
        const cur = dRef.current;
        const n = new Set(Object.keys(r.draft.f).filter((k) => k !== 'pri' && r.draft!.f[k] != null && r.draft!.f[k] !== ''));
        if (cur.step === 1 || cur.hd !== r.draft.hd || cur.f.cat !== r.draft.cat) n.add('cat');
        if (r.draft.mgr || r.draft.cc.length) n.add('cc');
        applyDraft(r.draft, tx);
        toast(`AI filled ${n.size} fields. Review them, then submit.`, 'ok');
      } catch {
        if (gen === aiGen.current) setAi({ st: 'error', err: 'network' });
      }
    }, 900);
  };
  const afterListen = () => {
    stopAi();
    if (aiSim === 'nospeech') return setAi({ st: 'error', err: 'nospeech' });
    setAi({ st: 'transcribing' });
    later(() => {
      const tx = cfg.aiSamples.find((x) => x.i === sample)?.t ?? '';
      if (aiSim === 'network') return setAi({ st: 'error', err: 'network', tx });
      analyse(tx, false, true);
    }, 900);
  };
  const micLive = () => {
    const Ctor = speechCtor();
    const r = new Ctor();
    rec.current = r;
    r.lang = 'en-IN';
    r.interimResults = false;
    let heard = '';
    r.onresult = (e: any) => { heard = Array.from(e.results as ArrayLike<any>).map((x: any) => x[0].transcript).join(' '); };
    r.onerror = (e: any) => { stopAi(); setAi({ st: 'error', err: e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : e.error === 'no-speech' ? 'nospeech' : 'network' }); };
    r.onend = () => { timers.current.forEach((t) => clearInterval(t)); if (heard.trim()) { setAi({ st: 'transcribing' }); later(() => analyse(heard.trim(), false), 300); } else setD((o) => (o.ai.st === 'listening' ? { ...o, ai: { ...o.ai, st: 'error', err: 'nospeech' } } : o)); };
    setAi({ st: 'listening', secs: 0, err: null });
    timers.current.push(window.setInterval(() => setD((o) => ({ ...o, ai: { ...o.ai, secs: o.ai.secs + 1 } })), 1000));
    try { r.start(); } catch { setAi({ st: 'error', err: 'denied' }); }
  };
  const aiStart = () => {
    if (d.ai.st === 'listening') { if (rec.current) { try { rec.current.stop(); } catch { /* stopped */ } return; } return afterListen(); }
    stopAi();
    if (sample === LIVE && live) return micLive();
    if (aiSim === 'denied') return setAi({ st: 'error', err: 'denied' });
    setAi({ st: 'listening', secs: 0, err: null });
    timers.current.push(window.setInterval(() => setD((o) => ({ ...o, ai: { ...o.ai, secs: o.ai.secs + 1 } })), 1000));
    later(afterListen, aiSim === 'nospeech' ? 3000 : 4200);
  };
  const aiClear = () => {
    setD((o) => {
      const f = { ...o.f };
      let cc = o.cc;
      Object.keys(o.ai.filled).forEach((k) => { if (k === 'cc') { cc = o.ai.ccPrev ?? []; f.mgrCc = o.ai.mgrPrev; } else f[k] = o.ai.prev[k] ?? ''; });
      return { ...o, f, cc, ai: { ...o.ai, filled: {}, prev: {}, unsure: [], st: 'idle' } };
    });
    toast('AI-filled fields cleared');
  };
  const nf = Object.keys(d.ai.filled).length;
  const conf = !!(d.hd && catOf(d.hd, d.f.cat)?.confidential);
  const a = d.ai;
  const aiPanel = aiOn ? (
    <section className="aimic" aria-label="AI voice assist" aria-live="polite">
      <div className="row">
        <button className={`micbtn ${a.st === 'listening' ? 'on' : ''}`} aria-label={a.st === 'listening' ? 'Stop listening' : 'Speak your request'} disabled={a.st === 'transcribing' || a.st === 'analysing'} onClick={aiStart}><Icon n={a.st === 'listening' ? 'stop' : 'mic'} s={22} /></button>
        <div className="msg2">
          {a.st === 'listening' ? <><b><span className="wave" aria-hidden="true">{Array.from({ length: 7 }, (_, i) => <i key={i} />)}</span>Listening… <span id="ai-timer" className="mono">0:{p2(a.secs)}</span></b><span>Speak naturally. Tap the button to stop.</span></>
            : a.st === 'transcribing' ? <><b><span className="spin" />Transcribing…</b><span>Turning your speech into text.</span></>
            : a.st === 'analysing' ? <><b><span className="spin" />Analysing with AI…</b><span>Choosing the helpdesk, category and fields.</span></>
            : a.st === 'filled' ? <><b><Icon n="spark" s={15} />Filled {nf} field{nf === 1 ? '' : 's'}</b><span>{a.unsure.length ? `${a.unsure.length} highlighted for review. ` : ''}Check everything. Nothing is sent until you select Submit.</span></>
            : a.st === 'error' && a.err ? <><b className="err">{AI_ERR[a.err][0]}</b><span>{AI_ERR[a.err][1]}</span></>
            : <><b>Describe it out loud</b><span>Tap the mic and say what you need. AI fills {d.step === 1 ? 'the helpdesk and ' : ''}the form; you review it before submitting.</span></>}
        </div>
        {sample !== LIVE && <span className="mockchip">Mock</span>}
      </div>
      {a.st === 'error' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={aiStart}><Icon n="mic" s={14} />Try again</button>
          <button className="btn sm" onClick={() => { setAi({ st: 'idle', err: null }); setTimeout(() => document.getElementById(d.step === 2 ? 'd-title' : 'ai-sample')?.focus()); }}>Type instead</button>
        </div>
      )}
      {a.tx && (
        <div className="fld">
          <div className="fl"><label htmlFor="ai-tx">Transcript</label><span className="hint">Edit it if something was misheard, then re-analyse.</span></div>
          <textarea className="in" id="ai-tx" rows={2} value={a.tx} onChange={(e) => setAi({ tx: e.target.value })} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={() => (a.tx.trim() ? analyse(a.tx, true) : toast('The transcript is empty', 'bad'))}><Icon n="refresh" s={14} />Re-analyse</button>
            {nf > 0 && <button className="btn sm" onClick={aiClear}><Icon n="x" s={14} />Clear all AI fields</button>}
          </div>
        </div>
      )}
      {cfg.demoMode && (
        <div className="demo">
          <span>Simulated speech:</span>
          <select className="in" id="ai-sample" aria-label="Sample speech to simulate" value={sample} onChange={(e) => setAi({ sample: Number(e.target.value) })}>
            {live && <option value={LIVE}>Your microphone (live)</option>}
            {samples.map((x) => <option key={x.i} value={x.i}>{HDL[x.hd]} · {x.l}</option>)}
          </select>
          <span>Outcome:</span>
          <select className="in" id="ai-sim" aria-label="Simulated outcome" value={aiSim} disabled={sample === LIVE} onChange={(e) => set({ aiSim: e.target.value as never })}>
            {[['ok', 'Works'], ['denied', 'Mic permission denied'], ['nospeech', 'No speech detected'], ['unclear', 'Could not understand'], ['network', 'Network error']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      )}
      <div className={`note ${conf ? 'conf' : 'info'}`} style={{ padding: '6px 10px' }}><Icon n="lock" s={14} /><p style={{ fontSize: 12 }}>{conf && <b>Confidential category. </b>}Audio is never stored. Only the transcript is kept, and only if you submit.{cfg.ai.mode === 'model' ? ' The transcript is sent to the AI model with personal details removed.' : ''}</p></div>
    </section>
  ) : null;

  // ---------- FAQ deflection (addition) ----------
  const [sugs, setSugs] = useState<{ id: number; helpdesk: Hd; question: string; answer: string }[]>([]);
  const [sugOpen, setSugOpen] = useState<number | null>(null);
  const [sugHidden, setSugHidden] = useState(false);
  const text = `${d.f.title || ''} ${d.f.desc || ''}`.trim();
  useEffect(() => {
    if (!aiOn || d.step !== 2 || text.length < 12 || sugHidden) return setSugs([]);
    const t = window.setTimeout(() => {
      api<{ suggestions: typeof sugs }>('/ai/faq-suggestions', { body: { text, helpdesk: d.hd } }).then((r) => setSugs(r.suggestions.slice(0, 3))).catch(() => setSugs([]));
    }, 500);
    return () => clearTimeout(t);
  }, [text, d.hd, d.step, aiOn, sugHidden]);
  const faqBox = sugs.length > 0 && (
    <section className="faqsug" aria-label="FAQs that may answer this">
      <header><Icon n="help" s={15} /><b>These FAQs may answer it</b><Addition title="Addition beyond the v2 mock: FAQ suggestions in the raise form" /><button className="linkbtn" style={{ marginLeft: 'auto' }} onClick={() => setSugHidden(true)}>Hide</button></header>
      {sugs.map((s) => (
        <div key={s.id} className="sg">
          <button className="q" aria-expanded={sugOpen === s.id} onClick={() => setSugOpen(sugOpen === s.id ? null : s.id)}><span>{s.question}</span><Icon n="chev" s={14} /></button>
          {sugOpen === s.id && (
            <div className="a">
              <p><Md text={s.answer} /></p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn sm primary" onClick={() => { api(`/faqs/${s.id}/vote`, { body: { helpful: true } }).catch(() => undefined); close(); toast('Glad that answered it. No ticket was raised.', 'ok'); }}>This answered it</button>
                <button className="btn sm" onClick={() => { setSugOpen(null); setSugHidden(true); api(`/faqs/${s.id}/vote`, { body: { helpful: false } }).catch(() => undefined); }}>No, continue with the ticket</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </section>
  );

  // ---------- submit ----------
  const validate = (): Record<string, string> => {
    const f = d.f, hd = d.hd!, err: Record<string, string> = {};
    const req = (k: string, m?: string) => { if (!String(f[k] ?? '').trim()) err[k] = m || 'This field is required.'; };
    req('cat', 'Choose a category.'); req('sub', 'Choose a sub-category.'); req('title', 'Add a short title.'); req('desc', 'Describe the issue.');
    if (hd === 'HR') req('location');
    for (const x of extraOf(hd, f.cat)) {
      if (!isShown(x, f)) continue;
      const v = String(f[x.key] ?? '').trim();
      if (!v) { if (isRequired(x, f)) err[x.key] = 'This field is required.'; continue; }
      if (x.pattern && !new RegExp(x.pattern, x.patternFlags ?? '').test(v)) err[x.key] = x.patternMessage ?? 'Check this value.';
      else if (x.min != null && Number(v) < x.min) err[x.key] = `Enter ${x.min} or more.`;
      else if (x.type === 'select' && x.options?.length && !x.options.includes(v)) err[x.key] = 'Pick one of the options.';
    }
    if (hd === 'LND') {
      if (!f.reqType) err.reqType = 'Choose a request type.';
      if (f.reqType === 'course') { req('learningSource'); req('learningItem'); req('justification', 'Explain why you need this course.'); }
      else if (f.cat) { req('problem', 'Describe the page, error and steps.'); if (NEED_SRC.includes(f.cat)) req('learningSource'); if (f.cat === 'SESSION') req('sessionAt', 'Add the session date and time.'); }
    }
    if (hd === 'SF') {
      const c = catOf('SF', f.cat);
      if (c?.needsRecord) req('record', 'Add the record link or ID.');
      if (c?.needsImpact) req('impact', 'Describe the business need and impact.');
      if (f.oppId && !/^006[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$/.test(String(f.oppId).trim())) err.oppId = 'Opportunity IDs start with 006 and have 15 or 18 characters.';
    }
    if (SCHEMA_HDS.includes(hd)) {
      const today = isoDate(me.now);
      schemaOf(hd, f.cat).forEach((x) => {
        if (!isShown(x, f)) return;
        const v = String(f[x.key] ?? '').trim();
        if (!v) { if (isRequired(x, f)) err[x.key] = 'This field is required.'; return; }
        if (x.pattern && !new RegExp(x.pattern, x.patternFlags ?? '').test(v)) err[x.key] = x.patternMessage ?? 'Check this value.';
        else if (x.min != null && Number(v) < x.min) err[x.key] = `Enter ${x.min} or more.`;
        else if (x.validation?.notPast && v.slice(0, 10) < today) err[x.key] = x.validation.message;
        else if (x.validation?.gteField && f[x.validation.gteField] && v < String(f[x.validation.gteField])) err[x.key] = x.validation.message;
      });
    }
    return err;
  };
  const submit = async () => {
    const err = validate();
    if (Object.keys(err).length) {
      setD((o) => ({ ...o, err }));
      return toast(`Fix ${Object.keys(err).length} field${Object.keys(err).length > 1 ? 's' : ''} to submit`, 'bad');
    }
    const fields: Record<string, string> = {};
    Object.entries(d.f).forEach(([k, v]) => { if (k !== 'mgrCc' && k !== 'related' && (k !== 'pri' || d.ai.used) && v !== undefined && v !== null && v !== '') fields[k] = String(v); });
    const form = new FormData();
    form.append('payload', JSON.stringify({ helpdesk: d.hd, fields, cc: d.cc, mgrCc: !!d.f.mgrCc, related: d.f.related || null, aiTranscript: d.ai.used && d.ai.tx ? d.ai.tx : null }));
    d.files.forEach((f) => form.append('files', f));
    try {
      const res = await act.run(() => api<{ key: string; toast: string }>('/tickets', { form }), { silent: true });
      stopAi();
      set({ drawer: null, hl: res.key, back: 'tickets', dash: { ...emptyFilters('mine') } });
      nav('/tickets');
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) {
        setD((o) => ({ ...o, err: e.fieldErrors }));
        toast(e.message, 'bad');
      } else toast(e instanceof Error ? e.message : 'The ticket could not be raised', 'bad');
    }
  };

  const cards = CARDS.filter(([k]) => me.helpdesks.includes(k));
  return (
    <>
      <div className="scrim" onClick={close} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="dr-title">
        <div className="dr-head">
          <h2 id="dr-title">{d.hd === 'SF' ? 'Raise a Salesforce case' : 'Raise a ticket'}</h2>
          {d.hd && <HdBadge hd={d.hd} />}
          {d.ai.hdAuto && <span className="aichip" style={{ paddingRight: 6 }}>AI chose this helpdesk</span>}
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={close} aria-label="Close"><Icon n="x" s={18} /></button>
        </div>
        <div className="steps">
          <span className={`st ${d.step === 1 ? 'on' : 'done'}`}><i>{d.step > 1 ? '✓' : '1'}</i>Choose helpdesk</span><span className="ln" />
          <span className={`st ${d.step === 2 ? 'on' : ''}`}><i>2</i>Details</span><span className="ln" />
          <span className="st"><i>3</i>Submit</span>
        </div>
        <div className="drawer-body">
          {d.step === 1 ? (
            <>
              {aiPanel}
              <p className="muted" style={{ margin: 0 }}>{aiOn ? 'Or choose the team you need help from:' : 'Choose the team you need help from:'}</p>
              <div className="hdpick">
                {cards.map(([k, i, t, x]) => (
                  <button key={k} className="hdcard" onClick={() => pickHd(k)}>
                    <span className="ico" style={{ background: `var(--${k.toLowerCase()}-soft)`, color: `var(--${k.toLowerCase()})` }}><Icon n={i} s={22} /></span>
                    <span><b>{t}</b><span>{x}</span></span>
                  </button>
                ))}
              </div>
              <div className="note info"><Icon n="help" s={15} /><p>Common questions are answered in <button className="linkbtn" onClick={() => { close(); nav('/faqs'); }}>FAQs</button>.</p></div>
            </>
          ) : (
            <>
              {aiPanel}
              <div id="redir">
                {redir && (
                  <div className="note redir"><Icon n="info" s={15} /><p>This looks like {redir === 'SF' ? 'a' : 'an'} <b>{HDL[redir]}</b> request. Switch helpdesk?</p>
                    <button className="btn sm" onClick={() => switchTo(redir)}>Switch to {HDL[redir]}</button>
                    <button className="linkbtn" onClick={() => setD((o) => ({ ...o, redirOff: true }))}>Keep {HDL[d.hd!]}</button>
                  </div>
                )}
              </div>
              {formFor(d.hd!)}
              {faqBox}
              {d.f.cat && !!related?.length && (
                <F d={d} onUndo={undo} id="related" label="Related ticket (optional)" hint="Link work that spans helpdesks, for example a new joiner who needs HR, IT and Admin Desk tickets.">
                  {dsel('related', related.map((t) => [t.key, `${t.key} · ${t.title.slice(0, 50)}`]), 'None')}
                </F>
              )}
            </>
          )}
        </div>
        <div className="dr-foot">
          {d.step === 2 && <button className="btn" onClick={back}><Icon n="back" s={15} />Change helpdesk</button>}
          <span className="r">
            <button className="btn" onClick={close}>Cancel</button>
            {d.step === 2 && <button className="btn primary" disabled={act.pending} onClick={submit}>Submit {d.hd === 'SF' ? 'case' : 'ticket'}</button>}
          </span>
        </div>
      </aside>
    </>
  );
}
