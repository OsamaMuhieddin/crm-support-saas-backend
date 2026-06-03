# Workspace User Management Use Case Diagram Notes

## Scope

This diagram covers the implemented workspace member management surface for Masar - CRM Support SaaS: member list/search/options/detail, member role and status actions, invite role authority, removed-member restoration through re-invite, session invalidation effects, and billing seat checks where they affect membership state.

It replaces the earlier notes-only decision for users/roles/memberships because workspace member management is now implemented under the workspaces module. The diagram is named Workspace User Management because the behavior is workspace-scoped user membership management, not global user administration. Global user identity and profile behavior remains covered by the Auth and Workspace Access diagram.

## Actors included

- `Workspace Member`: abstract actor for active authenticated members who can read workspace member summaries under role-based visibility rules.
- `Workspace Manager (Owner/Admin)`: abstract actor for roles allowed to create invites and attempt member-management actions.
- `Workspace Owner`: concrete manager role with the broadest member-management authority, subject to self-action and last-owner safety rules.
- `Workspace Admin`: concrete manager role that can manage only agent/viewer targets and can invite only agent/viewer roles.
- `Agent`: concrete active member role that can read active members and see email, but cannot manage members.
- `Viewer`: concrete active member role that can read active members with minimal profile data and no email.
- `Removed Member / Invitee`: a prior workspace member who can be restored only through the invite acceptance path.
- `Email Provider (Hostinger SMTP)`: shown because invite and re-invite flows send invite links/tokens.

## Actors intentionally excluded

- MongoDB, Mongoose, Express, JWT libraries, session storage, and Socket.IO internals are infrastructure and are not modeled as actors.
- Billing provider internals are excluded because member activation and invite flows call internal billing enforcement rather than exposing a direct user-facing billing provider interaction here.
- Ticket assignees, ticket participants, and customers are excluded because assignment and participant writes are modeled in the ticket diagrams.

## Use cases included

- `List/Search Workspace Members`: `GET /api/workspaces/:workspaceId/members` with q/search aliases, role/status filters, pagination, safe sorting, and visibility rules.
- `Use Member Options`: compact selector/autocomplete endpoint for assignment and participant pickers.
- `View Member Detail`: direct member resolution by user id.
- `Manage Workspace Members`: grouped workspace member role/status actions.
- `Change Member Role`: owner/admin role change action with authority matrix, self-action block, and last-owner safety.
- `Suspend Member`: active member suspension that preserves historical attribution and removes active access.
- `Activate Suspended Member`: reactivation of suspended members only, with billing seat capacity check.
- `Remove Member`: soft-removal of membership while preserving global user and historical ticket/message/file/report attribution.
- `Manage Workspace Invites`: grouped invite-management behavior where it affects workspace user management.
- `Create Workspace Invite`: invite creation with owner/admin target-role restrictions and duplicate checks.
- `Restore Removed Member by Re-Invite`: removed-member restoration through the invite flow, reusing the existing membership record.

## Grouping decisions

- Ticket assignment and ticket participant operations are intentionally not repeated here. This diagram documents member eligibility surfaces only; the actual ticket workflows remain in the ticket operation and ticket messages/participants diagrams.
- Workspace switching and token refresh are intentionally not repeated here. Member changes revoke affected workspace sessions; explicit workspace switching and refresh behavior remain in the workspace switch/token refresh sequence.
- Full invite acceptance is intentionally not duplicated. The diagram includes only the membership-specific removed-member restoration use case and points to the existing invite acceptance sequence for the detailed flow.
- Owner and admin are grouped as `Workspace Manager (Owner/Admin)` in the rendered diagram to match the cleaner style used by neighboring detailed diagrams. Their different authority rules remain documented here.
- Internal effects such as session invalidation, realtime socket disconnect, and billing seat checks are documented in notes instead of drawn as separate use cases because they are implementation/business-rule constraints, not user-initiated use cases.
- Rendered note boxes are intentionally omitted from the `.puml` source so the visual stays consistent with neighboring use-case diagrams such as Widget and Public Customer Flow and Platform Admin. Detailed constraints are documented here instead.

