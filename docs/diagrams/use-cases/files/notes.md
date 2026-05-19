# Files and Attachments Use Case Diagram Notes

## Actors included

- Workspace Member: authenticated member who can read file metadata and download workspace files.
- Workspace Manager (Owner/Admin): member with upload, delete, and attachment-management privileges.
- Agent: operational member who can upload files and attach files through ticket workflows.
- Viewer: read-only member who can list, inspect, and download files but cannot upload or delete.
- Customer / Widget Visitor: public widget user who can upload widget attachments and attach them to widget messages.

## Actors intentionally excluded

- MinIO, S3-compatible storage, local storage adapter, filesystem, MongoDB, Mongoose, Express, JWT, Redis, queues, and internal workers are implementation details.
- External Storage Provider is excluded because the implemented behavior does not expose a business-facing provider interaction to users.
- System / Scheduler is excluded because file upload, linking, download, and deletion are request-driven in the implemented scope.

## Use cases included

- View/List Files
- View File Metadata
- Download File
- Stream File Download
- Upload File
- Delete File
- Soft-Delete File and Links
- Use File as Attachment
- Validate File Access and Readiness
- Manage File Links
- Link File to Ticket Message
- Link File to Ticket
- Upload Widget Attachment
- Attach Widget File to Message

## CRUD and grouping decisions

- File read operations are grouped as View/List Files and View File Metadata instead of separate filtered listing use cases.
- File-link service operations are grouped under Manage File Links, while ticket/message attachment linking remains visible because it is a major support workflow.
- Storage details, checksum generation, size validation, MIME checks, and billing usage refresh are documented here instead of rendered as separate use cases.

## Implemented behavior reflected

- Upload is available to owner, admin, and agent roles for authenticated workspace routes.
- Viewer can list, inspect, and download files, but cannot upload or delete.
- Delete is restricted to owner and admin roles.
- Downloads use the backend route `/api/files/:fileId/download`; provider object URLs are not exposed as the public contract.
- File metadata is stored separately from file links. `files` stores physical object metadata, while `file_links` stores polymorphic relations.
- Deleting a file removes the storage object when possible, soft-deletes the file record, marks storage status as deleted, and soft-deletes active links.
- File links are idempotent and can revive a soft-deleted relation when the same relation is created again.
- Ticket attachments are uploaded first, then linked by `attachmentFileIds` to a ticket message and to the root ticket for reverse lookup.
- Ticket message attachment validation rejects foreign-workspace, deleted, failed, missing, or already-linked files.
- Widget attachments are implemented through the public widget file upload route. Widget message attachment validation requires the uploaded file to belong to the same active widget session and not already be linked to another message.

## Files inspected

- `src/modules/files/routes/files.routes.js`
- `src/modules/files/controllers/files.controller.js`
- `src/modules/files/services/files.service.js`
- `src/modules/files/services/file-links.service.js`
- `src/modules/files/models/file.model.js`
- `src/modules/files/models/file-link.model.js`
- `src/modules/files/docs/openapi.js`
- `src/infra/storage/index.js`
- `src/modules/tickets/services/ticket-messages.service.js`
- `src/modules/tickets/services/tickets.service.js`
- `src/modules/widget/services/widget-public.service.js`
- `docs/api.md`
- `tests/files.test.js`
- `tests/file-links.service.test.js`
- `tests/ticket-messages.test.js`
- `tests/widgets.test.js`

## Styling and rendering decisions

- The editable PlantUML file keeps the same title, actor, boundary, and use-case styling pattern as the accepted diagrams.
- Rendered PNG, SVG, and PDF outputs use a manual landscape layout to keep association lines readable and avoid lines crossing use-case text.
- The XMI file is a lightweight UML interchange artifact generated from the PlantUML source when local tooling is available.

## Uncertain or omitted areas

- Storage providers are intentionally omitted as actors because they are adapters behind the storage abstraction.
- Detailed upload validation rules are intentionally omitted from the rendered diagram to avoid noisy implementation-level use cases.
- There is no separate full use case for billing file usage refresh because it is an internal side effect of upload/delete behavior in this diagram's scope.
