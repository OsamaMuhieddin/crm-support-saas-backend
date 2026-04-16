# 🚀 CRM Support SaaS Platform

<p align="center">
  <strong>Multi-Tenant Support CRM / Helpdesk SaaS for Modern B2B Operations</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Architecture-Multi--Tenant-blue" />
  <img src="https://img.shields.io/badge/Backend-Node.js-black" />
  <img src="https://img.shields.io/badge/Database-MongoDB-green" />
  <img src="https://img.shields.io/badge/Storage-MinIO%20%7C%20Local-orange" />
</p>

---

## 📌 Overview

CRM Support SaaS Backend is a modular multi-tenant helpdesk backend focused on workspace-scoped support operations.

The current backend implements authentication, workspace membership/switching, files, customers, mailboxes, widget management + public messaging + verified recovery + public widget realtime foundations/hardening, tickets, and SLA v1 foundations/runtime behavior.

### Key Capabilities

- Multi-tenant workspace architecture
- Role-based access control (RBAC)
- Structured ticket lifecycle management
- Shared inbox operations
- Workspace-scoped customer records
- SLA business hours, policies, and ticket runtime tracking
- Private file upload/download flows
- Localized API response envelopes

---

## 🏗 System Architecture

The system is structured into three logical layers:

1. **Platform Layer (Super Admin)**
2. **Workspace Layer (Tenant)**
3. **Agent Layer (Users)**

### Architectural Principles

- Strict tenant isolation
- Platform vs Tenant separation
- Scoped routes and guards
- Modular backend design
- API-first integration model

---

## 🎫 Core Features

### Ticket Management

- Ticket creation, assignment, and lifecycle transitions
- Priority levels
- Categories
- Tags
- Internal notes and external replies
- Attachment support (S3 / MinIO compatible storage)

Tickets follow structured workflows for operational clarity.

---

### 👤 Customers v1

The backend currently exposes workspace-scoped customer records for:

- Organizations
- Contacts
- Lightweight contact identities

These records are used for requester linkage, mailbox/ticket context, and operational lookup flows. Richer customer timelines and portal features are still out of scope.

---

## ⏱ SLA Management

### SLA Capabilities

- First response time tracking
- Resolution time tracking
- Business-hours-aware due date calculation
- Workspace default SLA policy support
- Mailbox SLA override support
- Ticket-level SLA snapshotting on create
- Derived SLA status exposure in ticket responses

Current SLA v1 does not include BullMQ jobs, reminders, escalations, next-response SLA, holidays, cycle history, or reporting dashboards.

---

## Current Backend Scope

Implemented modules and active surfaces:

- Auth + invitations
- Workspace memberships and active workspace switching
- Files v1 with private download streaming
- Customers v1: organizations, contacts, and contact identities
- Mailboxes v1
- Widget module: internal management + public bootstrap/session/message/recovery + public realtime + hardening
- Tickets v1 with messages, assignment, lifecycle, participants, categories, and tags
- SLA v1: business hours, policies, workspace default/mailbox override assignment, ticket runtime behavior, and workspace summary

Planned or not yet active in this backend:

- Additional realtime hardening and expanded live collaboration surfaces
- Integrations/webhooks
- Subscription/billing
- Super-admin governance
- Reporting dashboards
- Background jobs / BullMQ-driven SLA automation

---

## 🔐 Security

- Strict tenant isolation
- Role-based access control
- Rate limiting
- Private backend-streamed file download access

---

## 🧩 Technology Stack

### Backend

- Node.js (Modular architecture)
- MongoDB
- S3 / MinIO
- Local storage fallback for tests/dev

---

## 📁 Project Structure

/backend
/src
/modules
/auth
/workspaces
/tickets
/customers
/reports
/integrations
/platform
/shared
/config
/infra

/frontend
/src
/pages
/components
/features
/hooks
/layouts

---

## ⚙️ Setup

### 1. Clone Repository

```bash
git clone https://github.com/your-org/crm-support-saas.git
cd crm-support-saas
```

---

### 2. Backend Setup

```bash
cd backend
npm install
```

Create a `.env` file inside the `backend` directory:

```env
PORT=5000
DATABASE_URL=
REDIS_URL=
JWT_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_BUCKET=
S3_REGION=
```

Run the backend:

```bash
npm run dev
```

---

### 3. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

---

## 🚀 Deployment Notes

- Use environment-based configuration
- Configure CORS properly
- Use managed database and object storage for production
- MinIO/local storage is suitable for local development and test flows

---

## 🤝 Contribution

- Contributions are welcome.
- Please open an issue before submitting major changes.

---

## Backend Auth + Invitations (MVP)

The backend now includes:

- JWT access + refresh tokens
- DB-backed refresh sessions with rotation
- OTP email verification and password reset
- Workspace bootstrap for verified users
- Full workspace invite lifecycle (create/list/get/resend/revoke/accept)
- Async OTP dispatch (fire-and-forget)
- Route-level eligibility guards (active user, active member, role checks)