## Code/test-backed business rules

- All member endpoints are workspace-scoped and require the path workspace id to match the active workspace in the token.
- Member list/options/detail require authentication, active user, and active workspace membership.
- Owner/admin can request active, suspended, and removed members and can see email.
- Agent receives active members only and can see email.
- Viewer receives active members only, no email, and email sorting falls back to safe name ordering.
- `assignable=true` means active membership, active non-deleted user, and role `owner|admin|agent`.
- `participantEligible=true` means active membership and active non-deleted user eligible for at least one participant type; viewers are watcher-only and cannot be collaborators.
- Owner can manage other members, including other owners, as long as at least one active owner remains.
- Admin can manage only agent/viewer targets and can assign only agent/viewer roles.
- Self role change, self suspend, and self remove are blocked.
- Last active owner cannot be demoted, suspended, or removed.
- Suspended and removed members do not pass active workspace membership checks and are excluded from assignable and participant-eligible options.
- Activate is for suspended members only. Removed members cannot be activated directly and must be restored through re-invite.
- Remove is a soft membership removal: membership status becomes removed, removal markers are set, global user documents are not deleted, and historical attribution remains intact.
- Role/status changes revoke the affected user's sessions for the affected workspace and best-effort disconnect realtime sockets.
- Existing ticket assignments are preserved after role changes, suspend, or remove; owner/admin users must explicitly unassign and assign a replacement when operational ownership should change.
- Invite creation enforces owner/admin role authority: owners may invite owner/admin/agent/viewer; admins may invite agent/viewer only.
- Active and suspended existing members block new invites for the same email.
- Removed members may be re-invited. Acceptance reuses the existing `WorkspaceMember` record, applies the invited role, sets status to active, and clears `removedAt`, `deletedAt`, and `deletedByUserId`.
- Stale removed-member invites fail with already-member behavior if the membership is active again before acceptance, and they do not overwrite the current active role.

## Source files, routes, docs, and tests inspected

- `src/modules/workspaces/routes/workspace-members.routes.js`
- `src/modules/workspaces/controllers/workspace-members.controller.js`
- `src/modules/workspaces/services/workspace-members.service.js`
- `src/modules/workspaces/validators/workspace-members.validators.js`
- `src/modules/workspaces/routes/workspaces.routes.js`
- `src/modules/workspaces/controllers/workspaces.controller.js`
- `src/modules/workspaces/services/workspaces.service.js`
- `src/modules/workspaces/validators/workspaces.validators.js`
- `src/modules/workspaces/models/workspace-member.model.js`
- `src/modules/workspaces/models/workspace-invite.model.js`
- `src/modules/workspaces/docs/openapi.js`
- `src/modules/auth/services/session.service.js`
- `src/modules/billing/services/billing-enforcement.service.js`
- `src/modules/tickets/services/ticket-reference.service.js`
- `src/modules/tickets/services/ticket-participants.service.js`
- `tests/workspace-members.test.js`
- `tests/workspace-members.service.test.js`
- `tests/invites.test.js`
- `tests/ticket-operations.test.js`
- `docs/api.md`

## Placeholder, uncertain, and intentionally omitted areas

- No global `/api/users/search`, ticket assignee search, or ticket participant search is modeled because those endpoints were intentionally not added.
- Optional audit events, inactive-assignee reports, frontend UI screens, and a leave-workspace endpoint are not implemented and are not modeled.
- The `users` module remains identity/self-profile oriented; workspace member management belongs to the workspaces module.

## Export/import limitations

- PlantUML source is the primary editable artifact.
- PNG, PDF, and SVG can be rendered from this source using the repository's existing PlantUML workflow.
- XMI, if generated later, should be treated as a best-effort import artifact and may require manual layout cleanup in Visual Paradigm.
- Native Visual Paradigm `.vpp` or `.vpdx` export is not available from this repository workflow.
