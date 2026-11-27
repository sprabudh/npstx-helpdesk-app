import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { env } from '../../common/env';
import { AppError } from '../../common/errors';
import { UserEntity, UserRoleEntity } from '../../database/entities';
import { HelpdeskConfigService } from '../../helpdesk-config/config.service';
import { AuditService } from '../../audit/audit.service';
import { AuthService } from '../auth.service';
import { PortalClient, PortalUser } from './portal.client';
import { sessionHash } from './portal-session';

/** Role of a person created on their first visit: they can raise and follow their own tickets. */
export const PORTAL_DEFAULT_ROLE = 'EMP';

/**
 * The bridge (AUTH_MODE=portal): a portal session becomes a helpdesk token.
 * The person is found by their portal id, else linked by email, else created as a requester.
 * Helpdesk roles (agent, head, admin…) are never taken from the portal; they stay in this database.
 */
@Injectable()
export class PortalSsoService {
  private readonly log = new Logger('PortalSso');

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly portal: PortalClient,
    private readonly auth: AuthService,
    private readonly cfg: HelpdeskConfigService,
    private readonly audit: AuditService,
  ) {}

  async signIn(sessionId: string | null): Promise<{ accessToken: string; expiresIn: number }> {
    if (!sessionId) throw signInFirst();
    const session = await this.portal.introspect(sessionId);
    if (!session) throw signInFirst();
    if (env.portal.tenantId && session.tenantId !== env.portal.tenantId) {
      throw new AppError(403, 'PORTAL_TENANT_NOT_ALLOWED', 'Your organisation does not use this Helpdesk.');
    }
    const person = await this.portal.user(session.tenantId, session.userId);
    if (!person?.email) throw new AppError(403, 'PORTAL_USER_UNKNOWN', 'Your portal account has no email address.');

    const userId = await this.resolve(person);
    const principal = await this.auth.loadPrincipal(userId);
    if (!principal) throw new AppError(403, 'ACCOUNT_INACTIVE', 'Your Helpdesk account is not active. Contact the Helpdesk admin.');
    return this.auth.issueToken(userId, { psh: sessionHash(sessionId) });
  }

  /** The helpdesk user id for a portal user: linked, linked now by email, or created. */
  private async resolve(person: PortalUser): Promise<string> {
    const users = this.ds.getRepository(UserEntity);
    const linked = await users.findOne({ where: { portalUserId: person.id } });
    if (linked) return linked.id;

    const byEmail = await this.auth.userIdByEmail(person.email);
    if (byEmail) {
      await users.update({ id: byEmail }, { portalUserId: person.id });
      await this.audit.record(byEmail, 'auth.portal_link', `${person.name} linked to the portal`);
      return byEmail;
    }
    return this.create(person);
  }

  private async create(person: PortalUser): Promise<string> {
    // Deterministic and within the 32-character id column: "p" + 31 hex digits of the portal uuid.
    const id = `p${person.id.replace(/-/g, '').toLowerCase().slice(0, 31)}`;
    try {
      await this.ds.transaction(async (m) => {
        await m.getRepository(UserEntity).insert({
          id, name: person.name || person.email, email: person.email.toLowerCase(), dept: null, title: null, location: null,
          managerId: null, isQueue: false, active: true, portalUserId: person.id,
        });
        await m.getRepository(UserRoleEntity).insert({ userId: id, role: PORTAL_DEFAULT_ROLE });
      });
    } catch (e: any) {
      // Two first visits at once (two tabs): the other request created the person.
      if (e?.code === 'ER_DUP_ENTRY' || /duplicate/i.test(e?.message ?? '')) {
        const existing = await this.ds.getRepository(UserEntity).findOne({ where: { portalUserId: person.id } });
        if (existing) return existing.id;
      }
      throw e;
    }
    await this.cfg.reload(); // names and pickers read people from the config cache
    await this.audit.record(id, 'auth.portal_create', `${person.name} joined from the portal`);
    this.log.log(`Created helpdesk user ${id} from the portal`);
    return id;
  }
}

const signInFirst = () => new AppError(401, 'UNAUTHENTICATED', 'Sign in to the portal to continue.');
