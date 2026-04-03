# Billing v1 Frontend Flow Report

This report explains the Billing v1 frontend flow in product terms, not backend-internal terms.

## Who can use the billing UI

- Billing pages and billing actions are for `owner` and `admin`.
- `agent` and `viewer` should not be shown billing management actions.

## Billing surfaces the frontend uses

Read endpoints:

- `GET /api/billing/catalog`
- `GET /api/billing/subscription`
- `GET /api/billing/entitlements`
- `GET /api/billing/usage`
- `GET /api/billing/summary`

Action endpoints:

- `POST /api/billing/checkout-session`
- `POST /api/billing/portal-session`
- `POST /api/billing/change-plan`
- `POST /api/billing/update-addons`

Provider webhook endpoint:

- `POST /api/billing/webhooks/stripe`

Important:

- The frontend never calls the Stripe webhook endpoint itself.
- Stripe calls the webhook endpoint after Checkout, payment events, and subscription changes.

## The simple mental model

- `checkout-session` starts Stripe-managed billing.
- `change-plan` is the app-managed way to switch the current base plan.
- `update-addons` is the app-managed way to add, remove, or resize `extra_seat` and `extra_storage`.
- `portal-session` is the hosted Stripe session for payment method changes, recovery, cancellation, and any provider-managed actions that Stripe exposes for the current subscription shape.
- Stripe webhooks are what sync Stripe truth back into the app database.

## Quick Start Flows

### 1. Load the billing page

Recommended first request:

- `GET /api/billing/summary`

Why:

- It gives the frontend the current subscription state, plan, entitlement flags, limits, and usage in one response.

Useful supporting reads:

- `GET /api/billing/catalog` for plan and add-on display
- `GET /api/billing/usage` for usage-heavy views
- `GET /api/billing/subscription` for lifecycle-focused views
- `GET /api/billing/entitlements` for gating decisions

### 2. Start paid billing with Checkout

Frontend steps:

1. User chooses a plan and optional add-ons.
2. Frontend calls `POST /api/billing/checkout-session`.
3. Backend creates a Stripe Checkout session and returns a hosted Checkout URL.
4. Frontend redirects the browser to `checkoutSession.url`.
5. User completes Checkout on Stripe.
6. Stripe sends webhook events to the backend.
7. Backend worker/replay processes those events and updates local billing state.
8. Frontend returns to the app and refetches billing data, usually with `GET /api/billing/summary`.

Important:

- Checkout is the correct entry point for first paid setup.
- Checkout is not the ongoing subscription-management surface.

### 3. Change plan later inside the app

Frontend steps:

1. User opens billing settings after Stripe-managed billing already exists.
2. Frontend lets the user pick a new base plan such as `growth` or `business`.
3. Frontend calls `POST /api/billing/change-plan`.
4. Backend updates the Stripe subscription base plan item.
5. Stripe emits subscription update and invoice events.
6. Backend webhook processing syncs the local subscription and entitlement state.
7. Frontend refetches billing data, usually with `GET /api/billing/summary`.

Important:

- The frontend should treat the response as accepted change intent, then refetch summary because Stripe webhook sync finalizes local truth.
- Base-plan switching is not handled by changing plan quantity.

### 4. Add or remove extra seats / storage inside the app

Frontend steps:

1. User adjusts add-on quantities in billing settings.
2. Frontend calls `POST /api/billing/update-addons`.
3. Each add-on item is sent with an explicit quantity.
4. Quantity `0` means remove that add-on from the Stripe subscription.
5. Quantity `> 0` means add or update that add-on item in Stripe.
6. Stripe emits subscription update and invoice events.
7. Backend webhook processing syncs local subscription add-ons and recomputes entitlements.
8. Frontend refetches billing data, usually with `GET /api/billing/summary`.

Important:

- The frontend should send the desired quantity for the add-ons the user changed.
- Quantity `0` is how the app removes `extra_seat` or `extra_storage`.

### 5. Open Billing Portal when the user needs payment or cancellation management

Frontend steps:

1. User opens billing settings after Stripe-managed billing already exists.
2. Frontend calls `POST /api/billing/portal-session`.
3. Backend creates a Stripe Billing Portal session and returns a hosted portal URL.
4. Frontend redirects the browser to `portalSession.url`.
5. User changes payment method, handles payment recovery, cancels, or uses any provider-managed option Stripe exposes.
6. Stripe sends webhook events to the backend.
7. Backend syncs local subscription and entitlement state.
8. Frontend refetches billing data after return.

Important:

