# Architecture Overview

## High-level modules

Current module inventory under `src/modules` falls into three practical groups.

### Routed API modules

- Health: operational health endpoint
- Auth: authentication, sessions, password and account access flows
- Workspaces: tenant root, memberships, invitations, and active workspace context
- Users: workspace user and member management
- Customers: contacts, organizations, and contact identities
- Mailboxes: workspace-scoped mailbox dictionaries and defaults
- Tickets: core support workflow with conversations, messages, dictionaries, assignment, lifecycle, and participants
- Inbox: inbox-facing conversation and ticket application surface
- SLA: business-hours and policy management plus ticket first-response/resolution runtime behavior
- Integrations: integration-facing API surface
- Admin: platform/admin operational endpoints
- Files: private file storage plus polymorphic file links
- Realtime: authenticated collaboration endpoint surface for subscriptions and live state
- Billing: workspace-authenticated billing catalog, lifecycle reads, checkout, portal, Stripe webhook intake, and worker-backed sync foundations

### Internal or data-only modules

- Platform: platform-level persistence models such as admin sessions and metrics
- Automations: automation rule models and schemas
- Notifications: notification persistence models and schemas
- Roles: shared role-related models/schemas placeholder module

### Notes on maturity

- Not every module is mounted under `/api` yet.
- Some modules currently exist only to register Mongoose models and schemas for future routed features.
- The routed module list is defined centrally in `src/routes/index.js`.

## Layers

- **Routes (`src/routes`)**: mounts module routers under `/api`
- **Modules (`src/modules`)**: feature modules using the modular Express pattern with routes, controllers, services, models, schemas, validators, and optional module-local utilities
- **Shared (`src/shared`)**: errors, middlewares, utils, validators
- **Infra (`src/infra`)**: db + jobs + storage adapters (MinIO/local) + realtime/Redis coordination foundations
- **Config (`src/config`)**: env configuration
- **Constants (`src/constants`)**: shared enums and domain constants
- **i18n (`src/i18n`)**: localized message catalogs and translation bootstrap

## Nest-like module pattern in Express

Router-backed business modules typically follow this structure:

src/modules/<module>/
index.js
routes/<module>.routes.js
controllers/
services/
models/
schemas/
validators/
utils/ (optional, module-local pure helpers only)

- index.js exports the router.
- routes/ contains route definitions.
- controllers handle HTTP layer.
- services contain business logic.
- models define mongoose models.
- schemas define reusable subdocuments within the module.
- validators define request validation rules.
- utils/ is optional and should contain small module-local pure helpers that are reused inside the module but do not belong in `shared/`.
- Some thinner or internal modules intentionally expose only the pieces they need today, such as `models/`, `schemas/`, or a small routed surface without the full folder set.

## Implemented module style

- Protected business modules are workspace-scoped through the active session workspace.
- The current routed API modules are: `health`, `auth`, `workspaces`, `users`, `customers`, `tickets`, `inbox`, `sla`, `integrations`, `admin`, `files`, `mailboxes`, `realtime`, and `billing`.
- Additional internal modules currently present in `src/modules` are: `platform`, `automations`, `notifications`, and `roles`.
- Controllers orchestrate request and response handling only.
- Services own business rules, tenancy checks, invariants, and denormalized updates.
- Models define Mongoose persistence shape, including soft-delete fields where the module uses them.
- Validators use `express-validator` and are wrapped by the shared validation middleware.
- Module-local utilities should stay inside the module when they are not cross-cutting enough for `src/shared`.
- Success and error responses follow the localized global response envelope defined in `src/app.js`.

## Workspaces module notes

- Workspaces are the tenant root for protected business routes; most workspace-scoped access is derived from the active workspace stored on the current session.
- `GET /api/workspaces/mine` lists the current user's active memberships with workspace basics and role context for workspace selection.
- `POST /api/workspaces/switch` is the only supported way to change the active workspace for a session; it updates `session.workspaceId`, returns a fresh access token, and forces existing realtime sockets for that session to reconnect under the new workspace context.
- Invite acceptance creates or re-activates membership but does not auto-switch the active workspace as a side effect.
- Invite management is workspace-scoped and restricted to `owner|admin` inside the currently active workspace.

## Auth module notes

- Auth uses a session-backed JWT model rather than stateless access tokens.
- Access tokens carry the current user, session, workspace, and role context (`sub`, `sid`, `wid`, `r`) with `typ=access` and `ver=1`.
- Request authentication re-checks the backing session on every access-token use, including revoked/expired state and exact workspace match between `session.workspaceId` and token `wid`.
- Refresh tokens are session-bound, stored hashed in the session record, and rotated on refresh; a refresh-token hash mismatch revokes the session.
- Login, verified-email login, and refresh all resolve an active workspace context before minting tokens so the session always carries a concrete workspace.
- Logout, logout-all, change-password, and reset-password revoke affected sessions and best-effort disconnect their existing realtime sockets.

## Realtime foundation notes

- `src/infra/realtime/*` owns Socket.IO bootstrap, room helpers, handshake auth, adapter wiring, and the centralized transport publisher abstraction.
- `src/infra/redis/*` owns the reusable Redis config/client seam so future platform capabilities can share the same foundation.
- Realtime is internal-only for the authenticated workspace app in the current phase.
- MongoDB and REST remain the source of truth; sockets do not bypass module business logic.
- Business live events are published from the existing service layer only after successful writes and after downstream counters/SLA side effects are finalized.
- Existing sockets in a session are disconnected when `POST /api/workspaces/switch` changes the active workspace so the client reconnects under the fresh token/workspace context.
- Existing sockets for revoked sessions are also disconnected on a best-effort basis during logout, logout-all, change-password, and reset-password flows.
- Socket auth mirrors the existing HTTP access-token/session/workspace model:
  - valid JWT signature, issuer, and audience
  - `typ=access`, `ver=1`
  - required `sub`, `sid`, `wid`, `r`
  - backing session must exist, be active, and still match the token workspace
  - user must be active
  - workspace membership must be active
