# Module Notes

## Mailboxes v1

- Module path: `src/modules/mailboxes`
- Mounted base route: `/api/mailboxes`
- No delete endpoint in v1
- `type` is currently constrained to `email`
- RBAC:
  - `owner|admin`: read and mutate
  - `agent|viewer`: read-only
- Default mailbox rules:
  - exactly one default mailbox per workspace
  - `workspace.defaultMailboxId` must match mailbox `isDefault`
  - default mailbox must stay active
  - default mailbox cannot be deactivated
  - last active mailbox cannot be deactivated

## Customers v1

- Module path: `src/modules/customers`
- Mounted base route: `/api/customers`
- Organizations and contacts are workspace-scoped dictionaries
- Contacts may link to same-workspace organizations
- Identities are lightweight rows linked to a contact
- Do not invent portal auth, customer verification, delete/archive, or timeline features unless explicitly requested

## SLA v1

- Module path: `src/modules/sla`
- Business hours and SLA policies are separate workspace-scoped records
- Workspace default policy is canonical through `workspace.defaultSlaPolicyId`
- Mailboxes may override SLA policy via `slaPolicyId`
- SLA selection order:
  - mailbox override
  - workspace default
  - otherwise no SLA
- Active dimensions:
  - first response
  - resolution
- Runtime rules:
  - first response is satisfied only by the first `public_reply`
  - resolution is active for `new`, `open`, `pending`
  - resolution pauses on `waiting_on_customer`
  - resolution is satisfied by `solved`
  - `closed` is downstream/admin lifecycle only
  - reopen resumes from remaining business time
- Do not add queues, reminders, escalations, next-response SLA, holidays, or cycle-history logic unless explicitly requested
