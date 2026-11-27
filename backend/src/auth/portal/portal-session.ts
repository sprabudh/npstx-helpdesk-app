import { createHash } from 'crypto';
import { env } from '../../common/env';

/** Value of one cookie from a raw Cookie header (no cookie-parser in this app). */
export function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      const raw = part.slice(i + 1).trim();
      try {
        return decodeURIComponent(raw) || null;
      } catch {
        return raw || null;
      }
    }
  }
  return null;
}

/** The portal session id sent with this request (`session_id` cookie on the shared parent domain). */
export const portalSessionId = (req: { headers: Record<string, any> }): string | null =>
  cookieValue(req.headers?.cookie, env.portal.sessionCookie);

/**
 * Binds a helpdesk token to the portal session it was issued for (claim `psh`). After a portal sign-out
 * and someone else's sign-in in the same browser, the old token no longer matches and is refused.
 */
export const sessionHash = (sessionId: string): string => createHash('sha256').update(sessionId).digest('hex');
