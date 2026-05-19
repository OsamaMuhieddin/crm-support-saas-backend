# Ticket Operations Use Case Diagram Notes

## Scope

This diagram covers protected, workspace-scoped internal ticket operations for Masar - CRM Support SaaS: ticket creation, list/detail reads, record updates, lifecycle/status actions, assignment, self-assignment, unassignment, and category/tag usage.

It intentionally does not expand ticket message threads, participants, realtime collaboration, public widget flows, or attachment ownership. Those are covered by later diagrams in the use-case plan.

## Actors included

- `Workspace Member`: abstract actor for every authenticated active member in the active workspace. It owns read-oriented ticket use cases and active category/tag selection data.
- `Operational Member (Owner/Admin/Agent)`: abstract actor for roles that can create and mutate tickets.
- `Workspace Manager (Owner/Admin)`: abstract actor for elevated ticket operations, including assigning tickets to any active operational member and managing category/tag dictionaries.
- `Agent`: concrete role actor shown because self-assignment is agent-facing and has stricter behavior than owner/admin assignment.
- `Viewer`: concrete role actor shown as a read-only workspace member.

## Actors intentionally excluded

- `Email Provider`: no business-facing internal ticket email delivery behavior is exposed by the inspected ticket operation routes.
- `Customer / Widget Visitor`: public widget ticket creation and visitor messages are implemented, but they belong to the widget/public flow and ticket messages diagrams, not this internal ticket operations diagram.
- `System / Scheduler`: ticket SLA runtime behavior exists, but detailed SLA automation belongs to the SLA diagram. This diagram only notes status/lifecycle touchpoints where they affect ticket operations.
- Concrete `Workspace Owner` and `Workspace Admin` actors are not drawn separately in the revised visual because `Workspace Manager (Owner/Admin)` already represents their shared ticket-operation capabilities and avoids a crowded role-inheritance tree.
- Infrastructure actors such as MongoDB, Redis, queues, MinIO, Express, Mongoose, JWT libraries, storage adapters, and internal workers are intentionally omitted.

## Use cases included

- `Manage Tickets`: grouping use case for operational ticket workflows.
- `Create Ticket`: creates a workspace-scoped ticket, allocates a workspace-scoped number, defaults the mailbox when omitted, validates references, and creates the linked conversation.
- `View/List Tickets`: list and detail reads in the active workspace, including search/filter support.
- `Update Ticket`: edits subject, priority, category, tags, and mailbox when allowed.
- `Change Ticket Status`: explicit status action for `open`, `pending`, `waiting_on_customer`, and `solved`.
- `Solve Ticket`, `Close Ticket`, `Reopen Ticket`: separate lifecycle actions because their transition rules and SLA side effects are meaningful.
- `Assign Ticket`, `Self-Assign Ticket`, `Unassign Ticket`: separate assignment use cases because owner/admin assignment and agent self-assignment have different rules.
- `Use Ticket Category`, `Use Ticket Tags`: category/tag references are visible on create, update, list filters, and detail hydration.
- `Manage Ticket Categories`, `Manage Ticket Tags`: grouped dictionary management for owner/admin because CRUD details would crowd the operations diagram.

## Grouping decisions

- Category/tag CRUD is grouped because the main diagram subject is ticket operations. The diagram still keeps category/tag usage visible where it affects create, update, and list/detail workflows.
- Actor associations were simplified to follow the existing System Context and Auth/Workspace visual pattern: abstract actors carry shared access, while specialized assignment and dictionary capabilities remain visible through separate use cases.
- Actor generalization connectors are shown only where they clarify role scope: manager and agent specialize operational member, while operational member and viewer specialize workspace member.
- Dense internal `include`/`extend` connectors are intentionally omitted because they would visually cross central use case ovals. The same workflows remain visible as first-class use cases with actor associations, and the precise lifecycle/assignment rules are documented below.
- Inline notes were removed from the rendered diagram to prevent crowded note boxes and line crossings over use case ovals. The code-backed rules remain documented in this notes file.
- Ticket message creation, participants, conversation detail, and attachment ownership are not expanded. Ticket creation can accept a minimal `initialMessage`, but that is treated as a boundary to the next ticket messages/attachments diagram.
- SLA effects are documented in notes but not modeled as an external actor or runtime use case here.

## Code/test-backed ticket operation rules

