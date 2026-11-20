# Notification API spec (v0.3.1)

Audience: the team integrating the helpdesk notification feed and email delivery.
Base URL: the deployed helpdesk API (dev `http://localhost:3000`, browser proxy `/api`). All requests use `Authorization: Bearer <token>` from `POST /api/auth/demo-login` (demo) or the existing auth flow.

## Endpoints

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| `GET` | `/api/notifications` | – | `Notification[]`, newest first, max 50 |
| `POST` | `/api/notifications/read-all` | – | `{ "ok": true }` |
| `POST` | `/api/notifications/:id/read` | `id` is numeric | `{ "ok": true }` |
| `GET` | `/api/me` | – | Shell counts include `unreadNotifications` |
| `GET` | `/api/analytics` | – | `updates` = 6 newest `Notification` objects |

`GET /api/notifications` and `GET /api/me` are unchanged in shape; the fields below are additive and nullable so older rows remain valid.

## Notification object

```json
{
  "id": 42,
  "userId": "u9",
  "text": "New ticket HR-000131 assigned to you (covering for Priya Rao)",
  "ticketKey": "HR-000131",
  "createdAt": "2026-11-19T09:12:00.000Z",
  "readAt": null,
  "eventType": "TICKET_CREATED_DIRECT",
  "category": "NOTIFICATION",
  "recipientUserId": "u9",
  "ticketId": "HR-000131",
  "actorUserId": "u1",
  "channel": "in-app+email",
  "dedupeKey": "TICKET_CREATED_DIRECT:HR-000131:u9",
  "payload": { "eventType": "TICKET_CREATED_DIRECT", "ticketKey": "HR-000131", "text": "New ticket HR-000131 assigned to you (covering for Priya Rao)", "actorId": "u1", "coverFor": "(covering for Priya Rao)" },
  "emailStatus": null,
  "emailSentAt": null,
  "error": null
}
```

- `channel` is **`in-app+email`** or **`in-app`** (string values are exact; legacy rows are `null`).
- `recipientUserId` is always a real user id. Queue ids are expanded to active members and are never written here.
- `actorUserId` is `null` for scheduler/reminder events.
- Confidential override: `text` is exactly `Update on <ticketKey> (confidential)`; `payload` is exactly `{ "eventType": ..., "ticketKey": ... }`; the email body uses the same masked text. Titles, comments, file names and people names never appear.
- Absence cover wording is emitted **only to the cover person**; requesters receive a neutral message. Never notify an absent lead or include leave/pending wording.

### Read semantics

`POST /api/notifications/:id/read` only marks a row for the signed-in user (`WHERE id = ? AND user_id = ?`). `POST /api/notifications/read-all` only affects that user's unread rows. Both are idempotent.

## Idempotency

Every emit computes a stable `dedupeKey`:

```
<EVENT_TYPE>:<ticketKey>:<recipientUserId>[:<threshold>]
```

`notifications.dedupe_key` has a unique index. Repeating the same event for the same ticket and recipient within a reminder threshold creates no second row and no second email. Queue recipients each get their own key. Reminders persist `(ticket_key, reminder_type, threshold)` in `notification_reminders` with a unique key, so a threshold fires once per ticket even after a scheduler restart.

## Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | Missing/invalid token |
| `FORBIDDEN` | 403 | Ticket not visible to the signed-in user |
| `NOT_FOUND` | 404 | Unknown notification id or ticket |
| `VALIDATION_ERROR` | 400 | Bad `id` or request body |
| `DUPLICATE_EVENT` | – | Dedupe hit; swallowed internally, no row/email, no API error |

## Email contract

`LocalNotificationGateway` writes the in-app row and an outbox row in the same transaction. Email is a separate adapter (`NotificationService.flushOutbox`, retries up to 5). The `EMAIL_ADAPTER` setting remains an unused placeholder.

- Subject: `[NPSTX Helpdesk] <ticketKey>`
- Body: `<short message>\n\nOpen the ticket in NPSTX Helpdesk to see the details.\n/helpdesk/tickets/<ticketKey>`
- Confidential body: `Update on <ticketKey> (confidential)\n\nOpen the ticket in NPSTX Helpdesk to see the details.\n/helpdesk/tickets/<ticketKey>`

## Event catalogue (one sample payload per type)

All samples use ticket `HR-000131`. `payload` is the JSON column; `text` is the in-app line. Channels are `in-app+email` unless shown otherwise.

