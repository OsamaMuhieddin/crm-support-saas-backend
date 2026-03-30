---
name: crm-tickets
description: Ticket-domain rules for the CRM Support SaaS backend. Use when Codex is working on tickets, ticket messages, assignment, participants, ticket categories, ticket tags, lifecycle actions, mailbox/category/tag references, or ticket-related tests and docs in this repository.
---

# CRM Tickets

## Overview

Use this skill for the ticket domain and adjacent ticket dictionaries.

If the change also touches general repo rules, pair this with `crm-core-backend`. If it touches only API docs, pair it with `crm-api-docs`.

## Workflow

1. Read `references/ticket-rules.md`.
2. Preserve workspace scoping and anti-enumeration behavior.
3. Preserve the manual-first message and assignment rules.
4. Apply the ticket implementation rules before changing status, assignment, message, or dictionary behavior.
5. Keep ticket and conversation mailbox state aligned.
