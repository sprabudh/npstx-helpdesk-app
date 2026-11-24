# Changelog — NPSTX Helpdesk mock v0.3

The v0.3 change request (seven sections) is applied to this DB-backed React / NestJS app on top of
the v2 mock. The change is additive: no architecture, design token, component, flow, persona,
RBAC rule, status, ticket key, seed value, due date, FAQ count, AI mic, approval or analytics
number was changed unless listed below.

Legend: **Fact** = built and tested. **TC** = time-boxed / confirm with the business owner.

Verification on this branch: backend `npm run build` clean · backend `npx jest --forceExit --runInBand` **80
passed** · backend e2e **49 passed** against a separate `helpdesk_e2e` database · frontend `npm run build` clean · frontend `npx vitest
run` **12 passed** · Playwright **20 passed**. The acceptance tests live in
`backend/test/v03.e2e-spec.ts`, `backend/test/notifications.e2e-spec.ts`, `backend/test/api.e2e-spec.ts` and
`frontend/e2e/persistence.spec.ts`; the backend suites reseed only the database named by `DB_NAME`.

---

## 1. Demo roles and out of office

- **Persona switcher grouped by department.** `GET /auth/personas` now returns groups in order
  Employees, Managers, HR, L&D, IT and Support, Admin Desk, Sales Front Office, Governance, and
  each person carries `onLeave`. The shell shows "· on leave today" next to the person. **Fact**
- **New persona `u27` Karan Mehta, Senior SFO Case Admin**, in the Sales Front Office group; he is
  the first rung of the Salesforce "Senior admin queue". **Fact**
- **Out of office (demo) is now a panel, not a toggle.** The role strip button opens a modal that
  lists every assignee, category lead and ladder person **by helpdesk**, each with an "On leave
  today" switch and an "On leave tomorrow" chip. Backed by `GET /api/demo/absences` and
  `PUT /api/demo/absences/:id`; the old `POST /api/demo/out-of-office` (signed-in person) is kept.
  Changes last until "Reset demo data". **Fact**
- The switch derives its intent from server state (`on: !onLeaveToday`), so a controlled-checkbox
  race no longer sends the wrong value. **Fact**
- Seed absences relative to today: **u3 Priya Rao** (HR lead) on leave today; **u8 Kavya Nair**
  (L&D coordinator) on leave tomorrow; **u21 / u23 / u20** (the IT software ladder) away today.
  **Fact**

## 2. Absence-based reassignment (cover, not escalation)

- New `absences` and `attendance` tables and the pure `isUnavailable()` / `firstAvailable()`
  helpers (`backend/src/domain/availability.ts`). Only an approved full-day leave or an Absent
  attendance after the 11:00 IST cut-off makes a person unavailable; weekly offs, holidays, WFH,
  half-day, pending and rejected leave do not. **Fact** (cut-off **TC**)
- Routing steps **down the escalation ladder** to the next available and eligible person when the
  lead/owner is away (`TicketCreateService.route()`), keeping `escalationLevel` at 0. A neutral
  `assign` event is written ("Reassigned to <name> (assignee unavailable)"). **Fact**
- `tickets.asg_hist` (`asgHist`) records every assignment with `how` =
  `routing | absence | manual | queue-claim | escalation` and `coverFor`; `tickets.ladder_base`
  (`ladderBase`) records the rung of the current holder so a later escalation starts above the
  cover, never back to the absent lead. **Fact**
- **Confidential categories now reassign too** (HR PAY, REC, ONB, PERF): when the lead is away the
  ticket steps to the next ladder person, so an absent HR lead no longer strands a confidential
  ticket. **Restricted** categories (HR Grievance, IT Security) are still **not** widened — the
  cover must already qualify, so GRV / SEC keep the Unattended fallback. **Fact**
- When **nobody** is available the ticket stays with the category lead, the event reads "No cover
  available, kept with the category lead", the helpdesk admins are alerted and the ticket is
  listed as **Unattended** in the performance report; nobody else gains access. **Fact**
- Salesforce: owner away → the **Senior admin queue** person (u27). Queue-routed categories are
  never reassigned. **Fact**
- Approval categories: the absence check runs at the **last** approval, when the ticket leaves
  "Pending approval". **Fact**
- The covering person's notification appends "(covering for <name>)"; the absent person is not
  notified. The Reassign list marks people `away: true`. **Fact**

