# Ticket Rules

## Core model behavior

- Tickets are protected workspace-scoped endpoints.
- One conversation is created per ticket through `ticket.conversationId`.
- Ticket numbers are workspace-scoped incremental numbers from `TicketCounter`.
- `POST /api/tickets` is allowed for `owner|admin|agent`.
- `mailboxId` defaults from `workspace.defaultMailboxId` when omitted.

## Write invariants

- Ticket mailbox may change only while `messageCount = 0`.
- Ticket mailbox and conversation mailbox must stay in sync.
- Ticket writes require active same-workspace category and tag references.
- Ticket detail may still hydrate already-linked inactive category or tag references for history.

## Message flow

- `customer_message` moves status to `open`.
- `public_reply` moves status to `waiting_on_customer`.
- `internal_note` does not change status.
- Closed tickets accept `internal_note` only until explicit reopen.

## Attachments

- Upload through `/api/files` first.
- Link to the message as semantic owner.
- Link to the ticket for reverse lookup.

## Assignment and participants

- Assignment is single-assignee only.
- `owner|admin` may assign any active operational member in `owner|admin|agent`.
- `agent` must use `POST /api/tickets/:id/self-assign`.
- `agent` cannot take a ticket assigned to another user.
- Participants are internal metadata only with `watcher|collaborator`.
- Participants do not grant access and are not auto-created from assignees or requesters.

## Implementation rules

- Keep ticket lifecycle and message side effects in services, not controllers.
- Validate mailbox, contact, category, and tag references before mutating ticket state.
- When mailbox changes are allowed, update both ticket and conversation mailbox fields together.
- When message attachments are used, create or preserve both the message-semantic link and the ticket reverse-lookup link.
- Do not infer participant rows from assignee, requester, or message authors unless the product rules explicitly change.
- Keep assignment restrictions explicit in service logic, especially the agent self-assign limitation.
- Add targeted tests for status transitions, assignment permissions, mailbox mutation rules, and attachment-link behavior when those areas change.
