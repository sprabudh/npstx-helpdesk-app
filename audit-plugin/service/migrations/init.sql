-- Auditr Database Initialization Script
CREATE DATABASE IF NOT EXISTS auditr_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE auditr_db;

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_id VARCHAR(64) NOT NULL UNIQUE,
  service VARCHAR(100) NOT NULL,
  action VARCHAR(120) NOT NULL,
  actor_id VARCHAR(128) NOT NULL,
  actor_type VARCHAR(50) DEFAULT 'user',
  actor_name VARCHAR(150) NULL,
  actor_email VARCHAR(150) NULL,
  actor_ip VARCHAR(45) NULL,
  actor_user_agent TEXT NULL,
  target_id VARCHAR(128) NULL,
  target_type VARCHAR(64) NULL,
  target_name VARCHAR(150) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
  severity VARCHAR(20) NOT NULL DEFAULT 'INFO',
  changes JSON NULL,
  metadata JSON NULL,
  timestamp DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  prev_hash VARCHAR(64) NULL,
  record_hash VARCHAR(64) NOT NULL,
  INDEX idx_service (service),
  INDEX idx_action (action),
  INDEX idx_actor_id (actor_id),
  INDEX idx_target_id (target_id),
  INDEX idx_status (status),
  INDEX idx_severity (severity),
  INDEX idx_created_at (created_at),
  INDEX idx_service_created (service, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
