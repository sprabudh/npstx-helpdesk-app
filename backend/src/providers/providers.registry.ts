import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { env } from '../common/env';
import { SfCaseEntity } from '../database/entities';
import { MockSalesforceAdapter } from './salesforce/salesforce.adapter';
import { RestSalesforceAdapter } from './salesforce/salesforce-rest.adapter';
import { SalesforceProvider } from './salesforce/salesforce.provider';
import { NativeProvider, TicketProvider } from './ticket-provider';

/** Picks the provider for a helpdesk. Configuration, not code, decides the Salesforce adapter. */
@Injectable()
export class ProvidersRegistry {
  private readonly map = new Map<string, TicketProvider>();
  constructor(@InjectDataSource() ds: DataSource) {
    for (const hd of ['HR', 'LND', 'IT', 'ADM']) this.map.set(hd, new NativeProvider(hd));
    const adapter = env.salesforce.adapter === 'rest' ? new RestSalesforceAdapter() : new MockSalesforceAdapter();
    this.map.set('SF', new SalesforceProvider(adapter, (em, key) => (em ?? ds.manager).getRepository(SfCaseEntity).findOne({ where: { ticketKey: key } })));
  }
  for(hd: string): TicketProvider {
    const p = this.map.get(hd);
    if (!p) throw new Error(`No provider for helpdesk ${hd}`);
    return p;
  }
  describe() {
    return [...this.map.values()].map((p) => ({ helpdesk: p.helpdesk, native: p.native, adapter: p.native ? 'native' : env.salesforce.adapter }));
  }
}
