# Changelog — NPSTX Helpdesk prototype v2 fixes

All four requested fixes were applied to this DB-backed React/NestJS app. The change is
additive: no architecture, design token, component, flow, persona, RBAC rule, status,
ticket key, seed value, due date, FAQ, AI mic, approval or analytics number was changed.

Legend: **TC** = time-boxed / confirm with the business owner.

---

## Added

### Fix 1 — absence-based cover (not escalation)
- `absences` and `attendance` tables (`AbsenceEntity`, `AttendanceEntity`) and the pure
  `isUnavailable()` / `firstAvailable()` helpers (`backend/src/domain/availability.ts`).
- Routing now steps **down the escalation ladder** to the next **available and eligible**
  person when the lead/owner is away (`TicketCreateService.route()`), keeping
  `escalationLevel` at 0.
- `tickets.asg_hist` (`asgHist`) records every assignment with `how` =
  `routing | absence | manual | queue-claim | escalation` and `coverFor` (the absent user).
- `tickets.ladder_base` (`ladderBase`) records the ladder rung of the current assignee so a
  later escalation starts from there.
- Demo control **“Out of office (demo)”** in the role strip and `POST /api/demo/out-of-office`
  (DEMO_MODE only); `/api/me` now returns `outOfOffice`.
- Seed absences relative to *today*: Priya Rao (u3, HR lead) and the whole IT software
  ladder (u21 lead, u23 IT head, u20 service owner) away today; Kavya Nair (u8, L&D
  coordinator) away tomorrow.

### Fix 2 — SLA versioning
- `sla_versions` table (`SlaVersionEntity`) storing `tables`, `category_overrides`,
  `ladder_pct`, `effective_from`, `set_by`, `note`.
- `tickets.sla_ver` binds each ticket to the SLA version in force when it was raised.
- `ConfigService.slaFor()/ladder()` are version-aware; `slaVersions()`, `slaVersion(id)`,
  `currentVersionId()` added.
- Admin console SLA tab: one explanatory note and a compact **Version history** table
  (version, effective from, changed by, change, open tickets on that version).

### Fix 4 — assignee performance report
- `tickets.esc_log` (`escLog`) records every escalation (`level`, `at`, `from`, `to`,
  `how: auto | manual`, `by`).
- `AdminService.performance()` + `GET /api/admin/performance?hd=&range=&q=` and the
  `PerfRow` shape (per-assignee buckets, averages, compliance %, handled `keys`).
- Admin console tab **Assignee performance**: helpdesk scope, 7/30/90/This year range,
  name search, KPI cards, sortable table, per-bucket drill-down that opens tickets,
  compliance bars with a “Show data” table, **Unassigned (queues)** row, **Unattended**
  list, Export CSV, empty/loading/error states, reconciliation line.

### Tests
- `backend/src/domain/availability.spec.ts` (new).
- `frontend/e2e/fixes.spec.ts` (new): Fix 3 (no priority field), Fix 2 (note + version
  history, new version on save), Fix 4 (report renders), Fix 1 (out-of-office toggle,
  absent lead covered).

---

## Changed (old → new)

### Fix 1
- Routing to an absent lead/owner: **was** assign the lead anyway → **now** assign the next
  available, eligible person in ladder order, or keep the lead and flag **Unattended** when
  nobody is available.
- Event text: **was** an “Escalated”/assignment event → **now** a neutral
  `assign` event (“Reassigned to <name> (assignee unavailable)”, or “No cover available,
  kept with the category lead <name>”).
- Notification to the covering person appends “(covering for <name>)”; the absent person is
  not notified; when there is no cover the HD admins are notified.
- Eligibility uses the existing `canWork()` (L&D L3 = HR head u13 stays ineligible; the
  restricted GRV/SEC ladders are never widened). Queues are never changed.

### Fix 2
- Admin SLA edits: **was** overwrite the live values → **now** append a new immutable
  version; older versions stay readable. Saving shows “tickets raised from now (SLA vN)”.
- Every SLA calculation (creation, reopen, priority change, category change, approval
  completion, escalation pct snapshot, analytics) reads the ticket’s bound version.
- Seed tickets stay on v1; their `respDue`/`resDue` are **not** recomputed.

### Fix 3
- Raise drawer: **was** a Priority control (dropdown / info note) for all five helpdesks →
  **now** no priority control; an informational note still explains how priority is chosen.
- The AI panel: **was** a Priority chip/count → **now** excluded from chips, count and
  highlights. Priority is still assigned internally (HR/IT/Admin category default; Admin
  urgency mapping; AI voice may raise it; SF default Medium; L&D Medium, High within two
  days, Critical same day) and stays visible in tables, filters, detail, the agent priority
  selector, analytics and history.
- Copy edits: L&D FAQ #7 (“Mark it **High**…” → “Priority is set automatically (High if the
  session is within two days).”); Admin Desk urgency hint (“Sets the suggested priority.” →
  “Sets the priority for this request automatically.”); Admin console **Core fields** chips
  and the raise-form preview no longer list “Priority”.

