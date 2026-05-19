# Signup, Email Verification, and Workspace Bootstrap

## Purpose

This sequence diagram documents the implemented signup-to-session flow: user signup, verify-email OTP creation, email verification, normal workspace bootstrap, optional invite-token finalization, and session/access/refresh token creation.

The diagram follows the compact style from Diagrams 01 and 02: phase-numbered sections, grouped participants, one product-significant branch, and routine errors documented here instead of drawn as nested `alt` blocks.

## Implementation Status

Implemented.

## Source Files Inspected

- `src/modules/auth/routes/auth.routes.js`
- `src/modules/auth/controllers/auth.controller.js`
- `src/modules/auth/services/auth.service.js`
- `src/modules/auth/services/otp.service.js`
- `src/modules/auth/services/session.service.js`
- `src/modules/auth/services/token.service.js`
- `src/modules/users/models/user.model.js`
- `src/modules/users/models/session.model.js`
- `src/modules/users/models/otp-code.model.js`
- `src/modules/auth/validators/auth.validators.js`
- `src/modules/workspaces/services/workspaces.service.js`
- `src/modules/workspaces/models/workspace.model.js`
- `src/modules/workspaces/models/workspace-member.model.js`
- `src/modules/workspaces/models/workspace-invite.model.js`
- `src/modules/mailboxes/services/mailboxes.service.js`
- `src/modules/mailboxes/models/mailbox.model.js`
- `src/modules/billing/services/billing-foundation.service.js`
- `src/shared/services/email.service.js`
- `tests/auth.test.js`
- `tests/invites.test.js`
- `docs/api.md`

Note: the requested auth model paths are implemented under `src/modules/users/models` in this repository:

- `src/modules/users/models/user.model.js`
- `src/modules/users/models/session.model.js`
- `src/modules/users/models/otp-code.model.js`

Also, the invite test file is `tests/invites.test.js`, not `tests/workspace-invites.test.js`.

## Participants Included

- New User
- Signup UI
- Routes + Validation
- Auth Controller
- Auth Service
- OTP + Email
- User/OTP models
- Workspace Service
- Workspace/Membership/Mailbox/Billing models
- Session Service
- Session model

## Participants Intentionally Excluded

- MongoDB, Mongoose internals, indexes, and JWT internals are not shown as actors.
- The external email provider is not shown; the implementation uses the app-level `sendOtpEmailFireAndForget` helper.
- Realtime session disconnect logic is excluded because this diagram creates a new auth session; session revocation flows are separate.
- Full invite acceptance is excluded because it belongs to the dedicated invite diagram. This diagram only shows the `verify-email` finalization branch when `inviteToken` is supplied.

## Main Success Path

1. User submits `POST /api/auth/signup`.
2. Backend validates email, password, and optional name.
3. Auth service creates a new unverified user or reuses an existing unverified user.
4. Auth service creates a `verifyEmail` OTP with hashed code and expiry.
5. Email is sent fire-and-forget.
6. Signup returns success without issuing tokens.
7. User submits `POST /api/auth/verify-email` with email and OTP code.
8. OTP service verifies and consumes the latest valid OTP.
9. Auth service marks the user email as verified.
10. Workspace service ensures workspace context.
11. Normal signup creates an owner workspace, active owner membership, default mailbox, and best-effort initial billing foundation.
12. Invite-token verification finalizes invite membership and marks the invite accepted; it bootstraps a default workspace only if the user has none.
13. Session service creates a session with active workspace context and stores only the refresh token hash.
14. API returns user, access token, refresh token, `workspaceId`, `activeWorkspaceId`, and optional `inviteWorkspaceId`.

## Important Alternate And Error Paths

- Validation failures return `422 errors.validation.failed`.
- Signup with an already verified email returns `409 errors.auth.emailAlreadyUsed`.
- Signup with an existing unverified user returns success and reissues a verify-email OTP.
- OTP creation can return resend/rate-limit errors such as `errors.otp.resendTooSoon` or `errors.otp.rateLimited`.
- Invalid or expired OTP returns `422 errors.validation.failed` with the OTP-specific error in `errors[]`.
- Too many OTP attempts returns `429 errors.otp.tooManyAttempts`.
- Suspended users are blocked with `403 errors.auth.userSuspended`.
- Invite token finalization can fail with `errors.invite.invalid`, `errors.invite.expired`, `errors.invite.revoked`, or `errors.invite.emailMismatch`.
- Invite finalization does not auto-switch an existing session into the invited workspace. Tokens are minted for the active workspace context resolved by the session/workspace rules.
- If `inviteWorkspaceId` differs from `activeWorkspaceId`, the frontend must call `POST /api/workspaces/switch` later.
- Initial billing foundation creation is best-effort during workspace bootstrap; errors are logged and do not block verification.

## Rendering Command Notes

The source diagram is PlantUML. Rendered PNG and SVG are generated directly from the `.puml` file.

PDF export uses a local HTML wrapper around the SVG and headless Edge with headers/footers disabled so the output remains one page and does not show date, time, URL, or source path.

## Remaining Uncertainties

- None for the implemented signup, verification, workspace bootstrap, invite-finalization, and session-token creation paths.
