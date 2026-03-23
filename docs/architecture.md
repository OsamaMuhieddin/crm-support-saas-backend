# Architecture Overview

## High-level modules

- Workspaces: tenant root and active workspace context
- Users/Agents: workspace members and authentication identity
- Customers: contacts and organizations
- Files: private file storage plus polymorphic file links
- Mailboxes: workspace-scoped inbox/mailbox dictionaries
- Tickets: core support workflow with conversations, messages, dictionaries, assignment, lifecycle, and participants
- SLA: business-hours and policy management plus ticket first-response/resolution runtime behavior
- Inbox/Conversations, Integrations, Plans, Admin: broader platform areas that may expand further over time

## Layers

- **Routes (`src/routes`)**: mounts module routers under `/api`
- **Modules (`src/modules`)**: feature modules using the modular Express pattern with routes, controllers, services, models, schemas, validators, and optional module-local utilities
- **Shared (`src/shared`)**: errors, middlewares, utils, validators
- **Infra (`src/infra`)**: db + jobs + storage adapters (MinIO/local)
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
