# Docs Rules

## Required sections

1. Include `Auth model & authorization model`.
2. Include `Quick Start Flows` before endpoint reference sections.
3. Define shared headers once near the top.

## Endpoint entry checklist

Every endpoint entry should include:

- purpose
- request schema
- success shape
- common errors
- anti-enumeration notes when applicable

## Style rules

- Prefer concrete requirement statements over middleware or guard names.
- Keep examples consistent with the repo response envelope.
- Include `messageKey` in success examples.

## Implementation sync rules

- Document only behavior that exists in code or is being added in the same change.
- If the code changes request validation, response shape, or permissions, update docs in the same change when the route is documented.
- Prefer endpoint requirements stated in business terms such as role or workspace conditions instead of internal implementation names.
- Keep anti-enumeration notes aligned with the actual not-found or forbidden behavior.

## Action responses

For routes such as `activate`, `deactivate`, `set-default`, `assign`, `unassign`, `self-assign`, `status`, `solve`, `close`, and `reopen`:

- document compact action responses
- return the resource id, changed fields, and action-specific metadata only
- do not document full detail payloads unless that route actually returns them
