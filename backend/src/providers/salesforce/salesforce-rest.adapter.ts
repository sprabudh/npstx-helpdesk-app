import { Logger } from '@nestjs/common';
import { env } from '../../common/env';
import { SalesforceAdapter } from './salesforce.adapter';

/**
 * Salesforce REST adapter (SALESFORCE_ADAPTER=rest). OAuth 2.0 client-credentials flow against the
 * org's connected app, then the standard Case sObject. Unverified in this build: needs a Salesforce org.
 */
export class RestSalesforceAdapter implements SalesforceAdapter {
  readonly name = 'rest' as const;
  private readonly log = new Logger('SalesforceRest');
  private token: { value: string; exp: number } | null = null;

  private async auth(): Promise<string> {
    if (this.token && this.token.exp > Date.now()) return this.token.value;
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: env.salesforce.clientId, client_secret: env.salesforce.clientSecret });
    const res = await fetch(`${env.salesforce.instanceUrl}/services/oauth2/token`, { method: 'POST', body });
    if (!res.ok) throw new Error(`Salesforce auth failed: HTTP ${res.status}`);
    const j = (await res.json()) as { access_token: string };
    this.token = { value: j.access_token, exp: Date.now() + 50 * 60 * 1000 };
    return j.access_token;
  }
  private async call(method: string, path: string, body?: unknown) {
    const res = await fetch(`${env.salesforce.instanceUrl}/services/data/${env.salesforce.apiVersion}${path}`, {
      method, headers: { Authorization: `Bearer ${await this.auth()}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Salesforce ${method} ${path.split('/')[2]} failed: HTTP ${res.status}`);
    return res.status === 204 ? null : res.json();
  }
  async createCase(i: { subject: string; description: string; type: string; reason: string; priority: string; origin: string; requesterEmail: string | null }) {
    const r = (await this.call('POST', '/sobjects/Case', {
      Subject: i.subject, Description: i.description, Type: i.type, Reason: i.reason, Priority: i.priority, Origin: i.origin, SuppliedEmail: i.requesterEmail,
    })) as { id: string };
    this.log.log('case created');
    return { externalId: r.id };
  }
  async updateStatus(id: string | null, status: string) {
    if (id) await this.call('PATCH', `/sobjects/Case/${id}`, { Status: status });
  }
  async addComment(id: string | null, body: string, isPublished: boolean) {
    if (id) await this.call('POST', '/sobjects/CaseComment', { ParentId: id, CommentBody: body, IsPublished: isPublished });
  }
}
