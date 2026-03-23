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
- utils/ (optional, module-local pure helpers only)

Controllers orchestrate request/response.
Services contain business logic.
Models contain mongoose schemas/models.
Schemas contain subdocuments used only inside the module.
Routes define endpoints and call controllers.
Use module-local `utils/` only for small pure helpers reused within one module. Keep cross-module helpers in `src/shared/*`.

## Tenancy (planned rules)

- Workspace is the tenant root.
- Most data will be scoped by `workspaceId` in future models/services.
- Users can belong to multiple workspaces via memberships.
- Active workspace is session-scoped (`session.workspaceId`).
- Active workspace MUST change only through explicit endpoint:
  - `POST /api/workspaces/switch`
- Do NOT auto-switch active workspace as a side effect of invite acceptance or invite finalization.

## Workspace Context Endpoints

- `GET /api/workspaces/mine`: list current user's active memberships with workspace basics + role.
- `POST /api/workspaces/switch`: switch active workspace for current session and return a new access token.

## Files v1 (Implemented)

- Module: `src/modules/files`.
- Storage abstraction: `src/infra/storage` with MinIO provider and local adapter fallback for tests/dev.
- Public download contract is fixed at:
  - `GET /api/files/:fileId/download`
- v1 behavior is backend-streamed download (no public object URL exposure).
- `files` stores physical object metadata.
- `file_links` stores generic polymorphic relations and supports soft-delete.
- Upload permission: `owner|admin|agent`.
- Delete permission: `owner|admin`.
- Viewer can read/list/download only.

## Tickets v1 (Implemented)

- Module: `src/modules/tickets`.
- Tickets are protected workspace-scoped endpoints, not public routes.
- One conversation is created per ticket and linked through `ticket.conversationId`.
- Ticket numbers are workspace-scoped incremental numbers from `TicketCounter`.
- `POST /api/tickets` permission: `owner|admin|agent`.
- `mailboxId` defaults from `workspace.defaultMailboxId` when omitted.
- Ticket mailbox can change only while `messageCount = 0`; mailbox and conversation mailbox must stay in sync.
- Ticket writes require active same-workspace category/tag refs; ticket detail may still hydrate already-linked inactive category/tag refs.
- Messages are manual-first in v1:
  - `customer_message` sets status to `open`
  - `public_reply` sets status to `waiting_on_customer`
  - `internal_note` does not change status
- Closed tickets accept `internal_note` only until explicit reopen.
- Message attachments are uploaded through `/api/files` first, then linked to the message as semantic owner and to the ticket for reverse lookup.
- Assignment is single-assignee only:
  - `owner|admin` can assign any active operational member (`owner|admin|agent`)
  - `agent` uses `POST /api/tickets/:id/self-assign` only and cannot steal a ticket assigned to another user
- Participants are internal metadata only (`watcher|collaborator`); they do not grant access and are not auto-created from assignees/requesters.

## Localization

- Header: `x-lang: en|ar`, default `en`.
- Success responses are localized by the wrapper in `app.js`.
- Error responses are localized by the global error handler in `app.js`.
- Locale integrity rule:
  - `src/i18n/locales/ar.json` MUST contain Arabic user-facing strings only.
  - Do NOT add English fallback text in Arabic locale values.
  - When adding new keys, update `en.json` and `ar.json` in the same change and verify Arabic wording before finalizing.

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

## Action Response Convention

- For action routes such as `activate`, `deactivate`, `set-default`, `assign`, `unassign`, `self-assign`, `status`, `solve`, `close`, and `reopen`, prefer compact action responses over full resource detail payloads.
- Action responses should include only:
  - the resource id
  - fields directly changed by the action
  - action-specific metadata when needed
- If the client needs the full resource view, it should use the corresponding detail or list endpoint instead of relying on action responses to return the full object.

## Local File Mention Format (Direct Click)

- Use clickable markdown links for every repo file.
- Link target must be an absolute local path.
- Keep `/` path separators in link targets.
- Put each file mention on its own line.
- Do not use `http://`, `https://`, `file://`, or `vscode://`.

Examples:

- Good: [README.md](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/README.md)
- Good: [api.md](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/docs/api.md)
- Good: [workspaces.switch.test.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/tests/workspaces.switch.test.js)
- Good: [security.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/shared/utils/security.js)
- Good: [mailbox.model.js](/c:/Users/96396/Documents/GitHub/crm-support-saas-backend/src/modules/mailboxes/models/mailbox.model.js)
- Bad: @./README.md
- Bad: README.md
- Bad: `src/shared/utils/security.js`
