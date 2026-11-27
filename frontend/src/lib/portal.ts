/**
 * Portal mode (build with VITE_PORTAL_MODE=true): the Helpdesk runs at helpdesk.<domain> behind the NPST
 * portal gateway. People sign in on the portal; the bridge turns that session into a helpdesk token.
 */
const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const PORTAL_MODE = viteEnv.VITE_PORTAL_MODE === 'true';
/** `/api` standalone; `/api/helpdesk` behind the portal gateway. */
export const API_BASE = (viteEnv.VITE_API_BASE || '/api').replace(/\/$/, '');
export const PORTAL_URL = viteEnv.VITE_PORTAL_URL || 'http://portal.npst.localhost:8080/';

const REDIRECTED_AT = 'npstx.helpdesk.portalRedirectAt';

/**
 * The portal's sign-in, coming back here afterwards. Returns false instead of redirecting when we were
 * sent there moments ago: the portal says "signed in" but the Helpdesk still cannot use the session
 * (e.g. a wrong service secret), and redirecting again would loop.
 */
export function portalSignIn(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(REDIRECTED_AT) ?? 0);
    if (Date.now() - last < 30_000) return false;
    window.sessionStorage.setItem(REDIRECTED_AT, String(Date.now()));
  } catch {
    /* no storage: redirect anyway */
  }
  window.location.assign(`${PORTAL_URL}?returnUrl=${encodeURIComponent(window.location.href)}`);
  return true;
}

// ---- Idle timeout: only requests the person caused keep the portal session alive ----
const USER_ACTIVE_WINDOW_MS = 15_000;
let lastUserActivity = Date.now(); // opening the Helpdesk from the portal counts as activity
if (typeof window !== 'undefined') {
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
    window.addEventListener(type, () => (lastUserActivity = Date.now()), { capture: true, passive: true });
  }
}
/** True when nobody clicked, typed, scrolled or touched recently (polling): sent as X-Background-Request. */
export const isBackground = () => Date.now() - lastUserActivity > USER_ACTIVE_WINDOW_MS;

// ---- CSRF: the gateway wants X-CSRF-Token on POST/PUT/PATCH/DELETE ----
let csrf: Promise<string> | null = null;
/** The portal's CSRF token, from the portal identity route on this host (same origin). */
export function csrfToken(fresh = false): Promise<string> {
  if (!csrf || fresh) {
    csrf = fetch('/api/auth/csrf', { credentials: 'same-origin' })
      .then(async (r) => ((await r.json()) as { csrfToken?: string }).csrfToken ?? '')
      .catch(() => '');
    csrf.then((t) => !t && (csrf = null)); // do not keep a failure
  }
  return csrf;
}
export const forgetCsrf = () => (csrf = null);

/** Signs out of the portal (and so of every service), then goes to the portal sign-in. */
export async function portalSignOut(): Promise<void> {
  try {
    const token = await csrfToken(true);
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': token } });
  } finally {
    window.location.assign(PORTAL_URL);
  }
}
