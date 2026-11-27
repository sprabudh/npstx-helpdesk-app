import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, setToken } from '../../api/client';
import { useAction, useConfig, useMe, useNotifications, usePersonas } from '../../api/hooks';
import type { ListItem } from '../../api/types';
import { cardStamp, HDL, notifyChannel } from '../../lib/format';
import { PORTAL_MODE, PORTAL_URL, portalSignOut } from '../../lib/portal';
import { Icon } from '../../lib/icons';
import { useUi } from '../../store/ui';
import { Avatar, HdBadge, Pill } from '../common/bits';

const NAV: [string, string][] = [['home', 'Home'], ['user', 'My profile'], ['clock', 'Attendance'], ['cal', 'Leave'], ['wallet', 'Payroll'], ['book', 'Learning'], ['target', 'Performance'], ['help', 'Helpdesk'], ['gear', 'Settings']];
const CRUMB: Record<string, string> = { dashboard: 'Dashboard', tickets: 'My tickets', assigned: 'Assigned to me', following: "Following / CC'd", history: 'History', faqs: 'FAQs', admin: 'Admin console', performance: 'My performance' };

const COLLAPSED_KEY = 'npstx.helpdesk.sidebarCollapsed';
const readCollapsed = () => {
  try { return window.localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
};
const roleLabel = (f: { helpdeskAdmin: boolean; headish: boolean; worker: boolean; auditor: boolean }) =>
  f.helpdeskAdmin ? 'Admin' : f.headish ? 'Head' : f.worker ? 'Agent' : f.auditor ? 'Auditor' : 'Employee';

export function Sidebar({ collapsed, onToggle, onNavigate }: { collapsed: boolean; onToggle: () => void; onNavigate: () => void }) {
  const { data: me } = useMe();
  const toast = useUi((s) => s.toast);
  return (
    <aside className="side" id="app-sidebar" aria-label="Main navigation">
      <div className="side-head">
        <span className="brand-mark"><Icon n="headset" s={18} /></span>
        <span className="brand-name">Helpdesk</span>
        <button type="button" className="side-btn side-collapse" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <Icon n={collapsed ? 'expand' : 'collapse'} s={18} />
        </button>
      </div>
      <nav className="nav">
        {PORTAL_MODE && (
          <a href={PORTAL_URL} title="Back to the portal" className="portal-link">
            <Icon n="portal" s={20} /><span>Portal</span>
          </a>
        )}
        <div className="nav-label">Workspace</div>
        {(PORTAL_MODE ? NAV.filter(([, l]) => l === 'Helpdesk') : NAV).map(([i, l]) =>
          l === 'Helpdesk' ? (
            <Link key={l} to="/dashboard" className="on" title={l} onClick={onNavigate}>
              <Icon n={i} s={20} /><span>{l}</span>
              {!!me?.counts.waiting && <em className="nb">{me.counts.waiting}</em>}
            </Link>
          ) : (
            <a key={l} href="#" className="nav-other" title={l} onClick={(e) => { e.preventDefault(); toast(`${l} is another NPSTX module. This app covers Helpdesk only.`); }}>
              <Icon n={i} s={20} /><span>{l}</span>
            </a>
          ),
        )}
      </nav>
      <div className="side-foot">
        {me && (
          <div className="side-user" title={`${me.name} · ${roleLabel(me.flags)}`}>
            <Avatar name={me.name} />
            <span className="side-user-t"><b>{me.name}</b><small>{roleLabel(me.flags)}</small></span>
          </div>
        )}
        {PORTAL_MODE && (
          <button type="button" className="side-btn side-signout" onClick={() => void portalSignOut()} title="Sign out" aria-label="Sign out">
            <Icon n="logout" s={18} />
          </button>
        )}
      </div>
    </aside>
  );
}

function NotifPanel({ onClose }: { onClose: () => void }) {
  const { data } = useNotifications(true);
  const act = useAction();
  const nav = useNavigate();
  return (
    <div className="notif">
      <header>Notifications<button className="linkbtn" onClick={() => act.run(() => api('/notifications/read-all', { method: 'POST' }))}>Mark all read</button></header>
      <div className="list">
        {data?.length ? data.map((n) => (
          <button key={n.id} className={`it ${n.readAt ? '' : 'unread'}`} onClick={async () => { await act.run(() => api(`/notifications/${n.id}/read`, { method: 'POST' })); onClose(); if (n.ticketKey) nav(`/ticket/${n.ticketKey}`); }}>
            <Icon n="bell" s={15} />
            <span>{n.text}<time>{cardStamp(n.createdAt)} · {notifyChannel(n.channel)}</time></span>
          </button>
        )) : <div className="gempty">No notifications yet.</div>}
      </div>
    </div>
  );
}

export function Topbar({ onPersona, onMenu }: { onPersona: (id: string) => void; onMenu: () => void }) {
  const { data: me } = useMe();
  const loc = useLocation();
  const route = loc.pathname.split('/')[1] || 'dashboard';
  const { notifOpen, set } = useUi();
  const userId = useUi((s) => s.userId);
  const { data: personas } = usePersonas();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => notifOpen && ref.current && !ref.current.contains(e.target as Node) && set({ notifOpen: false });
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [notifOpen, set]);
  const key = route === 'ticket' ? decodeURIComponent(loc.pathname.split('/')[2] ?? '') : '';
  return (
    <header className="top">
      <button type="button" className="icon-btn menu-btn" onClick={onMenu} aria-label="Open navigation" aria-controls="app-sidebar"><Icon n="menu" s={20} /></button>
      <div className="crumb">Helpdesk &nbsp;›&nbsp; <b>{route === 'ticket' ? key : CRUMB[route] ?? 'Dashboard'}</b></div>
      <div className="top-right">
        {personas && (
          <div className="persona">
            <label htmlFor="persona">Demo role</label>
            <select className="in" id="persona" value={userId ?? ''} onChange={(e) => onPersona(e.target.value)}>
              {personas.groups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.people.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.title}{p.onLeave ? ' · on leave today' : ''}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        )}
        <div style={{ position: 'relative' }} ref={ref}>
          <button className="icon-btn" aria-label="Notifications" onClick={() => set({ notifOpen: !notifOpen })}>
            <Icon n="bell" s={18} />
            {!!me?.counts.notifications && <span className="dot">{me.counts.notifications > 99 ? '99+' : me.counts.notifications}</span>}
          </button>
          {notifOpen && <NotifPanel onClose={() => set({ notifOpen: false })} />}
        </div>
        {me && <span title={me.name}><Avatar name={me.name} /></span>}
      </div>
    </header>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const { data } = useQuery({ queryKey: ['gsearch', useUi.getState().userId, q], queryFn: () => api<ListItem[]>(`/tickets/search?q=${encodeURIComponent(q.trim())}`), enabled: q.trim().length > 0 });
  return (
    <div className="gsearch">
      <Icon n="search" s={15} />
      <input id="gsearch" type="search" placeholder="Check status: ticket ID or title" value={q} autoComplete="off" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} />
      {q.trim() && (
        <div className="gresults">
          {data?.length ? data.map((t) => (
            <button key={t.key} onClick={() => { setQ(''); nav(`/ticket/${t.key}`); }}>
              <span className="mono">{t.key}</span><HdBadge hd={t.helpdesk} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span><Pill t={t} />
            </button>
          )) : <div className="gempty">No ticket you have access to matches “{q}”. Confidential and other helpdesks' tickets are never listed.</div>}
        </div>
      )}
    </div>
  );
}

export function ModuleHeader({ from }: { from: string }) {
  const { data: me } = useMe();
  const nav = useNavigate();
  const set = useUi((s) => s.set);
  if (!me) return null;
  const hl = me.helpdesks.map((h) => HDL[h]);
  const tabs: [string, string, number?, string?][] = [
    ['dashboard', 'Dashboard', 0, 'chart'], ['tickets', 'My tickets'], ...(me.flags.worker ? [['assigned', 'Assigned to me', me.counts.assignedOpen] as [string, string, number]] : []),
    ['following', "Following / CC'd", me.counts.followCount], ['history', 'History'], ['faqs', 'FAQs'],
    ...(me.flags.worker ? [['performance', 'My performance', 0, 'target'] as [string, string, number, string]] : []), ...(me.flags.helpdeskAdmin ? [['admin', 'Admin console', 0, 'gear'] as [string, string, number, string]] : []),
  ];
  return (
    <div className="mh">
      <div className="mh-top">
        <div>
          <h1>Helpdesk</h1>
          <p>{hl.slice(0, -1).join(', ')} and {hl[hl.length - 1]} support in one place</p>
        </div>
        <div className="mh-actions">
          {from !== 'dashboard' && <GlobalSearch />}
          {me.flags.helpdeskAdmin && from !== 'admin' && <button className="btn" onClick={() => nav('/admin')}><Icon n="gear" s={16} />Configure</button>}
          {from !== 'dashboard' && <button className="btn primary" onClick={() => set({ drawer: {} })}><Icon n="plus" s={16} />Raise ticket</button>}
        </div>
      </div>
      <nav className="subnav" aria-label="Helpdesk pages">
        {tabs.map(([k, l, c, i]) => (
          <button key={k} className={from === k ? 'on' : ''} onClick={() => nav(`/${k}`)}>
            {i && <Icon n={i} s={15} />}{l}{!!c && <span className="count">{c}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}

export function RoleStrip() {
  const { data: me } = useMe();
  const { data: cfg } = useConfig();
  const { permOpen, set, toast } = useUi();
  const qc = useQueryClient();
  const nav = useNavigate();
  const act = useAction();
  if (!me || !cfg) return null;
  const hrNames = Object.fromEntries(cfg.categories.filter((c) => c.helpdesk === 'HR').map((c) => [c.key, c.name.split(' ')[0]]));
  return (
    <>
      <div className="rolestrip">
        <span className="lbl">Signed in as</span><b>{me.name}</b><span>{me.title} · {me.dept}</span>
        {me.roles.map((r) => <span key={r} className="chip">{cfg.roleLabels[r]}{r === 'HR_AGENT' && ` (${me.hrCategories.map((k) => hrNames[k]).join(', ')})`}</span>)}
        <span className="lbl" style={{ marginLeft: 6 }}>Helpdesks</span>{me.helpdesks.map((h) => <HdBadge key={h} hd={h} />)}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="linkbtn" onClick={() => set({ permOpen: !permOpen })}>{permOpen ? 'Hide' : 'What can this role do?'}</button>
          {cfg.demoMode && (
            <>
              <span className="lbl">Demo states</span>
              <button className="linkbtn" onClick={() => { set({ demo: 'loading' }); nav('/tickets'); setTimeout(() => set({ demo: null }), 1600); toast('Showing the loading state'); }}>Loading</button>
              <button className="linkbtn" onClick={() => { set({ demo: 'error' }); nav('/tickets'); toast('Showing the error state. Select Retry to recover.'); }}>Error</button>
              <button className="linkbtn" onClick={() => set({ modal: { type: 'ooo' } })}>Out of office (demo)</button>
              <button className="linkbtn" onClick={async () => {
                if (!window.confirm('Reset demo data? This deletes all tickets, logs and changes made since the sample data was loaded.')) return;
                await act.run(() => api('/demo/reset', { method: 'POST' }));
                qc.clear();
                nav('/dashboard');
              }}>Reset demo data</button>
            </>
          )}
        </span>
      </div>
      {permOpen && (
        <div className="perm">
          <div className="yes"><h4>Can</h4><ul>{me.permissions.can.map((x) => <li key={x}>{x}</li>)}</ul></div>
          <div className="no"><h4>Cannot</h4><ul>{me.permissions.no.map((x) => <li key={x}>{x}</li>)}</ul></div>
        </div>
      )}
    </>
  );
}

export function Layout({ from, children, onPersona }: { from: string; children: ReactNode; onPersona: (id: string) => void }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [navOpen, setNavOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setNavOpen(false), [loc.pathname]);
  const toggle = () => setCollapsed((c) => {
    try { window.localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1'); } catch { /* storage unavailable: keep it for this page only */ }
    return !c;
  });
  return (
    <div className={`app${collapsed ? ' collapsed' : ''}${navOpen ? ' nav-open' : ''}`}>
      <Sidebar collapsed={collapsed} onToggle={toggle} onNavigate={() => setNavOpen(false)} />
      {navOpen && <div className="side-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />}
      <div className="main">
        <Topbar onPersona={onPersona} onMenu={() => setNavOpen(true)} />
        <main className="module">
          <ModuleHeader from={from} />
          <RoleStrip />
          <div className="page">{children}</div>
        </main>
        <footer className="app-foot">
          <span>NPSTX HR platform · Helpdesk module v0.3 (mock)</span>
          <span className="app-foot-r">© {new Date().getFullYear()} NPSTX · All rights reserved</span>
        </footer>
      </div>
    </div>
  );
}
export { setToken };
