# Sequence Diagram Final Audit

## Conclusion

The 14 core sequence diagrams are complete enough for the app-wise documentation set.

No serious missing core flow was found. The set covers the highest-priority implemented flows across customer-facing widget behavior, onboarding, workspace tenancy, invitations, billing, Stripe integration, entitlement enforcement, mailboxes, SLA, tickets, files/attachments, assignment, and lifecycle behavior.

Some implemented flows remain useful as reference/backlog diagrams, but they do not need to be added to the core set.

## Final Diagram List

1. `01-public-widget-conversation` - Public Widget Conversation, Optional Attachment, and Ticket Creation.
2. `02-widget-recovery-session-replacement` - Widget Recovery and Session Replacement.
3. `03-signup-email-verification-workspace-bootstrap` - Signup, Email Verification, and Workspace Bootstrap.
4. `04-workspace-switch-token-refresh` - Workspace Switch and Token Refresh.
5. `05-invite-teammate-accept-invite` - Invite Teammate and Accept Invite.
6. `06-billing-checkout-portal` - Billing Checkout, Subscription Activation, and Customer Portal.
7. `07-stripe-webhook-subscription-sync` - Stripe Webhook Sync, Payment Failure, and Subscription Status Update.
8. `08-billing-entitlement-enforcement` - Billing Entitlement Enforcement and Plan Limits.
9. `09-mailbox-default-sla-override` - Mailbox Create, Default Mailbox, and SLA Override Setup.
10. `10-sla-policy-ticket-runtime` - SLA Policy Setup and Ticket Runtime SLA Snapshot.
11. `11-ticket-creation-references-sla` - Ticket Creation with References and SLA Snapshot.
12. `12-ticket-message-reply-note-attachments` - Ticket Message, Public Reply, Internal Note, Attachment Linking, and SLA Side Effects.
13. `13-ticket-assignment-self-assignment` - Ticket Assignment, Unassignment, and Self-Assignment.
14. `14-ticket-lifecycle-sla-side-effects` - Ticket Solve, Close, Reopen, and SLA Lifecycle Side Effects.

## App-Wise Coverage Summary

- Revenue-critical: billing checkout/portal, Stripe webhook sync, entitlement enforcement, billing-aware invite/upload/mailbox/SLA enforcement.
- Onboarding-critical: signup/email verification/workspace bootstrap, teammate invite and acceptance.
- Customer-facing: public widget conversation, widget recovery, widget attachments inside the public conversation flow.
- Agent productivity-critical: ticket creation, message/reply/note behavior, assignment/self-assignment, lifecycle actions.
- Admin/operations-critical: mailbox setup/defaults/SLA override, SLA policy/business-hours setup, ticket lifecycle.
- Security/tenancy-critical: workspace switching, refresh behavior, scoped ticket/reference validation, role-gated assignment/lifecycle flows.
- Integration-critical: Stripe webhooks and provider-backed checkout/portal flow.
- Failure-critical or behaviorally complex: widget recovery/session replacement, webhook idempotency/status sync, SLA runtime mutation, attachment linking, lifecycle reopen behavior.

## Validation Results

- Folder structure: every diagram folder contains exactly one `.puml` source and one `notes.md`.
- Local exports: every diagram folder currently has one `.png`, one `.pdf`, and one `.svg`.
- Git ignore: generated sequence exports are ignored by:
  - `docs/diagrams/sequence/**/*.png`
  - `docs/diagrams/sequence/**/*.pdf`
  - `docs/diagrams/sequence/**/*.svg`
- PlantUML syntax: all `.puml` files passed `plantuml -checkonly`.
- Compact style: every `.puml` uses phase-numbered section headers and has no `autonumber`.
- Branching style: diagrams use a small number of product-significant `alt`/`opt` blocks; routine errors are documented in `notes.md`.
- Notes metadata: every `notes.md` includes purpose/importance, implementation status, inspected sources, included/excluded participants, success path, alternate/error paths, rendering command notes, and remaining uncertainties.
- Tracked output behavior: rendered `.png`, `.pdf`, and `.svg` files show as ignored files, not normal untracked candidates.

## Known Backlog / Reference Diagrams

These flows are implemented or useful but are not serious missing core diagrams:

- Realtime internal and widget subscription internals.
- Reports dashboards and metrics flows.
- Platform admin oversight: login, workspace suspension/reactivation, trial extension, and billing overview.
- Customer organization/contact/contact-identity management outside the widget path.
- Ticket category and tag management.
- File metadata, download, delete, and soft-delete link behavior.
- Password reset, change password, logout, and logout-all.
- Billing repair, replay, catalog sync, and operational scripts.
- Internal widget configuration CRUD and activation/deactivation.

## Audit Notes

The original plan grouped some late ticket operations and listed realtime subscription as a core candidate. During one-by-one implementation, assignment and lifecycle behavior were split into separate core diagrams because the implementation and SLA side effects justified two clearer diagrams. Realtime subscription internals remain a good reference/backlog diagram, but the core set already shows realtime event publication at the product-flow level.

## Final Status

The app-wise core sequence diagram set is complete with 14 diagrams. No additional core diagram is required before treating the set as finished.
