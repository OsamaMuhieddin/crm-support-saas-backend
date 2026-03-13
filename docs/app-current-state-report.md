# CRM Support SaaS Backend - Current State Report

Generated on: 2026-03-13  
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
- Secure file upload/list/download/delete inside workspace boundaries.
- Mailbox queue management with strict default-mailbox invariants.
- Core ticket record creation/list/detail/update with workspace-scoped numbering and auto-created conversations.
- Ticket conversation and message timeline reads/writes with file attachments linked to messages and tickets.
- Ticket assignment, lifecycle actions, and internal participant management.
- Ticket categories and tags dictionary management inside workspace boundaries.

Partially implemented business pillars:

- Customers and users API surfaces exist only as list stubs.

Planned business pillars with data models but no live API flows yet:

- SLA operations.
- Integrations management.
- Billing/plan enforcement runtime logic.
- Automations execution.
- Notifications delivery workflows.
- Platform admin runtime workflows.

### 2.2 Personas and Roles (Implemented)

Workspace roles:

- `owner`
- `admin`
- `agent`
- `viewer`

Current effective permissions by feature:

| Feature | Owner | Admin | Agent | Viewer |
|---|---|---|---|---|
| Auth lifecycle (`signup/login/refresh/...`) | Yes | Yes | Yes | Yes |
| List memberships (`GET /workspaces/mine`) | Yes | Yes | Yes | Yes |
| Switch workspace (`POST /workspaces/switch`) | Yes (if member) | Yes (if member) | Yes (if member) | Yes (if member) |
| Manage invites in workspace | Yes | Yes | No | No |
| Accept invite (token-based, no auth) | Yes | Yes | Yes | Yes |
| Upload files | Yes | Yes | Yes | No |
| List/get/download files | Yes | Yes | Yes | Yes |
| Delete files | Yes | Yes | No | No |
| Create/update/activate/deactivate/set-default mailbox | Yes | Yes | No | No |
| Read mailbox lists/options/details | Yes | Yes | Yes (inactive hidden) | Yes (inactive hidden) |
| Create/update ticket records | Yes | Yes | Yes | No |
| Read ticket lists/details | Yes | Yes | Yes | Yes |
| Read ticket conversations/messages | Yes | Yes | Yes | Yes |
| Create ticket messages | Yes | Yes | Yes | No |
| Assign tickets | Yes | Yes | No | No |
| Unassign/self-assign tickets | Yes | Yes | Yes | No |
| Change ticket lifecycle/status | Yes | Yes | Yes | No |
| Read ticket participants | Yes | Yes | Yes | Yes |
| Add/remove ticket participants | Yes | Yes | Yes | No |
| Create/update/activate/deactivate ticket categories/tags | Yes | Yes | No | No |
| Read ticket category/tag lists/options/details | Yes | Yes | Yes (inactive hidden) | Yes (inactive hidden) |

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

#### Flow G: Tickets Core

1. Owner/Admin maintains ticket categories and tags inside the active workspace when structured routing metadata is needed.
2. Owner/Admin/Agent creates ticket records with `POST /api/tickets`.
3. Ticket creation allocates the next workspace-scoped ticket number and auto-creates a single conversation.
4. Files are uploaded first through the files module and can then be linked to create-time or later ticket messages.
5. Ticket conversation and message history can be read through dedicated conversation/message endpoints.
6. Message writes update ticket/conversation counters, last-message summaries, and message-driven status side effects.
7. Explicit assignment actions manage `assigneeId`, `assignedAt`, and safe self-assignment rules.
8. Explicit lifecycle actions manage `status`, `statusChangedAt`, `closedAt`, and live resolution markers.
9. Participant endpoints manage internal watcher/collaborator metadata and keep `participantCount` synchronized.
10. Ticket patch updates editable record fields only, and mailbox changes stop once the ticket has messages.

### 2.4 Business State Summary

Production-ready business slices:

- Authentication and session model.
- Workspace membership and invite lifecycle.
- Workspace switching.
- File operations v1.
- Mailboxes v1.
- Tickets core record flow.
- Ticket assignment, lifecycle, and participants flows.
- Ticket conversation/message flow with attachment linking.
- Ticket categories and tags dictionaries.

