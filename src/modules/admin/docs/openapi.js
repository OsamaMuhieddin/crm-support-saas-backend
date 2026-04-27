import {
  arrayOf,
  emptyJsonRequest,
  idSchema,
  integerSchema,
  jsonRequest,
  objectSchema,
  operation,
  pathIdParam,
  queryParam,
  ref,
  stringSchema,
  booleanSchema,
} from '../../../docs/openapi/helpers.js';

const adminEmail = stringSchema({ format: 'email', maxLength: 320 });
const adminPassword = stringSchema({
  minLength: 8,
  maxLength: 128,
  format: 'password',
});

const adminWorkspaceFilters = [
  queryParam('q', stringSchema({ minLength: 1, maxLength: 160 })),
  queryParam('search', stringSchema({ minLength: 1, maxLength: 160 })),
  queryParam(
    'status',
    stringSchema({ enum: ['active', 'trial', 'suspended'] })
  ),
  queryParam(
    'billingStatus',
    stringSchema({
      enum: [
        'trialing',
        'active',
        'past_due',
        'canceled',
        'incomplete',
        'incomplete_expired',
      ],
    })
  ),
  queryParam('planKey', stringSchema({ minLength: 1, maxLength: 120 })),
  queryParam('trialing', booleanSchema()),
  queryParam('page', integerSchema({ minimum: 1 })),
  queryParam('limit', integerSchema({ minimum: 1, maximum: 50 })),
  queryParam(
    'sort',
    stringSchema({
      enum: [
        'createdAt',
        '-createdAt',
        'updatedAt',
        '-updatedAt',
        'name',
        '-name',
        'status',
        '-status',
      ],
    })
  ),
];

const metricsParams = [
  queryParam('from', stringSchema({ format: 'date' })),
  queryParam('to', stringSchema({ format: 'date' })),
  queryParam('groupBy', stringSchema({ enum: ['day', 'week', 'month'] })),
];

