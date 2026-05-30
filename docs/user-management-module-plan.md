# Workspace Member Management And User Management Plan

## Purpose

This is the source-of-truth implementation plan for the Workspace Member Management / User Management module. It covers the backend API surface needed for workspace member administration, ticket assignment pickers, ticket participant pickers, invite duplicate warnings, and future member autocomplete flows.

This plan is the implementation tracker. Prompt 1 read endpoints, Prompt 2 member-management actions, and Prompt 3 connected hardening items are implemented; frontend/user-facing phases remain pending.

## Current State

The backend already has:

- auth, sessions, access/refresh tokens, and `GET /api/auth/me`
- user self-profile update through `PATCH /api/auth/profile`
- workspace memberships and active workspace context
- workspace switching through `POST /api/workspaces/switch`
- workspace invites with create/list/get/resend/revoke/accept flows
- ticket assignment, self-assignment, and unassignment
- ticket participants with `watcher|collaborator`
- realtime session and ticket collaboration foundations
- billing seat and entitlement foundations
- reports and platform admin surfaces

The current `GET /api/users` route is still a placeholder/stub and must not become the main workspace-user search surface.

Workspace member management must be workspace-scoped. Keep global `src/modules/users` focused on user identity, self-profile, and platform-level identity concerns. Put member management under `src/modules/workspaces`.

## Locked Recommendation

Build one canonical workspace-scoped member surface:

`/api/workspaces/:workspaceId/members`

Do not add:

- global `/api/users/search`
- duplicated `/api/tickets/assignees/search`
- duplicated `/api/tickets/participants/search`

Ticket assignment, participant selection, invite duplicate warnings, future mentions, and member management should all reuse the workspace member APIs with filters such as `assignable=true` and `participantEligible=true`.

Tenant match is mandatory for every endpoint: `:workspaceId` must equal the workspace id in the current token/session context.

## Endpoint Surface

### GET `/api/workspaces/:workspaceId/members`

Purpose: full workspace member list and search.

Query parameters:

- `page`
- `limit`
- `q`
- `search`
- `roleKey=owner|admin|agent|viewer`
- `status=active|suspended|removed`
- `assignable=true|false`
- `participantEligible=true|false`
- `includeRemoved=true|false`
- `sort=name|-name|email|-email|createdAt|-createdAt|joinedAt|-joinedAt`

Rules:

- `q` and `search` are aliases.
- `includeRemoved=true` is `owner|admin` only.
- `status=suspended|removed` is `owner|admin` only.
- Non-admin roles must never receive suspended or removed members.
- `owner|admin` may list active, suspended, and removed members when requested.
- `agent` may list active members only.
- `viewer` may list active members only with minimal safe profile data and no email.

Success shape:

```json
{
  "messageKey": "success.ok",
  "message": "OK",
  "page": 1,
  "limit": 20,
  "total": 1,
  "results": 1,
  "members": []
}
```

### GET `/api/workspaces/:workspaceId/members/options`

Purpose: compact selector/autocomplete endpoint.

Use cases:

- ticket assignment picker
- ticket participant picker
- invite duplicate warning
- future mentions/autocomplete

Rules:

- share useful filters with the full list endpoint
- return compact member summaries only
- enforce the same tenant, role, status, and visibility rules as the full list endpoint

Recommended query parameters:

- `q`
- `search`
- `roleKey`
- `status`
- `assignable`
- `participantEligible`
- `includeRemoved`
- `limit`
- `sort`

### GET `/api/workspaces/:workspaceId/members/:userId`

Purpose: member detail endpoint for drawer/detail screens and direct member resolution.

Rules:

- tenant match is mandatory
- `owner|admin` can retrieve active, suspended, and removed members.
- `agent|viewer` can retrieve active members only.
- `viewer` response omits email.
- non-admin access to suspended/removed members must return the same safe denial style used elsewhere, preferably `404` or the existing anti-enumeration behavior.

### PATCH `/api/workspaces/:workspaceId/members/:userId`

Purpose: change role only for this phase.

Body:

```json
{
  "roleKey": "owner"
}
```

Allowed `roleKey` values:

- `owner`
- `admin`
- `agent`
- `viewer`

Rules:

