# Architecture Overview

## High-level modules (planned)
- Workspaces: tenant root
- Users/Agents: workspace members
- Customers: contacts/end-users
- Tickets: core entity
- Inbox/Conversations, SLA, Integrations, Plans, Admin: later

## Layers
- **Routes (`src/routes`)**: mounts module routers under `/api`
- **Modules (`src/modules`)**: feature modules (routers now; controllers/services/models later)
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

- index.js exports the router.
- routes/ contains route definitions.
- controllers handle HTTP layer.
- services contain business logic.
- models define mongoose models.
- schemas define reusable subdocuments within the module.

## Files v1 module notes
- `src/modules/files/models/file.model.js` stores physical object metadata.
- `src/modules/files/models/file-link.model.js` stores polymorphic entity relations (soft-delete capable).
- `src/infra/storage/index.js` resolves storage provider lazily.
- `src/infra/storage/s3.minio.storage.js` is the primary S3-compatible provider.
- `src/infra/storage/local.storage.js` is a local adapter for test/dev fallback.
- `GET /api/files` listing uses an aggregation pipeline with `$facet` for paginated data + total in one DB roundtrip.
- Public download contract is stable at `GET /api/files/:fileId/download` (backend-streamed in v1).
