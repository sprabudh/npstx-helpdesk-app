# NPSTX Helpdesk — common tasks. Needs Node 20+, npm and Docker (for the database).
.PHONY: setup db install migrate seed dev api web test test-api e2e lint reset up down clean

setup: ## First run: env file, database, dependencies, schema and sample data
	@test -f .env || cp .env.example .env
	docker compose up -d db
	@echo "Waiting for MySQL…"; until docker compose exec -T db mysqladmin ping -h 127.0.0.1 --silent >/dev/null 2>&1; do sleep 2; done
	$(MAKE) install migrate seed

db:
	docker compose up -d db

install:
	npm --prefix backend ci
	npm --prefix frontend ci

migrate:
	npm --prefix backend run db:migrate

seed: ## Restore the mock's sample data (drops all ticket data)
	npm --prefix backend run db:seed

dev: ## API on :3000 and web app on :5173
	@trap 'kill 0' INT TERM; npm --prefix backend run dev & npm --prefix frontend run dev & wait

api:
	npm --prefix backend run dev

web:
	npm --prefix frontend run dev

test: ## Unit tests (backend policy matrix, SLA, AI rules; frontend components)
	npm --prefix backend test
	npm --prefix frontend test

test-api: ## API tests against the MySQL in .env (reseeds it)
	npm --prefix backend run test:e2e

e2e: ## Playwright flows; needs `make dev` running
	npm --prefix frontend run e2e

lint:
	npm --prefix backend run lint
	npm --prefix frontend run lint

reset: seed

up: ## Whole stack in Docker: web app on :8080, API on :3000
	@test -f .env || cp .env.example .env
	docker compose up -d --build

down:
	docker compose down

clean: ## Also deletes the database volume
	docker compose down -v
