# Use Case Diagram Index and Final Cross-Check

This index is the final cross-check for the Masar - CRM Support SaaS academic UML use case diagram package. It records which diagrams exist, what scope each diagram covers, and where planned scope was merged instead of split into a separate diagram.

## Final Diagram Set

| # | Diagram | Folder | Type | Primary scope |
|---|---|---|---|---|
| 1 | System Context | `system-context/` | Context | Whole implemented app scope at a high level |
| 2 | Auth and Workspace Access | `auth-workspace/` | Detailed domain | Auth, sessions, OTP, workspace context, workspace switch, invites |
| 3 | Workspace User Management | `workspace-user-management/` | Detailed domain | Workspace member list/search/options/detail, role/status actions, invite role restrictions, removed-member re-invite restoration |
| 4 | Ticket Operations | `ticket-operations/` | Detailed domain | Ticket creation, list/detail, lifecycle, assignment, dictionaries |
| 5 | Ticket Messages, Participants, and Attachments | `ticket-messages-attachments/` | Detailed domain | Ticket conversation, messages, participants, semantic attachments |
| 6 | Customers and Contacts | `customers-contacts/` | Detailed domain | Organizations, contacts, contact identities |
| 7 | Mailboxes | `mailboxes/` | Detailed domain | Mailbox management, default/active rules, ticket mailbox usage |
| 8 | SLA Management and Runtime | `sla/` | Detailed domain | Business hours, SLA policies, ticket SLA runtime |
| 9 | Files and Attachments | `files/` | Detailed domain | File upload, metadata, download, delete, file links |
| 10 | Widget and Public Customer Flow | `widget-public-flow/` | Detailed domain | Widget admin, public sessions, messages, recovery, widget realtime |
| 11 | Realtime Collaboration | `realtime/` | Detailed domain | Socket authentication, subscriptions, ticket collaboration, business events |
| 12 | Billing | `billing/` | Detailed domain | Subscription management, Stripe provider flows, webhooks, lifecycle, usage and enforcement |
| 13 | Reports and Analytics | `reports/` | Detailed domain | Overview, tickets, SLA, team workload, filters and metrics |
| 14 | Platform Admin | `platform-admin/` | Detailed domain | Platform auth, analytics, workspace inspection, super-admin workspace actions |
| 15 | Final Cross-Check and Index | `index/` | Index | Package coverage, consistency, omissions, generated artifact status |

## Coverage Result

The package covers all implemented business-facing route modules mounted by `src/routes/index.js`: auth, workspaces, customers, tickets, SLA, admin, files, mailboxes, widgets, realtime, billing, and reports.

The following mounted or present modules are intentionally not represented as separate detailed diagrams:

- `users`: global identity/self-profile behavior is covered in `auth-workspace/`; workspace-scoped user/member management is covered by `workspace-user-management/`.
- `roles`: model/index placeholder only; role behavior is represented through actors and authorization rules in the relevant diagrams.
- `inbox`: mounted placeholder/reserved module with no implemented business routes.
- `integrations`: models exist, but no meaningful implemented integration routes/services were found for a detailed use case diagram.
- `health`: operational health check, not a business use case diagram.
- `automations`, `notifications`, and `platform`: model/support modules without public business use case routes needing their own diagram.

## Style Decisions

- All `.puml` sources use a system boundary titled `Masar - CRM Support SaaS`.
- Rendered diagrams should use the same system boundary title style as the accepted auth/workspace diagram.
- Use case ovals should be plain white, actors should be plain stick actors, and associations should use light-gray lines.
- `<<include>>` and `<<extend>>` are kept only where they express useful UML meaning.
- Diagrams may use only actor associations when additional dependency links would create noise.
- Infrastructure such as MongoDB, Redis, queues, MinIO, Express, Mongoose, JWT libraries, Socket.IO internals, local storage adapters, and internal workers is excluded as actors.
- Business-facing providers are included only where implemented behavior justifies them, such as `Email Provider (Hostinger SMTP)` and `Billing Provider (Stripe)`.

## Final Consistency Notes

- The source diagram boundary title is consistent across all existing `.puml` files.
- The rendered diagrams were manually adjusted for several crowded domains because PlantUML auto-layout produced overlapping or noisy association routing.
- The final package standardizes only the system boundary title wording and placement style; diagram layout, use cases, and association routing should not be changed during this consistency pass.
- Workspace User Management now has a focused standalone diagram because workspace member management is implemented under the workspaces module. Global identity/session behavior remains in the auth/workspace diagram.
- Visual Paradigm native `.vpp`/`.vpdx` export remains unavailable in this environment; PlantUML and best-effort XMI files are the practical interchange artifacts where generated.

## Generated Artifact Status

Rendered PNG/PDF/SVG artifacts exist for the diagrams that were manually rendered during this diagram package work. Generated artifacts are intentionally ignored by `.gitignore`; PlantUML sources and notes are intended to remain trackable.