- Reserved room patterns in this phase:
  - `workspace:{workspaceId}`
  - `ticket:{ticketId}`
  - `user:{userId}`
- Current published live event families:
  - ticket lifecycle and update events
  - message and conversation summary events
  - ticket participant change events
  - lightweight user-targeted notices
- Ticket create with `initialMessage` still emits `ticket.created` first, then the same message/conversation event pair used by later message writes.
- Current ephemeral collaboration signals:
  - ticket presence snapshots and change events
  - typing indicators with TTL refresh/expiry semantics
  - advisory soft-claim state with TTL refresh/expiry semantics
- Any active readable member, including `viewer`, may publish these advisory collaboration signals in the current internal-only phase.
- Collaboration actions use a modest per-socket throttle window to suppress conflicting bursts while still allowing quiet same-state refreshes.
- Collaboration state lives outside MongoDB ticket truth and is coordinated through the shared Redis foundation when enabled, with a single-instance in-memory fallback for local/test runtime parity.
- Expiry-driven collaboration broadcasts are best-effort per node; snapshot-on-subscribe/reconnect remains the correctness path for stale cleanup recovery.
- Redis is available as optional shared infrastructure, while the Socket.IO Redis adapter remains behind explicit realtime env flags so horizontal fan-out can be enabled later without reworking the rest of the codebase.
- The main realtime integration suites are intended to run unchanged in three env-driven modes: no Redis, Redis-backed collaboration store without the Socket.IO adapter, and Redis-backed collaboration store with the adapter enabled.

## Mailboxes v1 module notes

- Mailboxes are workspace-scoped operational dictionaries protected by active workspace membership, with writes restricted to `owner|admin`.
- Each workspace has a canonical default mailbox expressed both as `workspace.defaultMailboxId` and as exactly one active mailbox flagged `isDefault`; the service layer actively realigns drift between those two sources of truth.
- A default mailbox must be active, a default mailbox cannot be deactivated, and the last active mailbox in a workspace cannot be deactivated.
- Creating or activating mailboxes may trigger default-mailbox backfill/alignment so every workspace can maintain a usable default target.
- Mailboxes may optionally point to an active SLA policy, which participates in ticket SLA selection ahead of the workspace default policy.

## SLA v1 module notes

- The SLA module owns workspace-scoped business-hours definitions, SLA policies, and summary/reporting endpoints.
- Reads are available to active workspace members; writes and policy/business-hours actions are restricted to `owner|admin`.
- Workspace `defaultSlaPolicyId` and mailbox `slaPolicyId` together form the policy-selection chain used by tickets; mailbox-specific policy selection wins over the workspace default.
- Policy activation, deactivation, and set-default actions maintain canonical default-policy state and may clear or replace existing mailbox/workspace references when a policy is deactivated.
- Tickets snapshot selected SLA policy and business-hours data into `ticket.sla` so later policy edits do not rewrite historical ticket runtime context.
- Ticket SLA runtime derives live first-response/resolution status from ticket lifecycle events, including business-hours-aware due times, breach tracking, pause/resume behavior, and reopen handling.

## Files v1 module notes

- `src/modules/files/models/file.model.js` stores physical object metadata.
- `src/modules/files/models/file-link.model.js` stores polymorphic entity relations (soft-delete capable).
- `src/infra/storage/index.js` resolves storage provider lazily.
- `src/infra/storage/s3.minio.storage.js` is the primary S3-compatible provider.
- `src/infra/storage/local.storage.js` is a local adapter for test/dev fallback.
- `GET /api/files` listing uses an aggregation pipeline with `$facet` for paginated data + total in one DB roundtrip.
- Public download contract is stable at `GET /api/files/:fileId/download` (backend-streamed in v1).

## Tickets v1 module notes

- `src/modules/tickets` follows the same modular pattern as the other implemented business modules.
- Tickets are protected workspace-scoped endpoints, not public routes.
- One conversation exists per ticket and is linked through `ticket.conversationId`.
- Ticket numbers are allocated per workspace through `TicketCounter`.
- Ticket writes use active same-workspace mailbox, contact, category, and tag references.
- Ticket detail may still hydrate already-linked inactive category and tag references for historical integrity.
- Message flow is manual-first in v1, with message-owned file attachments and reverse ticket-level file links.
- Assignment is single-assignee; participants are separate internal metadata and do not grant access.

## Billing v1 runtime notes

- `src/modules/billing` now exposes the workspace billing runtime under `/api/billing`.
- Workspace-facing billing reads and actions are restricted to active workspace members with `owner|admin` role.
- The module syncs a fixed internal plan/add-on catalog before serving billing reads or checkout flows.
- The module auto-bootstraps one current workspace subscription foundation record and one entitlement snapshot on demand.
- Current protected endpoints expose catalog, subscription, entitlements, usage, summary, checkout session creation, and billing portal session creation.
- A public Stripe webhook intake route now lives under `/api/billing/webhooks/stripe`.
- Stripe SDK usage is isolated inside the billing provider service seam; controllers and higher-level billing services speak internal billing terms.
- Billing lifecycle sync persists webhook events first, then hands off follow-up processing to BullMQ using the existing shared Redis config path.
- Dedicated billing workers now process webhook follow-up jobs and provide queue foundations for lifecycle and repair work.
- Trial expiry without billing setup now transitions locally into grace and `past_due` state so read models reflect unpaid lifecycle before enforcement is added elsewhere.
