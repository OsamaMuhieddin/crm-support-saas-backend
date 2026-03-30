# Architecture

## Repo layout

- Root entrypoints: `src/app.js`, `src/server.js`
- All application code lives under `src/`
- `src/routes/index.js` mounts module routers under `/api`
- `src/shared/*` contains cross-cutting errors, middlewares, utils, validators
- `src/infra/*` contains db and infrastructure adapters
- `src/config/*` contains runtime configuration

## Module shape

Each business module should use the modular Express pattern when applicable:

- `index.js`
- `routes/<module>.routes.js`
- `controllers/`
- `services/`
- `models/`
- `schemas/`
- `validators/`
- `utils/` for small module-local pure helpers only

## Layer rules

- Controllers orchestrate request and response only.
- Services contain business logic and invariants.
- Models define persistence shape.
- Schemas define reusable module-local subdocuments.
- Validators use `express-validator`.
- Wrap validators with `src/shared/middlewares/validate.js`.
- Move helpers to `src/shared/*` only when they are truly cross-module.
