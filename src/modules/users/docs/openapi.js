import {
  arrayOf,
  integerSchema,
  operation,
  ref,
} from '../../../docs/openapi/helpers.js';

export const usersOpenApiPaths = {
  '/users': {
    get: operation({
      tags: 'Users',
      summary: 'List users placeholder',
      operationId: 'listUsers',
      security: 'public',
      description:
        'Purpose: return the current placeholder user list. Request schema accepts no parameters or body.',
      success: {
        payload: {
          page: integerSchema({ minimum: 1 }),
          limit: integerSchema({ minimum: 1 }),
          total: integerSchema({ minimum: 0 }),
          results: integerSchema({ minimum: 0 }),
          users: arrayOf(ref('UserSummary')),
        },
      },
      errors: ['500'],
    }),
  },
};