Foundation-only slices:

- Customers/Users API stubs.
- Admin/SLA/Inbox/Integrations routes mounted but empty.
- Billing/automations/notifications/platform models are present but no runtime product flows.

## 3) Technical Side

### 3.1 Runtime Architecture

Backend stack:

- Node.js + Express (ESM).
- MongoDB + Mongoose.
- JWT for auth.
- `express-validator` for request validation.
- Multer for file multipart upload.
- MinIO/S3-compatible storage adapter + local storage adapter.

Architecture pattern:

- Entrypoints: `src/app.js`, `src/server.js`.
- Route mounting root: `src/routes/index.js` under `/api`.
- Modular feature folders in `src/modules/*`.
- Shared cross-cutting utilities in `src/shared/*`.
- Infrastructure adapters in `src/infra/*`.
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

| Method | Path | Purpose | Notes |
|---|---|---|---|
| `GET` | `/health` | Health check | Returns `{ status: "ok" }` payload with localized success wrapper |
| `POST` | `/workspaces/invites/accept` | Accept invite token | No bearer token required |
| `POST` | `/auth/signup` | Start signup, send OTP | Public |
| `POST` | `/auth/resend-otp` | Resend OTP by purpose | Public with anti-enumeration behavior |
| `POST` | `/auth/verify-email` | Verify OTP and login | Public |
| `POST` | `/auth/login` | Login | Public |
| `POST` | `/auth/refresh` | Refresh session tokens | Public |
| `POST` | `/auth/forgot-password` | Forgot password OTP | Public |
| `POST` | `/auth/reset-password` | Reset password with OTP | Public |
| `GET` | `/users` | Users stub list | Public placeholder |
| `GET` | `/customers` | Customers stub list | Public placeholder |

#### Authenticated Auth Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/auth/me` | Return canonical user + active workspace + role |
| `POST` | `/auth/logout` | Revoke current session |
| `POST` | `/auth/logout-all` | Revoke all sessions for current user |
| `POST` | `/auth/change-password` | Change password and revoke all sessions |

Auth requirements:

- Require valid bearer access token.
- Require active user.

#### Tickets Endpoints

| Method | Path | Purpose | Role requirements |
|---|---|---|---|
| `POST` | `/tickets` | Create ticket record + allocate number + create conversation | `owner/admin/agent` |
| `GET` | `/tickets` | List tickets with pagination/filter/search/sort | Any active member (`owner/admin/agent/viewer`) |
| `GET` | `/tickets/:id` | Get ticket detail | Any active member (`owner/admin/agent/viewer`) |
| `POST` | `/tickets/:id/assign` | Assign ticket to an operational user | `owner/admin` |
| `POST` | `/tickets/:id/unassign` | Clear ticket assignee | `owner/admin/agent` |
| `POST` | `/tickets/:id/self-assign` | Assign ticket to current user | `owner/admin/agent` |
| `POST` | `/tickets/:id/status` | Perform explicit non-close status transition | `owner/admin/agent` |
| `POST` | `/tickets/:id/solve` | Mark ticket as solved | `owner/admin/agent` |
| `POST` | `/tickets/:id/close` | Close solved ticket | `owner/admin/agent` |
| `POST` | `/tickets/:id/reopen` | Reopen solved/closed ticket | `owner/admin/agent` |
| `GET` | `/tickets/:id/conversation` | Get ticket conversation summary | Any active member (`owner/admin/agent/viewer`) |
| `GET` | `/tickets/:id/messages` | List ticket messages | Any active member (`owner/admin/agent/viewer`) |
| `POST` | `/tickets/:id/messages` | Create ticket message | `owner/admin/agent` |
| `GET` | `/tickets/:id/participants` | List internal ticket participants | Any active member (`owner/admin/agent/viewer`) |
| `POST` | `/tickets/:id/participants` | Add or update ticket participant | `owner/admin/agent` |
| `DELETE` | `/tickets/:id/participants/:userId` | Remove ticket participant | `owner/admin/agent` |
| `PATCH` | `/tickets/:id` | Update editable ticket fields | `owner/admin/agent` |
| `GET` | `/tickets/categories` | List ticket categories | Any active member; inactive visibility restricted for non-admin roles |
| `GET` | `/tickets/categories/options` | Lightweight ticket category options | Any active member; inactive visibility restricted for non-admin roles |
| `GET` | `/tickets/categories/:id` | Get ticket category details | Any active member; inactive hidden for non-admin roles |
| `POST` | `/tickets/categories` | Create ticket category | `owner/admin` |
| `PATCH` | `/tickets/categories/:id` | Update ticket category | `owner/admin` |
| `POST` | `/tickets/categories/:id/activate` | Activate ticket category | `owner/admin` |
| `POST` | `/tickets/categories/:id/deactivate` | Deactivate ticket category | `owner/admin` |
| `GET` | `/tickets/tags` | List ticket tags | Any active member; inactive visibility restricted for non-admin roles |
| `GET` | `/tickets/tags/options` | Lightweight ticket tag options | Any active member; inactive visibility restricted for non-admin roles |
| `GET` | `/tickets/tags/:id` | Get ticket tag details | Any active member; inactive hidden for non-admin roles |
| `POST` | `/tickets/tags` | Create ticket tag | `owner/admin` |
| `PATCH` | `/tickets/tags/:id` | Update ticket tag | `owner/admin` |
| `POST` | `/tickets/tags/:id/activate` | Activate ticket tag | `owner/admin` |
| `POST` | `/tickets/tags/:id/deactivate` | Deactivate ticket tag | `owner/admin` |

