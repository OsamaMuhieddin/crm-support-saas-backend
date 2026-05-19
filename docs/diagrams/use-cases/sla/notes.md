# SLA Use Case Diagram Notes

## Scope

This diagram covers implemented SLA configuration and ticket SLA runtime behavior for Masar - CRM Support SaaS. It includes business-hours definitions, SLA policy management, workspace default policy selection, mailbox policy overrides, ticket SLA snapshotting, first-response tracking, resolution tracking, and SLA summary/status reads.

The rendered diagram intentionally groups detailed calculations under runtime use cases. Individual minute calculations, business-window traversal, and derived status fields are documented here rather than shown as many small use case ovals.

## Actors Included

- Workspace Member: abstract actor for authenticated active workspace members who can view SLA configuration, summary, and ticket SLA status.
- Workspace Manager (Owner/Admin): abstract actor for owner/admin roles that can manage business hours, policies, defaults, policy deactivation effects, and mailbox SLA overrides.
- Agent: included because agents create/update/respond to tickets and trigger SLA runtime changes, but cannot mutate SLA configuration.
- Viewer: included through Workspace Member read behavior; viewers can read status/configuration where the API permits workspace member reads.

## Actors Intentionally Excluded

- System / Scheduler: excluded because the inspected implementation applies/derives SLA state from ticket events and summary reads. No implemented SLA cron/scheduler actor or background SLA job route was found.
- Email Provider: excluded because SLA behavior is independent from email delivery.
- Mailbox management actor: excluded as a separate actor; mailbox SLA override is an owner/admin configuration action represented by Workspace Manager.
- Infrastructure actors such as MongoDB, Mongoose, Express, JWT, Redis, queues, cron libraries, and internal workers are implementation details.

## Use Cases Included

- View SLA Configuration: list/detail/options reads for business hours and policies.
- View SLA Summary: workspace summary with setup counts, mailbox override counts, and runtime SLA counts.
- Manage Business Hours: create/update business-hours definitions.
- Manage SLA Policies: create/update/activate/deactivate policies.
- Set Workspace Default SLA Policy: make an active policy the workspace default.
- Assign Mailbox SLA Override: configure `mailbox.slaPolicyId` through mailbox update behavior.
- Handle SLA Policy Deactivation Effects: deactivate policy and clear or replace workspace default/mailbox override references.
- Apply SLA Policy to Ticket: snapshot effective SLA during ticket creation.
- Calculate First Response Target: calculate first-response target/due date from policy rules and business hours.
- Calculate Resolution Target: calculate resolution target/due date from policy rules and business hours.
- Track First Response SLA: first public reply satisfies first-response SLA and can mark breach if late.
- Track Resolution SLA: status changes pause, resume, resolve, breach, and reopen resolution timing.
- Recalculate SLA on Allowed Ticket Changes: priority or mailbox changes before messages exist recalculate the snapshot.
- View Ticket SLA Status: ticket detail/list/summary expose derived SLA statuses such as pending, met, running, paused, breached, and not applicable.

## CRUD Grouping Decisions

- Business-hours list/detail/options/search and create/update are grouped under `View SLA Configuration` and `Manage Business Hours`.
- SLA policy list/detail/options/search and create/update/activate/deactivate are grouped under `View SLA Configuration` and `Manage SLA Policies`.
- Set-default, mailbox override, and deactivation effects stay visible because they affect runtime selection and are important project scope.
- Low-level business-time functions such as add business minutes, calculate business minutes between dates, and timezone conversion are not separate use cases.

## Business Hours and SLA Policy Rules

- Business hours are workspace-scoped.
- Business hours require an IANA timezone and a valid weekly schedule.
- Open days require valid time windows.
- SLA policies are workspace-scoped and reference same-workspace business hours.
- Policy rules are keyed by ticket priority.
- Active rule fields are first response minutes and resolution minutes.
- `nextResponseMinutes` exists in schema/model history but is normalized to null and not active v1 behavior.
- Agent/viewer roles can read active policies; owner/admin roles can include inactive policies.
- SLA configuration writes are owner/admin only and are subject to billing-plan SLA permission checks.

## Workspace Default and Mailbox Override Behavior

