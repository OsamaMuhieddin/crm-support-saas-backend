# CRM Support SaaS Backend API Reference

Frontend handoff note:

- For a frontend-friendly Billing v1 flow explanation, see [Billing v1 Frontend Flow Report](./billing-frontend-flow-report.md).

## 1) Overview

### Base URL

- `/api`

### Common headers (define once)

- `x-lang: en|ar` (optional, default `en`)
- `Content-Type: application/json`
- `Authorization: Bearer <accessToken>` (required only on protected endpoints)

### Endpoint scope terms

Protected endpoints:

- Require Authorization header with a valid access token.

Workspace-scoped endpoints:

- Include `:workspaceId` in the route.
- Enforce tenant match (`:workspaceId` must equal token `wid`).
- Enforce active membership and role requirements.

Session-context endpoints:

- Use the session's active workspace context.
- `POST /api/workspaces/switch` is the only endpoint allowed to change the active workspace.

### Response envelope (critical)

- Success (`< 400`, object response):

```json
{
  "messageKey": "success.ok",
  "message": "Localized message"
}
```

- Error:

```json
{
  "status": 422,
  "messageKey": "errors.validation.failed",
  "message": "Localized message",
  "errors": [
    {
      "field": "email",
      "messageKey": "errors.validation.invalidEmail",
      "msg": "Localized field message"
    }
  ]
}
```

- Validation failures use:
  - `status: 422`
  - `messageKey: errors.validation.failed`
  - array payload under `errors`
  - each `errors[]` item can carry a specific key (for example `errors.validation.invalidEmail`)

### Enums used in requests

- `purpose`: `verifyEmail | login | resetPassword | changeEmail`
- `roleKey`: `owner | admin | agent | viewer`
- invite `status` query: `pending | accepted | revoked | expired`

### Environment notes

- Invite emails use `FRONTEND_BASE_URL`:
  - `${FRONTEND_BASE_URL}/workspaces/invites/accept?token=...`
- `APP_BASE_URL` is still backend runtime base URL.

## 2) Local Billing v1 Dev/Test Setup

This section is for local Billing v1 integration and manual Stripe testing. It documents local runtime setup, not the public API contract itself.

### Required local runtime

- Backend runs on the host machine with `npm run dev`.
- Billing worker runs as a separate local process with `npm run billing:worker`.
- Redis is required for BullMQ-backed webhook processing and replay workers:
  - `docker compose -f docker-compose.redis.yml up -d`
- Stripe CLI runs in Docker Compose and forwards webhooks to the local backend webhook route:
  - `docker compose -f docker-compose.stripe.yml up -d stripe-cli`
  - `docker compose -f docker-compose.stripe.yml logs -f stripe-cli`

### Required billing env

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- Stripe price ids for the seeded catalog:
  - `STRIPE_PRICE_STARTER_MONTHLY`
  - `STRIPE_PRICE_GROWTH_MONTHLY`
  - `STRIPE_PRICE_BUSINESS_MONTHLY`
  - `STRIPE_PRICE_EXTRA_SEAT_MONTHLY`
  - `STRIPE_PRICE_EXTRA_STORAGE_MONTHLY`
- Redis/BullMQ toggle for local automation:
  - `REDIS_ENABLED=true`
  - `REDIS_URL=redis://127.0.0.1:6379`

### Stripe webhook forwarding note

- The Stripe CLI container uses `STRIPE_SECRET_KEY` from `.env`.
- Read the generated `whsec_...` signing secret from:
  - `docker compose -f docker-compose.stripe.yml logs -f stripe-cli`
- Copy that `whsec_...` value into `STRIPE_WEBHOOK_SECRET`.
- Restart the backend after changing `STRIPE_WEBHOOK_SECRET`.

### Local setup commands

Initial or changed local billing setup:

1. Start Redis:
   - `docker compose -f docker-compose.redis.yml up -d`
2. Sync catalog + backfill workspace billing foundations:
   - `npm run billing:migrate-v1`
3. Start backend:
   - `npm run dev`
4. Start billing worker:
   - `npm run billing:worker`
5. Start Stripe CLI forwarding:
   - `docker compose -f docker-compose.stripe.yml up -d stripe-cli`
   - `docker compose -f docker-compose.stripe.yml logs -f stripe-cli`

Normal daily runtime after local billing data is already prepared:

- `npm run dev`
- `npm run billing:worker`
- `docker compose -f docker-compose.redis.yml up -d`
- `docker compose -f docker-compose.stripe.yml up -d stripe-cli`

`npm run billing:migrate-v1` is not required on every start. Run it when:

- the local DB is fresh and billing foundations were not created yet
- the seeded billing catalog changed
- local billing data needs to be resynced/backfilled after catalog changes

### Optional local stress-test catalog values

For faster manual enforcement testing, local developers may temporarily reduce the seeded `starter` plan and add-on limits in:

- `src/modules/billing/utils/billing-catalog.manifest.js`

Example local-only stress-test values:

- Starter seats: `1`
- Starter mailboxes: `1`
- Starter storage: `5 MB`
- Starter uploads/month: `2`
- Starter tickets/month: `3`
- Extra seat add-on: `+1`
- Extra storage add-on: `+5 MB`

After changing the manifest locally, rerun:

- `npm run billing:migrate-v1`

## 3) Auth model & authorization model

- Users can belong to multiple workspaces through workspace memberships.
- Every session has exactly one active workspace context (`session.workspaceId`).
- Access tokens are workspace-scoped for that active session context:
  - `wid`: active workspace id
  - `r`: role key in that workspace
- Refresh tokens are session-scoped; refresh re-issues claims from current session context.
- Active workspace changes are explicit only via `POST /api/workspaces/switch`.
- Invite acceptance and invite finalization do not auto-switch session context.
- Old access tokens become invalid after switch because token `wid` must match `session.workspaceId`.
- Frontend should treat tokens as opaque and use `GET /api/auth/me` as canonical source for current workspace and role.
- Workspace invite management routes enforce these requirements:
  - valid Authorization token
  - user is active
  - user is an active member of the token workspace
  - role is `owner` or `admin`
  - `:workspaceId` must match token workspace (`wid`)

## 4) Quick Start Flows

The flows in this section are product-wide entry points. Billing keeps its own quick-start block immediately before the billing endpoint reference so checkout, portal, and webhook-driven sync stay documented next to the billing APIs.

### Flow A: Signup -> Verify Email -> Me

1. `POST /api/auth/signup` with `email`, `password`, optional `name`.
2. User receives verify-email OTP code.
3. `POST /api/auth/verify-email` with `email` + `code`.
4. Response includes `tokens` (access + refresh).
5. `GET /api/auth/me` with access token to hydrate user/workspace/role in FE state.

### Flow B: Login -> Refresh -> Me

1. `POST /api/auth/login` with `email` + `password`.
2. Store `accessToken` and `refreshToken`.
3. When access expires, call `POST /api/auth/refresh` with refresh token.
4. Store rotated tokens returned by refresh.
5. Call `GET /api/auth/me` to re-sync canonical workspace/role.

### Flow C: Invite Accept (verified vs unverified) -> Verify Email with inviteToken -> Explicit Switch

1. Workspace owner/admin creates invite via `POST /api/workspaces/:workspaceId/invites`.
2. Invitee opens link and calls `POST /api/workspaces/invites/accept` with `token` + `email` (and `password` if creating a new user).
3. If invitee is already verified:

- API returns `success.invite.accepted`.
- Response includes `workspaceId` of the invited workspace.
- membership is activated immediately.

4. If invitee is new/unverified:

- API returns `success.invite.acceptRequiresVerification`.
- Response includes `workspaceId` of the invited workspace.
- verify-email OTP is sent; invite stays pending.

5. Invitee then calls `POST /api/auth/verify-email` with `email`, `code`, and `inviteToken`.
6. API finalizes invite membership, issues auth tokens, and returns both active + invited workspace context fields.
7. Session active workspace is not auto-switched by invite acceptance/finalization.
8. FE uses returned `workspaceId`/`inviteWorkspaceId` and calls `POST /api/workspaces/switch` when it wants to move to the invited workspace.
9. FE calls `GET /api/auth/me` to hydrate canonical active workspace and role.

### Flow D: Upload -> List/Search -> Metadata -> Download -> Delete

1. `POST /api/files` with multipart field `file` uploads binary to private storage through backend.
2. `GET /api/files` lists workspace-scoped files with pagination and filters.
3. `GET /api/files/:fileId` fetches metadata for a single file.
4. `GET /api/files/:fileId/download` streams file bytes from backend (single public API contract in v1).
5. `DELETE /api/files/:fileId` explicitly removes physical object and soft-deletes the DB record.
6. Clients should treat `url` as canonical backend route (`/api/files/:fileId/download`), not a direct storage URL.

### Flow E: Mailboxes v1 -> Set Default -> Activate/Deactivate

1. New workspaces bootstrap with one default mailbox (`Support`) and `workspace.defaultMailboxId` is set.
2. Owner/Admin can create additional queues via `POST /api/mailboxes`.
3. Use `GET /api/mailboxes` for paginated list/search/filter; active mailboxes are returned by default.
4. Use `GET /api/mailboxes/options` for lightweight dropdown data.
5. Change default queue explicitly with `POST /api/mailboxes/:id/set-default`.
6. Operational state changes use:
   - `POST /api/mailboxes/:id/activate`
   - `POST /api/mailboxes/:id/deactivate`
7. Default mailbox cannot be deactivated; set another mailbox as default first.
8. Mailbox v1 has no delete endpoint.

### Flow F: Customer Organizations, Contacts, and Contact Identities v1

1. Authenticate normally and keep an access token scoped to the active workspace session.
2. Create organizations with `POST /api/customers/organizations` when a contact should be linked to a company/customer account.
3. Create contacts with `POST /api/customers/contacts`; `organizationId` is optional and must reference a same-workspace active organization when provided.
4. Use `GET /api/customers/organizations` and `GET /api/customers/contacts` for paginated list/search/filter reads.
5. Use `/options` endpoints for lightweight selector data:
   - `GET /api/customers/organizations/options`
   - `GET /api/customers/contacts/options`
6. Use `GET /api/customers/organizations/:id` and `GET /api/customers/contacts/:id` for detail reads, then `PATCH` those same resource paths for partial edits.
7. Ticket create can continue referencing `contactId`; when the contact is linked to an organization, the ticket organization can still be derived from that contact.
8. Use `GET /api/customers/contacts/:id/identities` to read the linked identity records for one contact and `POST /api/customers/contacts/:id/identities` to add one.
9. ContactIdentity v1 is intentionally minimal: no update/delete/archive endpoints, no verification lifecycle, and no customer-auth/widget session behavior.

### Flow G: Ticket Categories and Tags

1. Owner/Admin creates ticket categories and tags inside the current workspace.
2. Use `GET /api/tickets/categories` and `GET /api/tickets/tags` for paginated admin/operator reads.
3. Use `GET /api/tickets/categories/options` and `GET /api/tickets/tags/options` for lightweight selector data.
4. Operational users (`owner|admin|agent|viewer`) can read active dictionaries.
5. Category/tag activation state is managed explicitly through activate/deactivate endpoints.

### Flow H: Tickets Core

1. Authenticate normally and keep an access token scoped to the active workspace session.
2. Create and maintain ticket categories/tags when structured routing is needed.
3. Create a ticket with `POST /api/tickets`; `mailboxId` is optional and falls back to the workspace default mailbox.
4. Upload files first through `POST /api/files` when a ticket or reply needs attachments.
5. Use `GET /api/tickets` for paginated list/search/filter reads and `GET /api/tickets/:id` for detail.
6. Use `GET /api/tickets/:id/conversation` and `GET /api/tickets/:id/messages` to render the thread.
7. Use `POST /api/tickets/:id/messages` for `customer_message`, `public_reply`, and `internal_note`.
8. Use `PATCH /api/tickets/:id` for editable record updates (`subject`, `priority`, `categoryId`, `tagIds`, `mailboxId` before any messages exist).
9. Use `POST /api/tickets/:id/assign`, `POST /api/tickets/:id/unassign`, and `POST /api/tickets/:id/self-assign` for operational assignment control.
10. Use `POST /api/tickets/:id/status`, `POST /api/tickets/:id/solve`, `POST /api/tickets/:id/close`, and `POST /api/tickets/:id/reopen` for explicit lifecycle actions.
11. Use `GET /api/tickets/:id/participants`, `POST /api/tickets/:id/participants`, and `DELETE /api/tickets/:id/participants/:userId` for internal watcher/collaborator metadata.

### Flow I: SLA v1 Active Surface (Foundations + Runtime)

1. Authenticate normally and keep an access token scoped to the active workspace session.
2. Create one or more business-hours records with `POST /api/sla/business-hours`; each record uses its own IANA timezone and weekday windows.
3. Create one or more SLA policies with `POST /api/sla/policies`; every policy must reference a same-workspace `businessHoursId`.
4. Set the workspace default SLA policy explicitly with `POST /api/sla/policies/:id/set-default` when most tickets should inherit the same policy.
5. Optionally assign a mailbox override through mailbox create/update using `slaPolicyId`; ticket selection order is `mailbox.slaPolicyId -> workspace.defaultSlaPolicyId -> no SLA`.
6. When a ticket is created, the backend snapshots the effective SLA using `mailbox.slaPolicyId -> workspace.defaultSlaPolicyId -> no SLA`; no new ticket-create request fields are required.
7. `public_reply` satisfies first response SLA, moves the ticket to `waiting_on_customer`, and pauses resolution SLA; `customer_message` resumes paused resolution and reopens solved tickets to `open`; `internal_note` does not satisfy first response SLA.
8. `POST /api/tickets/:id/solve` marks the resolution SLA against `solved`, `POST /api/tickets/:id/close` preserves that resolved marker, and `POST /api/tickets/:id/reopen` resumes from remaining business time instead of resetting a fresh budget.
9. `GET /api/sla/summary` exposes lightweight workspace-scoped current totals, including runtime-derived breached/running/paused counts, without hidden read-time writes.
10. Still postponed in active v1:

- next-response SLA
- reminders, escalations, notifications, or jobs
- holiday runtime logic
- cycle-history modeling
- historical/date-range reporting

### Flow J: Realtime Bootstrap -> Connect -> Subscribe

1. Authenticate normally and keep a valid workspace-scoped access token.
2. Optionally call `GET /api/realtime/bootstrap` to hydrate the current realtime path, feature flags, and canonical user/workspace context summary.
3. Open a Socket.IO connection using the same access token semantics as HTTP auth.
4. The socket is always authenticated against the current session workspace; old access tokens become invalid after `POST /api/workspaces/switch`, and existing sockets from that session are disconnected so the frontend can reconnect with the fresh token.
5. Session-revocation flows (`POST /api/auth/logout`, `POST /api/auth/logout-all`, `POST /api/auth/change-password`, `POST /api/auth/reset-password`) also trigger a best-effort immediate disconnect for sockets bound to the revoked sessions.
6. Subscribe explicitly to the current workspace room with `workspace.subscribe`.
7. Subscribe explicitly to a readable ticket room with `ticket.subscribe` when the UI opens that ticket.
8. Treat MongoDB-backed REST reads as the source of truth; realtime is a live-collaboration transport, not a replacement for canonical reads.

## Realtime / Live Collaboration

### Purpose and scope

- Realtime in this phase is only for the internal authenticated workspace app.
- MongoDB + REST remain the source of truth for data and business invariants.
- This phase includes:
  - transport/auth/room foundations
  - live ticket/message/participant business events published from the existing service layer
  - lightweight realtime-only user notices for directly affected internal users
  - ephemeral ticket presence states for internal collaborators
  - ephemeral typing indicators for ticket replies and internal notes
  - advisory soft-claim signals for ticket handling coordination
- Intentionally deferred:
  - hard locks or exclusive edit enforcement
  - collaborative shared drafts
  - customer/public widget realtime
  - public SDK contracts
  - webhook delivery
  - BullMQ/jobs/workers for realtime
  - offline replay or backlog recovery

### Auth model for sockets

- Socket auth uses the same access token model as protected HTTP routes.
- Required access-token rules:
  - valid signature
  - valid issuer and audience
  - `typ = access`
  - `ver = 1`
  - required claims: `sub`, `sid`, `wid`, `r`
- Backing session rules:
  - session must exist
  - session must not be revoked
  - session must not be expired
  - session `workspaceId` must still equal token `wid`
- User and membership rules:
  - user must be active
  - membership in token workspace must be active
- Frontend implication:
  - after `POST /api/workspaces/switch`, the old access token is behaviorally invalid for both HTTP and socket connections
  - the backend also disconnects existing sockets from that session so the client can reconnect with the new access token cleanly
  - logout/logout-all/change-password/reset-password also disconnect sockets tied to revoked sessions on a best-effort basis

### Connection model

- Socket transport: Socket.IO
- Default path: `/socket.io`
- Token transport:
  - preferred: `auth.token` in the Socket.IO client options
  - supported: `Authorization: Bearer <accessToken>` handshake header
- Realtime bootstrap endpoint:
  - `GET /api/realtime/bootstrap`
  - purpose: return a small authenticated summary so FE can initialize connection settings, feature flags, and collaboration TTL guidance without hardcoding assumptions

### Rooms

- User-private room:
  - `user:{userId}`
  - joined automatically after successful socket auth
- Workspace room:
  - `workspace:{workspaceId}`
  - joined only through explicit `workspace.subscribe`
- Ticket room:
  - `ticket:{ticketId}`
  - joined only through explicit `ticket.subscribe`

### Ack contract

- Socket acknowledgements use a compact envelope:

```json
{
  "ok": true,
  "code": "realtime.workspace.subscribed",
  "messageKey": "success.ok",
  "data": {
    "scope": "workspace",
    "room": "workspace:65f1...",
    "workspaceId": "65f1...",
    "ticketId": null
  }
}
```

- Error ack example:

```json
{
  "ok": false,
  "code": "errors.ticket.notFound",
  "messageKey": "errors.ticket.notFound",
  "data": null
}
```

### Event envelope contract

```json
{
  "event": "ticket.updated",
  "eventId": "4fcd7a49-7b84-4c62-9d74-0df0d4cb7f51",
  "occurredAt": "2026-03-25T10:15:30.000Z",
  "workspaceId": "65f1...",
  "actorUserId": "65ef...",
  "data": {
    "ticket": {
      "_id": "65f0...",
      "status": "open"
    }
  }
}
```

### Business event layer

- All business events are emitted only after the underlying write flow succeeds and its counters/SLA side effects are finalized.
- Event names in the current ticket collaboration surface:
  - `ticket.created`
  - `ticket.updated`
  - `ticket.status_changed`
  - `ticket.assigned`
  - `ticket.unassigned`
  - `ticket.solved`
  - `ticket.closed`
  - `ticket.reopened`
  - `message.created`
  - `conversation.updated`
  - `ticket.participant_changed`
  - `user.notice`
- Typical room targeting:
  - `workspace:{workspaceId}` for ticket list/dashboard relevant updates
  - `ticket:{ticketId}` for ticket detail, conversation, and participant updates
  - `user:{userId}` for lightweight personal notices such as `ticket_assigned`, `ticket_unassigned`, `ticket_participant_added`, and `ticket_participant_removed`
- Current trigger mapping:
  - `POST /api/tickets` -> `ticket.created`
  - `POST /api/tickets` with `initialMessage` -> `ticket.created`, then `message.created`, then `conversation.updated`
  - `PATCH /api/tickets/:id` -> `ticket.updated`
  - `POST /api/tickets/:id/assign` and `POST /api/tickets/:id/self-assign` -> `ticket.assigned`
  - `POST /api/tickets/:id/unassign` -> `ticket.unassigned`
  - `POST /api/tickets/:id/status` -> `ticket.status_changed`
  - `POST /api/tickets/:id/solve` -> `ticket.solved`
  - `POST /api/tickets/:id/close` -> `ticket.closed`
  - `POST /api/tickets/:id/reopen` -> `ticket.reopened`
  - `POST /api/tickets/:id/messages` -> `message.created` and `conversation.updated`
  - `POST /api/tickets/:id/participants` and `DELETE /api/tickets/:id/participants/:userId` -> `ticket.participant_changed`
