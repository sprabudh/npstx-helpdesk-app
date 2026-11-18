import { MigrationInterface, QueryRunner } from 'typeorm';

/** Initial schema for the NPSTX Integrated Helpdesk (SDD v1.0, section 8). */
export class InitSchema1763030000000 implements MigrationInterface {
  name = 'InitSchema1763030000000';

  public async up(q: QueryRunner): Promise<void> {
    const t = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';
    await q.query(`CREATE TABLE users (
      id VARCHAR(32) NOT NULL, name VARCHAR(120) NOT NULL, email VARCHAR(160) NULL, dept VARCHAR(80) NULL,
      title VARCHAR(120) NULL, location VARCHAR(80) NULL, manager_id VARCHAR(32) NULL,
      is_queue TINYINT(1) NOT NULL DEFAULT 0, active TINYINT(1) NOT NULL DEFAULT 1,
      PRIMARY KEY (id), KEY ix_users_manager (manager_id),
      CONSTRAINT fk_users_manager FOREIGN KEY (manager_id) REFERENCES users (id) ON DELETE SET NULL) ${t}`);
    await q.query(`CREATE TABLE user_roles (
      user_id VARCHAR(32) NOT NULL, role VARCHAR(24) NOT NULL, PRIMARY KEY (user_id, role),
      CONSTRAINT fk_roles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE) ${t}`);
    await q.query(`CREATE TABLE user_hr_categories (
      user_id VARCHAR(32) NOT NULL, category_key VARCHAR(24) NOT NULL, PRIMARY KEY (user_id, category_key),
      CONSTRAINT fk_hrcat_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE) ${t}`);
    await q.query(`CREATE TABLE categories (
      id INT NOT NULL AUTO_INCREMENT, helpdesk VARCHAR(8) NOT NULL, cat_key VARCHAR(24) NOT NULL, name VARCHAR(120) NOT NULL,
      subs JSON NOT NULL, default_priority VARCHAR(12) NULL, lead_id VARCHAR(32) NULL, owner_id VARCHAR(32) NULL,
      queue_id VARCHAR(32) NULL, confidential TINYINT(1) NOT NULL DEFAULT 0, restricted TINYINT(1) NOT NULL DEFAULT 0,
      reopen_allowed TINYINT(1) NULL, request_type VARCHAR(12) NULL, needs_record TINYINT(1) NOT NULL DEFAULT 0,
      needs_impact TINYINT(1) NOT NULL DEFAULT 0, sla_override JSON NULL, approval_rule JSON NULL,
      active TINYINT(1) NOT NULL DEFAULT 1, sort_order INT NOT NULL DEFAULT 0,
      PRIMARY KEY (id), UNIQUE KEY uq_category (helpdesk, cat_key),
      CONSTRAINT fk_cat_lead FOREIGN KEY (lead_id) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_cat_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_cat_queue FOREIGN KEY (queue_id) REFERENCES users (id) ON DELETE SET NULL) ${t}`);
    await q.query(`CREATE TABLE form_fields (
      id INT NOT NULL AUTO_INCREMENT, helpdesk VARCHAR(8) NOT NULL, category_key VARCHAR(24) NOT NULL,
      field_key VARCHAR(40) NOT NULL, label VARCHAR(120) NOT NULL, type VARCHAR(20) NOT NULL, options JSON NULL,
      placeholder VARCHAR(160) NULL, hint VARCHAR(200) NULL, min_value DOUBLE NULL, pattern VARCHAR(200) NULL,
      pattern_flags VARCHAR(8) NULL, pattern_message VARCHAR(200) NULL, default_value VARCHAR(80) NULL,
      required_rule JSON NULL, show_when JSON NULL, validation JSON NULL, is_custom TINYINT(1) NOT NULL DEFAULT 0,
      active TINYINT(1) NOT NULL DEFAULT 1, sort_order INT NOT NULL DEFAULT 0,
      PRIMARY KEY (id), UNIQUE KEY uq_field (helpdesk, category_key, field_key)) ${t}`);
    await q.query(`CREATE TABLE settings (setting_key VARCHAR(64) NOT NULL, value JSON NOT NULL, PRIMARY KEY (setting_key)) ${t}`);
    await q.query(`CREATE TABLE tickets (
      ticket_key VARCHAR(20) NOT NULL, helpdesk VARCHAR(8) NOT NULL, category_key VARCHAR(24) NOT NULL,
      sub_category VARCHAR(120) NOT NULL, title VARCHAR(150) NOT NULL, description TEXT NOT NULL,
      priority VARCHAR(12) NOT NULL, status VARCHAR(40) NOT NULL, close_response VARCHAR(20) NULL, close_message TEXT NULL,
      requester_id VARCHAR(32) NOT NULL, assignee_id VARCHAR(32) NOT NULL, created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL, closed_at DATETIME NULL, closed_by_id VARCHAR(32) NULL,
      response_due DATETIME NOT NULL, resolution_due DATETIME NOT NULL, response_met TINYINT(1) NULL,
      confidential TINYINT(1) NOT NULL DEFAULT 0, escalation_level INT NOT NULL DEFAULT 0, paused TINYINT(1) NOT NULL DEFAULT 0,
      related_key VARCHAR(20) NULL, fields JSON NOT NULL, ai_transcript TEXT NULL,
      PRIMARY KEY (ticket_key),
      KEY ix_tickets_requester (requester_id), KEY ix_tickets_assignee (assignee_id),
      KEY ix_tickets_hd_status (helpdesk, status), KEY ix_tickets_hd_cat (helpdesk, category_key),
      KEY ix_tickets_due (resolution_due),
      CONSTRAINT fk_tickets_requester FOREIGN KEY (requester_id) REFERENCES users (id),
      CONSTRAINT fk_tickets_assignee FOREIGN KEY (assignee_id) REFERENCES users (id),
      CONSTRAINT fk_tickets_closed_by FOREIGN KEY (closed_by_id) REFERENCES users (id)) ${t}`);
    await q.query(`CREATE TABLE ticket_comments (
      id INT NOT NULL AUTO_INCREMENT, ticket_key VARCHAR(20) NOT NULL, author_id VARCHAR(32) NOT NULL, body TEXT NOT NULL,
      internal TINYINT(1) NOT NULL DEFAULT 0, created_at DATETIME NOT NULL, PRIMARY KEY (id), KEY ix_comments_ticket (ticket_key),
      CONSTRAINT fk_comments_ticket FOREIGN KEY (ticket_key) REFERENCES tickets (ticket_key) ON DELETE CASCADE,
      CONSTRAINT fk_comments_author FOREIGN KEY (author_id) REFERENCES users (id)) ${t}`);
    await q.query(`CREATE TABLE ticket_events (
      id INT NOT NULL AUTO_INCREMENT, ticket_key VARCHAR(20) NOT NULL, at DATETIME NOT NULL, text VARCHAR(400) NOT NULL,
      kind VARCHAR(12) NOT NULL, PRIMARY KEY (id), KEY ix_events_ticket (ticket_key),
      CONSTRAINT fk_events_ticket FOREIGN KEY (ticket_key) REFERENCES tickets (ticket_key) ON DELETE CASCADE) ${t}`);
    await q.query(`CREATE TABLE ticket_followers (
      ticket_key VARCHAR(20) NOT NULL, user_id VARCHAR(32) NOT NULL, relation VARCHAR(12) NOT NULL, added_by_id VARCHAR(32) NOT NULL,
      PRIMARY KEY (ticket_key, user_id), KEY ix_followers_user (user_id),
      CONSTRAINT fk_followers_ticket FOREIGN KEY (ticket_key) REFERENCES tickets (ticket_key) ON DELETE CASCADE,
      CONSTRAINT fk_followers_user FOREIGN KEY (user_id) REFERENCES users (id)) ${t}`);
    await q.query(`CREATE TABLE ticket_approvals (
      ticket_key VARCHAR(20) NOT NULL, step VARCHAR(8) NOT NULL, seq INT NOT NULL, status VARCHAR(12) NOT NULL,
      approver_id VARCHAR(32) NULL, decided_by_id VARCHAR(32) NULL, decided_at DATETIME NULL,
      PRIMARY KEY (ticket_key, step), KEY ix_approvals_approver (approver_id),
      CONSTRAINT fk_approvals_ticket FOREIGN KEY (ticket_key) REFERENCES tickets (ticket_key) ON DELETE CASCADE) ${t}`);
    await q.query(`CREATE TABLE attachments (
      id INT NOT NULL AUTO_INCREMENT, ticket_key VARCHAR(20) NOT NULL, file_name VARCHAR(200) NOT NULL, size_bytes INT NOT NULL,
      mime_type VARCHAR(120) NULL, storage_path VARCHAR(300) NULL, uploaded_by_id VARCHAR(32) NOT NULL, created_at DATETIME NOT NULL,
      PRIMARY KEY (id), KEY ix_attachments_ticket (ticket_key),
      CONSTRAINT fk_attachments_ticket FOREIGN KEY (ticket_key) REFERENCES tickets (ticket_key) ON DELETE CASCADE) ${t}`);
    await q.query(`CREATE TABLE sf_cases (
      ticket_key VARCHAR(20) NOT NULL, case_no VARCHAR(20) NOT NULL, entitlement VARCHAR(80) NOT NULL, milestones JSON NOT NULL,
      external_id VARCHAR(40) NULL, PRIMARY KEY (ticket_key), UNIQUE KEY uq_sf_case_no (case_no),
      CONSTRAINT fk_sfcase_ticket FOREIGN KEY (ticket_key) REFERENCES tickets (ticket_key) ON DELETE CASCADE) ${t}`);
    await q.query(`CREATE TABLE sf_case_team (
      ticket_key VARCHAR(20) NOT NULL, user_id VARCHAR(32) NOT NULL, role VARCHAR(60) NOT NULL, PRIMARY KEY (ticket_key, user_id),
      CONSTRAINT fk_sfteam_case FOREIGN KEY (ticket_key) REFERENCES sf_cases (ticket_key) ON DELETE CASCADE) ${t}`);
    await q.query(`CREATE TABLE sf_child_cases (
      id INT NOT NULL AUTO_INCREMENT, ticket_key VARCHAR(20) NOT NULL, case_no VARCHAR(20) NOT NULL, title VARCHAR(200) NOT NULL,
      status VARCHAR(40) NOT NULL, owner_name VARCHAR(120) NOT NULL, PRIMARY KEY (id),
      CONSTRAINT fk_sfchild_case FOREIGN KEY (ticket_key) REFERENCES sf_cases (ticket_key) ON DELETE CASCADE) ${t}`);
    await q.query(`CREATE TABLE notifications (
      id INT NOT NULL AUTO_INCREMENT, user_id VARCHAR(32) NOT NULL, text VARCHAR(300) NOT NULL, ticket_key VARCHAR(20) NULL,
      created_at DATETIME NOT NULL, read_at DATETIME NULL, PRIMARY KEY (id), KEY ix_notifications_user (user_id, read_at),
      CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE) ${t}`);
    await q.query(`CREATE TABLE notification_outbox (
      id INT NOT NULL AUTO_INCREMENT, channel VARCHAR(12) NOT NULL, recipient VARCHAR(160) NOT NULL, subject VARCHAR(200) NOT NULL,
      body TEXT NOT NULL, status VARCHAR(12) NOT NULL DEFAULT 'pending', attempts INT NOT NULL DEFAULT 0,
      last_error VARCHAR(300) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, sent_at DATETIME NULL,
      PRIMARY KEY (id), KEY ix_outbox_status (status)) ${t}`);
    await q.query(`CREATE TABLE faqs (
      id INT NOT NULL AUTO_INCREMENT, helpdesk VARCHAR(8) NOT NULL, sort_order INT NOT NULL, question TEXT NOT NULL,
      answer TEXT NOT NULL, category_key VARCHAR(24) NULL, PRIMARY KEY (id), KEY ix_faqs_hd (helpdesk, sort_order)) ${t}`);
    await q.query(`CREATE TABLE faq_votes (
      id INT NOT NULL AUTO_INCREMENT, faq_id INT NOT NULL, user_id VARCHAR(32) NOT NULL, helpful TINYINT(1) NOT NULL,
      created_at DATETIME NOT NULL, PRIMARY KEY (id),
      CONSTRAINT fk_votes_faq FOREIGN KEY (faq_id) REFERENCES faqs (id) ON DELETE CASCADE) ${t}`);
    await q.query(`CREATE TABLE audit_log (
      id INT NOT NULL AUTO_INCREMENT, at DATETIME NOT NULL, actor_id VARCHAR(32) NULL, action VARCHAR(60) NOT NULL,
      target VARCHAR(120) NULL, outcome VARCHAR(12) NOT NULL, summary VARCHAR(400) NOT NULL, detail JSON NULL,
      PRIMARY KEY (id), KEY ix_audit_at (at), KEY ix_audit_action (action)) ${t}`);
    await q.query(`CREATE TABLE ticket_sequences (helpdesk VARCHAR(8) NOT NULL, next_value INT NOT NULL, PRIMARY KEY (helpdesk)) ${t}`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [
      'ticket_sequences', 'audit_log', 'faq_votes', 'faqs', 'notification_outbox', 'notifications', 'sf_child_cases',
      'sf_case_team', 'sf_cases', 'attachments', 'ticket_approvals', 'ticket_followers', 'ticket_events',
      'ticket_comments', 'tickets', 'settings', 'form_fields', 'categories', 'user_hr_categories', 'user_roles', 'users',
    ]) {
      await q.query(`DROP TABLE IF EXISTS ${table}`);
    }
  }
}
