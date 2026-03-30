---
name: crm-debug-tests
description: Repo-specific debugging and test workflow for the CRM Support SaaS backend. Use when Codex is debugging failing tests, choosing targeted Jest runs, adding regression coverage, inspecting service or endpoint test patterns, or validating changes in this repository.
---

# CRM Debug Tests

## Overview

Use this skill when the task is mainly about reproducing, debugging, or covering behavior with tests.

Keep runs targeted first. Do not default to the full suite unless the change is broad or the failure surface is unclear.

## Workflow

1. Read `references/test-workflow.md`.
2. Pick the smallest useful test slice first.
3. Match the existing test style for the affected layer.
4. Add regression coverage when the bug or rule change is not already protected.
5. Expand outward only if the first targeted run suggests broader fallout.
