# System Context Use Case Diagram Notes

## Scope

This diagram is the top-level academic system context use case diagram for Masar - CRM Support SaaS. It intentionally shows business-visible behavior at the API boundary instead of implementation infrastructure.

## Actors Included

- Platform Admin: separate platform administration surface under `/api/admin`.
- Workspace Owner: full workspace management role, grouped through Workspace Manager.
- Workspace Admin: workspace management role, grouped through Workspace Manager.
- Agent: operational support role, grouped through Operational Member.
- Viewer: read-oriented workspace role.
- Customer / Widget Visitor: public widget visitor using public widget endpoints.
- Billing Provider (Stripe): business-facing external billing system for checkout, portal, subscription changes, and webhooks.
- Email Provider (Hostinger SMTP): business-facing external email provider used for OTP and invite email delivery.
- System / Scheduler: automated or time-based business processing, especially billing jobs, repairs, health monitoring, and ticket SLA runtime.

## Actors Intentionally Excluded

- MinIO, local file storage, MongoDB, Redis, queues, BullMQ, Express, Mongoose, JWT libraries, Socket.IO, and internal workers are infrastructure, not use case actors.
- External Integration is omitted from the diagram because the mounted integrations router is currently empty. Integration models exist, but there is no implemented endpoint surface in this snapshot.

## Use Cases Included

- Authenticate and Manage Session
- Manage Workspace Context
- Switch Active Workspace
- Manage Invites and Memberships
- Manage Mailboxes
- Manage Customers and Contacts
- Manage Ticket Categories and Tags
- Manage Tickets
- Handle Ticket Conversation
- Use Files and Attachments
- Manage SLA Configuration
- Apply Ticket SLA Runtime
- Use Realtime Collaboration
- Manage Support Widgets
- Use Public Support Widget
- Manage Billing
- Process Billing Webhooks and Job Workers
- View Workspace Reports
- Manage Platform Administration
- Monitor API Health

## Grouping Decisions

- User and role management is represented as "Manage Invites and Memberships" because the implemented workspace surface is invite/membership-oriented. The `/api/users` route is a public placeholder list endpoint, and there are no full role-management routes in this snapshot.
- Ticket category/tag CRUD is grouped as "Manage Ticket Categories and Tags" to avoid crowding the context diagram.
- File upload, metadata, download, delete, ticket attachments, and public widget file uploads are grouped as "Use Files and Attachments".
- SLA business hours, policies, activation/deactivation, default policy, summary, and ticket runtime snapshots are split into configuration and runtime use cases because both are meaningful project scope.
- Billing user actions and asynchronous webhook/job-worker processing are split because Stripe webhooks and billing workers are visible business flows even though queue technology itself is infrastructure.
- Realtime is shown as user-visible collaboration and public widget realtime support, not as Socket.IO or Redis infrastructure.

## Source Areas Inspected

- Root API mounting: `src/routes/index.js`
- Auth routes/controllers/docs: `src/modules/auth/routes/auth.routes.js`, `src/modules/auth/controllers/auth.controller.js`, `src/modules/auth/docs/openapi.js`
- Workspaces routes/controllers/docs: `src/modules/workspaces/routes/workspaces.routes.js`, `src/modules/workspaces/controllers/workspaces.controller.js`, `src/modules/workspaces/docs/openapi.js`
- Users placeholder routes/docs: `src/modules/users/routes/users.routes.js`, `src/modules/users/docs/openapi.js`
- Customers routes/controllers/docs: `src/modules/customers/routes/customers.routes.js`, `src/modules/customers/routes/organizations.routes.js`, `src/modules/customers/routes/contacts.routes.js`, `src/modules/customers/routes/contact-identities.routes.js`, `src/modules/customers/controllers/*.controller.js`, `src/modules/customers/docs/openapi.js`
- Tickets routes/controllers/docs: `src/modules/tickets/routes/tickets.routes.js`, `src/modules/tickets/controllers/*.controller.js`, `src/modules/tickets/docs/openapi.js`
- Files routes/controllers/docs: `src/modules/files/routes/files.routes.js`, `src/modules/files/controllers/files.controller.js`, `src/modules/files/docs/openapi.js`
- Mailboxes routes/controllers/docs: `src/modules/mailboxes/routes/mailboxes.routes.js`, `src/modules/mailboxes/controllers/mailboxes.controller.js`, `src/modules/mailboxes/docs/openapi.js`
- Widget routes/controllers/docs: `src/modules/widget/routes/widget.routes.js`, `src/modules/widget/controllers/*.controller.js`, `src/modules/widget/docs/openapi.js`
- Realtime routes/controllers/docs and services: `src/modules/realtime/routes/realtime.routes.js`, `src/modules/realtime/controllers/realtime.controller.js`, `src/modules/realtime/docs/openapi.js`, `src/modules/realtime/services/*.js`
- SLA routes/controllers/docs and runtime service: `src/modules/sla/routes/sla.routes.js`, `src/modules/sla/controllers/sla.controller.js`, `src/modules/sla/docs/openapi.js`, `src/modules/sla/services/sla-ticket-runtime.service.js`
- Billing routes/controllers/docs/services: `src/modules/billing/routes/billing.routes.js`, `src/modules/billing/controllers/billing.controller.js`, `src/modules/billing/docs/openapi.js`, `src/modules/billing/services/billing-queue.service.js`, `src/modules/billing/services/billing-sync.service.js`, `src/modules/billing/services/providers/stripe-billing.provider.js`
- Reports routes/controllers/docs: `src/modules/reports/routes/reports.routes.js`, `src/modules/reports/controllers/reports.controller.js`, `src/modules/reports/docs/openapi.js`
- Admin routes/controllers/docs: `src/modules/admin/routes/admin.routes.js`, `src/modules/admin/routes/admin-auth.routes.js`, `src/modules/admin/routes/admin-workspaces.routes.js`, `src/modules/admin/controllers/*.controller.js`, `src/modules/admin/docs/openapi.js`
- Empty or placeholder mounted modules: `src/modules/inbox/routes/inbox.routes.js`, `src/modules/integrations/routes/integrations.routes.js`
- API reference overview and quick-start flow headings: `docs/api.md`
- Relevant test coverage inventory under `tests/`, including auth, invites, customers, files, mailboxes, tickets, SLA runtime, realtime, widget, billing, reports, and admin tests.

## Placeholder or Uncertain Areas

- `src/modules/integrations/routes/integrations.routes.js` is mounted but empty.
- `src/modules/inbox/routes/inbox.routes.js` is mounted but empty.
- `src/modules/users/routes/users.routes.js` exposes a placeholder public list endpoint.
- `src/modules/automations`, `src/modules/notifications`, and `src/modules/roles` contain model/schema/index placeholders but no mounted business endpoint surface in `src/routes/index.js`.
- Visual Paradigm native `.vpp` export cannot be produced without Visual Paradigm tooling. A best-effort XMI model export is provided for import testing, but it may not preserve diagram layout.
