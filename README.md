# NPSTX Integrated Helpdesk

One Helpdesk module for HR, L&D, IT and Support, Admin Desk and Salesforce (Sales, Presales and Solutions only). It is built from the clickable mock **"NPSTX Helpdesk Prototype v2"**, and the design is in [`docs/Helpdesk_SDD_v1.0.md`](docs/Helpdesk_SDD_v1.0.md).

| Part | Stack |
|---|---|
| `backend/` | NestJS 10, TypeORM 0.3, MySQL 8, JWT / OIDC, Swagger, Jest |
| `frontend/` | React 18, TypeScript, Vite 5, React Query, Zustand, Vitest, Playwright |
| `db/` | Seed data extracted from the mock (`db/seed/*.json`), MySQL init script |
| `docs/` | SDD v1.0 and reference screenshots |

![Dashboard](docs/screenshots/app-dashboard.png)

## Quick start

You need Node 20+, npm, and Docker (for MySQL). Without Docker, any MySQL 8 server works (see Troubleshooting).

```bash
cp .env.example .env              # then set DB_PASSWORD, MYSQL_ROOT_PASSWORD and JWT_SECRET
docker compose up -d db           # MySQL 8.4 with health check and a named volume
make install                      # npm ci in backend and frontend
npm run db:migrate && npm run db:seed
make dev                          # API http://localhost:3000 · web http://localhost:5173
```

`make setup` runs the env copy, database, install, migrate and seed in one step.

Everything in containers instead: `docker compose up --build`. The web app is on http://localhost:8080, and the backend runs migrations and seeds an empty database on start.

The app opens on the **Dashboard as Arjun Kumar** (Software Engineer, Engineering). Switch people with **Demo role** in the top bar, or open `http://localhost:5173/dashboard?as=u20`. Swagger is at http://localhost:3000/api/docs.

## Running inside the NPST portal

`AUTH_MODE=portal` runs the Helpdesk as a service of the NPST portal at `http://helpdesk.npst.localhost:8080`,
opened from the **Helpdesk** button at the bottom of the portal sidebar. Every signed-in portal user can open it.

- **Sign-in:** the portal session cookie is exchanged for a helpdesk token (`GET /api/auth/platform-sso`). The person is
  found by portal id, else linked by email, else created with the requester role `EMP`. Agent, head and admin roles stay
  in this database (Admin console). The token is bound to the portal session, so a portal sign-out or another person
  signing in on the same browser ends it. Demo sign-in, the persona switcher and demo data reset are off.
- **Notifications** also go to the portal's bell (notification bus stream `notifications:events:helpdesk`) for people
  who have opened the Helpdesk from the portal at least once.
- **Run:** start the portal stack first, put the settings in `~/Desktop/helpdesk-portal.env`
  (see `helpdesk-portal.env.example`), then `docker compose -f docker-compose.portal.yml up -d --build`.

## Commands

| Command | What it does |
|---|---|
| `make dev` | API with watch mode and Vite dev server |
| `make seed` / `make reset` | Reload the mock's sample data (deletes ticket data) |
| `make test` | Backend unit tests (access matrix, SLA, AI rules) and frontend unit tests |
| `make test-api` | API tests with Supertest against `DB_NAME` from `.env` (reseeds it; override `DB_NAME=helpdesk_e2e` to protect development data) |
| `make e2e` | Playwright flows (run `make dev` first) |
| `make lint` | ESLint for both apps |
| `make up` / `make down` / `make clean` | Docker stack up / down / down and delete the volume |

Tickets, logs, role selections and other saved changes persist across browser refresh and container restart; the sample data is loaded only for an empty database. In the app, **Reset demo data** in the role strip does the same as `make seed` (only when `DEMO_MODE=true`) and asks for confirmation because it deletes those changes.

## Personas

