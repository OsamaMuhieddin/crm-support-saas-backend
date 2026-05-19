# Diagram 13 - Ticket Assignment, Unassignment, and Self-Assignment

## Purpose and Importance

This diagram documents ticket assignment controls. It is agent productivity-critical because assignment updates ownership, prevents agents from taking tickets assigned to someone else, moves newly assigned `new` tickets to `open`, and publishes assignment notices.

## Implementation Status

Implemented.

## Source Files Inspected

- `src/app.js`
- `src/routes/index.js`
- `src/modules/tickets/routes/tickets.routes.js`
- `src/modules/tickets/controllers/tickets.controller.js`
- `src/modules/tickets/services/tickets.service.js`
- `src/modules/tickets/services/ticket-reference.service.js`
- `src/modules/tickets/services/ticket-live-events.service.js`
- `src/modules/tickets/models/ticket.model.js`
- `src/modules/tickets/validators/tickets.validators.js`
- `src/modules/workspaces/models/workspace-member.model.js`
- `src/modules/users/models/user.model.js`
- `src/shared/middlewares`
- `src/infra/realtime`
- `tests/tickets.core.test.js`
- `docs/api.md`

## Participants Included

- Owner/Admin or Agent
- Ticket UI
- Routes + Validation
- Auth + Workspace Guards
- Ticket Controller
- Ticket Service
- Member/User Reference Models
- Ticket Model
- Live Event Service

## Participants Intentionally Excluded

- MongoDB/Mongoose internals are excluded.
- Queue/routing behavior is excluded because assignment is direct single-assignee behavior.
- Separate role middleware lanes are grouped into `Auth + Workspace Guards` to keep the diagram compact.

## Main Success Path

1. A user submits assign, unassign, or self-assign from the ticket UI.
2. Routes run auth, active-user, active-member, role, id, and body validation.
3. `POST /api/tickets/:id/assign` requires `owner|admin` at the route layer.
4. `POST /api/tickets/:id/unassign` and `POST /api/tickets/:id/self-assign` allow `owner|admin|agent`.
5. The service loads the active-workspace ticket.
6. Assignment resolves the assignee as an active same-workspace member with role `owner|admin|agent` and an active user.
7. Agents can only self-assign and cannot take a ticket assigned to another user.
8. Setting `assigneeId` updates `assignedAt` through the ticket model.
9. Assigning a `new` ticket moves it to `open`.
10. Realtime publishes `ticket.assigned` or `ticket.unassigned` and user notices where applicable.

## Important Alternate and Error Paths

- Validation failures return `422` with `errors.validation.failed`.
- Auth, inactive user, inactive member, and role failures return the standard error envelope.
- Target assignees must be active operational members; viewers cannot be assigned.
- Missing, cross-workspace, or deleted tickets resolve as `errors.ticket.notFound`.
- Invalid assignees resolve as `errors.ticket.assigneeNotFound`.
- Non-elevated users assigning others fail with `errors.ticket.assignOthersNotAllowed`.
- Agent self-assignment fails with `errors.ticket.selfAssignNotAvailable` when the ticket is assigned to someone else.
- Non-elevated unassign fails with `errors.ticket.unassignNotAllowed` when the ticket is assigned to another user.
- Unassign is idempotent when the ticket is already unassigned.
- Realtime publish is best-effort and logs failures.

## Rendering Command Notes

Rendered from PlantUML source to PNG and SVG. PDF is rendered from the SVG through a local HTML wrapper using a large custom landscape page, explicit padding, and `object-fit: contain`.

## Remaining Uncertainties

No dedicated `tests/ticket-assignment.test.js` file exists; assignment coverage was found in `tests/tickets.core.test.js` and API documentation.
