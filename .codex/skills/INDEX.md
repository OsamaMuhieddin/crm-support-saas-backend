# Repo Skill Index

Use this file as the lightweight entry point to the repo-local skills. Prefer the narrowest matching skill for the task.

## Skills

- `crm-core-backend`
  Use for general backend implementation in this repo: routes, controllers, services, models, validators, shared rules, response envelope, and module structure.

- `crm-api-docs`
  Use for `docs/api.md` and other endpoint documentation work: quick-start flows, auth model sections, request and response examples, and action-response docs.

- `crm-tickets`
  Use for tickets, messages, assignment, participants, categories, tags, lifecycle rules, and ticket-specific tests or docs.

- `crm-files`
  Use for uploads, downloads, storage adapters, file metadata, file links, and file-related permissions or tests.

- `crm-workspaces-auth`
  Use for sessions, JWT claims, active workspace context, invites, memberships, switching workspaces, and auth-related tests or docs.

- `crm-localization`
  Use for locale files, message keys, localized responses, validation keys, Arabic text integrity, and localization tests.

- `crm-mailboxes-sla-customers`
  Use for mailboxes, SLA business hours and policies, organizations, contacts, identities, and related module behavior or tests.

- `crm-debug-tests`
  Use when the task is mainly about reproducing bugs, choosing targeted Jest runs, adding regression coverage, or debugging test failures.

- `crm-support-backend`
  Use only when the task spans multiple domains or no narrower skill clearly fits. This is the umbrella skill, not the default first choice.

## Selection rule

1. Pick the narrowest skill that matches the task.
2. Pair with `crm-core-backend` when a domain skill also needs general implementation rules.
3. Use `crm-support-backend` only for cross-domain work or initial repo-wide orientation.
