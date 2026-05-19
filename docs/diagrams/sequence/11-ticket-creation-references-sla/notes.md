# Diagram 11 - Ticket Creation With References and SLA Snapshot

## Purpose and Importance

This diagram documents the protected agent ticket creation flow. It is agent productivity-critical and SLA-critical because the service resolves workspace references, assigns a workspace-scoped ticket number, creates the one-to-one conversation, and snapshots SLA state before returning the created ticket.

## Implementation Status

Implemented.

## Source Files Inspected

- `src/app.js`
- `src/routes/index.js`
- `src/modules/tickets/routes/tickets.routes.js`
- `src/modules/tickets/controllers/tickets.controller.js`
- `src/modules/tickets/services/tickets.service.js`
- `src/modules/tickets/services/ticket-reference.service.js`
- `src/modules/tickets/services/ticket-query.service.js`
- `src/modules/tickets/services/ticket-live-events.service.js`
- `src/modules/tickets/models/ticket.model.js`
- `src/modules/tickets/models/conversation.model.js`
- `src/modules/tickets/models/ticket-counter.model.js`
- `src/modules/tickets/validators/tickets.validators.js`
- `src/modules/mailboxes/models/mailbox.model.js`
- `src/modules/workspaces/models/workspace.model.js`
- `src/modules/customers/models/contact.model.js`
- `src/modules/customers/models/organization.model.js`
- `src/modules/sla/services/sla-ticket-runtime.service.js`
- `src/modules/sla/models/sla-policy.model.js`
- `src/modules/sla/models/business-hours.model.js`
- `src/modules/billing/services/billing-foundation.service.js`
- `src/shared/middlewares`
- `tests/tickets.core.test.js`
- `tests/tickets.foundation.test.js`
- `tests/ticket-sla.runtime.test.js`
- `docs/api.md`

## Participants Included

- Agent
- Ticket UI
- Routes + Validation
- Auth + Workspace Guards
- Ticket Controller
- Ticket Service
- Reference Service
- Reference Models
- SLA Runtime Service
- SLA Models
- Ticket Models
- Message/File Services
- Billing Usage + Live Events

## Participants Intentionally Excluded

- MongoDB/Mongoose internals are excluded.
- Individual model lanes for every reference type are grouped to keep the diagram readable.
- Billing hard-blocking is excluded because ticket creation only increments usage after creation; no hard ticket-count enforcement was found in this flow.

## Main Success Path

1. An authorized owner/admin/agent submits `POST /api/tickets`.
2. Route validation accepts the create payload and rejects unknown fields.
3. The service loads the workspace and resolves the mailbox, using `workspace.defaultMailboxId` when `mailboxId` is omitted.
4. Contact, organization, category, tag, and assignee references are validated as active same-workspace references where applicable.
5. SLA runtime resolves the effective SLA from mailbox override, then workspace default, then no SLA.
6. `TicketCounter.allocateNextNumber` assigns the next workspace-scoped number.
7. The service creates the ticket, creates its conversation, and stores `conversationId` back on the ticket.
8. Optional initial message creation is delegated to the message service with realtime suppressed until the ticket create flow publishes.
9. Ticket usage increment and realtime publish happen after the main write path succeeds.

## Important Alternate and Error Paths

- Validation failures return `422` with `errors.validation.failed`.
- Auth, inactive user, inactive member, and role failures return the standard error envelope.
- Invalid, inactive, or cross-workspace mailbox/contact/organization/category/tag/assignee references fail before ticket creation.
- If `mailboxId` is omitted and no workspace default mailbox is available, ticket creation fails.
- Organization mismatch fails when the contact already belongs to another organization.
- Duplicate tag ids or invalid initial message attachment ids fail validation.
- If ticket/conversation creation fails, the service rolls back the created ticket/conversation records where possible.
- If initial message creation fails, the ticket create flow rolls back the ticket and conversation.
- SLA disabled or missing policy/business-hours falls back to an empty SLA snapshot.
- Ticket usage increment is best-effort and does not fail the create response.
- Realtime publish is best-effort and logs failures.

## Rendering Command Notes

Rendered from PlantUML source to PNG and SVG. PDF is rendered from the SVG through a local HTML wrapper with browser headers and footers disabled.

## Remaining Uncertainties

None.
