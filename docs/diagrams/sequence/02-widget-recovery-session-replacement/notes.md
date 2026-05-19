# Widget Recovery and Session Replacement

## Purpose

This sequence diagram documents the implemented public widget recovery flow. It covers recovery request, OTP verification, `wgr_*` recovery-token creation, the visitor choice between continuing a recovered conversation or starting a new verified session, superseded session invalidation, realtime socket disconnection, and the returned fresh `wgs_*` widget session.

The diagram follows the compact Diagram 01 style: phase-numbered sections, grouped participants, only product-significant branching, and detailed errors documented here instead of drawn as nested `alt` blocks.

## Implementation Status

Implemented.

## Source Files Inspected

- `src/modules/widget/routes/widget.routes.js`
- `src/modules/widget/controllers/widget-recovery.controller.js`
- `src/modules/widget/controllers/widget-public.controller.js`
- `src/modules/widget/services/widget-recovery.service.js`
- `src/modules/widget/services/widget-public.service.js`
- `src/modules/widget/services/widget-session-view.service.js`
- `src/modules/widget/services/widget-realtime.service.js`
- `src/modules/widget/models/widget-recovery.model.js`
- `src/modules/widget/models/widget-session.model.js`
- `src/modules/widget/models/widget.model.js`
- `src/modules/widget/validators/widget.validators.js`
- `src/modules/customers/models/contact.model.js`
- `src/modules/customers/models/contact-identity.model.js`
- `src/modules/tickets/models/ticket.model.js`
- `src/shared/services/email.service.js`
- `tests/widgets.test.js`
- `tests/widget.realtime.test.js`
- `docs/api.md`

## Participants Included

- Visitor
- Widget UI
- Routes + Validation
- Recovery Controller
- Recovery Service
- OTP + Email
- Domain Models: Widget, Mailbox, WidgetRecovery, WidgetSession, Contact, ContactIdentity, Ticket
- WidgetPublic Service
- Realtime Runtime

## Participants Intentionally Excluded

- MongoDB, Mongoose internals, and indexes are not shown as actors.
- Socket.IO internals are not shown; the diagram uses `Realtime Runtime` for implemented socket disconnection behavior.
- Separate `Contact` and `ContactIdentity` lanes are grouped because the compact diagram only needs to show verified contact/identity assurance.
- Internal widget admin flows are excluded.
- External email provider details are excluded because the service call is represented by the app-level email helper.

## Main Success Path

1. Visitor requests recovery with an email address.
2. Backend verifies the public widget and active mailbox, resolves matching contact identities or contact emails, and looks for the latest recoverable widget ticket/session.
3. When a recoverable candidate exists, backend creates a widget-scoped OTP and sends it by email.
4. Request response stays generic to preserve anti-enumeration behavior.
5. Visitor submits email and OTP code.
6. Backend verifies the widget-scoped OTP.
7. Backend creates a short-lived `WidgetRecovery` record with a hashed `wgr_*` recovery token and candidate ticket/session pointers.
8. Visitor chooses to continue the recovered conversation or start a new conversation.
9. Continue creates a fresh `wgs_*` widget session bound to the candidate ticket.
10. Start-new creates a fresh verified `wgs_*` widget session without a ticket binding.
11. Backend invalidates superseded sessions, clears their `publicSessionKeyHash`, disconnects replaced realtime sockets, and consumes the recovery record.
12. Backend initializes the fresh widget session and returns the normal public session response shape with conversation and realtime metadata.

## Important Alternate And Error Paths

- Recovery request returns the same success response even when no recoverable candidate exists; no OTP is sent in that case.
- Unknown, inactive, deleted, or mailbox-broken widgets fail through the active public widget lookup.
- Invalid request bodies return `422 errors.validation.failed`.
- Invalid, expired, or exhausted OTP is rejected by the OTP service.
- `wgr_*` recovery tokens are stored only as hashes in `WidgetRecovery`.
- Invalid, expired, consumed, or wrong-widget recovery tokens return `errors.widget.recoveryNotFound`.
- Continue requires a recoverable ticket. Open statuses are recoverable, and solved tickets are recoverable only within the configured solved-ticket window. Closed or ineligible tickets are not continued.
- Start-new does not bind the fresh session to the old ticket; the next message creates a new widget ticket through the normal public message flow.
- Recovery replacement invalidates superseded sessions and clears stored browser token hashes, so stale `wgs_*` tokens fail safely.
- Public widget realtime accepts only `wgs_*` session tokens. `wgr_*` recovery tokens are explicitly rejected with `errors.auth.invalidToken`.

## Rendering Command Notes

The source diagram is PlantUML. Rendered PNG and SVG are generated directly from the `.puml` file.

PDF export uses a local HTML wrapper around the SVG and headless Edge with headers/footers disabled so the output remains one page and does not show date, time, URL, or source path.

## Remaining Uncertainties

- None for the implemented happy path and listed alternates.
- The diagram intentionally does not show every lookup used to select the latest candidate session/ticket; those details are covered by `widget-recovery.service.js` and tests.
