# Diagram 12: Billing

## Scope

This diagram covers implemented workspace billing behavior for Masar - CRM Support SaaS. It includes owner/admin billing reads, Stripe checkout and portal sessions, app-managed plan and add-on updates, webhook acceptance and processing, local billing foundation creation, entitlement recomputation, usage tracking, and billing enforcement effects used by other modules.

This is a detailed domain use case diagram, not a whole-system context diagram. Platform-admin billing analytics and tenant support actions are intentionally deferred to the Platform Admin diagram.

## Actors Included

- `Workspace Member`: abstract actor for workspace activity that can consume billing limits indirectly through invites, mailbox writes, file uploads, SLA writes, and ticket creation.
- `Workspace Manager (Owner/Admin)`: abstract actor for owner/admin billing API access. Concrete owner and admin roles are grouped into this actor to keep the diagram readable.
- `Billing Provider (Stripe)`: external business-facing provider for customer records, checkout sessions, billing portal sessions, subscription mutations, subscription retrieval, and webhook delivery.
- `System / Scheduler`: included because implemented billing workers and scheduled replay process webhook events, stale pending events, lifecycle sync jobs, and workspace entitlement repair jobs as business-visible billing maintenance.

## Actors Intentionally Excluded

- MongoDB, Mongoose, Express, JWT libraries, Redis, BullMQ, Docker, queues, worker processes, local job fallbacks, and internal scripts are implementation details, not business actors.
- Concrete `Workspace Owner` and `Workspace Admin` actors are grouped under `Workspace Manager (Owner/Admin)` instead of drawn separately because they share the same billing API use cases.
- `Agent` and `Viewer` are excluded as first-class actors because billing routes require `owner|admin`; their only billing relevance is indirect workspace-member limit consumption.
- `Platform Admin` is excluded. Admin billing overview, workspace billing detail, workspace suspension/reactivation, and trial extension are platform-administration concerns for a later diagram.
- Email Provider is excluded because billing flows do not directly send email through the app email service.

## Use Cases Included

- `View Billing Catalog`: returns the active fixed catalog of plans and add-ons after syncing the catalog manifest.
- `View Billing State`: grouped authenticated owner/admin billing read surface.
- `View Billing Summary`: compact frontend-oriented view containing subscription, entitlement limits/features, usage, and flags.
- `View Subscription`: full current workspace subscription foundation view.
- `View Entitlements`: current computed entitlement limits, features, usage, over-limit flags, and source snapshot.
- `View Usage`: current seats/mailboxes/storage and monthly ticket/upload usage.
- `Bootstrap Billing Foundation`: creates or repairs subscription, entitlement, and usage-meter foundation records for an active workspace.
- `Recompute Entitlements`: resolves plan/add-ons, usage, over-limit flags, and feature availability from current billing state.
- `Track Ticket and Upload Usage`: increments monthly ticket creation and upload counters; storage is recounted from ready files.
- `Manage Workspace Subscription`: grouped owner/admin subscription action surface.
- `Start Checkout Session`: initial paid setup through Stripe Checkout for a selected plan and optional add-ons.
- `Create or Update Stripe Customer`: links workspace billing to a Stripe customer using workspace and owner metadata.
- `Open Billing Portal`: creates a Stripe Billing Portal session for managed subscriptions in supported states.
- `Change Plan`: updates the Stripe base plan subscription item, then syncs local state from Stripe; unchanged requests still sync and return success.
- `Update Add-ons`: adds, removes, resizes, or no-ops add-on subscription items, then syncs local state from Stripe.
- `Sync Subscription from Stripe`: maps Stripe subscription status, plan price, add-on prices, lifecycle dates, and metadata into local subscription state.
- `Use Stripe Billing Provider`: grouped external-provider interaction surface for customer linkage, checkout, portal, subscription mutations, and provider reads.
- `Accept Stripe Webhook`: public Stripe route that verifies the signature, persists the event, and attempts queueing for processing.
- `Verify Webhook Signature`: rejects missing or invalid `stripe-signature` headers before accepting events.
- `Persist Webhook Idempotently`: stores provider/event id once and accepts duplicates without duplicating processed work.
- `Run Billing Maintenance`: grouped scheduled/worker maintenance surface for webhook processing, replay, lifecycle sync, and repair.
- `Process Billing Webhook Event`: processes relevant checkout, subscription, and invoice events, resolves workspace linkage, and syncs local billing state.
- `Replay Failed or Stale Webhooks`: worker/script path that retries failed events and stale pending events.
- `Sync Local Billing Lifecycle`: local lifecycle maintenance for trial, grace, past-due, partial-block, and cancellation flags.
- `Repair Workspace Billing State`: recomputes workspace billing foundation, usage, subscription status, and entitlements through implemented repair paths.
- `Enforce Billing Limits`: grouped billing enforcement surface used by other workspace modules.
- `Enforce Seat Limits`: blocks invite reservation and member activation when projected seats exceed entitlement limits.
- `Enforce Mailbox Limits`: blocks active mailbox creation or activation when projected active mailboxes exceed entitlement limits.
- `Enforce Storage and Upload Limits`: blocks uploads when projected storage bytes or monthly upload count exceeds entitlement limits.
- `Enforce SLA Availability`: blocks SLA writes when the current plan does not include the SLA feature.
- `Apply Partial Billing Block`: shared enforcement behavior that blocks several write paths when partial billing block is active.

## Grouping Decisions

