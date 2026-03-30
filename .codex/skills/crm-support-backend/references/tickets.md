# Tickets v1

- Module path: `src/modules/tickets`
- Tickets are protected workspace-scoped endpoints, not public routes
- One conversation is created per ticket and linked through `ticket.conversationId`
- Ticket numbers are workspace-scoped incremental numbers from `TicketCounter`
- `POST /api/tickets` permission is `owner|admin|agent`
- `mailboxId` defaults from `workspace.defaultMailboxId` when omitted

## Write rules

- Ticket mailbox may change only while `messageCount = 0`
- Ticket mailbox and conversation mailbox must stay in sync
- Ticket writes require active same-workspace category/tag references
- Ticket detail may still hydrate already-linked inactive category/tag references for historical integrity

## Message flow

- `customer_message` sets status to `open`
- `public_reply` sets status to `waiting_on_customer`
- `internal_note` does not change status
- Closed tickets accept `internal_note` only until explicit reopen

## Attachments

- Message attachments are uploaded through `/api/files` first
- Then link them to the message as semantic owner
- Also link them to the ticket for reverse lookup

## Assignment and participants

- Assignment is single-assignee only
- `owner|admin` may assign any active operational member in `owner|admin|agent`
- `agent` must use `POST /api/tickets/:id/self-assign`
- `agent` cannot steal a ticket assigned to another user
- Participants are internal metadata only with `watcher|collaborator`
- Participants do not grant access and are not auto-created from assignees or requesters
