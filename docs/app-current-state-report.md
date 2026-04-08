# CRM Support SaaS Backend - Current State Report

Generated on: 2026-04-08  
Repository: `crm-support-saas-backend`

## 1) Report Purpose

This document is a full current-state snapshot of the backend as implemented in code today.  
It separates:

- Business context and delivered product capabilities.
- Technical architecture, APIs, tenancy/auth behavior, and data model design.

It is intended to be export-ready onboarding/context material for product, engineering, QA, and stakeholders.

## 2) Business Side

### 2.1 Product Positioning (Current State)

The backend currently delivers the multi-tenant foundation for a support CRM/helpdesk with strong identity, workspace membership, invites, file handling, and mailbox queue management.

Implemented business pillars:

- Account lifecycle with OTP verification and password recovery.
- Workspace-based tenancy and explicit active-workspace switching.
- Workspace invite lifecycle (create, resend, revoke, accept, finalize).
- Internal realtime collaboration for authenticated workspace clients, including Socket.IO bootstrap/auth/rooms, ticket/message/participant live business events, and ephemeral ticket presence/typing/soft-claim coordination.
- Billing v1 runtime with fixed catalog sync, workspace billing reads, Stripe checkout/portal entrypoints, Stripe webhook intake, and worker-backed lifecycle sync foundations.
- Secure file upload/list/download/delete inside workspace boundaries.
- Mailbox queue management with strict default-mailbox invariants.
- SLA v1 active surface: business-hours management, SLA policy management, workspace default policy assignment, mailbox optional SLA overrides, ticket SLA snapshot/runtime behavior, and lightweight SLA summary.
- Core ticket record creation/list/detail/update with workspace-scoped numbering and auto-created conversations.
- Ticket conversation and message timeline reads/writes with file attachments linked to messages and tickets.
- Ticket assignment, lifecycle actions, and internal participant management.
- Ticket categories and tags dictionary management inside workspace boundaries.
- Workspace-scoped reporting endpoints for overview, tickets, SLA, and team analytics.
- Platform-admin authentication/session runtime with isolated platform tokens and sessions.
- Cross-workspace platform admin inspection and explicit suspend/reactivate/extend-trial actions.
- Platform analytics/reporting for overview, metrics, and billing visibility.
- Minimal self-profile update for authenticated users (`profile.name`, `profile.avatar`).

Partially implemented business pillars:

- Customers v1 currently covers workspace-scoped organizations, contacts, and a minimal ContactIdentity surface, while richer customer workflows are still pending.
- SLA v1 now covers first-response and resolution runtime behavior on tickets, while next-response, jobs, holidays, reminders/escalations, cycle-history, and historical reporting remain postponed.
- Users API surface is still a list stub.

Planned business pillars with data models but no live API flows yet:

- Integrations management.
- Billing enforcement across invites, mailboxes, files, tickets, and SLA capability.
- Automations execution.
- Notifications delivery workflows.
- Deeper platform support/monitoring workflows beyond the current admin auth, analytics, and cross-workspace management surface.

### 2.2 Personas and Roles (Implemented)

Workspace roles:

- `owner`
- `admin`
- `agent`
- `viewer`

Current effective permissions by feature:

| Feature                                                  | Owner           | Admin           | Agent                        | Viewer                       |
| -------------------------------------------------------- | --------------- | --------------- | ---------------------------- | ---------------------------- |
| Auth lifecycle (`signup/login/refresh/...`)              | Yes             | Yes             | Yes                          | Yes                          |
| List memberships (`GET /workspaces/mine`)                | Yes             | Yes             | Yes                          | Yes                          |
| Switch workspace (`POST /workspaces/switch`)             | Yes (if member) | Yes (if member) | Yes (if member)              | Yes (if member)              |
| Manage invites in workspace                              | Yes             | Yes             | No                           | No                           |
| Accept invite (token-based, no auth)                     | Yes             | Yes             | Yes                          | Yes                          |
| Upload files                                             | Yes             | Yes             | Yes                          | No                           |
| List/get/download files                                  | Yes             | Yes             | Yes                          | Yes                          |
| Delete files                                             | Yes             | Yes             | No                           | No                           |
| Create/update/activate/deactivate/set-default mailbox    | Yes             | Yes             | No                           | No                           |
| Read mailbox lists/options/details                       | Yes             | Yes             | Yes (inactive hidden)        | Yes (inactive hidden)        |
| Create/update business hours                             | Yes             | Yes             | No                           | No                           |
| Create/update/activate/deactivate/set-default SLA policy | Yes             | Yes             | No                           | No                           |
| Read SLA summary/business hours/policies                 | Yes             | Yes             | Yes (inactive policy hidden) | Yes (inactive policy hidden) |
| Create/update ticket records                             | Yes             | Yes             | Yes                          | No                           |
| Read ticket lists/details                                | Yes             | Yes             | Yes                          | Yes                          |
| Read ticket conversations/messages                       | Yes             | Yes             | Yes                          | Yes                          |
| Create ticket messages                                   | Yes             | Yes             | Yes                          | No                           |
| Assign tickets                                           | Yes             | Yes             | No                           | No                           |
| Unassign/self-assign tickets                             | Yes             | Yes             | Yes                          | No                           |
| Change ticket lifecycle/status                           | Yes             | Yes             | Yes                          | No                           |
| Read ticket participants                                 | Yes             | Yes             | Yes                          | Yes                          |
| Add/remove ticket participants                           | Yes             | Yes             | Yes                          | No                           |
| Create/update/activate/deactivate ticket categories/tags | Yes             | Yes             | No                           | No                           |
| Read ticket category/tag lists/options/details           | Yes             | Yes             | Yes (inactive hidden)        | Yes (inactive hidden)        |

### 2.3 Quick Start Flows (Implemented)

#### Flow A: Signup -> Verify Email -> Session

1. User signs up with email/password.
2. OTP is generated and sent (SendGrid/SMTP/fallback logging).
3. User verifies OTP with `/api/auth/verify-email`.
4. If first verified login, workspace + owner membership are bootstrapped.
5. Session is created and tokens are returned.

#### Flow B: Login -> Refresh -> Me

1. Verified active user logs in with email/password.
2. Access + refresh tokens are issued for one workspace context.
3. Refresh rotates refresh token and access token.
4. `/api/auth/me` hydrates canonical user/workspace/role context.

#### Flow C: Invite Lifecycle

1. Owner/Admin creates invite for workspace.
2. Invite can be listed/read/resend/revoke.
3. Invitee accepts token via `/api/workspaces/invites/accept`.
4. If already verified: membership becomes active immediately.
5. If unverified/new: OTP verification is required to finalize acceptance.
6. Finalization occurs in `/api/auth/verify-email` when `inviteToken` is supplied.

#### Flow D: Explicit Workspace Switch

1. User with multiple memberships calls `/api/workspaces/switch`.
2. Session workspace context is updated.
3. New access token is minted with new `wid`/`role`.
4. Old access token becomes invalid because session `workspaceId` changed.
5. Existing realtime sockets for that session are disconnected so the client can reconnect under the new workspace-scoped token.

#### Flow E: Files v1

1. User uploads one file via multipart (`POST /api/files`).
2. File metadata stored in `files` collection; storage object saved in MinIO/local provider.
3. List and metadata retrieval available with pagination and filters.
4. Download is backend-streamed only via `/api/files/:fileId/download`.
5. Delete removes storage object then soft-deletes DB file + related active file links.

#### Flow F: Mailboxes v1

1. Workspace bootstrap ensures one default active mailbox (`Support`).
2. Owner/Admin can create additional mailboxes.
3. Read endpoints support list/search/filter/options/details.
4. Default mailbox can be changed explicitly.
5. Default mailbox cannot be deactivated; last active mailbox cannot be deactivated.
6. Backfill script repairs default mailbox consistency across existing workspaces.

#### Flow G: Customers v1