Tickets notes:

- Tickets are no longer a public endpoint.
- The current ticket runtime surface includes core ticket records, conversation/message flows, and workspace-scoped category/tag dictionaries.
- Ticket creation can include a minimal initial message (`customer_message` or `internal_note`) with uploaded-file attachments.
- Ticket message attachments are linked to the message as the semantic owner and to the ticket for reverse lookup.

#### Workspace Context and Invite Management Endpoints

| Method | Path | Purpose | Role requirements |
|---|---|---|---|
| `GET` | `/workspaces/mine` | List active memberships + current workspace id | Any authenticated active user |
| `POST` | `/workspaces/switch` | Explicitly switch active workspace for session | Any authenticated active user who is active member in target |
| `POST` | `/workspaces/:workspaceId/invites` | Create invite | `owner/admin` in token workspace + tenant match |
| `GET` | `/workspaces/:workspaceId/invites` | List invites | `owner/admin` in token workspace + tenant match |
| `GET` | `/workspaces/:workspaceId/invites/:inviteId` | Get invite | `owner/admin` in token workspace + tenant match |
| `POST` | `/workspaces/:workspaceId/invites/:inviteId/resend` | Resend invite token/email | `owner/admin` in token workspace + tenant match |
| `POST` | `/workspaces/:workspaceId/invites/:inviteId/revoke` | Revoke invite | `owner/admin` in token workspace + tenant match |

#### Files v1 Endpoints

| Method | Path | Purpose | Role requirements |
|---|---|---|---|
| `POST` | `/files` | Upload single file | `owner/admin/agent` |
| `GET` | `/files` | List files with filters/pagination | Any active member (`owner/admin/agent/viewer`) |
| `GET` | `/files/:fileId` | Fetch file metadata | Any active member |
| `GET` | `/files/:fileId/download` | Stream file content | Any active member |
| `DELETE` | `/files/:fileId` | Delete file object + soft-delete record | `owner/admin` |

Files notes:

- Upload/download have in-memory rate limiting.
- Upload validation enforces mime/extension allowlists and max size.
- Download contract is fixed at `/api/files/:fileId/download`.

#### Mailboxes v1 Endpoints

| Method | Path | Purpose | Role requirements |
|---|---|---|---|
| `GET` | `/mailboxes` | List mailboxes (pagination/filter/search/sort) | Any active member; inactive visibility restricted for non-admin roles |
| `GET` | `/mailboxes/options` | Lightweight options list | Any active member; inactive visibility restricted for non-admin roles |
| `GET` | `/mailboxes/:id` | Get mailbox details | Any active member; inactive hidden for non-admin roles |
| `POST` | `/mailboxes` | Create mailbox | `owner/admin` |
| `PATCH` | `/mailboxes/:id` | Update mailbox | `owner/admin` |
| `POST` | `/mailboxes/:id/set-default` | Set workspace default mailbox | `owner/admin` |
| `POST` | `/mailboxes/:id/activate` | Activate mailbox | `owner/admin` |
| `POST` | `/mailboxes/:id/deactivate` | Deactivate mailbox | `owner/admin` |