- Billing read endpoints are grouped under `View Billing State` in the diagram because the specific read endpoints are repetitive visually; the notes preserve the endpoint-level breakdown.
- Subscription actions are grouped under `Manage Workspace Subscription` so owner/admin actor lines stay close to the existing context-diagram style.
- Stripe provider interactions are grouped under `Use Stripe Billing Provider` so the external provider remains visible without drawing a line to every provider-backed internal step.
- Internal catalog sync is documented as part of `View Billing Catalog` and foundation behavior instead of a separate actor-facing use case.
- Stripe customer creation/update is shown because checkout depends on provider customer linkage.
- Seat, mailbox, storage/upload, SLA, and partial-block checks are grouped under `Enforce Billing Limits` to keep the diagram readable. The implemented enforcement categories are documented in the use-case list instead of drawn as separate ovals.
- Worker, queue, and script internals are grouped under `Run Billing Maintenance` instead of exposing Redis or BullMQ.
- Backfill and migration scripts are documented in notes rather than drawn as use cases because they are one-off operational maintenance paths, not normal workspace billing behavior.
- Platform-admin billing visibility is omitted here to keep workspace billing separate from operator administration.

## Important Business Rules

- Normal billing endpoints require authentication, active user, active workspace membership, and `owner|admin` role.
- The Stripe webhook endpoint is public to Stripe but protected by webhook signature verification.
- Billing reads auto-bootstrap or recompute billing foundation state when needed.
- New workspaces get a trialing starter subscription foundation with default usage counters.
- Checkout is intended for initial paid setup when no active managed Stripe subscription is already present, except canceled or incomplete-expired cases.
- Checkout accepts selected plan and optional add-ons, requires usable success/cancel URLs, and does not enable Stripe promotion codes.
- Portal sessions require an existing Stripe customer and managed subscription in a supported state.
- Plan and add-on changes require an existing managed Stripe subscription.
- Add-on quantity `0` removes an add-on; unchanged plan/add-on requests succeed as no-ops while still syncing from Stripe.
- Webhook acceptance rejects invalid signatures, persists accepted events idempotently, and accepts duplicate deliveries without re-enqueueing already processed events.
- Webhook processing syncs subscription lifecycle from Stripe and preserves local usage counters across upgrades and downgrades.
- Provider sync preserves local state when Stripe sync fails instead of pretending a successful update occurred.
- Explicit zero limits are enforceable; null limits remain unlimited.
- Pending invites consume reserved seats, while suspended and removed members do not consume seats.
- Inactive mailboxes do not consume active mailbox quota.
- Upload deletion reduces current storage usage but does not decrement the monthly upload counter.
- Ticket creation increments monthly billing usage without blocking ticket creation.

## Files, Routes, Docs, and Tests Inspected

- `src/modules/billing/routes/billing.routes.js`
- `src/modules/billing/controllers/billing.controller.js`
- `src/modules/billing/services/billing.service.js`
- `src/modules/billing/services/billing-catalog.service.js`
- `src/modules/billing/services/billing-foundation.service.js`
- `src/modules/billing/services/billing-enforcement.service.js`
- `src/modules/billing/services/billing-sync.service.js`
- `src/modules/billing/services/billing-webhooks.service.js`
- `src/modules/billing/services/billing-queue.service.js`
- `src/modules/billing/services/providers/stripe-billing.provider.js`
- `src/modules/billing/docs/openapi.js`
- `src/workers/billing.worker.js`
- `scripts/replay-billing-webhooks.js`
- `src/modules/files/services/files.service.js`
- `src/modules/mailboxes/services/mailboxes.service.js`
- `src/modules/workspaces/services/workspaces.service.js`
- `src/modules/tickets/services/tickets.service.js`
- `src/modules/sla/services/sla.service.js`
- `src/modules/sla/services/sla-ticket-runtime.service.js`
- `docs/api.md`
- `tests/billing.test.js`
- `tests/billing.runtime.test.js`
- `tests/files.test.js`
- `tests/invites.test.js`
- `tests/mailboxes.test.js`
- `tests/sla.test.js`
- `tests/tickets.core.test.js`
- `tests/ticket-operations.test.js`
- Existing accepted diagram sources under `docs/diagrams/use-cases/system-context/`, `auth-workspace/`, `ticket-operations/`, `ticket-messages-attachments/`, `customers-contacts/`, `mailboxes/`, `sla/`, `files/`, `widget-public-flow/`, and `realtime/`.

## Webhook, Provider, Worker, and Replay Limitations

- The diagram treats Stripe as a business-facing provider and does not expose Stripe SDK calls, price id lookup details, or raw provider payload structure.
- Webhook queueing is best-effort. If the queue is unavailable, the accepted event records enqueue failure and can later be replayed.
- Worker and replay scripts are operational entry points, not frontend APIs.
- Scheduled replay only processes failed events and stale pending events.
- Native Visual Paradigm `.vpp`/`.vpdx` export is not available from PlantUML; XMI is a best-effort interchange artifact.
- Direct PlantUML PDF export failed in this local environment because the PlantUML jar could not load the Batik PDF converter. The PDF artifact was generated from the rendered PNG instead.

## Platform-Admin Billing Areas Deferred

- Platform billing overview and revenue-sensitive analytics.
- Admin workspace billing inspection.
- Workspace suspension/reactivation effects on tenant status.
- Super-admin trial extension support actions.

These belong in the Platform Admin diagram because they use admin routes and platform roles rather than workspace owner/admin billing routes.

## Styling and Rendering Decisions

- The diagram follows the accepted landscape `left to right direction` layout.
- Actors are plain stick actors with `actorStyle awesome`.
- Use cases are plain white ovals inside the `Masar - CRM Support SaaS` system boundary.
- Association and dependency arrows use the established plain UML style from the existing context and detailed use-case diagrams.
- Rendered PNG/PDF/SVG outputs are generated artifacts; PlantUML source and notes are the maintained sources.
