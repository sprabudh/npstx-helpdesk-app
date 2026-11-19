import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * v0.3: per-category manager approval toggle, SLA that starts at the last approval, and structured
 * before → after values on SLA versions. Additive only; existing rows keep working.
 */
export class ApprovalSlaStart1763200000000 implements MigrationInterface {
  name = 'ApprovalSlaStart1763200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE tickets
      ADD COLUMN sla_started TINYINT NOT NULL DEFAULT 1,
      ADD COLUMN sla_start DATETIME NULL`);
    await q.query(`ALTER TABLE categories
      ADD COLUMN mgr_approval TINYINT NOT NULL DEFAULT 0,
      ADD COLUMN mgr_approval_subs JSON NULL`);
    await q.query('ALTER TABLE sla_versions ADD COLUMN changes JSON NULL');
    // Migration of existing rows: manager approval ON where the old approval rule had a manager step.
    await q.query(`UPDATE categories SET mgr_approval = 1, mgr_approval_subs = JSON_ARRAY('Install new software', 'Software licence request')
      WHERE helpdesk = 'IT' AND cat_key = 'SW'`);
    await q.query(`UPDATE categories SET mgr_approval = 1 WHERE (helpdesk = 'IT' AND cat_key = 'ACC') OR (helpdesk = 'ADM' AND cat_key IN ('TRAVEL', 'PUR')) OR (helpdesk = 'LND' AND cat_key = 'COURSE')`);
    // Pending tickets have no running SLA yet; it starts when the last approval is given.
    await q.query(`UPDATE tickets SET sla_started = 0 WHERE status = 'Pending approval'`);
    await q.query(`UPDATE tickets SET sla_started = 0 WHERE status = 'Rejected' AND ticket_key IN (SELECT ticket_key FROM ticket_approvals WHERE status = 'Rejected')`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE sla_versions DROP COLUMN changes');
    await q.query('ALTER TABLE categories DROP COLUMN mgr_approval_subs, DROP COLUMN mgr_approval');
    await q.query('ALTER TABLE tickets DROP COLUMN sla_start, DROP COLUMN sla_started');
  }
}