export const adminOpenApiPaths = {
  '/admin/auth/login': {
    post: operation({
      tags: 'Admin Auth',
      summary: 'Login platform admin',
      operationId: 'adminLogin',
      security: 'public',
      description:
        'Purpose: authenticate a platform admin and return platform-admin tokens.',
      requestBody: jsonRequest(
        objectSchema(
          {
            email: adminEmail,
            password: adminPassword,
          },
          { required: ['email', 'password'], additionalProperties: false }
        )
      ),
      success: {
        messageKey: 'success.adminAuth.loggedIn',
        payload: {
          platformAdmin: ref('PlatformAdmin'),
          tokens: ref('AuthTokens'),
        },
      },
      errors: ['401', '403', '422', '500'],
    }),
  },
  '/admin/auth/refresh': {
    post: operation({
      tags: 'Admin Auth',
      summary: 'Refresh platform admin tokens',
      operationId: 'adminRefresh',
      security: 'public',
      description:
        'Purpose: rotate a platform-admin refresh token and return fresh tokens.',
      requestBody: jsonRequest(
        objectSchema(
          { refreshToken: stringSchema({ minLength: 1 }) },
          { required: ['refreshToken'], additionalProperties: false }
        )
      ),
      success: {
        messageKey: 'success.adminAuth.refreshed',
        payload: { tokens: ref('AuthTokens') },
      },
      errors: ['401', '403', '422', '500'],
    }),
  },
  '/admin/auth/me': {
    get: operation({
      tags: 'Admin Auth',
      summary: 'Get platform admin context',
      operationId: 'adminMe',
      security: 'platform',
      description:
        'Purpose: return the authenticated platform admin from the platform token.',
      success: {
        payload: { platformAdmin: ref('PlatformAdmin') },
      },
      errors: ['401', '403', '500'],
    }),
  },
  '/admin/auth/logout': {
    post: operation({
      tags: 'Admin Auth',
      summary: 'Logout platform admin session',
      operationId: 'adminLogout',
      security: 'platform',
      description: 'Purpose: revoke the current platform admin session.',
      success: { messageKey: 'success.adminAuth.loggedOut' },
      errors: ['401', '403', '500'],
    }),
  },
  '/admin/auth/logout-all': {
    post: operation({
      tags: 'Admin Auth',
      summary: 'Logout all platform admin sessions',
      operationId: 'adminLogoutAll',
      security: 'platform',
      description:
        'Purpose: revoke all sessions for the current platform admin.',
      success: { messageKey: 'success.adminAuth.loggedOutAll' },
      errors: ['401', '403', '500'],
    }),
  },
  '/admin/workspaces': {
    get: operation({
      tags: 'Admin Workspaces',
      summary: 'List workspaces for platform admins',
      operationId: 'listAdminWorkspaces',
      security: 'platform',
      description:
        'Purpose: list tenant workspaces for platform admin users. Authorization: super_admin, platform_admin, or platform_support required.',
      parameters: adminWorkspaceFilters,
      success: {
        payload: {
          page: integerSchema({ minimum: 1 }),
          limit: integerSchema({ minimum: 1 }),
          total: integerSchema({ minimum: 0 }),
          results: integerSchema({ minimum: 0 }),
          workspaces: arrayOf(ref('AdminWorkspace')),
        },
      },
    }),
  },
  '/admin/workspaces/{id}': {
    get: operation({
      tags: 'Admin Workspaces',
      summary: 'Get admin workspace detail',
      operationId: 'getAdminWorkspace',
      security: 'platform',
      description:
        'Purpose: return workspace detail with owner, billing, usage, and counts. Authorization: super_admin, platform_admin, or platform_support required.',
      parameters: [pathIdParam()],
      success: {
        payload: {
          workspace: ref('AdminWorkspace'),
          owner: objectSchema({}, { additionalProperties: true }),
          billing: objectSchema({}, { additionalProperties: true }),
          usage: objectSchema({}, { additionalProperties: true }),
          counts: objectSchema({}, { additionalProperties: true }),
        },
      },
      errors: ['401', '403', '404', '422', '500'],
    }),
  },
  '/admin/workspaces/{id}/suspend': {
    post: operation({
      tags: 'Admin Workspace Actions',
      summary: 'Suspend workspace',
      operationId: 'suspendAdminWorkspace',
      security: 'platform',
      description:
        'Purpose: suspend a tenant workspace. Authorization: super_admin required. Action response is compact.',
      parameters: [pathIdParam()],
      requestBody: emptyJsonRequest(),
      success: {
        messageKey: 'success.admin.workspaceSuspended',
        payload: {
          changed: booleanSchema(),
          workspace: objectSchema(
            {
              _id: idSchema(),
              status: stringSchema({ enum: ['suspended'] }),
            },
            { additionalProperties: true }
          ),
        },
      },
      errors: ['401', '403', '404', '422', '500'],
    }),
  },
  '/admin/workspaces/{id}/reactivate': {
    post: operation({
      tags: 'Admin Workspace Actions',
      summary: 'Reactivate workspace',
      operationId: 'reactivateAdminWorkspace',
      security: 'platform',
      description:
        'Purpose: reactivate a suspended tenant workspace to active or trial depending on billing state. Authorization: super_admin required. Action response is compact.',
      parameters: [pathIdParam()],
      requestBody: emptyJsonRequest(),
      success: {
        messageKey: 'success.admin.workspaceReactivated',
        payload: {
          changed: booleanSchema(),
          workspace: objectSchema(
            {
              _id: idSchema(),
              status: stringSchema({ enum: ['active', 'trial', 'suspended'] }),
            },
            { additionalProperties: true }
          ),
        },
      },
      errors: ['401', '403', '404', '422', '500'],
    }),
  },
  '/admin/workspaces/{id}/extend-trial': {
    post: operation({
      tags: 'Admin Workspace Actions',
      summary: 'Extend workspace trial',
      operationId: 'extendAdminWorkspaceTrial',
      security: 'platform',
      description:
        'Purpose: extend an eligible unmanaged trial subscription. Authorization: super_admin required. Action response is compact.',
      parameters: [pathIdParam()],
      requestBody: jsonRequest(
        objectSchema(
          { days: integerSchema({ minimum: 1, maximum: 30 }) },
          { required: ['days'], additionalProperties: false }
        )
      ),
      success: {
        messageKey: 'success.admin.workspaceTrialExtended',
        payload: {
          trialExtension: objectSchema({}, { additionalProperties: true }),
        },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/admin/overview': {
    get: operation({
      tags: 'Admin Analytics',
      summary: 'Get platform overview',
      operationId: 'getAdminOverview',
      security: 'platform',
      description:
        'Purpose: return platform overview analytics. Authorization: super_admin or platform_admin required. Request schema accepts no query parameters.',
      success: { payload: { overview: ref('AdminOverview') } },
      errors: ['401', '403', '422', '500'],
    }),
  },
  '/admin/metrics': {
    get: operation({
      tags: 'Admin Analytics',
      summary: 'Get platform metrics',
      operationId: 'getAdminMetrics',
      security: 'platform',
      description:
        'Purpose: return time-series platform metrics. Authorization: super_admin or platform_admin required. Date range may not exceed 366 days.',
      parameters: metricsParams,
      success: { payload: { metrics: ref('AdminMetrics') } },
      errors: ['401', '403', '422', '500'],
    }),
  },
  '/admin/billing-overview': {
    get: operation({
      tags: 'Admin Analytics',
      summary: 'Get platform billing overview',
      operationId: 'getAdminBillingOverview',
      security: 'platform',
      description:
        'Purpose: return platform billing overview. Authorization: super_admin required. Request schema accepts no query parameters.',
      success: {
        payload: { billingOverview: ref('AdminBillingOverview') },
      },
      errors: ['401', '403', '422', '500'],
    }),
  },
};
