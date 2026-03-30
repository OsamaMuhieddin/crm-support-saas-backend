---
name: crm-mailboxes-sla-customers
description: Mailbox, SLA, and customer-domain rules for the CRM Support SaaS backend. Use when Codex is working on mailboxes, business hours, SLA policies, customer organizations, customer contacts, contact identities, or related API behavior and tests in this repository.
---

# CRM Mailboxes SLA Customers

## Overview

Use this skill for the medium-size operational modules that are important but do not need a separate skill each yet.

If the task is ticket-heavy, prefer `crm-tickets`. If it is docs-only, pair this with `crm-api-docs`.

## Workflow

1. Read `references/module-rules.md`.
2. Preserve workspace-scoped dictionaries and policy chains.
3. Keep mailbox default invariants canonical.
4. Apply the module implementation rules before changing mailbox defaults, SLA selection, or customer dictionaries.
5. Avoid inventing new customer or SLA features unless explicitly requested.