1. Workspace members create organizations when customer contacts should be grouped under a company/account record.
2. Workspace members create contacts as external requester/customer records, with optional organization linkage.
3. Contact list/detail/options responses stay intentionally lean and workspace-scoped.
4. Contact email is normalized for matching and future-safe lookup flows, while optional phone values are validated professionally and stored in normalized international form.
5. Ticket creation continues to reference `contactId`, and organization context can still be derived from the linked contact.
6. Ticket list/detail reads continue to hydrate only lightweight contact and organization summaries instead of broad customer graphs.
7. ContactIdentity v1 now exposes lightweight list/create endpoints under contacts without adding verification, delete/archive, or customer-auth flows.

#### Flow H: Tickets Core

1. Owner/Admin maintains ticket categories and tags inside the active workspace when structured routing metadata is needed.
2. Owner/Admin/Agent creates ticket records with `POST /api/tickets`.
3. Ticket creation allocates the next workspace-scoped ticket number and auto-creates a single conversation.
4. Files are uploaded first through the files module and can then be linked to create-time or later ticket messages.
5. Ticket conversation and message history can be read through dedicated conversation/message endpoints.
6. Manual message writes populate `from/to` parties from the contact and mailbox, update ticket/conversation counters, and apply message-driven status rules (`customer_message -> open`, `public_reply -> waiting_on_customer`, `internal_note -> no status change`).
7. Explicit assignment actions manage a single active `assigneeId`, `assignedAt`, and safe self-assignment rules.
8. Explicit lifecycle actions manage `status`, `statusChangedAt`, `closedAt`, and live resolution markers.
9. Participant endpoints manage internal watcher/collaborator metadata and keep `participantCount` synchronized.
10. Ticket patch updates editable record fields only, and mailbox changes stop once the ticket has messages while preserving the one-conversation mailbox invariant.

#### Flow I: SLA v1 Active Surface

1. Owner/Admin creates business-hours records inside the active workspace.
2. Owner/Admin creates SLA policies that reference same-workspace business hours and define rules by ticket priority.
3. Owner/Admin can set one active policy as the workspace default.
4. Owner/Admin can optionally assign an active SLA policy to a mailbox as an override.
5. Ticket creation snapshots the effective policy using mailbox override first, then workspace default, then no SLA.
6. First response SLA is satisfied only by the first `public_reply`; resolution SLA runs on `new/open/pending`, pauses on `waiting_on_customer`, and is satisfied by `solved`.
7. Reopen resumes from remaining business time instead of resetting a fresh resolution target, while `closed` remains downstream of resolution success.
8. Ticket list/detail/action responses derive SLA statuses in memory, and `GET /api/sla/summary` exposes lightweight runtime-aware workspace totals without hidden writes.

#### Flow J: Billing v1 Workspace Billing Runtime

1. Owner/Admin authenticates with a workspace-scoped access token.
2. Frontend loads `GET /api/billing/catalog` to read the fixed active plan/add-on catalog.
3. Frontend loads `GET /api/billing/summary` to bootstrap current subscription, entitlements, usage, and trial/grace flags.
4. Frontend can start first paid setup with `POST /api/billing/checkout-session`.
5. Existing paying workspaces can open Stripe Billing Portal with `POST /api/billing/portal-session`.
6. Stripe webhooks land on `POST /api/billing/webhooks/stripe`, are persisted idempotently, and are processed through billing workers.
7. The backend auto-syncs the fixed catalog and auto-creates missing workspace billing foundation records on demand.

### 2.4 Business State Summary

Production-ready business slices:

- Authentication and session model.
- Workspace membership and invite lifecycle.
- Workspace switching.
- File operations v1.
- Mailboxes v1.
- SLA v1 active runtime surface for first response and resolution.
- Customers organizations, contacts, and minimal contact identities v1.
- Tickets core record flow.
- Ticket assignment, lifecycle, and participants flows.
- Ticket conversation/message flow with attachment linking.
- Ticket categories and tags dictionaries.

Foundation-only slices:

- Users API stub.
- Inbox/Integrations routes mounted but empty.
- SLA v1 next-response/jobs/reporting/holiday/cycle-history additions beyond the active runtime surface.
- Billing runtime now covers catalog sync, workspace billing reads, checkout/portal entrypoints, Stripe webhook intake, and lifecycle sync foundations; automations/notifications remain model-only.

## 3) Technical Side

### 3.1 Runtime Architecture

Backend stack:

- Node.js + Express (ESM).
- MongoDB + Mongoose.
- JWT for auth.
- Socket.IO for internal realtime transport.
- Shared optional Redis foundation for realtime fan-out today and future platform consumers later.
- Modest collaboration-action throttling plus best-effort expiry cleanup for ephemeral presence, typing, and soft-claim signals.
- `express-validator` for request validation.
- Multer for file multipart upload.
- MinIO/S3-compatible storage adapter + local storage adapter.

Architecture pattern:

- Entrypoints: `src/app.js`, `src/server.js`.
- Route mounting root: `src/routes/index.js` under `/api`.
- Modular feature folders in `src/modules/*`.
- Shared cross-cutting utilities in `src/shared/*`.
- Infrastructure adapters in `src/infra/*`, now including realtime runtime/bootstrap helpers.
- Runtime config in `src/config/*`.

Module structure convention:

- `index.js`
- `routes/<module>.routes.js`
- `controllers/`
- `services/`
- `models/`
- `schemas/`
- `validators/`

### 3.2 Request Lifecycle and Envelope

Pipeline:

1. CORS, JSON parser, morgan logger.
2. Language middleware sets `req.lang` from `x-lang` or `accept-language`.
3. Success-response wrapper localizes `message` for status `<400` object bodies.
4. Route handlers execute.
5. 404 fallback returns `{ status, messageKey }`.
6. Global error handler returns `{ status, messageKey, message, errors }` with localized messages.

Localization behavior:

- Supported languages: `en`, `ar`.
- Default language: `en`.
- Translation keys support nested dot-path lookup.
- Template interpolation supports `{{arg}}` placeholders.

Validation behavior:

- `validate()` supports both express-validator rules and custom validation functions.
- Validation failures always return:
- status `422`
- `messageKey: errors.validation.failed`
- error entries in `errors[]`.

### 3.3 Auth, Session, and Tenancy Model

#### Access Token (JWT)

Claims:

- `sub`: user id
- `sid`: session id
- `wid`: active workspace id
- `r`: role key in active workspace
- `typ`: `access`
- `ver`: `1`

Verification requirements:

- Valid signature, issuer, audience, expiry.
- Token fields must exist (`sub/sid/wid/r/typ/ver`).
- Backing session must exist, not revoked, not expired.
- Session `workspaceId` must equal token `wid`.

#### Refresh Token (JWT)

Claims:

- `sub`: user id
- `sid`: session id
- `jti`: random UUID
- `typ`: `refresh`
- `ver`: `1`

Refresh behavior:

- Refresh token hash is stored in session.
- Refresh rotates refresh token hash and session expiry.
- If refresh hash mismatch occurs, session is revoked (token replay/theft defense).

#### Session Context

Each session has one active workspace context (`session.workspaceId`).

Active workspace resolution for auth flows:

1. Session workspace (if active membership exists).
2. User last workspace.
3. User default workspace.
4. First active membership.

Workspace switch:

- Only via `POST /api/workspaces/switch`.
- Validates target workspace membership and member active status.
- Updates `session.workspaceId` and user `lastWorkspaceId`.
- Returns a newly minted access token.

#### Membership and Role Guards

Guards used:

- `requireAuth`: validates JWT + session coherence.
- `requireActiveUser`: user exists, not deleted, status active.
- `requireActiveMember`: active membership in token workspace.
- `requireWorkspaceRole(...)`: role check based on membership role.

Tenant enforcement:

- For workspace-scoped invite management routes, `:workspaceId` must match token workspace.
- Cross-workspace resource lookup typically resolves to `404` for anti-enumeration.

### 3.4 API Surface Inventory

Base prefix: `/api`

#### Public Endpoints

