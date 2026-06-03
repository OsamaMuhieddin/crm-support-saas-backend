# Use Case Diagram Workflow

This file records the agreed workflow for creating academic UML use case diagrams for Masar - CRM Support SaaS. Use it when starting a new chat/window so the diagram plan stays consistent.

## Overall Plan

Create the use case diagrams as a split set, not as one huge diagram. The target plan is 15 items, but each one must still be confirmed against the implemented code before it is created.

1. System Context Diagram.
2. Auth, Sessions & Workspace Diagram.
3. Workspace User Management Diagram.
4. Ticket Operations Diagram.
5. Ticket Messages, Participants & Attachments Diagram.
6. Customers & Contacts Diagram.
7. Mailboxes Diagram.
8. SLA Diagram.
9. Files Diagram.
10. Widget & Public Customer Flow Diagram.
11. Realtime Collaboration Diagram.
12. Billing Diagram.
13. Reports Diagram.
14. Platform Admin Diagram.
15. Final Cross-Check Diagram/Index.

The exact split can change if code inspection shows a module is empty, placeholder-only, or better grouped with another domain. In particular, `Users, Roles & Memberships` may become a smaller membership/role-scope diagram or a notes-only section if user management is still mostly placeholder. `Widget & Public Customer Flow` can be split into widget admin and public widget diagrams only if inspection shows it becomes too crowded. The final cross-check should usually be an index and coverage checklist, not another large UML diagram.

## Diagram Source Checklist

Use this as the starting inspection checklist for each diagram. Add extra files if code inspection reveals cross-module behavior.

1. System context: inspect `src/routes/index.js`, all `src/modules/*/routes`, all `src/modules/*/controllers`, all `src/modules/*/docs/openapi.js`, `docs/api.md`, and a broad inventory of `tests/`.
2. Auth, Sessions & Workspace: inspect auth routes/controllers/services/docs, workspace routes/controllers/services/docs, session and OTP services, shared email service, and auth/workspace/invite tests.
3. Workspace User Management: inspect workspace member routes/controllers/services/docs, workspace invite behavior, role checks, auth/workspace tests, and placeholder status for global user management.
4. Ticket Operations: inspect ticket routes/controllers/services/docs, ticket models/schemas/validators where needed, ticket lifecycle/assignment/category/tag behavior, and ticket operation tests.
5. Ticket Messages, Participants & Attachments: inspect ticket message/conversation controllers/services/docs, participant behavior, file-link behavior for message attachments, and message/participant/attachment tests.
6. Customers & Contacts: inspect customer organization/contact/contact-identity routes/controllers/services/docs and customer-domain tests.
7. Mailboxes: inspect mailbox routes/controllers/services/docs, mailbox model/default-mailbox behavior, workspace default mailbox behavior, and mailbox tests.
8. SLA: inspect SLA routes/controllers/services/docs, business-hours/policy/runtime services, ticket SLA runtime behavior, and SLA tests.
9. Files: inspect file routes/controllers/services/docs, storage abstraction only as implementation notes, file-link models/services, and upload/download/link tests.
10. Widget & Public Customer Flow: inspect widget routes/controllers/services/docs, widget admin/configuration behavior, public ticket/customer/file flows, realtime/public session behavior if relevant, and widget tests.
11. Realtime Collaboration: inspect realtime routes/controllers/services/docs, socket/session/auth behavior, widget realtime behavior if implemented, and realtime tests.
12. Billing: inspect billing routes/controllers/services/docs, provider adapter, webhook handling, sync/job-worker services, and billing tests.
13. Reports: inspect reports routes/controllers/services/docs and report aggregation tests.
14. Platform Admin: inspect admin routes/controllers/services/docs, platform admin auth/workspace/billing/trial behavior, and admin tests.
15. Final Cross-Check Diagram/Index: inspect all diagram notes, generated folders, `src/routes/index.js`, mounted placeholder modules such as inbox/integrations/users, and broad test/docs coverage to confirm no implemented major module was missed.

## Core Decisions

