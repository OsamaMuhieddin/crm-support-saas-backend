# Auth and Workspace Access Use Case Diagram Notes

## Scope

This diagram documents authentication, session handling, active workspace context, explicit workspace switching, and workspace invite behavior for Masar - CRM Support SaaS.

## Actors Included

- Visitor / Unauthenticated User: starts signup, OTP, login, password reset, and email verification flows.
- Invited User: accepts an invite token and may need email verification before the invite can be finalized.
- Workspace Member: uses protected session, profile, current-context, and workspace-context endpoints.
- Workspace Manager (Owner/Admin): abstract actor used to keep invite-management associations readable.
- Workspace Owner: concrete role that specializes Workspace Manager.
- Workspace Admin: concrete role that specializes Workspace Manager.
- Email Provider (Hostinger SMTP): secondary actor for OTP and invite email delivery.

## Actors Intentionally Omitted

- System / Scheduler is omitted because no implemented auth/workspace scheduled use case is exposed for this domain diagram.
- MongoDB, JWT libraries, Express, Redis, queues, workers, and Nodemailer internals are infrastructure, not use case actors.

## Use Cases Included

- Sign Up
- Send Email Verification OTP
- Resend OTP
- Verify Email
- Log In
- Refresh Access Token
- View Current User Context
- Update Profile
- Change Password
- Request Password Reset OTP
- Reset Password
- Log Out Current Session
- Log Out All Sessions
- List My Workspaces
- Switch Active Workspace
- Create Workspace Invite
- List Workspace Invites
- View Workspace Invite
- Resend Workspace Invite
- Revoke Workspace Invite
- Accept Workspace Invite

## Important Auth and Workspace Rules

- Auth is session-backed. Access tokens include user, session, workspace, and role context.
- `GET /api/auth/me` is the canonical current-context view for the authenticated user, active workspace, and `roleKey`.
- `POST /api/auth/refresh` rotates the refresh token and returns a fresh workspace-scoped token for the session workspace.
- `POST /api/auth/logout` revokes the current session.
- `POST /api/auth/logout-all`, password reset, and password change revoke user sessions.
- Signup creates or reuses an unverified user and sends an email verification OTP.
- Email verification creates a session. If the user has no workspace, verification provisions a default owner workspace.
- Login is blocked until email verification is complete.

## Invite and Workspace Switching Rules

- Invite management endpoints are limited to owner/admin role keys in the active workspace.
- Invite management is workspace-scoped; the `workspaceId` path parameter must match the active workspace in the token.
- Creating and resending invites sends an invite email through the configured SMTP email provider.
- Accepting an invite for an unverified/new user creates the user when needed, sends a verification OTP, and leaves the invite pending until verification finalization.
- Accepting an invite for a verified user creates or activates the membership and marks the invite accepted.
- Verifying email with an `inviteToken` can finalize invite acceptance, but it still does not automatically switch an existing active workspace session.
- Only `POST /api/workspaces/switch` changes active workspace context for the current session.
- Workspace switching returns a fresh access token. Existing access tokens for that session become stale because the session workspace changed.

## Grouping Decisions

- Owner and admin are shown as separate concrete actors, but their invite-management use cases are associated through the abstract Workspace Manager actor to avoid duplicate lines.
- Session flows are kept separate because refresh, logout-current, logout-all, password reset, and password change have materially different session effects.
- OTP email sending is shown as a supporting use case because signup, resend, invite acceptance for unverified users, and password reset all rely on email delivery.

## Source Areas Inspected

- `src/modules/auth/routes/auth.routes.js`
- `src/modules/auth/controllers/auth.controller.js`
- `src/modules/auth/services/auth.service.js`
- `src/modules/auth/services/session.service.js`
- `src/modules/auth/services/otp.service.js`
- `src/modules/auth/docs/openapi.js`
- `src/modules/auth/validators/auth.validators.js`
- `src/modules/workspaces/routes/workspaces.routes.js`
- `src/modules/workspaces/controllers/workspaces.controller.js`
- `src/modules/workspaces/services/workspaces.service.js`
- `src/modules/workspaces/docs/openapi.js`
- `src/modules/workspaces/validators/workspaces.validators.js`
- `src/modules/users/models/session.model.js`
- `src/shared/services/email.service.js`
- `tests/auth.test.js`
- `tests/auth.resend-otp.service.test.js`
- `tests/otp.service.test.js`
- `tests/session.service.test.js`
- `tests/invites.test.js`
- `tests/workspaces.switch.test.js`
- `tests/workspaces.service.test.js`

## Visual Paradigm Import Notes

Native Visual Paradigm `.vpp` export cannot be produced without Visual Paradigm tooling. A best-effort UML XMI export is provided for import testing, but it may not preserve diagram layout.