## 3. SLA versioning

- New `sla_versions` table (`SlaVersionEntity`) storing `tables`, `category_overrides`,
  `ladder_pct`, `changes`, `effective_from`, `set_by`, `note`; `tickets.sla_ver` binds each ticket
  to the version in force when it was raised. **Fact**
- Every admin save **appends** an immutable version; the Version history table shows version,
  effective from, changed by, the change and how many open tickets still sit on it. Older tickets
  keep their targets and due dates. **Fact**
- `ConfigService.slaFor()/ladder()` are version-aware; a 60-second coalescing window merges
  same-cell edits only when no ticket has been raised under the newest version. **Fact** (**TC**)
- The SLA answer and every calculation (creation, reopen, priority change, category change,
  approval completion, escalation % snapshot, analytics) read the ticket's bound version. **Fact**

## 4. Manager approval toggle and SLA start

- New `categories.mgr_approval` and `categories.mgr_approval_subs` columns (migration
  `1763200000000-ApprovalSlaStart`), plus `tickets.sla_started` and `tickets.sla_start`. **Fact**
- Migrated defaults: IT **Software and installation** on for *Install new software* and *Software
  licence request*; IT **Access** on; Admin Desk **Travel** and **Purchase** on; L&D **Course
  request** on; everything else off. **Fact**
- Turning the manager step **off** removes it for new tickets; any additional step (for example the
  Admin head on purchases) still applies. Turning it back on accepts a sub-category "Applies to"
  list. Every toggle is audited. **Fact**
- The SLA clock **starts at the last approval**, not at raise. While pending the assignee may add
  notes and reassign but **cannot** start, resolve, escalate or record a first response
  (`PENDING_APPROVAL`). A requester without a manager has the manager step routed to the Helpdesk
  admin. A ticket rejected at approval never starts its SLA and is left out of SLA metrics. **Fact**
- Raise toast: "… waiting for <step> approval · SLA starts after approval"; timeline event "SLA
  started on approval …". **Fact**

## 5. Priority is not chosen in the raise form

- The raise drawer has **no priority control** for any of the five helpdesks. A priority sent by a
  client is ignored; the category default applies (Admin Desk urgency mapping and the AI voice
  assist may still raise it). Priority stays visible to workers in tables, filters, detail and
  analytics. **Fact**
- The AI answer to "how long does a … ticket take" states the times **without naming a priority**.
  `PRIORITY_VISIBLE_TO_REQUESTER` controls whether plain requesters see priority at all (default
  **true**). **Fact** (**TC**)
- Copy: L&D FAQ #7, the Admin Desk urgency hint, the Core-fields chips and the raise preview no
  longer prompt for a priority; requester-facing FAQ answers were reworded to describe automatic
  prioritisation instead of naming a level. **Fact**

## 6. Dashboard clean-up (one source for every number)

- `backend/src/analytics/metrics.ts` is the **single definition** of every dashboard number;
  cards, charts and lists all read it. `Open = Not started + In progress + Pending input`; the old
  "Total" card is gone. **Fact**
- 14 cards grouped **Live / Attention / In date range**; every numeric card reproduces its count in
  the ticket list via its drill-down (`go`), and the by-helpdesk and top-category bars reconcile to
  **Raised**. **Fact**
- The redundant **"Following / CC'd" sub-nav tab was removed** (the large Dashboard button remains);
  the shell footer now reads "… Helpdesk module **v0.3 (mock)**". **Fact**

## 7. Assignee performance (replaces SLA compliance)

- `tickets.esc_log` (`escLog`) records every escalation (`level`, `at`, `from`, `to`,
  `how: sla | manual`, `by`). `backend/src/performance/intervals.ts` splits each ticket's life into
  **holder intervals**; a **direct** interval (routed, absence cover, queue claim) has exactly one
  outcome — `withinSla | late | escSla | escManual | reManual | reAbsence | open | rejected` — while
  **inherited** tickets (received by escalation or reassignment) are counted separately so nobody is
  blamed for time a ticket spent with someone else. **Fact**
- `GET /api/admin/performance?hd=&range=&q=&group=` (helpdesk admins) and
  `GET /api/performance/me?range=` (workers; 403 `NOT_A_WORKER` for everyone else). The admin
  console tab is **Assignee performance**; workers get a **My performance** page. Export CSV and
  filter changes are audited via `POST /api/admin/performance/log`. **Fact**
