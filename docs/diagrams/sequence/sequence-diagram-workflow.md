# Sequence Diagram Workflow

This workflow exists to prevent app-wide sequence diagrams from being selected or drawn from assumptions. Every diagram must be backed by the implemented routes, controllers, middlewares, validators, services, models, tests, and docs for that exact flow.

## Baseline Rule

The rejected flat sequence diagram set is not reused.

Before this workflow was created, these rejected paths were checked and were not present:

- `docs/diagrams/sequence`
- `docs/sequence-diagrams.md`

Existing use-case diagrams under `docs/diagrams/use-cases` are separate documentation and must not be deleted, moved, or overwritten by sequence-diagram work.

## Selection Criteria

Choose app-wise flows by product and operational importance, not by module names alone.

Prioritize flows that are:

1. Revenue-critical.
2. Onboarding-critical.
3. Customer-facing.
4. Agent productivity-critical.
5. Admin or operations-critical.
6. Security or tenancy-critical.
7. Integration-critical.
8. Failure-critical or behaviorally complex.

If more than 15 useful flows are implemented, keep 10-15 as core diagrams and place the rest in a backlog instead of drawing everything at once.

## Required Inspection

Before selecting or drawing any diagram, inspect the relevant implementation instead of relying on existing use-case diagrams or high-level module names.

The app-wide baseline inspection includes:

- `src/app.js`
- `src/server.js`
- `src/routes/index.js`
- `src/modules/*/routes`
- `src/modules/*/controllers`
- `src/modules/*/services`
- `src/modules/*/models`
- `src/modules/*/validators`
- `src/shared/middlewares`
- `src/shared/services`
- `src/infra`
- `src/config`
- `tests`
- `docs/api.md`
- `docs/diagrams/use-cases`

Each individual diagram must also have a second, deeper inspection pass for its exact files before the `.puml` file is created.

## Folder Structure

Use one nested folder per sequence diagram. Do not use a flat source/png/pdf directory split for this project.

```text
docs/
  diagrams/
    sequence/
      sequence-diagram-workflow.md
      sequence-diagram-plan.md
      01-public-widget-conversation/
        public-widget-conversation.puml
        public-widget-conversation.png
        public-widget-conversation.pdf
        public-widget-conversation.svg
        notes.md
```

Every diagram folder must contain:

- `<diagram-name>.puml`
- `<diagram-name>.png`
- `<diagram-name>.pdf`
- `<diagram-name>.svg`
- `notes.md`

`notes.md` must include:

- Purpose and app importance.
- Implementation status.
- Source files inspected.
- Participants included.
- Participants intentionally excluded.
- Main success path.
- Important alternate and error paths.
- Rendering command notes.
- Remaining uncertainties, if any.

## One-By-One Approval Process

Sequence diagrams are generated one at a time.

1. Create and approve the app-wide plan first.
2. The user chooses Diagram 01 or asks for changes to the plan.
3. Inspect the selected flow deeply before drawing.
4. Create only that diagram folder.
5. Create `notes.md` before or alongside the source diagram so the evidence is documented.
6. Create the PlantUML source file.
7. Render PNG, SVG, and PDF.
8. Inspect the rendered files for syntax, blank output, clipping, and readability.
9. Summarize the completed diagram and wait for approval before moving to the next one.

Do not batch-generate the full set unless the user explicitly changes this workflow.

## Source Format

Use PlantUML `.puml` as the source of truth unless a diagram-specific technical constraint makes Mermaid more appropriate.

PlantUML is preferred because it supports sequence participants, activation bars, `alt`, `else`, `opt`, notes, page sizing, and stable PNG/SVG export.

## Diagram Style Rules

Diagrams must be implementation-backed and deeper than top-level route/controller summaries.

Keep diagrams compact enough to read at normal zoom. The diagram should explain the app-level flow, not replay every helper call or model query.

Include these participants when they are real for the flow:

