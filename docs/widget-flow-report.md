# Widget Flow Report

## Overview

The widget module is a public entry channel into the existing CRM. It is not a separate support system and it does not maintain a parallel conversation model outside the normal workspace, mailbox, customer, ticket, message, and realtime foundations already used by the backend.

At a high level:

- A workspace owns one or more widgets.
- Each widget is bound to exactly one mailbox.
- A public visitor uses a widget through a safe public key (`wgt_*`).
- The browser receives a widget session token (`wgs_*`).
- Public messages create or append to normal CRM tickets and ticket messages.
- Recovery uses a separate short-lived verified recovery token (`wgr_*`).
- Public realtime is layered on top of the existing Redis-backed Socket.IO foundation.

Core implementation files:

- `src/modules/widget/models/widget.model.js`
- `src/modules/widget/models/widget-session.model.js`
- `src/modules/widget/models/widget-recovery.model.js`
- `src/modules/widget/services/widget.service.js`
- `src/modules/widget/services/widget-public.service.js`
- `src/modules/widget/services/widget-session-view.service.js`
- `src/modules/widget/services/widget-recovery.service.js`
- `src/modules/widget/services/widget-realtime.service.js`
- `src/modules/widget/services/widget-live-events.service.js`
- `src/modules/widget/routes/widget.routes.js`
- `src/modules/tickets/models/ticket.model.js`
- `src/modules/tickets/services/tickets.service.js`

## Business Report

### What the widget gives a workspace

- A workspace-scoped public support entry point for website or product embeds.
- A configurable public support surface with branding and lightweight behavior flags.
- A direct mapping from public customer traffic into the workspace's existing mailbox and ticket operations.
- A recovery path for returning visitors without requiring customer accounts.
- A minimal live update channel for public customers through the same realtime stack used by the app.

### Why the design matters for a SaaS backend

- Tenant isolation is preserved because staff-side widget creation is workspace-authenticated and public-side widget traffic is scoped by widget public key.
- Operational workflows stay coherent because widget tickets are normal tickets, not a shadow conversation system.
- Assignment, lifecycle, SLA, message rules, and billing behavior continue to run through the existing CRM services.
- The widget can be embedded publicly without exposing workspace internals such as `workspaceId` or internal mailbox structure.

### What the widget does not try to be

- It is not a customer portal.
- It is not a customer login or account system.
- It is not a multi-thread browsing experience for end users.
- It is not a separate realtime product outside the app's central realtime architecture.
- It does not replace customers, tickets, mailboxes, or inbox logic.

## Mental Model

The real ownership and relationship chain is:

- workspace owns widget
- widget points to mailbox
- public visitor gets widget session
- widget session points to contact and current ticket
- ticket and message lifecycle stay inside the normal CRM domain

This means the widget only opens the door into the existing system. It does not become the system of record.

## Workspace Side

### How a widget belongs to a workspace

Staff create widgets through protected internal routes under `/api/widgets`.

The workspace is not supplied by the client body. It comes from `req.auth.workspaceId` from the authenticated staff session. That value is passed into widget services and used for all write and read scoping.

Relevant files:

- `src/modules/widget/controllers/widget.controller.js`
- `src/modules/widget/services/widget.service.js`

### What the workspace configures

Current widget configuration includes:

- `name`
- `mailboxId`
- `branding.displayName`
- `branding.accentColor`
- `branding.launcherLabel`
- `branding.welcomeTitle`
- `branding.welcomeMessage`
- `behavior.defaultLocale`
- `behavior.collectName`
- `behavior.collectEmail`
- `isActive`

Behavior flag semantics:

- `behavior.collectName` is a frontend collection hint.
- `behavior.collectEmail` is a frontend collection hint.
- These flags are exposed through public bootstrap for widget UI behavior.
- These flags do not make `name` or `email` backend-required on the public message endpoint.

Important design rule:

- each widget binds to one mailbox only
- public requests never choose mailbox
- the workspace decides mailbox binding at configuration time

### Mailbox validation

When a widget is created or updated, the selected mailbox must:

- exist
- belong to the same workspace
- be active

If the mailbox is later inactive or broken, public widget access resolves as not found rather than leaking internal state.

### What the workspace exposes publicly

The workspace does not expose `workspaceId` publicly.

Instead, it exposes the widget public key:

- `Widget.publicKey`
- format: `wgt_*`

That public key is what frontend embeds or public clients use. The backend resolves:

- `publicKey -> widget -> workspaceId + mailboxId`

So in a SaaS setup:

