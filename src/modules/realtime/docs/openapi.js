import { operation, ref } from '../../../docs/openapi/helpers.js';

export const realtimeOpenApiPaths = {
  '/realtime/bootstrap': {
    get: operation({
      tags: 'Realtime',
      summary: 'Get realtime bootstrap',
      operationId: 'getRealtimeBootstrap',
      description:
        'Purpose: return realtime connection bootstrap data for the authenticated user and active workspace session.',
      success: {
        payload: {
          realtime: ref('RealtimeBootstrap'),
        },
      },
      errors: ['401', '403', '500'],
    }),
  },
};
