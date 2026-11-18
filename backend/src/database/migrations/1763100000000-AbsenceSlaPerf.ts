import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fix 1 (absence-based reassignment), Fix 2 (SLA versioning) and Fix 4 (assignee performance).
 * Additive only: new tables plus nullable/defaulted columns on tickets, so existing rows stay valid.
 */
export class AbsenceSlaPerf1763100000000 implements MigrationInterface {
  name = 'AbsenceSlaPerf1763100000000';

  public async up(q: QueryRunner): Promise<void> {
    const t = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';
    await q.query(`ALTER TABLE tickets
      ADD COLUMN sla_ver INT NOT NULL DEFAULT 1,
      ADD COLUMN ladder_base INT NOT NULL DEFAULT 0,
      ADD COLUMN asg_hist JSON NULL,
      ADD COLUMN esc_log JSON NULL`);
    await q.query(`CREATE TABLE absences (
      id INT NOT NULL AUTO_INCREMENT, user_id VARCHAR(32) NOT NULL, from_date DATE NOT NULL, to_date DATE NOT NULL,
      type VARCHAR(20) NOT NULL, status VARCHAR(12) NOT NULL, PRIMARY KEY (id), KEY ix_absences_user (user_id),
      CONSTRAINT fk_absences_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE) ${t}`);
    await q.query(`CREATE TABLE attendance (
      id INT NOT NULL AUTO_INCREMENT, user_id VARCHAR(32) NOT NULL, date DATE NOT NULL, status VARCHAR(20) NOT NULL,
      marked_at DATETIME NULL, PRIMARY KEY (id), UNIQUE KEY uq_attendance (user_id, date),
      CONSTRAINT fk_attendance_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE) ${t}`);
    await q.query(`CREATE TABLE sla_versions (
      id INT NOT NULL AUTO_INCREMENT, effective_from DATETIME NOT NULL, set_by VARCHAR(32) NULL,
      tables JSON NOT NULL, category_overrides JSON NULL, ladder_pct JSON NULL, note VARCHAR(300) NULL,
      PRIMARY KEY (id), KEY ix_sla_versions_from (effective_from)) ${t}`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS sla_versions');
    await q.query('DROP TABLE IF EXISTS attendance');
    await q.query('DROP TABLE IF EXISTS absences');
    await q.query('ALTER TABLE tickets DROP COLUMN esc_log, DROP COLUMN asg_hist, DROP COLUMN ladder_base, DROP COLUMN sla_ver');
  }
}