| Method | Path                         | Purpose                 | Notes                                                             |
| ------ | ---------------------------- | ----------------------- | ----------------------------------------------------------------- |
| `GET`  | `/health`                    | Health check            | Returns `{ status: "ok" }` payload with localized success wrapper |
| `POST` | `/workspaces/invites/accept` | Accept invite token     | No bearer token required                                          |
| `POST` | `/auth/signup`               | Start signup, send OTP  | Public                                                            |
| `POST` | `/auth/resend-otp`           | Resend OTP by purpose   | Public with anti-enumeration behavior                             |
| `POST` | `/auth/verify-email`         | Verify OTP and login    | Public                                                            |
| `POST` | `/auth/login`                | Login                   | Public                                                            |
| `POST` | `/auth/refresh`              | Refresh session tokens  | Public                                                            |
| `POST` | `/auth/forgot-password`      | Forgot password OTP     | Public                                                            |
| `POST` | `/auth/reset-password`       | Reset password with OTP | Public                                                            |
| `GET`  | `/users`                     | Users stub list         | Public placeholder                                                |

#### Authenticated Auth Endpoints

| Method | Path                    | Purpose                                         |
| ------ | ----------------------- | ----------------------------------------------- |
| `GET`  | `/auth/me`              | Return canonical user + active workspace + role |
| `POST` | `/auth/logout`          | Revoke current session                          |
| `POST` | `/auth/logout-all`      | Revoke all sessions for current user            |
| `POST` | `/auth/change-password` | Change password and revoke all sessions         |

Auth requirements:

- Require valid bearer access token.
- Require active user.
- Auth/session revocation flows now best-effort disconnect any connected realtime sockets bound to the revoked sessions.

#### Tickets Endpoints

| Method   | Path                                 | Purpose                                                      | Role requirements                                                     |
| -------- | ------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| `POST`   | `/tickets`                           | Create ticket record + allocate number + create conversation | `owner/admin/agent`                                                   |
| `GET`    | `/tickets`                           | List tickets with pagination/filter/search/sort              | Any active member (`owner/admin/agent/viewer`)                        |
| `GET`    | `/tickets/:id`                       | Get ticket detail                                            | Any active member (`owner/admin/agent/viewer`)                        |
| `POST`   | `/tickets/:id/assign`                | Assign ticket to an operational user                         | `owner/admin`                                                         |
| `POST`   | `/tickets/:id/unassign`              | Clear ticket assignee                                        | `owner/admin/agent`                                                   |
| `POST`   | `/tickets/:id/self-assign`           | Assign ticket to current user                                | `owner/admin/agent`                                                   |
| `POST`   | `/tickets/:id/status`                | Perform explicit non-close status transition                 | `owner/admin/agent`                                                   |
| `POST`   | `/tickets/:id/solve`                 | Mark ticket as solved                                        | `owner/admin/agent`                                                   |
| `POST`   | `/tickets/:id/close`                 | Close solved ticket                                          | `owner/admin/agent`                                                   |
| `POST`   | `/tickets/:id/reopen`                | Reopen solved/closed ticket                                  | `owner/admin/agent`                                                   |
| `GET`    | `/tickets/:id/conversation`          | Get ticket conversation summary                              | Any active member (`owner/admin/agent/viewer`)                        |
| `GET`    | `/tickets/:id/messages`              | List ticket messages                                         | Any active member (`owner/admin/agent/viewer`)                        |
| `POST`   | `/tickets/:id/messages`              | Create ticket message                                        | `owner/admin/agent`                                                   |
| `GET`    | `/tickets/:id/participants`          | List internal ticket participants                            | Any active member (`owner/admin/agent/viewer`)                        |
| `POST`   | `/tickets/:id/participants`          | Add or update ticket participant                             | `owner/admin/agent`                                                   |
| `DELETE` | `/tickets/:id/participants/:userId`  | Remove ticket participant                                    | `owner/admin/agent`                                                   |
| `PATCH`  | `/tickets/:id`                       | Update editable ticket fields                                | `owner/admin/agent`                                                   |
| `GET`    | `/tickets/categories`                | List ticket categories                                       | Any active member; inactive visibility restricted for non-admin roles |
| `GET`    | `/tickets/categories/options`        | Lightweight ticket category options                          | Any active member; inactive visibility restricted for non-admin roles |
| `GET`    | `/tickets/categories/:id`            | Get ticket category details                                  | Any active member; inactive hidden for non-admin roles                |
| `POST`   | `/tickets/categories`                | Create ticket category                                       | `owner/admin`                                                         |
| `PATCH`  | `/tickets/categories/:id`            | Update ticket category                                       | `owner/admin`                                                         |
| `POST`   | `/tickets/categories/:id/activate`   | Activate ticket category                                     | `owner/admin`                                                         |
| `POST`   | `/tickets/categories/:id/deactivate` | Deactivate ticket category                                   | `owner/admin`                                                         |
| `GET`    | `/tickets/tags`                      | List ticket tags                                             | Any active member; inactive visibility restricted for non-admin roles |
| `GET`    | `/tickets/tags/options`              | Lightweight ticket tag options                               | Any active member; inactive visibility restricted for non-admin roles |
| `GET`    | `/tickets/tags/:id`                  | Get ticket tag details                                       | Any active member; inactive hidden for non-admin roles                |
| `POST`   | `/tickets/tags`                      | Create ticket tag                                            | `owner/admin`                                                         |
| `PATCH`  | `/tickets/tags/:id`                  | Update ticket tag                                            | `owner/admin`                                                         |
| `POST`   | `/tickets/tags/:id/activate`         | Activate ticket tag                                          | `owner/admin`                                                         |
| `POST`   | `/tickets/tags/:id/deactivate`       | Deactivate ticket tag                                        | `owner/admin`                                                         |

Tickets notes:

- Tickets are no longer a public endpoint.
- The current ticket runtime surface includes core ticket records, conversation/message flows, and workspace-scoped category/tag dictionaries.
- Ticket creation can include a minimal initial message (`customer_message` or `internal_note`) with uploaded-file attachments.
- Ticket message attachments are linked to the message as the semantic owner and to the ticket for reverse lookup.
- Ticket message attachment payloads are lightweight summaries only: `_id`, `url`, `originalName`, `mimeType`, `sizeBytes`.
- Ticket message payloads omit route-redundant ids and duplicate id-only fields when hydrated objects are already returned.
- Closed tickets accept `internal_note` only until explicit reopen.
- Ticket writes require active category/tag refs, while ticket detail still hydrates already-linked inactive refs.
- `PATCH /api/tickets/:id` accepts a partial editable body but returns the full hydrated updated ticket payload.
- Assignment and lifecycle action endpoints return action-scoped ticket summaries instead of the full hydrated ticket detail payload.
- Participant rows omit redundant `workspaceId` and `ticketId` fields because the route is already ticket-scoped.
- `POST /api/tickets/:id/assign` is `owner|admin` only; agents use `POST /api/tickets/:id/self-assign` and cannot steal assigned tickets.

#### Workspace Context and Invite Management Endpoints

| Method | Path                                                | Purpose                                        | Role requirements                                            |
| ------ | --------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| `GET`  | `/workspaces/mine`                                  | List active memberships + current workspace id | Any authenticated active user                                |
| `POST` | `/workspaces/switch`                                | Explicitly switch active workspace for session | Any authenticated active user who is active member in target |
| `POST` | `/workspaces/:workspaceId/invites`                  | Create invite                                  | `owner/admin` in token workspace + tenant match              |
| `GET`  | `/workspaces/:workspaceId/invites`                  | List invites                                   | `owner/admin` in token workspace + tenant match              |
| `GET`  | `/workspaces/:workspaceId/invites/:inviteId`        | Get invite                                     | `owner/admin` in token workspace + tenant match              |
| `POST` | `/workspaces/:workspaceId/invites/:inviteId/resend` | Resend invite token/email                      | `owner/admin` in token workspace + tenant match              |
| `POST` | `/workspaces/:workspaceId/invites/:inviteId/revoke` | Revoke invite                                  | `owner/admin` in token workspace + tenant match              |

#### Files v1 Endpoints