- Example `message.created` payload:

```json
{
  "event": "message.created",
  "eventId": "4fcd7a49-7b84-4c62-9d74-0df0d4cb7f51",
  "occurredAt": "2026-03-25T10:15:30.000Z",
  "workspaceId": "65f1...",
  "actorUserId": "65ef...",
  "data": {
    "ticket": {
      "_id": "65f0...",
      "status": "waiting_on_customer",
      "messageCount": 4,
      "lastMessageType": "public_reply"
    },
    "conversation": {
      "_id": "65f2...",
      "messageCount": 4,
      "lastMessageType": "public_reply"
    },
    "message": {
      "_id": "65f3...",
      "type": "public_reply",
      "bodyText": "Reply body"
    }
  }
}
```

- Example `user.notice` payload:

```json
{
  "event": "user.notice",
  "eventId": "4fcd7a49-7b84-4c62-9d74-0df0d4cb7f51",
  "occurredAt": "2026-03-25T10:15:30.000Z",
  "workspaceId": "65f1...",
  "actorUserId": "65ef...",
  "data": {
    "noticeType": "ticket_assigned",
    "ticket": {
      "_id": "65f0...",
      "number": 42,
      "subject": "VIP follow-up",
      "status": "open",
      "assigneeId": "65ee..."
    }
  }
}
```

- Frontend guidance:
  - use the event payload for optimistic live surface updates only
  - use existing REST detail/list endpoints whenever canonical re-hydration is needed
  - do not treat realtime as an offline replay or guaranteed delivery channel in this phase

### Collaboration behavior layer

- Presence, typing, and soft-claim are ephemeral live signals only.
- They do not update MongoDB ticket truth and they do not replace REST reads.
- The current collaboration state source is the realtime collaboration store backed by the shared Redis foundation when enabled, with single-instance in-memory fallback in dev/test.
- Any active readable member, including `viewer`, may send these advisory collaboration signals in the current internal-only phase.
- Frontend should reconnect by:
  - reconnecting the socket with the current access token
  - re-running `workspace.subscribe` and `ticket.subscribe`
  - consuming the fresh `ticket.presence.snapshot`
  - resending current presence or soft-claim intent if the UI still needs it
- TTL/refresh guidance:
  - `ticket.presence.set` refreshes presence for the calling socket
  - `ticket.typing.start` refreshes typing for the calling socket
  - `ticket.soft_claim.set` refreshes the current soft claim
  - FE should refresh long-lived presence and soft-claim signals before the advertised TTL expires
- Multi-node note:
  - expiry broadcasts are best-effort live signals
  - reconnect plus `ticket.presence.snapshot` remains the recovery path if a node misses an expiry fan-out edge

- Current collaboration event names:
  - `ticket.presence.snapshot`
  - `ticket.presence.changed`
  - `ticket.typing.changed`
  - `ticket.soft_claim.changed`

- Current client action names:
  - `ticket.presence.set`
  - `ticket.typing.start`
  - `ticket.typing.stop`
  - `ticket.soft_claim.set`
  - `ticket.soft_claim.clear`

- Collaboration payload shape principles:
  - snapshots include `presence`, `typing`, and `softClaim` together for the subscribed ticket
  - changed events include only the state family that changed
  - entries carry lightweight internal user summaries plus the current live state
  - payloads stay compact and are safe to use for direct FE state replacement

- Example `ticket.presence.snapshot` payload:

```json
{
  "event": "ticket.presence.snapshot",
  "eventId": "4fcd7a49-7b84-4c62-9d74-0df0d4cb7f51",
  "occurredAt": "2026-03-25T10:15:30.000Z",
  "workspaceId": "65f1...",
  "actorUserId": null,
  "data": {
    "ticketId": "65f0...",
    "presence": [
      {
        "userId": "65ef...",
        "state": "replying",
        "updatedAt": "2026-03-25T10:15:20.000Z",
        "user": {
          "_id": "65ef...",
          "email": "agent@example.com",
          "name": "Agent One",
          "avatar": null,
          "status": "active",
          "roleKey": "agent"
        }
      }
    ],
    "typing": [
      {
        "userId": "65ef...",
        "mode": "public_reply",
        "updatedAt": "2026-03-25T10:15:25.000Z",
        "user": {
          "_id": "65ef...",
          "email": "agent@example.com",
          "name": "Agent One",
          "avatar": null,
          "status": "active",
          "roleKey": "agent"
        }
      }
    ],
    "softClaim": {
      "userId": "65ef...",
      "claimedAt": "2026-03-25T10:15:10.000Z",
      "updatedAt": "2026-03-25T10:15:10.000Z",
      "user": {
        "_id": "65ef...",
        "email": "agent@example.com",
        "name": "Agent One",
        "avatar": null,
        "status": "active",
        "roleKey": "agent"
      }
    }
  }
}
```

- Example `ticket.presence.changed` payload:

```json
{
  "event": "ticket.presence.changed",
  "eventId": "4fcd7a49-7b84-4c62-9d74-0df0d4cb7f51",
  "occurredAt": "2026-03-25T10:15:30.000Z",
  "workspaceId": "65f1...",
  "actorUserId": "65ef...",
  "data": {
    "ticketId": "65f0...",
    "presence": [
      {
        "userId": "65ef...",
        "state": "viewing",
        "updatedAt": "2026-03-25T10:15:30.000Z",
        "user": {
          "_id": "65ef...",
          "email": "agent@example.com",
          "name": "Agent One",
          "avatar": null,
          "status": "active",
          "roleKey": "agent"
        }
      }
    ]
  }
}
```

- `ticket.presence.set`
  - purpose: declare or refresh the caller's current ticket-presence state
  - payload:

```json
{
  "ticketId": "65f0...",
  "state": "viewing"
}
```

- allowed `state` values:
  - `viewing`
  - `replying`
  - `internal_note`
- rules:
  - ticket must belong to the authenticated workspace
  - socket must already be subscribed to `ticket:{ticketId}`
  - same-state refreshes update TTL without broadcasting noisy duplicate change events
  - conflicting bursts inside the configured collaboration throttle window are rejected with `errors.realtime.rateLimited`
- success ack:
  - `code = realtime.ticket.presence.updated`

- `ticket.typing.start`
  - purpose: start or refresh an ephemeral typing signal
  - payload:

```json
{
  "ticketId": "65f0...",
  "mode": "public_reply"
}
```

- allowed `mode` values:
  - `public_reply`
  - `internal_note`
- success ack:
  - `code = realtime.ticket.typing.started`
  - same-mode refreshes stay quiet and only extend the live signal when needed

- `ticket.typing.stop`
  - purpose: clear the caller's active typing signal on the ticket
  - payload:

```json
{
  "ticketId": "65f0..."
}
```

- success ack:
  - `code = realtime.ticket.typing.stopped`

- `ticket.soft_claim.set`
  - purpose: set or refresh an advisory soft claim for the caller
  - payload:

```json
{
  "ticketId": "65f0..."
}
```

- rules:
  - soft claim is advisory only and does not block writes
  - another authenticated collaborator can replace the current soft claim
  - soft claim expires automatically if not refreshed
- success ack:
  - `code = realtime.ticket.softClaim.set`
  - same-holder refreshes stay quiet and only extend the advisory claim window

- `ticket.soft_claim.clear`
  - purpose: clear the current soft claim for the ticket
  - payload:

```json
{
  "ticketId": "65f0..."
}
```

- success ack:
  - `code = realtime.ticket.softClaim.cleared`

- Common collaboration action errors:
  - `errors.auth.invalidToken`
  - `errors.auth.sessionRevoked`
  - `errors.auth.userSuspended`
  - `errors.auth.forbiddenTenant`
  - `errors.validation.invalidId`
  - `errors.validation.invalidEnum`
  - `errors.ticket.notFound`
  - `errors.realtime.ticketSubscriptionRequired`
  - `errors.realtime.rateLimited`

### Subscribe / unsubscribe actions

#### `workspace.subscribe`

- Purpose: join the authenticated workspace room for future internal collaboration events.
- Client payload:

```json
{
  "workspaceId": "65f1..."
}
```

- Request rules:
  - `workspaceId` is optional, but when sent it must equal the authenticated token workspace
  - the server never trusts an arbitrary client workspace id
- Success ack:
  - `ok = true`
  - `code = realtime.workspace.subscribed`
  - `data.scope = workspace`
  - `data.room = workspace:{workspaceId}`
- Common errors:
  - `errors.auth.invalidToken`
  - `errors.auth.sessionRevoked`
  - `errors.auth.userSuspended`
  - `errors.auth.forbiddenTenant`
  - `errors.validation.invalidId`
- Anti-enumeration note:
  - the server only allows the current authenticated workspace; there is no cross-workspace join path

#### `workspace.unsubscribe`

- Purpose: leave the authenticated workspace room.
- Client payload:

```json
{
  "workspaceId": "65f1..."
}
```

- Success ack:
  - `ok = true`
  - `code = realtime.workspace.unsubscribed`

#### `ticket.subscribe`

- Purpose: join one readable ticket room inside the authenticated workspace.
- Client payload:

```json
{
  "ticketId": "65f0..."
}
```

- Request rules:
  - `ticketId` is required
  - ticket must exist in the authenticated workspace
  - ticket read access uses the same tenant scope as REST ticket reads
  - on success, the server immediately emits `ticket.presence.snapshot` to the subscribing socket with the current live collaboration state for that ticket
- Success ack:
  - `ok = true`
  - `code = realtime.ticket.subscribed`
  - `data.scope = ticket`
  - `data.room = ticket:{ticketId}`
- Common errors:
  - `errors.auth.invalidToken`
  - `errors.auth.sessionRevoked`
  - `errors.auth.userSuspended`
  - `errors.auth.forbiddenTenant`
  - `errors.validation.invalidId`
  - `errors.ticket.notFound`
- Anti-enumeration note:
  - cross-workspace ticket ids collapse to `errors.ticket.notFound`

#### `ticket.unsubscribe`

- Purpose: leave one readable ticket room inside the authenticated workspace.
- Client payload:

```json
{
  "ticketId": "65f0..."
}
```

- Success ack:
  - `ok = true`
  - `code = realtime.ticket.unsubscribed`
- Notes:
  - unsubscribing also clears that socket's ephemeral presence, typing, and soft-claim state for the ticket before future subscribers receive the next snapshot

### GET `/api/realtime/bootstrap`

- Purpose: return a frontend-friendly summary for realtime initialization in the authenticated workspace app.
- Requirements:
  - Authorization required
  - active user
  - active workspace membership
- Request body:
  - none
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "realtime": {
    "enabled": true,
    "socketPath": "/socket.io",
    "transports": ["websocket", "polling"],
    "auth": {
      "sessionId": "65fa...",
      "userId": "65f0...",
      "workspaceId": "65f1...",
      "roleKey": "owner"
    },
    "user": {
      "_id": "65f0...",
      "email": "user@example.com"
    },
    "workspace": {
      "_id": "65f1...",
      "name": "Acme Workspace",
      "slug": "acme-workspace",
      "status": "active"
    },
    "features": {
      "roomSubscriptions": true,
      "businessEvents": true,
      "presence": true,
      "typing": true,
      "softClaim": true
    },
    "collaboration": {
      "requiresTicketSubscription": true,
      "presenceTtlMs": 45000,
      "typingTtlMs": 8000,
      "softClaimTtlMs": 45000,
      "actionThrottleMs": 75
    },
    "redis": {
      "enabled": false,
      "adapterEnabled": false,
      "connected": false,
      "adapterConnected": false
    }
  }
}
```

- Common errors:
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked`
  - `403` `errors.auth.userSuspended | errors.auth.forbiddenTenant`
- Notes:
  - this endpoint is informational only
  - it does not mint tokens or change workspace/session state
  - REST and DB remain the source of truth for business data
  - `collaboration.actionThrottleMs` is the modest server-side guard window for conflicting collaboration-action bursts from the same socket

## 4) Auth Endpoints Reference

### POST `/api/auth/signup`

- Purpose: create a new unverified user (or reuse existing unverified user) and send verify-email OTP.
- Request body:

```json
{
  "email": "user@example.com",
  "password": "Password123!",
  "name": "Optional Name"
}
```

- `email`: required, valid email, max 320
- `password`: required, 8..128
- `name`: optional, 1..160
- Success `200`:

```json
{
  "messageKey": "success.auth.otpSent",
  "message": "Verification code sent successfully."
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `409` `errors.auth.emailAlreadyUsed`
  - `429` `errors.otp.resendTooSoon` or `errors.otp.rateLimited`
- Notes:
  - If user already exists but is unverified, API still returns success and re-issues verify-email OTP.
  - Tokens are not issued here.

### POST `/api/auth/resend-otp`

- Purpose: request OTP resend for a specific purpose.
- Request body:

```json
{
  "email": "user@example.com",
  "purpose": "verifyEmail"
}
```

- `purpose` must be one of: `verifyEmail | login | resetPassword | changeEmail`
- Success `200` (generic):

```json
{
  "messageKey": "success.auth.otpResent",
  "message": "Verification code resent successfully."
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `429` `errors.otp.resendTooSoon` or `errors.otp.rateLimited`
- Notes (anti-enumeration):
  - API returns generic success even when no OTP is actually sent.
  - Actual send eligibility in current MVP:
    - `verifyEmail`: user exists, unverified, active, not deleted.
    - `resetPassword`: user exists, verified, active, not deleted.
    - `login` and `changeEmail`: no-op success.

### POST `/api/auth/verify-email`

- Purpose: verify OTP and issue login tokens.
- Request body:

```json
{
  "email": "user@example.com",
  "code": "123456",
  "inviteToken": "optional-invite-token"
}
```

- `code`: digits, 4..8
- `inviteToken`: optional, 10..512
- Success `200`:

```json
{
  "messageKey": "success.auth.verified",
  "message": "Email verified successfully.",
  "user": {
    "_id": "65f0...",
    "email": "user@example.com",
    "isEmailVerified": true,
    "defaultWorkspaceId": "65f1..."
  },
  "tokens": {
    "accessToken": "jwt...",
    "refreshToken": "jwt..."
  },
  "workspaceId": "65f9...",
  "activeWorkspaceId": "65f1...",
  "inviteWorkspaceId": "65f9..."
}
```

- Common errors:
  - `422` `errors.validation.failed` (for example `errors.otp.invalid` / `errors.otp.expired` in `errors[]`)
  - `429` `errors.otp.tooManyAttempts`
  - `403` `errors.auth.userSuspended`
  - `400` invite token errors (`errors.invite.invalid | errors.invite.expired | errors.invite.revoked | errors.invite.emailMismatch`)
- Notes:
  - Tokens are issued on success.
  - `inviteToken` is used to finalize invite acceptance for unverified invitees.
  - `workspaceId` is returned for FE convenience and is `inviteWorkspaceId || activeWorkspaceId`.
  - `activeWorkspaceId` is the workspace used to mint the access token (`wid` claim).
  - `inviteWorkspaceId` is the finalized invited workspace when `inviteToken` is provided, otherwise `null`.
  - Invite finalization does not auto-switch workspace context.

### POST `/api/auth/login`

- Purpose: login verified user and issue workspace-scoped tokens.
- Request body:

```json
{
  "email": "user@example.com",
  "password": "Password123!"
}
```

- Success `200`:

```json
{
  "messageKey": "success.auth.loggedIn",
  "message": "Logged in successfully.",
  "user": { "_id": "65f0...", "email": "user@example.com" },
  "tokens": { "accessToken": "jwt...", "refreshToken": "jwt..." }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `401` `errors.auth.invalidCredentials`
  - `403` `errors.auth.emailNotVerified | errors.auth.userSuspended | errors.auth.forbiddenTenant`

### POST `/api/auth/refresh`

- Purpose: rotate refresh/access tokens for an active session.
- Request body:

```json
{
  "refreshToken": "jwt..."
}
```

- Success `200`:

```json
{
  "messageKey": "success.auth.refreshed",
  "message": "Session refreshed successfully.",
  "tokens": { "accessToken": "jwt...", "refreshToken": "jwt..." }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked`
  - `403` `errors.auth.emailNotVerified | errors.auth.userSuspended | errors.auth.forbiddenTenant`
- Notes:
  - Frontend MUST replace both `accessToken` and `refreshToken` with the returned pair.
  - Refresh token rotation invalidates the previous refresh token immediately.

### POST `/api/auth/forgot-password`

- Purpose: request reset-password OTP.
- Request body:

```json
{
  "email": "user@example.com"
}
```

- Success `200` (generic):

```json
{
  "messageKey": "success.auth.resetOtpSent",
  "message": "Password reset code sent if the account exists."
}
```

- Common errors:
  - `422` `errors.validation.failed`
- Notes (anti-enumeration):
  - Generic success is returned even if account does not qualify.
  - OTP is only sent for users who are existing, verified, active, and not deleted.
  - OTP sending/rate-limit failures are intentionally hidden behind the same generic success response.

### POST `/api/auth/reset-password`

- Purpose: verify reset OTP and set a new password.
- Request body:

```json
{
  "email": "user@example.com",
  "code": "123456",
  "newPassword": "NewPassword456!"
}
```

- Success `200`:

```json
{
  "messageKey": "success.auth.passwordReset",
  "message": "Password reset successfully."
}
```

- Common errors:
  - `422` `errors.validation.failed` (for example OTP invalid/expired, or `errors.auth.passwordMustDiffer` on field `newPassword`)
  - `429` `errors.otp.tooManyAttempts`
  - `401` `errors.auth.invalidCredentials`
  - `403` `errors.auth.userSuspended`
- Notes:
  - On success, all user sessions are revoked.
  - Realtime sockets bound to those revoked sessions are disconnected on a best-effort basis.

### GET `/api/auth/me`

- Purpose: canonical current auth context for FE state hydration and UI gating.
- Requirements:
  - requires Authorization header
  - session must be active
  - user must be active
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "user": { "_id": "65f0...", "email": "user@example.com" },
  "workspace": {
    "_id": "65f1...",
    "name": "Acme Workspace",
    "slug": "acme-workspace",
    "status": "active"
  },
  "roleKey": "owner"
}
```

- Common errors:
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked`
  - `403` `errors.auth.userSuspended | errors.auth.forbiddenTenant`
- Notes:
  - FE should treat this endpoint as the canonical source for current workspace and role.
  - Active workspace resolution order:
    1. `session.workspaceId` if membership is active.
    2. `user.lastWorkspaceId` if membership is active.
    3. `user.defaultWorkspaceId` if membership is active.
    4. first active membership.

### POST `/api/auth/logout`

- Purpose: revoke current session.
- Requirements:
  - requires Authorization header
  - user must be active
- Request body: optional (empty object is fine)
- Success `200`:

```json
{
  "messageKey": "success.auth.loggedOut",
  "message": "Logged out successfully."
}
```

- Common errors:
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked`
  - `403` `errors.auth.userSuspended`
- Notes:
  - Realtime sockets bound to the current revoked session are disconnected on a best-effort basis.

### POST `/api/auth/logout-all`

- Purpose: revoke all sessions for current user.
- Requirements:
  - requires Authorization header
  - user must be active
- Request body: optional (empty object is fine)
- Success `200`:

```json
{
  "messageKey": "success.auth.loggedOutAll",
  "message": "Logged out from all sessions successfully."
}
```

- Common errors:
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked`
  - `403` `errors.auth.userSuspended`
- Notes:
  - Realtime sockets bound to revoked sessions are disconnected on a best-effort basis.

### POST `/api/auth/change-password`

- Purpose: change password using current password.
- Requirements:
  - requires Authorization header
  - user must be active
- Request body:

```json
{
  "currentPassword": "Password123!",
  "newPassword": "NewPassword456!"
}
```

- both fields required, 8..128
- `newPassword` must differ from `currentPassword`
- Success `200`:

```json
{
  "messageKey": "success.auth.passwordChanged",
  "message": "Password changed successfully."
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked | errors.auth.invalidCredentials`
  - `403` `errors.auth.userSuspended`
- Notes:
  - On success, all sessions are revoked. User must login again.
  - Realtime sockets bound to revoked sessions are disconnected on a best-effort basis.

## 5) Workspace Context Endpoints

### GET `/api/workspaces/mine`

- Purpose: list all active workspace memberships for the authenticated user and identify the current active workspace for this session.
- Requirements:
  - requires Authorization header
  - user must be active
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "currentWorkspaceId": "65f9...",
  "memberships": [
    {
      "workspaceId": "65f1...",
      "workspace": {
        "name": "Acme Workspace",
        "slug": "acme-workspace",
        "status": "active"
      },
      "roleKey": "admin",
      "memberStatus": "active",
      "isOwner": false,
      "isCurrent": false
    },
    {
      "workspaceId": "65f9...",
      "workspace": {
        "name": "Support Workspace",
        "slug": "support-workspace",
        "status": "active"
      },
      "roleKey": "agent",
      "memberStatus": "active",
      "isOwner": false,
      "isCurrent": true
    }
  ]
}
```

- Common errors:
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked`
  - `403` `errors.auth.userSuspended`
- Notes:
  - This endpoint is workspace-agnostic and returns all active memberships for the current user.
  - `workspaceId` is the canonical workspace identifier for each membership item.
  - Nested `workspace` intentionally excludes `_id` to avoid duplicate id fields.
  - `currentWorkspaceId` + membership `isCurrent` reflect the active workspace in the current authenticated session.
  - `GET /api/auth/me` remains the canonical source for active workspace + role hydration.

### POST `/api/workspaces/switch`

- Purpose: explicitly switch the current session active workspace context.
- Requirements:
  - requires Authorization header
  - user must be active
- Request body:

```json
{
  "workspaceId": "65f9..."
}
```

- Success `200`:

```json
{
  "messageKey": "success.workspace.switched",
  "message": "Workspace switched successfully.",
  "accessToken": "jwt...",
  "workspace": {
    "_id": "65f9...",
    "name": "Support Workspace",
    "slug": "support-workspace",
    "status": "active"
  },
  "roleKey": "agent"
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked`
  - `403` `errors.auth.userSuspended | errors.workspace.notMember | errors.workspace.inactiveMember`
  - `404` `errors.workspace.notFound`
- Notes:
  - This is the only endpoint that changes active workspace context.
  - Client must replace in-memory access token with returned `accessToken`.
  - Old access token becomes invalid immediately after switch.

## 6) Workspace Invite Endpoints Reference

### Shared requirements for protected invite management routes

Applies to:

- `POST /api/workspaces/:workspaceId/invites`
- `GET /api/workspaces/:workspaceId/invites`
- `GET /api/workspaces/:workspaceId/invites/:inviteId`
- `POST /api/workspaces/:workspaceId/invites/:inviteId/resend`
- `POST /api/workspaces/:workspaceId/invites/:inviteId/revoke`

Requirements:

- requires Authorization header
- user must be active
- must be an active member of the token workspace
- role must be `owner` or `admin`
- `:workspaceId` must match token workspace id (`wid`)

### POST `/api/workspaces/:workspaceId/invites`

- Purpose: create a workspace invite.
- Request body:

```json
{
  "email": "agent@example.com",
  "roleKey": "agent"
}
```

- Success `200`:

```json
{
  "messageKey": "success.invite.created",
  "message": "Invitation created successfully.",
  "invite": {
    "_id": "65f2...",
    "workspaceId": "65f1...",
    "email": "agent@example.com",
    "roleKey": "agent",
    "status": "pending",
    "expiresAt": "2026-03-10T12:00:00.000Z"
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
  - `404` `errors.workspace.notFound`
  - `409` `errors.invite.alreadyPending | errors.invite.alreadyMember`
- Notes:
  - Invite email link uses `FRONTEND_BASE_URL`.
  - Existing non-removed membership in same workspace blocks new invite for that email.

### GET `/api/workspaces/:workspaceId/invites`

- Purpose: list invites for workspace with pagination.
- Request query:
  - `status` optional (`pending|accepted|revoked|expired`)
  - `page` optional (`>= 1`, default `1`)
  - `limit` optional (`1..100`, default `10`)
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "page": 1,
  "limit": 10,
  "total": 2,
  "results": 2,
  "invites": [
    {
      "_id": "65f2...",
      "workspaceId": "65f1...",
      "email": "agent@example.com",
      "roleKey": "agent",
      "status": "pending",
      "expiresAt": "2026-03-10T12:00:00.000Z"
    }
  ]
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`

### GET `/api/workspaces/:workspaceId/invites/:inviteId`

- Purpose: fetch a single invite by id.
- Request params:
  - `workspaceId`: mongo id
  - `inviteId`: mongo id
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "invite": {
    "_id": "65f2...",
    "workspaceId": "65f1...",
    "email": "agent@example.com",
    "roleKey": "agent",
    "status": "pending",
    "expiresAt": "2026-03-10T12:00:00.000Z"
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
  - `404` `errors.invite.notFound`

### POST `/api/workspaces/:workspaceId/invites/:inviteId/resend`

- Purpose: regenerate invite token and resend invite email.
- Request body: optional (empty object is fine)
- Success `200`:

```json
{
  "messageKey": "success.invite.resent",
  "message": "Invitation resent successfully."
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
  - `404` `errors.invite.notFound | errors.workspace.notFound`
  - `400` `errors.invite.invalid | errors.invite.revoked | errors.invite.expired`

### POST `/api/workspaces/:workspaceId/invites/:inviteId/revoke`

- Purpose: revoke an invite (idempotent if already revoked).
- Request body: optional (empty object is fine)
- Success `200`:

```json
{
  "messageKey": "success.invite.revoked",
  "message": "Invitation revoked successfully."
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
  - `404` `errors.invite.notFound`

### POST `/api/workspaces/invites/accept`

- Purpose: accept invite from invite-link token.
- Requirements:
  - no Authorization header required
- Request body:

```json
{
  "token": "raw-invite-token",
  "email": "invitee@example.com",
  "password": "OptionalIfUserAlreadyExists",
  "name": "Optional Name"
}
```

- `token` required, 16..512
- `email` required, valid email
- `password` optional by schema, but required if user does not exist
- `name` optional
- Success `200` (verified user):

```json
{
  "messageKey": "success.invite.accepted",
  "message": "Invitation accepted successfully.",
  "workspaceId": "65f1...",
  "roleKey": "admin"
}
```

- Success `200` (new/unverified user):

```json
{
  "messageKey": "success.invite.acceptRequiresVerification",
  "message": "Verification code sent. Verify your email to complete invitation acceptance.",
  "workspaceId": "65f1...",
  "roleKey": "agent"
}
```

- Common errors:
  - `422` `errors.validation.failed` (includes password-required case with `errors.auth.passwordRequiredForInvite`)
  - `403` `errors.auth.userSuspended`
  - `400` `errors.invite.invalid | errors.invite.expired | errors.invite.revoked | errors.invite.emailMismatch`
  - `429` `errors.otp.resendTooSoon | errors.otp.rateLimited`
- Notes:
  - This endpoint does not return auth tokens.
  - Response includes invited `workspaceId` so client can switch context explicitly later.
  - Client should call `POST /api/workspaces/switch` with this returned `workspaceId` when switching into the invited workspace context.
  - For unverified invitees, finalization happens only after `POST /api/auth/verify-email` with `inviteToken`.
  - Invite acceptance does not auto-switch active workspace.
  - Frontend next steps:
    - If `success.invite.accepted`: redirect user to login screen (or perform login if auto-login is implemented in future).
    - If `success.invite.acceptRequiresVerification`: show OTP verification UI and call `POST /api/auth/verify-email` with `inviteToken` to finalize membership and receive tokens.
    - Then call `POST /api/workspaces/switch` when user chooses to move to invited workspace context.

## 7) Common FE Error Handling Guidance

- `errors.auth.invalidToken` or `errors.auth.sessionRevoked`: clear tokens and force logout.
- `errors.auth.forbiddenTenant`: show "no access to this workspace" without necessarily logging user out.
- `errors.otp.rateLimited` or `errors.otp.resendTooSoon`: show cooldown timer before allowing resend.

## 8) Files Endpoints Reference (Files v1)

### Auth + authorization requirements

- All file endpoints are protected and require Authorization header.
- All file endpoints are session-context endpoints and are strictly scoped to token workspace (`wid` / `session.workspaceId`).
- Upload roles: `owner | admin | agent`.
- Delete roles: `owner | admin`.
- Viewer can list/get/download metadata+content but cannot upload/delete.
- Download remains backend-streamed in v1 through `GET /api/files/:fileId/download`.

### POST `/api/files`

- Purpose: upload one file via multipart form-data, store object in private storage, and create file metadata record.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin|agent`
- Request schema:
  - Content-Type: `multipart/form-data`
  - field `file`: required, single file only
  - optional text field `kind`
  - optional text field `source`
- Success `200`:

```json
{
  "messageKey": "success.file.uploaded",
  "message": "File uploaded successfully.",
  "file": {
    "_id": "65ff...",
    "workspaceId": "65aa...",
    "uploadedByUserId": "65bb...",
    "url": "/api/files/65ff.../download",
    "sizeBytes": 1024,
    "mimeType": "text/plain",
    "originalName": "readme.txt",
    "extension": ".txt",
    "checksum": "sha256...",
    "storageStatus": "ready",
    "isPrivate": true,
    "downloadCount": 0
  }
}
```

- Common errors:
  - `422` `errors.validation.failed` (`errors.file.empty | errors.file.tooLarge | errors.file.invalidMimeType | errors.file.invalidExtension`)
  - `403` `errors.auth.forbiddenTenant`
  - `429` `errors.file.rateLimited`
  - `502` `errors.file.uploadFailed`
  - `503` `errors.file.storageUnavailable`
- Notes:
  - Filename is sanitized before storing.
  - Object key pattern: `workspaces/{workspaceId}/files/{YYYY}/{MM}/{DD}/{uuid}-{sanitizedName}`.
  - Compensation cleanup is attempted when storage upload succeeds but DB persistence fails.

### GET `/api/files`

- Purpose: list workspace files with pagination, safe partial search, and filters.
- Requirements:
  - Authorization required
  - active user + active workspace membership
- Request query:
  - `page` optional (`>=1`, default `1`)
  - `limit` optional (`1..100`, default `20`)
  - `search` optional (safe escaped partial search over filename)
  - `mimeType` optional
  - `extension` optional
  - `uploadedByUserId` optional mongo id
  - `kind` optional
  - `isLinked` optional boolean
  - `entityType` optional string (uses `file_links` relation filter)
  - `entityId` optional mongo id (requires `entityType`)
  - `createdFrom` / `createdTo` optional ISO datetime
  - `sort` optional allowlist: `createdAt|-createdAt|sizeBytes|-sizeBytes|originalName|-originalName|downloadCount|-downloadCount|lastAccessedAt|-lastAccessedAt`
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "page": 1,
  "limit": 20,
  "total": 1,
  "results": 1,
  "files": [
    {
      "_id": "65ff...",
      "workspaceId": "65aa...",
      "uploadedByUserId": "65bb...",
      "url": "/api/files/65ff.../download",
      "sizeBytes": 1024,
      "mimeType": "text/plain",
      "originalName": "readme.txt",
      "extension": ".txt",
      "storageStatus": "ready",
      "isLinked": false
    }
  ]
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
- Notes:
  - Soft-deleted files are excluded by default.
  - Search input is escaped before regex construction to avoid regex injection.
  - `entityType` only filters to files linked to any entity of that type.
  - `entityType + entityId` filters to files linked to that exact entity record.
  - Sending `entityId` without `entityType` returns `422 errors.validation.failed` with field key `errors.validation.entityTypeRequiredWithEntityId` in `errors[]`.

### GET `/api/files/:fileId`

- Purpose: fetch one file metadata record (without raw storage location details).
- Requirements:
  - Authorization required
  - active user + active workspace membership
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "file": {
    "_id": "65ff...",
    "workspaceId": "65aa...",
    "uploadedByUserId": "65bb...",
    "url": "/api/files/65ff.../download",
    "sizeBytes": 1024,
    "mimeType": "text/plain",
    "originalName": "readme.txt",
    "extension": ".txt",
    "checksum": "sha256...",
    "storageStatus": "ready",
    "isLinked": false
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `404` `errors.file.notFound`
- Anti-enumeration note:
  - Cross-workspace file IDs resolve as `404 errors.file.notFound` to avoid tenant data leakage.

### GET `/api/files/:fileId/download`

- Purpose: stream file content from backend using a single stable API contract.
- Requirements:
  - Authorization required
  - active user + active workspace membership
- Success `200`:
  - Binary stream response.
  - Response headers include:
    - `Content-Type`
    - `Content-Length` (when available)
    - `Content-Disposition` with sanitized filename
- Common errors:
  - `422` `errors.validation.failed`
  - `404` `errors.file.notFound`
  - `429` `errors.file.rateLimited`
  - `502` `errors.file.downloadFailed`
  - `503` `errors.file.storageUnavailable`
- Anti-enumeration note:
  - Cross-workspace file IDs resolve as `404 errors.file.notFound`.
- Notes:
  - Bucket remains private and hidden from clients.
  - v1 streams bytes directly; future internal switch to short-lived signed URLs will preserve this public endpoint contract.

### DELETE `/api/files/:fileId`

- Purpose: explicitly remove physical object from storage, then soft-delete file record.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin`
- Success `200`:

```json
{
  "messageKey": "success.file.deleted",
  "message": "File deleted successfully.",
  "alreadyDeleted": false,
  "file": {
    "_id": "65ff...",
    "workspaceId": "65aa...",
    "storageStatus": "deleted"
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
  - `404` `errors.file.notFound`
  - `502` `errors.file.deleteFailed`
  - `503` `errors.file.storageUnavailable`
- Notes:
  - If object is already missing in storage, endpoint still soft-deletes the DB record.
  - Deleting a physical file is explicit; relation records are soft-deleted for consistency.

## 9) Customers Endpoints Reference (Organizations v1 + Contacts v1 + ContactIdentity v1)

### Auth model + authorization rules

- All customer organization/contact/contact-identity endpoints are protected and require Authorization header.
- All customer endpoints are session-context endpoints scoped to the token workspace (`wid` / `session.workspaceId`).
- Role rules:
  - `owner|admin|agent`: create, update, read
  - `viewer`: read-only
- Organizations and contacts are workspace-scoped customer records intended for contact selection, requester linkage, and ticket context.
- Organization domains are normalized to lowercase on write.
- Contact emails are normalized to lowercase on write and remain the primary future-safe matching anchor.
- ContactIdentity v1 currently exposes list/create only for `email`, `phone`, and `whatsapp` identity records linked to a parent contact.
- Ticket create/list/detail flows continue to resolve same-workspace customer records and expose only lightweight contact/organization summaries relevant to the ticket payload.
- Customers v1 does not include delete/archive, merge, import/export, or customer-auth/widget flows.

### GET `/api/customers/organizations`

- Purpose: list workspace organizations with pagination, safe partial search, optional exact-domain filter, and allowlisted sort.
- Requirements:
  - Authorization required
  - active user + active workspace membership
- Request query:
  - `page` optional (`>= 1`, default `1`)
  - `limit` optional (`1..100`, default `20`)
  - `q` or `search` optional (`1..120`), searches organization `name` and `domain`
  - `domain` optional exact domain filter (`1..253`, FQDN format)
  - `sort` optional: `name | -name | domain | -domain | createdAt | -createdAt | updatedAt | -updatedAt`
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "page": 1,
  "limit": 20,
  "total": 1,
  "results": 1,
  "organizations": [
    {
      "_id": "65f1...",
      "workspaceId": "65aa...",
      "name": "Acme Inc",
      "domain": "acme.example",
      "notes": "Priority enterprise customer.",
      "createdAt": "2026-03-20T12:00:00.000Z",
      "updatedAt": "2026-03-20T12:00:00.000Z"
    }
  ]
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked`
  - `403` `errors.auth.userSuspended | errors.auth.forbiddenTenant`
- Notes:
  - Search input is escaped before regex construction.
  - The list excludes soft-deleted organizations.
  - Domain filter is exact-match after normalization.
- Anti-enumeration note:
  - The endpoint is always scoped to the active workspace from the token.

### GET `/api/customers/organizations/options`

- Purpose: lightweight organization options endpoint for selectors/dropdowns.
- Requirements:
  - Authorization required
  - active user + active workspace membership
- Request query:
  - `q` or `search` optional (`1..120`)
  - `limit` optional (`1..50`, default `20`)
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "options": [
    {
      "_id": "65f1...",
      "name": "Acme Inc",
      "domain": "acme.example"
    }
  ]
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked`
  - `403` `errors.auth.userSuspended | errors.auth.forbiddenTenant`
- Notes:
  - Intended for fast UI selector/typeahead usage.
  - The payload is intentionally lightweight.

### GET `/api/customers/organizations/:id`

- Purpose: fetch one organization in the current workspace.
- Request params:
  - `id`: mongo id
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "organization": {
    "_id": "65f1...",
    "workspaceId": "65aa...",
    "name": "Acme Inc",
    "domain": "acme.example",
    "notes": "Priority enterprise customer.",
    "createdAt": "2026-03-20T12:00:00.000Z",
    "updatedAt": "2026-03-20T12:30:00.000Z"
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `404` `errors.organization.notFound`
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked`
  - `403` `errors.auth.userSuspended | errors.auth.forbiddenTenant`
- Anti-enumeration note:
  - Cross-workspace ids resolve as `404 errors.organization.notFound`.

### POST `/api/customers/organizations`

- Purpose: create a customer organization in the current workspace.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role is `owner|admin|agent`
- Request body:

```json
{
  "name": "Acme Inc",
  "domain": "acme.example",
  "notes": "Priority enterprise customer."
}
```

- Request rules:
  - `name` required, trimmed string (`1..180`)
  - `domain` optional nullable string (`1..253`) and must be a valid domain/FQDN when provided
  - `notes` optional nullable string (`1..5000`)
  - unknown body fields are rejected
- Success `200`:

```json
{
  "messageKey": "success.organization.created",
  "message": "Organization created successfully.",
  "organization": {
    "_id": "65f1...",
    "workspaceId": "65aa...",
    "name": "Acme Inc",
    "domain": "acme.example",
    "notes": "Priority enterprise customer.",
    "createdAt": "2026-03-20T12:00:00.000Z",
    "updatedAt": "2026-03-20T12:00:00.000Z"
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `404` `errors.workspace.notFound`
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked`
  - `403` `errors.auth.userSuspended | errors.auth.forbiddenTenant | errors.auth.forbiddenRole`
- Notes:
  - Response returns only the created organization resource; it does not expand contacts, tickets, or counts.

### PATCH `/api/customers/organizations/:id`

- Purpose: partially update editable organization fields in the current workspace.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role is `owner|admin|agent`
- Request params:
  - `id`: mongo id
- Request body:

```json
{
  "domain": "acme.io",
  "notes": "Updated sales notes."
}
```

- Request rules:
  - allowed fields: `name`, `domain`, `notes`
  - at least one allowed field is required
  - `domain` may be set to `null` to clear it
  - `notes` may be set to `null` to clear it
  - unknown body fields are rejected
- Success `200`:

```json
{
  "messageKey": "success.organization.updated",
  "message": "Organization updated successfully.",
  "organization": {
    "_id": "65f1...",
    "workspaceId": "65aa...",
    "name": "Acme Inc",
    "domain": "acme.io",
    "notes": "Updated sales notes.",
    "createdAt": "2026-03-20T12:00:00.000Z",
    "updatedAt": "2026-03-20T12:30:00.000Z"
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `404` `errors.organization.notFound | errors.workspace.notFound`
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked`
  - `403` `errors.auth.userSuspended | errors.auth.forbiddenTenant | errors.auth.forbiddenRole`
- Anti-enumeration note:
  - Cross-workspace ids resolve as `404 errors.organization.notFound`.
- Notes:
  - Response returns only the updated organization resource; it does not expand contacts, tickets, or counts.

### GET `/api/customers/contacts`

- Purpose: list workspace contacts with pagination, safe partial search, optional organization/email filters, and allowlisted sort.
- Requirements:
  - Authorization required
  - active user + active workspace membership
- Request query:
  - `page` optional (`>= 1`, default `1`)
  - `limit` optional (`1..100`, default `20`)
  - `q` or `search` optional (`1..120`), searches contact `fullName` and `email`
  - `organizationId` optional mongo id filter
  - `email` optional exact email filter
  - `sort` optional: `fullName | -fullName | email | -email | createdAt | -createdAt | updatedAt | -updatedAt`
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "page": 1,
  "limit": 20,
  "total": 1,
  "results": 1,
  "contacts": [
    {
      "_id": "65f2...",
      "workspaceId": "65aa...",
      "organizationId": "65f1...",
      "organization": {
        "_id": "65f1...",
        "name": "Acme Inc",
        "domain": "acme.example"
      },
      "fullName": "Jane Requester",
      "email": "jane.requester@example.com",
      "phone": "+963955555555",
      "tags": ["VIP"],
      "createdAt": "2026-03-20T12:10:00.000Z",
      "updatedAt": "2026-03-20T12:10:00.000Z"
    }
  ]
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked`
  - `403` `errors.auth.userSuspended | errors.auth.forbiddenTenant`
- Notes:
  - Search input is escaped before regex construction.
  - The list excludes soft-deleted contacts.
  - `email` filter is exact-match after normalization.
  - Response items stay intentionally lean and do not expand tickets, identities, or other linked collections.
- Anti-enumeration note:
  - The endpoint is always scoped to the active workspace from the token.

### GET `/api/customers/contacts/options`

- Purpose: lightweight contact options endpoint for selectors/dropdowns and requester lookups.
- Requirements:
  - Authorization required
  - active user + active workspace membership
- Request query:
  - `q` or `search` optional (`1..120`)
  - `organizationId` optional mongo id filter
  - `email` optional exact email filter
  - `limit` optional (`1..50`, default `20`)
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "options": [
    {
      "_id": "65f2...",
      "fullName": "Jane Requester",
      "email": "jane.requester@example.com",
      "phone": "+963955555555",
      "organizationId": "65f1...",
      "organization": {
        "_id": "65f1...",
        "name": "Acme Inc",
        "domain": "acme.example"
      }
    }
  ]
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked`
  - `403` `errors.auth.userSuspended | errors.auth.forbiddenTenant`
- Notes:
  - Intended for fast UI selector/typeahead usage.
  - The payload is intentionally lightweight and excludes `customFields`.

### GET `/api/customers/contacts/:id`

- Purpose: fetch one contact in the current workspace.
- Request params:
  - `id`: mongo id
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "contact": {
    "_id": "65f2...",
    "workspaceId": "65aa...",
    "organizationId": "65f1...",
    "organization": {
      "_id": "65f1...",
      "name": "Acme Inc",
      "domain": "acme.example"
    },
    "fullName": "Jane Requester",
    "email": "jane.requester@example.com",
    "phone": "+963955555555",
    "tags": ["VIP"],
    "customFields": {
      "source": "Manual"
    },
    "createdAt": "2026-03-20T12:10:00.000Z",
    "updatedAt": "2026-03-20T12:30:00.000Z"
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `404` `errors.contact.notFound`
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked`
  - `403` `errors.auth.userSuspended | errors.auth.forbiddenTenant`
- Notes:
  - Response returns only the contact resource plus an optional lightweight organization summary.
  - It does not expand identities, tickets, or organization member lists.
- Anti-enumeration note:
  - Cross-workspace ids resolve as `404 errors.contact.notFound`.

### POST `/api/customers/contacts`

- Purpose: create a workspace-scoped customer contact.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role is `owner|admin|agent`
- Request body:

```json
{
  "fullName": "Jane Requester",
  "organizationId": "65f1...",
  "email": "jane.requester@example.com",
  "phone": "+963955555555",
  "tags": ["VIP"],
  "customFields": {
    "source": "Manual"
  }
}
```

- Request rules:
  - `fullName` required, trimmed string (`1..180`)
  - `organizationId` optional nullable mongo id and must reference a same-workspace non-deleted organization when provided
  - `email` optional nullable email (`max 320`), normalized to lowercase
  - `phone` optional nullable plausible phone number (`max 40` input chars), normalized to E.164-style storage when provided
  - `tags` optional nullable array (`max 20`) of unique trimmed strings (`1..50`)
  - `customFields` optional nullable flat object (`max 20` keys); values are limited to string/number/boolean/null
  - unknown body fields are rejected
- Success `200`:

```json
{
  "messageKey": "success.contact.created",
  "message": "Contact created successfully.",
  "contact": {
    "_id": "65f2...",
    "workspaceId": "65aa...",
    "organizationId": "65f1...",
    "organization": {
      "_id": "65f1...",
      "name": "Acme Inc",
      "domain": "acme.example"
    },
    "fullName": "Jane Requester",
    "email": "jane.requester@example.com",
    "phone": "+963955555555",
    "tags": ["VIP"],
    "customFields": {
      "source": "Manual"
    },
    "createdAt": "2026-03-20T12:10:00.000Z",
    "updatedAt": "2026-03-20T12:10:00.000Z"
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `404` `errors.organization.notFound | errors.workspace.notFound`
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked`
  - `403` `errors.auth.userSuspended | errors.auth.forbiddenTenant | errors.auth.forbiddenRole`
- Notes:
  - A contact may be created without `email` or `phone` for manual workflows.
  - Stored contact phone values are normalized to a stable international format when accepted.
  - Response returns only the created contact resource plus an optional lightweight organization summary.

### PATCH `/api/customers/contacts/:id`

- Purpose: partially update editable contact fields in the current workspace.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role is `owner|admin|agent`
- Request params:
  - `id`: mongo id
- Request body:

```json
{
  "organizationId": "65f1...",
  "email": "jane.requester@example.com",
  "tags": ["VIP", "Escalated"],
  "customFields": {
    "source": "Manual"
  }
}
```

- Request rules:
  - allowed fields: `fullName`, `organizationId`, `email`, `phone`, `tags`, `customFields`
  - at least one allowed field is required
  - `organizationId`, `email`, `phone`, `tags`, and `customFields` may be set to `null` to clear their stored value
  - `organizationId` must reference a same-workspace non-deleted organization when provided as a value
  - non-null `phone` values must be plausible phone numbers and are normalized to stable international storage
  - unknown body fields are rejected
- Success `200`:

```json
{
  "messageKey": "success.contact.updated",
  "message": "Contact updated successfully.",
  "contact": {
    "_id": "65f2...",
    "workspaceId": "65aa...",
    "organizationId": "65f1...",
    "organization": {
      "_id": "65f1...",
      "name": "Acme Inc",
      "domain": "acme.example"
    },
    "fullName": "Jane Requester",
    "email": "jane.requester@example.com",
    "phone": null,
    "tags": ["VIP", "Escalated"],
    "customFields": {
      "source": "Manual"
    },
    "createdAt": "2026-03-20T12:10:00.000Z",
    "updatedAt": "2026-03-20T12:30:00.000Z"
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `404` `errors.contact.notFound | errors.organization.notFound | errors.workspace.notFound`
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked`
  - `403` `errors.auth.userSuspended | errors.auth.forbiddenTenant | errors.auth.forbiddenRole`
- Notes:
  - Response returns only the updated contact resource plus an optional lightweight organization summary.
  - The endpoint does not expand tickets, identities, or any linked collections.
- Anti-enumeration note:
  - Cross-workspace ids resolve as `404 errors.contact.notFound`.

### GET `/api/customers/contacts/:id/identities`

- Purpose: list the lightweight identity records linked to one contact in the current workspace.
- Requirements:
  - Authorization required
  - active user + active workspace membership
- Request params:
  - `id`: mongo id of the parent contact
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "identities": [
    {
      "_id": "6601...",
      "workspaceId": "65aa...",
      "contactId": "65f2...",
      "type": "email",
      "value": "requester@example.com",
      "verifiedAt": null,
      "createdAt": "2026-03-20T12:40:00.000Z",
      "updatedAt": "2026-03-20T12:40:00.000Z"
    }
  ]
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `404` `errors.contact.notFound`
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked`
  - `403` `errors.auth.userSuspended | errors.auth.forbiddenTenant`
- Notes:
  - The parent contact must belong to the active workspace and must not be deleted.
  - The response returns identity rows only; it does not expand the contact, organization, tickets, or any other linked data.
  - `valueNormalized` is intentionally not exposed.
- Anti-enumeration note:
  - Cross-workspace parent contact ids resolve as `404 errors.contact.notFound`.

### POST `/api/customers/contacts/:id/identities`

- Purpose: add one lightweight identity record to an existing contact in the current workspace.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role is `owner|admin|agent`
- Request params:
  - `id`: mongo id of the parent contact
- Request body:

```json
{
  "type": "email",
  "value": "requester@example.com"
}
```

- Request rules:
  - allowed fields: `type`, `value`
  - `type` required enum: `email | phone | whatsapp`
  - `value` required trimmed string
  - `email` identities require a valid email format (`max 320`) and are stored/returned as lowercase-trimmed values
  - `phone` and `whatsapp` identities require a plausible phone number (`max 40` input chars) and are normalized to stable international storage
  - parent contact must reference a same-workspace non-deleted contact
  - duplicate active identities in the workspace are rejected with a business conflict response
  - unknown body fields are rejected
- Success `200`:

```json
{
  "messageKey": "success.contactIdentity.created",
  "message": "Contact identity created successfully.",
  "identity": {
    "_id": "6601...",
    "workspaceId": "65aa...",
    "contactId": "65f2...",
    "type": "email",
    "value": "requester@example.com",
    "verifiedAt": null,
    "createdAt": "2026-03-20T12:40:00.000Z",
    "updatedAt": "2026-03-20T12:40:00.000Z"
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `404` `errors.contact.notFound`
  - `409` `errors.contactIdentity.alreadyExists`
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked`
  - `403` `errors.auth.userSuspended | errors.auth.forbiddenTenant | errors.auth.forbiddenRole`
- Notes:
  - `verifiedAt` remains `null` in normal v1 flows because verification lifecycle endpoints are intentionally out of scope.
  - Identity uniqueness is enforced on normalized workspace-scoped values, so email case and phone formatting variants conflict cleanly instead of creating duplicates.
  - `email` identity values are persisted and returned in normalized lowercase form; `phone` and `whatsapp` values are persisted and returned in normalized international form.
  - The response returns only the created identity record and does not expose `valueNormalized`.
  - ContactIdentity v1 does not include update/delete/archive endpoints.
- Anti-enumeration note:
  - Cross-workspace parent contact ids resolve as `404 errors.contact.notFound`.

## 10) Mailboxes Endpoints Reference (Mailbox v1)

### Auth model + authorization rules

- All mailbox endpoints are protected and require Authorization header.
- All mailbox endpoints are session-context endpoints scoped to token workspace (`wid` / `session.workspaceId`).
- Role rules:
  - `owner|admin`: create, update, set-default, activate, deactivate, read.
  - `agent|viewer`: read-only (`GET /api/mailboxes`, `GET /api/mailboxes/options`, `GET /api/mailboxes/:id`).
- Mailbox v1 is queue abstraction only (not inbound channel/provider abstraction).
- Mailbox `type` is currently constrained to `email` in v1; channel/source behavior is intentionally out of scope.
- Mailbox v1 does not include delete endpoint.

### Mailbox invariants in v1

- Multiple mailboxes per workspace are supported.
- Exactly one default mailbox per workspace is enforced.
- `workspace.defaultMailboxId` is kept aligned with the mailbox marked `isDefault`.
- A default mailbox is always active.
- Default mailbox cannot be deactivated.
- Last active mailbox cannot be deactivated.

### GET `/api/mailboxes`

- Purpose: list workspace mailboxes with pagination, safe partial search, filters, and sort.
- Requirements:
  - Authorization required
  - active user + active workspace membership
- Request query:
  - `page` optional (`>=1`, default `1`)
  - `limit` optional (`1..100`, default `20`)
  - `q` optional (partial search)
  - `search` optional alias for `q`
  - `isActive` optional boolean
  - `isDefault` optional boolean
  - `includeInactive` optional boolean
  - `sort` optional allowlist: `name|-name|createdAt|-createdAt|updatedAt|-updatedAt`
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "page": 1,
  "limit": 20,
  "total": 2,
  "results": 2,
  "mailboxes": [
    {
      "_id": "65f1...",
      "workspaceId": "65aa...",
      "name": "Support",
      "type": "email",
      "emailAddress": null,
      "fromName": null,
      "replyTo": null,
      "signatureText": null,
      "signatureHtml": null,
      "slaPolicyId": null,
      "isDefault": true,
      "isActive": true
    }
  ]
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant` (for unauthorized inactive visibility requests)
- Notes:
  - Active mailboxes are returned by default.
  - `owner|admin` can request inactive records via `includeInactive=true` or `isActive=false`.
  - `agent|viewer` cannot request inactive mailbox data.
  - Search input is escaped before regex construction.

### GET `/api/mailboxes/options`

- Purpose: lightweight mailbox options endpoint for selectors/dropdowns.
- Requirements:
  - Authorization required
  - active user + active workspace membership
- Request query:
  - `q` optional
  - `search` optional alias for `q`
  - `limit` optional (`1..50`, default `20`)
  - `isActive` optional boolean
  - `includeInactive` optional boolean
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "options": [
    {
      "_id": "65f1...",
      "name": "Support",
      "isDefault": true
    }
  ]
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
- Notes:
  - Active-only by default.
  - Intended for fast UI typeahead/dropdown usage.

### GET `/api/mailboxes/:id`

- Purpose: fetch one mailbox in current workspace.
- Requirements:
  - Authorization required
  - active user + active workspace membership
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "mailbox": {
    "_id": "65f1...",
    "workspaceId": "65aa...",
    "name": "Support",
    "type": "email",
    "slaPolicyId": null,
    "isDefault": true,
    "isActive": true
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `404` `errors.mailbox.notFound`
- Anti-enumeration note:
  - Cross-workspace mailbox IDs resolve as `404 errors.mailbox.notFound`.
  - Inactive mailboxes are hidden from `agent|viewer` and resolve as `404`.

### POST `/api/mailboxes`

- Purpose: create a mailbox queue in the current workspace.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin`
- Request body:
  - `type` is optional and only `email` is accepted in v1.

```json
{
  "name": "Billing Queue",
  "type": "email",
  "emailAddress": "billing@example.com",
  "fromName": "Billing Team",
  "replyTo": "billing@example.com",
  "signatureText": "Thanks",
  "signatureHtml": "<p>Thanks</p>",
  "slaPolicyId": "65f4..."
}
```

- `slaPolicyId`: optional, nullable same-workspace active SLA policy id

- Success `200`:

```json
{
  "messageKey": "success.mailbox.created",
  "message": "Mailbox created successfully.",
  "mailbox": {
    "_id": "65f2...",
    "workspaceId": "65aa...",
    "name": "Billing Queue",
    "type": "email",
    "slaPolicyId": "65f4...",
    "isDefault": false,
    "isActive": true
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
  - `409` `errors.mailbox.emailAlreadyUsed`
  - `404` `errors.sla.policyNotFound`
  - `409` `errors.sla.policyInactive`
- Notes:
  - Creation does not auto-delete or replace existing mailboxes.
  - Exactly-one-default invariant remains enforced.
  - Omitting `slaPolicyId` keeps old mailbox flows backward compatible.
  - If `slaPolicyId` is provided, it must reference an active policy in the same workspace.

### PATCH `/api/mailboxes/:id`

- Purpose: update mailbox metadata (not activate/deactivate, not set-default).
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin`
- Request body:
  - At least one of:
  - `name`
  - `type`
  - `emailAddress`
  - `fromName`
  - `replyTo`
  - `signatureText`
  - `signatureHtml`
  - `slaPolicyId`
  - If `type` is sent, it must be `email`.
  - `slaPolicyId` may be sent as a same-workspace active policy id, or `null` to clear the mailbox override.
  - Unknown body fields are rejected with `422 errors.validation.failed` and field key `errors.validation.unknownField`.
  - Sending none of the allowed fields returns field key `errors.validation.bodyRequiresAtLeastOneField`.
- Success `200`:

```json
{
  "messageKey": "success.mailbox.updated",
  "message": "Mailbox updated successfully.",
  "mailbox": {
    "_id": "65f2...",
    "workspaceId": "65aa...",
    "name": "Billing Queue",
    "type": "email",
    "slaPolicyId": null,
    "isDefault": false,
    "isActive": true
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
  - `404` `errors.mailbox.notFound`
  - `404` `errors.sla.policyNotFound`
  - `409` `errors.mailbox.emailAlreadyUsed`
  - `409` `errors.sla.policyInactive`
- Notes:
  - Activation/deactivation has dedicated endpoints.
  - Default switching has dedicated endpoint.

### POST `/api/mailboxes/:id/set-default`

- Purpose: make mailbox default and synchronize `workspace.defaultMailboxId`.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin`
- Success `200`:

```json
{
  "messageKey": "success.mailbox.defaultSet",
  "message": "Default mailbox updated successfully.",
  "mailbox": {
    "_id": "65f2...",
    "isDefault": true,
    "isActive": true
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
  - `404` `errors.mailbox.notFound`
  - `409` `errors.mailbox.defaultMustBeActive | errors.mailbox.defaultConflict`
- Notes:
  - Previous default mailbox is unset automatically.
  - Workspace default pointer is updated in the same operation.
  - Mailbox action endpoints return compact action payloads, not the full mailbox detail view.

### POST `/api/mailboxes/:id/activate`

- Purpose: activate mailbox.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin`
- Success `200`:

```json
{
  "messageKey": "success.mailbox.activated",
  "message": "Mailbox activated successfully.",
  "mailbox": {
    "_id": "65f2...",
    "workspaceId": "65aa...",
    "isActive": true
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
  - `404` `errors.mailbox.notFound`
- Notes:
  - Mailbox action endpoints return compact action payloads, not the full mailbox detail view.

### POST `/api/mailboxes/:id/deactivate`

- Purpose: deactivate mailbox operationally without deleting history references.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin`
- Success `200`:

```json
{
  "messageKey": "success.mailbox.deactivated",
  "message": "Mailbox deactivated successfully.",
  "mailbox": {
    "_id": "65f2...",
    "workspaceId": "65aa...",
    "isActive": false
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
  - `404` `errors.mailbox.notFound`
  - `409` `errors.mailbox.defaultCannotDeactivate | errors.mailbox.lastActiveCannotDeactivate`
- Notes:
  - Default mailbox cannot be deactivated.
  - Last active mailbox cannot be deactivated.
  - Ticket/conversation/message mailbox references are preserved.
  - Mailbox action endpoints return compact action payloads, not the full mailbox detail view.

## 11) Mailbox Backfill Command

- Purpose: idempotently repair workspaces with missing/invalid mailbox defaults.
- Command:

```bash
npm run mailboxes:backfill-default
```

- What it does:
  - scans non-deleted workspaces
  - ensures exactly one default mailbox exists per workspace
  - ensures default mailbox is active
  - updates `workspace.defaultMailboxId` to the canonical default mailbox
  - creates a default `Support` mailbox only when workspace has no mailboxes
- Rerun safety:
  - safe to run multiple times (idempotent)
  - does not create duplicate default mailboxes when rerun

## 12) SLA Endpoints Reference (SLA v1 Active Surface)

### Auth model & authorization model

- All SLA endpoints are protected and require Authorization header.
- All SLA endpoints are session-context endpoints scoped to the token workspace (`wid` / `session.workspaceId`).
- Role rules:
  - `owner|admin`: create/update business hours, create/update/activate/deactivate/set-default policies, read all SLA endpoints.
  - `agent|viewer`: read-only (`GET /api/sla/summary`, business-hours reads, policy reads/options/lists subject to inactive-visibility rules).
- Inactive policy visibility:
  - `owner|admin` can request inactive policies through `includeInactive=true` or `isActive=false`.
  - `agent|viewer` can read active policies only.
  - inactive policy detail resolves as `404 errors.sla.policyNotFound` for `agent|viewer`.

### SLA batch scope and current limits

- Active SLA models in v1:
  - Business hours
  - SLA policies
  - Workspace default SLA pointer
  - Mailbox optional SLA override
  - Ticket-level SLA snapshot on create
  - Message/lifecycle runtime behavior for first response and resolution
  - Derived SLA response shaping on ticket list/detail and action responses
  - Summary endpoint with runtime-derived workspace totals
- Ticket selection precedence is:
  - mailbox `slaPolicyId`
  - workspace `defaultSlaPolicyId`
  - otherwise no SLA
- Active runtime rules:
  - first response SLA is satisfied only by the first `public_reply`
  - resolution SLA is satisfied by `solved`, not `closed`
  - `waiting_on_customer` pauses resolution; `pending` remains active
  - reopening resumes remaining business time instead of resetting a fresh target
  - list/detail/summary derive overdue and breached state in memory without hidden writes
- Still intentionally postponed:
  - next-response SLA behavior
  - reminders, escalations, notifications, or jobs
  - holiday runtime logic
  - historical reporting/date-range analytics

### GET `/api/sla/summary`

- Purpose: return lightweight current-state SLA totals for the active workspace.
- Requirements:
  - Authorization required
  - active user + active workspace membership
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "summary": {
    "businessHours": {
      "total": 2
    },
    "policies": {
      "total": 3,
      "active": 2,
      "inactive": 1,
      "defaultPolicyId": "65f4...",
      "defaultPolicyName": "Standard Support",
      "defaultPolicyIsActive": true
    },
    "mailboxes": {
      "total": 2,
      "withOverrideCount": 1,
      "withoutOverrideCount": 1
    },
    "runtime": {
      "ticketLifecycleIntegrated": true,
      "firstResponseEnabled": true,
      "resolutionEnabled": true,
      "applicableTicketCount": 4,
      "breachedTicketCount": 1,
      "firstResponse": {
        "not_applicable": 1,
        "pending": 1,
        "met": 1,
        "breached": 1
      },
      "resolution": {
        "not_applicable": 1,
        "running": 1,
        "paused": 1,
        "met": 0,
        "breached": 1
      }
    }
  }
}
```

- Common errors:
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked`
  - `403` `errors.auth.userSuspended | errors.auth.forbiddenTenant | errors.auth.forbiddenRole`

### Business Hours rules

- Business hours are stored separately from SLA policies.
- `timezone` must be a valid IANA timezone.
- `weeklySchedule` uses weekdays `0..6` and explicit open windows in `HH:mm` 24-hour format.
- Closed days are stored/read as `isOpen: false` with empty `windows`.
- Holidays remain model-level placeholders and are not part of the active v1 API surface.

### GET `/api/sla/business-hours`

- Purpose: list business-hours records in the current workspace.
- Requirements:
  - Authorization required
  - active user + active workspace membership
- Request query:
  - `page` optional (`>=1`, default `1`)
  - `limit` optional (`1..100`, default `20`)
  - `q` optional (partial search)
  - `search` optional alias for `q`
  - `sort` optional allowlist: `name|-name|createdAt|-createdAt|updatedAt|-updatedAt`
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "page": 1,
  "limit": 20,
  "total": 1,
  "results": 1,
  "businessHours": [
    {
      "_id": "65f3...",
      "workspaceId": "65aa...",
      "name": "Riyadh Weekdays",
      "timezone": "Asia/Riyadh",
      "weeklySchedule": [
        { "dayOfWeek": 0, "isOpen": false, "windows": [] },
        {
          "dayOfWeek": 1,
          "isOpen": true,
          "windows": [{ "start": "09:00", "end": "17:00" }]
        }
      ],
      "createdAt": "2026-03-22T10:00:00.000Z",
      "updatedAt": "2026-03-22T10:00:00.000Z"
    }
  ]
}
```

- Common errors:
  - `422` `errors.validation.failed`

### GET `/api/sla/business-hours/options`

- Purpose: return lightweight business-hours options for selectors.
- Requirements:
  - Authorization required
  - active user + active workspace membership
- Request query:
  - `q` optional
  - `search` optional alias for `q`
  - `limit` optional (`1..50`, default `20`)
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "options": [
    {
      "_id": "65f3...",
      "name": "Riyadh Weekdays",
      "timezone": "Asia/Riyadh"
    }
  ]
}
```

- Common errors:
  - `422` `errors.validation.failed`

### GET `/api/sla/business-hours/:id`

- Purpose: fetch one business-hours record in the current workspace.
- Requirements:
  - Authorization required
  - active user + active workspace membership
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "businessHours": {
    "_id": "65f3...",
    "workspaceId": "65aa...",
    "name": "Riyadh Weekdays",
    "timezone": "Asia/Riyadh",
    "weeklySchedule": [
      { "dayOfWeek": 0, "isOpen": false, "windows": [] },
      {
        "dayOfWeek": 1,
        "isOpen": true,
        "windows": [{ "start": "09:00", "end": "17:00" }]
      }
    ],
    "createdAt": "2026-03-22T10:00:00.000Z",
    "updatedAt": "2026-03-22T10:00:00.000Z"
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `404` `errors.sla.businessHoursNotFound`
- Anti-enumeration note:
  - Cross-workspace business-hours ids resolve as `404 errors.sla.businessHoursNotFound`.

### POST `/api/sla/business-hours`

- Purpose: create a business-hours record in the current workspace.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin`
- Request body:

```json
{
  "name": "Riyadh Weekdays",
  "timezone": "Asia/Riyadh",
  "weeklySchedule": [
    {
      "dayOfWeek": 1,
      "isOpen": true,
      "windows": [{ "start": "09:00", "end": "17:00" }]
    },
    {
      "dayOfWeek": 2,
      "isOpen": true,
      "windows": [{ "start": "09:00", "end": "17:00" }]
    }
  ]
}
```

- Success `200`:

```json
{
  "messageKey": "success.sla.businessHours.created",
  "message": "Business hours created successfully.",
  "businessHours": {
    "_id": "65f3...",
    "workspaceId": "65aa...",
    "name": "Riyadh Weekdays",
    "timezone": "Asia/Riyadh",
    "weeklySchedule": [
      { "dayOfWeek": 0, "isOpen": false, "windows": [] },
      {
        "dayOfWeek": 1,
        "isOpen": true,
        "windows": [{ "start": "09:00", "end": "17:00" }]
      }
    ]
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
- Notes:
  - `weeklySchedule` is normalized to a full seven-day shape in responses.
  - Validation rejects duplicate days, invalid times, overlapping windows, and open days with empty windows.

### PATCH `/api/sla/business-hours/:id`

- Purpose: update business-hours metadata or schedule.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin`
- Request body:
  - At least one of:
    - `name`
    - `timezone`
    - `weeklySchedule`
  - Unknown body fields are rejected with `422 errors.validation.failed` and field key `errors.validation.unknownField`.
  - Sending none of the allowed fields returns field key `errors.validation.bodyRequiresAtLeastOneField`.
- Success `200`:

```json
{
  "messageKey": "success.sla.businessHours.updated",
  "message": "Business hours updated successfully.",
  "businessHours": {
    "_id": "65f3...",
    "workspaceId": "65aa...",
    "name": "Riyadh Weekdays",
    "timezone": "Asia/Riyadh"
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
  - `404` `errors.sla.businessHoursNotFound`

### Policy rules

- Policies are stored separately from business hours and reference them via `businessHoursId`.
- Active v1 rule fields are:
  - `firstResponseMinutes`
  - `resolutionMinutes`
- Priority keys match ticket priorities:
  - `low`
  - `normal`
  - `high`
  - `urgent`
- `nextResponseMinutes` remains reserved internally and is not accepted by the active v1 API validators.

### GET `/api/sla/policies`

- Purpose: list SLA policies in the current workspace.
- Requirements:
  - Authorization required
  - active user + active workspace membership
- Request query:
  - `page` optional (`>=1`, default `1`)
  - `limit` optional (`1..100`, default `20`)
  - `q` optional (partial search)
  - `search` optional alias for `q`
  - `isActive` optional boolean
  - `includeInactive` optional boolean
  - `sort` optional allowlist: `name|-name|createdAt|-createdAt|updatedAt|-updatedAt`
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "page": 1,
  "limit": 20,
  "total": 1,
  "results": 1,
  "policies": [
    {
      "_id": "65f4...",
      "workspaceId": "65aa...",
      "name": "Standard Support",
      "isActive": true,
      "isDefault": true,
      "businessHoursId": "65f3...",
      "businessHours": {
        "_id": "65f3...",
        "name": "Riyadh Weekdays",
        "timezone": "Asia/Riyadh"
      },
      "rulesByPriority": {
        "low": { "firstResponseMinutes": 240, "resolutionMinutes": 1440 },
        "normal": { "firstResponseMinutes": 120, "resolutionMinutes": 720 },
        "high": { "firstResponseMinutes": 60, "resolutionMinutes": 240 },
        "urgent": { "firstResponseMinutes": 15, "resolutionMinutes": 60 }
      },
      "createdAt": "2026-03-22T10:00:00.000Z",
      "updatedAt": "2026-03-22T10:00:00.000Z"
    }
  ]
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
- Notes:
  - Active policies are returned by default.
  - `owner|admin` can include inactive policies explicitly.
  - `agent|viewer` cannot request inactive policy data.

### GET `/api/sla/policies/options`

- Purpose: return lightweight policy options for selectors.
- Requirements:
  - Authorization required
  - active user + active workspace membership
- Request query:
  - `q` optional
  - `search` optional alias for `q`
  - `limit` optional (`1..50`, default `20`)
  - `isActive` optional boolean
  - `includeInactive` optional boolean
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "options": [
    {
      "_id": "65f4...",
      "name": "Standard Support",
      "isActive": true,
      "isDefault": true
    }
  ]
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`

### GET `/api/sla/policies/:id`

- Purpose: fetch one SLA policy in the current workspace.
- Requirements:
  - Authorization required
  - active user + active workspace membership
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "policy": {
    "_id": "65f4...",
    "workspaceId": "65aa...",
    "name": "Standard Support",
    "isActive": true,
    "isDefault": true,
    "businessHoursId": "65f3...",
    "businessHours": {
      "_id": "65f3...",
      "name": "Riyadh Weekdays",
      "timezone": "Asia/Riyadh"
    },
    "rulesByPriority": {
      "low": { "firstResponseMinutes": 240, "resolutionMinutes": 1440 },
      "normal": { "firstResponseMinutes": 120, "resolutionMinutes": 720 },
      "high": { "firstResponseMinutes": 60, "resolutionMinutes": 240 },
      "urgent": { "firstResponseMinutes": 15, "resolutionMinutes": 60 }
    }
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `404` `errors.sla.policyNotFound`
- Anti-enumeration note:
  - Cross-workspace policy ids resolve as `404 errors.sla.policyNotFound`.
  - Inactive policy detail is hidden from `agent|viewer` and resolves as `404`.

### POST `/api/sla/policies`

- Purpose: create an SLA policy in the current workspace.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin`
- Request body:

```json
{
  "name": "Standard Support",
  "businessHoursId": "65f3...",
  "rulesByPriority": {
    "low": {
      "firstResponseMinutes": 240,
      "resolutionMinutes": 1440
    },
    "normal": {
      "firstResponseMinutes": 120,
      "resolutionMinutes": 720
    },
    "high": {
      "firstResponseMinutes": 60,
      "resolutionMinutes": 240
    },
    "urgent": {
      "firstResponseMinutes": 15,
      "resolutionMinutes": 60
    }
  }
}
```

- Success `200`:

```json
{
  "messageKey": "success.sla.policy.created",
  "message": "SLA policy created successfully.",
  "policy": {
    "_id": "65f4...",
    "workspaceId": "65aa...",
    "name": "Standard Support",
    "isActive": true,
    "isDefault": false,
    "businessHoursId": "65f3..."
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
  - `404` `errors.sla.businessHoursNotFound`
- Notes:
  - Every priority (`low|normal|high|urgent`) must contain at least one active rule field in the final stored policy.
  - Unknown rule fields, including `nextResponseMinutes`, are rejected in the active API surface.

### PATCH `/api/sla/policies/:id`

- Purpose: update SLA policy metadata, referenced business hours, or rules.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin`
- Request body:
  - At least one of:
    - `name`
    - `businessHoursId`
    - `rulesByPriority`
  - `businessHoursId` may be changed to another same-workspace business-hours id.
  - `rulesByPriority` is merged by priority with the current stored rules; unspecified priorities remain unchanged in the request payload.
  - The merged final policy must still define at least one active rule field for every priority (`low|normal|high|urgent`).
  - Unknown body fields are rejected with `422 errors.validation.failed` and field key `errors.validation.unknownField`.
- Success `200`:

```json
{
  "messageKey": "success.sla.policy.updated",
  "message": "SLA policy updated successfully.",
  "policy": {
    "_id": "65f4...",
    "workspaceId": "65aa...",
    "name": "Standard Support",
    "isActive": true,
    "isDefault": false
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
  - `404` `errors.sla.policyNotFound | errors.sla.businessHoursNotFound`

### POST `/api/sla/policies/:id/activate`

- Purpose: activate an SLA policy.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin`
- Success `200`:

```json
{
  "messageKey": "success.sla.policy.activated",
  "message": "SLA policy activated successfully.",
  "policy": {
    "_id": "65f4...",
    "name": "Default Support SLA",
    "isActive": true
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
  - `404` `errors.sla.policyNotFound`
- Notes:
  - SLA policy action endpoints return compact action payloads, not the full policy detail view.

### POST `/api/sla/policies/:id/deactivate`

- Purpose: deactivate an SLA policy, clear mailbox overrides that point to it, and optionally replace the workspace default when the target policy was currently default.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin`
- Request body:

```json
{
  "replacementPolicyId": "65f5..."
}
```

- Request schema:
  - `replacementPolicyId`: optional, nullable same-workspace active SLA policy id
  - if provided, it cannot equal the `:id` policy being deactivated
- Success `200`:

```json
{
  "messageKey": "success.sla.policy.deactivated",
  "message": "SLA policy deactivated successfully.",
  "policy": {
    "_id": "65f4...",
    "name": "Default Support SLA",
    "isActive": false,
    "isDefault": false
  },
  "deactivationImpact": {
    "clearedWorkspaceDefault": false,
    "clearedMailboxOverridesCount": 3,
    "replacementPolicyId": "65f5...",
    "replacementPolicyName": "Fallback Support SLA",
    "requiresDefaultReplacement": false
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
  - `404` `errors.sla.policyNotFound`
  - `409` `errors.sla.policyInactive`
- Notes:
  - Deactivation clears all `mailbox.slaPolicyId` values that point to the deactivated policy.
  - If `replacementPolicyId` is provided and the deactivated policy was the current workspace default, the backend swaps `workspace.defaultSlaPolicyId` to the replacement inside the same action.
  - The same replacement path also repairs a stale workspace default pointer if it still points at an already-inactive target policy.
  - If no replacement is provided and the deactivated policy was default, the workspace default is cleared and `deactivationImpact.requiresDefaultReplacement` returns `true`.
  - If the deactivated policy was not the current workspace default, `replacementPolicyId` is ignored for workspace-default assignment.
  - When a replacement is applied, `deactivationImpact.replacementPolicyName` returns the replacement policy display name beside its id.
  - `workspace.defaultSlaPolicyId` is the canonical default source; policy `isDefault` flags are synchronized to that pointer during default-changing actions.
  - SLA policy action endpoints return compact action payloads, not the full policy detail view.

### POST `/api/sla/policies/:id/set-default`

- Purpose: set the workspace default SLA policy.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin`
- Success `200`:

```json
{
  "messageKey": "success.sla.policy.defaultSet",
  "message": "Default SLA policy updated successfully.",
  "policy": {
    "_id": "65f4...",
    "name": "Default Support SLA",
    "isActive": true,
    "isDefault": true
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
  - `404` `errors.sla.policyNotFound`
  - `409` `errors.sla.policyInactive`
- Notes:
  - SLA policy action endpoints return compact action payloads, not the full policy detail view.
  - Default assignment always points to an active policy.
  - `workspace.defaultSlaPolicyId` is canonical, and the denormalized policy `isDefault` flags are repaired to match it in the same operation.

## 13) Tickets Endpoints Reference

### Auth model + authorization rules

- All ticket endpoints are protected and require Authorization header.
- All ticket endpoints are session-context endpoints scoped to the token workspace (`wid` / `session.workspaceId`).
- Read roles:
  - `owner|admin|agent|viewer`
- Ticket write roles:
  - `owner|admin|agent`
- Dictionary mutation roles:
  - `owner|admin`
- Inactive dictionary visibility:
  - `owner|admin` can request inactive rows explicitly.
  - `agent|viewer` can read active rows only.
  - inactive direct detail rows are hidden from `agent|viewer` and resolve as `404`.

### Ticket record rules

- Every ticket belongs to the active workspace and receives a workspace-scoped incremental `number`.
- One conversation is created automatically for every ticket and linked back through `conversationId`.
- `contactId` is required on create.
- `organizationId` is derived from the linked contact when the contact already belongs to an organization.
- If `organizationId` is sent explicitly for a contact that already has an organization, the values must match.
- `mailboxId` is optional on create and falls back to the workspace default mailbox.
- Mailbox changes are only allowed while the ticket has `messageCount = 0`.
- Category/tag refs used in writes must be active and belong to the current workspace.
- Ticket detail can still render already-linked inactive category/tag refs for historical integrity.
- Create-time `initialMessage` accepts only `customer_message` and `internal_note`.
- Create-time and later message attachments must be uploaded through `/api/files` first, then linked by `attachmentFileIds`.
- Ticket message attachments are linked to the message as the semantic owner and to the root ticket for reverse lookup.
- Ticket list excludes `closed` tickets by default unless `includeClosed=true` is requested or an explicit `status` filter is supplied.
- `assigneeId` lives on the ticket itself; assignment actions update `assignedAt` and move `new` tickets to `open`.
- `PATCH /api/tickets/:id` returns the full hydrated ticket detail shape after applying a partial edit.
- Assignment and lifecycle action endpoints return action-scoped ticket summaries instead of the full hydrated ticket detail payload.
- Ticket participants are internal-only metadata (`watcher|collaborator`) and do not grant or revoke access.
- `owner|admin` can assign any operational member (`owner|admin|agent`).
- `agent` self-assignment uses `POST /api/tickets/:id/self-assign` only and is limited to unassigned tickets or tickets they already own.
- Manual message writes populate `from/to` parties from the linked contact and mailbox for `customer_message` and `public_reply`.
- `customer_message` moves the ticket to `open`; `public_reply` moves it to `waiting_on_customer`; `internal_note` leaves status unchanged.
- Closed tickets accept `internal_note` only until they are reopened explicitly.
- Explicit lifecycle actions control `solved`, `closed`, and `reopen` transitions and keep `statusChangedAt`, `closedAt`, and live resolution markers consistent.
- Ticket creation snapshots the effective SLA from `mailbox.slaPolicyId -> workspace.defaultSlaPolicyId -> no SLA`; the request body does not carry SLA fields.
- Ticket detail/list/action responses expose derived SLA statuses from stored raw fields:
  - first response: `not_applicable | pending | met | breached`
  - resolution: `not_applicable | running | paused | met | breached`
- `public_reply` satisfies first response SLA only once and pauses resolution through `waiting_on_customer`.
- `customer_message` resumes paused resolution and reopens solved tickets without resetting first-response history.
- `solved` is the resolution SLA success point; `closed` is downstream/admin state only.
- Reopen resumes remaining resolution business time; no cycle-history model or read-time hidden writes are used in v1.

### Ticket dictionary rules

- Ticket categories and tags are workspace-scoped dictionaries.
- No hard-delete endpoints are exposed in v1.
- Category `path` is maintained by the service and recalculated when parent or slug changes.
- Category parent references must stay inside the same workspace and cannot create cycles.
- Tag names remain unique per workspace after normalization.

### POST `/api/tickets`

- Purpose: create a ticket in the current workspace, allocate the next workspace-scoped ticket number, create its conversation row, and optionally capture a minimal initial message.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin|agent`
- Request body:

```json
{
  "subject": "Billing issue on paid plan",
  "contactId": "65f1...",
  "mailboxId": "65f2...",
  "organizationId": "65f3...",
  "priority": "high",
  "categoryId": "65f4...",
  "tagIds": ["65f5..."],
  "assigneeId": "65f6...",
  "initialMessage": {
    "type": "internal_note",
    "bodyText": "Customer already called support."
  }
}
```

- Request rules:
  - `subject` required, trimmed string (`1..240`)
  - `contactId` required mongo id
  - `mailboxId`, `organizationId`, `categoryId`, `assigneeId` optional mongo ids
  - `priority` optional enum: `low|normal|high|urgent`
  - `tagIds` optional unique mongo id array
  - `initialMessage` optional object
  - `initialMessage.type` allowed values: `customer_message|internal_note`
  - `initialMessage.bodyText` required when `initialMessage` is present
  - `initialMessage.attachmentFileIds` optional unique mongo id array (`max 20`)
  - attachment ids must reference current-workspace files with `storageStatus = ready`
  - create-time `customer_message` opens the ticket; create-time `internal_note` leaves ticket status unchanged
  - when `initialMessage` is present, realtime still publishes the normal `message.created` and `conversation.updated` events after `ticket.created`
  - no SLA request fields are accepted on ticket create; SLA is resolved automatically from mailbox/workspace configuration when present
- Success `200`:

```json
{
  "messageKey": "success.ticket.created",
  "message": "Ticket created successfully.",
  "ticket": {
    "_id": "65f0...",
    "workspaceId": "65aa...",
    "mailboxId": "65f2...",
    "number": 42,
    "subject": "Billing issue on paid plan",
    "status": "new",
    "priority": "high",
    "channel": "manual",
    "categoryId": "65f4...",
    "tagIds": ["65f5..."],
    "contactId": "65f1...",
    "organizationId": "65f3...",
    "assigneeId": null,
    "conversationId": "65f7...",
    "messageCount": 1,
    "internalNoteCount": 1,
    "lastMessageType": "internal_note",
    "lastMessagePreview": "Customer already called support.",
    "mailbox": {
      "_id": "65f2...",
      "name": "Support",
      "type": "email",
      "emailAddress": null,
      "isDefault": true,
      "isActive": true
    },
    "contact": {
      "_id": "65f1...",
      "organizationId": "65f3...",
      "fullName": "Jane Doe",
      "email": "jane@example.com",
      "phone": "+963955555555"
    },
    "organization": {
      "_id": "65f3...",
      "name": "Acme",
      "domain": "acme.example.com"
    },
    "category": {
      "_id": "65f4...",
      "name": "Billing",
      "slug": "billing",
      "path": "billing",
      "isActive": true
    },
    "tags": [
      {
        "_id": "65f5...",
        "name": "VIP",
        "isActive": true
      }
    ],
    "conversation": {
      "_id": "65f7...",
      "mailboxId": "65f2...",
      "channel": "manual",
      "messageCount": 1,
      "internalNoteCount": 1,
      "lastMessageType": "internal_note",
      "lastMessagePreview": "Customer already called support."
    },
    "sla": {
      "policyId": "65f8...",
      "policyName": "Default Support SLA",
      "firstResponseStatus": "pending",
      "resolutionStatus": "running"
    }
  }
}
```

- Response notes:
  - `ticket.sla` is always present as the ticket-level SLA container.
  - If no effective mailbox/workspace policy exists, `ticket.sla.firstResponseStatus` and `ticket.sla.resolutionStatus` return `not_applicable`.
  - If an effective policy exists, the response includes snapped SLA names/ids from the selected policy snapshot plus the derived statuses.

- Common errors:
  - `422` `errors.validation.failed`
  - `404` `errors.ticket.contactNotFound | errors.ticket.organizationNotFound | errors.ticket.assigneeNotFound | errors.mailbox.notFound | errors.ticketCategory.notFound | errors.ticketTag.notFound | errors.file.notFound`
  - `409` `errors.ticket.attachmentAlreadyLinked`
  - `409` duplicate category/tag uniqueness conflicts flow through their existing module keys
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked`
  - `403` `errors.auth.userSuspended | errors.auth.forbiddenTenant | errors.auth.forbiddenRole`
- Anti-enumeration note:
  - all referenced ids are resolved inside the active workspace only.
  - missing or cross-workspace refs collapse to module-scoped `404` errors.

### GET `/api/tickets`

- Purpose: list tickets in the current workspace with pagination, search, filters, and sort.
- Requirements:
  - Authorization required
  - active user + active workspace membership
- Request query:
  - `page` optional (`>=1`, default `1`)
  - `limit` optional (`1..100`, default `20`)
  - `q` or `search` optional (searches ticket `number` and `subject` only)
  - `status` optional enum filter; accepts a single value, repeated query params, or comma-separated values
  - `priority` optional enum
  - `mailboxId`, `assigneeId`, `categoryId`, `tagId`, `contactId`, `organizationId` optional mongo ids
  - `unassigned` optional boolean
  - `channel` optional enum
  - `includeClosed` optional boolean
  - `createdFrom`, `createdTo`, `updatedFrom`, `updatedTo` optional ISO8601 timestamps
  - each `from` date must be less than or equal to its matching `to` date
  - `sort` optional allowlist: `number|-number|subject|-subject|priority|-priority|createdAt|-createdAt|updatedAt|-updatedAt|lastMessageAt|-lastMessageAt`
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "page": 1,
  "limit": 20,
  "total": 1,
  "results": 1,
  "tickets": [
    {
      "_id": "65f0...",
      "workspaceId": "65aa...",
      "mailboxId": "65f2...",
      "number": 42,
      "subject": "Billing issue on paid plan",
      "status": "new",
      "priority": "high",
      "channel": "manual",
      "contactId": "65f1...",
      "organizationId": "65f3...",
      "conversationId": "65f7...",
      "messageCount": 1,
      "lastMessageType": "internal_note",
      "lastMessagePreview": "Customer already called support.",
      "mailbox": {
        "_id": "65f2...",
        "name": "Support",
        "type": "email",
        "emailAddress": null,
        "isDefault": true,
        "isActive": true
      },
      "contact": {
        "_id": "65f1...",
        "organizationId": "65f3...",
        "fullName": "Jane Doe",
        "email": "jane@example.com",
        "phone": "+963955555555"
      },
      "conversation": {
        "_id": "65f7...",
        "mailboxId": "65f2...",
        "channel": "manual",
        "messageCount": 1,
        "internalNoteCount": 1,
        "lastMessageType": "internal_note",
        "lastMessagePreview": "Customer already called support."
      },
      "sla": {
        "policyId": "65f8...",
        "policyName": "Default Support SLA",
        "firstResponseStatus": "pending",
        "resolutionStatus": "running"
      }
    }
  ]
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked`
  - `403` `errors.auth.userSuspended | errors.auth.forbiddenTenant`
- Anti-enumeration note:
  - the endpoint is always scoped to the active workspace from the token.
  - filter ids are applied inside the current workspace only and never expose foreign-tenant existence.

### GET `/api/tickets/:id`

- Purpose: fetch one ticket detail in the current workspace, including reference summaries and conversation summary.
- Request params:
  - `id`: mongo id
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "ticket": {
    "_id": "65f0...",
    "workspaceId": "65aa...",
    "mailboxId": "65f2...",
    "number": 42,
    "subject": "Billing issue on paid plan",
    "status": "new",
    "priority": "high",
    "channel": "manual",
    "categoryId": "65f4...",
    "tagIds": ["65f5..."],
    "contactId": "65f1...",
    "organizationId": "65f3...",
    "conversationId": "65f7...",
    "messageCount": 1,
    "publicMessageCount": 0,
    "internalNoteCount": 1,
    "attachmentCount": 0,
    "participantCount": 0,
    "lastMessageType": "internal_note",
    "lastMessagePreview": "Customer already called support.",
    "mailbox": {
      "_id": "65f2...",
      "name": "Support",
      "type": "email",
      "emailAddress": null,
      "isDefault": true,
      "isActive": true
    },
    "category": {
      "_id": "65f4...",
      "name": "Billing",
      "slug": "billing",
      "path": "billing",
      "isActive": false
    },
    "tags": [
      {
        "_id": "65f5...",
        "name": "VIP",
        "isActive": false
      }
    ],
    "conversation": {
      "_id": "65f7...",
      "mailboxId": "65f2...",
      "channel": "manual",
      "messageCount": 1,
      "internalNoteCount": 1,
      "lastMessageType": "internal_note",
      "lastMessagePreview": "Customer already called support."
    },
    "sla": {
      "policyId": "65f8...",
      "policyName": "Default Support SLA",
      "policySource": "workspace_default",
      "businessHoursId": "65f9...",
      "businessHoursName": "Support Weekdays",
      "businessHoursTimezone": "UTC",
      "firstResponseTargetMinutes": 30,
      "resolutionTargetMinutes": 180,
      "firstResponseStatus": "pending",
      "resolutionStatus": "running"
    }
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `404` `errors.ticket.notFound`
- Anti-enumeration note:
  - cross-workspace ids resolve as `404 errors.ticket.notFound`.
  - already-linked inactive category/tag refs remain readable inside the ticket detail payload.
- Notes:
  - `ticket.sla.policyName` and `ticket.sla.businessHoursName` are returned from the stored ticket SLA snapshot, not from a live populate of the current SLA records.

### PATCH `/api/tickets/:id`

- Purpose: update editable ticket record fields in the current workspace.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin|agent`
- Request body:

```json
{
  "subject": "Updated billing issue subject",
  "priority": "urgent",
  "categoryId": "65f4...",
  "tagIds": ["65f5..."],
  "mailboxId": "65f2..."
}
```

- Request rules:
  - allowed fields only: `subject`, `priority`, `categoryId`, `tagIds`, `mailboxId`
  - at least one allowed field is required
  - `categoryId` may be `null` to clear the category
  - `tagIds` replaces the full linked tag set
  - `mailboxId` may change only while `messageCount = 0`
  - `status`, `contactId`, `organizationId`, `conversationId`, counters, and unknown fields are rejected
- Success `200`:

```json
{
  "messageKey": "success.ticket.updated",
  "message": "Ticket updated successfully.",
  "ticket": {
    "_id": "65f0...",
    "workspaceId": "65aa...",
    "number": 42,
    "subject": "Updated billing issue subject",
    "status": "new",
    "priority": "urgent",
    "mailboxId": "65f2...",
    "categoryId": "65f4...",
    "tagIds": ["65f5..."],
    "contactId": "65f1...",
    "organizationId": "65f3...",
    "conversationId": "65f7...",
    "messageCount": 0,
    "publicMessageCount": 0,
    "internalNoteCount": 0,
    "attachmentCount": 0,
    "participantCount": 0,
    "mailbox": {
      "_id": "65f2...",
      "name": "Support",
      "type": "email",
      "emailAddress": null,
      "isDefault": false,
      "isActive": true
    },
    "category": {
      "_id": "65f4...",
      "name": "Billing",
      "slug": "billing",
      "path": "billing",
      "isActive": true
    },
    "tags": [
      {
        "_id": "65f5...",
        "name": "VIP",
        "isActive": true
      }
    ],
    "conversation": {
      "_id": "65f7...",
      "mailboxId": "65f2...",
      "channel": "manual",
      "messageCount": 0,
      "publicMessageCount": 0,
      "internalNoteCount": 0,
      "attachmentCount": 0,
      "lastMessageType": null,
      "lastMessagePreview": null
    }
  }
}
```

- Notes:
  - the request body is partial, but the response returns the full updated ticket detail shape, including hydrated reference summaries, matching `GET /api/tickets/:id`.
  - changing `priority` recalculates the stored ticket SLA snapshot for the same effective policy selection.
  - changing `mailboxId` while `messageCount = 0` recalculates the stored ticket SLA snapshot using the new mailbox override or workspace default selection.

- Common errors:
  - `422` `errors.validation.failed`
  - `404` `errors.ticket.notFound | errors.mailbox.notFound | errors.ticketCategory.notFound | errors.ticketTag.notFound`
  - `409` `errors.ticket.mailboxChangeNotAllowed`
  - `403` `errors.auth.forbiddenRole`
- Anti-enumeration note:
  - cross-workspace ticket ids and referenced ids collapse to workspace-scoped `404` responses.

### GET `/api/tickets/:id/conversation`

- Purpose: return the one conversation summary linked to the ticket in the current workspace.
- Request params:
  - `id`: mongo id
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "conversation": {
    "_id": "65f7...",
    "workspaceId": "65aa...",
    "ticketId": "65f0...",
    "mailboxId": "65f2...",
    "channel": "manual",
    "messageCount": 3,
    "publicMessageCount": 1,
    "internalNoteCount": 1,
    "attachmentCount": 2,
    "lastMessageAt": "2026-03-13T12:00:00.000Z",
    "lastMessageType": "customer_message",
    "lastMessagePreview": "Customer replied with more details.",
    "mailbox": {
      "_id": "65f2...",
      "name": "Support",
      "type": "email",
      "emailAddress": null,
      "isDefault": true,
      "isActive": true
    }
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `404` `errors.ticket.notFound`
  - `500` `errors.ticket.conversationInvariantFailed`
- Anti-enumeration note:
  - cross-workspace ticket ids resolve as `404 errors.ticket.notFound`.

### GET `/api/tickets/:id/messages`

- Purpose: list paginated message history for the ticket thread.
- Request params:
  - `id`: mongo id
- Request query:
  - `page` optional (`>=1`, default `1`)
  - `limit` optional (`1..100`, default `20`)
  - `type` optional enum: `customer_message|public_reply|internal_note|system_event`
  - `sort` optional allowlist: `createdAt|-createdAt`
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "page": 1,
  "limit": 20,
  "total": 1,
  "results": 1,
  "messages": [
    {
      "_id": "65f8...",
      "channel": "manual",
      "type": "internal_note",
      "direction": null,
      "from": null,
      "to": [],
      "subject": null,
      "bodyText": "Customer already called support.",
      "bodyHtml": null,
      "attachments": [
        {
          "_id": "65f9...",
          "url": "/api/files/65f9.../download",
          "originalName": "call-log.txt",
          "mimeType": "text/plain",
          "sizeBytes": 124
        }
      ],
      "createdBy": {
        "_id": "65fa...",
        "email": "agent@example.com",
        "name": "Support Agent",
        "avatar": null,
        "status": "active"
      },
      "sentAt": null,
      "receivedAt": null,
      "createdAt": "2026-03-13T11:00:00.000Z",
      "updatedAt": "2026-03-13T11:00:00.000Z"
    }
  ]
}
```

- Notes:
  - each `attachments[]` entry is a lightweight file summary only: `_id`, `url`, `originalName`, `mimeType`, `sizeBytes`.
  - each message row omits route-redundant ids such as `workspaceId`, `ticketId`, `conversationId`, and `mailboxId`, and also omits duplicate id-only fields when the richer object is already present.

- Common errors:
  - `422` `errors.validation.failed`
  - `404` `errors.ticket.notFound`
- Anti-enumeration note:
  - the ticket id is always resolved inside the active workspace only.

### POST `/api/tickets/:id/messages`

- Purpose: append a message to the ticket thread and update ticket/conversation summaries.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin|agent`
- Request body:

```json
{
  "type": "public_reply",
  "bodyText": "We have applied the fix and are waiting for your confirmation.",
  "bodyHtml": null,
  "attachmentFileIds": ["65f9..."]
}
```

- Request rules:
  - `type` allowed values: `customer_message|public_reply|internal_note`
  - `bodyText` required, trimmed string (`1..50000`)
  - `bodyHtml` optional nullable string
  - `attachmentFileIds` optional unique mongo id array (`max 20`)
  - file ids must resolve to current-workspace, non-deleted, storage-ready files
  - files already attached to another message are rejected
  - closed tickets accept `internal_note` only
- Success `200`:

```json
{
  "messageKey": "success.ticket.messageCreated",
  "message": "Ticket message created successfully.",
  "messageRecord": {
    "_id": "65f8...",
    "channel": "manual",
    "type": "public_reply",
    "direction": "outbound",
    "from": {
      "name": "Support",
      "email": null
    },
    "to": [
      {
        "name": "Jane Doe",
        "email": "jane@example.com"
      }
    ],
    "bodyText": "We have applied the fix and are waiting for your confirmation.",
    "bodyHtml": null,
    "attachments": [
      {
        "_id": "65f9...",
        "url": "/api/files/65f9.../download",
        "originalName": "resolution.txt",
        "mimeType": "text/plain",
        "sizeBytes": 124
      }
    ],
    "sentAt": null,
    "receivedAt": null,
    "createdBy": {
      "_id": "65fa...",
      "email": "agent@example.com",
      "name": "Support Agent",
      "avatar": null,
      "status": "active"
    },
    "createdAt": "2026-03-13T12:10:00.000Z",
    "updatedAt": "2026-03-13T12:10:00.000Z"
  },
  "conversation": {
    "_id": "65f7...",
    "ticketId": "65f0...",
    "messageCount": 2,
    "publicMessageCount": 1,
    "attachmentCount": 1,
    "lastMessageType": "public_reply",
    "lastMessagePreview": "We have applied the fix and are waiting for your confirmation."
  },
  "ticketSummary": {
    "_id": "65f0...",
    "status": "waiting_on_customer",
    "messageCount": 2,
    "publicMessageCount": 1,
    "attachmentCount": 1,
    "lastMessageType": "public_reply",
    "lastMessagePreview": "We have applied the fix and are waiting for your confirmation.",
    "sla": {
      "policyName": "Default Support SLA",
      "businessHoursName": "Support Weekdays",
      "firstResponseAt": "2026-03-13T12:10:00.000Z",
      "resolvedAt": null
    }
  }
}
```

- Notes:
  - `messageRecord` uses the same slim message DTO style as the message list and omits route-redundant ids plus duplicate id-only fields when hydrated objects are already returned.

- Common errors:
  - `422` `errors.validation.failed`
  - `404` `errors.ticket.notFound | errors.file.notFound`
  - `409` `errors.ticket.closedMessageNotAllowed | errors.ticket.attachmentAlreadyLinked`
  - `403` `errors.auth.forbiddenRole`
- Anti-enumeration note:
  - ticket and file ids are resolved only inside the active workspace.
  - missing or cross-workspace refs collapse to workspace-scoped `404` responses.
- Notes:
  - each `attachments[]` entry is a lightweight file summary only: `_id`, `url`, `originalName`, `mimeType`, `sizeBytes`.
  - `public_reply` moves the ticket to `waiting_on_customer`.
  - `customer_message` sets the ticket to `open` and reopens solved tickets.
  - `internal_note` does not change ticket status.
  - manual `customer_message` and `public_reply` records populate `from/to` from the linked contact and mailbox.
  - `public_reply` is the only message type that satisfies first response SLA.
  - `public_reply` pauses resolution SLA through the `waiting_on_customer` status.
  - `customer_message` resumes paused resolution SLA and recalculates an active due time from the remaining business minutes.
  - `internal_note` never satisfies first response SLA and does not affect resolution state by itself.
  - `ticketSummary.sla.policyName` and `ticketSummary.sla.businessHoursName` mirror the stored ticket SLA snapshot when an SLA is applicable.

### POST `/api/tickets/:id/assign`

- Purpose: assign the ticket to an operational workspace member.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin`
- Request body:

```json
{
  "assigneeId": "65fa..."
}
```

- Request rules:
  - `assigneeId` required mongo id
  - assignee must be an active same-workspace member with role `owner|admin|agent`
  - `viewer` cannot be assigned
  - `owner|admin` can assign any eligible assignee
  - agents should use `POST /api/tickets/:id/self-assign`
- Success `200`:

```json
{
  "messageKey": "success.ticket.assigned",
  "message": "Ticket assigned successfully.",
  "ticket": {
    "_id": "65f0...",
    "assigneeId": "65fa...",
    "assignedAt": "2026-03-13T12:15:00.000Z",
    "status": "open"
  }
}
```

- Notes:
  - assignment actions return an action-scoped ticket summary, not the full hydrated ticket detail payload.

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenRole`
  - `404` `errors.ticket.notFound | errors.ticket.assigneeNotFound`
- Anti-enumeration note:
  - missing or cross-workspace ticket/user ids collapse to workspace-scoped `404` responses.

### POST `/api/tickets/:id/unassign`

- Purpose: clear the current ticket assignee.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin|agent`
- Request body:
  - empty object allowed
- Success `200`:

```json
{
  "messageKey": "success.ticket.unassigned",
  "message": "Ticket unassigned successfully.",
  "ticket": {
    "_id": "65f0...",
    "assigneeId": null,
    "assignedAt": null,
    "status": "open"
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenRole | errors.ticket.unassignNotAllowed`
  - `404` `errors.ticket.notFound`
- Anti-enumeration note:
  - ticket lookup always stays inside the active workspace.
- Notes:
  - the operation is idempotent when the ticket is already unassigned.
  - `agent` can unassign tickets assigned to themselves; `owner|admin` can unassign any ticket.

### POST `/api/tickets/:id/self-assign`

- Purpose: assign the ticket to the current authenticated operational user.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin|agent`
- Request body:
  - empty object allowed
- Success `200`:

```json
{
  "messageKey": "success.ticket.selfAssigned",
  "message": "Ticket assigned to you successfully.",
  "ticket": {
    "_id": "65f0...",
    "assigneeId": "65fa...",
    "assignedAt": "2026-03-13T12:15:00.000Z",
    "status": "open"
  }
}
```

- Notes:
  - assignment actions return an action-scoped ticket summary, not the full hydrated ticket detail payload.

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenRole`
  - `404` `errors.ticket.notFound`
  - `409` `errors.ticket.selfAssignNotAvailable`
- Anti-enumeration note:
  - ticket lookup is resolved only inside the active workspace.
- Notes:
  - self-assignment works when the ticket is unassigned or already assigned to the current user.
  - this endpoint does not allow silently taking tickets already assigned to another user.

### POST `/api/tickets/:id/status`

- Purpose: move the ticket through an allowed explicit non-close status transition.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin|agent`
- Request body:

```json
{
  "status": "pending"
}
```

- Request rules:
  - `status` required enum: `open|pending|waiting_on_customer|solved`
  - allowed transitions:
    - `new -> open|pending|waiting_on_customer|solved`
    - `open -> pending|waiting_on_customer|solved`
    - `pending -> open|waiting_on_customer|solved`
    - `waiting_on_customer -> open|pending|solved`
    - `solved -> open`
- Success `200`:

```json
{
  "messageKey": "success.ticket.statusUpdated",
  "message": "Ticket status updated successfully.",
  "ticket": {
    "_id": "65f0...",
    "status": "pending",
    "statusChangedAt": "2026-03-13T12:20:00.000Z",
    "sla": {
      "policyName": "Default Support SLA",
      "businessHoursName": "Support Weekdays",
      "resolutionStatus": "running",
      "isResolutionPaused": false
    }
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenRole`
  - `404` `errors.ticket.notFound`
  - `409` `errors.ticket.invalidStatusTransition`
- Anti-enumeration note:
  - cross-workspace ticket ids resolve as `404 errors.ticket.notFound`.
- Notes:
  - setting `waiting_on_customer` pauses resolution SLA.
  - `pending` remains an active resolution state in v1.
  - setting `solved` through this endpoint uses the same resolution-SLA success rules as `POST /api/tickets/:id/solve`.

### POST `/api/tickets/:id/solve`

- Purpose: mark the ticket as solved through the explicit lifecycle action.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin|agent`
- Request body:
  - empty object allowed
- Success `200`:

```json
{
  "messageKey": "success.ticket.solved",
  "message": "Ticket marked as solved successfully.",
  "ticket": {
    "_id": "65f0...",
    "status": "solved",
    "statusChangedAt": "2026-03-13T12:25:00.000Z",
    "sla": {
      "policyName": "Default Support SLA",
      "businessHoursName": "Support Weekdays",
      "resolvedAt": "2026-03-13T12:25:00.000Z"
    }
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenRole`
  - `404` `errors.ticket.notFound`
  - `409` `errors.ticket.solveNotAllowed`
- Anti-enumeration note:
  - ticket lookup is restricted to the current workspace.
- Notes:
  - `solved` is the resolution SLA success point.
  - late solves can return `ticket.sla.resolutionStatus = breached` while still stamping `resolvedAt`.

### POST `/api/tickets/:id/close`

- Purpose: close a solved ticket explicitly.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin|agent`
- Request body:
  - empty object allowed
- Success `200`:

```json
{
  "messageKey": "success.ticket.closed",
  "message": "Ticket closed successfully.",
  "ticket": {
    "_id": "65f0...",
    "status": "closed",
    "closedAt": "2026-03-13T12:30:00.000Z",
    "statusChangedAt": "2026-03-13T12:30:00.000Z",
    "sla": {
      "policyName": "Default Support SLA",
      "businessHoursName": "Support Weekdays",
      "resolvedAt": "2026-03-13T12:25:00.000Z"
    }
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenRole`
  - `404` `errors.ticket.notFound`
  - `409` `errors.ticket.closeNotAllowed`
- Anti-enumeration note:
  - ticket lookup is resolved only in the active workspace.
- Notes:
  - closing preserves the existing ticket resolution marker.
  - closing does not become the SLA success point; resolution is still judged at `solved`.

### POST `/api/tickets/:id/reopen`

- Purpose: reopen a solved or closed ticket and return it to `open`.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin|agent`
- Request body:
  - empty object allowed
- Success `200`:

```json
{
  "messageKey": "success.ticket.reopened",
  "message": "Ticket reopened successfully.",
  "ticket": {
    "_id": "65f0...",
    "status": "open",
    "closedAt": null,
    "statusChangedAt": "2026-03-13T12:35:00.000Z",
    "sla": {
      "policyName": "Default Support SLA",
      "businessHoursName": "Support Weekdays",
      "resolvedAt": null
    }
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenRole`
  - `404` `errors.ticket.notFound`
  - `409` `errors.ticket.reopenNotAllowed`
- Anti-enumeration note:
  - cross-workspace ticket ids collapse to `404 errors.ticket.notFound`.
- Notes:
  - reopening a closed ticket restores message writes for `customer_message` and `public_reply`.
  - when resolution SLA is applicable, reopening resumes from remaining business time instead of resetting a fresh target.
  - first-response history is preserved across reopen.

### GET `/api/tickets/:id/participants`

- Purpose: list active internal participants linked to the ticket.
- Requirements:
  - Authorization required
  - active user + active workspace membership
- Request params:
  - `id`: mongo id
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "participants": [
    {
      "_id": "65fb...",
      "userId": "65fa...",
      "type": "watcher",
      "createdAt": "2026-03-13T12:40:00.000Z",
      "updatedAt": "2026-03-13T12:40:00.000Z",
      "user": {
        "_id": "65fa...",
        "email": "viewer@example.com",
        "name": "Viewer User",
        "avatar": null,
        "status": "active",
        "roleKey": "viewer"
      }
    }
  ]
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `404` `errors.ticket.notFound`
- Anti-enumeration note:
  - ticket ids are resolved only inside the active workspace.

### POST `/api/tickets/:id/participants`

- Purpose: add or update an internal participant on the ticket.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin|agent`
- Request body:

```json
{
  "userId": "65fa...",
  "type": "collaborator"
}
```

- Request rules:
  - `userId` required mongo id
  - `type` required enum: `watcher|collaborator`
  - target user must be an active same-workspace member
  - participants are metadata only and may include viewers
- Success `200`:

```json
{
  "messageKey": "success.ticket.participantSaved",
  "message": "Ticket participant saved successfully.",
  "participant": {
    "_id": "65fb...",
    "userId": "65fa...",
    "type": "collaborator",
    "createdAt": "2026-03-13T12:40:00.000Z",
    "updatedAt": "2026-03-13T12:40:00.000Z",
    "user": {
      "_id": "65fa...",
      "email": "viewer@example.com",
      "name": "Viewer User",
      "avatar": null,
      "status": "active",
      "roleKey": "viewer"
    }
  },
  "ticketSummary": {
    "_id": "65f0...",
    "participantCount": 1
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenRole`
  - `404` `errors.ticket.notFound | errors.ticket.participantUserNotFound`
- Anti-enumeration note:
  - missing or cross-workspace ticket/user ids resolve through workspace-scoped `404` responses.
- Notes:
  - re-posting the same `userId` updates the participant `type` instead of creating a duplicate active row.

### DELETE `/api/tickets/:id/participants/:userId`

- Purpose: remove an active participant from the ticket.
- Requirements:
  - Authorization required
  - active user + active workspace membership
  - role must be `owner|admin|agent`
- Request params:
  - `id`: mongo id
  - `userId`: mongo id
- Success `200`:

```json
{
  "messageKey": "success.ticket.participantRemoved",
  "message": "Ticket participant removed successfully.",
  "ticketSummary": {
    "_id": "65f0...",
    "participantCount": 0
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenRole`
  - `404` `errors.ticket.notFound`
- Anti-enumeration note:
  - the ticket is always resolved inside the active workspace before participant removal logic runs.
- Notes:
  - removing an already-absent participant is idempotent.

### GET `/api/tickets/categories`

- Purpose: list ticket categories with pagination, search, filters, and sort.
- Request query:
  - `page` optional (`>=1`, default `1`)
  - `limit` optional (`1..100`, default `20`)
  - `q` or `search` optional (partial search over `name`, `slug`, `path`)
  - `parentId` optional mongo id
  - `isActive` optional boolean
  - `includeInactive` optional boolean
  - `sort` optional allowlist: `order|-order|name|-name|createdAt|-createdAt|updatedAt|-updatedAt`
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "page": 1,
  "limit": 20,
  "total": 1,
  "results": 1,
  "categories": [
    {
      "_id": "65f1...",
      "workspaceId": "65aa...",
      "name": "Customer Care",
      "slug": "customer-care",
      "parentId": null,
      "path": "customer-care",
      "order": 0,
      "isActive": true
    }
  ]
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant` for unauthorized inactive visibility requests
- Anti-enumeration note:
  - results are restricted to the current workspace only.

### GET `/api/tickets/categories/options`

- Purpose: return lightweight category options for selectors and typeaheads.
- Request query:
  - `q` or `search` optional
  - `parentId` optional mongo id
  - `limit` optional (`1..50`, default `20`)
  - `isActive` optional boolean
  - `includeInactive` optional boolean
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "options": [
    {
      "_id": "65f1...",
      "name": "Customer Care",
      "slug": "customer-care",
      "parentId": null,
      "path": "customer-care"
    }
  ]
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
- Anti-enumeration note:
  - only categories from the current workspace are returned.

### GET `/api/tickets/categories/:id`

- Purpose: fetch one ticket category in the current workspace.
- Request params:
  - `id`: mongo id
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "category": {
    "_id": "65f1...",
    "workspaceId": "65aa...",
    "name": "Refund Requests",
    "slug": "refund-requests",
    "parentId": "65f0...",
    "path": "customer-care/refund-requests",
    "order": 0,
    "isActive": true
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `404` `errors.ticketCategory.notFound`
- Anti-enumeration note:
  - cross-workspace ids resolve as `404 errors.ticketCategory.notFound`.
  - inactive rows are hidden from `agent|viewer`.

### POST `/api/tickets/categories`

- Purpose: create a ticket category in the current workspace.
- Requirements:
  - role must be `owner|admin`
- Request body:

```json
{
  "name": "Refund Requests",
  "slug": "refund-requests",
  "parentId": "65f0...",
  "order": 10
}
```

- `name` required, `1..120`
- `slug` optional, `1..140`; when omitted or blank, the service derives it from `name`
- `parentId` optional, must reference a non-deleted category in the same workspace
- `order` optional integer
- Success `200`:

```json
{
  "messageKey": "success.ticketCategory.created",
  "message": "Ticket category created successfully.",
  "category": {
    "_id": "65f1...",
    "workspaceId": "65aa...",
    "name": "Refund Requests",
    "slug": "refund-requests",
    "parentId": "65f0...",
    "path": "customer-care/refund-requests",
    "order": 10,
    "isActive": true
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenRole`
  - `404` `errors.ticketCategory.notFound | errors.workspace.notFound`
  - `409` `errors.ticketCategory.slugAlreadyUsed`
- Anti-enumeration note:
  - cross-workspace or deleted parent ids collapse to `404 errors.ticketCategory.notFound`.

### PATCH `/api/tickets/categories/:id`

- Purpose: update ticket category metadata.
- Requirements:
  - role must be `owner|admin`
- Request body:
  - updatable fields: `name`, `slug`, `parentId`, `order`
  - at least one allowed field is required
  - unknown fields are rejected
- Success `200`:

```json
{
  "messageKey": "success.ticketCategory.updated",
  "message": "Ticket category updated successfully.",
  "category": {
    "_id": "65f1...",
    "workspaceId": "65aa...",
    "name": "Refund Requests",
    "slug": "refund-requests",
    "parentId": "65f0...",
    "path": "customer-care/refund-requests",
    "order": 20,
    "isActive": true
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenRole`
  - `404` `errors.ticketCategory.notFound | errors.workspace.notFound`
  - `409` `errors.ticketCategory.slugAlreadyUsed`
- Anti-enumeration note:
  - cross-workspace ids resolve as `404 errors.ticketCategory.notFound`.
- Notes:
  - `parentId` cannot point to the same category.
  - parent changes that would create ancestry cycles are rejected.
  - parent or slug changes recalculate the category path and descendant paths.

### POST `/api/tickets/categories/:id/activate`

- Purpose: activate a ticket category.
- Requirements:
  - role must be `owner|admin`
- Request body:
  - empty object allowed
- Success `200`:

```json
{
  "messageKey": "success.ticketCategory.activated",
  "message": "Ticket category activated successfully.",
  "category": {
    "_id": "65f1...",
    "workspaceId": "65aa...",
    "isActive": true
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenRole`
  - `404` `errors.ticketCategory.notFound | errors.workspace.notFound`
- Anti-enumeration note:
  - cross-workspace ids resolve as `404 errors.ticketCategory.notFound`.
- Notes:
  - the operation is idempotent.

### POST `/api/tickets/categories/:id/deactivate`

- Purpose: deactivate a ticket category.
- Requirements:
  - role must be `owner|admin`
- Request body:
  - empty object allowed
- Success `200`:

```json
{
  "messageKey": "success.ticketCategory.deactivated",
  "message": "Ticket category deactivated successfully.",
  "category": {
    "_id": "65f1...",
    "workspaceId": "65aa...",
    "isActive": false
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenRole`
  - `404` `errors.ticketCategory.notFound | errors.workspace.notFound`
- Anti-enumeration note:
  - cross-workspace ids resolve as `404 errors.ticketCategory.notFound`.
- Notes:
  - the operation is idempotent.

### GET `/api/tickets/tags`

- Purpose: list ticket tags with pagination, search, filters, and sort.
- Request query:
  - `page` optional (`>=1`, default `1`)
  - `limit` optional (`1..100`, default `20`)
  - `q` or `search` optional (partial search over `name`)
  - `isActive` optional boolean
  - `includeInactive` optional boolean
  - `sort` optional allowlist: `name|-name|createdAt|-createdAt|updatedAt|-updatedAt`
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "page": 1,
  "limit": 20,
  "total": 1,
  "results": 1,
  "tags": [
    {
      "_id": "65f1...",
      "workspaceId": "65aa...",
      "name": "VIP",
      "isActive": true
    }
  ]
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant` for unauthorized inactive visibility requests
- Anti-enumeration note:
  - results are restricted to the current workspace only.

### GET `/api/tickets/tags/options`

- Purpose: return lightweight tag options for selectors and typeaheads.
- Request query:
  - `q` or `search` optional
  - `limit` optional (`1..50`, default `20`)
  - `isActive` optional boolean
  - `includeInactive` optional boolean
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "options": [
    {
      "_id": "65f1...",
      "name": "VIP"
    }
  ]
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
- Anti-enumeration note:
  - only tags from the current workspace are returned.

### GET `/api/tickets/tags/:id`

- Purpose: fetch one ticket tag in the current workspace.
- Request params:
  - `id`: mongo id
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "tag": {
    "_id": "65f1...",
    "workspaceId": "65aa...",
    "name": "VIP",
    "isActive": true
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `404` `errors.ticketTag.notFound`
- Anti-enumeration note:
  - cross-workspace ids resolve as `404 errors.ticketTag.notFound`.
  - inactive rows are hidden from `agent|viewer`.

### POST `/api/tickets/tags`

- Purpose: create a ticket tag in the current workspace.
- Requirements:
  - role must be `owner|admin`
- Request body:

```json
{
  "name": "VIP"
}
```

- `name` required, `1..80`
- Success `200`:

```json
{
  "messageKey": "success.ticketTag.created",
  "message": "Ticket tag created successfully.",
  "tag": {
    "_id": "65f1...",
    "workspaceId": "65aa...",
    "name": "VIP",
    "isActive": true
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenRole`
  - `404` `errors.workspace.notFound`
  - `409` `errors.ticketTag.nameAlreadyUsed`
- Anti-enumeration note:
  - tag creation always applies to the current workspace only.

### PATCH `/api/tickets/tags/:id`

- Purpose: update ticket tag metadata.
- Requirements:
  - role must be `owner|admin`
- Request body:
  - updatable fields: `name`
  - at least one allowed field is required
  - unknown fields are rejected
- Success `200`:

```json
{
  "messageKey": "success.ticketTag.updated",
  "message": "Ticket tag updated successfully.",
  "tag": {
    "_id": "65f1...",
    "workspaceId": "65aa...",
    "name": "Priority VIP",
    "isActive": true
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenRole`
  - `404` `errors.ticketTag.notFound | errors.workspace.notFound`
  - `409` `errors.ticketTag.nameAlreadyUsed`
- Anti-enumeration note:
  - cross-workspace ids resolve as `404 errors.ticketTag.notFound`.

### POST `/api/tickets/tags/:id/activate`

- Purpose: activate a ticket tag.
- Requirements:
  - role must be `owner|admin`
- Request body:
  - empty object allowed
- Success `200`:

```json
{
  "messageKey": "success.ticketTag.activated",
  "message": "Ticket tag activated successfully.",
  "tag": {
    "_id": "65f1...",
    "workspaceId": "65aa...",
    "isActive": true
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenRole`
  - `404` `errors.ticketTag.notFound | errors.workspace.notFound`
- Anti-enumeration note:
  - cross-workspace ids resolve as `404 errors.ticketTag.notFound`.
- Notes:
  - the operation is idempotent.

## 14) Billing Quick Start Flows

### Flow A: Open Billing Summary

1. Authenticate with a workspace-scoped access token as an `owner` or `admin`.
2. Ensure the target workspace is the active workspace for the session.
3. Call `GET /api/billing/summary`.
4. Use the returned subscription, entitlements, usage, and billing flags as the FE bootstrap state.

### Flow B: Start First Paid Billing Setup

1. Call `GET /api/billing/catalog` and let the user choose one fixed plan plus optional `extra_seat` and `extra_storage` add-ons.
2. Call `POST /api/billing/checkout-session`.
3. Redirect the user to the returned Stripe Checkout URL.
4. Wait for Stripe webhook sync to update local subscription state.

### Flow C: Open Billing Portal For Ongoing Changes

1. Ensure the workspace already has a Stripe customer linkage.
2. Call `POST /api/billing/portal-session`.
3. Redirect the user to the returned Stripe Billing Portal URL.
4. Let Stripe webhooks sync upgrades, downgrades, payment recovery, and cancellation state back into the local billing records.

## 15) Billing Endpoints Reference

### GET `/api/billing/catalog`

- Purpose: return the fixed active Billing v1 catalog for the active workspace session.
- Requirements:
  - valid bearer access token
  - active user
  - active membership in the current workspace
  - role must be `owner|admin`
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "catalog": {
    "version": "v1",
    "provider": "stripe",
    "currency": "USD",
    "trialDays": 14,
    "graceDays": 7,
    "defaultPlanKey": "starter",
    "plans": [
      {
        "_id": "65f1...",
        "key": "starter",
        "name": "Starter",
        "price": 29,
        "currency": "USD",
        "isActive": true,
        "sortOrder": 1,
        "catalogVersion": "v1",
        "limits": {
          "seatsIncluded": 3,
          "mailboxes": 1,
          "storageBytes": 5368709120,
          "uploadsPerMonth": 1000,
          "ticketsPerMonth": 3000
        },
        "features": {
          "billingEnabled": true,
          "portalEnabled": true,
          "checkoutEnabled": true,
          "slaEnabled": false
        }
      },
      {
        "_id": "65f2...",
        "key": "business",
        "name": "Business",
        "price": 199,
        "currency": "USD",
        "isActive": true,
        "sortOrder": 3,
        "catalogVersion": "v1",
        "limits": {
          "seatsIncluded": 25,
          "mailboxes": 10,
          "storageBytes": 107374182400,
          "uploadsPerMonth": 8000,
          "ticketsPerMonth": 20000
        },
        "features": {
          "billingEnabled": true,
          "portalEnabled": true,
          "checkoutEnabled": true,
          "slaEnabled": true
        }
      }
    ],
    "addons": [
      {
        "_id": "65f3...",
        "key": "extra_seat",
        "name": "Extra Seat",
        "type": "seat",
        "price": 12,
        "currency": "USD",
        "isActive": true,
        "sortOrder": 1,
        "catalogVersion": "v1",
        "effects": {
          "seats": 1,
          "storageBytes": 0
        }
      },
      {
        "_id": "65f4...",
        "key": "extra_storage",
        "name": "Extra Storage",
        "type": "usage",
        "price": 10,
        "currency": "USD",
        "isActive": true,
        "sortOrder": 2,
        "catalogVersion": "v1",
        "effects": {
          "seats": 0,
          "storageBytes": 26843545600
        }
      }
    ]
  }
}
```

- Common errors:
  - `401` `errors.auth.invalidToken`
  - `403` `errors.auth.forbiddenTenant | errors.auth.forbiddenRole`
  - `503` `errors.billing.disabled | errors.billing.catalogUnavailable`

### GET `/api/billing/subscription`

- Purpose: return the current workspace subscription foundation view.
- Requirements:
  - valid bearer access token
  - active user
  - active membership in the current workspace
  - role must be `owner|admin`
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "subscription": {
    "_id": "65f1...",
    "workspaceId": "65aa...",
    "provider": "stripe",
    "status": "active",
    "plan": {
      "_id": "65f2...",
      "key": "growth",
      "name": "Growth",
      "price": 79,
      "currency": "USD",
      "isActive": true,
      "sortOrder": 2,
      "catalogVersion": "v1",
      "limits": {
        "seatsIncluded": 10,
        "mailboxes": 3,
        "storageBytes": 26843545600,
        "uploadsPerMonth": 3000,
        "ticketsPerMonth": 8000
      },
      "features": {
        "billingEnabled": true,
        "portalEnabled": true,
        "checkoutEnabled": true,
        "slaEnabled": true
      }
    },
    "addonItems": [
      {
        "addon": {
          "_id": "65f3...",
          "key": "extra_seat",
          "name": "Extra Seat",
          "type": "seat",
          "price": 12,
          "currency": "USD",
          "isActive": true,
          "sortOrder": 1,
          "catalogVersion": "v1",
          "effects": {
            "seats": 1,
            "storageBytes": 0
          }
        },
        "quantity": 2
      }
    ],
    "stripeCustomerId": "cus_123",
    "stripeSubscriptionId": "sub_123",
    "currentPeriodStart": "2026-03-31T00:00:00.000Z",
    "currentPeriodEnd": "2026-04-30T00:00:00.000Z",
    "trialStartedAt": "2026-03-31T00:00:00.000Z",
    "trialEndsAt": "2026-04-14T00:00:00.000Z",
    "graceStartsAt": null,
    "graceEndsAt": null,
    "pastDueAt": null,
    "partialBlockStartsAt": null,
    "canceledAt": null,
    "cancelAtPeriodEnd": false,
    "lastSyncedAt": "2026-03-31T10:00:00.000Z",
    "catalogVersion": "v1",
    "metadata": {
      "source": "stripe",
      "stripeStatus": "active",
      "lastStripeEventType": "customer.subscription.updated"
    },
    "flags": {
      "isTrialing": false,
      "isPastDue": false,
      "isInGracePeriod": false,
      "isPartialBlockActive": false,
      "cancelAtPeriodEnd": false,
      "overLimit": {
        "seats": false,
        "mailboxes": false,
        "storageBytes": false,
        "uploadsPerMonth": false,
        "ticketsPerMonth": false,
        "any": false
      }
    }
  }
}
```

- Common errors:
  - `401` `errors.auth.invalidToken`
  - `403` `errors.auth.forbiddenTenant | errors.auth.forbiddenRole`
  - `404` `errors.workspace.notFound`
  - `503` `errors.billing.disabled | errors.billing.catalogUnavailable`
- Notes:
  - the backend auto-bootstraps billing foundation rows when the active workspace does not have them yet.
  - if a workspace finishes its trial without setting up billing, local lifecycle fields move into grace and `past_due` state without pretending a payment was made.

### GET `/api/billing/entitlements`

- Purpose: return the current computed entitlement snapshot for the active workspace.
- Requirements:
  - role must be `owner|admin`
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "entitlements": {
    "limits": {
      "seatsIncluded": 12,
      "mailboxes": 3,
      "storageBytes": 26843545600,
      "uploadsPerMonth": 3000,
      "ticketsPerMonth": 8000
    },
    "features": {
      "billingEnabled": true,
      "portalEnabled": true,
      "checkoutEnabled": true,
      "slaEnabled": true
    },
    "usage": {
      "current": {
        "seatsUsed": 4,
        "activeMailboxes": 2,
        "storageBytes": 73400320
      },
      "monthly": {
        "periodKey": "2026-03",
        "ticketsCreated": 11,
        "uploadsCount": 7
      }
    },
    "overLimit": {
      "seats": false,
      "mailboxes": false,
      "storageBytes": false,
      "uploadsPerMonth": false,
      "ticketsPerMonth": false,
      "any": false
    },
    "computedAt": "2026-03-31T10:00:00.000Z",
    "sourceSnapshot": {
      "catalogVersion": "v1",
      "plan": {
        "_id": "65f2...",
        "key": "growth",
        "name": "Growth"
      }
    }
  }
}
```

- Common errors:
  - `401` `errors.auth.invalidToken`
  - `403` `errors.auth.forbiddenTenant | errors.auth.forbiddenRole`
  - `404` `errors.workspace.notFound`
  - `503` `errors.billing.disabled | errors.billing.catalogUnavailable`

### GET `/api/billing/usage`

- Purpose: return the active workspace billing usage view.
- Requirements:
  - role must be `owner|admin`
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "usage": {
    "current": {
      "seatsUsed": 4,
      "activeMailboxes": 2,
      "storageBytes": 73400320
    },
    "monthly": {
      "periodKey": "2026-03",
      "ticketsCreated": 11,
      "uploadsCount": 7
    },
    "overLimit": {
      "seats": false,
      "mailboxes": false,
      "storageBytes": false,
      "uploadsPerMonth": false,
      "ticketsPerMonth": false,
      "any": false
    }
  }
}
```

- Common errors:
  - `401` `errors.auth.invalidToken`
  - `403` `errors.auth.forbiddenTenant | errors.auth.forbiddenRole`
  - `404` `errors.workspace.notFound`
  - `503` `errors.billing.disabled | errors.billing.catalogUnavailable`

### GET `/api/billing/summary`

- Purpose: return a compact FE-oriented billing summary for the active workspace.
- Requirements:
  - role must be `owner|admin`
- Success `200`:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "summary": {
    "subscription": {
      "_id": "65f1...",
      "workspaceId": "65aa...",
      "provider": "stripe",
      "status": "past_due",
      "trialEndsAt": "2026-04-14T00:00:00.000Z",
      "graceStartsAt": "2026-04-14T00:00:00.000Z",
      "graceEndsAt": "2026-04-21T00:00:00.000Z",
      "partialBlockStartsAt": null
    },
    "entitlements": {
      "limits": {
        "seatsIncluded": 3,
        "mailboxes": 1,
        "storageBytes": 5368709120,
        "uploadsPerMonth": 1000,
        "ticketsPerMonth": 3000
      },
      "features": {
        "billingEnabled": true,
        "portalEnabled": true,
        "checkoutEnabled": true,
        "slaEnabled": false
      }
    },
    "usage": {
      "current": {
        "seatsUsed": 1,
        "activeMailboxes": 1,
        "storageBytes": 0
      },
      "monthly": {
        "periodKey": "2026-04",
        "ticketsCreated": 0,
        "uploadsCount": 0
      },
      "overLimit": {
        "seats": false,
        "mailboxes": false,
        "storageBytes": false,
        "uploadsPerMonth": false,
        "ticketsPerMonth": false,
        "any": false
      }
    },
    "flags": {
      "isTrialing": false,
      "isPastDue": true,
      "isInGracePeriod": true,
      "isPartialBlockActive": false,
      "cancelAtPeriodEnd": false,
      "overLimit": {
        "seats": false,
        "mailboxes": false,
        "storageBytes": false,
        "uploadsPerMonth": false,
        "ticketsPerMonth": false,
        "any": false
      }
    }
  }
}
```

- Common errors:
  - `401` `errors.auth.invalidToken`
  - `403` `errors.auth.forbiddenTenant | errors.auth.forbiddenRole`
  - `404` `errors.workspace.notFound`
  - `503` `errors.billing.disabled | errors.billing.catalogUnavailable`

### POST `/api/billing/checkout-session`

- Purpose: create a Stripe Checkout session for first paid billing setup for the active workspace.
- Requirements:
  - valid bearer access token
  - active user
  - active membership in the current workspace
  - role must be `owner|admin`
- Request body:

```json
{
  "planKey": "growth",
  "addonItems": [
    {
      "addonKey": "extra_seat",
      "quantity": 2
    }
  ],
  "successUrl": "https://app.example.com/settings/billing/success",
  "cancelUrl": "https://app.example.com/settings/billing/cancel"
}
```

- Success `200`:

```json
{
  "messageKey": "success.billing.checkoutSessionCreated",
  "message": "Checkout session created successfully.",
  "checkoutSession": {
    "sessionId": "cs_test_123",
    "url": "https://checkout.stripe.com/c/pay/cs_test_123",
    "expiresAt": "2026-03-31T11:00:00.000Z",
    "provider": "stripe"
  }
}
```

- Common errors:
  - `401` `errors.auth.invalidToken`
  - `403` `errors.auth.forbiddenTenant | errors.auth.forbiddenRole`
  - `409` `errors.billing.checkoutUnavailable | errors.billing.checkoutAlreadyManagedInPortal`
  - `404` `errors.billing.planNotFound | errors.billing.addonNotFound`
  - `422` `errors.validation.failed | errors.billing.checkoutUrlsRequired`
  - `503` `errors.billing.disabled | errors.billing.catalogUnavailable | errors.billing.providerNotConfigured | errors.billing.providerPriceMissing`
- Notes:
  - this route is intended for initial paid setup when the workspace does not already have a managed Stripe subscription.
  - once a Stripe subscription exists, ongoing plan and add-on changes are handled through the app billing actions below, while payment recovery and cancellation-state changes can still use the billing portal.
  - starting Checkout does not reset local usage counters.

### POST `/api/billing/change-plan`

- Purpose: change the current base billing plan for an already managed Stripe subscription.
- Requirements:
  - valid bearer access token
  - active user
  - active membership in the current workspace
  - role must be `owner|admin`
  - workspace must already have a managed Stripe subscription
- Request body:

```json
{
  "planKey": "business"
}
```

- Success `200`:

```json
{
  "messageKey": "success.billing.planChanged",
  "message": "Billing plan updated successfully.",
  "subscriptionUpdate": {
    "workspaceId": "65f0f1b7f8e4e5f3c2d1a987",
    "provider": "stripe",
    "previousPlanKey": "growth",
    "requestedPlanKey": "business",
    "currentPlanKey": "business",
    "status": "active",
    "stripeSubscriptionId": "sub_123"
  }
}
```

- Common errors:
  - `401` `errors.auth.invalidToken`
  - `403` `errors.auth.forbiddenTenant | errors.auth.forbiddenRole`
  - `404` `errors.billing.planNotFound`
  - `409` `errors.billing.managedSubscriptionRequired`
  - `422` `errors.validation.failed`
  - `503` `errors.billing.disabled | errors.billing.catalogUnavailable | errors.billing.providerNotConfigured | errors.billing.providerPriceMissing | errors.billing.providerSyncFailed`
- Notes:
  - this action updates the Stripe base plan item and then re-syncs local billing state from Stripe.
  - if the requested plan already matches the current managed plan, the route still returns success and behaves as a no-op without sending a Stripe update mutation.
  - the frontend should refetch billing summary after success instead of assuming all local state is already final.

### POST `/api/billing/update-addons`

- Purpose: add, remove, or resize supported billing add-ons on an already managed Stripe subscription.
- Requirements:
  - valid bearer access token
  - active user
  - active membership in the current workspace
  - role must be `owner|admin`
  - workspace must already have a managed Stripe subscription
- Request body:

```json
{
  "addonItems": [
    {
      "addonKey": "extra_seat",
      "quantity": 0
    },
    {
      "addonKey": "extra_storage",
      "quantity": 2
    }
  ]
}
```

- Success `200`:

```json
{
  "messageKey": "success.billing.addonsUpdated",
  "message": "Billing add-ons updated successfully.",
  "subscriptionUpdate": {
    "workspaceId": "65f0f1b7f8e4e5f3c2d1a987",
    "provider": "stripe",
    "status": "active",
    "stripeSubscriptionId": "sub_123",
    "addonItems": [
      {
        "addonKey": "extra_storage",
        "quantity": 2
      }
    ]
  }
}
```

- Common errors:
  - `401` `errors.auth.invalidToken`
  - `403` `errors.auth.forbiddenTenant | errors.auth.forbiddenRole`
  - `404` `errors.billing.addonNotFound`
  - `409` `errors.billing.managedSubscriptionRequired`
  - `422` `errors.validation.failed`
  - `503` `errors.billing.disabled | errors.billing.catalogUnavailable | errors.billing.providerNotConfigured | errors.billing.providerPriceMissing | errors.billing.providerSyncFailed`
- Notes:
  - quantity `0` removes the add-on from the Stripe subscription.
  - quantity `> 0` adds or updates that add-on item.
  - if the requested add-on quantities already match the managed Stripe subscription, the route still returns success and behaves as a no-op without sending a Stripe update mutation.
  - the frontend should refetch billing summary after success instead of assuming all local state is already final.

### POST `/api/billing/portal-session`

- Purpose: create a Stripe Billing Portal session for payment method management, payment recovery, cancellation, and other Stripe-hosted actions for the active workspace.
- Requirements:
  - valid bearer access token
  - active user
  - active membership in the current workspace
  - role must be `owner|admin`
- Request body:

```json
{
  "returnUrl": "https://app.example.com/settings/billing"
}
```

- Success `200`:

```json
{
  "messageKey": "success.billing.portalSessionCreated",
  "message": "Billing portal session created successfully.",
  "portalSession": {
    "url": "https://billing.stripe.com/p/session/test_123",
    "provider": "stripe",
    "createdAt": "2026-03-31T10:00:00.000Z"
  }
}
```

- Common errors:
  - `401` `errors.auth.invalidToken`
  - `403` `errors.auth.forbiddenTenant | errors.auth.forbiddenRole`
  - `409` `errors.billing.portalUnavailable`
  - `422` `errors.validation.failed`
  - `503` `errors.billing.disabled | errors.billing.providerNotConfigured`
- Notes:
  - the portal should be treated as the hosted payment and account-management surface.
  - Billing v1 uses app-managed plan and add-on updates through `POST /api/billing/change-plan` and `POST /api/billing/update-addons`.

### POST `/api/billing/webhooks/stripe`

- Purpose: accept Stripe webhook events, verify signatures, persist them idempotently, and enqueue follow-up processing.
- Requirements:
  - public endpoint
  - Stripe must send the raw signed JSON body
  - `stripe-signature` header is required
- Request body:
  - raw Stripe event JSON
- Success `200`:

```json
{
  "messageKey": "success.billing.webhookAccepted",
  "message": "Billing webhook accepted successfully.",
  "accepted": true,
  "duplicate": false,
  "queued": true,
  "webhookEventId": "65fa...",
  "eventId": "evt_123",
  "eventType": "customer.subscription.updated"
}
```

- Common errors:
  - `400` `errors.billing.webhookSignatureInvalid`
  - `503` `errors.billing.providerNotConfigured | errors.billing.webhookNotConfigured`
- Notes:
  - the event is persisted before the queue step so replay and repair remain possible if Redis or worker processing is temporarily unavailable.
  - duplicate Stripe event ids are accepted idempotently and do not create duplicate inbox rows.

### POST `/api/tickets/tags/:id/deactivate`

- Purpose: deactivate a ticket tag.
- Requirements:
  - role must be `owner|admin`
- Request body:
  - empty object allowed
- Success `200`:

```json
{
  "messageKey": "success.ticketTag.deactivated",
  "message": "Ticket tag deactivated successfully.",
  "tag": {
    "_id": "65f1...",
    "workspaceId": "65aa...",
    "isActive": false
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenRole`
  - `404` `errors.ticketTag.notFound | errors.workspace.notFound`
- Anti-enumeration note:
  - cross-workspace ids resolve as `404 errors.ticketTag.notFound`.
- Notes:
  - the operation is idempotent.
