import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import routes from './routes/index.js';
import langMiddleware from './shared/middlewares/lang.js';
import { t, DEFAULT_LANG } from './i18n/index.js';

const app = express();

// Enable proxy support if configured (for Nginx / load balancers)
if (process.env.TRUST_PROXY) {
  const trustValue = Number(process.env.TRUST_PROXY);

  app.set(
    'trust proxy',
    Number.isNaN(trustValue) ? process.env.TRUST_PROXY : trustValue
  );
}

// Middlewares
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));
app.use(langMiddleware);

// Success-response localization wrapper
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    if (
      res.statusCode < 400 &&
      body &&
      typeof body === 'object' &&
      !Array.isArray(body)
    ) {
      const messageKey =
        body.messageKey || res.locals.messageKey || 'success.ok';

      const messageArgs = body.messageArgs || res.locals.messageArgs || {};
      const localizedMessage = t(
        messageKey,
        req?.lang || DEFAULT_LANG,
        messageArgs
      );

      body.messageKey = messageKey;

      if (!Object.prototype.hasOwnProperty.call(body, 'message')) {
        body.message = localizedMessage;
      } else if (typeof body.message === 'string') {
        body.message = localizedMessage;
      } else {
        body.messageText = localizedMessage;
      }
    }

    return originalJson(body);
  };

  next();
});

// Routes
app.use('/api', routes);

app.use((req, res) => {
  res.status(404).json({
    status: 404,
    messageKey: 'errors.notFound'
  });
});

// Global error handler (keep envelope EXACTLY)
app.use((error, req, res, next) => {
  console.error('GLOBAL ERROR:', error);

  const status = error?.statusCode || 500;
  const lang = req?.lang || DEFAULT_LANG;

  let messageKey = error?.messageKey;

  if (!messageKey) {
    if (typeof error === 'string') {
      messageKey = 'errors.unknown';
    } else if (typeof error?.message === 'string') {
      messageKey = error.message.includes('.')
        ? error.message
        : 'errors.unknown';
    } else {
      messageKey = 'errors.unknown';
    }
  }

  const message = t(messageKey, lang, error?.args || {});
  const data = error?.data || null;

  const translatedData = Array.isArray(data)
    ? data.map((item) => {
        const msg = item?.msg;

        if (msg && typeof msg === 'object' && msg.key) {
          return {
            ...item,
            messageKey: msg.key,
            msg: t(msg.key, lang, msg.args || {})
          };
        }

        if (typeof msg === 'string' && msg.includes('.')) {
          return { ...item, msg: t(msg, lang) };
        }

        if (item?.messageKey) {
          return {
            ...item,
            message: t(item.messageKey, lang, item.args || {})
          };
        }

        return item;
      })
    : data;

  const payload = {
    status,
    messageKey,
    message,
    errors: translatedData
  };

  if (process.env.NODE_ENV !== 'production' && error?.internalMessage) {
    payload.internalMessage = error.internalMessage;
  }

  res.status(status).json(payload);
});

export default app;