- `owner` can manage all roles, including other owners, as long as the action does not leave the workspace with zero active owners.
- `admin` can manage only `agent` and `viewer`.
- `admin` cannot invite, promote, demote, suspend, reactivate, or remove `owner` or another `admin`.
- last active owner cannot be demoted.
- no self role change.
- role changes must not auto-switch workspace.
- role changes must immediately affect active access through session/realtime invalidation.

### POST `/api/workspaces/:workspaceId/members/:userId/suspend`

Purpose: suspend an active member.

Rules:

- `owner` can suspend any role, including another owner, if at least one other active owner remains.
- `admin` can suspend only `agent` and `viewer`.
- `admin` cannot suspend `owner` or another `admin`.
- last active owner cannot be suspended.
- no self suspend.
- suspended members are not assignable.
- suspended members are not participant-eligible.
- suspended members do not pass active workspace membership checks.
- suspended members do not count toward active seats.
- suspend must immediately affect active access through session/realtime invalidation.

### POST `/api/workspaces/:workspaceId/members/:userId/activate`

Purpose: reactivate a suspended member only.

Rules:

- removed members must not be activated directly in this phase; they should be re-invited.
- `owner` can reactivate any suspended role.
- `admin` can reactivate only suspended `agent` and `viewer` members.
- `admin` cannot reactivate `owner` or another `admin`.
- reactivation must check billing seat capacity before activation.
- reactivation must immediately affect active access through session/realtime invalidation or require refresh/relogin as appropriate.

### POST `/api/workspaces/:workspaceId/members/:userId/remove`

Purpose: soft-remove a member from the workspace while preserving attribution and history.

Use action endpoint style instead of `DELETE` to match existing Masar action route conventions.

Rules:

- do not hard-delete workspace memberships in this phase.
- do not delete the global `User`.
- do not delete or rewrite tickets, messages, files, reports, or audit attribution created by the user.
- removed members should be restored through the re-invite flow in this phase.
- because `WorkspaceMember` has a unique `{ workspaceId, userId }` index, re-invite/acceptance for a removed member must reuse/reactivate the existing workspace membership record instead of creating a duplicate membership.
- do not add a direct "activate removed member" endpoint in this phase.
- `owner` can remove any role, including another owner, if at least one other active owner remains.
- `admin` can remove only `agent` and `viewer`.
- `admin` cannot remove `owner` or another `admin`.
- last active owner cannot be removed.
- no self remove.
- removed members are not assignable.
- removed members are not participant-eligible.
- removed members do not count toward active seats.
- remove must immediately affect active access through session/realtime invalidation.

Do not implement `POST /api/workspaces/:workspaceId/leave` in this phase.

## Invite Rules

Current invite creation already blocks active/suspended existing members and pending duplicate invites.

Final policy:

- only `owner` can invite `owner` or `admin`
- `admin` can invite only `agent` and `viewer`
- multiple owners are allowed
- removed members are restored by re-invite in this phase, not by direct activation
- because `WorkspaceMember` has a unique `{ workspaceId, userId }` index, removed-member re-invite acceptance must reuse/reactivate the existing membership record instead of creating a duplicate membership
- do not add a direct "activate removed member" endpoint in this phase

The member list/options endpoint should support invite UX by letting the frontend warn when an email appears to match an existing active/suspended/removed member, subject to role visibility rules.

Invite management is `owner|admin` only. Therefore duplicate warnings can use owner/admin member visibility rules. Non-admin users must not receive suspended/removed member visibility through member search/options.

## Filter Semantics

### `assignable=true`

Means:

- membership status is `active`
- user record is active and not deleted
- role is `owner|admin|agent`

This does not require a database migration. It is a query-time filter over existing membership and user fields.

### `participantEligible=true`

Means:

- membership status is `active`
- user record is active and not deleted
- user is eligible to be added as a ticket participant under the final participant policy

Final ticket participant policy:

- participants do not grant access
- workspace role still controls access
- viewers may be watchers only
- `collaborator` participant type should be restricted to `owner|admin|agent`

The ticket participant service now allows viewers as `watcher` only. `collaborator` writes require an active `owner|admin|agent` membership.

## Existing Tickets And Historical Attribution

Existing assigned tickets should remain assigned if a member is suspended or removed. Do not auto-unassign.

