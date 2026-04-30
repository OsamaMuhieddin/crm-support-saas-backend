import {
  arrayOf,
  booleanSchema,
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
} from '../../../docs/openapi/helpers.js';

const baseListParams = (sortValues) => [
  queryParam('page', integerSchema({ minimum: 1 })),
  queryParam('limit', integerSchema({ minimum: 1, maximum: 100 })),
  queryParam('q', stringSchema({ minLength: 1, maxLength: 120 })),
  queryParam('search', stringSchema({ minLength: 1, maxLength: 120 })),
  queryParam('sort', stringSchema({ enum: sortValues })),
];

const optionsParams = [
  queryParam('q', stringSchema({ minLength: 1, maxLength: 120 })),
  queryParam('search', stringSchema({ minLength: 1, maxLength: 120 })),
  queryParam('limit', integerSchema({ minimum: 1, maximum: 50 })),
];

const businessHoursBody = (required = []) =>
  objectSchema(
    {
      name: stringSchema({ minLength: 1, maxLength: 120 }),
      timezone: stringSchema({
        minLength: 1,
        maxLength: 120,
        example: 'Asia/Damascus',
      }),
      weeklySchedule: arrayOf(ref('BusinessHoursDay'), {
        minItems: 1,
        maxItems: 7,
      }),
    },
    { required, additionalProperties: false }
  );

const slaPolicyBody = (required = []) =>
  objectSchema(
    {
      name: stringSchema({ minLength: 1, maxLength: 120 }),
      businessHoursId: idSchema('Business hours id.'),
      rulesByPriority: ref('SlaRulesByPriority'),
    },
    { required, additionalProperties: false }
  );

