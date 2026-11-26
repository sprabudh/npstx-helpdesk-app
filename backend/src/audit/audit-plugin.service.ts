import { Injectable, Logger } from '@nestjs/common';
import { env } from '../common/env';

export type AuditPluginStatus = 'SUCCESS' | 'FAILURE';
export type AuditPluginSeverity = 'INFO' | 'WARNING' | 'AUDIT' | 'CRITICAL';

export interface AuditPluginEvent {
  eventId: string;
  action: string;
  actorId: string;
  targetId?: string | null;
  targetType?: string | null;
  status: AuditPluginStatus;
  severity: AuditPluginSeverity;
  summary: string;
  detail?: Record<string, any> | null;
  helpdeskAuditId?: number | null;
  timestamp: string;
}

@Injectable()
export class AuditPluginService {
  private readonly logger = new Logger(AuditPluginService.name);

  async record(event: AuditPluginEvent): Promise<void> {
    if (!env.auditPlugin.enabled) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.auditPlugin.timeoutMs);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (env.auditPlugin.apiKey) headers['X-Api-Key'] = env.auditPlugin.apiKey;
      const url = `${env.auditPlugin.url.replace(/\/+$/, '')}/api/v1/events`;
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          event_id: event.eventId,
          service: env.auditPlugin.serviceName,
          action: event.action,
          actor: { id: event.actorId, type: 'user' },
          target: event.targetId ? { id: event.targetId, type: event.targetType ?? undefined } : null,
          status: event.status,
          severity: event.severity,
          metadata: {
            ...(event.detail ?? {}),
            summary: event.summary,
            helpdeskAuditId: event.helpdeskAuditId ?? null,
          },
          timestamp: event.timestamp,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    } catch (err) {
      this.logger.warn(`Audit plugin delivery failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
