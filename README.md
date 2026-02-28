🚀 CRM Support SaaS Platform

A scalable multi-tenant Support CRM / Helpdesk platform designed for B2B customer support operations.

This system provides structured ticket management, real-time collaboration, SLA monitoring, subscription-aware plan enforcement, secure integrations, and a dedicated platform administration layer.

📌 Overview

CRM Support SaaS enables organizations to manage customer support workflows within isolated workspaces while maintaining centralized platform governance.

The platform includes:

Multi-tenant workspace architecture

Role-based access control (RBAC)

Structured ticket lifecycle management

Shared inbox operations

SLA monitoring and tracking

Customer context and timeline

Real-time collaboration between agents

API-first integrations with secure Webhooks

Subscription plan enforcement

Super Admin platform dashboard

🏗 System Architecture

The system is structured into three logical layers:

1️⃣ Platform Layer (Super Admin)

Responsible for:

Managing workspaces

Plan configuration

Subscription visibility

Usage monitoring

Global system insights

This layer operates independently from tenant-scoped logic.

2️⃣ Workspace Layer (Tenant)

Each organization operates within an isolated workspace.

Features include:

Ticket management

Team management

Reporting

SLA configuration

API & Webhook setup

Plan-based usage limits

Strict tenant isolation is enforced at the application and database levels.

3️⃣ Agent Layer

Users inside each workspace operate under structured roles:

Owner / Admin

Agent

Manager / Viewer

Permissions are enforced across tickets, settings, reporting, and integrations.

🎫 Ticket Management

The ticketing system supports:

Ticket creation, assignment, and lifecycle transitions

Priority levels

Categories and subcategories

Tags

Internal notes and external replies

Attachment support (S3 / MinIO compatible storage)

Tickets follow structured workflows to support operational clarity.

⚡ Real-Time Collaboration

Powered by WebSockets (Socket.IO), enabling:

Presence awareness

Soft claim system

Draft conflict detection

Live ticket updates

Agent handoff notes

This ensures coordinated team operations.

⏱ SLA Management

Includes:

First response time tracking

Resolution time tracking

Category-based SLA policies

The SLA Radar dashboard highlights:

Tickets at risk

SLA breaches

Near-breach cases

👤 Customer Context & Timeline

Each ticket provides contextual information including:

Customer profile

Historical tickets

Timeline of events

Operational activity logs

Billing portal access

🔌 Integrations

The platform follows an API-first design.

API Keys

Scoped access control

Secure authentication

Webhooks

HMAC signature verification

Retry logic

Delivery logging

Failure monitoring

Additional infrastructure includes:

Rate limiting

Background job processing

Attachment storage with signed URLs

💳 Subscription & Plan Enforcement

Each workspace operates under configurable plan limits:

Seat limits

Ticket limits

Storage limits

Webhook limits

API rate limits

Stripe integration provides:

Subscription status tracking

Invoice visibility

Payment state monitoring

Webhook synchronization

🛠 Super Admin Dashboard

The platform administration layer includes:

Workspace management

Plan configuration

Subscription visibility

Usage monitoring

Suspension and reactivation controls

System health overview

📊 Reporting

Operational metrics include:

Ticket volume

SLA compliance

Average response time

Agent performance

🔐 Security

Strict tenant isolation

Role-based access control

Scoped API keys

Secure Webhook validation

Rate limiting

Signed URL access for attachments

🧩 Technology Stack
Backend

Node.js (Modular architecture)

MongoDB or PostgreSQL

Redis

Socket.IO

BullMQ (Job queue) or agenda 

S3 / MinIO

Stripe API

Frontend

React (Next.js or Vite)

Real-time hooks

Modular UI architecture

Charting libraries

📁 Project Structure (Example)
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
⚙️ Setup Instructions
1️⃣ Clone the Repository
git clone https://github.com/your-org/crm-support-saas.git
cd crm-support-saas
2️⃣ Backend Setup
cd backend
npm install

Create a .env file:

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

Run the backend:

npm run dev
3️⃣ Frontend Setup
cd frontend
npm install
npm run dev
🧪 Development Notes

Ensure Redis is running for real-time presence and queues.

Configure Stripe webhooks for subscription synchronization.

Configure S3 or MinIO for attachment storage.

Apply database migrations before running in production.

🚀 Deployment Considerations

Use environment-based configuration.

Enable HTTPS for Webhook security.

Configure CORS properly for production.

Use managed database and Redis instances.

Monitor job queues and Webhook failures.

🤝 Contribution

Contributions are welcome.
Please open an issue before submitting large changes.
