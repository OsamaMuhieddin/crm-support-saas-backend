# Diagram 11: Realtime Collaboration

## Scope

This diagram covers the implemented realtime collaboration behavior for Masar - CRM Support SaaS. It includes the authenticated internal realtime bootstrap endpoint, Socket.IO authentication, workspace and ticket subscriptions, internal ticket collaboration signals, ticket business-event fan-out, user notices, session invalidation disconnect behavior, and the implemented public widget realtime subscription surface.

This is a detailed domain use case diagram, not the whole-system context diagram. REST and Mongo-backed ticket/customer/file records remain the source of truth; realtime is a live transport for UI updates and advisory collaboration signals.

## Actors Included

- `Workspace Member`: abstract actor for authenticated active workspace members who can connect, subscribe, receive live events, and inspect ticket collaboration snapshots.
- `Workspace Manager (Owner/Admin)`: inherits workspace-member realtime behavior and can use ticket collaboration signals on readable tickets.
- `Agent`: inherits workspace-member realtime behavior and can use ticket collaboration signals on readable tickets.
- `Viewer`: inherits workspace-member realtime behavior and can use advisory ticket collaboration signals on readable tickets, as covered by tests.
- `Customer / Widget Visitor`: public actor using widget-session realtime auth and widget subscription events.

## Actors Intentionally Excluded

- MongoDB, Mongoose, Express, JWT libraries, Socket.IO internals, Redis, queues, local memory stores, and internal workers are implementation details, not business actors.
- `System / Scheduler` is excluded. Presence, typing, and soft-claim TTL expiry exists, but it is runtime cleanup behavior rather than a business-visible scheduled workflow.
- Email Provider and Billing Provider are excluded because realtime does not directly initiate email or billing provider interactions.

## Use Cases Included

- `Get Realtime Bootstrap`: authenticated HTTP endpoint that returns socket path, transports, current user/workspace/role context, feature flags, collaboration TTLs, action throttle settings, and runtime mode metadata.
- `Connect to Realtime Socket`: socket connection using either internal access token auth or public widget session token auth.
- `Authenticate Realtime Session`: validates active user/session/workspace membership for internal sockets and validates active widget/session/mailbox context for widget sockets.
- `Disconnect Revoked or Invalid Sessions`: stale auth contexts are rejected on handshake or action refresh; session revocation flows disconnect matching sockets.
- `Subscribe to Workspace Room`: internal explicit subscription to the current workspace room.
- `Unsubscribe from Workspace Room`: internal explicit workspace room leave.
- `Subscribe to Ticket Room`: internal explicit subscription to a readable ticket room; cross-workspace tickets resolve as not found.
- `Unsubscribe from Ticket Room`: internal explicit ticket room leave and collaboration cleanup for that socket/ticket.
- `Receive Ticket Business Events`: implemented ticket events include ticket created/updated, assignment/unassignment, status/lifecycle changes, participant changes, message creation, and conversation updates.
- `Receive Conversation Updates`: conversation update events are emitted after ticket message writes and other widget-visible ticket changes.
- `Receive User Notices`: targeted `user.notice` events for ticket assignment, unassignment, and participant add/remove notices.
- `View Ticket Collaboration Snapshot`: `ticket.subscribe` immediately emits the current presence, typing, and soft-claim snapshot for the ticket.
- `Receive Collaboration State Updates`: subscribed ticket clients receive `ticket.presence.changed`, `ticket.typing.changed`, and `ticket.soft_claim.changed` when collaboration state changes or expires.
- `Set Ticket Presence`: advisory `viewing`, `replying`, or `internal_note` presence signal.
- `Start/Stop Typing Signal`: ephemeral typing signal for `public_reply` or `internal_note`.
- `Set/Clear Advisory Soft Claim`: advisory soft claim state that does not change ticket assignment or block writes.
- `Clear Collaboration State on Disconnect or Unsubscribe`: socket disconnect and ticket unsubscribe clear presence, typing, and soft-claim state for that socket/ticket.
- `Subscribe to Public Widget Realtime Updates`: public widget socket subscription using a valid `wgs_*` widget session token and `widget.subscribe`.
- `Unsubscribe from Public Widget Realtime Updates`: public widget socket leaves the verified widget-session room through `widget.unsubscribe`.
- `Receive Public Widget Message/Conversation Updates`: public widget events are `widget.message.created` and `widget.conversation.updated`.

## Grouping Decisions

- Low-level room names, ack envelope fields, Redis adapter state, and socket transport details are documented here instead of rendered as separate use cases.
- Ticket business events are grouped in one use case because they are emitted from many ticket write flows already covered by the ticket diagrams.
- Widget realtime is intentionally limited to subscription and message/conversation events so this diagram does not duplicate the full widget public flow from Diagram 10.
- Presence, typing, and soft claim remain separate because they are distinct user-facing collaboration behaviors with different payloads, TTLs, and client actions.

## Internal Realtime Auth and Bootstrap Behavior

- `GET /api/realtime/bootstrap` requires authentication, active user status, and active workspace membership.
- Bootstrap returns the current authenticated workspace context; clients do not choose another workspace through realtime bootstrap.
- Internal socket auth accepts access tokens through the socket auth payload or authorization header.
- Socket action handlers refresh auth context before handling actions. Auth failures return an error ack and disconnect stale sockets.
- Session revocation through logout, logout-all, password change, password reset, and workspace switching disconnects matching realtime sockets on a best-effort basis.

## Subscription and Tenant Rules

