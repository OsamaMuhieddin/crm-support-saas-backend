# Diagram 14: Platform Admin

## Scope

This diagram covers implemented platform-admin authentication, platform analytics, cross-workspace inspection, workspace suspension/reactivation, and trial extension support behavior for Masar - CRM Support SaaS. It is a detailed domain use case diagram, not a whole-system context diagram and not the normal workspace owner/admin authorization model.

## Actors Included

- `Platform Admin User`: abstract parent for shared platform-auth lifecycle behavior.
- `Platform Support`: can inspect workspace lists and workspace detail, but cannot access analytics or workspace action routes.
- `Platform Admin`: can inspect workspaces and view platform overview/metrics.
- `Super Admin`: can inspect workspaces, view all analytics including billing overview, suspend/reactivate workspaces, and extend eligible workspace trials.
- `Workspace Owner/Admin`: included only as an affected tenant-side actor because platform suspension blocks normal workspace runtime access and reactivation restores it.

## Actors Intentionally Excluded

- MongoDB, Mongoose, Express, JWT libraries, Redis, queues, internal workers, and storage adapters are infrastructure details, not business actors.
- `Billing Provider (Stripe)` is excluded. Platform-admin trial extension is implemented as a local unmanaged trial-subscription support action and does not call the Stripe provider.
- Normal `Workspace Manager (Owner/Admin)` is not shown as an admin actor because `/api/admin/*` uses isolated platform-admin auth, not workspace-scoped tokens.
- No email provider is shown because implemented platform-admin auth does not send OTP, invite, or reset email in these routes.

## Use Cases Included

- `Authenticate Platform Admin`: shared platform token/session authentication for protected admin routes.
- `Log In as Platform Admin`: validates platform admin email/password, rejects suspended platform admins, creates an isolated platform session, and returns platform tokens.
- `Refresh Platform Session`: validates the platform refresh token/session, rotates tokens, and revokes the session when an old refresh token is reused.
- `View Current Platform Identity`: returns safe platform admin identity plus active platform session summary.
- `Log Out Current Platform Session`: revokes the current platform session.
- `Log Out All Platform Sessions`: revokes all active sessions for the current platform admin.
- `Keep Platform Tokens Isolated from Workspace Tokens`: platform JWT audience/type/session model is separate from normal workspace-user tokens; workspace tokens cannot access platform routes.
- `Enforce Platform Role Authorization`: protects analytics, workspace inspection, and sensitive workspace actions by platform role.
- `View Platform Overview`: returns live platform KPIs, billing status counts, operational usage, and revenue visibility according to role.
- `View Platform Metrics`: returns historical trend buckets from `PlatformMetricDaily`, with honest partial coverage when snapshots are missing.
- `View Billing Overview`: super-admin-only billing analytics across subscription statuses, plans, lifecycle, usage pressure, and revenue.
- `Hide Revenue from Non-Super Admins`: platform-admin analytics omit revenue fields or mark revenue as not visible for non-super-admin callers.
- `Inspect Tenant Workspaces`: grouped workspace list/detail inspection behavior.
- `List Workspaces`: paginated compact list with owner, billing, usage, and entitlement summary.
- `Search/Filter Workspaces`: supports `q`/`search`, workspace status, billing status, plan key, trialing flag, pagination, limit, and documented sort values.
- `View Workspace Detail`: returns workspace, owner, billing, usage, member/invite/mailbox/ticket counts.
- `Review Workspace Owner, Billing, Usage, and Counts`: shown as a separate detail sub-use case because workspace detail aggregates several operational domains.
- `Suspend Workspace`: super-admin-only compact action; idempotently sets workspace status to `suspended`.
- `Reactivate Workspace`: super-admin-only compact action; idempotently restores a suspended workspace to `trial` when the subscription is trialing, otherwise `active`.
- `Block/Restore Workspace Runtime Access`: shown because tests verify normal workspace runtime access is blocked while suspended and restored after reactivation.
- `Extend Workspace Trial`: super-admin-only compact support action.
- `Validate Trial Extension Eligibility`: requires an existing subscription, `trialing` status, no Stripe subscription id, and `days` between 1 and 30.

## Grouping Decisions

