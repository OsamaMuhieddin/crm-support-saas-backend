# Diagram 10 - SLA Policy Setup and Ticket Runtime SLA Snapshot

## Purpose and Importance

This diagram documents SLA configuration and ticket runtime snapshot behavior. It is operations-critical because ticket SLA state is determined at ticket write time and remains readable historically even if policies change later.

## Implementation Status

Implemented.

## Source Files Inspected

- `src/modules/sla/routes/sla.routes.js`
- `src/modules/sla/controllers/sla.controller.js`
- `src/modules/sla/services/sla.service.js`
- `src/modules/sla/services/sla-reference.service.js`
- `src/modules/sla/services/sla-ticket-runtime.service.js`
- `src/modules/sla/models/business-hours.model.js`
- `src/modules/sla/models/sla-policy.model.js`
- `src/modules/sla/validators/sla.validators.js`
- `src/modules/tickets/services/tickets.service.js`
- `src/modules/tickets/services/ticket-messages.service.js`
- `src/modules/tickets/models/ticket.model.js`
- `src/modules/tickets/schemas/ticket-sla.schema.js`
- `src/modules/mailboxes/models/mailbox.model.js`
- `src/modules/mailboxes/services/mailboxes.service.js`
- `tests/sla.test.js`
- `tests/sla.business-time.test.js`
- `tests/ticket-sla.runtime.test.js`
- `tests/tickets.core.test.js`
- `docs/api.md`

## Participants Included

- Workspace Owner/Admin
- SLA / Ticket UI
- Routes + Validation
- Auth + Workspace Guards
- SLA Controller/Service
- Billing Enforcement
- SLA Models
- Mailbox + Workspace Models
- Ticket Controller/Service
- Ticket Model

## Participants Intentionally Excluded

- Background SLA jobs are excluded because no SLA breach job/escalation worker is implemented for this flow.
- MongoDB/Mongoose internals are excluded.

## Main Success Path

1. Owner/admin creates business hours and SLA policies.
2. Routes validate business hours timezone/schedule and SLA rules by priority.
3. SLA writes check billing SLA entitlement.
4. Policy is stored with a business-hours reference.
5. Policy can become the workspace default or be assigned as a mailbox override.
6. Ticket creation resolves mailbox and workspace configuration.
7. SLA selection order is mailbox override, then workspace default, then no SLA.
8. Ticket service stores a snapshot with policy name/id, business hours, targets, due dates, and runtime counters.

## Important Alternate and Error Paths

- Validation errors return `422` with `errors.validation.failed`.
- Non-owner/admin members cannot mutate SLA resources.
- Invalid business-hours timezone or weekly schedule fails validation.
- Missing/inactive policy or business-hours references fail before saving.
- SLA writes are blocked by `errors.billing.slaNotIncluded` when the plan does not include SLA.
- If SLA is disabled or no effective policy exists, new tickets keep working with an empty SLA snapshot.
- Ticket priority or mailbox changes before messages exist recalculate the stored SLA snapshot.
- First public reply satisfies first response SLA.
- `waiting_on_customer` pauses resolution; `solved` satisfies resolution; reopen resumes from remaining business time.
- Detail/list derive breach state without hidden writes during reads.

## Rendering Command Notes

Rendered from PlantUML source to PNG and SVG. PDF is rendered from the SVG through a local HTML wrapper with browser headers and footers disabled.

## Remaining Uncertainties

None.
