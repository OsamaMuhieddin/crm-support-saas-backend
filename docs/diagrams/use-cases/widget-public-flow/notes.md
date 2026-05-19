# Diagram 10: Widget and Public Customer Flow

## Scope

This diagram covers implemented widget administration, public widget bootstrap/session/message/file/recovery flows, and public widget realtime behavior for Masar - CRM Support SaaS. It is a detailed domain use case diagram, not a whole-system context diagram.

## Actors Included

- `Workspace Manager (Owner/Admin)`: can create, update, activate, and deactivate widgets.
- `Agent`: can read active widgets and can create public replies on widget tickets through the ticket message flow, which is visible to widget visitors through widget realtime.
- `Viewer`: can read active widgets only.
- `Workspace Member`: abstract parent for shared authenticated widget read behavior.
- `Customer / Widget Visitor`: uses the public widget routes without workspace authentication.
- `Email Provider (Hostinger SMTP)`: included because widget recovery uses email OTP delivery through the shared email service.

## Actors Intentionally Excluded

- MongoDB, Mongoose, Express, JWT, Socket.IO internals, Redis, queues, storage adapters, MinIO, local storage, and internal workers are infrastructure details, not business actors.
- `System / Scheduler` is excluded. The widget implementation has TTL/expiry and invalidation behavior, but no business-visible scheduler actor for widget flows.
- Billing and platform administration actors are excluded because widget billing limits are enforced indirectly through file/ticket usage services and are not first-order widget use cases here.

## Use Cases Included

- `View/List Widgets`: implemented by internal widget list, options, and detail routes. `agent|viewer` can read active widgets only; owner/admin can include inactive widgets.
- `Manage Support Widgets`: grouped administration use case for owner/admin widget configuration.
- `Create Widget`: creates an active widget tied to an active same-workspace mailbox.
- `Update Widget`: updates widget name, branding, behavior, and mailbox where allowed by validation.
- `Configure Widget Mailbox`: shown separately because mailbox selection is a core widget invariant.
- `Activate/Deactivate Widget`: action routes with compact action responses. Deactivation disconnects current widget realtime sessions.
- `Bootstrap Public Widget`: returns safe public configuration and safe realtime metadata for active widgets with active mailboxes.
- `Start/Resume Public Widget Session`: creates or resumes a browser-held `wgs_*` widget session token and returns the current public conversation snapshot.
- `View Widget Conversation`: public snapshot includes idle, active, or closed conversation state and public messages.
- `Upload Widget Attachment`: public visitor uploads one file for an existing widget session before sending a message.
- `Send Widget Customer Message`: sends first or follow-up public customer messages.
- `Resolve/Create Customer Contact`: first/follow-up widget messages resolve by email identity/contact email or create a generated visitor contact.
- `Maintain Widget Email Identity`: widget messages and verified recovery ensure an email contact identity when an email is available.
- `Create or Append Widget Ticket Conversation`: first widget message creates a normal `channel=widget` ticket and initial `customer_message`; later messages append to the current eligible non-closed session ticket.
- `Recover Widget Conversation`: grouped public recovery workflow.
- `Request Recovery OTP`: generic anti-enumeration recovery request.
- `Verify Recovery OTP`: verifies widget-scoped OTP and returns a short-lived `wgr_*` recovery token.
- `Continue Recovered Conversation`: creates a fresh verified session pointing to the latest recoverable widget ticket.
- `Start New Recovered Conversation`: creates a fresh verified session without reusing the previous ticket.
- `Subscribe to Widget Realtime Updates`: public widget socket subscription using a valid widget session token.
- `Receive Message and Conversation Updates`: current public events are `widget.message.created` and `widget.conversation.updated`.
- `Reply to Widget Ticket Publicly`: included for the agent because agent public replies on widget tickets are implemented through ticket messages and are emitted to the subscribed widget session.

## Grouping Decisions

- Simple CRUD is grouped under `Manage Support Widgets`, with create/update/activate/deactivate visible because they are central widget administration actions.
- Public recovery is grouped under `Recover Widget Conversation`, but OTP request, OTP verification, continue, and start-new remain separate because they define the public recovery contract.
- Mailbox availability checks, same-workspace validation, anti-enumeration, stale session handling, file ownership checks, and socket token validation are documented here instead of expanded into many small ovals.

## Widget Admin Behavior

- Internal widget endpoints require workspace authentication and active membership.
- `owner|admin` can create, update, activate, and deactivate widgets.
- `agent|viewer` are read-only for active widgets.
- Elevated roles can include inactive widgets; non-elevated roles cannot request inactive widgets.
- Widget creation and mailbox updates require an active mailbox in the same workspace.
- Widget action endpoints return compact payloads with the widget id and `isActive`.

## Public Widget Session and Bootstrap Behavior

- Public widget routes are unauthenticated and keyed by widget `publicKey`.
- Public bootstrap returns only safe client configuration: public key, name, locale, branding, behavior hints, capabilities, and realtime metadata.
- Unknown widgets, inactive widgets, or widgets whose linked mailbox is missing/inactive resolve as widget not found.
- Public session initialization creates a fresh browser session when the provided token is missing, stale, or unknown; it resumes only a valid non-invalidated session.
- Session responses include current conversation state and safe realtime metadata.

## Public Customer Message and Conversation Behavior

- Public customer messages require a valid current widget session token.
- The backend does not require name or email just because widget behavior hints request them.
- The widget mailbox always comes from widget configuration, not public input.
- If no current eligible non-closed ticket exists, the first message creates a normal ticket with `channel=widget`, `widgetId`, `widgetSessionId`, and an initial `customer_message`.
- Follow-up public messages append to the current eligible session ticket.
- Customer messages set ticket status to `open` through the normal ticket message service.
- Public conversation snapshots include public customer messages and agent public replies, not internal notes.

