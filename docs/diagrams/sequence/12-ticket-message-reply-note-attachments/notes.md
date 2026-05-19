# Diagram 12 - Ticket Message, Public Reply, Internal Note, Attachment Linking, and SLA Side Effects

## Purpose and Importance

This diagram documents the protected ticket message write flow. It is agent productivity-critical because message type controls ticket status, SLA side effects, attachment ownership, counters, summaries, and realtime updates.

## Implementation Status

Implemented.

## Source Files Inspected

- `src/app.js`
- `src/routes/index.js`
- `src/modules/tickets/routes/tickets.routes.js`
- `src/modules/tickets/controllers/ticket-messages.controller.js`
- `src/modules/tickets/services/ticket-messages.service.js`
- `src/modules/tickets/services/tickets.service.js`
- `src/modules/tickets/services/ticket-live-events.service.js`
- `src/modules/tickets/models/ticket.model.js`
- `src/modules/tickets/models/conversation.model.js`
- `src/modules/tickets/models/message.model.js`
- `src/modules/tickets/validators/ticket-messages.validators.js`
- `src/modules/files/models/file.model.js`
- `src/modules/files/models/file-link.model.js`
- `src/modules/files/services/file-links.service.js`
- `src/modules/files/services/files.service.js`
- `src/modules/sla/services/sla-ticket-runtime.service.js`
- `src/infra/realtime`
- `tests/ticket-messages.test.js`
- `tests/file-links.service.test.js`
- `tests/ticket-sla.runtime.test.js`
- `docs/api.md`

## Participants Included

- Agent
- Ticket UI
- Routes + Validation
- Auth + Workspace Guards
- Message Controller
- Ticket Message Service
- Ticket + Conversation Models
- Message Model
- File + Link Services/Models
- SLA Runtime Service
- Live Event Service

## Participants Intentionally Excluded

- MongoDB/Mongoose internals are excluded.
- Outbound email delivery is excluded because this message flow publishes realtime/live events and does not implement outbound email delivery here.
- Widget-specific public message creation is excluded because this diagram covers the protected ticket message endpoint.

## Main Success Path

1. An authorized owner/admin/agent submits `POST /api/tickets/:id/messages`.
2. The route validates `type`, `bodyText`, optional `bodyHtml`, and optional unique `attachmentFileIds`.
3. The service loads the same-workspace ticket and conversation.
4. Closed tickets only accept `internal_note`.
5. Supplied attachments must be ready, same-workspace files that are not already linked as message attachments.
6. The service creates a message record.
7. `public_reply` sets first response SLA when not already satisfied, pauses resolution SLA, and moves the ticket to `waiting_on_customer`.
8. `customer_message` moves the ticket to `open` and resumes paused resolution SLA when applicable.
9. `internal_note` leaves ticket status unchanged.
10. Attachments are linked once to the message and once to the ticket for reverse lookup.
11. Ticket and conversation counters and last-message summaries are updated.
12. Realtime publishes `message.created` and `conversation.updated` after persistence succeeds.

## Important Alternate and Error Paths

- Validation failures return `422` with `errors.validation.failed`.
- Auth, inactive user, inactive member, and role failures return the standard error envelope.
- Missing or cross-workspace ticket/conversation returns ticket not found errors.
- Closed tickets reject `customer_message` and `public_reply` with `errors.ticket.closedMessageNotAllowed`.
- Attachment ids must be ready, same-workspace files; missing, deleted, failed, or foreign files are rejected.
- A file already linked as a message attachment is rejected with `errors.ticket.attachmentAlreadyLinked`.
- If message write or side effects fail, the service deletes the created message, unlinks created file links, and rolls back ticket/conversation summaries where possible.
- Realtime publish is best-effort and logs failures.
- Solved, close, and reopen SLA effects are handled by lifecycle endpoints, not directly in this message diagram.

## Rendering Command Notes

Rendered from PlantUML source to PNG and SVG. PDF is rendered from the SVG through a local HTML wrapper with browser headers and footers disabled.

## Remaining Uncertainties

None.
