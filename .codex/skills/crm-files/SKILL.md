---
name: crm-files
description: File-storage rules for the CRM Support SaaS backend. Use when Codex is working on uploads, downloads, file metadata, file links, storage adapters, or file-related API behavior and tests in this repository.
---

# CRM Files

## Overview

Use this skill for the Files module and its storage and linking behavior.

Pair it with `crm-core-backend` for general backend work and with `crm-api-docs` when documenting endpoints.

## Workflow

1. Read `references/file-rules.md`.
2. Preserve the stable download route contract.
3. Keep object metadata and polymorphic links distinct.
4. Apply the storage and linking implementation rules before changing provider or endpoint behavior.
5. Preserve role permissions and backend-streamed download behavior.
