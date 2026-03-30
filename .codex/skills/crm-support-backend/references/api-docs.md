# API Docs

## Required section order

1. Include `Auth model & authorization model`
2. Include `Quick Start Flows` before endpoint reference sections
3. Define shared headers once near the top

## Endpoint entry requirements

Every endpoint entry should include:

- purpose
- request schema
- success shape
- common errors
- anti-enumeration notes when applicable

## Style rules

- Prefer concrete requirement statements over internal middleware or guard names
- Keep all examples consistent with the shared response envelope
- Include `messageKey` in success examples

## Action response convention

For action endpoints such as `activate`, `deactivate`, `set-default`, `assign`, `unassign`, `self-assign`, `status`, `solve`, `close`, and `reopen`:

- Prefer compact action responses
- Return only the resource id, directly changed fields, and any action-specific metadata
- Do not use action endpoints as a substitute for full detail payloads
