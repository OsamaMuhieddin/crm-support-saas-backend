# CRM Support SaaS Backend - AI Guide

## Purpose

This repository is a backend foundation for a multi-tenant helpdesk/CRM SaaS:

- Workspaces (tenants)
- Agents (workspace users)
- Customers v1 (organizations, contacts, contact identities)
- Tickets (core entity)
- Mailboxes v1
- Files v1
- SLA v1 (business-hours, policy management, ticket runtime behavior)
- Conversations/Inbox, Integrations (later)

## Architecture (Modular, Nest-like in Express)

- Root entrypoints: `src/app.js`, `src/server.js`
- All code lives under `src/`
- `src/routes/index.js` mounts module routers under `/api`
- `src/modules/*`: feature modules
- `src/shared/*`: shared errors, middlewares, utils, validators
- `src/infra/*`: db and infrastructure adapters
- `src/config/*`: runtime env configuration
- Module-local pure helpers may live under `src/modules/<module>/utils`

Each module under `src/modules` should follow this structure when applicable:

- `index.js` (module entry; exports router)
- `routes/<module>.routes.js`
- `controllers/`
- `services/`
- `models/`
- `schemas/`
- `validators/`
- `utils/` (optional, module-local pure helpers only)

Rules:

- Controllers orchestrate request and response handling.
- Services contain business logic.
- Models define Mongoose schemas/models.
- Schemas contain reusable module-local subdocuments.
- Routes define endpoints and call controllers.
- Keep cross-module helpers in `src/shared/*`.

## Tenancy

- Workspace is the tenant root.
- Most data is or will be scoped by `workspaceId`.
- Users can belong to multiple workspaces through memberships.
- Active workspace is session-scoped via `session.workspaceId`.
- Active workspace MUST change only through `POST /api/workspaces/switch`.
- Do NOT auto-switch active workspace as a side effect of invite acceptance or invite finalization.

## Workspace Context Endpoints

- `GET /api/workspaces/mine`: list the current user's active memberships with workspace basics and role
- `POST /api/workspaces/switch`: switch active workspace for the current session and return a new access token

## Localization

- Header: `x-lang: en|ar`
- Default language is `en`
- Success responses are localized by the response wrapper in `src/app.js`
- Error responses are localized by the global error handler in `src/app.js`
- `src/i18n/locales/ar.json` MUST contain Arabic user-facing strings only
- Do NOT add English fallback text inside Arabic locale values
- When adding new keys, update both `en.json` and `ar.json` in the same change

## Response Shape (CRITICAL)

- Success (`<400`, object body):
  - `messageKey` defaults to `success.ok`
  - `message` is localized from `messageKey`
- Errors MUST always be:

```json
{
  "status": 404,
  "messageKey": "errors.notFound",
  "message": "Route not found.",
  "errors": null
}
```

- Validation failures MUST use:
  - status `422`
  - `messageKey: errors.validation.failed`
  - array payload under `errors`

Example validation error:

```json
{
  "status": 422,
  "messageKey": "errors.validation.failed",
  "message": "Validation failed.",
  "errors": [
    {
      "field": "email",
      "messageKey": "errors.validation.invalidEmail",
      "msg": "Invalid email address."
    }
  ]
}
```

## Validation

- Use `express-validator` rules inside module validators
- Wrap routes with `src/shared/middlewares/validate.js`

## API Docs Format Rules

1. Always include `Quick Start Flows` before endpoint reference sections.
2. Always include `Auth model & authorization model`, explicitly explaining workspace-scoped tokens and `roleKey`.
3. Prefer concrete requirement statements over internal middleware or guard names.
4. Define shared headers once near the top; do not duplicate them for every endpoint.
5. Every endpoint entry must include: purpose, request schema, success shape, common errors, and anti-enumeration notes when applicable.
6. Keep all examples consistent with the response envelope and include `messageKey` in success responses.

## Action Response Convention

For action routes such as `activate`, `deactivate`, `set-default`, `assign`, `unassign`, `self-assign`, `status`, `solve`, `close`, and `reopen`:

- Prefer compact action responses over full resource detail payloads
- Return only:
  - the resource id
  - fields directly changed by the action
  - action-specific metadata when needed
- If the client needs the full resource, it should call the corresponding detail or list endpoint

## Files v1 Notes

- Module: `src/modules/files`
- Storage abstraction: `src/infra/storage`
- Primary provider: MinIO/S3-compatible
- Local storage adapter exists for tests/dev fallback
- Public download contract is fixed at `GET /api/files/:fileId/download`
- v1 behavior is backend-streamed download; do not expose public object URLs
- `files` stores physical object metadata
- `file_links` stores generic polymorphic relations and supports soft-delete
- Upload permission: `owner|admin|agent`
- Delete permission: `owner|admin`
- `viewer` can read/list/download only