| Id | Person | What to try |
|---|---|---|
| u1 | Arjun Kumar, Software Engineer (Engineering) | Default. Raise tickets, reply to IT-000052, reopen HR-000098. No Salesforce |
| u6 | Sanjay Menon, Engineering Manager | Approve LND-000048 from the Dashboard |
| u3 | Priya Rao, HR Executive (Payroll, Leave) | Work HR tickets, internal notes, canned responses |
| u8 | Kavya Nair, HR / L&D Admin | Read-only HR (including confidential), L&D approvals |
| u4 | Meera Iyer, L&D Head | L&D approval step, all L&D tickets |
| u21 | Nikhil Rane, IT Support Engineer | Assigned to me, status changes, escalate IT-000050 |
| u23 | Suresh Pai, IT Head | All IT incl. confidential security, IT head approvals |
| u24 | Pooja Shetty, Admin Desk Executive | Facilities, travel and purchase tickets |
| u25 | Rahul Kapoor, Admin Head | Purchase approvals |
| u2 | Neha Shah, SFO Sales Rep (Sales) | Salesforce helpdesk visible |
| u5 | Rohan Das, SFO Case Admin (Sales) | Works Salesforce cases |
| u20 | Asha Kulkarni, Helpdesk Admin | Admin console, Edit / Configure menu, every ticket except Salesforce |
| u26 | Ritu Desai, Internal Auditor | Read-only, no confidential tickets |

## Configuration

All settings come from `.env` (see `.env.example`). Secrets are never in the code.

| Setting | Default | Notes |
|---|---|---|
| `AUTH_MODE` | `demo` | `oidc` verifies RS256 tokens from your IdP (`OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_USER_CLAIM`) |
| `DEMO_MODE` | `true` | Persona switcher, demo states, reset. Set `false` outside local and test |
| `DEMO_CLOCK_START` | `2026-11-04T11:46:00+05:30` | Makes the sample SLA states match the mock. Leave empty for real time |
| `AI_PROVIDER` | `rules` | `anthropic` uses Claude (`ANTHROPIC_API_KEY`, `AI_MODEL`); `none` turns AI off and the UI hides AI controls |
| `SALESFORCE_ADAPTER` | `mock` | `rest` uses OAuth client credentials (`SALESFORCE_*`) |
| `SLA_SCHEDULER_ENABLED` | `false` | Turn on for automatic escalation; `POST /api/admin/sla/run` runs one pass |
| `EMAIL_ADAPTER` | `console` | E-mails from the outbox are printed to the API log |

**To use Claude:** set `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY=…`, then restart the API. The key is read only by the AI provider on the server.

## Feature map (mock → code)

| Mock feature | Frontend | Backend |
|---|---|---|
| Shell, role strip, persona switch, bell, header search | `components/shell/Shell.tsx`, `App.tsx` | `auth/*`, `me/me.controller.ts` |
| Dashboard AI bar, big buttons, approvals, analytics | `pages/DashboardPage.tsx` | `ai/*`, `analytics/*`, `GET /approvals/pending` |
| My tickets / Assigned to me | `pages/TicketsPage.tsx` | `tickets/ticket-query.service.ts` |
| Ticket detail, actions, approvals, Salesforce box, feed | `pages/TicketDetailPage.tsx`, `components/modals/Modals.tsx` | `tickets/ticket-actions.service.ts`, `providers/*` |
| Raise drawer, AI voice assist, redirect, forms | `components/drawer/RaiseDrawer.tsx` | `tickets/ticket-create.service.ts`, `ai/rules-engine.ts` |
| Following / CC'd, History, FAQs | `pages/ListPages.tsx` | `GET /following`, `GET /history`, `faq/*` |
| Admin console | `pages/AdminPage.tsx` | `admin/*`, `helpdesk-config/*` |
| Access rules | UI uses the `me` block from the API | `domain/policy.ts` (+ `policy.spec.ts`) |
| SLA, escalation | SLA cells and bars | `domain/sla.ts`, `sla/sla.scheduler.ts` |
| Additions marked "New" | FAQ suggestions, Summarise, FAQ Edit | `POST /ai/faq-suggestions`, `POST /ai/summarise/:key`, `PUT /faqs/:id` |

