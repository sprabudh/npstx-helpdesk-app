import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ListItem, Part, PersonRef } from '../../api/types';
import { fdt, HDL, ini } from '../../lib/format';
import { Icon } from '../../lib/icons';
import { useUi } from '../../store/ui';

export const HdBadge = ({ hd }: { hd: string }) => <span className={`hd hd-${hd}`}>{HDL[hd]}</span>;
export const PriFlag = ({ p }: { p: string }) => (
  <span className={`pri pri-${p}`}>
    <Icon n="flag" s={13} />
    {p}
  </span>
);
export const Pill = ({ t }: { t: Pick<ListItem, 'pill'> }) => <span className={`pill ${t.pill.cls}`}>{t.pill.label}</span>;
export const SlaCell = ({ t }: { t: Pick<ListItem, 'sla'> }) => (
  <span className={`sla ${t.sla.cls}`}>
    <span>{fdt(t.sla.due)}</span>
    <small>{t.sla.txt}</small>
  </span>
);
export const Avatar = ({ name, queue, sm }: { name: string; queue?: boolean; sm?: boolean }) => <span className={`avatar${sm ? ' sm' : ''}`}>{ini(name, queue)}</span>;
export const Who = ({ p }: { p: PersonRef | null | undefined }) =>
  p ? (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
      <Avatar name={p.name} queue={p.isQueue} sm />
      {p.name}
    </span>
  ) : (
    <>—</>
  );
export const Lock = ({ label }: { label?: string }) => (
  <span className="lock" title="Confidential">
    <Icon n="lock" s={12} />
    {label}
  </span>
);
export const EscBadge = ({ lvl, label }: { lvl: number; label?: string }) => (
  <span className="escb">
    <Icon n="up" s={11} />
    {label ?? `L${lvl}`}
  </span>
);
export const Addition = ({ title = 'Addition beyond the v2 mock' }: { title?: string }) => <span className="addition" title={title}>New</span>;

/** FAQ markup: **bold** and [to confirm] markers. */
export function Md({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[(.+?)\]/g;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > i) out.push(text.slice(i, m.index));
    out.push(m[1] ? <b key={m.index}>{m[1]}</b> : <mark key={m.index} className="tc">TC: {m[2]}</mark>);
    i = m.index + m[0].length;
  }
  out.push(text.slice(i));
  return <>{out}</>;
}
/** AI answer parts from the server, rendered without HTML injection. */
export function Parts({ parts }: { parts: Part[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.t === 'br' ? <br key={i} /> : p.t === 'b' ? <b key={i}>{p.v}</b> : p.t === 'tc' ? <mark key={i} className="tc">{p.v}</mark> : p.t === 'ticket' ? <Link key={i} className="linkbtn" to={`/ticket/${p.v}`}>{p.v}</Link> : <span key={i}>{p.v}</span>,
      )}
    </>
  );
}
/** Highlights @mentions in feed text. */
export function MentionText({ text }: { text: string }) {
  const segs = text.split(/(@[A-Z][a-z]+ [A-Z][a-z]+)/g);
  return <>{segs.map((s, i) => (s.startsWith('@') ? <span key={i} className="mention">{s}</span> : s))}</>;
}
export const Empty = ({ icon = 'help', title, children }: { icon?: string; title: string; children?: ReactNode }) => (
  <div className="empty">
    <Icon n={icon} s={32} />
    <b>{title}</b>
    {children}
  </div>
);
export const Skeleton = () => (
  <div className="panel" aria-busy="true">
    <div className="skel">
      {[92, 78, 85, 66, 88, 72].map((w) => <i key={w} style={{ width: `${w}%` }} />)}
      <span className="sr">Loading tickets…</span>
    </div>
  </div>
);
export const ErrorState = ({ message, onRetry }: { message?: string; onRetry: () => void }) => (
  <div className="panel empty">
    <Icon n="info" s={32} />
    <b>Tickets could not be loaded.</b>
    <span>{message ?? 'The helpdesk service did not respond (HTTP 503). Nothing was lost. Try again in a moment.'}</span>
    <button className="btn primary" onClick={onRetry}>
      <Icon n="refresh" s={15} />
      Retry
    </button>
  </div>
);
export function Denied({ code, title, text, back = '/tickets', backLabel = 'Back to My tickets' }: { code: string; title: string; text?: string; back?: string; backLabel?: string }) {
  return (
    <div className="denied">
      <div className="code">{code}</div>
      <b>{title}</b>
      {text && <p className="muted">{text}</p>}
      <Link className="btn" to={back}>{backLabel}</Link>
    </div>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toasts" id="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind ?? ''}`}>
          <Icon n={t.kind === 'ok' ? 'check' : 'info'} s={16} />
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}
/** Hover tooltip for elements with data-tip (cards, chart bars). */
export function TipLayer() {
  useEffect(() => {
    const tip = document.getElementById('tip');
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest?.('[data-tip]') as HTMLElement | null;
      if (!tip) return;
      if (!el) return void (tip.hidden = true);
      tip.textContent = el.dataset.tip ?? '';
      tip.hidden = false;
    };
    const move = (e: MouseEvent) => {
      if (tip && !tip.hidden) {
        tip.style.left = Math.max(8, Math.min(e.clientX + 14, innerWidth - 290)) + 'px';
        tip.style.top = e.clientY + 16 + 'px';
      }
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('mousemove', move);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mousemove', move);
    };
  }, []);
  return <div id="tip" hidden />;
}

/** Modal frame: scrim, dialog, header, body, footer. Escape closes. */
export function Dialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="m-title">
        <header>
          <h2 id="m-title">{title}</h2>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            <Icon n="x" s={18} />
          </button>
        </header>
        <div className="body">{children}</div>
        <footer>{footer}</footer>
      </div>
    </>
  );
}
/** Form field wrapper used by modals and the raise drawer. */
export function Fld({ id, label, req, hint, err, review, chip, children }: { id: string; label: ReactNode; req?: boolean; hint?: ReactNode; err?: string; review?: boolean; chip?: ReactNode; children: ReactNode }) {
  return (
    <div className={`fld ${err ? 'bad' : ''} ${review && !err ? 'review' : ''}`}>
      <div className="fl">
        <label htmlFor={id}>
          {label}
          {req && <> <span className="req">*</span></>}
        </label>
        {chip}
      </div>
      {children}
      {hint && <span className="hint">{hint}</span>}
      {review && !err && <span className="hint rv">AI was not sure about this. Please check it.</span>}
      {err && <span className="err">{err}</span>}
    </div>
  );
}
