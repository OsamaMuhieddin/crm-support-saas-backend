# Localization

- Use header `x-lang: en|ar`
- Default language is `en`
- Success responses are localized by the wrapper in `src/app.js`
- Error responses are localized by the global error handler in `src/app.js`

## Locale integrity

- `src/i18n/locales/ar.json` must contain Arabic user-facing strings only
- Do not add English fallback text to Arabic locale values
- When adding new localization keys, update both `en.json` and `ar.json` in the same change