- Actor or user.
- UI page, browser client, widget client, API client, or external sender.
- Controller.
- Auth middleware.
- Role, permission, or workspace-context middleware.
- Validator.
- Service.
- Model participants.
- External provider only when represented in code, configuration, tests, or docs.

For broad app flows, grouping is allowed and preferred when separate lanes would make the diagram too wide or tall. Examples:

- `Routes + Validation`
- `Auth + Workspace Guards`
- `Domain Models`
- `Billing + Storage`
- `Email/OTP Service`

Do not invent participants that do not exist in the implementation.

Do not expose MongoDB, Mongoose internals, database drivers, or collections as actors. Model participants are allowed when they help explain the implemented behavior.

Use consistent participant names across diagrams. Prefer names such as:

- `AuthMiddleware`
- `WorkspaceContext`
- `RoleGuard`
- `Validator`
- `WidgetPublicController`
- `WidgetPublicService`
- `TicketService`
- `BillingService`
- `Stripe`

Show meaningful app-level interactions. Do not include every private helper, projection, save call, or repeated model lookup if it makes the diagram unreadable without changing the flow understanding.

Use `alt`, `else`, and `opt` blocks sparingly. Draw only branches that materially change the product outcome. Put routine error cases in `notes.md` instead of drawing a stack of nested alternates.

The preferred numbering style is phase numbering only. Do not autonumber every arrow by default. Use section dividers such as:

- `== 1. Bootstrap/session ==`
- `== 2. Optional attachment upload ==`
- `== 3. Send message ==`

Use `alt`, `else`, and `opt` blocks for important behavior:

- Validation failures return `422` with `errors.validation.failed`.
- Auth, role, permission, and workspace failures return the standard error envelope.
- Optional provider calls are shown only when implemented.
- Idempotency, replay, and duplicate handling are shown for webhook and integration flows when implemented.
- Business-rule branches are shown when they materially affect the app outcome.

If a flow becomes too large, split it into two diagrams instead of shrinking the text until it is unreadable.

As a practical size target, prefer diagrams that fit a single landscape PDF page with readable text. If a rendered diagram becomes very tall, first reduce participants, group model lanes, remove low-level messages, and move detailed errors into `notes.md`.

## Rendering Rules

Required outputs for each approved diagram:

- `.puml`
- `.png`
- `.pdf`
- `.svg`

PNG and SVG should be rendered directly from the PlantUML source where possible.

PDF rendering must avoid default print headers and footers. It must not include:

- Date or time at the top.
- Source file path at the bottom.
- Browser URL.
- Page number footer.

PDFs must not be clipped or cut at the edges. Use enough padding and a large landscape page when needed.

Recommended PDF approach when PlantUML direct PDF output is not reliable:

1. Render SVG from PlantUML.
2. Place the SVG in a minimal local HTML wrapper.
3. Use browser PDF export with headers and footers disabled.
4. Use a large landscape page and explicit padding.

The HTML wrapper should use rules equivalent to:

```css
@page {
  size: A3 landscape;
  margin: 0;
}

html,
body {
  margin: 0;
  padding: 24mm;
  background: #ffffff;
}

img,
svg {
  display: block;
  max-width: 100%;
  max-height: 100%;
}
```

If a diagram is still too wide, use a larger landscape page, increase participant wrapping, or split the flow.

## Validation Checklist

After rendering an approved diagram:

1. Confirm the `.puml` syntax renders without errors.
2. Confirm PNG, SVG, and PDF files exist.
3. Confirm each rendered file has non-zero size.
4. Confirm the PDF begins with a valid PDF header when inspected.
5. Open or inspect the outputs enough to confirm they are not blank.
6. Check the PDF has no date/time header and no source path footer.
7. Check the diagram is not clipped on any edge.
8. Check participant names and messages match the inspected implementation.
9. Record commands and any limitations in `notes.md`.

## Approval Boundary

This document defines the workflow only. The app-wide plan is documented separately in `sequence-diagram-plan.md`.

No sequence diagram source or rendered diagram should be created until the user approves the plan and chooses the first diagram.
