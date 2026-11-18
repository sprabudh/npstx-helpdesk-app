import type { CategoryEntity, FormFieldEntity } from '../database/entities';

export type Helpdesk = 'HR' | 'LND' | 'IT' | 'ADM' | 'SF';
export const HD_ORDER: Helpdesk[] = ['HR', 'LND', 'IT', 'ADM', 'SF'];

export type Role =
  | 'EMP' | 'HR_AGENT' | 'LND_HEAD' | 'LND_COORD' | 'SF_ADMIN' | 'MANAGER' | 'HRLND_ADMIN' | 'HD_ADMIN'
  | 'IT_AGENT' | 'IT_HEAD' | 'ADM_AGENT' | 'ADM_HEAD' | 'AUDITOR';

/** The signed-in person. Roles and department are loaded from the database on every request. */
export interface Principal {
  id: string;
  name: string;
  dept: string | null;
  title: string | null;
  location: string | null;
  managerId: string | null;
  roles: Set<Role>;
  hrCats: Set<string>;
}

export interface PersonRef {
  id: string;
  name: string;
  dept: string | null;
  title: string | null;
  managerId: string | null;
  isQueue: boolean;
  roles: Role[];
  hrCats: string[];
}

export interface ApprovalStep {
  step: string; // mgr | lnd | ith | adm
  seq: number;
  status: string; // Pending | Approved | Rejected
  approverId: string | null;
  decidedById: string | null;
  decidedAt: Date | null;
}

export interface FollowerRef {
  userId: string;
  relation: 'FOLLOWER' | 'CC' | 'TAGGED' | 'CASE_TEAM' | string;
  addedById: string;
}

/** Everything the access policy needs to judge one ticket. */
export interface TicketCtx {
  key: string;
  helpdesk: Helpdesk;
  categoryKey: string;
  status: string;
  requesterId: string;
  assigneeId: string;
  confidential: boolean;
  closeResponse: string | null;
  closedAt: Date | null;
  followers: FollowerRef[];
  approvals: ApprovalStep[];
  category: Pick<CategoryEntity, 'leadId' | 'ownerId' | 'restricted' | 'reopenAllowed' | 'name'> | null;
  requesterManagerId: string | null;
}

export interface StatusModel {
  open: string[];
  closed: string[];
  tr: Record<string, string[]>;
  closing: string[];
  work: string;
  wait: string;
}

export type FieldDef = FormFieldEntity;
