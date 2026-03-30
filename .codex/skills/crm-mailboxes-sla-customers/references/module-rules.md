# Module Rules

## Mailboxes v1

- Mailboxes are workspace-scoped operational dictionaries.
- Writes are restricted to `owner|admin`; `agent|viewer` are read-only.
- No delete endpoint in v1.
- `type` is currently constrained to `email`.
- Exactly one default mailbox must exist per workspace.
- `workspace.defaultMailboxId` must match mailbox `isDefault`.
- Default mailbox must stay active.
- Default mailbox cannot be deactivated.
- The last active mailbox cannot be deactivated.

## Customers v1

- Organizations and contacts are workspace-scoped dictionaries.
- Contacts may link to same-workspace organizations.
- Identities are lightweight rows linked to a contact.
- Do not invent customer portal auth, verification, delete or archive flows, or timeline features unless explicitly requested.

## SLA v1

- Business hours and SLA policies are separate workspace-scoped records.
- Workspace default policy is canonical through `workspace.defaultSlaPolicyId`.
- Mailboxes may override SLA selection via `slaPolicyId`.
- Selection order is mailbox override, then workspace default, then no SLA.
- First response is satisfied only by the first `public_reply`.
- Resolution is active for `new`, `open`, and `pending`.
- Resolution pauses on `waiting_on_customer`.
- Resolution is satisfied by `solved`.
- `closed` is downstream lifecycle only.
- Reopen resumes from remaining business time.
- Do not add reminders, queues, escalations, holidays, or cycle-history logic unless explicitly requested.

## Implementation rules

- Keep mailbox default alignment logic in the service layer so `workspace.defaultMailboxId` and mailbox `isDefault` stay canonical together.
- Preserve the no-delete operational model for mailboxes unless the product rules explicitly change.
- Keep customer organization and contact relations same-workspace only.
- Treat customer identities as lightweight child rows rather than a separate auth system.
- Keep SLA selection order explicit in service logic: mailbox override, then workspace default, then no SLA.
- Derive SLA runtime behavior from ticket events and stored SLA snapshot fields rather than hidden writes during reads.
- Add targeted tests when changing default mailbox behavior, customer relation rules, or SLA selection and runtime logic.