Rules:

- suspended/removed users are unavailable for new assignment
- existing ticket assignment is preserved for historical visibility
- ticket messages, files, reports, and audit attribution must remain intact
- later reporting/filtering can surface tickets assigned to inactive members

## Billing, Session, And Realtime Rules

Billing:

- active members count toward billing seats
- pending invites reserve seats if the current billing implementation already follows that rule
- suspended and removed members do not count toward active seats
- reactivating a suspended member must check billing seat capacity before activation

Session and realtime:

- role/status changes must immediately affect active access
- reuse existing session/realtime invalidation seams
- role/status changes should invalidate or revoke only the affected user's sessions for the affected workspace when possible
- do not revoke the affected user's sessions in other workspaces unless the current session model cannot safely target workspace-specific sessions
- best-effort disconnect realtime sockets for the affected workspace sessions
- affected users must refresh or relogin to receive updated role/access state
- because workspace access tokens carry the role claim `r`, role changes must make stale access tokens fail or require refresh/relogin before further protected workspace actions
- a demoted user must not keep old permissions until normal token expiry
- role changes must not auto-switch workspace

## Response Shapes

### Member Summary

Use compact member summaries:

```json
{
  "_id": "membershipId",
  "workspaceId": "workspaceId",
  "userId": "userId",
  "roleKey": "agent",
  "memberStatus": "active",
  "joinedAt": "2026-05-27T00:00:00.000Z",
  "removedAt": null,
  "user": {
    "_id": "userId",
    "email": "agent@example.com",
    "name": "Agent Name",
    "avatar": null,
    "status": "active"
  }
}
```

Notes:

- include `removedAt` only when relevant and visible
- `owner`, `admin`, and `agent` may see member email in list/options/detail responses
- `viewer` receives no email in member list/options/detail responses unless a future product requirement explicitly changes this
- suspended/removed member email is visible only to `owner|admin` when those statuses are visible
- prefer flattened `name` and `avatar` in the `user` summary instead of deeply nested `profile`, unless implementation conventions strongly require `profile`

### Action Response

Use compact action responses matching existing Masar action style:

```json
{
  "messageKey": "success.workspace.memberUpdated",
  "message": "Workspace member updated.",
  "member": {
    "userId": "userId",
    "roleKey": "agent",
    "memberStatus": "active"
  }
}
```

Action response rules:

- role-change responses must include final `roleKey`
- suspend/activate/remove responses must include final `memberStatus`
- remove responses may include `removedAt` when visible
- action responses remain compact and should not return the full user/member detail payload
- full detail belongs in the detail endpoint

## Implementation Placement

Preferred files:

- `src/modules/workspaces/routes/workspace-members.routes.js`
- `src/modules/workspaces/controllers/workspace-members.controller.js`
- `src/modules/workspaces/services/workspace-members.service.js`
- `src/modules/workspaces/validators/workspace-members.validators.js`

Wire these under the existing workspaces router/module.

Keep `src/modules/users` for identity/self-profile only. Do not turn `GET /api/users` into the workspace member search endpoint.

## Code Inspection Checklist

Before implementation, inspect:

- `src/modules/workspaces/models/workspace-member.model.js`
- `src/modules/workspaces/models/workspace-invite.model.js`
- `src/modules/workspaces/services/workspaces.service.js`
- `src/modules/workspaces/routes/workspaces.routes.js`
- `src/modules/users/models/user.model.js`
- `src/modules/users/routes/users.routes.js`
- `src/modules/users/services/users.service.js`
- `src/modules/tickets/services/tickets.service.js`
- `src/modules/tickets/services/ticket-participants.service.js`
- `src/modules/tickets/services/ticket-reference.service.js`
- `src/shared/middlewares/requireActiveMember.js`
- `src/shared/middlewares/requireWorkspaceRole.js`
- `src/constants/workspace-roles.js`
- `src/constants/member-status.js`
- billing entitlement/seat guard helpers
- session revocation/invalidation helpers
- realtime session disconnect helpers

Verify whether `WorkspaceMember` already has:

- `removedAt`
- `removedByUserId`
- `deletedAt`
- other audit fields

Current inspection notes:

- `WorkspaceMember` already has `removedAt`, `deletedAt`, and `deletedByUserId`.
- `WorkspaceMember` does not currently expose a distinct `removedByUserId`.
- `WorkspaceMember` already has a unique `{ workspaceId, userId }` index and separate `{ workspaceId, status }` and `{ workspaceId, roleKey }` indexes.
- Billing already exposes seat reservation helpers used by invites.
- Session and realtime disconnect helpers already exist and should be reused instead of adding a new invalidation system.

Do not add indexes blindly. First check current indexes. Add only if missing and justified:

- `workspaceId + status + roleKey`
- `workspaceId + userId`
- user normalized email/name search support if needed

## Testing Requirements

Add targeted tests for:

- list/search tenant isolation
- `q` and `search` aliases
- pagination
- sort allowlist
- role filters
- status filters
- `assignable=true`
- `participantEligible=true`
- owner/admin visibility of suspended/removed members
- agent/viewer active-only visibility
- owner/admin/agent email visibility
- viewer email omission
- owner can manage another owner only when another active owner remains
- last active owner cannot be demoted, suspended, or removed
- admin cannot manage owner/admin
- admin can manage agent/viewer
- admin cannot invite owner/admin
- owner can invite owner/admin
- no self role change
- no self suspend
- no self remove
- suspend removes assignment and participant eligibility but preserves historical assignment
- remove preserves user, ticket, message, and file attribution
- reactivate checks billing seat limit
- role/status changes invalidate affected sessions/realtime sockets
- docs/OpenAPI updated

## UI Surfaces Enabled

Estimated UI count: 6 primary surfaces plus shared selector/state components.

1. Workspace Members Page

- list/search members
- filter by role/status
- show active/suspended/removed state
- owner/admin management actions

2. Member Detail Drawer

- profile summary
- role
- membership status
- joined/removed dates
- management actions allowed by actor role

3. Invite Team Members Page

- pending invites
- create invite
- role selector with owner/admin restrictions
- duplicate member warning using members/options search

4. Ticket Assignment Picker

- fetch with `assignable=true`
- show only active `owner|admin|agent`

5. Ticket Participants Panel

- list existing watchers/collaborators with `GET /api/tickets/:id/participants`
- remove participants
- show that participants do not grant access

6. Add Ticket Participant Picker

- fetch with `participantEligible=true`
- allow viewers as watcher only
- restrict collaborator to `owner|admin|agent`

Shared components/states:

- member autocomplete
- permission-disabled states
- empty states for no agents/no members
- errors for last owner, already member, already invited, and billing seat limit

## Rollout Plan

### Phase 1

- list/search/options/detail foundation - implemented in Prompt 1
- assignment picker unblock with `assignable=true` - implemented in Prompt 1
- participant picker unblock with `participantEligible=true` - implemented in Prompt 1
- invite duplicate UX support - implemented in Prompt 1 through owner/admin-visible member search/options
- docs/OpenAPI updates for read endpoints - implemented in Prompt 1

### Phase 2

- role change - implemented in Prompt 2
- suspend - implemented in Prompt 2
- activate - implemented in Prompt 2
- remove - implemented in Prompt 2
- last-owner protection - implemented in Prompt 2 for role demotion, suspend, and remove
- admin authority limits - implemented in Prompt 2 for member management actions
- billing seat check - implemented in Prompt 2 for suspended-member activation
- session/realtime invalidation - implemented in Prompt 2 for changed affected workspace sessions
- invite role restrictions - implemented in Prompt 3
- removed-member re-invite behavior - implemented in Prompt 3
- participant collaborator restriction - implemented in Prompt 3
- assignment/participant eligibility alignment hardening - implemented in Prompt 3
- docs/OpenAPI updates for action endpoints - implemented in Prompt 2

### Phase 3

- frontend member page
- frontend member drawer
- frontend assignment picker
- frontend participant picker
- frontend invite warnings
- optional audit events later
- optional inactive-assignee reports later

## Implementation Notes

- Use express-validator validators inside the workspace module.
- Preserve standard success and error response envelopes.
- Validation failures must remain `422` with `errors.validation.failed`.
- Cross-workspace member lookups must collapse to forbidden tenant or not found according to existing workspace anti-enumeration patterns.
- Action endpoints should return compact action responses.
- Update `en.json` and `ar.json` together if new message keys are added; Arabic locale values must remain Arabic-only.
- Update API docs and OpenAPI paths when implementation starts.

