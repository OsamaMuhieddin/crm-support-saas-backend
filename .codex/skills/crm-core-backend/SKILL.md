---
name: crm-core-backend
description: Core repository rules for the CRM Support SaaS backend. Use when Codex is editing backend modules, routes, controllers, services, models, validators, or shared utilities in this repo and needs the architecture, response-envelope, validation, and cross-module guardrails without loading module-specific product details.
---

# CRM Core Backend

## Overview

Use this skill for the repo-wide backend rules that apply almost everywhere.

If the task is clearly about docs, tickets, files, localization, workspaces/auth, or debugging/tests, prefer the narrower skill for that area.

## Workflow

1. Read `references/core-rules.md`.
2. Keep the modular Express structure intact.
3. Enforce the shared response and validation contract.
4. Apply the implementation rules before writing code, especially layer ownership and action-response behavior.
5. Defer to a narrower `crm-*` skill when the task enters a heavy module domain.
