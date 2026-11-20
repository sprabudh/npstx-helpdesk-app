import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Notification event model (additive). Extends the existing `notifications` table with the fields the
 * typed event catalogue needs (event type, category, channel, dedupe key, masked payload, email status)
 * and adds a reminder state table so scheduler reminders are idempotent per ticket/type/threshold.
 *
 * Nothing destructive: every new column is NULLable, so the legacy insert path keeps working and old
 * rows stay valid. `user_id` remains the recipient for backwards compatibility; `recipient_user_id`
 * mirrors it for the event model.
 */
export class NotificationEvents1763300000000 implements MigrationInterface {
  name = 'NotificationEvents1763300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE notifications
      ADD COLUMN event_type VARCHAR(48) NULL,
      ADD COLUMN category VARCHAR(12) NULL,
      ADD COLUMN recipient_user_id VARCHAR(32) NULL,
      ADD COLUMN ticket_id VARCHAR(20) NULL,
      ADD COLUMN actor_user_id VARCHAR(32) NULL,
      ADD COLUMN channel VARCHAR(24) NULL,
      ADD COLUMN dedupe_key VARCHAR(160) NULL,
      ADD COLUMN payload JSON NULL,
      ADD COLUMN email_status VARCHAR(12) NULL,
      ADD COLUMN email_sent_at DATETIME NULL,
      ADD COLUMN error VARCHAR(300) NULL`);
    await q.query('CREATE INDEX ix_notifications_recipient ON notifications (recipient_user_id, read_at, created_at)');
    await q.query('CREATE UNIQUE INDEX uq_notifications_dedupe ON notifications (dedupe_key)');
    await q.query('CREATE INDEX ix_notifications_ticket ON notifications (ticket_id)');
    // Backfill the mirror column for existing rows (additive, no data loss).
    await q.query('UPDATE notifications SET recipient_user_id = user_id WHERE recipient_user_id IS NULL');
    await q.query('UPDATE notifications SET category = \'NOTIFICATION\', channel = \'in-app+email\' WHERE category IS NULL');

    await q.query(`CREATE TABLE notification_reminders (
      id INT NOT NULL AUTO_INCREMENT,
      ticket_key VARCHAR(20) NOT NULL,
      reminder_type VARCHAR(40) NOT NULL,
      threshold VARCHAR(24) NOT NULL,
      last_sent_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_reminder (ticket_key, reminder_type, threshold),
      KEY ix_reminder_ticket (ticket_key)) ${q.connection.options.type === 'mysql' ? 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : ''}`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS notification_reminders');
    await q.query('DROP INDEX ix_notifications_ticket ON notifications');
    await q.query('DROP INDEX uq_notifications_dedupe ON notifications');
    await q.query('DROP INDEX ix_notifications_recipient ON notifications');
    await q.query(`ALTER TABLE notifications
      DROP COLUMN error,
      DROP COLUMN email_sent_at,
      DROP COLUMN email_status,
      DROP COLUMN payload,
      DROP COLUMN dedupe_key,
      DROP COLUMN channel,
      DROP COLUMN actor_user_id,
      DROP COLUMN ticket_id,
      DROP COLUMN recipient_user_id,
      DROP COLUMN category,
      DROP COLUMN event_type`);
  }
}
