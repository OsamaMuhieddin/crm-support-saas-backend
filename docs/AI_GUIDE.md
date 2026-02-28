# CRM Support SaaS Backend — AI Guide

## Purpose
This repository is a backend foundation for a multi-tenant helpdesk/CRM SaaS:
- Workspaces (tenants)
- Agents (workspace users)
- Customers (contacts/end-users)
- Tickets (core entity)
- Conversations/Inbox, SLA, Integrations (later)

## Architecture (Modular, Nest-like in Express)
- Root: `app.js`, `server.js`
- `src/routes/index.js` mounts module routers under `/api`
- `src/modules/*`: feature modules
- `src/shared/*`: shared errors/middlewares/utils/validators
- `src/infra/*`: db + placeholders for jobs/storage
- `src/config/*`: env config

## Localization
- Use header `x-lang: en|ar`
- Default language is `en`

## Response shape (CRITICAL)
- Success (<400, object body):
  - `messageKey` defaults to `success.ok`
  - `message` localized from `messageKey`
- Error:
  - `{ status, messageKey, message, errors }`

## Validation
- Use `express-validator` inside module validators
- Wrap endpoints with `validate()` middleware
