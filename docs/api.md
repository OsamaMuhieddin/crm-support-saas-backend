# API Reference (MVP Auth + Workspace Invites + Workspace Switching)

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

## 2) Auth model & authorization model

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

## 3) Quick Start Flows

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

### Flow F: Ticket Categories and Tags

1. Owner/Admin creates ticket categories and tags inside the current workspace.
2. Use `GET /api/tickets/categories` and `GET /api/tickets/tags` for paginated admin/operator reads.
3. Use `GET /api/tickets/categories/options` and `GET /api/tickets/tags/options` for lightweight selector data.
4. Operational users (`owner|admin|agent|viewer`) can read active dictionaries.
5. Category/tag activation state is managed explicitly through activate/deactivate endpoints.

### Flow G: Tickets Core

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

## 9) Mailboxes Endpoints Reference (Mailbox v1)

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
  "signatureHtml": "<p>Thanks</p>"
}
```

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
    "isDefault": false,
    "isActive": true
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
  - `409` `errors.mailbox.emailAlreadyUsed`
- Notes:
  - Creation does not auto-delete or replace existing mailboxes.
  - Exactly-one-default invariant remains enforced.

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
  - If `type` is sent, it must be `email`.
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
    "isDefault": false,
    "isActive": true
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `403` `errors.auth.forbiddenTenant`
  - `404` `errors.mailbox.notFound`
  - `409` `errors.mailbox.emailAlreadyUsed`
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
    "workspaceId": "65aa...",
    "name": "Billing Queue",
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

## 10) Mailbox Backfill Command

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

## 11) Tickets Endpoints Reference

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
- Ticket participants are internal-only metadata (`watcher|collaborator`) and do not grant or revoke access.
- `owner|admin` can assign any operational member (`owner|admin|agent`).
- `agent` self-assignment uses `POST /api/tickets/:id/self-assign` only and is limited to unassigned tickets or tickets they already own.
- Closed tickets accept `internal_note` only until they are reopened explicitly.
- Explicit lifecycle actions control `solved`, `closed`, and `reopen` transitions and keep `statusChangedAt`, `closedAt`, and live resolution markers consistent.

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
  - role must be `owner|admin`
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
    }
  }
}
```

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
  - `status` optional enum
  - `priority` optional enum
  - `mailboxId`, `assigneeId`, `categoryId`, `tagId`, `contactId`, `organizationId` optional mongo ids
  - `unassigned` optional boolean
  - `channel` optional enum
  - `includeClosed` optional boolean
  - `createdFrom`, `createdTo`, `updatedFrom`, `updatedTo` optional ISO8601 timestamps
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
    "subject": "Updated billing issue subject",
    "priority": "urgent",
    "mailboxId": "65f2...",
    "categoryId": "65f4...",
    "tagIds": ["65f5..."]
  }
}
```

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
      "workspaceId": "65aa...",
      "conversationId": "65f7...",
      "ticketId": "65f0...",
      "mailboxId": "65f2...",
      "channel": "manual",
      "type": "internal_note",
      "direction": null,
      "bodyText": "Customer already called support.",
      "attachmentFileIds": ["65f9..."],
      "attachments": [
        {
          "_id": "65f9...",
          "url": "/api/files/65f9.../download",
          "originalName": "call-log.txt",
          "mimeType": "text/plain",
          "sizeBytes": 124
        }
      ],
      "createdByUserId": "65fa...",
      "createdBy": {
        "_id": "65fa...",
        "email": "agent@example.com",
        "name": "Support Agent",
        "avatar": null,
        "status": "active"
      },
      "createdAt": "2026-03-13T11:00:00.000Z",
      "updatedAt": "2026-03-13T11:00:00.000Z"
    }
  ]
}
```

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
    "ticketId": "65f0...",
    "conversationId": "65f7...",
    "type": "public_reply",
    "direction": "outbound",
    "bodyText": "We have applied the fix and are waiting for your confirmation.",
    "attachmentFileIds": ["65f9..."],
    "attachments": [
      {
        "_id": "65f9...",
        "url": "/api/files/65f9.../download",
        "originalName": "resolution.txt",
        "mimeType": "text/plain",
        "sizeBytes": 124
      }
    ]
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
      "firstResponseAt": "2026-03-13T12:10:00.000Z",
      "resolvedAt": null
    }
  }
}
```

- Common errors:
  - `422` `errors.validation.failed`
  - `404` `errors.ticket.notFound | errors.file.notFound`
  - `409` `errors.ticket.closedMessageNotAllowed | errors.ticket.attachmentAlreadyLinked`
  - `403` `errors.auth.forbiddenRole`
- Anti-enumeration note:
  - ticket and file ids are resolved only inside the active workspace.
  - missing or cross-workspace refs collapse to workspace-scoped `404` responses.
- Notes:
  - `public_reply` moves the ticket to `waiting_on_customer`.
  - `customer_message` reopens a solved ticket and sets status to `open`.
  - `internal_note` does not change ticket status.

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
    "assignedAt": null
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
    "statusChangedAt": "2026-03-13T12:20:00.000Z"
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
    "statusChangedAt": "2026-03-13T12:30:00.000Z"
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
      "workspaceId": "65aa...",
      "ticketId": "65f0...",
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
    "ticketId": "65f0...",
    "userId": "65fa...",
    "type": "collaborator"
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