- Platform auth lifecycle actions are explicit because they define the isolated platform session model.
- Workspace list/detail reads are grouped under `Inspect Tenant Workspaces`, while search/filter and detail snapshot are kept visible because they are important admin inspection capabilities.
- Sensitive super-admin actions are separate use cases instead of being collapsed into `Manage Workspace`.
- Billing analytics are included, but Stripe provider operations are excluded because platform-admin routes only read billing data or update local unmanaged trial state.
- Platform role checks and token isolation are modeled as included use cases because they are central to separating platform administration from tenant administration.

## Important Business Rules

- Platform-admin routes are mounted under `/api/admin/*`.
- Platform auth uses separate platform access/refresh token types and audience from normal workspace-user auth.
- Platform refresh token rotation stores only a hash; reuse of an old refresh token revokes the session and returns a session-revoked error.
- Suspended platform admins cannot log in.
- Workspace-user tokens cannot access platform-admin routes.
- `platform_support` can list and view workspaces only.
- `platform_admin` can list/view workspaces and view overview/metrics, but cannot view billing overview or perform super-admin workspace actions.
- `super_admin` can view billing overview and perform suspend/reactivate/extend-trial actions.
- Revenue-sensitive platform analytics are visible only to `super_admin`.
- Metrics date ranges are validated and cannot exceed 366 days.
- Workspace list rejects unknown query filters.
- Workspace suspension/reactivation actions are idempotent and return compact action responses.
- Reactivation does not mutate plan, usage, or billing lifecycle; it restores status based on current subscription state.
- Trial extension is local and allowed only for unmanaged trialing subscriptions. It clears grace/past-due/cancellation block fields and can advance `currentPeriodEnd`.

## Files, Routes, Docs, and Tests Inspected

- `src/modules/admin/routes/admin.routes.js`
- `src/modules/admin/routes/admin-auth.routes.js`
- `src/modules/admin/routes/admin-workspaces.routes.js`
- `src/modules/admin/controllers/admin.controller.js`
- `src/modules/admin/controllers/admin-auth.controller.js`
- `src/modules/admin/controllers/admin-workspaces.controller.js`
- `src/modules/admin/services/admin.service.js`
- `src/modules/admin/services/admin-auth.service.js`
- `src/modules/admin/services/admin-session.service.js`
- `src/modules/admin/services/admin-token.service.js`
- `src/modules/admin/services/admin-workspaces.service.js`
- `src/modules/admin/validators/admin-analytics.validators.js`
- `src/modules/admin/validators/admin-auth.validators.js`
- `src/modules/admin/validators/admin-workspaces.validators.js`
- `src/modules/admin/docs/openapi.js`
- `src/modules/platform/models/platform-admin.model.js`
- `src/modules/platform/models/platform-session.model.js`
- `src/modules/platform/models/platform-metric-daily.model.js`
- `tests/admin.auth.test.js`
- `tests/admin.analytics.test.js`
- `tests/admin.workspaces.test.js`
- `tests/openapi.docs.test.js`
- `docs/api.md`
- Existing accepted diagram sources under `docs/diagrams/use-cases/realtime/`, `billing/`, and `reports/`.

## Placeholder, Uncertain, or Intentionally Omitted Areas

- Tenant impersonation is omitted because no implemented route or service supports it.
- Platform admin management of platform-admin users is omitted because no implemented admin-user CRUD route was found.
- Plan/catalog management is omitted because platform-admin routes do not manage plans directly.
- Direct tenant data mutation beyond workspace status and unmanaged trial extension is omitted.
- Stripe is omitted as an actor for this diagram because super-admin billing overview is read-only analytics and trial extension does not call the Stripe provider.
- Visual Paradigm native `.vpp`/`.vpdx` export is not available from PlantUML; XMI is a best-effort interchange artifact.

## Styling and Rendering Decisions

- The diagram uses the accepted landscape `left to right direction` style.
- Actors are plain stick actors with `actorStyle awesome`.
- Use cases are plain white ovals inside the `Masar - CRM Support SaaS` system boundary.
- Associations and dependencies follow the same simple PlantUML style as the accepted diagrams.
- No internal note boxes were placed in the diagram; validation and authorization details are captured here to keep the rendered diagram readable.
