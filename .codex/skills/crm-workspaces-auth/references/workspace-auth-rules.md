# Workspace And Auth Rules

## Tenancy

- Workspace is the tenant root.
- Users can belong to multiple workspaces through memberships.
- Active workspace is stored on the session as `session.workspaceId`.
- `GET /api/workspaces/mine` lists active memberships with workspace basics and role.

## Hard switching rule

- Only `POST /api/workspaces/switch` may change the active workspace.
- Invite acceptance or finalization must not auto-switch the active workspace.
- Switch should return a fresh access token for the new active workspace.

## Auth model

- Auth is session-backed, not purely stateless.
- Access tokens carry user, session, workspace, and role context.
- Old access tokens should be treated as invalid after a workspace switch.
- Frontend should use `GET /api/auth/me` as the canonical view of current workspace and role.

## Invite and membership guardrails

- Invite management is workspace-scoped.
- Role restrictions remain explicit in docs and behavior.
- Cross-workspace lookups should collapse to the module's not-found behavior where applicable.

## Implementation rules

- Resolve or confirm the active workspace on the session before minting workspace-scoped access tokens.
- Keep workspace switching explicit and isolated to the switch flow; do not hide it inside invite acceptance, verification, or login side effects unless product rules change.
- Centralize membership and session checks in service logic or existing auth plumbing rather than duplicating partial checks in controllers.
- When switching workspaces, preserve the expectation that existing access tokens are replaced and stale ones stop matching the session context.
- Add targeted tests for switch, invite, membership, and token-context behavior when those flows change.
