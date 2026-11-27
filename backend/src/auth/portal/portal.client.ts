import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { env } from '../../common/env';
import { AppError } from '../../common/errors';

export interface PortalSession {
  userId: string;
  tenantId: string;
}
export interface PortalUser {
  id: string;
  name: string;
  email: string;
}

/**
 * Server-to-server calls to the NPST portal (iam-api) on the Docker network, authenticated with this
 * application's service secret. A portal that cannot be reached or answers unexpectedly is a 503:
 * nobody is ever signed in on a guess. The secret and session ids are never logged.
 */
@Injectable()
export class PortalClient implements OnApplicationBootstrap {
  private readonly log = new Logger('Portal');

  /** Portal mode: says at start-up whether the service secret works (a wrong one looks like "signed out"). */
  onApplicationBootstrap() {
    if (env.authMode !== 'portal') return;
    void (async () => {
      for (let attempt = 0; attempt < 12; attempt++) {
        try {
          const { status, body } = await this.call<{ applicationKey: string | null }>('/internal/service-credentials/whoami');
          if (status === 200) return this.log.log(`Signed in to the portal as application "${body?.applicationKey ?? '?'}"`);
          if (status === 401 || status === 403) return this.log.error('The portal refused PLATFORM_SERVICE_SECRET: nobody can sign in. Check helpdesk-portal.env.');
        } catch {
          /* portal still starting */
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
      this.log.warn('The portal could not be reached at start-up; sign-in will retry on each request.');
    })();
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T | null }> {
    let res: Response;
    try {
      res = await fetch(`${env.portal.iamUrl}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${env.portal.serviceSecret}`, Accept: 'application/json', ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(env.portal.timeoutMs),
      });
    } catch {
      throw unavailable();
    }
    const text = await res.text();
    let body: T | null = null;
    try {
      body = text ? (JSON.parse(text) as T) : null;
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }

  /** The portal session behind a `session_id` cookie value, or null when it is not (or no longer) valid. */
  async introspect(sessionId: string): Promise<PortalSession | null> {
    const { status, body } = await this.call<PortalSession>('/internal/session/introspect', { headers: { 'X-Session-Id': sessionId } });
    if (status === 401) return null;
    if (status !== 200 || !body?.userId || !body.tenantId) throw unavailable();
    return { userId: body.userId, tenantId: body.tenantId };
  }

  async user(tenantId: string, userId: string): Promise<PortalUser | null> {
    const { status, body } = await this.call<PortalUser[]>('/internal/users/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, userIds: [userId] }),
    });
    if (status !== 200 && status !== 201) throw unavailable();
    return (Array.isArray(body) && body.find((u) => u.id === userId)) || null;
  }
}

const unavailable = () => new AppError(503, 'PORTAL_UNAVAILABLE', 'The portal could not be reached. Try again in a moment.');