| Method   | Path                      | Purpose                                 | Role requirements                              |
| -------- | ------------------------- | --------------------------------------- | ---------------------------------------------- |
| `POST`   | `/files`                  | Upload single file                      | `owner/admin/agent`                            |
| `GET`    | `/files`                  | List files with filters/pagination      | Any active member (`owner/admin/agent/viewer`) |
| `GET`    | `/files/:fileId`          | Fetch file metadata                     | Any active member                              |
| `GET`    | `/files/:fileId/download` | Stream file content                     | Any active member                              |
| `DELETE` | `/files/:fileId`          | Delete file object + soft-delete record | `owner/admin`                                  |

Files notes:

- Upload/download have in-memory rate limiting.
- Upload validation enforces mime/extension allowlists and max size.
- Download contract is fixed at `/api/files/:fileId/download`.

#### Customers / Organizations v1 + Contacts v1 + ContactIdentity v1 Endpoints

| Method  | Path                                 | Purpose                                            | Role requirements                              |
| ------- | ------------------------------------ | -------------------------------------------------- | ---------------------------------------------- |
| `GET`   | `/customers/organizations`           | List organizations (pagination/search/filter/sort) | Any active member (`owner/admin/agent/viewer`) |
| `GET`   | `/customers/organizations/options`   | Lightweight organization options                   | Any active member (`owner/admin/agent/viewer`) |
| `GET`   | `/customers/organizations/:id`       | Get organization details                           | Any active member (`owner/admin/agent/viewer`) |
| `POST`  | `/customers/organizations`           | Create organization                                | `owner/admin/agent`                            |
| `PATCH` | `/customers/organizations/:id`       | Update organization                                | `owner/admin/agent`                            |
| `GET`   | `/customers/contacts`                | List contacts (pagination/search/filter/sort)      | Any active member (`owner/admin/agent/viewer`) |
| `GET`   | `/customers/contacts/options`        | Lightweight contact options                        | Any active member (`owner/admin/agent/viewer`) |
| `GET`   | `/customers/contacts/:id`            | Get contact details                                | Any active member (`owner/admin/agent/viewer`) |
| `GET`   | `/customers/contacts/:id/identities` | List lightweight contact identities                | Any active member (`owner/admin/agent/viewer`) |
| `POST`  | `/customers/contacts`                | Create contact                                     | `owner/admin/agent`                            |
| `PATCH` | `/customers/contacts/:id`            | Update contact                                     | `owner/admin/agent`                            |
| `POST`  | `/customers/contacts/:id/identities` | Create contact identity                            | `owner/admin/agent`                            |

Customers notes:

- Organization and contact endpoints are protected and workspace-scoped through the active session workspace.
- Organization and contact writes reject unknown body fields and use partial-update validation with at-least-one-field enforcement.
- Organization search matches `name` and `domain`; contact search matches `fullName` and `email`.
- Contact responses stay intentionally scoped to the resource itself, with only lightweight organization summaries when linked.
- Ticket reads continue to reuse lightweight same-workspace customer summaries for contact/organization context rather than embedding larger customer payloads.
- ContactIdentity list/create endpoints require resolving the parent contact inside the active workspace before reading or writing identities.
- ContactIdentity uniqueness is enforced on normalized workspace-scoped values, so email case and phone formatting variants are treated as the same identity.
- Stored ContactIdentity `email` values are normalized to lowercase, and stored `phone` / `whatsapp` values are normalized to stable international form.
- Contact and ContactIdentity phone values are validated as plausible numbers and normalized consistently, without introducing OTP, verification, or customer-auth semantics.
- ContactIdentity responses stay intentionally lightweight and do not expose `valueNormalized`, verification workflows, or unrelated linked collections.
- No delete/archive organization or contact endpoint exists in v1.
- ContactIdentity v1 does not include update/delete/archive, OTP, widget session, or customer-auth behavior.

#### Mailboxes v1 Endpoints

| Method  | Path                         | Purpose                                        | Role requirements                                                     |
| ------- | ---------------------------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| `GET`   | `/mailboxes`                 | List mailboxes (pagination/filter/search/sort) | Any active member; inactive visibility restricted for non-admin roles |
| `GET`   | `/mailboxes/options`         | Lightweight options list                       | Any active member; inactive visibility restricted for non-admin roles |
| `GET`   | `/mailboxes/:id`             | Get mailbox details                            | Any active member; inactive hidden for non-admin roles                |
| `POST`  | `/mailboxes`                 | Create mailbox                                 | `owner/admin`                                                         |
| `PATCH` | `/mailboxes/:id`             | Update mailbox                                 | `owner/admin`                                                         |
| `POST`  | `/mailboxes/:id/set-default` | Set workspace default mailbox                  | `owner/admin`                                                         |
| `POST`  | `/mailboxes/:id/activate`    | Activate mailbox                               | `owner/admin`                                                         |
| `POST`  | `/mailboxes/:id/deactivate`  | Deactivate mailbox                             | `owner/admin`                                                         |

Mailbox notes:

- v1 mailbox `type` accepted by validators is only `email`.
- Mailboxes now support optional `slaPolicyId` assignment to an active same-workspace SLA policy.
- Omitting `slaPolicyId` keeps previous mailbox create/update flows fully backward compatible.
- Mailbox action endpoints (`set-default/activate/deactivate`) return compact action payloads instead of full mailbox detail objects.
- No mailbox delete endpoint in v1.

#### SLA v1 Active Endpoints

| Method  | Path                            | Purpose                                            | Role requirements                                                     |
| ------- | ------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| `GET`   | `/sla/summary`                  | Lightweight SLA current-state summary              | Any active member                                                     |
| `GET`   | `/sla/business-hours`           | List business-hours records                        | Any active member                                                     |
| `GET`   | `/sla/business-hours/options`   | Lightweight business-hours options                 | Any active member                                                     |
| `GET`   | `/sla/business-hours/:id`       | Get business-hours details                         | Any active member                                                     |
| `POST`  | `/sla/business-hours`           | Create business-hours record                       | `owner/admin`                                                         |
| `PATCH` | `/sla/business-hours/:id`       | Update business-hours record                       | `owner/admin`                                                         |
| `GET`   | `/sla/policies`                 | List SLA policies                                  | Any active member; inactive visibility restricted for non-admin roles |
| `GET`   | `/sla/policies/options`         | Lightweight SLA policy options                     | Any active member; inactive visibility restricted for non-admin roles |
| `GET`   | `/sla/policies/:id`             | Get SLA policy details                             | Any active member; inactive hidden for non-admin roles                |
| `POST`  | `/sla/policies`                 | Create SLA policy                                  | `owner/admin`                                                         |
| `PATCH` | `/sla/policies/:id`             | Update SLA policy                                  | `owner/admin`                                                         |
| `POST`  | `/sla/policies/:id/activate`    | Activate SLA policy                                | `owner/admin`                                                         |
| `POST`  | `/sla/policies/:id/deactivate`  | Deactivate SLA policy and clear active assignments | `owner/admin`                                                         |
| `POST`  | `/sla/policies/:id/set-default` | Set workspace default SLA policy                   | `owner/admin`                                                         |

SLA notes:

- Business hours are managed as separate records with `name`, `timezone`, and weekday windows.
- Policies reference business hours through `businessHoursId`.
- Active v1 rules expose only `firstResponseMinutes` and `resolutionMinutes` by ticket priority.
- Every stored SLA policy must define at least one active rule field for every priority; policy patch stays partial-input but validates the merged final ruleset.
- Policy selection order is active on ticket create: mailbox override, then workspace default, then no SLA.
- Deactivating a policy always clears any `mailbox.slaPolicyId` values that point to that policy.
- Deactivation can optionally accept a replacement policy id; when provided and the deactivated policy was the current workspace default, the workspace default is swapped to that active same-workspace replacement inside the same action.
- The same deactivation action also repairs stale cases where `workspace.defaultSlaPolicyId` still points to an already-inactive policy.
- Without a replacement, deactivating the current default clears `workspace.defaultSlaPolicyId` and surfaces response metadata so owners/admins can prompt for a new default.
- `workspace.defaultSlaPolicyId` is the canonical default source; `SlaPolicy.isDefault` is a denormalized read flag that is reconciled back to the workspace pointer during default-changing actions.
- SLA policy action endpoints (`activate/deactivate/set-default`) return compact action payloads instead of full policy detail objects.
- Ticket create snapshots the selected policy/business-hours ids and names onto `ticket.sla`; future policy/business-hours edits affect only new tickets.
- Ticket patch recalculates the stored SLA snapshot when `priority` changes and when `mailboxId` changes before any messages exist.
- First response SLA is satisfied only by the first `public_reply`.
- Resolution SLA is active for `new/open/pending`, paused by `waiting_on_customer`, satisfied by `solved`, preserved through `closed`, and resumed on reopen from remaining business time.
- Ticket list/detail/action responses derive SLA statuses from stored raw fields without hidden write-backs.
- `GET /api/sla/summary` now reports `ticketLifecycleIntegrated: true` plus runtime-derived applicable/breached and first-response/resolution status counts.

