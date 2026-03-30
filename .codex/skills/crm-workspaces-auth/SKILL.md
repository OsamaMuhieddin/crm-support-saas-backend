---
name: crm-workspaces-auth
description: Workspace-context and auth rules for the CRM Support SaaS backend. Use when Codex is working on sessions, JWT claims, workspace switching, memberships, invites, auth flows, access control, or workspace-context tests and docs in this repository.
---

# CRM Workspaces Auth

## Overview

Use this skill for workspace context, sessions, invites, memberships, and auth behavior.

This skill is intentionally narrow because workspace switching and token rules are easy to regress.

## Workflow

1. Read `references/workspace-auth-rules.md`.
2. Preserve the session-backed active workspace model.
3. Never auto-switch active workspace outside the explicit switch endpoint.
4. Apply the auth implementation rules before changing tokens, sessions, invites, or workspace selection behavior.
5. Keep docs and responses aligned with workspace-scoped token behavior.
