# API Reference (MVP Auth + Workspace Invites)

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

- Access tokens are workspace-scoped in MVP.
- Token claims frontend may care about:
  - `wid`: workspace id used for current access token scope.
  - `r`: role key in that workspace scope.
- Backend uses these claims for authorization enforcement.
- Frontend should treat tokens as opaque and use `GET /api/auth/me` as the canonical source for:
  - current `workspace._id`
  - current `roleKey`
- Token claims may become stale if membership changes; fresh claims are issued on verify-email, login, or refresh.
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

### Flow C: Invite Accept (verified vs unverified) -> Verify Email with inviteToken
1. Workspace owner/admin creates invite via `POST /api/workspaces/:workspaceId/invites`.
2. Invitee opens link and calls `POST /api/workspaces/invites/accept` with `token` + `email` (and `password` if creating a new user).
3. If invitee is already verified:
  - API returns `success.invite.accepted`.
  - membership is activated immediately.
4. If invitee is new/unverified:
  - API returns `success.invite.acceptRequiresVerification`.
  - verify-email OTP is sent; invite stays pending.
5. Invitee then calls `POST /api/auth/verify-email` with `email`, `code`, and `inviteToken`.
6. API finalizes invite membership and issues auth tokens.
7. FE calls `GET /api/auth/me` to hydrate workspace and role.

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
  }
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
  - If user already has an active default workspace membership, workspace context is resolved from that membership.

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
  "workspace": { "_id": "65f1..." },
  "roleKey": "owner"
}
```
- Common errors:
  - `401` `errors.auth.invalidToken | errors.auth.sessionRevoked`
  - `403` `errors.auth.userSuspended | errors.auth.forbiddenTenant`
- Notes:
  - FE should treat this endpoint as the canonical source for current workspace and role.

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

## 5) Workspace Invite Endpoints Reference

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
  "message": "Invitation accepted successfully."
}
```
- Success `200` (new/unverified user):
```json
{
  "messageKey": "success.invite.acceptRequiresVerification",
  "message": "Verification is required to complete invitation acceptance."
}
```
- Common errors:
  - `422` `errors.validation.failed` (includes password-required case with `errors.auth.passwordRequiredForInvite`)
  - `403` `errors.auth.userSuspended`
  - `400` `errors.invite.invalid | errors.invite.expired | errors.invite.revoked | errors.invite.emailMismatch`
  - `429` `errors.otp.resendTooSoon | errors.otp.rateLimited`
- Notes:
  - This endpoint does not return auth tokens.
  - For unverified invitees, finalization happens only after `POST /api/auth/verify-email` with `inviteToken`.
  - Frontend next steps:
    - If `success.invite.accepted`: redirect user to login screen (or perform login if auto-login is implemented in future).
    - If `success.invite.acceptRequiresVerification`: show OTP verification UI and call `POST /api/auth/verify-email` with `inviteToken` to finalize membership and receive tokens.

## 6) Common FE Error Handling Guidance

- `errors.auth.invalidToken` or `errors.auth.sessionRevoked`: clear tokens and force logout.
- `errors.auth.forbiddenTenant`: show "no access to this workspace" without necessarily logging user out.
- `errors.otp.rateLimited` or `errors.otp.resendTooSoon`: show cooldown timer before allowing resend.
