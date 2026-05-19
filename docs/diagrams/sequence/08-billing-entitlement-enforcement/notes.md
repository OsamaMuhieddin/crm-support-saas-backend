# Diagram 08 - Billing Entitlement Enforcement and Plan Limits

## Purpose and Importance

This diagram documents the implemented entitlement enforcement layer that protects revenue-sensitive product capacity: seats, pending invites, member activation, mailbox count, file uploads/storage, SLA feature access, and partial-block subscription state.

## Implementation Status

Implemented, with one important distinction: ticket creation updates monthly usage but there is no hard ticket-create limit check in `billing-enforcement.service.js`.

## Source Files Inspected

- `src/modules/billing/services/billing-enforcement.service.js`
- `src/modules/billing/services/billing-foundation.service.js`
- `src/modules/billing/services/billing.service.js`
- `src/modules/billing/utils/billing-canonical.js`
- `src/modules/billing/models/entitlement.model.js`
- `src/modules/billing/models/subscription.model.js`
- `src/modules/billing/models/usage-meter.model.js`
- `src/modules/files/services/files.service.js`
- `src/modules/widget/services/widget-public.service.js`
- `src/modules/tickets/services/tickets.service.js`
- `src/modules/workspaces/services/workspaces.service.js`
- `src/modules/mailboxes/services/mailboxes.service.js`
- `src/modules/sla/services/sla.service.js`
- `tests/billing.test.js`
- `tests/billing.runtime.test.js`
- `tests/files.test.js`
- `tests/widgets.test.js`
- `tests/tickets.core.test.js`
- `tests/mailboxes.test.js`
- `tests/sla.test.js`
- `docs/api.md`

The prompt named `src/modules/files/services/file.service.js` and `src/modules/tickets/services/ticket.service.js`; the implemented files are pluralized as `files.service.js` and `tickets.service.js`.

## Participants Included

- Workspace User or Widget Visitor
- App / Widget UI
- Routes + Validation
- Auth + Workspace Guards
- Domain Service
- Billing Enforcement
- Billing Foundation
- Billing Models
- Domain Models

## Participants Intentionally Excluded

- Stripe/provider calls are excluded because enforcement uses local subscription, entitlement, and usage state.
- MongoDB/Mongoose internals are excluded.

## Main Success Path

1. A product action reaches the relevant domain service.
2. The domain service calls billing enforcement when the action has an implemented guard.
3. Billing foundation ensures subscription, entitlement, and usage snapshots.
4. Enforcement checks partial block status, limits, or SLA feature access.
5. The domain service either performs the product mutation or the API returns a billing error.
6. Upload and ticket creation paths update usage after successful creation.

## Important Alternate and Error Paths

- Seat reservation and member activation can return `errors.billing.seatLimitExceeded`.
- Mailbox creation/activation can return `errors.billing.mailboxLimitExceeded`.
- File upload can return `errors.billing.storageLimitExceeded` or `errors.billing.uploadLimitExceeded`.
- SLA writes can return `errors.billing.slaNotIncluded`.
- Partial block state can return `errors.billing.partialBlockActive`.
- Ticket creation increments `ticketsCreated`; over-limit flags can be exposed in entitlements, but no hard ticket-create enforcement function is implemented.
- Validation, auth, role, and workspace errors are handled by each domain route's normal envelope.

## Rendering Command Notes

Rendered from PlantUML source to PNG and SVG. PDF is rendered from the SVG through a local HTML wrapper with browser headers and footers disabled.

## Remaining Uncertainties

None.
