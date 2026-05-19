# Diagram 13: Reports and Analytics

## Scope

This diagram covers the implemented workspace reporting endpoints for Masar - CRM Support SaaS. It is a detailed domain use case diagram for read-only reporting and analytics, not a ticket-management or platform-admin diagram.

Users, Roles & Memberships is intentionally skipped as a separate diagram because the implemented membership, invite, `roleKey`, session, and explicit workspace-switching behavior is already covered by the Auth, Sessions & Workspace diagram. The `users` module currently exposes only a placeholder list route, and the `roles` module only exports model placeholders.

## Actors Included

- `Workspace Member`: abstract parent for authenticated users with an active membership in the active workspace.
- `Workspace Manager (Owner/Admin)`: abstract role group for management-only reporting.
- `Agent`: can view workspace overview, ticket reports, and SLA reports.
- `Viewer`: can view workspace overview, ticket reports, and SLA reports.

## Actors Intentionally Excluded

- MongoDB, Mongoose, Express, validation middleware, JWT/session internals, aggregation details, and ticket/SLA model internals are implementation details, not business actors.
- `System / Scheduler` is excluded because scheduled reports, report exports, recurring emails, and notification jobs are not implemented in the reports module.
- Platform admins are excluded because platform analytics belong to the separate Platform Admin diagram.
- Customers and widget visitors are excluded because reports are protected workspace endpoints.

## Use Cases Included

- `View Reports Overview`: implemented by `GET /api/reports/overview`; returns workspace dashboard KPIs, status/priority/mailbox breakdowns, SLA summary, and compact usage data.
- `View Ticket Reports`: implemented by `GET /api/reports/tickets`; returns created/solved/closed counts, volume series, and ticket dimension breakdowns.
- `View SLA Reports`: implemented by `GET /api/reports/sla`; returns SLA overview, compliance series, and priority/mailbox breakdowns.
- `View Team Workload Report`: implemented by `GET /api/reports/team`; returns assignee workload and is restricted to `owner|admin`.
- `Customize Report Filters`: shared filter contract across all report routes.
- `Select Reporting Period`: actor-facing date range selection. Validation details remain in business rules instead of being drawn as a separate use case.
- `Choose Report Granularity`: actor-facing grouping choice for day, week, or month buckets.
- `Filter by Ticket Attributes`: actor-facing filtering by mailbox, assignee, priority, category, or tag.
- `Review Workspace KPIs and Usage`: overview report result area for workspace KPI, SLA, and compact usage data.
- `Review Ticket Volume and Breakdowns`: ticket report result area for created/solved/closed series and operational breakdowns.
- `Review SLA Compliance`: SLA report result area for compliance, breach, priority, and mailbox analytics.
- `Review Assignee Workload`: team report result area for assignee workload and active load.

## Grouping Decisions

- The diagram keeps report endpoints as first-order use cases because they map directly to the implemented API contract and frontend reporting surfaces.
- Shared period, granularity, and ticket-attribute filters are grouped under `Customize Report Filters` to avoid repeating identical dependencies for every report route.
- Validation, workspace scoping, and role enforcement are documented as business rules rather than drawn as use cases because they are constraints on access and input, not separate user goals.
- Internal aggregation steps such as label lookup, SLA state derivation, and bucket construction are summarized as actor-visible review/result use cases rather than implementation calculation ovals.

## Important Business Rules

- All report routes require workspace-user authentication, an active user, and an active membership.
- Overview, tickets, and SLA reports are visible to active workspace members, including owner, admin, agent, and viewer roles.
- The team report is management-facing and requires `owner|admin`.
- Reports are scoped to `req.auth.workspaceId`; clients cannot pass `workspaceId` as a report filter.
- Unknown query fields fail validation with `errors.validation.unknownField`.
- Shared filters support `from`, `to`, `groupBy`, `mailboxId`, `assigneeId`, `priority`, `categoryId`, and `tagId`.
- Date ranges are normalized to UTC day boundaries and may not exceed 366 days.
- When dates are omitted, the report service uses a recent default reporting window.
- Ticket and SLA reports expose read-only summaries, breakdowns, and series; they do not mutate ticket state.
- The overview report includes compact usage signals such as seats used, active mailboxes, storage bytes, and current billing status.

## Files, Routes, Docs, and Tests Inspected

- `src/modules/reports/routes/reports.routes.js`
- `src/modules/reports/controllers/reports.controller.js`
- `src/modules/reports/services/reports.service.js`
- `src/modules/reports/docs/openapi.js`
- `src/modules/reports/validators/reports.validators.js`
- `src/modules/reports/utils/report-filters.js`
- `tests/reports.test.js`
- `docs/api.md`
- Existing accepted diagram sources under `docs/diagrams/use-cases/realtime/`, `billing/`, `files/`, and `sla/`.

## Placeholder, Uncertain, or Intentionally Omitted Areas

- Users/Roles/Memberships is omitted as a standalone diagram because the meaningful implemented behavior is already represented in Auth/Workspace; the remaining users/roles modules are placeholder-level for use-case purposes.
- Scheduled reports, exports, dashboard configuration, saved views, emailed reports, and report notifications are omitted because they are not implemented.
- Platform-wide analytics are omitted and should be covered by the Platform Admin diagram.
- Anti-enumeration is represented as active workspace scoping and rejected `workspaceId` filters; cross-workspace data is not intentionally exposed through report filter parameters.

## Export/Import Notes

- PlantUML source is the canonical editable diagram source.
- PNG and PDF are generated render artifacts.
- XMI is a best-effort interchange artifact generated from PlantUML when tooling is available; Visual Paradigm native `.vpp` or `.vpdx` export is not available from PlantUML.
