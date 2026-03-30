# File Rules

## Module and storage

- Module path: `src/modules/files`
- Storage abstraction: `src/infra/storage`
- Primary provider is MinIO or another S3-compatible provider
- Local adapter exists for tests and dev fallback

## Contracts and data model

- Public download contract is fixed at `GET /api/files/:fileId/download`.
- v1 uses backend-streamed downloads and does not expose public object URLs.
- `files` stores physical object metadata.
- `file_links` stores polymorphic relations and supports soft-delete.

## Permissions

- Upload: `owner|admin|agent`
- Delete: `owner|admin`
- `viewer` may read, list, and download only

## Guardrails

- Keep workspace isolation behavior aligned with the rest of the repo.
- Preserve the generic `file_links` relation model for reverse lookup and semantic ownership.

## Implementation rules

- Keep provider-specific object operations behind `src/infra/storage`; do not leak provider logic into controllers.
- Preserve backend-streamed downloads through the fixed route instead of returning provider URLs.
- Persist physical file metadata separately from relation rows; do not collapse `files` and `file_links` responsibilities.
- Create and remove file-link relations in service-layer workflows that own the business action.
- When changing upload or delete behavior, cover permission and cleanup paths with targeted tests.