- Use academic UML use case style.
- Always inspect the repository before designing a diagram.
- Do not invent behavior that is not supported by routes, controllers, services, docs, or tests.
- Keep infrastructure out of actor lists.
- Exclude MongoDB, Redis, queues, MinIO, local storage adapters, Express, Mongoose, JWT libraries, Socket.IO internals, and internal workers as actors.
- Include external providers only when they are business-facing external systems.
- Use `Email Provider (Hostinger SMTP)` when OTP, password reset, invite, or other email delivery is part of the implemented flow.
- Use `Billing Provider (Stripe)` for billing user flows, subscription changes, checkout/portal behavior, and billing webhooks.
- Use `System / Scheduler` only for automated business behavior, not for generic background infrastructure.
- Group simple CRUD as `Manage X` in context diagrams.
- Keep important workflows separate when grouping would hide meaningful scope.
- Use abstract actors to reduce duplicate lines when roles share the same use cases, for example `Workspace Manager (Owner/Admin)`.
- Keep rendered diagrams visually close to the system context style: plain actors, plain use case ovals, light-gray associations, no colored line bundles.
- Follow the visual/layout pattern of the existing System Context and Auth/Workspace diagrams.
- Draw association lines behind use case ovals in rendered exports so lines do not visibly cross on top of use cases.
- Boundary title consistency passes must only adjust the boundary title text/placement style and must not change diagram layout, use cases, actors, or association routing.
- For future diagrams, SVG export is optional. Prefer PlantUML source, PNG, PDF, XMI, and notes unless SVG is specifically useful.

## Folder And Files

Each diagram gets its own folder under:

```text
docs/diagrams/use-cases/
```

Recommended folder names:

- `system-context/`
- `auth-workspace/`
- `workspace-user-management/`
- `ticket-operations/`
- `ticket-messages-attachments/`
- `customers-contacts/`
- `mailboxes/`
- `sla/`
- `files/`
- `widget-public-flow/`
- `realtime/`
- `billing/`
- `reports/`
- `platform-admin/`
- `cross-check-index/`

Each folder should normally contain:

- `<diagram-name>.puml`
- `<diagram-name>.uml.xmi` when feasible
- `notes.md`

Generated rendered outputs should be ignored in `.gitignore`:

- `*.png`
- `*.svg`
- `*.pdf`
- `*.xmi` if the team chooses not to track XMI for that diagram
- `*.vpp`
- `*.vpdx`
- `*.log`

For the current diagrams, PlantUML source and notes are intended to be trackable. Rendered PNG/PDF outputs are generated artifacts. SVG is optional and should also be treated as generated if created.

## What To Inspect

For every diagram, inspect at least:

- `src/routes/index.js` when checking module mounting or cross-module scope.
- Relevant `src/modules/<module>/routes/`.
- Relevant `src/modules/<module>/controllers/`.
- Relevant `src/modules/<module>/services/`.
- Relevant `src/modules/<module>/docs/openapi.js`.
- Relevant tests under `tests/`.
- `docs/api.md` when checking project-level API documentation and quick-start flows.

If a module has no meaningful routes or only placeholder behavior, mention that in `notes.md` instead of overstating it in the diagram.

## Notes File Requirements

Every `notes.md` should explain:

- Scope of the diagram.
- Actors included.
- Actors intentionally excluded.
- Use cases included.
- Grouping decisions.
- Important business rules discovered from code/tests.
- Source files/routes/docs/tests inspected.
- Placeholder, uncertain, or intentionally omitted areas.
- Export/import notes, especially whether XMI or Visual Paradigm import is best-effort.

## Export Expectations

Try to produce:

- PlantUML source.
- PNG export.
- PDF export.
- XMI when feasible.
- SVG export only if specifically requested or useful for import/editing.

Visual Paradigm support is best-effort. If a reliable native `.vpp` or `.vpdx` export is not available, document that clearly and provide PlantUML and/or XMI as import candidates.

## Prompt Template

Use this prompt format for each new diagram:

```text
Create Diagram N: <Diagram Name> for Masar - CRM Support SaaS.

Before designing the diagram, inspect the actual repository so the diagram reflects implemented behavior, not assumptions. Check at least:
- <specific route files>
- <specific controller files>
- <specific service files>
- <specific openapi docs>
- <specific tests>
- docs/api.md if relevant

Goal:
Create a detailed academic use case diagram for <domain/scope>. This is not the whole-system context diagram unless explicitly stated.

Rules:
- Use academic UML use case style.
- Do not expose infrastructure actors like MongoDB, Redis, queues, MinIO, Express, Mongoose, JWT libraries, Socket.IO internals, or internal workers.
- Include external providers only when business-facing implemented behavior justifies them.
- Group simple CRUD as "Manage X" where appropriate.
- Keep important workflows separate when grouping would hide project scope.
- Use abstract actors where roles share the same use cases and duplicate lines would make the diagram hard to read.
- Keep the visual style consistent with existing diagrams: plain UML, light-gray associations, no colorful line bundles.
- If a module is placeholder-only, document it in notes instead of overstating it.

Expected actors to evaluate:
- <actor list>

Expected use cases to evaluate:
- <use case list>

Deliverables:
1. Create a new folder:
   docs/diagrams/use-cases/<folder-name>/

2. Add generated output ignore rules to .gitignore for this folder:
   - *.png
   - *.pdf
   - *.svg if SVG is generated
   - *.xmi if not intended to be tracked
   - *.vpp
   - *.vpdx
   - *.log

3. Produce:
   - <diagram-name>.puml
   - <diagram-name>.png
   - <diagram-name>.pdf
   - <diagram-name>.uml.xmi if feasible
   - <diagram-name>.svg only if requested or useful
   - notes.md

4. Diagram title:
   <Title>

5. System boundary title:
   Masar - CRM Support SaaS

6. The notes file should explain:
   - actors included
   - actors intentionally excluded
   - use cases included
   - grouping decisions
   - important code/test-backed business rules
   - files/routes/docs/tests inspected
   - placeholder or uncertain areas
   - export/import limitations

Important:
- Do not invent behavior.
- Use the repository's AGENTS.md rules.
- Use clickable local file links in the final response for every repo file mentioned.
- After creating files, summarize exactly what was created and whether PNG/PDF/XMI export succeeded. Mention SVG only if it was requested or generated.
```

## Next Recommended Prompt

The next diagram after `system-context` and `auth-workspace` should usually be Ticket Operations, because it is the core support workflow.

```text
Create Diagram 3: Ticket Operations Use Case Diagram for Masar - CRM Support SaaS.

Before designing the diagram, inspect the actual repository so the diagram reflects implemented behavior, not assumptions. Check at least:
- src/modules/tickets/routes/tickets.routes.js
- src/modules/tickets/controllers/
- src/modules/tickets/services/
- src/modules/tickets/docs/openapi.js
- src/modules/files/routes/files.routes.js if attachments are relevant
- src/modules/files/controllers/files.controller.js if attachments are relevant
- src/modules/files/docs/openapi.js if attachments are relevant
- relevant ticket lifecycle, assignment, self-assignment, category, tag, and permission tests under tests/
- docs/api.md if relevant

Goal:
Create the detailed academic use case diagram for ticket operations: ticket creation, listing/detail, updates, lifecycle/status actions, assignment, self-assignment, and category/tag usage. Leave detailed ticket messages, participants, and attachments for Diagram 5 unless code inspection shows they must be included here.

Rules:
- Use academic UML use case style.
- This is a detailed domain diagram, not the whole-system context diagram.
- Do not expose infrastructure actors.
- Group minor CRUD only where it does not hide meaningful ticket workflow.
- Keep lifecycle actions and assignment behavior visible if implemented.
- Do not over-expand message/conversation behavior in this diagram; that belongs to Diagram 5.
- Keep the visual style consistent with existing diagrams.

Expected actors to evaluate:
- Workspace Member
- Operational Member (Owner/Admin/Agent)
- Workspace Manager (Owner/Admin)
- Agent
- Viewer
- Email Provider only if implemented ticket email behavior justifies it
- Customer / Widget Visitor only if public widget ticket flows are included in this diagram; otherwise leave widget flows for the widget diagram
- System / Scheduler only if ticket SLA/runtime automation is included; otherwise leave SLA runtime for the SLA diagram

Expected use cases to evaluate:
- Manage Tickets
- Create Ticket
- View/List Tickets
- Update Ticket
- Change Ticket Status
- Solve/Close/Reopen Ticket
- Assign Ticket
- Self-Assign Ticket
- Unassign Ticket
- Use Ticket Category
- Use Ticket Tags

Deliverables:
1. Create:
   docs/diagrams/use-cases/ticket-operations/

2. Add generated output ignore rules to .gitignore for this folder.

3. Produce:
   - ticket-operations-use-case.puml
   - ticket-operations-use-case.png
   - ticket-operations-use-case.pdf
   - ticket-operations-use-case.uml.xmi if feasible
   - ticket-operations-use-case.svg only if requested or useful
   - notes.md

4. Diagram title:
   System Use Case Diagram - Ticket Operations (Masar)

5. System boundary title:
   Masar - CRM Support SaaS

Important:
- Do not invent behavior.
- Use the repository's AGENTS.md rules.
- Use clickable local file links in the final response for every repo file mentioned.
- After creating files, summarize exactly what was created and whether PNG/PDF/XMI export succeeded. Mention SVG only if it was requested or generated.
```