- There is **no compliance %** anywhere (code or UI); the reconciliation line proves the numbers
  add up (outcomes → Assigned, people + queue → total, escalations → handovers, overdue rows →
  dashboard Overdue card). **Fact**

---

## Unchanged (verified)

- 28 people/queues, 46 seed tickets, 50 FAQs, 25 notifications; every ticket key and due date; the
  SLA/analytics numbers for the seeded cohort; statuses; reopen rules; approvals; Salesforce
  entitlements and visibility; RBAC; the AI mic and rules-engine output (it still returns `f.pri`,
  only the UI hides it); design tokens and components.

---

## Acceptance tests (QA evidence)

All 26 backend v0.3 tests (`backend/test/v03.e2e-spec.ts`) pass; the frontend regression suite
(`frontend/e2e/flows.spec.ts`, `frontend/e2e/fixes.spec.ts`) passes 18/18.

| ID | Scenario | Result | Evidence |
|----|----------|--------|----------|
| P1 | Personas grouped by department; u27 Senior SFO Case Admin; on-leave flags | Pass | `1 · groups personas by department…` |
| P2 | Out of office panel lists assignees, leads and ladder people by helpdesk | Pass | `1 · the Out of office panel lists…` |
| A1 | HR lead away → next ladder person, neutral event, no escalation, cover notification | Pass | `A1: HR lead away → …` |
| A2 | Lead and next person away → the one after | Pass | `A2: lead and next person away → …` |
| A4 | L&D: coordinator away → L&D head; both away → HR head skipped as ineligible → fallback | Pass | `A4: L&D coordinator away → …` |
| A3 | Grievance with HR head away stays put, admins alerted, nobody else gains access | Pass | `A3: Grievance with the HR head away…` |
| A5 | IT security with Farhan away → IT head | Pass | `A5: IT security with Farhan away…` |
| — | Confidential category (PAY) lead away → next ladder person covers it (no escalation) | Pass | `confidential category (PAY)…` |
| A6 | Queue categories are unaffected | Pass | `A6: queue categories are unaffected` |
| A7 | Salesforce owner away → Senior admin queue person | Pass | `A7: Salesforce owner away…` |
| A8 | Escalation from the cover goes above them, never back to the absent lead | Pass | `A8: escalation from the cover…` |
| A9 | Approval category: absence check at the last approval and SLA starts there | Pass | `A9: approval category…` |
| — | Seeded Admin Desk lead + next both away → kept with lead, listed Unattended | Pass | `seeded Admin Desk lead and next person both away…` |
| — | Reassign list marks people unavailable today | Pass | `the Reassign list marks people unavailable today` |
| S1 | Each save appends a version; tickets bind at raise; open tickets keep theirs | Pass | `3 · each save appends a version…` |
| M1/M2 | Toggling manager approval off removes the step; additional steps still apply | Pass | `M1/M2: toggling off removes the manager step…` |
| M3 | A sub-category outside "Applies to" raises without approval | Pass | `M3: a sub-category outside "Applies to"…` |
| M4 | Migrated values: SW on for two subs; Access, Travel, Purchase, Course on; others off | Pass | `migrated values: SW on for two subs…` |
| M5 | While pending the assignee may note and reassign but not start/resolve/escalate | Pass | `M5: while pending the assignee…` |
| M6 | Requester without a manager → manager step routed to the Helpdesk admin | Pass | `M6: a requester without a manager…` |
| M7 | Rejected at approval: never started, left out of SLA metrics | Pass | `rejected at approval: never started…` |
| C1 | A requester-sent priority is ignored; the category default applies | Pass | `5 · a requester-sent priority is ignored…` |
| C2 | AI voice may raise priority for urgent speech | Pass | `AI voice may raise priority for urgent speech` |
| C3 | The SLA answer does not name a priority for requesters | Pass | `the SLA answer does not name a priority…` |
| D1 | Open = Not started + In progress + Pending input; every card reproduces its count | Pass | `6 · Open = Not started + …` |
| F1 | Seeded escalations count as Escalated by SLA / Received by escalation | Pass | `7 · seeded escalations count…` |
| F2 | Outcomes → Assigned, assignments → total, overdue → dashboard card | Pass | `reconciles: outcomes add up…` |
| F3 | My performance shows only your own data; others get 403 | Pass | `My performance shows only your own data…` |
| R1 | Regression — backend unit 80, frontend unit 12, Playwright 18, builds clean | Pass | see the header of this file |

