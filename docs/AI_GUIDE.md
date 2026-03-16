# CRM Support SaaS Backend — AI Guide

## Purpose

This repository is a backend foundation for a multi-tenant helpdesk/CRM SaaS:

- Workspaces (tenants)
- Agents (workspace users)
- Customers (contacts/end-users)
- Tickets (core entity)
- Conversations/Inbox, SLA, Integrations (later)

## Architecture (Modular, Nest-like in Express)

- Root: `app.js`, `server.js`
- `src/routes/index.js` mounts module routers under `/api`
- `src/modules/*`: feature modules
- `src/shared/*`: shared errors/middlewares/utils/validators
- `src/infra/*`: db + placeholders for jobs/storage
- `src/config/*`: env config
- Module-local pure helpers may live under `src/modules/<module>/utils`; use that instead of `services/` when the code is not business logic and is not shared across modules

## Localization

- Use header `x-lang: en|ar`
- Default language is `en`

## Response shape (CRITICAL)

- Success (<400, object body):
  - `messageKey` defaults to `success.ok`
  - `message` localized from `messageKey`
- Error:
  - `{ status, messageKey, message, errors }`

## Validation

- Use `express-validator` inside module validators
- Wrap endpoints with `validate()` middleware

## Files v1 Notes

- Files module is implemented under `src/modules/files`.
- Public API contract for downloads is `GET /api/files/:fileId/download`.
- v1 uses backend-streamed download and private bucket storage.
- Storage adapters live in `src/infra/storage` (MinIO first, local adapter fallback for tests/dev).
- Keep response envelopes and workspace isolation rules identical to the rest of the codebase.

## Mailboxes v1 Notes

- Mailboxes module is implemented under `src/modules/mailboxes`.
- Mounted base route: `/api/mailboxes`.
- Implemented endpoints:
  - `POST /api/mailboxes`
  - `GET /api/mailboxes`
  - `GET /api/mailboxes/options`
  - `GET /api/mailboxes/:id`
  - `PATCH /api/mailboxes/:id`
  - `POST /api/mailboxes/:id/set-default`
  - `POST /api/mailboxes/:id/activate`
  - `POST /api/mailboxes/:id/deactivate`
- No delete endpoint in v1 (operational flow is activate/deactivate).
- Mailbox is a shared queue abstraction in v1; `type` is currently constrained to `email`.
- RBAC:
  - `owner|admin`: read + mutate
  - `agent|viewer`: read-only
- Default rules:
  - exactly one default mailbox per workspace
  - `workspace.defaultMailboxId` must match mailbox `isDefault`
  - default mailbox must stay active
  - default mailbox cannot be deactivated
  - cannot deactivate last active mailbox
- Workspace bootstrap:
  - new workspace creation path provisions default `Support` mailbox
  - provisioning happens in `ensureWorkspaceForVerifiedUser` new-workspace branch
- Backfill command for existing data:
  - `npm run mailboxes:backfill-default`

## Tickets v1 Notes

- Tickets module is implemented under `src/modules/tickets`.
- All ticket routes are protected and workspace-scoped through the active session workspace.
- One conversation exists per ticket and is created automatically on ticket creation.
- Ticket numbers are allocated per workspace through `TicketCounter`.
- Create/update RBAC:
  - `POST /api/tickets`: `owner|admin|agent`
  - ticket record/message/lifecycle/participant writes: `owner|admin|agent`
  - category/tag mutations and `/tickets/:id/assign`: `owner|admin`
- `mailboxId` defaults from the workspace default mailbox on create.
- Ticket mailbox is mutable only before the first message; ticket and conversation mailbox ids must stay aligned.
- Ticket writes require active category/tag refs in the same workspace.
- Ticket detail may still hydrate already-linked inactive category/tag refs for historical integrity.
- Manual message flow in v1:
  - `customer_message`: requester/contact -> mailbox, status moves to `open`
  - `public_reply`: mailbox -> requester/contact, status moves to `waiting_on_customer`
  - `internal_note`: internal-only, no status change
- Closed tickets accept `internal_note` only until explicit reopen.
- Message attachments are uploaded through the files module first, then linked to both:
  - the message as semantic owner
  - the ticket for reverse lookup
- Assignment is single-owner only:
  - `owner|admin` assign operational members (`owner|admin|agent`)
  - `agent` self-assigns only and cannot take tickets assigned to another user
- Participants are internal metadata only and do not affect access control.
