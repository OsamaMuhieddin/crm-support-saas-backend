import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';

import {
  buildRealtimeAsyncApiHtml,
  realtimeAsyncApiDocument,
} from './asyncapi/index.js';
import { openApiDocument } from './openapi/index.js';

const router = Router({ strict: true });
const swaggerUiOptions = {
  customSiteTitle: 'CRM Support SaaS API Docs',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    tagsSorter: 'alpha',
    operationsSorter: 'alpha',
  },
};
const swaggerUiHandler = swaggerUi.setup(openApiDocument, swaggerUiOptions);

router.get('/docs.json', (req, res) => {
  res.type('application/json').send(JSON.stringify(openApiDocument, null, 2));
});

router.get('/docs/realtime.json', (req, res) => {
  res
    .type('application/json')
    .send(JSON.stringify(realtimeAsyncApiDocument, null, 2));
});

router.get('/docs/realtime', (req, res) => {
  res.type('text/html').send(buildRealtimeAsyncApiHtml());
});

router.get('/docs', (req, res) => {
  res.redirect(301, `${req.baseUrl}/docs/`);
});
router.use('/docs', swaggerUi.serve);
router.get('/docs/', swaggerUiHandler);

export default router;