---

## Data dictionary

### Dashboard cards (`GET /analytics` → `cards[]`; key `k`, group `g`, formula `f`, drill `go`)

| `k` | Group | Label | Definition |
|---|---|---|---|
| `open` | live | Open | Not closed = `notstarted + progress + pending` |
| `notstarted` | live | Not started | Open, UI status "Open" |
| `progress` | live | In progress | Open, UI status "In Progress" |
| `pending` | live | Pending input | Open, UI status "Pending Input" |
| `esc` | attention | Escalated | Open, `escalationLevel > 0` or status Escalated (or SF status Escalated) |
| `over` | attention | Overdue | Open, SLA running, not paused, past resolution due |
| `risk` | attention | At risk | Open, SLA running, not paused, resolution due within 24 h |
| `unasg` | attention | Unassigned | Open tickets still held by a queue |
| `raised` | range | Raised | Tickets raised in the date range (open or closed) |
| `closed` | range | Closed | Raised in range and now closed (`resolved / rejected / cancelled`) |
| `reopened` | range | Reopened | Raised in range, reopened at least once |
| `breach` | range | SLA breached | Raised in range, missed first response or resolution (`responseBreached / resolutionBreached`); rejected, cancelled and never-started excluded |
| `first` | range | Avg first response | Mean SLA start → first public staff reply (raised in range) |
| `resolve` | range | Avg resolution | Mean SLA start → resolution (resolved, raised in range) |

Charts: `byHd`, `byPri`, `topCats` (5 + Other), `series` (daily raised), `ageing` (open by age);
`byHd` and `topCats` sum to `raised`. `priorityVisible` hides `byPri` from plain requesters when
`PRIORITY_VISIBLE_TO_REQUESTER=false`.

### Assignee performance (`GET /admin/performance` → `rows[].counts`; columns `COLS`)

| Column | Meaning |
|---|---|
| `assigned` | Direct intervals (routed / cover / queue claim) that started in range — equals the eight outcomes below |
| `withinSla` | Direct interval, ticket closed at or before the resolution due |
| `late` | Direct interval, ticket closed after the resolution due |
| `escSla` | Direct interval ended by an **automatic** escalation |
| `escManual` | Direct interval ended by a **manual** escalation |
| `reManual` | Direct interval ended by a manual reassignment |
| `reAbsence` | Direct interval ended by absence cover |
| `open` | Direct interval still open |
| `rejected` | Direct interval whose ticket closed without an SLA count |
| `respWithin` / `respBreached` | First response met / missed, credited to the holder at the reply |
| `slaBreached` | Derived: `late + escSla + overdueNow` |
| `recvEsc` / `recvReasg` | Inherited intervals received by escalation / reassignment |
| `covered` | Direct intervals that were absence cover |
| `overdueNow` | Live and overdue, credited to the current holder |

`reconciliation`: `peopleAssigned + queueAssigned = directTotal`, `escDirect + escInherited =
escHandovers`, `overdueRows = overdueCard`. There is no compliance column.

---

## 8. Notification catalogue (additive)

- **Single catalogue** `backend/src/notifications/event-catalogue.ts` defines 25 notification events
  and 4 reminder events, each with fixed channel set, recipient rule and fixed short copy. The
  event key is authoritative; the matrix/catalogue files were not supplied, so names, templates and
  recipient rules were derived from the existing notify calls and the v0.3 requirements. **TC**
- **One emitter** `TicketEventEmitter.emitTicketEvent()` is now used by ticket creation, ticket
  actions and the SLA scheduler. It resolves recipients, expands queues to active members, drops
  the actor, de-duplicates per person, applies the confidential override and hands a typed event to
  `NotificationGateway`. `NotificationsService` keeps the list/read APIs and the email outbox
  worker unchanged. **Fact**
- **Local gateway** `LocalNotificationGateway` writes the in-app row plus the email outbox row in
  one transaction, including subject `[NPSTX Helpdesk] <key>`, body with the
  `/helpdesk/tickets/<key>` deep link, and masked text for confidential tickets. Dedupe hits are
  swallowed by the unique `dedupe_key` index. **Fact**
