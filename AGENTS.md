# CRM Support SaaS Backend — Agent Instructions

## Architecture (Modular, Nest-like in Express)
- Root entrypoints: `src/app.js`, `src/server.js`.
- All code under `src/`.
- `src/routes/index.js` mounts module routers under `/api`.
- `src/shared/*` contains cross-cutting utilities (errors, middlewares, utils, validators).
- `src/infra/*` contains infrastructure adapters (db now; jobs/storage placeholders).
- `src/config/*` contains runtime configuration (env only).

Each module under src/modules follows this structure:

- index.js (module entry; exports router)
- routes/<module>.routes.js (route definitions)
- controllers/
- services/
- models/
- schemas/ (module-specific mongoose sub-schemas)
- validators/

Controllers orchestrate request/response.
Services contain business logic.
Models contain mongoose schemas/models.
Schemas contain subdocuments used only inside the module.
Routes define endpoints and call controllers.

## Tenancy (planned rules)
- Workspace is the tenant root.
- Most data will be scoped by `workspaceId` in future models/services.

## Localization
- Header: `x-lang: en|ar`, default `en`.
- Success responses are localized by the wrapper in `app.js`.
- Error responses are localized by the global error handler in `app.js`.

## Response shape (CRITICAL)
- Success (<400) object bodies:
  - `messageKey` defaults to `success.ok`
  - `message` localized from `messageKey`
- Errors MUST always be:
  `{ status, messageKey, message, errors }`
- Validation failures MUST be:
  - status 422
  - messageKey `errors.validation.failed`
  - errors array in `errors` field

## Validation
- Use `express-validator` rules inside modules.
- Wrap routes with `shared/middlewares/validate.js`.

## API Docs Format Rules
1. Always include `Quick Start Flows` before endpoint reference sections.
2. Always include `Auth model & authorization model`, explicitly explaining workspace-scoped tokens and `roleKey`.
3. Prefer concrete requirement statements over internal middleware/guard names.
4. Define shared headers once near the top; do not duplicate header blocks for every endpoint.
5. Every endpoint entry must include: purpose, request schema, success shape, common errors, and anti-enumeration notes when applicable.
6. Keep all examples consistent with the response envelope and include `messageKey` in success responses.
