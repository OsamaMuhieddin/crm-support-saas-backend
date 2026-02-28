import { DEFAULT_LANG, SUPPORTED_LANGS } from '../../i18n/index.js';

export default function langMiddleware(req, res, next) {
  const headerLang = req.headers['x-lang'] || req.headers['accept-language'];
  const lang = (Array.isArray(headerLang) ? headerLang[0] : headerLang || '')
    .toString()
    .slice(0, 2)
    .toLowerCase();

  req.lang = SUPPORTED_LANGS.has(lang) ? lang : DEFAULT_LANG;
  next();
}
