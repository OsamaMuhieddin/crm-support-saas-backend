---
name: crm-api-docs
description: API documentation rules for the CRM Support SaaS backend. Use when Codex is creating or editing API reference docs, quick-start flows, request or response examples, authorization sections, or endpoint documentation for this repository.
---

# CRM API Docs

## Overview

Use this skill when editing `docs/api.md` or any endpoint reference content.

Load only the docs rules reference unless the task also changes product behavior that requires another skill.

## Workflow

1. Read `references/docs-rules.md`.
2. Keep the required docs section order.
3. Make all examples match the real response envelope.
4. Reflect real implementation behavior; do not document invented request fields, responses, or side effects.
5. Use compact action responses in docs when the endpoint is an action route.
