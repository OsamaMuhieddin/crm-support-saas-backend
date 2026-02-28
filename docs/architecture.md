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
- **Infra (`src/infra`)**: db + placeholders (jobs/storage)
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
