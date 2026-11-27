import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, ApiError, getToken, readStored, setToken, setUnauthorizedHandler, writeStored } from './api/client';
import { useConfig } from './api/hooks';
import { TipLayer, Toasts } from './components/common/bits';
import RaiseDrawer from './components/drawer/RaiseDrawer';
import { ModalHost } from './components/modals/Modals';
import { Layout } from './components/shell/Shell';
import { setTimeZone } from './lib/format';
import { PORTAL_MODE, portalSignIn } from './lib/portal';
import AdminPage from './pages/AdminPage';
import DashboardPage from './pages/DashboardPage';
import { FaqPage, FollowingPage, HistoryPage } from './pages/ListPages';
import MyPerformancePage from './pages/MyPerformancePage';
import TicketDetailPage from './pages/TicketDetailPage';
import TicketsPage from './pages/TicketsPage';
import { useUi } from './store/ui';

const USER_KEY = 'npstx.helpdesk.user';
const readUser = () => readStored(USER_KEY);
const writeUser = (id: string) => writeStored(USER_KEY, id);

type Boot = { state: 'loading' } | { state: 'ready' } | { state: 'signin'; message: string };

/** Demo sign-in: the token carries only the user id; roles come from the database on every request. */
async function demoLogin(userId: string) {
  const r = await api<{ accessToken: string }>('/auth/demo-login', { body: { userId } });
  setToken(r.accessToken);
  writeUser(userId);
}

function Pages({ onPersona }: { onPersona: (id: string) => void }) {
  const loc = useLocation();
  const route = loc.pathname.split('/')[1] || 'dashboard';
  const set = useUi((s) => s.set);
  const drawer = useUi((s) => s.drawer);
  const { data: cfg } = useConfig();
  useEffect(() => {
    if (route !== 'ticket') set({ back: route });
  }, [route, set]);
  useEffect(() => {
    if (cfg) setTimeZone(cfg.displayTimeZone);
  }, [cfg]);
  return (
    <>
      <Layout from={route === 'ticket' ? useUi.getState().back : route} onPersona={onPersona}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/tickets" element={<TicketsPage mode="mine" />} />
          <Route path="/assigned" element={<TicketsPage mode="assigned" />} />
          <Route path="/following" element={<FollowingPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/faqs" element={<FaqPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/performance" element={<MyPerformancePage />} />
          <Route path="/ticket/:key" element={<TicketDetailPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Layout>
      {drawer && <RaiseDrawer key={JSON.stringify(drawer)} init={drawer} />}
      <ModalHost />
      <Toasts />
      <TipLayer />
    </>
  );
}

export default function App() {
  const qc = useQueryClient();
  const resetForPersona = useUi((s) => s.resetForPersona);
  const toast = useUi((s) => s.toast);
  const [boot, setBoot] = useState<Boot>({ state: 'loading' });

  /** Portal mode: the portal session becomes a helpdesk token (bridge); no session → portal sign-in. */
  const bridging = useRef<Promise<void> | null>(null);
  const startFromPortal = useCallback(() => {
    // Single flight: several polls may hit 401 at once (session ended or another person signed in).
    bridging.current ??= bridge().finally(() => (bridging.current = null));
    return bridging.current;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function bridge() {
    try {
      setToken(null);
      const r = await api<{ accessToken: string }>('/auth/platform-sso');
      setToken(r.accessToken);
      const me = await api<{ id: string }>('/me');
      resetForPersona(me.id);
      setBoot({ state: 'ready' });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        if (portalSignIn()) return;
        return setBoot({ state: 'signin', message: 'The portal signed you in, but the Helpdesk could not use that sign-in. Try again, or contact the Helpdesk admin.' });
      }
      // 403: account inactive or another organisation; 503: portal unreachable. No redirect (it would loop).
      setBoot({ state: 'signin', message: e instanceof Error ? e.message : 'The helpdesk service could not be reached.' });
    }
  }

  const start = useCallback(async () => {
    if (PORTAL_MODE) return startFromPortal();
    try {
      const params = new URLSearchParams(window.location.search);
      const wanted = params.get('as');
      const personas = await api<{ defaultUserId: string; groups: { people: { id: string }[] }[] }>('/auth/personas').catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      });
      if (!personas) {
        if (getToken()) {
          const me = await api<{ id: string }>('/me');
          resetForPersona(me.id);
          return setBoot({ state: 'ready' });
        }
        return setBoot({ state: 'signin', message: 'Demo sign-in is turned off on this server. Sign in through your company single sign-on to get an access token.' });
      }
      const remembered = readUser();
      const known = new Set(personas.groups.flatMap((g) => g.people.map((p) => p.id)));
      const uid = (wanted && known.has(wanted) && wanted) || (remembered && known.has(remembered) && remembered) || personas.defaultUserId;
      if (wanted || !getToken() || remembered !== uid) await demoLogin(uid);
      resetForPersona(uid);
      setBoot({ state: 'ready' });
    } catch (e) {
      setBoot({ state: 'signin', message: e instanceof Error ? e.message : 'The helpdesk service could not be reached.' });
    }
  }, [resetForPersona, startFromPortal]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setBoot({ state: 'loading' });
      start();
    });
    start();
  }, [start]);

  const onPersona = useCallback(
    async (id: string) => {
      try {
        await demoLogin(id);
        qc.clear();
        resetForPersona(id);
        toast('Switched role. Views, actions and data now follow this person.');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not switch role', 'bad');
      }
    },
    [qc, resetForPersona, toast],
  );

  if (boot.state === 'loading') return <div className="login" aria-busy="true"><div className="spin" /><span>Opening the helpdesk…</span></div>;
  if (boot.state === 'signin')
    return (
      <div className="login">
        <div className="brand-mark">N</div>
        <h1>NPSTX Helpdesk</h1>
        <p>{boot.message}</p>
        <button className="btn primary" onClick={() => { setBoot({ state: 'loading' }); start(); }}>Try again</button>
      </div>
    );
  return <Pages onPersona={onPersona} />;
}
