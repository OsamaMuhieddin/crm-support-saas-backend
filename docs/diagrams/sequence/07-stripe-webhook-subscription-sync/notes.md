# Diagram 07 - Stripe Webhook Subscription Sync

## Purpose and Importance

This diagram documents the integration-critical and revenue-critical Stripe webhook flow that turns hosted checkout and portal/provider changes into local subscription, entitlement, and billing flag updates.

## Implementation Status

Implemented.

## Source Files Inspected

- `src/app.js`
- `src/server.js`
- `src/routes/index.js`
- `src/modules/billing/routes/billing.routes.js`
- `src/modules/billing/controllers/billing.controller.js`
- `src/modules/billing/services/billing-webhooks.service.js`
- `src/modules/billing/services/billing-sync.service.js`
- `src/modules/billing/services/billing-queue.service.js`
- `src/modules/billing/services/billing-foundation.service.js`
- `src/modules/billing/services/providers/stripe-billing.provider.js`
- `src/modules/billing/models/billing-webhook-event.model.js`
- `src/modules/billing/models/subscription.model.js`
- `src/modules/billing/models/entitlement.model.js`
- `src/modules/billing/models/plan.model.js`
- `src/modules/billing/models/addon.model.js`
- `src/config/billing.config.js`
- `tests/billing.runtime.test.js`
- `tests/billing.test.js`
- `docs/api.md`

No `tests/*webhook*.test.js` file is present; webhook coverage is in `tests/billing.runtime.test.js`.

## Participants Included

- Stripe
- Webhook Route Raw Body
- Billing Controller
- Webhook Service
- Stripe Billing Provider
- Webhook Event Model
- Billing Queue Runtime
- Billing Sync Worker/Service
- Subscription + Entitlement Models

## Participants Intentionally Excluded

- Stripe SDK internals are excluded. The provider wrapper is the implemented app boundary.
- Redis/BullMQ internals are excluded; the diagram uses Billing Queue Runtime as the app-level queue boundary.
- MongoDB/Mongoose internals are excluded.

## Main Success Path

1. `src/app.js` applies `express.raw({ type: 'application/json' })` before JSON parsing for `/api/billing/webhooks/stripe`.
2. The webhook route accepts the raw body and `stripe-signature` header.
3. Webhook service verifies the Stripe signature.
4. The event is persisted idempotently by provider and event id.
5. New events are enqueued when BullMQ is available, or accepted with a queue-unavailable note when not.
6. The processor resolves the workspace from metadata, subscription, customer, or existing subscription records.
7. Relevant Stripe event types sync subscription plan, add-ons, lifecycle status, and entitlement flags.
8. The webhook event is marked processed or failed.

## Important Alternate and Error Paths

- Invalid signatures return `400` with `errors.billing.webhookSignatureInvalid`.
- Malformed payload after verification returns `errors.billing.webhookPayloadInvalid`.
- Duplicate event ids are accepted idempotently and do not create duplicate webhook event rows.
- Already processed events are not reprocessed.
- Unhandled event types are marked processed and ignored.
- Missing workspace mapping leaves the event failed/pending for replay behavior.
- Payment failure and subscription status changes are represented through the same lifecycle sync path; handled statuses include Stripe-derived active, trialing, past due, incomplete, canceled, and incomplete expired mappings.
- Queue unavailable does not reject the HTTP webhook; the event remains persisted for replay.

## Rendering Command Notes

Rendered from PlantUML source to PNG and SVG. PDF is rendered from the SVG through a local HTML wrapper with browser headers and footers disabled.

## Remaining Uncertainties

None.
