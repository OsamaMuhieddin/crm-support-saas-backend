# Diagram 14 - Ticket Solve, Close, Reopen, and SLA Lifecycle Side Effects

## Purpose and Importance

This diagram documents explicit ticket lifecycle actions and their SLA side effects. It is operations-critical because `solved`, `closed`, `reopen`, and generic status changes control when resolution SLA is resolved, paused, resumed, or preserved.

## Implementation Status

Implemented.

## Source Files Inspected

- `src/app.js`
- `src/routes/index.js`
- `src/modules/tickets/routes/tickets.routes.js`
- `src/modules/tickets/controllers/tickets.controller.js`
- `src/modules/tickets/services/tickets.service.js`
- `src/modules/tickets/services/ticket-messages.service.js`
- `src/modules/tickets/services/ticket-live-events.service.js`
- `src/modules/tickets/models/ticket.model.js`
- `src/modules/tickets/models/conversation.model.js`
- `src/modules/tickets/validators/tickets.validators.js`
- `src/modules/sla/services/sla-ticket-runtime.service.js`
- `src/infra/realtime`
- `tests/tickets.core.test.js`
- `tests/ticket-sla.runtime.test.js`
- `tests/ticket-messages.test.js`
- `docs/api.md`

## Participants Included

- Agent
- Ticket UI
- Routes + Validation
- Auth + Workspace Guards
- Ticket Controller
- Ticket Service
- Ticket + Conversation Models
- SLA Runtime Service
- Live Event Service

## Participants Intentionally Excluded

- MongoDB/Mongoose internals are excluded.
- Background SLA breach jobs and escalation behavior are excluded because this flow uses runtime SLA mutation and read-time derivation, not a background lifecycle job.
- Closed-ticket message restrictions are excluded from the diagram because they are covered by Diagram 12.

## Main Success Path

1. An authorized owner/admin/agent submits a lifecycle action.
2. The route validates the ticket id and, for `POST /api/tickets/:id/status`, the requested status.
3. The service loads the active-workspace ticket.
4. Generic status changes use the explicit transition map.
5. `solve` moves the ticket to `solved` and applies resolution SLA completion at the event time.
6. `close` is allowed only from `solved` or already `closed`; closing preserves the prior resolved SLA marker and sets `closedAt`.
7. `reopen` is allowed from `solved` or `closed`; reopening moves the ticket to `open`, clears `resolvedAt`, increments reopen count, and resumes from remaining business time when resolution SLA applies.
8. Generic `waiting_on_customer` status pauses resolution SLA; generic `pending` or `open` resumes active resolution where applicable.
9. Realtime publishes the appropriate status, solved, closed, or reopened event after persistence succeeds.

## Important Alternate and Error Paths

- Validation failures return `422` with `errors.validation.failed`.
- Auth, inactive user, inactive member, and role failures return the standard error envelope.
- Missing, cross-workspace, or deleted tickets resolve as `errors.ticket.notFound`.
- Invalid generic status transitions return `errors.ticket.invalidStatusTransition`.
- Solve disallowed transitions return `errors.ticket.solveNotAllowed`.
- Close is allowed only from `solved` or `closed`; invalid close returns `errors.ticket.closeNotAllowed`.
- Reopen is allowed only from `solved` or `closed`; invalid reopen returns `errors.ticket.reopenNotAllowed`.
- Closing does not become the resolution SLA success point; resolution is judged at `solved`.
- Breach status can still be derived on reads even without hidden writes.
- Realtime publish is best-effort and logs failures.

## Rendering Command Notes

Rendered from PlantUML source to PNG and SVG. PDF is rendered from the SVG through a local HTML wrapper using a large custom landscape page, explicit padding, and `object-fit: contain`.

## Remaining Uncertainties

None.
