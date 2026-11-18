import type { EntityManager } from 'typeorm';
import type { TicketEntity } from '../database/entities';

/**
 * A helpdesk's system of record. HR, L&D, IT and Admin Desk are native (NPSTX owns the data).
 * Salesforce mirrors Service Cloud Cases through an adapter. New platforms (for example OpenProject)
 * implement this interface and register in ProvidersRegistry (SDD 13).
 */
export interface TicketProvider {
  readonly helpdesk: string;
  readonly native: boolean;
  /** Called inside the create transaction after the ticket row is written. */
  onCreated(em: EntityManager, ticket: TicketEntity, actorName: string): Promise<void>;
  onStatusChanged(ticket: TicketEntity, from: string, to: string): Promise<void>;
  onComment(ticket: TicketEntity, body: string, internal: boolean): Promise<void>;
}

export class NativeProvider implements TicketProvider {
  readonly native = true;
  constructor(readonly helpdesk: string) {}
  async onCreated() {}
  async onStatusChanged() {}
  async onComment() {}
}
