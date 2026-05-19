# Diagram 05 - Invite Teammate and Accept Invite

## Purpose and Importance

This diagram documents the implemented workspace invite flow. It is onboarding-critical, security/tenancy-critical, and billing-relevant because pending invites reserve seats and invite finalization must not silently change the active workspace session.

## Implementation Status

Implemented.

## Source Files Inspected

- `src/modules/workspaces/routes/workspaces.routes.js`
- `src/modules/workspaces/controllers/workspaces.controller.js`
- `src/modules/workspaces/services/workspaces.service.js`
- `src/modules/workspaces/validators/workspaces.validators.js`
- `src/modules/workspaces/models/workspace.model.js`
- `src/modules/workspaces/models/workspace-member.model.js`
- `src/modules/workspaces/models/workspace-invite.model.js`
- `src/modules/auth/routes/auth.routes.js`
- `src/modules/auth/controllers/auth.controller.js`
- `src/modules/auth/services/auth.service.js`
- `src/modules/auth/services/session.service.js`
- `src/modules/auth/validators/auth.validators.js`
- `src/modules/users/models/user.model.js`
- `src/modules/users/models/session.model.js`
- `src/shared/middlewares/requireAuth.js`
- `src/shared/middlewares/requireActiveUser.js`
- `src/shared/middlewares/requireActiveMember.js`
- `src/shared/middlewares/requireWorkspaceRole.js`
- `src/shared/services/email.service.js`
- `src/modules/billing/services/billing-enforcement.service.js`
- `tests/invites.test.js`
- `tests/billing.test.js`
- `docs/api.md`

`tests/workspace-invites.test.js` was requested but is not present in this repository.

## Participants Included

- Workspace Owner/Admin
- Invitee
- App UI
- Invite UI
- Routes + Validation
- Auth + Workspace Guards
- Workspace Controller
- Workspace Service
- Auth Service
- Email/OTP Service
- Domain Models
- Billing Enforcement

## Participants Intentionally Excluded

- SMTP provider details are excluded; the implementation uses `email.service.js`, which either sends through nodemailer or logs fallback email in non-production.
- MongoDB/Mongoose internals are excluded. Model participants represent the app-level persistence layer.

## Main Success Path

1. Owner/admin creates an invite for the active workspace.
2. Route guards enforce authentication, active user/member, and owner/admin role.
3. Workspace service checks workspace, existing user/member, and billing seat reservation.
4. A pending invite with a hashed token is stored and an invite link is sent.
5. Invitee accepts with token and email.
6. Verified invitees get an active membership immediately and the invite becomes accepted.
7. New or unverified invitees receive an OTP, then `POST /api/auth/verify-email` with `inviteToken` finalizes membership and creates tokens.

## Important Alternate and Error Paths

- Validation errors return `422` with `errors.validation.failed`.
- Unauthorized invite management returns auth/role error envelope responses.
- Expired, revoked, already accepted, unknown, or email-mismatched tokens return invite errors.
- Existing active/suspended membership blocks duplicate invite creation.
- Seat capacity can block invite creation or member activation through billing enforcement.
- Invite acceptance and verification do not auto-switch the active workspace session. The client must call `POST /api/workspaces/switch`.

## Rendering Command Notes

Rendered from PlantUML source to PNG and SVG. PDF is rendered from the SVG through a local HTML wrapper with browser headers and footers disabled.

## Remaining Uncertainties

None. The only missing requested artifact is `tests/workspace-invites.test.js`, which does not exist.
