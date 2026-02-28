# API Conventions

## Base URL
- `/api`

## Localization
- `x-lang: en|ar` (default `en`)

## Health
- `GET /api/health`
  - 200 response:
    `{ messageKey: "success.ok", message: "<localized>", status: "ok" }`

## Foundation module placeholders
- `GET /api/workspaces` returns empty list + pagination fields
- `GET /api/users` returns empty list + pagination fields
- `GET /api/customers` returns empty list + pagination fields
- `GET /api/tickets` returns empty list + pagination fields