### Required backend environment variables

```env
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
AUTH_BCRYPT_ROUNDS=12
OTP_EXPIRES_MINUTES=10
OTP_RESEND_COOLDOWN_SECONDS=60
OTP_MAX_ATTEMPTS=5
OTP_RATE_LIMIT_WINDOW_MINUTES=15
OTP_RATE_LIMIT_MAX_PER_WINDOW=5
INVITE_EXPIRES_DAYS=7
APP_BASE_URL=http://localhost:5000
FRONTEND_BASE_URL=http://localhost:5173
SENDGRID_API_KEY=
EMAIL_FROM=
NODEMAILER_HOST=
NODEMAILER_PORT=587
NODEMAILER_USER=
NODEMAILER_PASS=
```

If no email provider is configured and `NODE_ENV` is not `production`, OTP/invite payloads are logged to console for local development.
OTP sends are asynchronous and do not block success responses.
Invite links in emails are built from `FRONTEND_BASE_URL`.

### API reference

- See [docs/api.md](docs/api.md) for the backend API reference, including auth, workspace, files, customers, mailboxes, tickets, and SLA.
- Localization header is supported across endpoints: `x-lang: en|ar`.

## Backend Files v1 (MinIO)

Files v1 is implemented with backend multipart upload and backend-streamed download:

- Upload endpoint: `POST /api/files`
- Download endpoint: `GET /api/files/:fileId/download`
- Bucket visibility: private
- Detailed local setup: [docs/files-minio-setup.md](docs/files-minio-setup.md)

### Start local MinIO (official image)

```bash
docker compose -f docker-compose.minio.yml up -d
```

### Access MinIO console

- Console URL: `http://localhost:9011`
- API endpoint: `http://localhost:9000`
- Credentials: `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` from `.env`
- Override host ports with `MINIO_API_PORT` and `MINIO_CONSOLE_PORT` if needed.

### Create private bucket

1. Open MinIO console.
2. Create bucket named `S3_BUCKET` (for example `crm-support-files`).
3. Keep bucket private (default).
4. Do not attach any anonymous/public read policy.

### Required storage env (local/dev example)

```env
STORAGE_PROVIDER=minio
S3_ENDPOINT=127.0.0.1
S3_PORT=9000
S3_USE_SSL=false
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin123
S3_BUCKET=crm-support-files
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
MAX_FILE_SIZE_BYTES=10485760
FILES_ALLOWED_MIME_TYPES=application/pdf,image/jpeg,image/png,text/plain,application/zip
FILES_ALLOWED_EXTENSIONS=.pdf,.jpg,.jpeg,.png,.txt,.zip
FILES_UPLOAD_RATE_LIMIT_WINDOW_SECONDS=60
FILES_UPLOAD_RATE_LIMIT_MAX=20
FILES_DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS=60
FILES_DOWNLOAD_RATE_LIMIT_MAX=120
```

## Backend Billing v1 Local Stripe Webhooks

For local Billing v1 webhook testing, run the backend on the host machine and run Stripe CLI in Docker Compose.

- Backend target forwarded by Stripe CLI: `http://host.docker.internal:5000/api/billing/webhooks/stripe`
- This repo starts the backend locally with `npm run dev`, so Stripe CLI must forward back to the host, not to a Compose backend service.

### Required env