## Prompt 1 Implementation Record

Status: implemented.

Files added:

- `src/modules/workspaces/routes/workspace-members.routes.js`
- `src/modules/workspaces/controllers/workspace-members.controller.js`
- `src/modules/workspaces/services/workspace-members.service.js`
- `src/modules/workspaces/validators/workspace-members.validators.js`
- `tests/workspace-members.test.js`
- `tests/workspace-members.service.test.js`

Files changed:

- `src/modules/workspaces/routes/workspaces.routes.js`
- `src/modules/workspaces/docs/openapi.js`
- `src/docs/openapi/index.js`
- `src/docs/openapi/shared-schemas.js`
- `src/i18n/locales/en.json`
- `src/i18n/locales/ar.json`
- `docs/api.md`
- `docs/user-management-module-plan.md`

Discovered implementation details:

- Membership state uses `WorkspaceMember.status`; API responses expose it as `memberStatus`.
- `WorkspaceMember` has `removedAt`, `deletedAt`, and `deletedByUserId`; it does not have `removedByUserId`.
- User display data is read from `User.profile.name` and `User.profile.avatar`.
- User availability is read from `User.status === "active"` and `User.deletedAt === null`.
- The existing unique workspace membership index is `{ workspaceId, userId }`; no new index was added in Prompt 1.
- The read endpoints use aggregation with a single user lookup to avoid N+1 user loading and to keep search/filter behavior centralized.
- `viewer` search excludes email fields so hidden email addresses cannot be inferred through viewer-only search matches.

Intentional Prompt 1 boundaries:

- No role-change, suspend, activate, remove, invite role restriction, session/realtime invalidation, or participant collaborator restriction code was added.
- `participantEligible=true` means active membership plus active non-deleted user who can be added as at least one participant type; collaborator-specific viewer exclusion is enforced by ticket participant writes rather than by adding a member-query parameter.
- Global `GET /api/users` remains unchanged and no `/api/users/search`, `/api/tickets/assignees/search`, or `/api/tickets/participants/search` route was added.

## Prompt 2 Implementation Record

Status: implemented.

Endpoints implemented:

- `PATCH /api/workspaces/:workspaceId/members/:userId`
- `POST /api/workspaces/:workspaceId/members/:userId/suspend`
- `POST /api/workspaces/:workspaceId/members/:userId/activate`
- `POST /api/workspaces/:workspaceId/members/:userId/remove`

Files changed:

- `src/modules/workspaces/routes/workspace-members.routes.js`
- `src/modules/workspaces/controllers/workspace-members.controller.js`
- `src/modules/workspaces/services/workspace-members.service.js`
- `src/modules/workspaces/validators/workspace-members.validators.js`
- `src/modules/auth/services/session.service.js`
- `src/modules/workspaces/docs/openapi.js`
- `src/docs/openapi/shared-schemas.js`
- `src/i18n/locales/en.json`
- `src/i18n/locales/ar.json`
- `docs/api.md`
- `docs/user-management-module-plan.md`
- `tests/workspace-members.test.js`
- `tests/workspace-members.service.test.js`

Implementation details:

- Member action responses use compact `member` payloads with `userId`, `roleKey`, `memberStatus`, and `removedAt` for removed members.
- Same-role role changes, already-suspended suspend requests, already-active activate requests, and already-removed remove requests are idempotent successes.
- Removed members cannot be suspended or activated directly; they return `errors.workspace.memberRemoved`.
- Removal sets `WorkspaceMember.status = "removed"`, `removedAt`, `deletedAt`, and `deletedByUserId`.
- Owner/admin removed-member reads now include removed records even when `deletedAt` is set, while active/default views still exclude them.
- Last-owner protection counts active owner memberships with `status = "active"` and `deletedAt = null`.
- Admin authority is limited to target roles `agent|viewer` and target role changes `agent|viewer`.
- Reactivation uses `assertWorkspaceMemberActivationAllowed` from `src/modules/billing/services/billing-enforcement.service.js`.
- Changed member actions revoke affected user sessions only for the affected workspace through `revokeUserWorkspaceSessions`.
- Realtime socket invalidation uses `disconnectRealtimeSessionSocketsBatch`; disconnect failures are best-effort and do not roll back the member action.
- No database transaction was added, matching the existing non-transaction style for similar workspace/member flows.

