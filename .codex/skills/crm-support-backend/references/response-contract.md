# Response Contract

## Success responses

- Any successful object response under status `<400` should include:
  - `messageKey`, defaulting to `success.ok`
  - `message`, localized from `messageKey`

## Error responses

Every error must follow this shape:

```json
{
  "status": 404,
  "messageKey": "errors.notFound",
  "message": "Route not found.",
  "errors": null
}
```

## Validation failures

Validation failures must use:

- status `422`
- `messageKey: errors.validation.failed`
- an array payload under `errors`

Example:

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