#### Mounted Route Groups with No Endpoints

Mounted but currently empty routers:

- `/inbox`
- `/integrations`
- `/admin`

Any request under those paths currently falls through to 404.

### 3.5 Module Implementation Status

| Module          | Router Mounted | Runtime API Behavior                                                                                                                               | Service/Model State                                                                                                                                                                                                            |
| --------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `health`        | Yes            | Implemented                                                                                                                                        | Simple health service                                                                                                                                                                                                          |
| `auth`          | Yes            | Implemented                                                                                                                                        | Full OTP/JWT/session lifecycle                                                                                                                                                                                                 |
| `workspaces`    | Yes            | Implemented                                                                                                                                        | Membership resolution, switch, invite lifecycle                                                                                                                                                                                |
| `files`         | Yes            | Implemented                                                                                                                                        | Upload/list/get/download/delete + storage abstraction                                                                                                                                                                          |
| `mailboxes`     | Yes            | Implemented                                                                                                                                        | CRUD-like v1 + default invariants + backfill                                                                                                                                                                                   |
| `users`         | Yes            | Stub (`GET /users`)                                                                                                                                | Model implemented, service placeholder                                                                                                                                                                                         |
| `customers`     | Yes            | Organizations v1 + Contacts v1 + minimal ContactIdentity v1                                                                                        | Organization list/options/detail/create/update implemented; contact list/options/detail/create/update implemented; contact identity list/create implemented without verification/update/delete flows                           |
| `tickets`       | Yes            | Core tickets + message timeline + assignment/lifecycle/participants + ticket category/tag dictionaries                                             | Real ticket create/list/detail/update/message flows plus assignment/lifecycle/participant runtime flows and category/tag validator/controller/service/runtime flows                                                            |
| `sla`           | Yes            | SLA v1 active surface with management APIs and ticket runtime integration                                                                          | Business-hours CRUD-like flows, SLA policy CRUD-like flows, workspace default pointer, mailbox override references, ticket snapshot/runtime shaping, summary endpoint, runtime helpers, tests                                  |
| `inbox`         | Yes            | Empty router                                                                                                                                       | Placeholder                                                                                                                                                                                                                    |
| `integrations`  | Yes            | Empty router                                                                                                                                       | Models implemented, API not implemented                                                                                                                                                                                        |
| `admin`         | Yes            | Empty router                                                                                                                                       | Placeholder                                                                                                                                                                                                                    |
| `automations`   | No             | No API                                                                                                                                             | Model implemented only                                                                                                                                                                                                         |
| `billing`       | Yes            | Workspace billing runtime (`catalog`, `subscription`, `entitlements`, `usage`, `summary`, `checkout-session`, `portal-session`, `webhooks/stripe`) | Fixed catalog sync, subscription foundation bootstrap, entitlement snapshot recompute, monthly usage meter foundation, Stripe checkout/portal entrypoints, billing webhook inbox persistence, and worker-backed lifecycle sync |
| `notifications` | No             | No API                                                                                                                                             | Model implemented only                                                                                                                                                                                                         |
| `platform`      | No             | No API                                                                                                                                             | Models implemented only                                                                                                                                                                                                        |
| `roles`         | No             | No API                                                                                                                                             | No schema content yet                                                                                                                                                                                                          |

### 3.6 Database Design (Mongoose)

#### 3.6.1 Data Modeling Conventions

- `strict: true` on schemas.
- `timestamps: true` on nearly all persisted models.
- Widespread soft-delete pattern via `deletedAt` and often `deletedByUserId`.
- Extensive workspace scoping via `workspaceId` across tenant data.
- Selected collections use TTL indexes for lifecycle expiration.

#### 3.6.2 Core Identity and Tenancy Collections

| Model             | Purpose                               | Key Fields                                                                                                                       | Important Indexes/Constraints                                                                               |
| ----------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `User`            | End-user identity/account             | `email`, `emailNormalized`, `passwordHash`, `isEmailVerified`, `status`, `defaultWorkspaceId`, `lastWorkspaceId`, `platformRole` | Unique `emailNormalized`; indexes on `defaultWorkspaceId`, `platformRole`                                   |
| `Session`         | Refresh-session persistence           | `userId`, `workspaceId`, `refreshTokenHash`, `expiresAt`, `revokedAt`                                                            | TTL on `expiresAt`; index `refreshTokenHash`; index on (`userId`, `revokedAt`, `expiresAt`)                 |
| `OtpCode`         | OTP verification/password reset codes | `emailNormalized`, `userId`, `purpose`, `codeHash`, `expiresAt`, `consumedAt`, `attemptCount`, `lastSentAt`                      | TTL on `expiresAt`; index (`emailNormalized`, `purpose`, `createdAt`)                                       |
| `Workspace`       | Tenant root                           | `name`, `slug`, `status`, `ownerUserId`, `defaultMailboxId`, `defaultSlaPolicyId`, `settings.timeZone`                           | Unique partial `slug` when not deleted; indexes `ownerUserId`, `status`                                     |
| `WorkspaceMember` | User membership in workspace          | `workspaceId`, `userId`, `roleKey`, `status`, `joinedAt`, `removedAt`                                                            | Unique (`workspaceId`, `userId`); indexes (`workspaceId`, `status`), (`workspaceId`, `roleKey`)             |
| `WorkspaceInvite` | Invite tokens and state               | `workspaceId`, `emailNormalized`, `roleKey`, `tokenHash`, `status`, `expiresAt`, `acceptedAt`                                    | Unique `tokenHash`; unique partial pending invite on (`workspaceId`, `emailNormalized`); TTL on `expiresAt` |

#### 3.6.3 Mailbox Domain Collections

| Model          | Purpose                             | Key Fields                                                                                      | Important Indexes/Constraints                                                                                                                                                           |
| -------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Mailbox`      | Workspace support queue mailbox     | `workspaceId`, `name`, `type`, `emailAddressNormalized`, `slaPolicyId`, `isDefault`, `isActive` | Unique partial (`workspaceId`, `isDefault`) where default+not deleted; unique partial (`workspaceId`, `emailAddressNormalized`) for non-deleted docs; multiple list-performance indexes |
| `MailboxAlias` | Additional alias emails per mailbox | `workspaceId`, `mailboxId`, `aliasEmailNormalized`, `isActive`                                  | Unique partial (`workspaceId`, `aliasEmailNormalized`) where not deleted; index (`workspaceId`, `mailboxId`)                                                                            |

#### 3.6.4 Files Domain Collections

| Model      | Purpose                                   | Key Fields                                                                                                                               | Important Indexes/Constraints                                                                                                                   |
| ---------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `File`     | Physical storage metadata                 | `workspaceId`, `uploadedByUserId`, `provider`, `bucket`, `objectKey`, `mimeType`, `originalNameNormalized`, `storageStatus`, `deletedAt` | Unique (`provider`, `bucket`, `objectKey`); workspace-scoped indexes for query filters/sorting                                                  |
| `FileLink` | Polymorphic relation of files to entities | `workspaceId`, `fileId`, `entityType`, `entityId`, `relationType`, `deletedAt`                                                           | Unique partial relation tuple (`workspaceId`,`fileId`,`entityType`,`entityId`,`relationType`) when not deleted; indexes for entity/file lookups |

#### 3.6.5 Customers Domain Collections

| Model             | Purpose                      | Key Fields                                                                                                        | Important Indexes/Constraints                                                                                                                                                               |
| ----------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Organization`    | Customer company record      | `workspaceId`, `name`, `nameNormalized`, `domain`, `deletedAt`                                                    | Partial active-row indexes on (`workspaceId`,`nameNormalized`), (`workspaceId`,`domain`), (`workspaceId`,`createdAt`), (`workspaceId`,`updatedAt`)                                          |
| `Contact`         | Customer person record       | `workspaceId`, `organizationId`, `fullName`, `nameNormalized`, `emailNormalized`, `phone`, `tags`, `customFields` | Partial index (`workspaceId`,`emailNormalized`) for active rows; partial active-row indexes (`workspaceId`,`organizationId`), (`workspaceId`,`nameNormalized`), (`workspaceId`,`updatedAt`) |
| `ContactIdentity` | Normalized identity channels | `workspaceId`, `contactId`, `type`, `value`, `valueNormalized`, `verifiedAt`                                      | Unique partial (`workspaceId`,`type`,`valueNormalized`) when not deleted; index (`workspaceId`,`contactId`)                                                                                 |

