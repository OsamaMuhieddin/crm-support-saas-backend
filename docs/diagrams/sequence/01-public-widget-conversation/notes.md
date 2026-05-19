# Public Widget Conversation, Optional Attachment, and Ticket Creation

## Purpose

This sequence diagram documents the implemented public widget flow from public bootstrap through browser-session initialization, optional public attachment upload, customer message submission, contact identity resolution, ticket creation or reuse, message persistence, attachment linking, session synchronization, and realtime event publication.

The diagram is intentionally compact. It shows the app-level sequence without expanding every helper call, projection, save, model lookup, middleware detail, or error branch. Only the product-significant ticket branch is shown in the diagram: append to an eligible existing ticket versus create a new widget ticket. Detailed error paths are documented below instead of drawn in the diagram.

## Implementation Status

Implemented.

## Source Files Inspected

- `src/modules/widget/routes/widget.routes.js`
- `src/modules/widget/controllers/widget-public.controller.js`
- `src/modules/widget/controllers/widget.controller.js`
- `src/modules/widget/services/widget-public.service.js`
- `src/modules/widget/services/widget.service.js`
- `src/modules/widget/services/widget-realtime.service.js`
- `src/modules/widget/services/widget-live-events.service.js`
- `src/modules/widget/services/widget-session-view.service.js`
- `src/modules/widget/models/widget.model.js`
- `src/modules/widget/models/widget-session.model.js`
- `src/modules/widget/validators/widget.validators.js`
- `src/modules/files/services/files.service.js`
- `src/modules/files/models/file.model.js`
- `src/modules/files/models/file-link.model.js`
- `src/modules/billing/services/billing-enforcement.service.js`
- `src/infra/storage`
- `src/modules/customers/models/contact.model.js`
- `src/modules/customers/models/contact-identity.model.js`
- `src/modules/tickets/services/tickets.service.js`
- `src/modules/tickets/services/ticket-messages.service.js`
- `src/modules/tickets/services/ticket-live-events.service.js`
- `src/modules/tickets/models/ticket.model.js`
- `src/modules/tickets/models/conversation.model.js`
- `src/modules/tickets/models/message.model.js`
- `tests/widgets.test.js`
- `tests/files.test.js`
- `tests/widget.realtime.test.js`
- `docs/api.md`

Note: the requested `src/modules/widget/validators/widget-public.validators.js` file does not exist in this repo. The implemented public widget validators are exported from `src/modules/widget/validators/widget.validators.js`.

## Participants Included

- Widget Visitor
- Widget UI
- Routes + Validation
- WidgetPublicController
- WidgetPublicService
- FileService
- Domain Models: Widget, Mailbox, WidgetSession, File, FileLink, Contact, ContactIdentity, Ticket, Conversation, Message
- TicketService
- MessageService
- RealtimePublisher

## Participants Intentionally Excluded

- MongoDB, Mongoose internals, and database drivers are not shown as actors.
- Socket.IO internals are not shown; `RealtimePublisher` represents the implemented app-level live-event publisher.
- Stripe and external providers are excluded because this public widget conversation flow does not call them directly.
- Internal widget admin controllers are excluded because this diagram covers the public visitor path only.
- Individual model lanes are grouped into `Domain Models` because the full model-by-model version was too large to read comfortably.
- Upload middleware and validator are grouped into `Routes + Validation`; the exact multer and validation behavior is documented in the source inspection and error-path notes.

## Main Success Path

1. Visitor opens the widget UI.
2. UI requests `GET /api/widgets/public/:publicKey/bootstrap`.
3. Backend validates the public key, loads an active widget, verifies the widget mailbox is active, and returns safe bootstrap plus realtime metadata.
4. UI requests `POST /api/widgets/public/:publicKey/session`.
5. Backend resumes an active `wgs_*` browser session by token hash or creates a new `WidgetSession` with a new opaque token.
6. Optionally, UI uploads one file through `POST /api/widgets/public/:publicKey/files`.
7. Upload middleware parses the file in memory, validation checks `sessionToken`, `WidgetPublicService` validates the session, `FileService` enforces billing upload/storage limits, stores the object, and creates ready `File` metadata with `source=widget` and widget/session metadata.
8. UI sends a message through `POST /api/widgets/public/:publicKey/messages`.
9. Backend validates the body, verifies the widget and session, and checks optional attachments are ready, same workspace, same widget, same widget session, `source=widget`, and not already linked to a message.
10. Backend resolves the contact from the session, email identity, contact email, or creates a fallback contact.
11. Backend ensures an email contact identity when an email is present.
12. Backend reuses the current eligible non-closed same-mailbox session ticket, or creates a new `channel=widget` ticket with an initial `customer_message`.
13. `MessageService` persists the customer message, links attachments to both the message and ticket, updates ticket/conversation counters, and publishes realtime events where enabled.
14. Backend syncs session pointers and returns the latest public session, conversation, message, and realtime metadata.

## Important Alternate And Error Paths

- Bootstrap returns `404 errors.widget.notFound` when the public key is unknown, widget is inactive/deleted, or the widget mailbox is inactive/missing.
- Session initialization starts a fresh session when the optional supplied token is unknown or stale; it does not leak whether the old token existed.
- File upload returns validation errors as `422 errors.validation.failed`.
- File upload returns `404 errors.widget.sessionNotFound` when the public session token does not resolve to the active widget session.
- File upload can return billing limit errors such as `errors.billing.storageLimitExceeded` or `errors.billing.uploadLimitExceeded`.
- File upload can return `502 errors.file.uploadFailed` for storage upload failures.
- Message submission returns `422 errors.validation.failed` for invalid body data.
- Message submission returns `404 errors.widget.sessionNotFound` for missing, stale, or wrong-widget sessions.
- Attachment validation rejects files that are missing, not ready, not uploaded by the same widget session, or already linked to a message.
- Current non-closed same-mailbox session tickets are reused; otherwise the next customer message creates a new widget ticket.

These alternates are documented here instead of expanded into many `alt` blocks so the diagram remains readable.

## Rendering Command Notes

The source diagram is PlantUML. Rendered PNG, SVG, and PDF files are generated from `public-widget-conversation.puml`.

PDF output must be created without print headers or footers and with enough page padding to avoid clipped edges.

## Remaining Uncertainties

- None for the implemented happy path and listed alternates.
- Realtime delivery is shown at the app-level publisher boundary, not socket room internals, to keep Diagram 01 readable. Socket subscription itself is planned for the dedicated realtime sequence diagram.
- Low-level model calls are grouped because the detailed version was too large and did not improve the flow explanation.