## Customer Contact and Contact Identity Behavior

- Widget message writes resolve an existing contact by email identity or contact email.
- If no matching contact exists, the service creates a contact with the visitor name, visitor email, or generated `Widget visitor ...` fallback.
- If a generated contact later receives a visitor name, the generated name can be replaced.
- If a visitor email is present, the implementation ensures an email contact identity for the resolved contact.
- Verified recovery can create or update the email contact identity with `verifiedAt`.

## Widget Attachment Behavior

- Public widget file upload is implemented at `POST /api/widgets/public/:publicKey/files`.
- A valid widget session token is required before uploading.
- Uploaded files use `kind=widget_attachment`, `source=widget`, and server-side metadata containing widget id and widget session id.
- Public message attachment ids are accepted only when they are ready files from the same active widget session and are not already linked to a message.
- Message creation links attachments to both the message and the root ticket through the shared ticket message/file-link flow.

## Widget Realtime Behavior

- Public bootstrap, session initialization, and message responses expose safe realtime metadata.
- Public widget realtime auth accepts `wgs_*` widget session tokens only; `wgr_*` recovery tokens are rejected for realtime auth.
- Public clients subscribe with `widget.subscribe` and unsubscribe with `widget.unsubscribe`.
- Current events are `widget.message.created` and `widget.conversation.updated`.
- Events are scoped to the verified widget session and do not leak workspace id or actor user id to the public widget client.
- Widget deactivation disconnects current widget sockets. Reactivation allows still-valid, non-replaced sessions to reconnect.
- Recovery continue/start-new invalidates superseded sessions and disconnects their sockets.

## Email Provider Usage

- Widget recovery request creates a widget-scoped OTP when eligible recovery history exists and sends it through the shared email delivery service.
- The request response remains generic to avoid exposing whether a specific email has recoverable widget history.
- OTP verification is scoped by widget id, so an OTP requested for one widget does not verify against another widget.

## Infrastructure Details Intentionally Excluded

Storage providers, Socket.IO runtime internals, Redis, MongoDB, Mongoose models, Express middleware, JWT implementation details, file adapter internals, and TTL mechanics are described only as implementation notes because they are not business actors.

## Files, Routes, Docs, and Tests Inspected

- `src/modules/widget/routes/widget.routes.js`
- `src/modules/widget/controllers/widget.controller.js`
- `src/modules/widget/controllers/widget-public.controller.js`
- `src/modules/widget/controllers/widget-recovery.controller.js`
- `src/modules/widget/services/widget.service.js`
- `src/modules/widget/services/widget-public.service.js`
- `src/modules/widget/services/widget-recovery.service.js`
- `src/modules/widget/services/widget-session-view.service.js`
- `src/modules/widget/services/widget-realtime.service.js`
- `src/modules/widget/services/widget-live-events.service.js`
- `src/modules/widget/models/widget.model.js`
- `src/modules/widget/models/widget-session.model.js`
- `src/modules/widget/models/widget-recovery.model.js`
- `src/modules/widget/docs/openapi.js`
- `src/modules/tickets/services/tickets.service.js`
- `src/modules/tickets/services/ticket-messages.service.js`
- `src/modules/customers/services/contact-identities.service.js`
- `src/modules/customers/services/contacts.service.js`
- `src/modules/customers/models/contact.model.js`
- `src/modules/customers/models/contact-identity.model.js`
- `src/modules/files/services/files.service.js`
- `src/modules/files/services/file-links.service.js`
- `src/modules/realtime/controllers/realtime.controller.js`
- `src/modules/realtime/routes/realtime.routes.js`
- `src/modules/realtime/services/realtime.service.js`
- `src/modules/realtime/services/realtime-socket.service.js`
- `src/modules/realtime/services/realtime-subscriptions.service.js`
- `docs/api.md`
- `tests/widgets.test.js`
- `tests/widget.realtime.test.js`
- `tests/ticket-messages.test.js`
- `tests/contact-identities.test.js`
- `tests/contact-identities.service.test.js`
- `tests/files.test.js`
- Existing accepted diagram sources under `docs/diagrams/use-cases/system-context/`, `auth-workspace/`, `ticket-operations/`, `ticket-messages-attachments/`, `customers-contacts/`, `mailboxes/`, and `sla/`.

## Uncertain, Placeholder-Only, or Intentionally Omitted Items

- No separate public customer authentication actor is shown; implemented public widget sessions are opaque browser sessions, not customer accounts.
- No scheduler use case is shown for widget recovery expiry; expiry is data/model behavior rather than a visible scheduled business workflow.
- Typing, presence, collaboration cursors, and broader realtime collaboration are omitted because current public widget events are limited to message and conversation updates.
- Widget deletion is omitted because no delete route is implemented.
- Public direct file download by unauthenticated visitors is not shown as a widget use case; public widget attachment views expose file URLs, while the file download route itself is part of the files domain.
- Visual Paradigm native `.vpp`/`.vpdx` export is not available from PlantUML; XMI is a best-effort interchange artifact if generated.

## Styling and Rendering Decisions

- The diagram uses the accepted landscape `left to right direction` style.
- Actors are plain stick actors with the same `actorStyle awesome` setting used by accepted diagrams.
- Use cases are plain white ovals inside the `Masar - CRM Support SaaS` system boundary.
- Association lines use the same light blue-gray style as the accepted diagrams, and dependency labels are placed in whitespace to avoid covering use-case text.
- No internal note boxes were placed in the diagram; validation, storage, socket, and anti-enumeration details are captured in this notes file to keep the rendered diagram readable.