- Workspace A creates widget A with `wgt_a`
- Workspace B creates widget B with `wgt_b`
- whichever site or app embed uses `wgt_a` will route the public customer into Workspace A

This is the tenant boundary on the public side.

## Public Widget Flow

Public routes are defined in:

- `src/modules/widget/routes/widget.routes.js`

Current public flow includes:

- bootstrap
- session initialize or resume
- send message
- recovery request
- recovery verify
- recovery continue
- recovery start-new

### 1. Bootstrap

Route:

- `GET /api/widgets/public/:publicKey/bootstrap`

Behavior:

- resolves widget by `publicKey`
- only succeeds for active widgets
- only succeeds if the widget's linked mailbox is active and in the same workspace
- returns safe public data only

Returned public data includes:

- safe branding
- safe behavior flags
- realtime bootstrap metadata
- capability flags

It does not expose:

- `workspaceId`
- mailbox internals
- internal staff configuration

Relevant file:

- `src/modules/widget/services/widget.service.js`

### 2. Session initialize or resume

Route:

- `POST /api/widgets/public/:publicKey/session`

Behavior:

- if a valid `wgs_*` token is provided, the session is resumed
- otherwise a new widget session is created
- a ticket is not required yet
- conversation state may still be `idle`
- if a stale or invalidated `wgs_*` is provided, the old session is not resumed and the backend safely starts a fresh session instead

Relevant files:

- `src/modules/widget/services/widget-public.service.js`
- `src/modules/widget/services/widget-session-view.service.js`

### 3. First message

Route:

- `POST /api/widgets/public/:publicKey/messages`

Public request shape includes:

- `sessionToken`
- optional `name`
- optional `email`
- `message`

Behavior:

- resolve widget from `publicKey`
- resolve widget session from `wgs_*`
- resolve or create contact
- find current eligible widget ticket for this session
- if no eligible ticket exists, create a new normal CRM ticket
- create the first message as a normal `customer_message`
- update the widget session ticket pointer
- return the active widget session token for the resolved session context

Ticket creation details:

- channel is `widget`
- ticket stores `widgetId`
- ticket stores `widgetSessionId`
- mailbox comes from widget configuration
- contact comes from contact resolution logic

Relevant files:

- `src/modules/widget/services/widget-public.service.js`
- `src/modules/tickets/services/tickets.service.js`
- `src/modules/tickets/models/ticket.model.js`

### 4. Subsequent messages

Behavior:

- backend loads the session's current ticket
- if the ticket is still eligible and not closed, append another normal `customer_message`
- if the ticket is no longer eligible, the next message creates a new ticket

Current rule:

- one current non-closed ticket per widget session

This is intentionally moderate and future-safe without implementing a public inbox or multi-thread history browser.

## Contacts, Tickets, Messages, Organizations

### Contact handling

If email is available, matching is email-first:

1. `ContactIdentity(type=email, valueNormalized=email)`
2. `Contact.emailNormalized`
3. create a new contact

If no email is available:

- the flow still works
- a fallback contact is created

If a placeholder contact name was created and a real name is later provided:

- the contact may be updated

Relevant file:

- `src/modules/widget/services/widget-public.service.js`

### Organization handling

Organization linkage is optional only.

The widget flow does not force organization creation.

If the resolved contact already has an organization:

- that `organizationId` can flow into the widget session and ticket

### Ticket handling

Widget tickets are normal CRM tickets. They are not a special pseudo-ticket system.

Widget-specific linkage is carried through these ticket fields:

- `channel = widget`
- `widgetId`
- `widgetSessionId`

Relevant file:

- `src/modules/tickets/models/ticket.model.js`

### Message handling

Public widget messages map to normal ticket message types:

- customer sends message -> `customer_message`
- agent replies publicly -> `public_reply`
- internal staff note -> `internal_note`

Lifecycle implications are inherited from the existing ticket system:

- `customer_message` represents inbound public/customer traffic
- `public_reply` represents outward public/staff reply
- `internal_note` stays internal and does not become part of the public conversation

The widget flow does not bypass ticket message invariants.

### Billing and SLA impact

Because widget tickets are real tickets:

- ticket-side billing counters still apply through the normal ticket service
- ticket-side SLA resolution and message behavior still apply

The widget is therefore additive over the existing commercial and operational runtime.

## Recovery Flow

Recovery exists so a user can continue after:

- losing local browser storage
- returning on another browser or device

Recovery is based on verified identity, not on trusting the old `wgs_*` token.

### Recovery request

Route:

- `POST /api/widgets/public/:publicKey/recovery/request`

Behavior:

- request takes email
- backend checks whether recoverable widget history exists for that widget scope
- if so, backend creates OTP and sends email
- response stays generic either way

