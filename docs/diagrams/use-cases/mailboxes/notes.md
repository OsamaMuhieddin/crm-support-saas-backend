# Mailboxes Use Case Diagram Notes

## Scope

This diagram covers implemented mailbox management and mailbox usage for Masar - CRM Support SaaS. Mailboxes are workspace-scoped support-channel dictionaries used by ticket creation, ticket filtering/detail hydration, message parties, widget configuration, and SLA selection.

The rendered diagram intentionally stays compact. Endpoint-level details such as pagination, search parameters, exact filters, compact option payloads, validation fields, and action response shapes are documented here instead of becoming separate use case ovals.

## Actors Included

- Workspace Member: abstract actor for authenticated active workspace members who can view active mailbox data and select mailboxes where allowed by downstream workflows.
- Workspace Manager (Owner/Admin): abstract actor for owner/admin roles that can create, update, activate/deactivate, set default, and configure SLA overrides.
- Agent: included because agents can read/select active mailboxes and create/update tickets that reference an active mailbox, but cannot mutate mailbox configuration.
- Viewer: included because viewers can read active mailboxes but cannot mutate mailbox state.

## Actors Intentionally Excluded

- Email Provider: excluded because the inspected mailbox module configures mailbox records but does not implement provider-facing email send/receive flows as mailbox use cases.
- System / Scheduler: excluded from the rendered diagram. Default mailbox creation/repair exists as service logic and a backfill script, but there is no implemented mailbox scheduler actor or public business workflow.
- Infrastructure actors such as Express, Mongoose, MongoDB, JWT, Redis, queues, storage adapters, and internal workers are implementation details.
- Billing Provider: excluded because mailbox quota enforcement is internal plan enforcement, not a mailbox-domain external interaction.

## Use Cases Included

- View/List Mailboxes: covers list and detail endpoints for workspace mailboxes.
- Search and Select Mailboxes: covers search filters and compact options used by selectors.
- Manage Mailboxes: grouped owner/admin management use case.
- Create Mailbox: creates active email-type mailboxes.
- Update Mailbox: updates mailbox settings such as name, email fields, signatures, and optional SLA policy id.
- Activate/Deactivate Mailbox: operationally toggles mailbox availability where business rules allow it.
- Set Default Mailbox: makes one active mailbox the workspace default and aligns `workspace.defaultMailboxId`.
- Configure Mailbox SLA Override: assigns or clears a same-workspace active SLA policy on a mailbox when plan rules allow it.
- Use Default Mailbox for Tickets: ticket creation falls back to the workspace default mailbox when no mailbox id is supplied.
- Use Mailbox in Ticket Creation: ticket creation and early ticket update can reference an active same-workspace mailbox.
- Apply Mailbox SLA Override: ticket SLA snapshot selection uses mailbox override before workspace default.

## CRUD Grouping Decisions

- List, detail, options, search, filtering, sorting, and inactive visibility behavior are grouped under `View/List Mailboxes` and `Search and Select Mailboxes`.
- Create, update, set-default, activate, and deactivate are grouped under `Manage Mailboxes`, with important actions still visible as included use cases.
- Delete/archive is omitted because no v1 mailbox delete endpoint is implemented.
- Default repair/backfill is documented in notes because it is service/script maintenance behavior, not a normal actor-driven use case.

## Important Mailbox Rules Reflected

- All mailbox endpoints require authentication, active user, and active workspace membership.
- Workspace members can read active mailbox data.
- Owner/admin roles can include inactive mailboxes in list/options and can mutate mailbox configuration.
- Agent/viewer roles cannot mutate mailbox state.
- Agent/viewer reads hide inactive mailboxes.
- Mailboxes are workspace-scoped; cross-workspace ids resolve as not found.
- v1 mailbox `type` is constrained to `email`.
- Mailbox email addresses are unique per workspace when present.
- Exactly one default mailbox should exist per workspace.
- `workspace.defaultMailboxId` is kept aligned with the mailbox marked `isDefault`.
- The default mailbox must be active.
- The default mailbox cannot be deactivated.
- The last active mailbox cannot be deactivated.
- Mailbox action endpoints return compact action payloads.
- Active mailbox quota is enforced by billing plan checks for create/activate.

## Ticket and SLA Behavior Reflected

- `mailboxId` is optional on ticket create and falls back to `workspace.defaultMailboxId`.
- Explicit ticket mailbox references must resolve to an active same-workspace mailbox.
- Ticket mailbox changes are allowed only while `messageCount = 0`.
- Ticket and conversation mailbox ids stay synchronized when mailbox changes are allowed.
- Ticket creation and allowed mailbox changes snapshot SLA from `mailbox.slaPolicyId`, then `workspace.defaultSlaPolicyId`, then no SLA.
- Mailbox SLA override assignment requires an active same-workspace SLA policy and billing-plan permission.
- SLA policy deactivation can clear mailbox overrides that point to the deactivated policy. Detailed SLA policy management belongs to the SLA diagram.

## Files, Routes, Docs, and Tests Inspected

- `src/modules/mailboxes/routes/mailboxes.routes.js`
- `src/modules/mailboxes/controllers/mailboxes.controller.js`
- `src/modules/mailboxes/services/mailboxes.service.js`
- `src/modules/mailboxes/models/mailbox.model.js`
- `src/modules/mailboxes/docs/openapi.js`
- `src/modules/mailboxes/validators/mailboxes.validators.js`
- `src/modules/tickets/services/ticket-reference.service.js`
- `src/modules/tickets/services/tickets.service.js`
- `src/modules/tickets/services/ticket-messages.service.js`
- `src/modules/tickets/docs/openapi.js`
- `src/modules/sla/utils/sla-policy.helpers.js`
- `src/modules/sla/services/sla-ticket-runtime.service.js`
- `src/modules/sla/services/sla.service.js`
- `docs/api.md`
- `tests/mailboxes.test.js`
- `tests/tickets.core.test.js`
- `tests/ticket-operations.test.js`
- `tests/ticket-sla.runtime.test.js`
- `tests/sla.test.js`
- `package.json`
- `scripts/backfill-default-mailboxes.js`

## Omitted, Placeholder, or Uncertain Areas

- Delete/archive mailbox behavior is omitted because it is not exposed by v1 routes/docs/tests.
- Mailbox alias behavior is omitted because a `mailbox-alias` model exists, but no implemented route surface was found for alias management in this diagram scope.
- Email ingestion/sending/provider configuration is omitted because mailbox records are used by ticket/message behavior, but no provider-facing mailbox route is implemented here.
- Widget mailbox selection is implemented in widget configuration and belongs to the widget diagram. This diagram only covers mailbox records and their ticket/SLA usage.
- Backfill/default repair is documented but not shown as a rendered actor use case because it is a script/service repair path rather than an external actor flow.

## Styling and Export Notes

- PlantUML source is the canonical editable artifact.
- PNG, PDF, SVG, and XMI are generated artifacts and ignored by git for this folder.
- The rendered PNG/PDF/SVG use the same manual landscape style as the accepted diagrams: plain stick actors, white ovals, light-gray associations, no note boxes, and the boundary title `Masar - CRM Support SaaS`.
- XMI is best-effort UML metadata for import tools. It captures actors, use cases, associations, and include/extend/generalization relationships, but layout fidelity is best preserved in the PlantUML source and rendered exports.
