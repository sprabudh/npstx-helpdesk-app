/** What the Salesforce provider needs from Salesforce. Mock locally, REST in production. */
export interface SalesforceAdapter {
  readonly name: 'mock' | 'rest';
  createCase(input: { subject: string; description: string; type: string; reason: string; priority: string; origin: string; requesterEmail: string | null }): Promise<{ externalId: string | null }>;
  updateStatus(externalId: string | null, status: string): Promise<void>;
  addComment(externalId: string | null, body: string, isPublished: boolean): Promise<void>;
}

/** Local adapter: Salesforce is simulated, case numbers come from the NPSTX sequence. Nothing leaves the machine. */
export class MockSalesforceAdapter implements SalesforceAdapter {
  readonly name = 'mock' as const;
  async createCase() {
    return { externalId: null };
  }
  async updateStatus() {}
  async addComment() {}
}
