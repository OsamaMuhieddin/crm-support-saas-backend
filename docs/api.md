# API Reference (MVP Auth + Workspace Invites)

## Base URL
- `/api`

## Headers
- `x-lang: en|ar` (optional, default `en`)
- `Authorization: Bearer <accessToken>` (required on protected endpoints)
- `Content-Type: application/json`

## Response envelope
- Success (`< 400`):
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

## Environment notes
- `FRONTEND_BASE_URL` is used to build invite links in email:
  - `${FRONTEND_BASE_URL}/workspaces/invites/accept?token=...`
- `APP_BASE_URL` remains backend runtime base URL.

## Enums used by requests
- `purpose`: `verifyEmail | login | resetPassword | changeEmail`
- `roleKey`: `owner | admin | agent | viewer`
- `invite status` (query): `pending | accepted | revoked | expired`

---

## Auth

### POST `/api/auth/signup`
Creates a new unverified user or reuses existing unverified user, then sends verify-email OTP.

Request body:
```json
{
  "email": "user@example.com",
  "password": "Password123!",
  "name": "Optional Name"
}
```
- `email` required, valid email, max 320 chars
- `password` required, 8..128 chars
- `name` optional, 1..160 chars

Success `200`:
```json
{
  "messageKey": "success.auth.otpSent",
  "message": "Verification code sent successfully."
}
```

### POST `/api/auth/resend-otp`
Always returns generic success (anti-enumeration).

Request body:
```json
{
  "email": "user@example.com",
  "purpose": "verifyEmail"
}
```
- `email` required
- `purpose` required, one of enum values above

Eligibility (server-side, response still success):
- `resetPassword`: actually sends only if user exists + verified + active + not deleted
- `verifyEmail`: actually sends only if user exists + unverified + active + not deleted
- other purposes in MVP: no-op success

Success `200`:
```json
{
  "messageKey": "success.auth.otpResent",
  "message": "Verification code resent successfully."
}
```

### POST `/api/auth/verify-email`
Verifies OTP and logs user in (issues tokens directly).

Request body:
```json
{
  "email": "user@example.com",
  "code": "123456",
  "inviteToken": "optional-invite-token"
}
```
- `email` required
- `code` required, digits (4..8)
- `inviteToken` optional, 10..512 chars

Success `200`:
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
  }
}
```

### POST `/api/auth/login`
Request body:
```json
{
  "email": "user@example.com",
  "password": "Password123!"
}
```

Success `200`:
```json
{
  "messageKey": "success.auth.loggedIn",
  "message": "Logged in successfully.",
  "user": { "_id": "65f0...", "email": "user@example.com" },
  "tokens": { "accessToken": "jwt...", "refreshToken": "jwt..." }
}
```

### POST `/api/auth/refresh`
Request body:
```json
{
  "refreshToken": "jwt..."
}
```

Success `200`:
```json
{
  "messageKey": "success.auth.refreshed",
  "message": "Session refreshed successfully.",
  "tokens": { "accessToken": "jwt...", "refreshToken": "jwt..." }
}
```

### POST `/api/auth/forgot-password`
Always generic success (anti-enumeration).

Request body:
```json
{
  "email": "user@example.com"
}
```

Success `200`:
```json
{
  "messageKey": "success.auth.resetOtpSent",
  "message": "Password reset code sent if the account exists."
}
```

### POST `/api/auth/reset-password`
Request body:
```json
{
  "email": "user@example.com",
  "code": "123456",
  "newPassword": "NewPassword456!"
}
```

Success `200`:
```json
{
  "messageKey": "success.auth.passwordReset",
  "message": "Password reset successfully."
}
```

### GET `/api/auth/me` (protected)
Headers:
- `Authorization: Bearer <accessToken>`

Success `200`:
```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "user": { "_id": "65f0...", "email": "user@example.com" },
  "workspace": { "_id": "65f1..." },
  "roleKey": "owner"
}
```

### POST `/api/auth/logout` (protected)
Headers:
- `Authorization: Bearer <accessToken>`

Request body:
```json
{}
```

Success `200`:
```json
{
  "messageKey": "success.auth.loggedOut",
  "message": "Logged out successfully."
}
```

### POST `/api/auth/logout-all` (protected)
Headers:
- `Authorization: Bearer <accessToken>`

Request body:
```json
{}
```
Body is not required by the backend; frontend may send empty object.

Success `200`:
```json
{
  "messageKey": "success.auth.loggedOutAll",
  "message": "Logged out from all sessions successfully."
}
```

### POST `/api/auth/change-password` (protected)
Headers:
- `Authorization: Bearer <accessToken>`

Request body:
```json
{
  "currentPassword": "Password123!",
  "newPassword": "NewPassword456!"
}
```
- both required, 8..128 chars
- must be different

Success `200`:
```json
{
  "messageKey": "success.auth.passwordChanged",
  "message": "Password changed successfully."
}
```

---

## Workspace invites

### Protection rules for workspace-scoped invite routes
These routes require:
- valid access token
- active user account
- active membership in `req.auth.workspaceId`
- role `owner` or `admin`
- tenant match: `:workspaceId` must equal token workspace (`wid`)

### POST `/api/workspaces/:workspaceId/invites` (protected)
Request body:
```json
{
  "email": "agent@example.com",
  "roleKey": "agent"
}
```

Success `200`:
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

Common `409` errors:
- `errors.invite.alreadyPending`
- `errors.invite.alreadyMember` (email already has non-removed membership in same workspace)

### GET `/api/workspaces/:workspaceId/invites` (protected)
Query params:
- `status` optional (`pending|accepted|revoked|expired`)
- `page` optional (min 1, default 1)
- `limit` optional (1..100, default 10)

Success `200`:
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

### GET `/api/workspaces/:workspaceId/invites/:inviteId` (protected)
Success `200`:
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

### POST `/api/workspaces/:workspaceId/invites/:inviteId/resend` (protected)
Request body:
```json
{}
```

Success `200`:
```json
{
  "messageKey": "success.invite.resent",
  "message": "Invitation resent successfully."
}
```

### POST `/api/workspaces/:workspaceId/invites/:inviteId/revoke` (protected)
Request body:
```json
{}
```

Success `200`:
```json
{
  "messageKey": "success.invite.revoked",
  "message": "Invitation revoked successfully."
}
```

### POST `/api/workspaces/invites/accept`
Public-ish endpoint (no auth header required).

Request body:
```json
{
  "token": "raw-invite-token",
  "email": "invitee@example.com",
  "password": "OptionalIfUserAlreadyExists",
  "name": "Optional Name"
}
```
- `token` required, 16..512 chars
- `email` required
- `password` optional by validator, but required when invitee user does not exist yet
- `name` optional

Success `200` (verified user):
```json
{
  "messageKey": "success.invite.accepted",
  "message": "Invitation accepted successfully."
}
```

Success `200` (new/unverified user):
```json
{
  "messageKey": "success.invite.acceptRequiresVerification",
  "message": "Verification is required to complete invitation acceptance."
}
```

---

## Invite finalization flow
1. Owner/admin creates invite.
2. Invitee calls `POST /api/workspaces/invites/accept`.
3. If invitee is unverified, backend sends verify-email OTP.
4. Invitee calls `POST /api/auth/verify-email` with `inviteToken`.
5. Backend finalizes membership and returns auth tokens.
