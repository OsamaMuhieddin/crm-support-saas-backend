# API Conventions

## Base URL
- `/api`

## Relevant environment variables
- `APP_BASE_URL` (backend base URL, used for backend runtime context)
- `FRONTEND_BASE_URL` (used to generate invite-accept links in invitation emails)

## Localization
- Header: `x-lang: en|ar` (default `en`)
- Success responses and errors are localized by `messageKey`.

## Async email behavior
- OTP emails are sent asynchronously (fire-and-forget).
- Invite create/resend awaits provider submission (still not a guaranteed inbox delivery).

## Response envelopes
- Success object (`< 400`):
  - `messageKey` (defaults to `success.ok`)
  - `message` (localized)
- Error:
  - `{ status, messageKey, message, errors }`
- Validation failure:
  - `422` + `errors.validation.failed`

## Auth endpoints

### `POST /api/auth/signup`
Body:
```json
{ "email": "user@example.com", "password": "Password123!", "name": "User" }
```
Response:
```json
{ "messageKey": "success.auth.otpSent", "message": "..." }
```

### `POST /api/auth/resend-otp`
Body:
```json
{ "email": "user@example.com", "purpose": "verifyEmail" }
```
Response:
```json
{ "messageKey": "success.auth.otpResent", "message": "..." }
```
Eligibility rules (response remains generic for anti-enumeration):
- `resetPassword`: OTP is actually created/sent only when user exists, is verified, active, and not deleted.
- `verifyEmail`: OTP is actually created/sent only when user exists, is unverified, active, and not deleted.
- Other purposes are treated as no-op success in MVP.

### `POST /api/auth/verify-email`
Body:
```json
{ "email": "user@example.com", "code": "123456", "inviteToken": "optional" }
```
Response:
```json
{
  "messageKey": "success.auth.verified",
  "user": { "_id": "...", "email": "user@example.com", "defaultWorkspaceId": "..." },
  "tokens": { "accessToken": "...", "refreshToken": "..." }
}
```
Note: this endpoint verifies email and issues auth tokens directly (no extra `/auth/login` call required after successful verification).

### `POST /api/auth/login`
Body:
```json
{ "email": "user@example.com", "password": "Password123!" }
```

### `POST /api/auth/refresh`
Body:
```json
{ "refreshToken": "..." }
```

### `POST /api/auth/forgot-password`
Body:
```json
{ "email": "user@example.com" }
```

### `POST /api/auth/reset-password`
Body:
```json
{ "email": "user@example.com", "code": "123456", "newPassword": "NewPassword456!" }
```

### `GET /api/auth/me` (protected)
Returns current user + active workspace context.
Requires a valid non-revoked token and an active (non-suspended) user account.

### `POST /api/auth/logout` (protected)
Revokes current session.
Requires an active (non-suspended) user account.

### `POST /api/auth/logout-all` (protected)
Revokes all sessions for current user.
Requires an active (non-suspended) user account.

### `POST /api/auth/change-password` (protected)
Body:
```json
{ "currentPassword": "Password123!", "newPassword": "NewPassword456!" }
```
Note: current implementation revokes all sessions after password change.
Requires an active (non-suspended) user account.

## Workspace invite endpoints
All workspace-scoped endpoints require:
- `Authorization: Bearer <accessToken>`
- token tenant `wid` matching `:workspaceId`
- active (non-suspended) user account
- active workspace membership
- role `owner` or `admin`

### `POST /api/workspaces/:workspaceId/invites`
Body:
```json
{ "email": "agent@example.com", "roleKey": "agent" }
```
Possible conflict errors:
- `errors.invite.alreadyPending` when a pending invite already exists.
- `errors.invite.alreadyMember` when email belongs to an existing non-removed member in that workspace.

Invite links in emails use `FRONTEND_BASE_URL`:
- `${FRONTEND_BASE_URL}/workspaces/invites/accept?token=...`
Response:
```json
{
  "messageKey": "success.invite.created",
  "invite": {
    "_id": "...",
    "email": "agent@example.com",
    "roleKey": "agent",
    "status": "pending",
    "expiresAt": "..."
  }
}
```

### `GET /api/workspaces/:workspaceId/invites`
Optional query:
- `status`
- `page` (default `1`)
- `limit` (default `10`, max `100`)

Response shape:
```json
{
  "messageKey": "success.ok",
  "page": 1,
  "limit": 10,
  "total": 25,
  "results": 10,
  "invites": []
}
```

### `GET /api/workspaces/:workspaceId/invites/:inviteId`

### `POST /api/workspaces/:workspaceId/invites/:inviteId/resend`
Response: `success.invite.resent`

### `POST /api/workspaces/:workspaceId/invites/:inviteId/revoke`
Response: `success.invite.revoked`

### `POST /api/workspaces/invites/accept`
Body:
```json
{ "token": "raw-invite-token", "email": "invitee@example.com", "password": "optional", "name": "optional" }
```
Responses:
- Verified user: `success.invite.accepted`
- New/unverified user: `success.invite.acceptRequiresVerification`

## Invite finalization flow
1. Workspace owner/admin creates invite.
2. Invitee calls `POST /api/workspaces/invites/accept`.
3. If invitee is not verified, backend sends verify-email OTP and returns `success.invite.acceptRequiresVerification`.
4. Invitee completes `POST /api/auth/verify-email` with `inviteToken`.
5. Backend finalizes membership + marks invite accepted + issues auth tokens.
