# Diagram 09 - Mailbox Create, Default Mailbox, and SLA Override Setup

## Purpose and Importance

This diagram documents mailbox creation, default mailbox alignment, and optional SLA override assignment. It is admin/operations-critical because tickets depend on a valid mailbox and SLA selection starts from mailbox override before workspace default.

## Implementation Status

Implemented.

## Source Files Inspected

- `src/modules/mailboxes/routes/mailboxes.routes.js`
- `src/modules/mailboxes/controllers/mailboxes.controller.js`
- `src/modules/mailboxes/services/mailboxes.service.js`
- `src/modules/mailboxes/models/mailbox.model.js`
- `src/modules/mailboxes/validators/mailboxes.validators.js`
- `src/modules/workspaces/models/workspace.model.js`
- `src/modules/sla/models/sla-policy.model.js`
- `src/modules/sla/services/sla.service.js`
- `src/modules/sla/services/sla-reference.service.js`
- `src/shared/middlewares/requireAuth.js`
- `src/shared/middlewares/requireActiveUser.js`
- `src/shared/middlewares/requireActiveMember.js`
- `src/shared/middlewares/requireWorkspaceRole.js`
- `tests/mailboxes.test.js`
- `tests/sla.test.js`
- `docs/api.md`

## Participants Included

- Workspace Owner/Admin
- Mailbox UI
- Routes + Validation
- Auth + Workspace Guards
- Mailbox Controller
- Mailbox Service
- Billing Enforcement
- Mailbox Model
- Workspace Model
- SLA Policy Model/Service

## Participants Intentionally Excluded

- Email provider/inbound mailbox integrations are excluded because mailbox v1 is configuration storage, not provider provisioning.
- MongoDB/Mongoose internals are excluded.

## Main Success Path

1. Owner/admin submits mailbox settings.
2. Mailbox route validates body and enforces active workspace membership plus owner/admin role.
3. Mailbox service validates workspace existence and billing mailbox capacity.
4. If `slaPolicyId` is supplied, billing SLA entitlement and same-workspace active policy are checked.
5. Mailbox is created active and non-default.
6. `ensureWorkspaceDefaultMailbox` repairs or creates canonical default state.
7. Default flags and `workspace.defaultMailboxId` are synchronized.

## Important Alternate and Error Paths

- Validation errors return `422` with `errors.validation.failed`.
- Non-owner/admin members cannot write mailboxes.
- Duplicate mailbox email maps to `errors.mailbox.emailAlreadyUsed`.
- Default uniqueness conflicts map to `errors.mailbox.defaultConflict`.
- Mailbox limit enforcement returns `errors.billing.mailboxLimitExceeded`.
- Invalid or inactive SLA policy references fail before mailbox update.
- SLA write not included in plan returns `errors.billing.slaNotIncluded`.
- Default mailbox must be active and cannot be deactivated.
- Last active mailbox cannot be deactivated.

## Rendering Command Notes

Rendered from PlantUML source to PNG and SVG. PDF is rendered from the SVG through a local HTML wrapper with browser headers and footers disabled.

## Remaining Uncertainties

None.
