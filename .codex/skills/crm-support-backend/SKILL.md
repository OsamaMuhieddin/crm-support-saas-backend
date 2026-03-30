---
name: crm-support-backend
description: Umbrella guidance for the CRM Support SaaS backend. Use when a task spans multiple backend domains in this repository, when no narrower crm-* skill cleanly fits, or when Codex needs a broad cross-module view before choosing more specific repo skills.
---

# CRM Support Backend

## Overview

Use this skill for cross-domain tasks and repo-wide orientation, not as the default for every single change.

Keep this file lean. Read only the reference files needed for the current task.

## Workflow

1. Read the repo task and identify whether it spans multiple domains.
2. Use a narrower `crm-*` skill first when one clearly fits.
3. Load only the relevant references from `references/`.
4. Preserve the modular Express structure under `src/modules`.
5. Enforce the shared response envelope, localization rules, and validation contract.
6. For docs work, follow the required API docs structure and keep examples consistent with the response envelope.

## Reference Map

- `references/architecture.md`: module layout, layer boundaries, repo structure
- `references/response-contract.md`: success/error envelope and validation failure shape
- `references/localization.md`: `x-lang`, locale-file integrity, translation update rules
- `references/tenancy.md`: workspace/session model and workspace switch invariants
- `references/files.md`: Files v1 storage, linking, and permission rules
- `references/tickets.md`: Tickets v1 behavior, message flow, assignment, and participant rules
- `references/module-notes.md`: Mailboxes, Customers, and SLA constraints
- `references/api-docs.md`: required docs ordering, endpoint entry format, and action-response convention

Prefer the narrow skill instead of this umbrella when available:

- `crm-core-backend`
- `crm-api-docs`
- `crm-tickets`
- `crm-files`
- `crm-workspaces-auth`
- `crm-localization`
- `crm-mailboxes-sla-customers`
- `crm-debug-tests`

## Operating Rules

- Treat `AGENTS.md` and repo docs as the source of truth if implementation and this skill ever drift.
- Do not invent product behavior outside the current v1 rules unless the user explicitly asks for it.
- Keep shared cross-module helpers in `src/shared/*`; keep module-local pure helpers in module `utils/`.
- When touching localized responses, update both `en.json` and `ar.json` together and keep Arabic strings Arabic-only.
- When changing workspace context behavior, preserve the rule that only `POST /api/workspaces/switch` may change the active workspace.
- When editing ticket or file flows, preserve workspace scoping and anti-enumeration behavior.
