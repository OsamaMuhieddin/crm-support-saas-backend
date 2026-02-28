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