#### 3.6.6 Tickets Domain Collections

| Model               | Purpose                                   | Key Fields                                                                                                                                                                                                 | Important Indexes/Constraints                                                                                                     |
| ------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `TicketCategory`    | Ticket category tree                      | `workspaceId`, `name`, `slug`, `parentId`, `path`, `order`, `isActive`                                                                                                                                     | Unique partial (`workspaceId`,`slug`); indexes (`workspaceId`,`parentId`) and partial (`workspaceId`,`path`)                      |
| `TicketTag`         | Workspace tag dictionary                  | `workspaceId`, `name`, `nameNormalized`, `isActive`                                                                                                                                                        | Unique partial (`workspaceId`,`nameNormalized`) when not deleted                                                                  |
| `TicketCounter`     | Atomic sequence source for ticket numbers | `workspaceId`, `seq`                                                                                                                                                                                       | Unique (`workspaceId`); static allocator increments sequence                                                                      |
| `Ticket`            | Core support ticket                       | `workspaceId`, `mailboxId`, `number`, `subjectNormalized`, `status`, `priority`, `channel`, `contactId`, `organizationId`, `assigneeId`, `conversationId`, `tagIds`, summary/count/timestamp fields, `sla` | Unique (`workspaceId`,`number`); operational indexes by status/assignee/category/tag/channel/mailbox/contact/organization/recency |
| `Conversation`      | Ticket conversation channel metadata      | `workspaceId`, `ticketId`, `mailboxId`, `channel`, `lastMessageAt`, `messageCount`, message summary/count fields                                                                                           | Unique (`workspaceId`,`ticketId`); indexes by mailbox and recency                                                                 |
| `Message`           | Message records within conversations      | `workspaceId`, `conversationId`, `ticketId`, `type`, transport `direction`, `from`, `to`, `bodyText`, `attachmentFileIds`                                                                                  | Workspace-scoped indexes by conversation/ticket/mailbox/type/direction + createdAt                                                |
| `TicketParticipant` | Watchers/collaborators on tickets         | `workspaceId`, `ticketId`, `userId`, `type`                                                                                                                                                                | Unique partial (`workspaceId`,`ticketId`,`userId`) when not deleted                                                               |

#### 3.6.7 SLA Domain Collections

| Model           | Purpose                            | Key Fields                                                                           | Important Indexes/Constraints                                                                                 |
| --------------- | ---------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `BusinessHours` | Workspace business schedule        | `workspaceId`, `name`, `timezone`, `weeklySchedule[]`, `holidays[]`                  | Index (`workspaceId`); index (`workspaceId`,`deletedAt`,`name`)                                               |
| `SlaPolicy`     | SLA policy definitions by priority | `workspaceId`, `name`, `isActive`, `isDefault`, `rulesByPriority`, `businessHoursId` | Index (`workspaceId`,`isDefault`); index (`workspaceId`,`isActive`); index (`workspaceId`,`deletedAt`,`name`) |

#### 3.6.8 Integrations Domain Collections

| Model     | Purpose                        | Key Fields                                                            | Important Indexes/Constraints                       |
| --------- | ------------------------------ | --------------------------------------------------------------------- | --------------------------------------------------- |
| `ApiKey`  | Workspace API key metadata     | `workspaceId`, `name`, `keyHash`, `scopes`, `revokedAt`, `lastUsedAt` | Unique `keyHash`; index (`workspaceId`,`createdAt`) |
| `Webhook` | Outbound webhook configuration | `workspaceId`, `url`, `secretHash`, `events`, `enabled`               | Index (`workspaceId`,`enabled`)                     |

#### 3.6.9 Billing Domain Collections

| Model                 | Purpose                         | Key Fields                                                                                                                                                                                                | Important Indexes/Constraints                                                                                                      |
| --------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Plan`                | Fixed plan catalog              | `key`, `name`, `price`, `currency`, `limits`, `features`, `isActive`, `sortOrder`, `catalogVersion`, `providerMetadata`                                                                                   | Unique `key`; index (`isActive`,`sortOrder`,`key`)                                                                                 |
| `Addon`               | Fixed add-on catalog            | `key`, `name`, `type`, `price`, `currency`, `effects`, `isActive`, `sortOrder`, `catalogVersion`, `providerMetadata`                                                                                      | Unique `key`; index (`isActive`,`sortOrder`,`key`)                                                                                 |
| `Subscription`        | Workspace subscription state    | `workspaceId`, `planId`, `planKey`, `addonItems`, `status`, `provider`, Stripe ids, trial/grace/period fields                                                                                             | Unique partial `workspaceId` when not deleted; partial index on `stripeCustomerId`; unique partial index on `stripeSubscriptionId` |
| `Entitlement`         | Computed feature/limit snapshot | `workspaceId`, `features`, `limits`, `usage`, `computedAt`, `sourceSnapshot`                                                                                                                              | Unique partial `workspaceId` when not deleted                                                                                      |
| `UsageMeter`          | Monthly usage counters          | `workspaceId`, `periodKey`, `ticketsCreated`, `uploadsCount`                                                                                                                                              | Unique (`workspaceId`,`periodKey`); index (`workspaceId`,`updatedAt`)                                                              |
| `BillingWebhookEvent` | Billing webhook inbox           | `workspaceId`, `provider`, `eventId`, `eventType`, `status`, `receivedAt`, `processedAt`, `enqueuedAt`, `processingJobId`, `payloadHash`, `payload`, `normalizedPayload`, `lastError`, `lastEnqueueError` | Unique (`provider`,`eventId`); indexes on status/time, provider/eventType, and workspace/time                                      |

#### 3.6.10 Automations, Notifications, Platform Collections

| Model                 | Purpose                         | Key Fields                                                                  | Important Indexes/Constraints                                                                            |
| --------------------- | ------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `AutomationRule`      | Workspace automation rules      | `workspaceId`, `name`, `enabled`, `trigger`, `actions`                      | Index (`workspaceId`,`enabled`)                                                                          |
| `Notification`        | User notifications              | `workspaceId`, `userId`, `type`, `entity`, `payload`, `readAt`, `expiresAt` | Indexes on (`userId`,`readAt`), (`workspaceId`,`userId`,`createdAt`), (`workspaceId`,`type`,`createdAt`) |
| `PlatformAdmin`       | Platform-level admin accounts   | `emailNormalized`, `passwordHash`, `role`, `status`                         | Unique `emailNormalized`; indexes `role`, `status`                                                       |
| `PlatformSession`     | Platform-admin sessions         | `platformAdminId`, `refreshTokenHash`, `expiresAt`, `revokedAt`             | Unique `refreshTokenHash`; index (`platformAdminId`,`createdAt`); TTL on `expiresAt`                     |
| `PlatformMetricDaily` | Daily platform metrics snapshot | `dateKey`, `totals`                                                         | Unique `dateKey`                                                                                         |

#### 3.6.11 Sub-Schemas in Use

| Sub-Schema                       | Used By                          | Purpose                                                                                                                                                                            |
| -------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user-profile.schema`            | `User.profile`                   | User profile fields (`name`, `avatar`)                                                                                                                                             |
| `workspace-settings.schema`      | `Workspace.settings`             | Workspace settings (`timeZone`)                                                                                                                                                    |
| `subscription-addon-item.schema` | `Subscription.addonItems[]`      | Addon item references + quantity                                                                                                                                                   |
| `business-hours-day.schema`      | `BusinessHours.weeklySchedule[]` | Weekly open/close windows                                                                                                                                                          |
| `business-hours-holiday.schema`  | `BusinessHours.holidays[]`       | Holiday dates/labels                                                                                                                                                               |
| `ticket-sla.schema`              | `Ticket.sla`                     | Active ticket-level SLA snapshot/runtime fields for policy source, business-hours snapshot, targets, due timestamps, pause markers, remaining business minutes, and breach markers |
| `message-party.schema`           | `Message.from/to`                | Simple message party descriptors                                                                                                                                                   |
| `notification-entity.schema`     | `Notification.entity`            | Entity reference container                                                                                                                                                         |