Mailbox notes:

- v1 mailbox `type` accepted by validators is only `email`.
- No mailbox delete endpoint in v1.

#### Mounted Route Groups with No Endpoints

Mounted but currently empty routers:

- `/inbox`
- `/sla`
- `/integrations`
- `/admin`

Any request under those paths currently falls through to 404.

### 3.5 Module Implementation Status

| Module | Router Mounted | Runtime API Behavior | Service/Model State |
|---|---|---|---|
| `health` | Yes | Implemented | Simple health service |
| `auth` | Yes | Implemented | Full OTP/JWT/session lifecycle |
| `workspaces` | Yes | Implemented | Membership resolution, switch, invite lifecycle |
| `files` | Yes | Implemented | Upload/list/get/download/delete + storage abstraction |
| `mailboxes` | Yes | Implemented | CRUD-like v1 + default invariants + backfill |
| `users` | Yes | Stub (`GET /users`) | Model implemented, service placeholder |
| `customers` | Yes | Stub (`GET /customers`) | Models implemented, service placeholder |
| `tickets` | Yes | Core tickets + message timeline + assignment/lifecycle/participants + ticket category/tag dictionaries | Real ticket create/list/detail/update/message flows plus assignment/lifecycle/participant runtime flows and category/tag validator/controller/service/runtime flows |
| `inbox` | Yes | Empty router | Placeholder |
| `sla` | Yes | Empty router | Models implemented, API not implemented |
| `integrations` | Yes | Empty router | Models implemented, API not implemented |
| `admin` | Yes | Empty router | Placeholder |
| `automations` | No | No API | Model implemented only |
| `billing` | No | No API | Models implemented only |
| `notifications` | No | No API | Model implemented only |
| `platform` | No | No API | Models implemented only |
| `roles` | No | No API | No schema content yet |

### 3.6 Database Design (Mongoose)

#### 3.6.1 Data Modeling Conventions

- `strict: true` on schemas.
- `timestamps: true` on nearly all persisted models.
- Widespread soft-delete pattern via `deletedAt` and often `deletedByUserId`.
- Extensive workspace scoping via `workspaceId` across tenant data.
- Selected collections use TTL indexes for lifecycle expiration.

#### 3.6.2 Core Identity and Tenancy Collections

| Model | Purpose | Key Fields | Important Indexes/Constraints |
|---|---|---|---|
| `User` | End-user identity/account | `email`, `emailNormalized`, `passwordHash`, `isEmailVerified`, `status`, `defaultWorkspaceId`, `lastWorkspaceId`, `platformRole` | Unique `emailNormalized`; indexes on `defaultWorkspaceId`, `platformRole` |
| `Session` | Refresh-session persistence | `userId`, `workspaceId`, `refreshTokenHash`, `expiresAt`, `revokedAt` | TTL on `expiresAt`; index `refreshTokenHash`; index on (`userId`, `revokedAt`, `expiresAt`) |
| `OtpCode` | OTP verification/password reset codes | `emailNormalized`, `userId`, `purpose`, `codeHash`, `expiresAt`, `consumedAt`, `attemptCount`, `lastSentAt` | TTL on `expiresAt`; index (`emailNormalized`, `purpose`, `createdAt`) |
| `Workspace` | Tenant root | `name`, `slug`, `status`, `ownerUserId`, `defaultMailboxId`, `defaultSlaPolicyId`, `settings.timeZone` | Unique partial `slug` when not deleted; indexes `ownerUserId`, `status` |
| `WorkspaceMember` | User membership in workspace | `workspaceId`, `userId`, `roleKey`, `status`, `joinedAt`, `removedAt` | Unique (`workspaceId`, `userId`); indexes (`workspaceId`, `status`), (`workspaceId`, `roleKey`) |
| `WorkspaceInvite` | Invite tokens and state | `workspaceId`, `emailNormalized`, `roleKey`, `tokenHash`, `status`, `expiresAt`, `acceptedAt` | Unique `tokenHash`; unique partial pending invite on (`workspaceId`, `emailNormalized`); TTL on `expiresAt` |

