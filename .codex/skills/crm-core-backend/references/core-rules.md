# Core Rules

## Architecture

- Root entrypoints: `src/app.js`, `src/server.js`
- All code lives under `src/`
- `src/routes/index.js` mounts module routers under `/api`
- `src/shared/*` holds cross-cutting helpers
- `src/infra/*` holds infrastructure adapters
- `src/config/*` holds runtime configuration

## Module pattern

Use this structure when applicable:

- `index.js`
- `routes/<module>.routes.js`
- `controllers/`
- `services/`
- `models/`
- `schemas/`
- `validators/`
- `utils/` for small module-local pure helpers only

## Layer boundaries

- Controllers orchestrate request and response.
- Services contain business logic.
- Models define Mongoose persistence.
- Validators use `express-validator`.
- Wrap validators with `src/shared/middlewares/validate.js`.

## Implementation rules

- Put request parsing, service calls, and response shaping in controllers; do not bury business rules in routes.
- Put tenancy checks, invariants, state transitions, and denormalized updates in services.
- Add or extend module validators for request rules instead of doing ad hoc checks in controllers.
- Put reusable subdocuments in `schemas/` and keep module-local pure helpers in `utils/`.
- Mount new endpoints in the module router and keep `src/routes/index.js` as the central API mount point.
- Reuse shared error and middleware patterns; do not invent a parallel response or validation wrapper.
- For action endpoints, return compact action responses rather than full detail payloads.
- When behavior changes, add or update the nearest targeted tests rather than relying on manual verification only.

## Response contract

- Successful object responses under `<400` include localized `messageKey` and `message`.
- Errors must always be `{ status, messageKey, message, errors }`.
- Validation failures must use status `422`, `messageKey` `errors.validation.failed`, and an array in `errors`.

## Local file mentions

- Use absolute clickable local paths when referencing repo files in responses.