### Fix 4
- Admin console gained the **Assignee performance** tab (helpdesk admins only; Salesforce
  rows only when the admin can see SF).

---

## Unchanged (verified)
- 28 people/queues, 46 seed tickets, 50 FAQs, 25 notifications; all ticket keys and due
  dates; SLA/analytics numbers; the 6 dashboard cards; statuses; reopen rules; approvals;
  Salesforce entitlements and visibility; RBAC; the AI mic and rules engine output (it still
  returns `f.pri`, only the UI hides it); design tokens and components.

---

## Acceptance tests (evidence)

| ID | Scenario | Result | Evidence |
|----|----------|--------|----------|
| A1 | Absent lead → next available eligible person | Pass | Raise HR Leave → routed to Anil Gupta (u9); `asgHist=[{how:'absence',coverFor:'u3'}]`, `escalationLevel=0`, `ladderBase=1`; event “Reassigned to Anil Gupta (assignee unavailable)”. e2e `Fix 1 · absent lead is covered…`. |
| A2 | Ineligible rung skipped (L&D L3 = HR head) | Pass | `canWorkPerson()` reuse of `canWork()`; GRV/SEC restricted ladders untouched (unit + code review). |
| A3 | No cover at all → keep lead + notify HD admin + Unattended | Pass | Raise IT Software (u21+u23+u20 all away) → kept with u21, event “No cover available, kept with the category lead Nikhil Rane”; `escalationLevel=0`; HD admin notified. |
| A4 | `esc`/escalationLevel stays 0 on absence routing | Pass | A1/A3 show `escalationLevel=0`. |
| A5 | Queues are not reassigned | Pass | IT HW (queue category) still routes to the IT Service Desk queue. |
| A6 | Covering notification wording “(covering for …)” | Pass | `notify([asg], 'New ticket … assigned to you (covering for <name>)')`. |
| A7 | Absent person not notified / no penalty | Pass | Notification targets the cover only. |
| A8 | Demo “Out of office (demo)” toggles availability | Pass | e2e `Fix 1 · out-of-office demo toggle`; `/api/me` `outOfOffice` flips. |
| B1 | Admin SLA change appends a version, old tickets unchanged | Pass | Medium resolution 72→80 ⇒ v2 created; v1 keeps 35 open tickets, v2 has 0; toast “(SLA v2)”. e2e `Fix 2 · changing an SLA target…`. |
| B2 | Version history + note visible; calc reads bound version | Pass | e2e `Fix 2 · SLA tab shows…`; ticket-create binds `slaVer`. |
| C1 | Priority hidden in the raise form for all helpdesks | Pass | e2e `Fix 3 · raise form has no priority field`; AI panel excludes `pri`. |
| D1 | Assignee performance report renders and reconciles | Pass | e2e `Fix 4 · assignee performance report`; API: 8 rows, 6 cards, Unassigned keys, `reconciliation {handled:36, unassigned:7, total:43}`. |
| E1 | Regression — 18 e2e flows | Pass | `npx playwright test` → 18 passed. |
| E2 | Regression — unit tests | Pass | backend `npx jest --forceExit` → 80 passed; frontend `vitest run` → 12 passed. |
| E3 | Build + lint clean | Pass | backend & frontend `npm run build` and `npm run lint` clean. |

---

## Assumptions (TC) and hook points
- **Attendance cut-off** is 11:00 IST (`ATTENDANCE_CUTOFF_HOUR_IST`). **TC** — confirm the
  time. Hook: `backend/src/domain/availability.ts`.
- Only **Approved full-day leave** or **Absent after the cut-off** make a person unavailable;
  weekly offs, holidays, WFH, half-day, pending and rejected leave do **not**. **TC**.
- The **Unattended** fallback (keep the lead, notify HD admins, flag it in the report) is an
  added safeguard. **TC** — confirm the escalation owner.
- **Cover routing never changes a queue-routed ticket.** **TC**.
- **60 s coalescing** of same-cell SLA edits is only allowed when no ticket has been raised
  under the newest version. **TC**.
- Redirecting SLA/escalation notifications for an out-of-office owner is **off** by default.
  **TC**.
- Performance “compliance %” counts **resolved** tickets only. **TC**.

---

## SDD sections to update
- §4.1 Shell (role strip: “Out of office (demo)” control).
- §4.5 Raise drawer (no priority control; revised notes).
- §4.9 Admin console (SLA note + Version history; new “Assignee performance” tab).
- §5.1 Raise a ticket and §5.2 Routing and assignment (absence cover, `ladderBase`).
- §5.5 SLA and escalation (versioning; `slaVer`, `ladderBase`, `escLog`).
- §5.10 Notifications (covering-for wording; HD-admin fallback).
- §6.4 Priorities and SLA targets (versioned; no longer edited in the raise form).
- §6.5 Escalation ladders (ladder-base offset).
- §8.3 Backend / §9 Data model (new tables/columns) and §10 REST API
  (`GET /admin/performance`, `POST /demo/out-of-office`, `/me` `outOfOffice`).