- All ticket routes use authenticated active-user and active-member middleware, so ticket reads and writes run in the current workspace context.
- `POST /api/tickets` is limited to owner, admin, and agent roles. Viewer create is rejected.
- Ticket list and detail are readable by active workspace members, including viewers.
- Ticket numbers are allocated per workspace through `TicketCounter`.
- Ticket creation creates exactly one linked conversation and stores `conversationId` on the ticket.
- `mailboxId` defaults from `workspace.defaultMailboxId` when omitted and must resolve to an active same-workspace mailbox when supplied.
- Ticket writes validate same-workspace contact, organization, assignee, category, and tag references.
- Category/tag references used in writes must be active. Ticket detail can still hydrate already-linked inactive category/tag references for historical readability.
- `PATCH /api/tickets/:id` allows only `subject`, `priority`, `categoryId`, `tagIds`, and `mailboxId`.
- Mailbox changes are allowed only while `messageCount = 0`, and ticket/conversation mailbox values must stay in sync.
- Ticket lists exclude closed tickets by default unless `includeClosed=true` or an explicit status filter is supplied.
- Owner/admin can assign any active operational member. Viewer users are not valid assignees.
- Agents use self-assignment behavior and cannot take a ticket assigned to another user.
- Unassignment is idempotent when a ticket is already unassigned. Owner/admin can unassign any ticket; agents can unassign tickets assigned to themselves.
- Assigning a `new` ticket moves it to `open`.
- Explicit status transitions are constrained. Closed tickets cannot be transitioned through the generic status or solve paths.
- `close` is allowed only from `solved` or already `closed`.
- `reopen` is allowed from `solved` or `closed` and returns the ticket to `open`.
- `solve` is the resolution-SLA success point; closing preserves the resolved marker.
- Create-time attachments and message attachments must be uploaded through `/api/files` first, then referenced by file id. Detailed ownership/linking behavior is left to the ticket messages/attachments diagram.

## Files inspected

- [diagram-workflow.md](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/docs/diagrams/use-cases/diagram-workflow.md)
- [tickets.routes.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/routes/tickets.routes.js)
- [tickets.controller.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/controllers/tickets.controller.js)
- [ticket-categories.controller.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/controllers/ticket-categories.controller.js)
- [ticket-tags.controller.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/controllers/ticket-tags.controller.js)
- [ticket-messages.controller.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/controllers/ticket-messages.controller.js)
- [ticket-participants.controller.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/controllers/ticket-participants.controller.js)
- [tickets.service.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/services/tickets.service.js)
- [ticket-query.service.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/services/ticket-query.service.js)
- [ticket-reference.service.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/services/ticket-reference.service.js)
- [ticket-categories.service.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/services/ticket-categories.service.js)
- [ticket-tags.service.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/services/ticket-tags.service.js)
- [ticket-messages.service.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/services/ticket-messages.service.js)
- [ticket.model.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/models/ticket.model.js)
- [conversation.model.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/models/conversation.model.js)
- [ticket-category.model.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/models/ticket-category.model.js)
- [ticket-tag.model.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/models/ticket-tag.model.js)
- [ticket-counter.model.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/models/ticket-counter.model.js)
- [tickets.validators.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/validators/tickets.validators.js)
- [ticket-categories.validators.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/validators/ticket-categories.validators.js)
- [ticket-tags.validators.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/validators/ticket-tags.validators.js)
- [ticket-messages.validators.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/validators/ticket-messages.validators.js)
- [ticket-participants.validators.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/validators/ticket-participants.validators.js)
- [openapi.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/tickets/docs/openapi.js)
- [files.routes.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/files/routes/files.routes.js)
- [files.controller.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/files/controllers/files.controller.js)
- [files.service.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/files/services/files.service.js)
- [file-links.service.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/files/services/file-links.service.js)
- [files.validators.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/files/validators/files.validators.js)
- [openapi.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/files/docs/openapi.js)
- [ticket-operations.test.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/tests/ticket-operations.test.js)
- [tickets.core.test.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/tests/tickets.core.test.js)
- [ticket-dictionaries.test.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/tests/ticket-dictionaries.test.js)
- [ticket-messages.test.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/tests/ticket-messages.test.js)
- [ticket-sla.runtime.test.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/tests/ticket-sla.runtime.test.js)
- [files.test.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/tests/files.test.js)
- [file-links.service.test.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/tests/file-links.service.test.js)
- [api.md](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/docs/api.md)

## Placeholder or uncertain areas

- No placeholder-only ticket operation route was included as a real use case.
- Internal ticket participants are implemented, but intentionally left for the ticket messages, participants, and attachments diagram because the current diagram is focused on ticket record operations.
- Public widget ticket behavior is implemented and creates normal tickets, but it is intentionally left for the widget/public flow diagram.
- Realtime ticket events are implementation-facing support for UI synchronization, not separate ticket operation use cases in this diagram.

## Export/import limitations

- PlantUML source is the primary editable diagram artifact.
- PNG and SVG were generated from PlantUML and are ignored by `.gitignore`.
- Direct PlantUML PDF export failed in this environment because the downloaded PlantUML jar did not include the Batik PDF conversion classes. The PDF was generated from the PlantUML SVG export with headless Microsoft Edge.
- XMI is a best-effort UML exchange artifact created manually from the same use cases and actor relationships. Visual Paradigm import may require cleanup of layout and notes.
- Native Visual Paradigm `.vpp` or `.vpdx` export is not available from this repository workflow.