### 3.7 Storage and Files Design

Storage abstraction:

- Provider resolved lazily by `src/infra/storage/index.js`.
- Supported providers: `minio`, `s3`, `local`.
- Runtime selection via `STORAGE_PROVIDER`.

Adapters:

- `MinioStorageAdapter`: bucket ensure, upload/get/delete/stat, presigned URL capability.
- `LocalStorageAdapter`: path-safe filesystem emulation for test/dev.

Files v1 behavior:

- Backend multipart upload (`multer.memoryStorage()`).
- Backend-streamed download.
- Canonical file URL saved as `/api/files/:id/download` (no direct object URL exposure).
- Workspace/date/uuid-based object key strategy.
- Metadata checksum (`sha256`) and normalized filename fields.
- Upload/delete storage failures mapped to API-level storage/file error keys.

### 3.8 Validation, Rate Limiting, and Security Controls

Validation:

- Endpoint-level validator lists in module validators.
- Common middleware returns normalized 422 envelope.
- Mailboxes PATCH has explicit unknown-field rejection and "at least one allowed field" validation.

Rate limiting:

- In-memory map-based limiter.
- File upload/download rate limits configurable by env.
- OTP resend throttling and rate limits enforced via OTP documents + config.

Security controls:

- Password hashing via bcrypt.
- Refresh tokens stored as hash (`sha256`) in DB.
- OTP codes stored as hash (`sha256`) in DB.
- Invite tokens stored as hash (`sha256`) in DB.
- Workspace membership and role checks on protected tenant routes.
- Anti-enumeration behavior for auth recovery/invite paths and workspace-scoped file lookup behavior.

### 3.9 Localization and Message Keys

Current i18n setup:

- Locales: `en` and `ar`.
- Header support: `x-lang: en|ar` (falls back to `accept-language` prefix, then `en`).
- Success responses include localized `message` from `messageKey`.
- Errors include localized top-level message and translated validation entries.

### 3.10 Operational Scripts and Environments

NPM scripts:

- `npm run dev`
- `npm run start`
- `npm run test`
- `npm run billing:sync-catalog`
- `npm run billing:worker`
- `npm run billing:replay-webhooks`
- `npm run billing:sync-workspace -- <workspaceId>`
- `npm run mailboxes:backfill-default`

Developer utility scripts:

- `node tests/manual/realtime-smoke-test.js`
  - Requires `REALTIME_ACCESS_TOKEN`
  - Optional: `REALTIME_BASE_URL`, `REALTIME_TICKET_ID`, `REALTIME_PRESENCE_STATE`
  - Uses `/api/realtime/bootstrap`, connects a real Socket.IO client, subscribes the authenticated workspace, optionally subscribes a ticket, and logs incoming live events for quick manual verification.

Maintenance script:

- `scripts/sync-billing-catalog.js`:
- Connects DB.
- Syncs the fixed Billing v1 plan/add-on catalog manifest into MongoDB.
- Prints the sync summary and is safe to re-run.

- `scripts/replay-billing-webhooks.js`:
- Connects DB.
- Replays pending or failed persisted billing webhook inbox events.
- Prints processed and failed counts.

- `scripts/sync-billing-workspace.js`:
- Connects DB.
- Re-syncs one workspace billing subscription from the provider-facing billing service seam.
- Prints the resulting workspace billing status.

- `scripts/backfill-default-mailboxes.js`:
- Connects DB.
- Ensures mailbox default invariants for all workspaces.
- Prints summary counts (`scanned`, `changed`, `createdDefault`).

Infra/dev setup:

- `docker-compose.minio.yml` for local MinIO + console.
- `.env.example` includes full auth, OTP, invite, email, and storage config template.

### 3.11 Test Coverage Snapshot

Test framework:

- Jest + Supertest + Mongoose integration tests.
- DB tests can be skipped with `SKIP_DB_TESTS=1`.

Covered areas:

- Auth flows and OTP behavior.
- Session rotation and token/session invariants.
- Invite lifecycle and invite finalization behavior.
- Workspace switching semantics and old-token invalidation.
- Files upload/list/filter/download/delete + storage failure mapping.
- Mailbox bootstrap/default invariants/backfill/mutation rules.
- SLA business-hours helpers/validation, business-time math helpers, policy helpers/selection rules, management endpoints, ticket runtime behavior, summary endpoint, RBAC, and mailbox optional override compatibility.
- Ticket category/tag CRUD-like dictionary behavior, RBAC, and anti-enumeration.
- Ticket assignment/lifecycle/participant actions and their guardrails.
- Billing catalog sync, workspace billing reads, checkout/portal RBAC and validation, webhook verification/idempotency, and provider lifecycle sync behavior.
- Realtime foundation, business events, and collaboration flows through real `socket.io-client` connections and REST-triggered writes.
- Validation key existence in i18n for key modules.
- Storage provider config fail-fast behavior.

Realtime test runtime modes:

- The same realtime integration suites are intended to pass in these env-driven modes:
  - `REDIS_ENABLED=false` and `REALTIME_REDIS_ADAPTER_ENABLED=false`
  - `REDIS_ENABLED=true` and `REALTIME_REDIS_ADAPTER_ENABLED=false`
  - `REDIS_ENABLED=true` and `REALTIME_REDIS_ADAPTER_ENABLED=true`
- When Redis-backed modes are used, a local Redis instance is expected to be reachable at `REDIS_URL`.
- Adapter-enabled tests in the current Jest runtime verify boot/wiring and normal socket flows in a single process; they do not prove cross-node fan-out by themselves.

Not fully covered by runtime tests:

- Empty route modules (`inbox/integrations/admin`) because no behavior yet.
- SLA jobs/reminders/reporting/holiday behavior because the active runtime surface still stops at first-response/resolution without background processing.
- Automations/notifications/platform modules because they still have no runtime APIs.

### 3.12 Known Current Gaps and Implementation Notes

- `users` API is still a public list stub returning an empty array.
- `customers` currently exposes Organizations v1, Contacts v1, and minimal ContactIdentity list/create endpoints; ticket integration continues using lean same-workspace customer summaries, and identity update/delete/verification/widget flows are not implemented yet.
- `tickets` currently expose core ticket records, assignment/lifecycle actions, participant metadata, conversation/message flows, and category/tag dictionary APIs.
- `sla` now exposes active business-hours/policy management plus ticket first-response/resolution runtime behavior.
- `sla` still postpones next-response SLA, holidays, reminders/escalations/notifications, BullMQ/jobs, cycle-history, and historical/date-range reporting.
- `realtime` now exposes an authenticated bootstrap endpoint, socket auth/room foundations, ticket/message/participant live business event publishing, and ephemeral ticket presence/typing/soft-claim coordination for the internal workspace app.
- Ticket create with `initialMessage` now publishes `ticket.created` plus the same `message.created` and `conversation.updated` live events used by later message writes.
- Viewer members remain allowed to send advisory collaboration signals on readable tickets in the current internal-only phase.
- Mounted route groups `inbox` and `integrations` are still empty; `admin` and `reports` now expose live runtime APIs.
- Several domains currently ship schema/model groundwork without exposed APIs.
- Background jobs now use BullMQ foundations on top of the shared Redis config path, with dedicated billing workers for webhook follow-up processing plus lifecycle and repair queue seams.
- Billing catalog seeding/sync is implemented; broader demo seed data is still not implemented.