#### 3.6.3 Mailbox Domain Collections

| Model | Purpose | Key Fields | Important Indexes/Constraints |
|---|---|---|---|
| `Mailbox` | Workspace support queue mailbox | `workspaceId`, `name`, `type`, `emailAddressNormalized`, `isDefault`, `isActive` | Unique partial (`workspaceId`, `isDefault`) where default+not deleted; unique partial (`workspaceId`, `emailAddressNormalized`) for non-deleted docs; multiple list-performance indexes |
| `MailboxAlias` | Additional alias emails per mailbox | `workspaceId`, `mailboxId`, `aliasEmailNormalized`, `isActive` | Unique partial (`workspaceId`, `aliasEmailNormalized`) where not deleted; index (`workspaceId`, `mailboxId`) |

#### 3.6.4 Files Domain Collections

| Model | Purpose | Key Fields | Important Indexes/Constraints |
|---|---|---|---|
| `File` | Physical storage metadata | `workspaceId`, `uploadedByUserId`, `provider`, `bucket`, `objectKey`, `mimeType`, `originalNameNormalized`, `storageStatus`, `deletedAt` | Unique (`provider`, `bucket`, `objectKey`); workspace-scoped indexes for query filters/sorting |
| `FileLink` | Polymorphic relation of files to entities | `workspaceId`, `fileId`, `entityType`, `entityId`, `relationType`, `deletedAt` | Unique partial relation tuple (`workspaceId`,`fileId`,`entityType`,`entityId`,`relationType`) when not deleted; indexes for entity/file lookups |

#### 3.6.5 Customers Domain Collections

| Model | Purpose | Key Fields | Important Indexes/Constraints |
|---|---|---|---|
| `Organization` | Customer company record | `workspaceId`, `name`, `nameNormalized`, `domain`, `deletedAt` | Indexes on (`workspaceId`,`nameNormalized`), partial (`workspaceId`,`domain`), (`workspaceId`,`createdAt`) |
| `Contact` | Customer person record | `workspaceId`, `organizationId`, `fullName`, `nameNormalized`, `emailNormalized`, `phone`, `tags` | Partial index (`workspaceId`,`emailNormalized`); indexes (`workspaceId`,`organizationId`), (`workspaceId`,`nameNormalized`) |
| `ContactIdentity` | Normalized identity channels | `workspaceId`, `contactId`, `type`, `valueNormalized`, `verifiedAt` | Unique partial (`workspaceId`,`type`,`valueNormalized`) when not deleted; index (`workspaceId`,`contactId`) |

#### 3.6.6 Tickets Domain Collections

| Model | Purpose | Key Fields | Important Indexes/Constraints |
|---|---|---|---|
| `TicketCategory` | Ticket category tree | `workspaceId`, `name`, `slug`, `parentId`, `path`, `order`, `isActive` | Unique partial (`workspaceId`,`slug`); indexes (`workspaceId`,`parentId`) and partial (`workspaceId`,`path`) |
| `TicketTag` | Workspace tag dictionary | `workspaceId`, `name`, `nameNormalized`, `isActive` | Unique partial (`workspaceId`,`nameNormalized`) when not deleted |
| `TicketCounter` | Atomic sequence source for ticket numbers | `workspaceId`, `seq` | Unique (`workspaceId`); static allocator increments sequence |
| `Ticket` | Core support ticket | `workspaceId`, `mailboxId`, `number`, `subjectNormalized`, `status`, `priority`, `channel`, `contactId`, `organizationId`, `assigneeId`, `conversationId`, `tagIds`, summary/count/timestamp fields, `sla` | Unique (`workspaceId`,`number`); operational indexes by status/assignee/category/tag/channel/mailbox/contact/organization/recency |
| `Conversation` | Ticket conversation channel metadata | `workspaceId`, `ticketId`, `mailboxId`, `channel`, `lastMessageAt`, `messageCount`, message summary/count fields | Unique (`workspaceId`,`ticketId`); indexes by mailbox and recency |
| `Message` | Message records within conversations | `workspaceId`, `conversationId`, `ticketId`, `type`, transport `direction`, `from`, `to`, `bodyText`, `attachmentFileIds` | Workspace-scoped indexes by conversation/ticket/mailbox/type/direction + createdAt |
| `TicketParticipant` | Watchers/collaborators on tickets | `workspaceId`, `ticketId`, `userId`, `type` | Unique partial (`workspaceId`,`ticketId`,`userId`) when not deleted |

