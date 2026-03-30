# Tenancy

- Workspace is the tenant root.
- Users can belong to multiple workspaces through memberships.
- Active workspace is session-scoped as `session.workspaceId`.
- Most protected business behavior is scoped through the current active workspace.

## Hard rules

- Only `POST /api/workspaces/switch` may change the active workspace.
- Do not auto-switch active workspace after invite acceptance or invite finalization.
- `GET /api/workspaces/mine` lists the current user's active memberships with workspace basics and role.
- `POST /api/workspaces/switch` returns a fresh access token for the new active workspace.

## Auth model implications

- Access tokens are workspace-scoped for the active session context.
- Old access tokens should be treated as invalid after a workspace switch.
- Keep anti-enumeration behavior workspace-scoped: cross-workspace lookups should collapse to the module's not-found behavior where applicable.