## Mailboxes v1 Notes

- Module: `src/modules/mailboxes`
- Mounted base route: `/api/mailboxes`
- Implemented endpoints:
  - `POST /api/mailboxes`
  - `GET /api/mailboxes`
  - `GET /api/mailboxes/options`
  - `GET /api/mailboxes/:id`
  - `PATCH /api/mailboxes/:id`
  - `POST /api/mailboxes/:id/set-default`
  - `POST /api/mailboxes/:id/activate`
  - `POST /api/mailboxes/:id/deactivate`
- No delete endpoint in v1
- `type` is currently constrained to `email`
- RBAC:
  - `owner|admin`: read + mutate
  - `agent|viewer`: read-only
- Default rules:
  - exactly one default mailbox per workspace
  - `workspace.defaultMailboxId` must match mailbox `isDefault`
  - default mailbox must stay active
  - default mailbox cannot be deactivated
  - cannot deactivate the last active mailbox
- Workspace bootstrap provisions default `Support` mailbox on new workspace creation

## Customers v1 Notes

- Module: `src/modules/customers`
- Mounted base route: `/api/customers`
- Implemented endpoints:
  - `GET /api/customers/organizations`
  - `GET /api/customers/organizations/options`
  - `GET /api/customers/organizations/:id`
  - `POST /api/customers/organizations`
  - `PATCH /api/customers/organizations/:id`
  - `GET /api/customers/contacts`
  - `GET /api/customers/contacts/options`
  - `GET /api/customers/contacts/:id`
  - `GET /api/customers/contacts/:id/identities`
  - `POST /api/customers/contacts`
  - `PATCH /api/customers/contacts/:id`
  - `POST /api/customers/contacts/:id/identities`
- Organizations and contacts are workspace-scoped customer dictionaries
- Contacts may link to same-workspace organizations
- Identities are lightweight rows linked to a contact
- Do not invent portal auth, verification, delete/archive, or timeline behavior unless explicitly requested

## SLA v1 Notes

- Module: `src/modules/sla`
- Business hours and SLA policies are separate workspace-scoped records
- Workspace default policy is canonical through `workspace.defaultSlaPolicyId`
- Mailboxes may optionally override SLA selection through `slaPolicyId`
- Ticket SLA selection order:
  - mailbox override
  - workspace default
  - otherwise no SLA
- Active SLA dimensions:
  - first response
  - resolution
- Ticket runtime rules:
  - first response is satisfied only by the first `public_reply`
  - resolution is active for `new`, `open`, `pending`
  - resolution pauses on `waiting_on_customer`
  - resolution is satisfied by `solved`
  - `closed` is downstream/admin lifecycle only
  - reopen resumes from remaining business time
- Keep list/detail reads free of hidden SLA writes; derive current SLA state in memory
- Do not add queues, reminders, escalations, next-response SLA, holidays, or cycle-history logic unless explicitly requested

## Tickets v1 Notes

- Module: `src/modules/tickets`
- Tickets are protected workspace-scoped endpoints, not public routes
- One conversation is created per ticket and linked through `ticket.conversationId`
- Ticket numbers are workspace-scoped incremental numbers from `TicketCounter`
- `POST /api/tickets` permission: `owner|admin|agent`
- `mailboxId` defaults from `workspace.defaultMailboxId` when omitted
- Ticket mailbox can change only while `messageCount = 0`; ticket and conversation mailbox ids must stay aligned
- Ticket writes require active same-workspace category/tag refs
- Ticket detail may still hydrate already-linked inactive category/tag refs for historical integrity
- Manual message flow in v1:
  - `customer_message` sets status to `open`
  - `public_reply` sets status to `waiting_on_customer`
  - `internal_note` does not change status
- Closed tickets accept `internal_note` only until explicit reopen
- Message attachments are uploaded through `/api/files` first, then linked to both:
  - the message as semantic owner
  - the ticket for reverse lookup
- Assignment is single-assignee only:
  - `owner|admin` can assign any active operational member (`owner|admin|agent`)
  - `agent` uses `POST /api/tickets/:id/self-assign` only and cannot steal a ticket assigned to another user
- Participants are internal metadata only (`watcher|collaborator`)
- Participants do not grant access and are not auto-created from assignees or requesters

## Local File Mention Format

- Use clickable markdown links for repo files
- Link target must be an absolute local path
- Keep `/` path separators in link targets
- Put each file mention on its own line
- Do not use `http://`, `https://`, `file://`, or `vscode://`
