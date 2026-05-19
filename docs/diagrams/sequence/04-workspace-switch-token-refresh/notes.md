# Workspace Switch and Token Refresh

## Purpose

This sequence diagram documents the implemented session-backed workspace switch and refresh-token behavior. It shows that `POST /api/workspaces/switch` is the explicit endpoint that changes `Session.workspaceId`, returns a replacement access token, and disconnects realtime sockets for the current session. It also shows that `POST /api/auth/refresh` reissues tokens from the workspace currently stored on the session.

The diagram follows the compact phase-numbered style from Diagrams 01-03. Routine failure cases are documented here instead of drawn as many nested `alt` blocks.

## Implementation Status

Implemented.

## Source Files Inspected

- `src/modules/workspaces/routes/workspaces.routes.js`
- `src/modules/workspaces/controllers/workspaces.controller.js`
- `src/modules/workspaces/services/workspaces.service.js`
- `src/modules/workspaces/validators/workspaces.validators.js`
- `src/modules/workspaces/models/workspace.model.js`
- `src/modules/workspaces/models/workspace-member.model.js`
- `src/modules/auth/routes/auth.routes.js`
- `src/modules/auth/controllers/auth.controller.js`
- `src/modules/auth/services/auth.service.js`
- `src/modules/auth/services/session.service.js`
- `src/modules/auth/services/token.service.js`
- `src/modules/users/models/user.model.js`
- `src/modules/users/models/session.model.js`
- `src/shared/middlewares/requireAuth.js`
- `src/shared/middlewares/requireActiveUser.js`
- `src/shared/middlewares/requireActiveMember.js`
- `src/shared/services/auth-context.service.js`
- `src/infra/realtime/socket-management.js`
- `src/infra/realtime/socket-auth.js`
- `tests/workspaces.switch.test.js`
- `tests/auth.test.js`
- `docs/api.md`

Note: the requested workspace files use plural names in this repository:

- `workspaces.routes.js`
- `workspaces.controller.js`
- `workspaces.service.js`
- `workspaces.validators.js`

Also, user auth models are implemented under `src/modules/users/models`.

## Participants Included

- Workspace User
- App UI
- Routes + Validation
- Auth + User Guards
- Workspace Controller
- Workspace Service
- Auth Controller
- Auth Service
- Session/Token Service
- Domain Models: User, Session, Workspace, WorkspaceMember
- Realtime Runtime

## Participants Intentionally Excluded

- MongoDB, Mongoose internals, JWT signing internals, and Socket.IO room details are not shown as actors.
- Invite acceptance is excluded because it belongs to Diagram 05; this diagram only covers explicit switching after a user already has the target membership.
- `GET /api/workspaces/mine` is not drawn because it is a read-only context list and not the state-changing switch flow.

## Main Success Path

1. User selects a target workspace in the app.
2. App calls `POST /api/workspaces/switch` with the target `workspaceId`.
3. `requireAuth` resolves the access token and verifies that token `wid` still matches the current `Session.workspaceId`.
4. `requireActiveUser` verifies the user is active.
5. Request validation checks `workspaceId`.
6. Workspace service loads the target workspace and verifies it is not suspended.
7. Workspace service verifies the user has an active membership in the target workspace.
8. Workspace service updates `Session.workspaceId`.
9. Workspace service updates `User.lastWorkspaceId`.
10. Session/token service mints a replacement access token for the target workspace and role.
11. Realtime session sockets are disconnected so the frontend reconnects with the fresh token.
12. API returns the target workspace view, role, and replacement access token.
13. Later `POST /api/auth/refresh` validates the refresh token and session hash.
14. Refresh resolves active workspace context from the stored `Session.workspaceId`.
15. Refresh rotates both tokens and updates the stored refresh token hash.

## Important Alternate And Error Paths

- Validation failures return `422 errors.validation.failed`.
- Missing, malformed, expired, or invalid access tokens return `401 errors.auth.invalidToken`.
- If token workspace `wid` no longer matches `Session.workspaceId`, the old access token fails as `401 errors.auth.sessionRevoked`.
- Revoked or expired sessions return `401 errors.auth.sessionRevoked`.
- Suspended users return `403 errors.auth.userSuspended`.
- Target workspace not found returns `404 errors.workspace.notFound`.
- Suspended target workspace returns `403 errors.workspace.suspended`.
- Missing target membership returns `403 errors.workspace.notMember`.
- Inactive target membership returns `403 errors.workspace.inactiveMember`.
- Refresh token reuse after rotation revokes the session and returns `401 errors.auth.sessionRevoked`.
- Refresh token validation returns `401 errors.auth.invalidToken` for invalid token structure/signature.
- Refresh does not choose a client-supplied workspace. It reissues claims from the current session workspace context.
- Existing realtime sockets for the switched session are disconnected on a best-effort basis.

## Rendering Command Notes

The source diagram is PlantUML. Rendered PNG and SVG are generated directly from the `.puml` file.

PDF export uses a local HTML wrapper around the SVG and headless Edge with headers/footers disabled so the output remains one page and does not show date, time, URL, or source path.

## Remaining Uncertainties

- None for the implemented switch, stale access-token behavior, refresh rotation, and realtime disconnect behavior.
