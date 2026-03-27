# Architecture Overview

## High-level modules

- Workspaces: tenant root and active workspace context
- Users/Agents: workspace members and authentication identity
- Customers: contacts and organizations
- Files: private file storage plus polymorphic file links
- Mailboxes: workspace-scoped inbox/mailbox dictionaries
- Tickets: core support workflow with conversations, messages, dictionaries, assignment, lifecycle, and participants
- SLA: business-hours and policy management plus ticket first-response/resolution runtime behavior
- Realtime: internal authenticated collaboration transport, room subscriptions, business-event publishing, and Redis-backed ephemeral collaboration signals
- Inbox/Conversations, Integrations, Plans, Admin: broader platform areas that may expand further over time

## Layers

- **Routes (`src/routes`)**: mounts module routers under `/api`
- **Modules (`src/modules`)**: feature modules using the modular Express pattern with routes, controllers, services, models, schemas, validators, and optional module-local utilities
- **Shared (`src/shared`)**: errors, middlewares, utils, validators
- **Infra (`src/infra`)**: db + jobs + storage adapters (MinIO/local) + realtime/Redis coordination foundations
- **Config (`src/config`)**: env configuration

## Nest-like module pattern in Express

Each module follows this structure:

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

## Implemented module style

- Protected business modules are workspace-scoped through the active session workspace.
- Controllers orchestrate request and response handling only.
- Services own business rules, tenancy checks, invariants, and denormalized updates.
- Models define Mongoose persistence shape, including soft-delete fields where the module uses them.
- Validators use `express-validator` and are wrapped by the shared validation middleware.
- Module-local utilities should stay inside the module when they are not cross-cutting enough for `src/shared`.
- Success and error responses follow the localized global response envelope defined in `src/app.js`.

## Realtime foundation notes

- `src/infra/realtime/*` owns Socket.IO bootstrap, room helpers, handshake auth, adapter wiring, and the centralized transport publisher abstraction.
- `src/infra/redis/*` owns the reusable Redis config/client seam so future platform capabilities can share the same foundation.
- Realtime is internal-only for the authenticated workspace app in the current phase.
- MongoDB and REST remain the source of truth; sockets do not bypass module business logic.
- Business live events are published from the existing service layer only after successful writes and after downstream counters/SLA side effects are finalized.
- Existing sockets in a session are disconnected when `POST /api/workspaces/switch` changes the active workspace so the client reconnects under the fresh token/workspace context.
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
- Current ephemeral collaboration signals:
  - ticket presence snapshots and change events
  - typing indicators with TTL refresh/expiry semantics
  - advisory soft-claim state with TTL refresh/expiry semantics
- Collaboration actions use a modest per-socket throttle window to suppress conflicting bursts while still allowing quiet same-state refreshes.
- Collaboration state lives outside MongoDB ticket truth and is coordinated through the shared Redis foundation when enabled, with a single-instance in-memory fallback for local/test runtime parity.
- Expiry-driven collaboration broadcasts are best-effort per node; snapshot-on-subscribe/reconnect remains the correctness path for stale cleanup recovery.
- Redis is available as optional shared infrastructure, while the Socket.IO Redis adapter remains behind explicit realtime env flags so horizontal fan-out can be enabled later without reworking the rest of the codebase.

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