This generic behavior exists to preserve anti-enumeration.

Relevant file:

- `src/modules/widget/services/widget-recovery.service.js`

### Recovery verify

Route:

- `POST /api/widgets/public/:publicKey/recovery/verify`

Behavior:

- verify OTP using scope key `widget:{widgetId}`
- lookup latest eligible recoverable ticket for that widget and email
- create a `WidgetRecovery` record
- issue short-lived `wgr_*` recovery token

Response includes:

- recovery token
- recovery expiry
- candidate summary
- `canContinue`
- `canStartNew`

Relevant files:

- `src/modules/widget/services/widget-recovery.service.js`
- `src/config/widget.config.js`

### Recoverable status policy

Recoverable by default:

- `new`
- `open`
- `pending`
- `waiting_on_customer`
- `solved` inside configured recovery window

Not recoverable:

- `closed`

Current solved recovery window comes from:

- `WIDGET_RECOVERY_SOLVED_TICKET_WINDOW_HOURS`
- default `72`

### Continue recovered conversation

Route:

- `POST /api/widgets/public/:publicKey/recovery/continue`

Behavior:

- create fresh widget session
- bind it to the existing recoverable ticket
- mark session as recovery-verified
- invalidate superseded old sessions tied to the recovered candidate session or ticket
- disconnect stale realtime sessions for invalidated sessions
- return normal public session snapshot for the resumed conversation

Effects:

- old stale `wgs_*` no longer works
- same ticket is reused
- customer resumes the same conversation context

### Start new recovered conversation

Route:

- `POST /api/widgets/public/:publicKey/recovery/start-new`

Behavior:

- create fresh verified widget session
- do not reuse old ticket
- old conversation stays untouched
- invalidate superseded sessions tied to the recovered candidate session or ticket
- next message creates a new ticket through the normal widget message flow

This gives the user an explicit choice between resuming and starting fresh.

## Realtime

Public realtime is built on the existing Redis-backed Socket.IO architecture.

It is not a separate widget websocket system.

### Auth model

- widget socket auth uses `wgs_*` only
- `wgr_*` is recovery-only and is not valid as socket auth

### Room model

Room scope is:

- `widget-session:{widgetSessionId}`

That keeps public subscription scope narrow and prevents cross-session leakage.

### Public event surface

Current public widget events are intentionally small:

- `widget.message.created`
- `widget.conversation.updated`

Relevant files:

- `src/modules/widget/services/widget-realtime.service.js`
- `src/modules/widget/services/widget-live-events.service.js`
- `src/infra/realtime/rooms.js`
- `src/infra/realtime/socket-auth.js`
- `src/modules/realtime/services/realtime-subscriptions.service.js`

### Reconnect and recovery behavior

- valid `wgs_*` sessions can reconnect and resubscribe safely
- stale or invalidated widget sessions fail auth
- recovery continue issues a fresh `wgs_*` bound to the recovered ticket
- recovery start-new issues a fresh `wgs_*` bound to the new empty session context

Realtime remains additive only. Canonical state remains in HTTP + DB.

## How Workspace Isolation Works

### Internal side

- authenticated staff session carries active `workspaceId`
- widget create/list/update/read all use that workspace id
- staff cannot create or modify widgets in another workspace by body input

### Public side

- public user only sends `publicKey`
- backend resolves widget record from `publicKey`
- widget already contains `workspaceId` and `mailboxId`
- all downstream contact, ticket, message, session, recovery, and realtime logic uses that resolved workspace context

Tenant separation is therefore enforced in two different ways:

- internal operations are session-workspace scoped
- public operations are widget-publicKey scoped

That is how the backend knows which company's workspace the customer is interacting with.

## End-User Side Summary

From an end-user perspective, the widget flow is:

1. frontend loads with a widget public key
2. frontend calls bootstrap
3. frontend initializes or resumes a widget session
4. user sends a first message
5. backend creates or resolves contact
6. backend creates or reuses normal CRM ticket
7. public session receives realtime updates for the current conversation
8. if browser state is lost, user can recover by verified email OTP
9. user can continue old conversation or start a new one

## Intentional Omissions

Current widget implementation does not include:

- customer account login or logout
- public multi-thread inbox or history portal
- attachments in widget flow
- typing or presence
- captcha
- SSE
- widget-specific duplicate source of truth

## Practical Summary

The widget module is best understood as a public access layer over:

- workspace
- mailbox
- contact
- ticket
- message
- recovery verification
- realtime delivery

The public side stays minimal and safe, while the internal CRM remains the authoritative operational model.
