# Response Shape

## Success (object)
Any successful response (<400) that returns an object will be normalized:
- `messageKey` defaults to `success.ok`
- `message` localized from `messageKey`

Example:
{
  "messageKey": "success.ok",
  "message": "Request completed successfully.",
  "status": "ok"
}

## Success (pagination/list)
Preferred top-level list format:
{
  "page": 1,
  "limit": 10,
  "total": 2,
  "results": 2,
  "tickets": [],
  "messageKey": "success.ok",
  "message": "Request completed successfully."
}

## Error (global)
All errors MUST be:
{
  "status": 404,
  "messageKey": "errors.notFound",
  "message": "Route not found.",
  "errors": null
}

Validation example (422):
{
  "status": 422,
  "messageKey": "errors.validation.failed",
  "message": "Validation failed.",
  "errors": [
    { "field": "email", "messageKey": "errors.validation.failed", "msg": { "key": "errors.validation.failed" } }
  ]
}