| Event type | Recipients | `text` | `payload` |
| --- | --- | --- | --- |
| `TICKET_CREATED_DIRECT` | assignee | New ticket HR-000131 assigned to you (covering for Priya Rao) | `{"eventType":"TICKET_CREATED_DIRECT","ticketKey":"HR-000131","text":"New ticket HR-000131 assigned to you (covering for Priya Rao)","actorId":"u1","coverFor":"(covering for Priya Rao)"}` |
| `TICKET_CREATED_QUEUE` | queue members | New ticket HR-000131 is in your queue | `{"eventType":"TICKET_CREATED_QUEUE","ticketKey":"HR-000131","text":"New ticket HR-000131 is in your queue","actorId":"u1"}` |
| `TICKET_CC_ADDED` | target | You were CC'd on HR-000131 | `{"eventType":"TICKET_CC_ADDED","ticketKey":"HR-000131","text":"You were CC'd on HR-000131","actorId":"u9","targetUserId":"u2"}` |
| `FOLLOWER_ADDED` | target | You were added as a follower on HR-000131 | `{"eventType":"FOLLOWER_ADDED","ticketKey":"HR-000131","text":"You were added as a follower on HR-000131","actorId":"u9","targetUserId":"u2"}` |
| `FOLLOWER_REMOVED` | target | You were removed from HR-000131 | `{"eventType":"FOLLOWER_REMOVED","ticketKey":"HR-000131","text":"You were removed from HR-000131","actorId":"u9","targetUserId":"u2"}` |
| `TICKET_TAGGED` | target | Asha Kulkarni tagged you on HR-000131 | `{"eventType":"TICKET_TAGGED","ticketKey":"HR-000131","text":"Asha Kulkarni tagged you on HR-000131","actorId":"u20","targetUserId":"u9"}` |
| `TICKET_STATUS_CHANGED` | requester + followers | Asha Kulkarni changed HR-000131 to Open | `{"eventType":"TICKET_STATUS_CHANGED","ticketKey":"HR-000131","text":"Asha Kulkarni changed HR-000131 to Open","actorId":"u20"}` |
| `TICKET_PRIORITY_CHANGED` | requester (only when priority is visible) | Priority of HR-000131 changed to High | `{"eventType":"TICKET_PRIORITY_CHANGED","ticketKey":"HR-000131","text":"Priority of HR-000131 changed to High","actorId":"u20"}` |
| `TICKET_REASSIGNED` | new assignee | HR-000131 assigned to you | `{"eventType":"TICKET_REASSIGNED","ticketKey":"HR-000131","text":"HR-000131 assigned to you","actorId":"u20"}` |
| `TICKET_ESCALATED` | new owner, previous owner, requester, followers; HD admins at L2+ | HR-000131 was escalated to Level 2 | `{"eventType":"TICKET_ESCALATED","ticketKey":"HR-000131","text":"HR-000131 escalated to Level 2","actorId":"u20","level":2}` |
| `TICKET_QUEUE_CLAIMED` | requester | Your ticket HR-000131 was picked up by Asha Kulkarni | `{"eventType":"TICKET_QUEUE_CLAIMED","ticketKey":"HR-000131","text":"Your ticket HR-000131 was picked up by Asha Kulkarni","actorId":"u20"}` |
| `TICKET_CLOSED` | requester + followers | HR-000131 closed · Resolved | `{"eventType":"TICKET_CLOSED","ticketKey":"HR-000131","text":"HR-000131 closed · Resolved","actorId":"u9"}` |
| `TICKET_REOPENED` | assignee / cover + category lead | HR-000131 was reopened by Arjun Kumar | `{"eventType":"TICKET_REOPENED","ticketKey":"HR-000131","text":"HR-000131 was reopened by Arjun Kumar","actorId":"u1"}` |
| `TICKET_CANCELLED` | assignee + approvers + followers | HR-000131 was cancelled by the requester | `{"eventType":"TICKET_CANCELLED","ticketKey":"HR-000131","text":"HR-000131 was cancelled by the requester","actorId":"u1"}` |
| `APPROVAL_NEEDED` | current approver | Approval needed: HR-000131 from Arjun Kumar | `{"eventType":"APPROVAL_NEEDED","ticketKey":"HR-000131","text":"Approval needed: HR-000131 from Arjun Kumar","actorId":"u1"}` |
| `APPROVAL_PENDING` | requester | HR-000131: manager approved, now with IT head | `{"eventType":"APPROVAL_PENDING","ticketKey":"HR-000131","text":"HR-000131: manager approved, now with IT head","actorId":"u20"}` |
| `APPROVAL_REJECTED` | requester + previous assignee + followers | HR-000131 was rejected at the manager step | `{"eventType":"APPROVAL_REJECTED","ticketKey":"HR-000131","text":"HR-000131 was rejected at the manager step","actorId":"u20"}` |
| `APPROVAL_APPROVED` | requester + assignee + followers | HR-000131 approved; work has started (covering for Priya Rao) | `{"eventType":"APPROVAL_APPROVED","ticketKey":"HR-000131","text":"HR-000131 approved; work has started (covering for Priya Rao)","actorId":"u20","coverFor":"(covering for Priya Rao)"}` |
| `INTERNAL_NOTE_ADDED` | internal staff only (assignee + staff ids) | Internal note on HR-000131 | `{"eventType":"INTERNAL_NOTE_ADDED","ticketKey":"HR-000131","text":"Internal note on HR-000131","actorId":"u20"}` |
| `PUBLIC_REPLY_ADDED` | requester + assignee + followers | Anil Gupta replied on HR-000131 | `{"eventType":"PUBLIC_REPLY_ADDED","ticketKey":"HR-000131","text":"Anil Gupta replied on HR-000131","actorId":"u9"}` |
| `ATTACHMENT_ADDED` | requester + assignee + followers | Anil Gupta attached a file to HR-000131 | `{"eventType":"ATTACHMENT_ADDED","ticketKey":"HR-000131","text":"Anil Gupta attached a file to HR-000131","actorId":"u9"}` |
| `SLA_RESPONSE_BREACHED` | category lead | HR-000131 missed its first-response target | `{"eventType":"SLA_RESPONSE_BREACHED","ticketKey":"HR-000131","text":"HR-000131 missed its first-response target","actorId":null}` |
| `SLA_RESOLUTION_BREACHED` | requester + assignee + followers | HR-000131 missed its resolution target | `{"eventType":"SLA_RESOLUTION_BREACHED","ticketKey":"HR-000131","text":"HR-000131 missed its resolution target","actorId":null}` |
| `UNATTENDED_NO_COVER` | HD admins | Unattended: HR-000131 has no available cover | `{"eventType":"UNATTENDED_NO_COVER","ticketKey":"HR-000131","text":"Unattended: HR-000131 has no available cover","actorId":"u1"}` |
| `TICKET_AUTO_CLOSED` | requester + assignee + followers | HR-000131 was closed automatically after inactivity | `{"eventType":"TICKET_AUTO_CLOSED","ticketKey":"HR-000131","text":"HR-000131 was closed automatically after inactivity","actorId":null}` |
| `SLA_AT_RISK` | assignee | HR-000131 is at risk of missing its target (due today 18:00) | `{"eventType":"SLA_AT_RISK","ticketKey":"HR-000131","text":"HR-000131 is at risk of missing its target (due today 18:00)","actorId":null,"threshold":"75%"}` |
| `APPROVAL_STUCK` | current approver | HR-000131 has been waiting for approval for 75% | `{"eventType":"APPROVAL_STUCK","ticketKey":"HR-000131","text":"HR-000131 has been waiting for approval for 75%","actorId":null,"threshold":"75%"}` |
| `WAITING_FOR_EMPLOYEE` | assignee + category lead | HR-000131 has been waiting for the requester for 48 hours | `{"eventType":"WAITING_FOR_EMPLOYEE","ticketKey":"HR-000131","text":"HR-000131 has been waiting for the requester for 48 hours","actorId":null,"threshold":"48h"}` |
| `UNATTENDED_REMINDER` | HD admins | Unattended: HR-000131 still has no cover after 4 hours | `{"eventType":"UNATTENDED_REMINDER","ticketKey":"HR-000131","text":"Unattended: HR-000131 still has no cover after 4 hours","actorId":null,"threshold":"4h"}` |

### Confidential variant (any event)

```json
{
  "eventType": "TICKET_CREATED_DIRECT",
  "category": "NOTIFICATION",
  "channel": "in-app+email",
  "text": "Update on HR-000131 (confidential)",
  "payload": { "eventType": "TICKET_CREATED_DIRECT", "ticketKey": "HR-000131" },
  "dedupeKey": "TICKET_CREATED_DIRECT:HR-000131:u9"
}
```

### Absence-cover variant (cover person only)

```json
{
  "eventType": "TICKET_CREATED_DIRECT",
  "text": "New ticket HR-000131 assigned to you (covering for Priya Rao)",
  "payload": { "eventType": "TICKET_CREATED_DIRECT", "ticketKey": "HR-000131", "coverFor": "(covering for Priya Rao)" }
}
```

Requesters for the same ticket receive `New ticket HR-000131 assigned to you` (or another neutral event text) with no `coverFor` field.
