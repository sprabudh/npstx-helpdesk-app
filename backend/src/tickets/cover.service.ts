import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AbsenceEntity, AttendanceEntity, CategoryEntity } from '../database/entities';
import { isUnavailable } from '../domain/availability';
import { canWork, hdAllowed } from '../domain/policy';
import { Helpdesk, PersonRef, Principal, TicketCtx } from '../domain/types';
import { HelpdeskConfigService } from '../helpdesk-config/config.service';

export interface CoverResult {
  asg: string;
  /** Ladder levels at or below the cover; escalation continues from the level above them. */
  ladderBase: number;
  coverFor: string | null;
  unattended: boolean;
  /** Neutral timeline text, or null when the ticket stays where it was routed. */
  event: string | null;
}

/**
 * Absence-based reassignment. Runs when a ticket becomes workable (at raise, or at the last approval).
 * Only person targets are checked; queues never change. The cover is the next available ladder entry
 * who could already work the ticket under the existing rules. This is never an escalation.
 */
@Injectable()
export class CoverService {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly cfg: HelpdeskConfigService) {}

  async awayFn(at: Date): Promise<(id: string) => boolean> {
    const [absences, attendance] = await Promise.all([this.ds.getRepository(AbsenceEntity).find(), this.ds.getRepository(AttendanceEntity).find()]);
    return (id: string) => isUnavailable(absences, attendance, id, at);
  }

  private principal(p: PersonRef): Principal {
    return { id: p.id, name: p.name, dept: p.dept, title: p.title, location: null, managerId: p.managerId, roles: new Set(p.roles), hrCats: new Set(p.hrCats) };
  }
  private ctx(hd: Helpdesk, c: CategoryEntity, assigneeId: string): TicketCtx {
    return {
      key: '', helpdesk: hd, categoryKey: c.key, status: 'New', requesterId: '', assigneeId, confidential: hd !== 'SF' && c.confidential,
      closeResponse: null, closedAt: null, followers: [], approvals: [],
      category: { leadId: c.leadId, ownerId: c.ownerId, restricted: c.restricted, reopenAllowed: c.reopenAllowed, name: c.name }, requesterManagerId: null,
    };
  }
  /**
   * Could this person work the ticket if it were handed to them? They must already work the helpdesk.
   * Restricted categories (grievance, IT security) additionally require the cover to qualify without the
   * assignment, so cover never widens access to those. Confidential categories (e.g. HR payroll) do
   * reassign to the next ladder person by decision, so they are not gated on the confidential flag.
   */
  eligible(p: PersonRef, hd: Helpdesk, c: CategoryEntity, absentId: string): boolean {
    if (p.isQueue || !hdAllowed(p, hd)) return false;
    const u = this.principal(p);
    if (!canWork(u, this.ctx(hd, c, p.id))) return false;
    return !c.restricted || canWork(u, this.ctx(hd, c, absentId));
  }

  async cover(hd: Helpdesk, c: CategoryEntity, current: string, at: Date, slaVer?: number | null): Promise<CoverResult> {
    const keep: CoverResult = { asg: current, ladderBase: 0, coverFor: null, unattended: false, event: null };
    const p0 = this.cfg.person(current);
    if (!p0 || p0.isQueue) return keep;
    const away = await this.awayFn(at);
    if (!away(current)) return keep;
    if (hd === 'SF') {
      const sr = this.cfg.ladder('SF', c.key)[0]?.who;
      const who = sr ? this.cfg.queueMembers(sr).map((id) => this.cfg.person(id)).find((p) => p && !away(p.id) && this.eligible(p, hd, c, current)) : undefined;
      if (who) return { asg: who.id, ladderBase: 0, coverFor: current, unattended: false, event: `Assignment rule: owner unavailable → ${this.cfg.name(sr)} (${who.name})` };
    } else {
      const ladder = this.cfg.ladder(hd, c.key, slaVer);
      for (let i = ladder.findIndex((l) => l.who === current) + 1; i < ladder.length; i++) {
        const p = this.cfg.person(ladder[i].who);
        if (!p || p.id === current || away(p.id) || !this.eligible(p, hd, c, current)) continue;
        return { asg: p.id, ladderBase: i + 1, coverFor: current, unattended: false, event: `Reassigned to ${p.name} (assignee unavailable)` };
      }
    }
    return { ...keep, unattended: true, event: 'No cover available, kept with the category lead' };
  }

  hdAdmins(): string[] {
    return this.cfg.peopleList().filter((p) => !p.isQueue && p.roles.includes('HD_ADMIN')).map((p) => p.id);
  }
}
