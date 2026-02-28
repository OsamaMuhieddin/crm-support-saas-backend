import en from './locales/en.json' with { type: 'json' };
import ar from './locales/ar.json' with { type: 'json' };

export const DEFAULT_LANG = 'en';
export const SUPPORTED_LANGS = new Set(['en', 'ar']);

const dictionaries = { en, ar };

// Very small template replace: "Hello {{name}}"
function interpolate(str, args = {}) {
  if (typeof str !== 'string') return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = args[k];
    return v === undefined || v === null ? '' : String(v);
  });
}

export function t(key, lang = DEFAULT_LANG, args = {}) {
  const safeLang = SUPPORTED_LANGS.has(lang) ? lang : DEFAULT_LANG;
  const dict = dictionaries[safeLang] || dictionaries[DEFAULT_LANG];

  // support nested keys like "errors.notFound"
  const value = key
    .split('.')
    .reduce(
      (acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined),
      dict
    );

  if (typeof value === 'string') return interpolate(value, args);

  // fallback: return key itself so you can spot missing translations
  return key;
}