#### 3.6.7 SLA Domain Collections

| Model | Purpose | Key Fields | Important Indexes/Constraints |
|---|---|---|---|
| `BusinessHours` | Workspace business schedule | `workspaceId`, `timezone`, `weeklySchedule[]`, `holidays[]` | Index (`workspaceId`) |
| `SlaPolicy` | SLA policy definitions by priority | `workspaceId`, `name`, `isDefault`, `rulesByPriority`, `businessHoursId` | Index (`workspaceId`,`isDefault`) |

#### 3.6.8 Integrations Domain Collections

| Model | Purpose | Key Fields | Important Indexes/Constraints |
|---|---|---|---|
| `ApiKey` | Workspace API key metadata | `workspaceId`, `name`, `keyHash`, `scopes`, `revokedAt`, `lastUsedAt` | Unique `keyHash`; index (`workspaceId`,`createdAt`) |
| `Webhook` | Outbound webhook configuration | `workspaceId`, `url`, `secretHash`, `events`, `enabled` | Index (`workspaceId`,`enabled`) |

#### 3.6.9 Billing Domain Collections

| Model | Purpose | Key Fields | Important Indexes/Constraints |
|---|---|---|---|
| `Plan` | Plan catalog | `key`, `name`, `price`, `currency`, `limits`, `features` | Unique `key` |
| `Addon` | Addon catalog | `key`, `name`, `type`, `price`, `currency`, `effects` | Unique `key` |
| `Subscription` | Workspace subscription state | `workspaceId`, `planId`, `planKey`, `addonItems`, `status`, `stripeCustomerId`, `stripeSubscriptionId`, period fields | Unique partial `workspaceId` when not deleted; partial index on `stripeCustomerId` |
| `Entitlement` | Computed feature/limit snapshot | `workspaceId`, `features`, `limits`, `computedAt`, `sourceSnapshot` | Unique partial `workspaceId` when not deleted |
| `UsageMeter` | Monthly usage counters | `workspaceId`, `periodKey`, usage counters | Unique (`workspaceId`,`periodKey`); index (`workspaceId`,`updatedAt`) |

#### 3.6.10 Automations, Notifications, Platform Collections

| Model | Purpose | Key Fields | Important Indexes/Constraints |
|---|---|---|---|
| `AutomationRule` | Workspace automation rules | `workspaceId`, `name`, `enabled`, `trigger`, `actions` | Index (`workspaceId`,`enabled`) |
| `Notification` | User notifications | `workspaceId`, `userId`, `type`, `entity`, `payload`, `readAt`, `expiresAt` | Indexes on (`userId`,`readAt`), (`workspaceId`,`userId`,`createdAt`), (`workspaceId`,`type`,`createdAt`) |
| `PlatformAdmin` | Platform-level admin accounts | `emailNormalized`, `passwordHash`, `role`, `status` | Unique `emailNormalized`; indexes `role`, `status` |
| `PlatformSession` | Platform-admin sessions | `platformAdminId`, `refreshTokenHash`, `expiresAt`, `revokedAt` | Unique `refreshTokenHash`; index (`platformAdminId`,`createdAt`); TTL on `expiresAt` |
| `PlatformMetricDaily` | Daily platform metrics snapshot | `dateKey`, `totals` | Unique `dateKey` |

#### 3.6.11 Sub-Schemas in Use

