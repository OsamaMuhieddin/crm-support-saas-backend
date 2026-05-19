# Ticket Messages, Participants & Attachments Use Case Diagram Notes

## Scope

This diagram covers ticket conversation reads, message history, manual/internal message creation, public widget customer messages where they become normal ticket messages, participant metadata, semantic message attachments, and the business-visible realtime events emitted by those flows.

The workflow plan currently lists this subject as Diagram 5, while the creation prompt called it Diagram 4. The folder and file names follow the subject requested by the prompt.

## Actors included

- `Workspace Member`: abstract actor for every authenticated active member in the active workspace. It owns conversation/message/participant reads, message attachment reads, and internal realtime ticket updates.
- `Operational Member (Owner/Admin/Agent)`: abstract actor for roles allowed to add ticket messages, upload internal attachment files, and manage ticket participants.
- `Viewer`: concrete read-only workspace role. Viewers can read conversations, messages, attachments, and participants, but cannot create messages, upload files, or manage participants.
- `Customer / Widget Visitor`: included because implemented public widget message behavior creates normal `customer_message` ticket messages, supports visitor-uploaded attachments, and emits widget-safe message/conversation events.

## Actors intentionally excluded

- File service, storage provider, MinIO, local storage adapter, MongoDB, Redis, queues, Express, Mongoose, JWT libraries, Socket.IO internals, and internal workers are infrastructure and are not modeled as actors.
- `System / Realtime Event Publisher` is not drawn as an actor because the publisher is an internal service-layer side effect. The business-visible result is modeled as receive/update use cases for workspace members and widget visitors.
- Individual owner/admin/agent actors are grouped as `Operational Member (Owner/Admin/Agent)` because the inspected message and participant write routes grant the same role set.
- Ticket assignees and requesters are not separate actors because participant rows are not inferred from assignment, requester, or authorship.
- Email providers are excluded because inspected ticket-message and participant flows do not send email.

## Use cases included

- `View Ticket Conversation`: returns the one conversation summary linked to the ticket.
- `List Ticket Messages`: paginated, sortable, filterable message history for the ticket conversation.
- `Add Ticket Message`: role-protected message creation umbrella for operational members.
- `Add Public Reply`: outbound public reply variant; it sets ticket status to `waiting_on_customer` and satisfies first response SLA behavior.
- `Add Internal Note`: internal-only message variant; it does not change ticket status and is the only message type allowed on closed tickets.
- `Add Customer Message`: inbound customer-message variant; it sets or reopens ticket status to `open`.
- `Send Widget Customer Message`: public widget visitor flow that creates or appends a normal ticket `customer_message`.
- `Use Message Attachments`: optional attachment behavior on message creation.
- `Upload File for Attachment`: upload-before-link behavior for internal files and public widget visitor files.
- `Attach Uploaded Files to Message`: semantic file-link ownership for message attachments.
- `Link Attachment to Root Ticket`: reverse-lookup file link from the same uploaded file to the root ticket.
- `View/Download Message Attachments`: reading lightweight file summaries from message history and using the stable backend download route.
- `Manage Ticket Participants`: grouped operational participant management.
- `View Participants`: list active participant metadata.
- `Add/Update Participant`: upsert a `watcher` or `collaborator` participant.
- `Remove Participant`: soft-remove an active participant.
- `Receive Message & Conversation Updates`: internal realtime `message.created` and `conversation.updated` effects.
- `Receive Participant Change Updates`: internal realtime `ticket.participant_changed` and affected-user notice effects.
- `Receive Widget Conversation Updates`: widget-safe `widget.message.created` and `widget.conversation.updated` effects.

## Grouping decisions

- Participant CRUD is grouped under `Manage Ticket Participants`, but list, add/update, and remove remain visible because the implemented behavior includes upsert semantics, soft removal, counters, and realtime notices.
- Attachment behavior is shown at the semantic ticket-message level. Storage-provider operations are intentionally hidden, while upload-before-link and message/ticket file-link ownership remain visible.
- Realtime appears only as business-visible message/conversation/participant update use cases. Socket authentication, room names, transport acks, presence, typing, and soft-claim behavior are left for the Realtime Collaboration diagram.
- Ticket lifecycle and assignment use cases stay out of this diagram except for message status side effects documented below.
- Public widget recovery, bootstrap, session management, and widget admin configuration are not expanded here; only widget message creation and attachment behavior are included because they write normal ticket messages.

## Code/test-backed rules