export const slaOpenApiPaths = {
  '/sla/summary': {
    get: operation({
      tags: 'SLA',
      summary: 'Get SLA summary',
      operationId: 'getSlaSummary',
      description:
        'Purpose: return current workspace SLA setup and runtime summary. Request schema accepts no parameters or body.',
      success: { payload: { summary: ref('SlaSummary') } },
      errors: ['401', '403', '404', '500'],
    }),
  },
  '/sla/business-hours': {
    get: operation({
      tags: 'Business Hours',
      summary: 'List business hours',
      operationId: 'listBusinessHours',
      description:
        'Purpose: list business-hours definitions in the active workspace.',
      parameters: baseListParams([
        'name',
        '-name',
        'createdAt',
        '-createdAt',
        'updatedAt',
        '-updatedAt',
      ]),
      success: {
        payload: {
          page: integerSchema({ minimum: 1 }),
          limit: integerSchema({ minimum: 1 }),
          total: integerSchema({ minimum: 0 }),
          results: integerSchema({ minimum: 0 }),
          businessHours: arrayOf(ref('BusinessHours')),
        },
      },
    }),
    post: operation({
      tags: 'Business Hours',
      summary: 'Create business hours',
      operationId: 'createBusinessHours',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: create a business-hours schedule. Authorization: owner or admin roleKey required. weeklySchedule must contain unique dayOfWeek values, valid HH:mm windows, and open days must have windows.',
      requestBody: jsonRequest(
        businessHoursBody(['name', 'timezone', 'weeklySchedule'])
      ),
      success: {
        messageKey: 'success.sla.businessHours.created',
        payload: { businessHours: ref('BusinessHours') },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/sla/business-hours/options': {
    get: operation({
      tags: 'Business Hours',
      summary: 'List business-hours options',
      operationId: 'listBusinessHoursOptions',
      description:
        'Purpose: return compact business-hours options for selectors.',
      parameters: optionsParams,
      success: { payload: { options: arrayOf(ref('BusinessHoursOption')) } },
    }),
  },
  '/sla/business-hours/{id}': {
    get: operation({
      tags: 'Business Hours',
      summary: 'Get business hours',
      operationId: 'getBusinessHours',
      description:
        'Purpose: return business-hours detail. Anti-enumeration: missing and cross-workspace resources collapse to not found.',
      parameters: [pathIdParam()],
      success: { payload: { businessHours: ref('BusinessHours') } },
      errors: ['401', '403', '404', '422', '500'],
    }),
    patch: operation({
      tags: 'Business Hours',
      summary: 'Update business hours',
      operationId: 'updateBusinessHours',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: update business-hours fields. Authorization: owner or admin roleKey required. At least one allowed field is required.',
      parameters: [pathIdParam()],
      requestBody: jsonRequest(businessHoursBody()),
      success: {
        messageKey: 'success.sla.businessHours.updated',
        payload: { businessHours: ref('BusinessHours') },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/sla/policies': {
    get: operation({
      tags: 'SLA Policies',
      summary: 'List SLA policies',
      operationId: 'listSlaPolicies',
      description:
        'Purpose: list SLA policies. Viewers can read active policies. Elevated roles may include inactive policies.',
      parameters: [
        ...baseListParams([
          'name',
          '-name',
          'createdAt',
          '-createdAt',
          'updatedAt',
          '-updatedAt',
        ]),
        queryParam('isActive', booleanSchema()),
        queryParam('includeInactive', booleanSchema()),
      ],
      success: {
        payload: {
          page: integerSchema({ minimum: 1 }),
          limit: integerSchema({ minimum: 1 }),
          total: integerSchema({ minimum: 0 }),
          results: integerSchema({ minimum: 0 }),
          policies: arrayOf(ref('SlaPolicy')),
        },
      },
    }),
    post: operation({
      tags: 'SLA Policies',
      summary: 'Create SLA policy',
      operationId: 'createSlaPolicy',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: create an SLA policy. Authorization: owner or admin roleKey required. rulesByPriority must include configured rules for each priority on create.',
      requestBody: jsonRequest(
        slaPolicyBody(['name', 'businessHoursId', 'rulesByPriority'])
      ),
      success: {
        messageKey: 'success.sla.policy.created',
        payload: { policy: ref('SlaPolicy') },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/sla/policies/options': {
    get: operation({
      tags: 'SLA Policies',
      summary: 'List SLA policy options',
      operationId: 'listSlaPolicyOptions',
      description: 'Purpose: return compact SLA policy options for selectors.',
      parameters: [
        ...optionsParams,
        queryParam('isActive', booleanSchema()),
        queryParam('includeInactive', booleanSchema()),
      ],
      success: { payload: { options: arrayOf(ref('SlaPolicyOption')) } },
    }),
  },
  '/sla/policies/{id}': {
    get: operation({
      tags: 'SLA Policies',
      summary: 'Get SLA policy',
      operationId: 'getSlaPolicy',
      description:
        'Purpose: return SLA policy detail. Anti-enumeration: missing, inactive-forbidden, and cross-workspace policies collapse to not found where applicable.',
      parameters: [pathIdParam()],
      success: { payload: { policy: ref('SlaPolicy') } },
      errors: ['401', '403', '404', '422', '500'],
    }),
    patch: operation({
      tags: 'SLA Policies',
      summary: 'Update SLA policy',
      operationId: 'updateSlaPolicy',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: update SLA policy fields. Authorization: owner or admin roleKey required. At least one allowed field is required.',
      parameters: [pathIdParam()],
      requestBody: jsonRequest(slaPolicyBody()),
      success: {
        messageKey: 'success.sla.policy.updated',
        payload: { policy: ref('SlaPolicy') },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/sla/policies/{id}/activate': {
    post: operation({
      tags: 'SLA Policies',
      summary: 'Activate SLA policy',
      operationId: 'activateSlaPolicy',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: activate an SLA policy. Authorization: owner or admin roleKey required. Action response is compact.',
      parameters: [pathIdParam()],
      requestBody: emptyJsonRequest(),
      success: {
        messageKey: 'success.sla.policy.activated',
        payload: { policy: ref('SlaPolicyAction') },
      },
      errors: ['401', '403', '404', '422', '500'],
    }),
  },
  '/sla/policies/{id}/deactivate': {
    post: operation({
      tags: 'SLA Policies',
      summary: 'Deactivate SLA policy',
      operationId: 'deactivateSlaPolicy',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: deactivate an SLA policy and clear or replace related defaults/overrides when needed. Authorization: owner or admin roleKey required. Action response is compact plus deactivation impact metadata.',
      parameters: [pathIdParam()],
      requestBody: jsonRequest(
        objectSchema(
          {
            replacementPolicyId: {
              ...idSchema('Replacement active policy id.'),
              nullable: true,
            },
          },
          { additionalProperties: false }
        )
      ),
      success: {
        messageKey: 'success.sla.policy.deactivated',
        payload: {
          policy: ref('SlaPolicyAction'),
          deactivationImpact: objectSchema({}, { additionalProperties: true }),
        },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/sla/policies/{id}/set-default': {
    post: operation({
      tags: 'SLA Policies',
      summary: 'Set default SLA policy',
      operationId: 'setDefaultSlaPolicy',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: set an active SLA policy as the workspace default. Authorization: owner or admin roleKey required. Action response is compact.',
      parameters: [pathIdParam()],
      requestBody: emptyJsonRequest(),
      success: {
        messageKey: 'success.sla.policy.defaultSet',
        payload: { policy: ref('SlaPolicyAction') },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
};
