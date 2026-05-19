# Diagram 06 - Billing Checkout and Customer Portal

## Purpose and Importance

This diagram documents the revenue-critical hosted billing entry points: initial checkout and Stripe customer portal session creation.

## Implementation Status

Implemented.

## Source Files Inspected

- `src/modules/billing/routes/billing.routes.js`
- `src/modules/billing/controllers/billing.controller.js`
- `src/modules/billing/services/billing.service.js`
- `src/modules/billing/services/billing-sync.service.js`
- `src/modules/billing/services/billing-foundation.service.js`
- `src/modules/billing/services/billing-catalog.service.js`
- `src/modules/billing/services/providers/stripe-billing.provider.js`
- `src/modules/billing/models/plan.model.js`
- `src/modules/billing/models/addon.model.js`
- `src/modules/billing/models/subscription.model.js`
- `src/modules/billing/models/entitlement.model.js`
- `src/modules/billing/models/usage-meter.model.js`
- `src/modules/billing/validators/billing.validators.js`
- `src/modules/workspaces/models/workspace.model.js`
- `src/modules/workspaces/models/workspace-member.model.js`
- `src/modules/users/models/user.model.js`
- `src/shared/middlewares/requireAuth.js`
- `src/shared/middlewares/requireActiveUser.js`
- `src/shared/middlewares/requireActiveMember.js`
- `src/shared/middlewares/requireWorkspaceRole.js`
- `src/config/billing.config.js`
- `tests/billing.runtime.test.js`
- `tests/billing.test.js`
- `docs/api.md`

## Participants Included

- Workspace Owner/Admin
- Billing UI
- Routes + Validation
- Auth + Workspace Guards
- Billing Controller
- Billing Service
- Billing Sync Service
- Billing Models
- Workspace/User Models
- Stripe Billing Provider

## Participants Intentionally Excluded

- Direct Stripe SDK internals are excluded. The implemented app boundary is `stripe-billing.provider.js`.
- MongoDB/Mongoose internals are excluded.

## Main Success Path

1. Owner/admin requests a checkout session with plan, add-ons, success URL, and cancel URL.
2. Billing routes enforce active workspace membership and owner/admin role.
3. Billing service resolves catalog plan/add-ons and ensures a workspace billing foundation.
4. Checkout is blocked if the workspace already has an active managed Stripe subscription.
5. The app creates or updates a Stripe customer and persists `stripeCustomerId`.
6. The app creates a hosted Stripe checkout session and returns the compact session payload.
7. For existing managed subscriptions, the portal route validates portal eligibility and returns a hosted portal URL.

## Important Alternate and Error Paths

- Validation errors return `422` with `errors.validation.failed`.
- Non-owner/admin members receive `errors.auth.forbiddenRole`.
- Missing provider configuration returns provider configuration errors.
- Missing/inactive plan or add-on selection fails before provider calls.
- Checkout URL requirements can return `errors.billing.checkoutUrlsRequired`.
- Checkout is unavailable when plan features disable checkout or when an active managed subscription must be handled through portal/actions.
- Portal is unavailable without meaningful Stripe customer/subscription linkage or if portal feature is disabled.
- Subscription activation and lifecycle changes are deferred to Stripe webhook processing, shown in Diagram 07.

## Rendering Command Notes

Rendered from PlantUML source to PNG and SVG. PDF is rendered from the SVG through a local HTML wrapper with browser headers and footers disabled.

## Remaining Uncertainties

None.
