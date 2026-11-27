import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Links a helpdesk person to their NPST portal user (AUTH_MODE=portal). Additive: NULL for everyone
 * until they open the Helpdesk from the portal, so demo and OIDC modes are unaffected.
 */
export class PortalUserLink1763400000000 implements MigrationInterface {
  name = 'PortalUserLink1763400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE users ADD COLUMN portal_user_id VARCHAR(36) NULL');
    await q.query('CREATE UNIQUE INDEX uq_users_portal_user ON users (portal_user_id)');
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX uq_users_portal_user ON users');
    await q.query('ALTER TABLE users DROP COLUMN portal_user_id');
  }
}