### 3.13 Defined Enums and Constants (Current)

| Constant Group                | Values                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `WORKSPACE_ROLES`             | `owner`, `admin`, `agent`, `viewer`                                              |
| `WORKSPACE_STATUS`            | `active`, `trial`, `suspended`                                                   |
| `MEMBER_STATUS`               | `active`, `suspended`, `removed`                                                 |
| `INVITE_STATUS`               | `pending`, `accepted`, `revoked`, `expired`                                      |
| `OTP_PURPOSE`                 | `verifyEmail`, `login`, `resetPassword`, `changeEmail`                           |
| `MAILBOX_TYPE`                | `email`, `chat`, `form` (API validators currently allow only `email`)            |
| `FILE_PROVIDER`               | `minio`, `s3`, `local`                                                           |
| `TICKET_STATUS`               | `new`, `open`, `pending`, `waiting_on_customer`, `solved`, `closed`              |
| `TICKET_PRIORITY`             | `low`, `normal`, `high`, `urgent`                                                |
| `TICKET_CHANNEL`              | `manual`, `email`, `widget`, `api`, `system`                                     |
| `MESSAGE_DIRECTION`           | `inbound`, `outbound`                                                            |
| `TICKET_MESSAGE_TYPE`         | `customer_message`, `public_reply`, `internal_note`, `system_event`              |
| `NOTIFICATION_TYPE`           | `ticket_assigned`, `ticket_mention`, `ticket_reply`, `system`, `billing`         |
| `BILLING_SUBSCRIPTION_STATUS` | `trialing`, `active`, `past_due`, `canceled`, `incomplete`, `incomplete_expired` |
| `BILLING_ADDON_TYPE`          | `seat`, `usage`, `feature`                                                       |
| `PLATFORM_ROLES`              | `super_admin`, `platform_admin`, `platform_support`                              |

## 4) Complete Endpoint Checklist (Current)

This section is an explicit endpoint inventory from mounted route code.

### Auth

- `POST /api/auth/signup`
- `POST /api/auth/resend-otp`
- `POST /api/auth/verify-email`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/auth/me`
- `PATCH /api/auth/profile`
- `POST /api/auth/logout`
- `POST /api/auth/logout-all`
- `POST /api/auth/change-password`

### Workspaces

- `GET /api/workspaces/mine`
- `POST /api/workspaces/switch`
- `POST /api/workspaces/:workspaceId/invites`
- `GET /api/workspaces/:workspaceId/invites`
- `GET /api/workspaces/:workspaceId/invites/:inviteId`
- `POST /api/workspaces/:workspaceId/invites/:inviteId/resend`
- `POST /api/workspaces/:workspaceId/invites/:inviteId/revoke`
- `POST /api/workspaces/invites/accept`

### Files

- `POST /api/files`
- `GET /api/files`
- `GET /api/files/:fileId`
- `GET /api/files/:fileId/download`
- `DELETE /api/files/:fileId`

### Mailboxes

- `GET /api/mailboxes`
- `GET /api/mailboxes/options`
- `GET /api/mailboxes/:id`
- `POST /api/mailboxes`
- `PATCH /api/mailboxes/:id`
- `POST /api/mailboxes/:id/set-default`
- `POST /api/mailboxes/:id/activate`
- `POST /api/mailboxes/:id/deactivate`

### Customers

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

### Foundation/Public Stubs

- `GET /api/health`
- `GET /api/users`

### Tickets

- `POST /api/tickets`
- `GET /api/tickets`
- `GET /api/tickets/:id`
- `POST /api/tickets/:id/assign`
- `POST /api/tickets/:id/unassign`
- `POST /api/tickets/:id/self-assign`
- `POST /api/tickets/:id/status`
- `POST /api/tickets/:id/solve`
- `POST /api/tickets/:id/close`
- `POST /api/tickets/:id/reopen`
- `GET /api/tickets/:id/conversation`
- `GET /api/tickets/:id/messages`
- `POST /api/tickets/:id/messages`
- `GET /api/tickets/:id/participants`
- `POST /api/tickets/:id/participants`
- `DELETE /api/tickets/:id/participants/:userId`
- `PATCH /api/tickets/:id`
- `GET /api/tickets/categories`
- `GET /api/tickets/categories/options`
- `GET /api/tickets/categories/:id`
- `POST /api/tickets/categories`
- `PATCH /api/tickets/categories/:id`
- `POST /api/tickets/categories/:id/activate`
- `POST /api/tickets/categories/:id/deactivate`
- `GET /api/tickets/tags`
- `GET /api/tickets/tags/options`
- `GET /api/tickets/tags/:id`
- `POST /api/tickets/tags`
- `PATCH /api/tickets/tags/:id`
- `POST /api/tickets/tags/:id/activate`
- `POST /api/tickets/tags/:id/deactivate`

### SLA

- `GET /api/sla/summary`
- `GET /api/sla/business-hours`
- `GET /api/sla/business-hours/options`
- `GET /api/sla/business-hours/:id`
- `POST /api/sla/business-hours`
- `PATCH /api/sla/business-hours/:id`
- `GET /api/sla/policies`
- `GET /api/sla/policies/options`
- `GET /api/sla/policies/:id`
- `POST /api/sla/policies`
- `PATCH /api/sla/policies/:id`
- `POST /api/sla/policies/:id/activate`
- `POST /api/sla/policies/:id/deactivate`
- `POST /api/sla/policies/:id/set-default`

### Realtime

- `GET /api/realtime/bootstrap`

### Billing

- `GET /api/billing/catalog`
- `GET /api/billing/subscription`
- `GET /api/billing/entitlements`
- `GET /api/billing/usage`
- `GET /api/billing/summary`
- `POST /api/billing/checkout-session`
- `POST /api/billing/portal-session`
- `POST /api/billing/webhooks/stripe`

### Reports

- `GET /api/reports/overview`
- `GET /api/reports/tickets`
- `GET /api/reports/sla`
- `GET /api/reports/team`

### Platform Admin

- `POST /api/admin/auth/login`
- `POST /api/admin/auth/refresh`
- `GET /api/admin/auth/me`
- `POST /api/admin/auth/logout`
- `POST /api/admin/auth/logout-all`
- `GET /api/admin/overview`
- `GET /api/admin/metrics`
- `GET /api/admin/billing-overview`
- `GET /api/admin/workspaces`
- `GET /api/admin/workspaces/:id`
- `POST /api/admin/workspaces/:id/suspend`
- `POST /api/admin/workspaces/:id/reactivate`
- `POST /api/admin/workspaces/:id/extend-trial`

### Mounted Empty Router Prefixes

- `/api/inbox`
- `/api/integrations`

## 5) Final Current-State Summary

Today's backend is strongest in:

- Identity and session security model.
- Workspace tenancy and invite workflows.
- Workspace context switching semantics.
- Internal realtime auth/bootstrap/room foundation plus live business event publishing aligned with the existing session workspace model.
- Files v1 with storage abstraction and secure download contract.
- Mailboxes v1 with robust default-state consistency logic.
- SLA v1 active surface with business-hours/policy management, workspace default and mailbox override assignment, ticket snapshot/runtime behavior, and lightweight summary support.
- Tickets core records with workspace numbering, reference validation, and dictionary-backed categorization.
- Billing v1 runtime with fixed catalog sync, subscription bootstrap, entitlement/usage summary reads, checkout/portal flows, and provider-backed webhook sync.
- Workspace reporting v1 for operational dashboard, ticket, SLA, and team views.
- Platform-admin auth, cross-workspace management, and platform analytics/reporting v1.

The codebase also contains substantial forward-looking data modeling for deeper SLA runtime behavior, billing, automations, integrations, notifications, and broader platform support domains, with runtime APIs to be incrementally added on top.