## Visual comparison checklist

Compare with the mock at 1440 px and at 400 px. The reference images are in `docs/screenshots/`.

- [ ] Sidebar: dark green, Helpdesk active with badge 2 (Arjun)
- [ ] Module header: title, subtitle listing the helpdesks, subnav with counts, Raise ticket button
- [ ] Role strip: dashed border, role chips, helpdesk badges in their colours, demo-state links
- [ ] Dashboard: AI bar with sparkle and mic, five chips, three big buttons, 16 cards (Arjun: Total 15 · Open 1 · In progress 3 · Pending input 4 · Escalated 1 · SLA breached 2 · At risk 1 · Overdue 1 · Resolved this month 1 · Reopened 0 · 2h 28m · 2d 2h · 83 % · Following 1)
- [ ] Charts: teal trend line with end dot, helpdesk bars in HR purple / L&D amber / IT pink / Admin green
- [ ] My tickets: 8 open and 8 closed for Arjun; pills, flags, SLA texts (Due in …, Paused, Awaiting approval, Overdue …)
- [ ] Ticket detail: header row, action bar, banners, two columns, SLA bar with L1–L3 ticks, timeline dots
- [ ] Drawer: 3 steps, AI panel with Mock chip, helpdesk cards, notes (info / conf / appr / sf / redir)
- [ ] No horizontal page scroll at 400 px on any page

## Tests

| Suite | Count | Command |
|---|---|---|
| Backend unit (Jest) | 73 | `npm --prefix backend test` |
| Backend API (Jest + Supertest, MySQL) | 16 | `npm --prefix backend run test:e2e` |
| Frontend unit (Vitest) | 12 | `npm --prefix frontend test` |
| End-to-end (Playwright) | 12 | `npm --prefix frontend run e2e` |

All of these passed on 13 Nov 2026 against MySQL 8.0 running natively.

## Troubleshooting

| Problem | Fix |
|---|---|
| `ECONNREFUSED 127.0.0.1:3306` | Start the database: `docker compose up -d db`. Then wait until `docker compose ps` shows it as healthy |
| `Access denied for user` | `.env` passwords must match the ones the volume was created with. Run `make clean` to recreate it (this deletes the data) |
| `Pending migrations found` | Run `npm run db:migrate` before `npm run db:seed` |
| Port 3306, 3000 or 5173 in use | Change `DB_PORT` / `BACKEND_PORT` in `.env`, or `VITE_API_PROXY` for the web dev server |
| No Docker | Install MySQL 8 and create the database and user: `CREATE DATABASE helpdesk; CREATE USER 'helpdesk'@'%' IDENTIFIED BY '…'; GRANT ALL ON helpdesk.* TO 'helpdesk'@'%';`. Then migrate and seed |
| Numbers differ from the mock | Reseed (`make seed`) and keep `DEMO_CLOCK_START` set. Turning on the SLA scheduler changes the sample data on purpose |
| "AI features are turned off" | `AI_PROVIDER=none`, or `anthropic` without `ANTHROPIC_API_KEY`. Use `rules` for offline AI |
| Playwright cannot find a browser | `npx --prefix frontend playwright install chromium` |
| 401 after a while | Demo tokens last 30 minutes; the app signs the persona in again automatically |

## Verification status

- **Verified here:** migrations, seed, all four test suites, lint and type checks, and headless screenshots compared with the mock.
- **Docker:** image builds and `docker compose up` verified on 13 Nov 2026.
- **Written but not exercised:** the Salesforce REST adapter and the Anthropic provider. They need an org and an API key.

Intentional differences from the mock are listed in SDD section 20.2.