- All internal ticket message and participant routes require authentication, active user, and active workspace membership.
- `GET /api/tickets/:id/conversation`, `GET /api/tickets/:id/messages`, and `GET /api/tickets/:id/participants` are readable by active workspace members, including viewers.
- `POST /api/tickets/:id/messages`, `POST /api/tickets/:id/participants`, and `DELETE /api/tickets/:id/participants/:userId` require `owner|admin|agent`; viewer writes are rejected.
- Manual message creation accepts only `customer_message`, `public_reply`, and `internal_note`.
- Message `bodyText` is required, trimmed, and limited to 50,000 characters. `bodyHtml` is optional nullable text. Unknown message fields are rejected.
- Message list supports `page`, `limit`, `type`, and `sort=createdAt|-createdAt`; default ordering is oldest first.
- Message reads hydrate attachment summaries and created-by summaries while omitting route-redundant internal ids such as workspace, ticket, conversation, mailbox, `attachmentFileIds`, and `createdByUserId`.
- Manual message parties are derived from the linked contact and mailbox: `customer_message` is inbound from contact to mailbox, `public_reply` is outbound from mailbox to contact, and `internal_note` has no parties.
- `customer_message` moves the ticket to `open`; `public_reply` moves it to `waiting_on_customer`; `internal_note` leaves status unchanged.
- Closed tickets reject `customer_message` and `public_reply`; closed tickets still accept `internal_note`.
- Message creation updates ticket and conversation counters, attachment counts, last-message timestamps, message-type summaries, and previews.
- Public replies apply first-response SLA side effects; customer messages resume/reopen resolution behavior through status transition logic.
- Attachment ids are optional, unique, limited to 20, and must resolve to current-workspace, non-deleted files with `storageStatus = ready`.
- A file already attached to a message is rejected with `errors.ticket.attachmentAlreadyLinked`.
- Each message attachment creates a `message` file link as semantic owner and a `ticket` file link for reverse lookup. If message creation persistence fails after links are created, the service unlinks attachments, deletes the message, and rolls back ticket/conversation summaries.
- Internal files are uploaded through `POST /api/files`; upload is restricted to `owner|admin|agent`, while viewers can read/list/download only.
- Public widget files are uploaded through `POST /api/widgets/public/:publicKey/files` and can be attached only by the same widget session that uploaded them.
- Public widget first messages create a normal internal ticket with `channel=widget` and a normal `customer_message`; follow-up widget messages append to the current eligible session ticket.
- Participant rows are internal metadata only, typed as `watcher|collaborator`, and do not grant or revoke access.
- Participants may include viewers if the target user is an active same-workspace member.
- Re-posting the same participant user with a new type updates the active participant instead of creating a duplicate active row.
- Removing a missing participant is idempotent and returns the current ticket participant count.
- Cross-workspace tickets and files collapse to workspace-scoped not-found responses.
- Message creation publishes internal `message.created` and `conversation.updated` events after counters and status are updated.
- Participant add/remove publishes `ticket.participant_changed` and affected-user `user.notice` events; no duplicate realtime event is emitted for no-op duplicate participant save/remove.
- Widget-bound customer or agent public message writes publish widget-safe `widget.message.created` and `widget.conversation.updated` events without exposing internal workspace or actor ids to widget clients.

## Files, routes, docs, and tests inspected

- [diagram-workflow.md](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/docs/diagrams/use-cases/diagram-workflow.md)
- [notes.md](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/docs/diagrams/use-cases/ticket-operations/notes.md)
- [tickets.routes.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/routes/tickets.routes.js)
- [ticket-messages.controller.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/controllers/ticket-messages.controller.js)
- [ticket-participants.controller.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/controllers/ticket-participants.controller.js)
- [ticket-messages.service.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/services/ticket-messages.service.js)
- [ticket-participants.service.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/services/ticket-participants.service.js)
- [ticket-live-events.service.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/services/ticket-live-events.service.js)
- [conversation.model.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/models/conversation.model.js)
- [message.model.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/models/message.model.js)
- [ticket-participant.model.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/models/ticket-participant.model.js)
- [ticket-messages.validators.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/validators/ticket-messages.validators.js)
- [ticket-participants.validators.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/validators/ticket-participants.validators.js)
- [openapi.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/docs/openapi.js)
- [files.routes.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/files/routes/files.routes.js)
- [file-links.service.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/files/services/file-links.service.js)
- [openapi.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/files/docs/openapi.js)
- [ticket-messages.test.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/tests/ticket-messages.test.js)
- [ticket-operations.test.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/tests/ticket-operations.test.js)
- [realtime.business-events.test.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/tests/realtime.business-events.test.js)
- [widgets.test.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/tests/widgets.test.js)
- [widget.realtime.test.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/tests/widget.realtime.test.js)
- [files.test.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/tests/files.test.js)
- [file-links.service.test.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/tests/file-links.service.test.js)
- [api.md](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/docs/api.md)

## Placeholder, uncertain, and intentionally omitted areas

- The diagram does not claim email sending, automated worker behavior, public object URLs, participant-derived permissions, or message deletion/editing because those behaviors are not implemented in the inspected flows.
- Widget public recovery, browser-session lifecycle, widget admin CRUD, and public multi-conversation browsing are left for the Widget & Public Customer Flow diagram.
- Realtime presence, typing, soft-claim, socket subscription mechanics, rooms, reconnect behavior, and transport-level ack/error contracts are left for the Realtime Collaboration diagram.
- Ticket lifecycle, assignment, category, tag, mailbox mutation, and SLA policy management are left for their own diagrams; this notes file only records message-specific status and SLA side effects.
- The public widget visitor is included only for message/attachment behavior that writes normal ticket messages. The broader customer/contact matching flow is left for customer/widget diagrams.

## Export/import limitations

- PlantUML source is the primary editable artifact.
- PNG, PDF, and SVG were rendered in the established diagram style used by the System Context, Auth/Workspace, and Ticket Operations diagrams. They are ignored by `.gitignore`.
- XMI is a best-effort UML exchange artifact created from the same actors and use cases. It does not preserve the rendered layout, and Visual Paradigm may require manual layout cleanup after import.
- Native Visual Paradigm `.vpp` or `.vpdx` export is not available from this repository workflow.
- The rendered diagram contains no note boxes, so there are no note overlaps with any use case. The system boundary title is exactly `Masar - CRM Support SaaS`.