- **Additive DB shape** `notifications` gains `event_type`, `category`, `recipient_user_id`,
  `ticket_id`, `actor_user_id`, `channel`, `dedupe_key`, `payload`, `email_status`, `email_sent_at`
  and `error`, all nullable; new indexes are `ix_notifications_recipient`,
  `uq_notifications_dedupe`, `ix_notifications_ticket`. New `notification_reminders` stores one row
  per `(ticket_key, reminder_type, threshold)`. Old rows are backfilled and remain valid. **Fact**
- **Reminders** are idempotent: SLA at-risk (75% / 2 h), stuck approval (24 h / 48 h), waiting for
  employee (24 h / 48 h) and unattended (1 h / 4 h) fire once per threshold, persisted across
  scheduler restarts. SLA breaches route through the same catalogue. **Fact**
- **Two-line in-app cards** in the bell panel and dashboard "Latest updates" now show the short
  message and `<DD HH:mm Mon> · in-app + email` (or `· in-app`). Mark-all/read/click behaviour and
  the 50-item / 6-item limits are unchanged. **Fact**
- **Integration contract** `docs/Notification_API_Spec.md` documents endpoints, JSON, auth,
  idempotency, error codes and one sample payload per event type including confidential and
  absence-cover variants. **Fact**

---

## 9. Persistent demo data

- **Demo data is a first-run baseline, not a refresh reset.** Docker startup still runs
  `seed.cli --if-empty`, but the check now skips when either `users` or `tickets` contains data.
  Browser refresh, persona switch and container restart no longer reseed the database. **Fact**
- **Selected persona survives refresh and new tabs.** The demo token and user id are kept in
  `localStorage` with `sessionStorage` fallback; an expired token re-signs in the remembered person
  instead of silently dropping to the default persona. `?as=<userId>` still takes precedence.
  **Fact**
- **Reset is explicit and guarded.** "Reset demo data" now asks for confirmation before the
  destructive seed; `make seed` / `make reset` remain the intentional CLI equivalents. **Fact**
- **FAQ feedback is real persisted state.** `GET /api/faqs` returns the signed-in person's latest
  vote as `myVote`, `POST /faqs/:id/vote` upserts one vote per person/FAQ, and the UI restores the
  marker after refresh instead of relying on memory-only state. **Fact**

---

## Assumptions (TC) and hook points

- **Attendance cut-off** is 11:00 IST (`ATTENDANCE_CUTOFF_HOUR_IST`). **TC** — confirm the time.
  Hook: `backend/src/domain/availability.ts`.
- Only **approved full-day leave** or **Absent after the cut-off** make a person unavailable. **TC**.
- The **Unattended** fallback (keep the lead, alert HD admins, list it) is an added safeguard.
  **TC** — confirm the escalation owner.
- **Cover routing never changes a queue-routed ticket.** **TC**.
- **60-second coalescing** of same-cell SLA edits applies only when no ticket was raised under the
  newest version. **TC**.
- `PRIORITY_VISIBLE_TO_REQUESTER` defaults to **true**; set `false` to hide priority from plain
  requesters in tables, filters, detail and the analytics "By priority" chart. **TC**.
- Redirecting SLA/escalation notifications for an out-of-office owner is **off** by default. **TC**.
- Notification event names, short copy, channel sets, recipient rules and reminder thresholds were
  derived from the repository because NOTIFICATION_MATRIX / NOTIFICATION_CATALOGUE were not
  provided. Confirm against the official matrix; hooks: `backend/src/notifications/event-catalogue.ts`
  and `docs/Notification_API_Spec.md`. **TC**.

---

## SDD sections updated

`docs/Helpdesk_SDD_v1.0.md` was updated in place for v0.3: document control (§1.1) and a new §1.4;
personas and role catalogue (§3, §3.1); shell (§4.1); dashboard (§4.2); raise drawer (§4.5); admin
console (§4.9); modals (§4.10); routing and assignment (§5.2); approvals (§5.4); SLA and escalation
(§5.5); notifications (§5.10); priorities (§6.4); escalation ladders (§6.5); data model (§9.1);
REST API (§10.1); testing (§14); differences and open decisions (§20.2, §20.3).
