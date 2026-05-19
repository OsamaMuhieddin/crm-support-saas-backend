# Customers and Contacts Use Case Diagram Notes

## Scope

This diagram covers the implemented customer organization, contact, and contact identity behavior for Masar CRM Support SaaS. It also includes the implemented points where customer records are used by tickets and public widget sessions.

The rendered diagram intentionally stays compact. Endpoint-level behaviors such as list/detail/options, individual filters, identity normalization, duplicate checks, and ticket organization derivation are documented here instead of being separate use case ovals.

## Actors Included

- Workspace Member: abstract actor for authenticated active workspace members who can read customer records and use them in ticket views/workflows.
- Operational Member (Owner/Admin/Agent): abstract actor for roles allowed to create and update customer organizations, contacts, and contact identities.
- Viewer: read-only workspace role represented through Workspace Member behavior.
- Customer / Widget Visitor: included because public widget message and recovery flows create or resolve CRM contacts and email identities.

## Actors Intentionally Excluded

- External Integration: no customer/contact integration API is implemented for this domain.
- Infrastructure actors such as Express, Mongoose, MongoDB, JWT, storage adapters, Redis, queues, and Socket.IO internals are implementation details.
- Email Provider is excluded from this domain diagram. Widget recovery uses email OTP delivery, but the customer/contact behavior represented here is contact lookup and linkage rather than email delivery.
- Platform Admin is excluded because customer organization/contact endpoints are workspace-scoped member endpoints.

## Use Cases Included

- View customer organizations: covers list/search, exact domain filtering, sorting, detail, and lightweight options endpoints.
- Manage customer organizations: covers create and update only.
- View contacts: covers list/search/filter/sort, detail, and lightweight options endpoints.
- Manage contacts: covers create, update, and same-workspace organization linkage.
- View contact identities: covers listing identities attached to a contact.
- Manage contact identities: covers adding an identity.
- Add contact identity: kept visible because identities are a separate implemented child resource with email, phone, and WhatsApp types.
- Search and select customer records: covers implemented list filters, search fields, and compact options endpoints used by customer selectors.
- Use customer records in tickets: covers requester contact selection, ticket organization resolution, and contact/organization-based ticket filtering.
- Resolve widget visitor contact: covers public widget flows that reuse or create CRM contacts and email identities.

## CRUD Grouping Decisions

- Organization list, detail, options, search, domain filtering, and sorting are grouped under `View Customer Organizations`.
- Contact list, detail, options, search, organization filtering, email filtering, phone filtering, and sorting are grouped under `View Contacts`.
- Organization create/update are grouped under `Manage Customer Organizations`.
- Contact create/update are grouped under `Manage Contacts`; organization linkage remains visible because same-workspace linkage is an important domain rule.
- Contact identity creation, normalization, and duplicate detection are grouped under `Manage Contact Identities`.
- `Add Contact Identity` is shown as an included use case because it is the only implemented contact-identity write operation.
- Search, filters, sorting, and option endpoints are grouped under `Search and Select Customer Records`.
- Ticket requester selection, organization derivation, and ticket filters are grouped under `Use Customer Records in Tickets`.
- Widget contact creation/reuse/email identity maintenance is grouped under `Resolve Widget Visitor Contact`.
- Delete, deactivate, archive, merge, import, export, identity update, and identity removal are not shown because no v1 endpoints implement those actions.

## Important Rules Reflected

- All direct customer endpoints require authentication, an active user, and active workspace membership.
- Reads are available to all active workspace members, including viewers.
- Writes are limited to owner, admin, and agent roles.
- Organizations, contacts, and identities are workspace-scoped. Cross-workspace ids resolve as not found.
- Contacts may link only to same-workspace non-deleted organizations.
- Organization domains are normalized to lowercase.
- Contact emails are normalized to lowercase; phone values are normalized to stable international form.
- Contact identities support only `email`, `phone`, and `whatsapp` in v1.
- Contact identity values are normalized and active duplicates are rejected per workspace.
- Contact identity `valueNormalized` is not exposed by API responses.
- Contact identity `verifiedAt` remains null for normal direct create flows. Widget recovery can mark or create a verified email identity as part of its own flow.
- Ticket creation requires a same-workspace contact; if that contact has an organization, a mismatched explicit organization is rejected.
- Widget public first-message flow can create a CRM contact and email identity, or reuse an existing contact by email identity/direct email.

## Files, Routes, Docs, and Tests Inspected

- `src/modules/customers/routes/customers.routes.js`
- `src/modules/customers/routes/organizations.routes.js`
- `src/modules/customers/routes/contacts.routes.js`
- `src/modules/customers/routes/contact-identities.routes.js`
- `src/modules/customers/controllers/organizations.controller.js`
- `src/modules/customers/controllers/contacts.controller.js`
- `src/modules/customers/controllers/contact-identities.controller.js`
- `src/modules/customers/services/organizations.service.js`
- `src/modules/customers/services/contacts.service.js`
- `src/modules/customers/services/contact-identities.service.js`
- `src/modules/customers/models/organization.model.js`
- `src/modules/customers/models/contact.model.js`
- `src/modules/customers/models/contact-identity.model.js`
- `src/modules/customers/docs/openapi.js`
- `src/modules/tickets/services/ticket-reference.service.js`
- `src/modules/tickets/services/tickets.service.js`
- `src/modules/tickets/docs/openapi.js`
- `src/modules/widget/services/widget-public.service.js`
- `src/modules/widget/services/widget-recovery.service.js`
- `docs/api.md`
- `tests/organizations.test.js`
- `tests/organizations.service.test.js`
- `tests/contacts.test.js`
- `tests/contacts.service.test.js`
- `tests/contact-identities.test.js`
- `tests/contact-identities.service.test.js`
- `tests/tickets.core.test.js`
- `tests/ticket-messages.test.js`
- `tests/ticket-operations.test.js`
- `tests/widgets.test.js`

## Omitted, Placeholder, or Uncertain Areas

- Customer delete/archive/deactivate is omitted. Models contain soft-delete fields, but routes/services/docs expose no delete or archive operations in v1.
- Contact identity update/remove/archive is omitted because the implemented route exposes list/create only.
- Customer portal authentication and customer-owned profile management are omitted.
- External integrations are omitted because no customer integration routes/docs/tests justify them.
- Widget public behavior is represented only where it creates, resolves, or reuses CRM customer records. Detailed widget session, message, attachment, recovery OTP delivery, and realtime behavior belongs to the widget/public-flow diagram.
- The previous endpoint-expanded diagram shape was intentionally reduced because it made list/detail/options, normalization, deduplication, and ticket derivation look like separate user goals. They are important rules, but they are not separate academic use cases at this level.

## Export Notes

- PlantUML source is the canonical editable artifact.
- PNG, PDF, and SVG exports are generated artifacts and ignored by git for this folder.
- XMI is best-effort UML metadata for import tools. It captures actors, use cases, associations, and include/extend/generalization relationships, but diagram layout fidelity is best preserved in the PlantUML source and rendered image exports.
