-- Runs once when the MySQL volume is first created. The schema itself is created by the
-- TypeORM migration (backend/src/database/migrations), which the backend container runs on start.
ALTER DATABASE helpdesk CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