Intentional Prompt 2 boundaries at the time of Prompt 2:

- Invite role restrictions remain pending for Prompt 3.
- Removed-member re-invite behavior remains pending for Prompt 3.
- Ticket participant collaborator restriction remains pending for Prompt 3.
- No global `/api/users/search`, `/api/tickets/assignees/search`, or `/api/tickets/participants/search` route was added.

## Prompt 3 Implementation Record

Status: implemented.

Items implemented:

- Invite role restrictions: owners can invite `owner|admin|agent|viewer`; admins can invite only `agent|viewer`.
- Removed-member re-invite behavior: removed memberships can be invited again and invite acceptance restores the existing membership record instead of creating a duplicate.
- Ticket participant collaborator restriction: viewers can be `watcher` only; `collaborator` writes require active `owner|admin|agent` membership.
- Assignment and participant eligibility alignment: assignment validation and `assignable=true` both require active non-deleted users with active `owner|admin|agent` membership; `participantEligible=true` remains type-agnostic and means eligible for at least one participant type.

Files changed:

- `src/modules/workspaces/services/workspaces.service.js`
- `src/modules/workspaces/controllers/workspaces.controller.js`
- `src/modules/tickets/services/ticket-reference.service.js`
- `src/modules/tickets/services/ticket-participants.service.js`
- `src/modules/workspaces/docs/openapi.js`
- `src/modules/tickets/docs/openapi.js`
- `src/docs/openapi/shared-schemas.js`
- `src/i18n/locales/en.json`
- `src/i18n/locales/ar.json`
- `docs/api.md`
- `docs/user-management-module-plan.md`
- `tests/invites.test.js`
- `tests/ticket-operations.test.js`
- `tests/workspaces.service.test.js`

Implementation details:

- Invite role authority is enforced by `assertWorkspaceInviteRoleAuthority` in the workspace service and uses the existing `errors.workspace.cannotManageRole` key for unauthorized target roles.
- Removed-member restoration reuses the existing `createOrActivateMember` path used by verified invite acceptance and verify-email invite finalization.
- Restored removed memberships set `status = active`, apply the invite `roleKey`, and clear `removedAt`, `deletedAt`, and `deletedByUserId`.
- Removed-member re-invite preserves the existing pending invite seat reservation semantics by passing `reservedInviteId` to the activation seat guard.
- Participant collaborator enforcement is in `resolveTicketParticipantUserForWrite`; suspended, removed, inactive, deleted, or cross-workspace users still collapse to `errors.ticket.participantUserNotFound`.
- A new localized error key was added: `errors.ticket.participantCollaboratorRoleNotAllowed`.
- No `participantType` query parameter was added to member list/options. `participantEligible=true` intentionally remains frontend-friendly for "can be added as some participant type"; the UI must restrict viewers to watcher only.

Intentional Prompt 3 boundaries:

- No global `/api/users/search`, `/api/tickets/assignees/search`, or `/api/tickets/participants/search` route was added.
- No direct activation path for removed members was added; `POST /members/:userId/activate` still rejects removed members.
- No optional audit events, inactive-assignee reports, or frontend work was added.
- Historical viewer collaborator rows are not migrated; new writes and upserts enforce the final policy.

## Prompt 4 Final Verification Record

Status: implemented and signed off for the backend module.

Final endpoint surface:

- `GET /api/workspaces/:workspaceId/members`
- `GET /api/workspaces/:workspaceId/members/options`
- `GET /api/workspaces/:workspaceId/members/:userId`
- `PATCH /api/workspaces/:workspaceId/members/:userId`
- `POST /api/workspaces/:workspaceId/members/:userId/suspend`
- `POST /api/workspaces/:workspaceId/members/:userId/activate`
- `POST /api/workspaces/:workspaceId/members/:userId/remove`

Final behavior verified:

