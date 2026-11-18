import * as path from 'path';
import type { Principal, Role, TicketCtx } from '../domain/types';

/** Personas and helpers built from the same seed files the app loads (db/seed). */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const seed = require(path.resolve(__dirname, '../../../db/seed/seed-data.json'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const hdConfig = require(path.resolve(__dirname, '../../../db/seed/helpdesk-config.json'));

export const people: { id: string; name: string; dept: string | null; title: string | null; location: string | null; managerId: string | null; isQueue: boolean; roles: Role[]; hrCategories: string[] }[] = seed.users;

export function principal(id: string, override: Partial<Principal> = {}): Principal {
  const p = people.find((x) => x.id === id);
  if (!p) throw new Error(`No persona ${id}`);
  return { id: p.id, name: p.name, dept: p.dept, title: p.title, location: p.location, managerId: p.managerId, roles: new Set(p.roles), hrCats: new Set(p.hrCategories), ...override };
}

export function ticket(o: Partial<TicketCtx> = {}): TicketCtx {
  return {
    key: 'IT-000999', helpdesk: 'IT', categoryKey: 'HW', status: 'In Progress', requesterId: 'u12', assigneeId: 'u21', confidential: false,
    closeResponse: null, closedAt: null, followers: [], approvals: [], category: { leadId: 'u22', ownerId: null, restricted: false, reopenAllowed: true, name: 'Hardware and IT asset' },
    requesterManagerId: 'u6', ...o,
  };
}
