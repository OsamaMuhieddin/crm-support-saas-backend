---
name: crm-localization
description: Localization and message-key rules for the CRM Support SaaS backend. Use when Codex is editing locale files, localized messages, validation keys, error or success response text, or localization-related tests in this repository.
---

# CRM Localization

## Overview

Use this skill when touching localized response text or locale catalogs.

The goal is to keep message keys stable while maintaining clean English and Arabic catalogs.

## Workflow

1. Read `references/localization-rules.md`.
2. Update both locale files when adding keys.
3. Keep Arabic values Arabic-only.
4. Apply the localization implementation rules before adding or renaming user-facing messages.
5. Preserve the existing message-key driven response pattern.