- Workspace subscription defaults to the socket's active workspace when no workspace id is supplied.
- Requesting a different workspace id fails with a tenant-forbidden error.
- Ticket subscription validates a readable ticket in the authenticated workspace and rejects foreign tickets as ticket not found.
- Collaboration actions require an existing ticket subscription when the configured `requiresTicketSubscription` flag is enabled.
- Ticket unsubscribe clears that socket's collaboration state for that ticket.

## Collaboration Behavior

- Presence states are `viewing`, `replying`, and `internal_note`.
- Typing modes are `public_reply` and `internal_note`.
- Soft claim is advisory, can be overwritten, expires, and does not modify the ticket document or prevent ticket updates.
- Presence, typing, and soft-claim state are ephemeral and have advertised TTL values in realtime bootstrap.
- Duplicate refreshes within the throttle window are accepted quietly; conflicting bursts inside the throttle window are rejected with a realtime rate-limit error.
- Disconnect cleanup removes presence, typing, and soft-claim state for remaining subscribers.
- Viewer members can use advisory collaboration signals on tickets they can read.

## Business Event Behavior

- Ticket create emits `ticket.created`.
- Ticket create with an initial message emits `ticket.created`, then `message.created`, then `conversation.updated`.
- Ticket updates emit `ticket.updated` only when the live payload changes.
- Assignment, unassignment, and self-assignment emit room events; assignment/unassignment can also emit targeted `user.notice` events.
- Status, solve, close, and reopen emit `ticket.status_changed`, `ticket.solved`, `ticket.closed`, and `ticket.reopened`.
- Message creation emits `message.created` to the ticket room and `conversation.updated` to workspace and ticket rooms after counters and status are updated.
- Participant add/remove emits `ticket.participant_changed` and targeted participant notices when the affected user is not the actor.
- Events remain scoped to the owning workspace and ticket rooms.

## Public Widget Realtime Behavior

- Public widget bootstrap/session/message responses expose safe realtime metadata: socket path, transports, widget-session auth field, subscribe/unsubscribe events, and public event names.
- Public widget sockets authenticate only with `wgs_*` widget session tokens. Recovery tokens (`wgr_*`) are rejected for normal realtime auth.
- Public widget socket auth requires a valid widget session, active widget, and active linked mailbox.
- Public widget clients subscribe with `widget.subscribe`; the ack returns a fresh public widget session snapshot.
- Public widget clients can unsubscribe with `widget.unsubscribe`.
- Public widget events are limited to `widget.message.created` and `widget.conversation.updated`.
- Widget event envelopes intentionally use `workspaceId: null` and `actorUserId: null` so public clients do not receive internal workspace or staff identifiers.
- Widget deactivation, recovery replacement, and stale session invalidation make old widget socket tokens fail safely.

## Infrastructure Details Intentionally Excluded

The realtime implementation uses Socket.IO, room naming helpers, a publisher abstraction, Redis-backed collaboration storage when enabled, and in-memory fallback for dev/test. These are implementation details, not business actors. The diagram therefore shows actor-facing connection, subscription, collaboration, and event-delivery use cases instead of infrastructure components.

## Files, Routes, Docs, and Tests Inspected

- `src/modules/realtime/routes/realtime.routes.js`
- `src/modules/realtime/controllers/realtime.controller.js`
- `src/modules/realtime/services/realtime.service.js`
- `src/modules/realtime/services/realtime-socket.service.js`
- `src/modules/realtime/services/realtime-subscriptions.service.js`
- `src/modules/realtime/services/ticket-collaboration.service.js`
- `src/modules/realtime/services/realtime-action-guard.service.js`
- `src/modules/realtime/services/realtime-collaboration-store.service.js`
- `src/modules/realtime/docs/openapi.js`
- `src/infra/realtime/socket-auth.js`
- `src/infra/realtime/publisher.js`
- `src/modules/widget/services/widget-realtime.service.js`
- `src/modules/widget/services/widget-live-events.service.js`
- `src/modules/tickets/services/ticket-live-events.service.js`
- `src/modules/tickets/services/tickets.service.js`
- `src/modules/tickets/services/ticket-messages.service.js`
- `src/modules/tickets/services/ticket-participants.service.js`
- `docs/api.md`
- `tests/realtime.foundation.test.js`
- `tests/realtime.collaboration.test.js`
- `tests/realtime.business-events.test.js`
- `tests/widget.realtime.test.js`
- Existing accepted diagram sources under `docs/diagrams/use-cases/system-context/`, `auth-workspace/`, `ticket-operations/`, `ticket-messages-attachments/`, `customers-contacts/`, `mailboxes/`, `sla/`, `files/`, and `widget-public-flow/`.

## Uncertain, Placeholder-Only, or Intentionally Omitted Items

- Widget typing and presence are intentionally omitted because the current public widget realtime contract lists only message and conversation events.
- Offline replay, delivery guarantees, and durable event history are omitted; current docs describe realtime as live transport, not an offline replay channel.
- Broader collaboration features such as shared drafts, cursors, or co-editing are not shown because they are not implemented.
- Redis mode and adapter status are documented as runtime metadata, not business use cases.
- Visual Paradigm native `.vpp`/`.vpdx` export is not available from PlantUML; XMI is a best-effort interchange artifact.

## Styling and Rendering Decisions

- The diagram follows the accepted landscape `left to right direction` layout.
- Actors are plain stick actors with `actorStyle awesome`.
- Use cases are plain white ovals inside the `Masar - CRM Support SaaS` system boundary.
- Association and dependency arrows use the established plain UML style from the existing diagrams.
- Rendered PNG/PDF outputs are generated artifacts; PlantUML source and notes are the main maintained sources.
