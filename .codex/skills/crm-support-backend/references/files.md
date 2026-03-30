# Files v1

- Module path: `src/modules/files`
- Storage abstraction: `src/infra/storage`
- Primary provider is MinIO/S3-compatible with local fallback for tests/dev
- Public download contract is fixed at `GET /api/files/:fileId/download`
- v1 uses backend-streamed downloads; do not expose public object URLs

## Persistence

- `files` stores physical object metadata
- `file_links` stores generic polymorphic relations and supports soft-delete

## Permissions

- Upload: `owner|admin|agent`
- Delete: `owner|admin`
- `viewer` may read, list, and download only

## Behavioral guardrails

- Preserve the stable download route contract
- Keep workspace isolation behavior aligned with the rest of the codebase
- Treat file-link relations as the generic linking mechanism, including reverse lookup use cases
