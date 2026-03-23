# CRM Support SaaS Backend — AI Guide

## Purpose

This repository is a backend foundation for a multi-tenant helpdesk/CRM SaaS:

- Workspaces (tenants)
- Agents (workspace users)
- Customers v1 (organizations, contacts, contact identities)
- Tickets (core entity)
- Mailboxes v1
- Files v1
- SLA v1 (business-hours + policy management + ticket runtime behavior)
- Conversations/Inbox, Integrations (later)

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

## Customers v1 Notes

- Customers module is implemented under `src/modules/customers`.
- Mounted base route: `/api/customers`.
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
- Scope:
  - organizations and contacts are workspace-scoped customer dictionaries
  - contacts may link to same-workspace organizations
  - identities are lightweight rows linked to a contact
- Keep responses focused on the customer resource being read or changed.
- Do not invent customer portal auth, verification, delete/archive, or timeline features unless the prompt explicitly adds them.

## SLA v1 Notes

- SLA module is implemented under `src/modules/sla`.
- Business hours and SLA policies are separate workspace-scoped records.
- Workspace default policy is canonical through `workspace.defaultSlaPolicyId`.
- Mailboxes may optionally override SLA selection through `slaPolicyId`.
- Ticket SLA selection order is:
  - mailbox override
  - workspace default
  - otherwise no SLA
- Active SLA dimensions:
  - first response
  - resolution
- Ticket runtime rules:
  - first response is satisfied only by the first `public_reply`
  - resolution is active for `new/open/pending`
  - resolution pauses on `waiting_on_customer`
  - resolution is satisfied by `solved`
  - `closed` is downstream/admin lifecycle only
  - reopen resumes from remaining business time
- Keep list/detail reads free of hidden SLA writes; derive current SLA status in memory from stored fields.
- Do not add BullMQ/jobs, reminders, escalations, next-response SLA, holidays, or cycle-history logic unless the prompt explicitly asks for them.

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
