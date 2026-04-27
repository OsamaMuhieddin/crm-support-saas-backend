import { operation, stringSchema } from '../../../docs/openapi/helpers.js';

export const healthOpenApiPaths = {
  '/health': {
    get: operation({
      tags: 'Health',
      summary: 'Health check',
      operationId: 'getHealth',
      security: 'public',
      description:
        'Purpose: return a lightweight process health response. Request schema accepts no parameters or body.',
      success: {
        payload: {
          status: stringSchema({ enum: ['ok'] }),
        },
      },
      errors: ['500'],
    }),
  },
};
