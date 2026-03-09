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
      "messageKey": "errors.validation.failed",
      "msg": "Localized message"
    }
  ]
}
```

- Validation failures use:
  - `status: 422`
  - `messageKey: errors.validation.failed`
  - array payload under `errors`

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
  - Sending `entityId` without `entityType` returns `422 errors.validation.failed`.

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
  - Unknown body fields are rejected with `422 errors.validation.failed`.
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