```env
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

`docker-compose.stripe.yml` reuses `STRIPE_SECRET_KEY` from `.env` and passes it to the Stripe CLI container as `STRIPE_API_KEY`.

### Start Stripe CLI in Docker

```bash
docker compose -f docker-compose.stripe.yml up -d stripe-cli
docker compose -f docker-compose.stripe.yml logs -f stripe-cli
```

What to do next:

1. Start the backend with `npm run dev`.
2. Start the Stripe CLI service.
3. Watch the `stripe-cli` logs and copy the generated `whsec_...` signing secret.
4. Paste that value into `STRIPE_WEBHOOK_SECRET` in `.env`.
5. Restart the backend so the new webhook secret is loaded.

The `whsec_...` value is printed in the `stripe-cli` container logs after `stripe listen` starts successfully.

## Backend Mailboxes v1

Mailbox v1 is now available as a workspace-scoped support queue abstraction:

- `POST /api/mailboxes`
- `GET /api/mailboxes`
- `GET /api/mailboxes/options`
- `GET /api/mailboxes/:id`
- `PATCH /api/mailboxes/:id`
- `POST /api/mailboxes/:id/set-default`
- `POST /api/mailboxes/:id/activate`
- `POST /api/mailboxes/:id/deactivate`

Rules:

- Multiple mailboxes per workspace are allowed.
- Exactly one default mailbox per workspace is enforced.
- New workspaces bootstrap with one default `Support` mailbox.
- No delete endpoint in v1 (operational path is activate/deactivate).

Backfill existing data safely:

```bash
npm run mailboxes:backfill-default
```

## Backend Widget Module

The widget module provides a workspace-scoped internal management surface plus public bootstrap, browser-session continuity, customer messaging, verified recovery, public realtime, and the final hardening pass:

- `POST /api/widgets`
- `GET /api/widgets`
- `GET /api/widgets/options`
- `GET /api/widgets/:id`
- `PATCH /api/widgets/:id`
- `POST /api/widgets/:id/activate`
- `POST /api/widgets/:id/deactivate`
- `GET /api/widgets/public/:publicKey/bootstrap`
- `POST /api/widgets/public/:publicKey/session`
- `POST /api/widgets/public/:publicKey/messages`
- `POST /api/widgets/public/:publicKey/recovery/request`
- `POST /api/widgets/public/:publicKey/recovery/verify`
- `POST /api/widgets/public/:publicKey/recovery/continue`
- `POST /api/widgets/public/:publicKey/recovery/start-new`

Rules:

- Internal widget reads are available to any active workspace member; inactive widgets are hidden from `agent|viewer`.
- Widget writes are restricted to `owner|admin`.
- Every widget must reference one active mailbox in the same workspace.
- The public bootstrap endpoint returns only safe client configuration and hides inactive/missing widgets with the same `404`.
- Public clients must initialize or resume an opaque widget session before sending messages.
- Public bootstrap and session-init responses include safe widget realtime metadata so the frontend can connect without reusing internal staff auth assumptions.
- `behavior.collectName` and `behavior.collectEmail` are frontend collection hints, not backend-required message fields.
- First widget messages create or resolve a CRM contact, create a normal internal ticket with `channel=widget`, and add a normal `customer_message`.
- Follow-up widget messages append to the current non-closed session ticket; if no eligible current ticket remains, a new widget ticket is created for that session.
- Verified recovery is widget-scoped and email-OTP-based; after verification the client can either continue the latest eligible recoverable conversation or start a fresh verified session.
- Recovery issues a fresh widget session token and never trusts a lost browser token as the recovery authority.
- Recovery `continue` and `start-new` invalidate superseded widget browser sessions tied to the recovered candidate session or ticket so stale `wgs_*` tokens stop working for both HTTP and realtime.
- Public widget realtime uses the existing Redis-backed Socket.IO runtime, authenticates only with `wgs_*` widget session tokens, and subscribes through `widget.subscribe` to the server-verified current widget-session room.
- Current public widget live events are intentionally small: `widget.message.created` and `widget.conversation.updated`.
- `wgr_*` recovery tokens are recovery-only and are rejected as normal realtime auth.
- Deactivating a widget disconnects currently connected widget sockets immediately; reactivating the widget allows still-valid non-replaced sessions to reconnect normally.
- Public multi-thread history, attachments, typing/presence, and SSE remain intentionally out of scope.

## Backend Customers v1

Customers v1 is implemented as workspace-scoped customer dictionaries:

- `GET /api/customers/organizations`
- `GET /api/customers/organizations/options`
- `GET /api/customers/organizations/:id`
- `POST /api/customers/organizations`
- `PATCH /api/customers/organizations/:id`
- `GET /api/customers/contacts`
- `GET /api/customers/contacts/options`
- `GET /api/customers/contacts/:id`
- `GET /api/customers/contacts/:id/identities`
- `POST /api/customers/contacts`
- `PATCH /api/customers/contacts/:id`
- `POST /api/customers/contacts/:id/identities`

Rules:

- Organizations and contacts are workspace-scoped customer records.
- Contacts can optionally link to an organization in the same workspace.
- Contact identities are lightweight records for additional email/phone style identifiers.
- The current customer module does not provide customer portal auth, verification workflows, or expanded activity timelines.

## Backend SLA v1

SLA v1 is active for both management and ticket runtime behavior:

- `POST /api/sla/business-hours`
- `GET /api/sla/business-hours`
- `GET /api/sla/business-hours/options`
- `GET /api/sla/business-hours/:id`
- `PATCH /api/sla/business-hours/:id`
- `POST /api/sla/policies`
- `GET /api/sla/policies`
- `GET /api/sla/policies/options`
- `GET /api/sla/policies/:id`
- `PATCH /api/sla/policies/:id`
- `POST /api/sla/policies/:id/activate`
- `POST /api/sla/policies/:id/deactivate`
- `POST /api/sla/policies/:id/set-default`
- `GET /api/sla/summary`

Rules:

- Policies reference separate business-hours records.
- Ticket SLA selection order is `mailbox.slaPolicyId -> workspace.defaultSlaPolicyId -> no SLA`.
- Ticket creation snapshots the effective SLA onto the ticket.
- First response is satisfied only by the first `public_reply`.
- Resolution is satisfied by `solved`, paused by `waiting_on_customer`, and resumed on reopen from remaining business time.
- Action endpoints return compact action payloads; full resource views belong to list/detail endpoints.
- BullMQ/jobs, reminders, escalations, next-response SLA, holidays, cycle history, and reporting dashboards are not part of SLA v1.
