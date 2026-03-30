# Localization Rules

## Basics

- Header: `x-lang: en|ar`
- Default language is `en`
- Success responses are localized by the wrapper in `src/app.js`
- Error responses are localized by the global error handler in `src/app.js`

## Locale integrity

- `src/i18n/locales/ar.json` must contain Arabic user-facing strings only
- Do not add English fallback text inside Arabic values
- When adding new keys, update `en.json` and `ar.json` in the same change

## Message-key behavior

- Keep `messageKey` stable for FE logic
- Validation failures still use `errors.validation.failed`
- Preserve existing key namespaces unless the task explicitly calls for a rename

## Test awareness

- This repo already includes locale-key and Arabic localization tests
- When adding or renaming keys, expect those tests to be relevant

## Implementation rules

- Prefer existing message keys when the meaning is already covered; add new keys only when the user-facing meaning is genuinely new.
- Update `en.json` and `ar.json` in the same patch when adding keys.
- Keep Arabic values natural Arabic text, not mixed English placeholders.
- When validation rules change, verify the related validation keys still exist in both locales.
- Add or update the nearest localization or validation-key tests when changing message keys or locale coverage.
