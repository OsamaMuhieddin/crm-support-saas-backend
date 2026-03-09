# 🚀 CRM Support SaaS Platform

<p align="center">
  <strong>Multi-Tenant Support CRM / Helpdesk SaaS for Modern B2B Operations</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Architecture-Multi--Tenant-blue" />
  <img src="https://img.shields.io/badge/Realtime-Socket.IO-green" />
  <img src="https://img.shields.io/badge/Billing-Stripe-purple" />
  <img src="https://img.shields.io/badge/Backend-Node.js-black" />
  <img src="https://img.shields.io/badge/Frontend-React-61DAFB" />
</p>

---

## 📌 Overview

CRM Support SaaS is a scalable, enterprise-ready multi-tenant support platform designed for B2B environments.

It enables organizations to manage customer support workflows within isolated workspaces while maintaining centralized platform governance.

### Key Capabilities

- Multi-tenant workspace architecture
- Role-based access control (RBAC)
- Structured ticket lifecycle management
- Shared inbox operations
- SLA monitoring and tracking
- Customer context and timeline
- Real-time collaboration
- API-first integrations with secure Webhooks
- Subscription-aware plan enforcement
- Super Admin governance layer

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
- Categories and subcategories
- Tags
- Internal notes and external replies
- Attachment support (S3 / MinIO compatible storage)

Tickets follow structured workflows for operational clarity.

---

### 👤 Customer Context & Timeline

Each ticket provides:

- Customer profile
- Historical tickets
- Timeline of events
- Operational activity logs
- Billing portal access

---

## ⚡ Real-Time Collaboration

Powered by **Socket.IO**, enabling:

- Presence awareness
- Soft claim system
- Draft conflict detection
- Live ticket updates
- Agent handoff notes

---

## ⏱ SLA Management

### SLA Capabilities

- First response time tracking
- Resolution time tracking
- Category-based SLA policies

### SLA Radar Dashboard

- Tickets at risk
- SLA breaches
- Near-breach alerts

---

## 🔌 Integrations

### API Keys

- Scoped access control
- Secure authentication

### Webhooks

- HMAC signature verification
- Retry logic
- Delivery logging
- Failure monitoring

### Infrastructure Support

- Rate limiting
- Background job processing
- Signed URL attachment storage

---

## 💳 Subscription & Plan Enforcement

Each workspace operates under configurable plan limits:

- Seat limits
- Ticket limits
- Storage limits
- Webhook limits
- API rate limits

### Stripe Integration

- Subscription status tracking
- Invoice visibility
- Payment monitoring
- Webhook synchronization

---

## 🛠 Super Admin Layer

Platform-level governance includes:

- Workspace management
- Plan configuration
- Subscription visibility
- Usage monitoring
- Suspension and reactivation controls
- System health overview

---

## 📊 Reporting

Operational metrics include:

- Ticket volume
- SLA compliance
- Average response time
- Agent performance

---

## 🔐 Security

- Strict tenant isolation
- Role-based access control
- Scoped API keys
- Secure Webhook validation
- Rate limiting
- Signed URL access for attachments

---

## 🧩 Technology Stack

### Backend

- Node.js (Modular architecture)
- MongoDB or PostgreSQL
- Redis
- Socket.IO
- BullMQ
- S3 / MinIO
- Stripe API

### Frontend

- React (Next.js or Vite)
- Real-time hooks
- Modular UI architecture
- Charting libraries

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
- Enable HTTPS for Webhook security
- Configure CORS properly
- Use managed database and Redis
- Monitor background jobs and Webhook failures

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

- See [docs/api.md](docs/api.md) for auth and invite endpoints, request samples, and invite acceptance finalization flow.
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
