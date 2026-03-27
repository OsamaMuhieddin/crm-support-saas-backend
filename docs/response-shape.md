# Response Shape

## Success (object)

Any successful response (`<400`) that returns an object will be normalized:

- `messageKey` defaults to `success.ok`
- `message` is localized from `messageKey`

Example:

```json
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "status": "ok"
}
```

## Success (pagination/list)

Preferred top-level list format:

```json
{
  "page": 1,
  "limit": 10,
  "total": 2,
  "results": 2,
  "tickets": [],
  "messageKey": "success.ok",
  "message": "Request completed successfully."
}
```

## Error (global)

All errors MUST be:

```json
{
  "status": 404,
  "messageKey": "errors.notFound",
  "message": "Route not found.",
  "errors": null
}
```

Validation example (`422`):

```json
{
  "status": 422,
  "messageKey": "errors.validation.failed",
  "message": "Validation failed.",
  "errors": [
    {
      "field": "email",
      "messageKey": "errors.validation.invalidEmail",
      "msg": "Invalid email address."
    }
  ]
}
```

## Realtime acknowledgements and events

Socket acknowledgements use a compact machine-friendly shape instead of the full HTTP envelope.

Ack example:

```json
{
  "ok": true,
  "code": "realtime.workspace.subscribed",
  "messageKey": "success.ok",
  "data": {
    "scope": "workspace",
    "room": "workspace:65f1...",
    "workspaceId": "65f1...",
    "ticketId": null
  }
}
```

Ack error example:

```json
{
  "ok": false,
  "code": "errors.ticket.notFound",
  "messageKey": "errors.ticket.notFound",
  "data": null
}
```

Event envelope example:

```json
{
  "event": "ticket.updated",
  "eventId": "1a2b3c4d-...",
  "occurredAt": "2026-03-25T10:15:30.000Z",
  "workspaceId": "65f1...",
  "actorUserId": "65ef...",
  "data": {
    "ticket": {
      "_id": "65f0...",
      "status": "open"
    }
  }
}
```

Notes:

- `messageKey` remains stable for FE logic and optional localization.
- `code` is the transport-level result code for the ack or error.
- Event envelopes can be delivered to workspace rooms, ticket rooms, or user rooms with the same top-level contract.
- Collaboration events such as `ticket.presence.snapshot`, `ticket.presence.changed`, `ticket.typing.changed`, and `ticket.soft_claim.changed` use the same envelope contract.
- `ticket.presence.snapshot` is socket-targeted on subscribe/reconnect, while `*.changed` events are ticket-room broadcasts.
- Ack errors can include `data.details` for machine-friendly metadata such as `throttleMs` on `errors.realtime.rateLimited`.
- REST response rules above remain unchanged and continue to govern HTTP APIs.