| Sub-Schema | Used By | Purpose |
|---|---|---|
| `user-profile.schema` | `User.profile` | User profile fields (`name`, `avatar`) |
| `workspace-settings.schema` | `Workspace.settings` | Workspace settings (`timeZone`) |
| `subscription-addon-item.schema` | `Subscription.addonItems[]` | Addon item references + quantity |
| `business-hours-day.schema` | `BusinessHours.weeklySchedule[]` | Weekly open/close windows |
| `business-hours-holiday.schema` | `BusinessHours.holidays[]` | Holiday dates/labels |
| `ticket-sla.schema` | `Ticket.sla` | SLA due/breach timestamps and flags |
| `message-party.schema` | `Message.from/to` | Simple message party descriptors |
| `notification-entity.schema` | `Notification.entity` | Entity reference container |

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
- `npm run mailboxes:backfill-default`

Maintenance script:

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
- Ticket category/tag CRUD-like dictionary behavior, RBAC, and anti-enumeration.
- Ticket assignment/lifecycle/participant actions and their guardrails.
- Validation key existence in i18n for key modules.
- Storage provider config fail-fast behavior.

Not fully covered by runtime tests:

- Empty route modules (`inbox/sla/integrations/admin`) because no behavior yet.
- Model-only modules (`billing/automations/notifications/platform`) because no API flows yet.

### 3.12 Known Current Gaps and Implementation Notes

- `users` and `customers` APIs are still public list stubs returning empty arrays.
- `tickets` currently expose core ticket records, assignment/lifecycle actions, participant metadata, conversation/message flows, and category/tag dictionary APIs.
- Mounted route groups `inbox`, `sla`, `integrations`, and `admin` are empty.
- Several domains currently ship schema/model groundwork without exposed APIs.
- Jobs subsystem under `src/infra/jobs` is placeholder only.
- Seeding is documented as planned but not implemented.

### 3.13 Defined Enums and Constants (Current)

| Constant Group | Values |
|---|---|
| `WORKSPACE_ROLES` | `owner`, `admin`, `agent`, `viewer` |
| `WORKSPACE_STATUS` | `active`, `trial`, `suspended` |
| `MEMBER_STATUS` | `active`, `suspended`, `removed` |
| `INVITE_STATUS` | `pending`, `accepted`, `revoked`, `expired` |
| `OTP_PURPOSE` | `verifyEmail`, `login`, `resetPassword`, `changeEmail` |
| `MAILBOX_TYPE` | `email`, `chat`, `form` (API validators currently allow only `email`) |
| `FILE_PROVIDER` | `minio`, `s3`, `local` |
| `TICKET_STATUS` | `new`, `open`, `pending`, `waiting_on_customer`, `solved`, `closed` |
| `TICKET_PRIORITY` | `low`, `normal`, `high`, `urgent` |
| `TICKET_CHANNEL` | `manual`, `email`, `widget`, `api`, `system` |
| `MESSAGE_DIRECTION` | `inbound`, `outbound` |
| `TICKET_MESSAGE_TYPE` | `customer_message`, `public_reply`, `internal_note`, `system_event` |
| `NOTIFICATION_TYPE` | `ticket_assigned`, `ticket_mention`, `ticket_reply`, `system`, `billing` |
| `BILLING_SUBSCRIPTION_STATUS` | `trialing`, `active`, `past_due`, `canceled`, `incomplete` |
| `BILLING_ADDON_TYPE` | `seat`, `usage`, `feature` |
| `PLATFORM_ROLES` | `super_admin`, `platform_admin`, `platform_support` |

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

### Foundation/Public Stubs

- `GET /api/health`
- `GET /api/users`
- `GET /api/customers`

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

### Mounted Empty Router Prefixes

- `/api/inbox`
- `/api/sla`
- `/api/integrations`
- `/api/admin`

## 5) Final Current-State Summary

Today's backend is strongest in:

- Identity and session security model.
- Workspace tenancy and invite workflows.
- Workspace context switching semantics.
- Files v1 with storage abstraction and secure download contract.
- Mailboxes v1 with robust default-state consistency logic.
- Tickets core records with workspace numbering, reference validation, and dictionary-backed categorization.

The codebase also contains substantial forward-looking data modeling for tickets, customers, SLA, billing, automations, integrations, notifications, and platform admin domains, with runtime APIs to be incrementally added on top.