- Read/search/options/detail endpoints keep tenant match, active membership, visibility, sort allowlist, safe search escaping, q/search aliases, viewer email omission, active-only non-admin visibility, and owner/admin suspended/removed visibility.
- `assignable=true` aligns with ticket assignment writes: active membership, active non-deleted user, and role `owner|admin|agent`.
- `participantEligible=true` remains type-agnostic and means eligible for at least one participant type; viewer members are watcher-only at ticket participant write time.
- Member role/status actions enforce owner/admin authority, self-management blocking, last active owner protection, removed-member activation/suspension rejection, activation billing seat checks, idempotent no-op success, workspace-scoped session revocation, and best-effort realtime socket disconnect.
- Invite creation enforces owner/admin target role restrictions, still blocks active/suspended members, allows removed-member re-invite, and preserves pending invite duplicate and billing seat reservation behavior.
- Invite acceptance and verify-email invite finalization restore removed memberships by reusing the existing record, applying the invite role, and clearing `removedAt`, `deletedAt`, and `deletedByUserId`.
- Ticket participant writes enforce viewer watcher-only behavior and restrict collaborators to active `owner|admin|agent` members. Participants remain internal metadata and do not grant access.

Prompt 4 files changed:

- `docs/architecture.md`
- `docs/app-current-state-report.md`
- `tests/setup/env.js`
- `tests/ticket-operations.test.js`
- `docs/user-management-module-plan.md`

Prompt 4 implementation notes:

- Current-state and architecture docs now state that Workspaces owns workspace member management and Users remains identity/self-profile/global placeholder surface.
- Prompt 4 fixed test SMTP isolation by clearing `SMTP_*` and `NODEMAILER_*` variables in the Jest setup so local developer SMTP configuration cannot bypass fallback email capture.
- Prompt 4 fixed a missing `agent` fixture in the ticket participant regression test that validates collaborator writes.
- No product endpoint shape or database schema change was needed during final hardening.

Verification run:

- `node --check` passed for touched workspace member, workspace invite, ticket participant/reference, OpenAPI, session, and related test files.
- Workspace member service/integration tests passed.
- Workspace service tests passed.
- Invite lifecycle tests passed.
- Focused ticket assignment/participant tests passed.
- OpenAPI docs tests passed.
- Arabic locale, interpolation, auth validation-key, and module validation-key tests passed.
- A larger combined Jest run exceeded the command timeout when heavy suites were grouped together; the same suites passed when split into focused groups.

Remaining intentional deferrals:

- Frontend UI implementation.
- Optional audit events for member management actions.
- Optional inactive-assignee reports.
- Optional `participantType=watcher|collaborator` member query filter.
- Optional leave-workspace endpoint.
- Migration of any historical viewer collaborator rows, if such data exists.

Final guardrail confirmations:

- No global `/api/users/search` route was added.
- No `/api/tickets/assignees/search` route was added.
- No `/api/tickets/participants/search` route was added.
- No direct activation endpoint for removed members was added.
- Removed-member restoration remains invite-driven and reuses the unique workspace membership record.
- `docs/user-management-module-plan.md` remains untracked for review.

## Final Review Patch Record

Status: implemented.

Review fixes:

- Viewer `sort=email` and `sort=-email` now fall back to safe name ordering with no email tie-break. Viewer `sort=name` also avoids email tie-breaks.
- Removed-member invite restoration still applies the invited role only when the existing membership is actually removed/deleted/inactive. If a stale removed-member invite is accepted after the membership is already active again, the API returns `errors.invite.alreadyMember` and leaves the current active role unchanged.
- Invite role authority now fails closed when `actorRoleKey` is missing. A system/internal bypass must be explicit through `allowSystemInvite: true`.
- Member action routes now use route-level `owner|admin` guards in addition to service-level nuanced authority checks, matching existing action-route conventions in workspace-scoped modules. Read/search/options/detail endpoints remain available to active members with service visibility rules.

Files changed in the review patch:

- `src/modules/workspaces/services/workspace-members.service.js`
- `src/modules/workspaces/services/workspaces.service.js`
- `src/modules/workspaces/routes/workspace-members.routes.js`
- `src/modules/workspaces/docs/openapi.js`
- `docs/api.md`
- `docs/user-management-module-plan.md`
- `tests/workspace-members.service.test.js`
- `tests/workspace-members.test.js`
- `tests/workspaces.service.test.js`
- `tests/invites.test.js`