- Workspace default policy is canonical through `workspace.defaultSlaPolicyId`.
- Setting a default policy requires an active same-workspace policy.
- Default flags are synchronized with the workspace pointer.
- Mailbox override selection is stored on `mailbox.slaPolicyId`.
- Ticket SLA selection order is mailbox override, then workspace default, then no SLA.
- Policy deactivation clears mailbox overrides pointing to the deactivated policy.
- Policy deactivation can clear or replace the workspace default policy depending on the provided replacement.

## Ticket SLA Runtime Behavior

- Ticket creation snapshots the effective SLA policy, policy source, business-hours snapshot, first response target, and resolution target.
- If no effective policy exists or SLA is disabled for the workspace plan, ticket SLA status is not applicable.
- Ticket create/update request bodies do not accept direct SLA fields.
- Allowed priority or mailbox changes before messages exist recalculate the SLA snapshot.
- Mailbox changes also keep ticket/conversation mailbox state synchronized before message creation.
- SLA is derived from stored ticket SLA snapshot fields rather than hidden writes during reads.

## First Response and Resolution Semantics

- First response is satisfied only by the first `public_reply`.
- Internal notes do not satisfy first response.
- Customer messages do not satisfy first response.
- First response can be breached when a public reply arrives after the first-response due date or when a pending response is past due.
- Resolution is active for `new`, `open`, and `pending`.
- Resolution pauses on `waiting_on_customer`.
- Resolution resumes when the ticket returns to active statuses.
- Resolution is satisfied by `solved`.
- `closed` is downstream lifecycle after solution and keeps the resolved marker.
- Reopen clears resolved state and resumes from remaining business time.
- Reopen increments the SLA reopen count.

## Files, Routes, Docs, and Tests Inspected

- `src/modules/sla/routes/sla.routes.js`
- `src/modules/sla/controllers/sla.controller.js`
- `src/modules/sla/services/sla.service.js`
- `src/modules/sla/services/sla-ticket-runtime.service.js`
- `src/modules/sla/services/sla-reference.service.js`
- `src/modules/sla/models/business-hours.model.js`
- `src/modules/sla/models/sla-policy.model.js`
- `src/modules/sla/docs/openapi.js`
- `src/modules/sla/utils/business-hours.helpers.js`
- `src/modules/sla/utils/business-time.helpers.js`
- `src/modules/sla/utils/sla-policy.helpers.js`
- `src/modules/sla/validators/sla.validators.js`
- `src/modules/mailboxes/services/mailboxes.service.js`
- `src/modules/tickets/services/tickets.service.js`
- `src/modules/tickets/services/ticket-messages.service.js`
- `src/modules/tickets/services/ticket-reference.service.js`
- `src/modules/tickets/schemas/ticket-sla.schema.js`
- `docs/api.md`
- `tests/sla.test.js`
- `tests/sla.business-time.test.js`
- `tests/sla.helpers.test.js`
- `tests/ticket-sla.runtime.test.js`
- `tests/ticket-messages.test.js`
- `tests/ticket-operations.test.js`

## Omitted, Placeholder, or Uncertain Areas

- SLA reminders, notifications, escalation workflows, cycle-history, and scheduled breach workers are omitted because no implemented route/service/test surface justifies them.
- Holidays are present in the business-hours model, but the inspected active helper/runtime behavior is based on weekly schedules and timezone windows; holiday behavior is not shown as a distinct use case.
- Next-response SLA is omitted because v1 helper logic treats `nextResponseMinutes` as inactive/null.
- SLA billing-plan enforcement is documented as a rule, not shown as a separate external billing-provider use case.

## Styling and Export Notes

- PlantUML source is the canonical editable artifact.
- PNG, PDF, SVG, and XMI are generated artifacts and ignored by git for this folder.
- The rendered PNG/PDF/SVG use the same manual landscape style as the accepted diagrams: plain stick actors, white ovals, light-gray associations, no note boxes, and the boundary title `Masar - CRM Support SaaS`.
- XMI is best-effort UML metadata for import tools. It captures actors, use cases, associations, and include/extend/generalization relationships, but layout fidelity is best preserved in the PlantUML source and rendered exports.