- Portal remains useful for payment method updates, payment recovery, and cancellation flows.
- Stripe may still expose plan updates in the portal for simple single-product subscriptions, but the frontend should rely on the app-managed change-plan and add-on actions for Billing v1.
- Portal is not required immediately after Checkout.
- The frontend should call portal only when meaningful Stripe-managed billing linkage already exists.

## Why there are two POST actions

`POST /api/billing/checkout-session`

- Use when the workspace is starting Stripe-managed billing for the first time.
- Returns a hosted Stripe Checkout session.

`POST /api/billing/change-plan`

- Use when the workspace already has a managed Stripe subscription and the user wants to switch the base plan inside the app.
- Returns a compact change result. Final local state still comes from webhook sync.

`POST /api/billing/update-addons`

- Use when the workspace already has a managed Stripe subscription and the user wants to add, remove, or resize `extra_seat` / `extra_storage`.
- Returns a compact change result. Final local state still comes from webhook sync.

`POST /api/billing/portal-session`

- Use when the workspace already has Stripe-managed billing and wants payment, recovery, cancellation, or other hosted provider-managed actions.
- Returns a hosted Stripe Billing Portal session.

Short version:

- Checkout = start billing
- Change-plan / update-addons = app-managed subscription changes
- Portal = hosted payment and subscription management surface

## What the frontend should do after redirect return

After Checkout success return, Portal return, or app-managed change action:

1. Return the user to the billing page.
2. Show a loading/reconciling state briefly.
3. Refetch `GET /api/billing/summary`.
4. If needed, also refetch `GET /api/billing/catalog`.

Why:

- The source of truth is updated by Stripe webhook processing.
- The frontend should not assume local state changed just because the user returned from Stripe or just because the change request returned `200`.

## Trial behavior

- Trial workspaces still have real plan limits and entitlements.
- Trial is not unlimited usage.
- The default local trial foundation starts on the default plan.
- Plan entitlements can change immediately after Checkout even while lifecycle status is still `trialing`.

Frontend implication:

- Show both plan and lifecycle status.
- Example: a workspace may be on `growth` while still showing `trialing` until the trial boundary is reached.

## Suggested frontend states

- `trialing`: show trial banner and trial end date if present
- `active`: normal paid state
- `past_due`: show billing warning and offer portal button
- `canceled`: show managed but ended/canceling state
- over-limit flags: show guidance and disable creation flows where the backend already enforces limits

## Recommended frontend button logic

Show Checkout button when:

- user is `owner` or `admin`
- the workspace does not yet have meaningful managed Stripe billing linkage for portal

Show Manage Billing / Portal button when:

- user is `owner` or `admin`
- the backend considers portal available

Show Change Plan and Update Add-ons actions when:

- user is `owner` or `admin`
- the workspace already has a managed Stripe subscription
- billing summary shows the current subscription and catalog needed to render the controls

Do not invent the rule entirely on the client:

- the backend already enforces portal availability and will return `errors.billing.portalUnavailable` when portal should not be offered

## Endpoint behavior summary

### `GET /api/billing/summary`

- Best default page-load endpoint
- Returns combined subscription, entitlements, usage, and flags

### `POST /api/billing/checkout-session`

- Creates Stripe Checkout session
- Frontend should redirect to returned URL

### `POST /api/billing/change-plan`

- Requests a base-plan change for the managed Stripe subscription
- Frontend should refetch summary after success

### `POST /api/billing/update-addons`

- Requests add-on quantity changes for the managed Stripe subscription
- Quantity `0` removes an add-on
- Frontend should refetch summary after success

### `POST /api/billing/portal-session`

- Creates Stripe Billing Portal session
- Frontend should redirect to returned URL

### `POST /api/billing/webhooks/stripe`

- Stripe-only endpoint
- Not called by the frontend

## Common frontend mistakes to avoid

- Do not call portal right after checkout just because checkout succeeded.
- Do not depend on the Stripe portal as the only place users can change plans or add-ons.
- Do not call the webhook endpoint from the frontend.
- Do not assume redirect return means local DB is already updated.
- Do not let `agent` or `viewer` access billing management actions.
- Do not treat card expiry on the Stripe form as subscription end date.

## Practical frontend sequence

Initial paid upgrade:

1. Load summary
2. Show plans from catalog
3. Call checkout-session
4. Redirect to Stripe Checkout
5. After return, refetch summary

Later billing management:

1. Load summary
2. Use change-plan for base plan changes
3. Use update-addons for seat/storage add-on changes
4. Use portal-session for payment, recovery, or cancellation tasks
5. Refetch summary after each action
