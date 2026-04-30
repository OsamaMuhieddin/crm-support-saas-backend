import {
  PLATFORM_ROLES,
  PLATFORM_ROLE_VALUES,
} from '../../constants/platform-roles.js';
import {
  WORKSPACE_ROLES,
  WORKSPACE_ROLE_VALUES,
} from '../../constants/workspace-roles.js';

export const ref = (schemaName) => ({
  $ref: `#/components/schemas/${schemaName}`,
});

export const nullableRef = (schemaName) => ({
  allOf: [ref(schemaName)],
  nullable: true,
});

export const parameterRef = (parameterName) => ({
  $ref: `#/components/parameters/${parameterName}`,
});

export const arrayOf = (items, options = {}) => ({
  type: 'array',
  items,
  ...options,
});

export const objectSchema = (
  properties = {},
  {
    required = [],
    additionalProperties = false,
    description,
    nullable = false,
    example,
    maxProperties,
  } = {}
) => ({
  type: 'object',
  ...(description ? { description } : {}),
  ...(nullable ? { nullable: true } : {}),
  properties,
  ...(required.length > 0 ? { required } : {}),
  additionalProperties,
  ...(example !== undefined ? { example } : {}),
  ...(maxProperties !== undefined ? { maxProperties } : {}),
});

export const stringSchema = ({
  format,
  enum: enumValues,
  minLength,
  maxLength,
  pattern,
  nullable = false,
  description,
  example,
} = {}) => ({
  type: 'string',
  ...(format ? { format } : {}),
  ...(enumValues ? { enum: enumValues } : {}),
  ...(minLength !== undefined ? { minLength } : {}),
  ...(maxLength !== undefined ? { maxLength } : {}),
  ...(pattern ? { pattern } : {}),
  ...(nullable ? { nullable: true } : {}),
  ...(description ? { description } : {}),
  ...(example !== undefined ? { example } : {}),
});

export const integerSchema = ({
  minimum,
  maximum,
  nullable = false,
  description,
  example,
} = {}) => ({
  type: 'integer',
  ...(minimum !== undefined ? { minimum } : {}),
  ...(maximum !== undefined ? { maximum } : {}),
  ...(nullable ? { nullable: true } : {}),
  ...(description ? { description } : {}),
  ...(example !== undefined ? { example } : {}),
});

export const numberSchema = ({
  minimum,
  maximum,
  nullable = false,
  description,
  example,
} = {}) => ({
  type: 'number',
  ...(minimum !== undefined ? { minimum } : {}),
  ...(maximum !== undefined ? { maximum } : {}),
  ...(nullable ? { nullable: true } : {}),
  ...(description ? { description } : {}),
  ...(example !== undefined ? { example } : {}),
});

export const booleanSchema = ({
  description,
  example,
  nullable = false,
} = {}) => ({
  type: 'boolean',
  ...(description ? { description } : {}),
  ...(example !== undefined ? { example } : {}),
  ...(nullable ? { nullable: true } : {}),
});

export const idSchema = (description = 'MongoDB ObjectId') =>
  stringSchema({
    pattern: '^[a-fA-F0-9]{24}$',
    description,
    example: '64f1a6f3b7c9a0a1b2c3d4e5',
  });

export const dateTimeSchema = (description = 'ISO 8601 date-time') =>
  stringSchema({ format: 'date-time', description });

export const dateSchema = (description = 'ISO 8601 date') =>
  stringSchema({ format: 'date', description, example: '2026-04-27' });

export const pathIdParam = (name = 'id', description = 'Resource id') => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: idSchema(description),
});

export const pathStringParam = (
  name,
  description,
  schema = stringSchema()
) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema,
});

export const queryParam = (
  name,
  schema = stringSchema(),
  description,
  required = false
) => ({
  name,
  in: 'query',
  required,
  ...(description ? { description } : {}),
  schema,
});

export const headerParam = (
  name,
  schema = stringSchema(),
  description,
  required = false
) => ({
  name,
  in: 'header',
  required,
  ...(description ? { description } : {}),
  schema,
});

export const jsonRequest = (schema, description = 'JSON request body') => ({
  required: true,
  description,
  content: {
    'application/json': {
      schema,
    },
  },
});

export const optionalJsonRequest = (
  schema,
  description = 'Optional JSON request body'
) => ({
  required: false,
  description,
  content: {
    'application/json': {
      schema,
    },
  },
});

export const emptyJsonRequest = () =>
  optionalJsonRequest(
    objectSchema(
      {},
      {
        additionalProperties: false,
        maxProperties: 0,
        description: 'Empty object. Extra fields are rejected.',
      }
    ),
    'No request fields are accepted.'
  );

export const multipartRequest = (
  properties,
  required = [],
  description = 'Multipart form-data request body'
) => ({
  required: true,
  description,
  content: {
    'multipart/form-data': {
      schema: objectSchema(properties, {
        required,
        additionalProperties: false,
      }),
    },
  },
});

const successEnvelopeWith = (payloadProperties = null) => {
  if (!payloadProperties) {
    return ref('SuccessEnvelope');
  }

  return {
    allOf: [
      ref('SuccessEnvelope'),
      objectSchema(payloadProperties, { additionalProperties: true }),
    ],
  };
};

const exampleValueForSchema = (schema) => {
  if (!schema || schema.$ref || schema.allOf || schema.oneOf) {
    return {};
  }

  if (schema.type === 'array') {
    return [];
  }

  if (schema.type === 'string') {
    return schema.example || '';
  }

  if (schema.type === 'integer' || schema.type === 'number') {
    return schema.example || 0;
  }

  if (schema.type === 'boolean') {
    return schema.example || false;
  }

  if (schema.nullable) {
    return null;
  }

  return {};
};

export const successResponse = ({
  description = 'Successful response.',
  messageKey = 'success.ok',
  payload = null,
  example,
} = {}) => ({
  description,
  content: {
    'application/json': {
      schema: successEnvelopeWith(payload),
      example: example || {
        messageKey,
        message: 'OK',
        ...(payload
          ? Object.fromEntries(
              Object.keys(payload).map((key) => [
                key,
                exampleValueForSchema(payload[key]),
              ])
            )
          : {}),
      },
    },
  },
});

export const binaryResponse = (
  description = 'Binary stream response.',
  contentTypes = ['application/octet-stream']
) => ({
  description,
  content: Object.fromEntries(
    contentTypes.map((contentType) => [
      contentType,
      {
        schema: {
          type: 'string',
          format: 'binary',
        },
      },
    ])
  ),
});

const errorResponse = (description, schemaName = 'ErrorEnvelope') => ({
  description,
  content: {
    'application/json': {
      schema: ref(schemaName),
    },
  },
});

export const commonErrorResponses = (codes = []) => {
  const responseMap = {
    400: errorResponse('Malformed request or invalid headers.'),
    401: errorResponse('Authentication is missing, invalid, or expired.'),
    403: errorResponse(
      'The authenticated actor is not allowed to perform this action.'
    ),
    404: errorResponse(
      'The resource was not found or is hidden by workspace scoping.'
    ),
    409: errorResponse(
      'The request conflicts with the current resource state.'
    ),
    422: errorResponse('Validation failed.', 'ValidationErrorEnvelope'),
    429: errorResponse('Rate limit exceeded.'),
    500: errorResponse('Unexpected server error.'),
    502: errorResponse('Upstream storage or provider failure.'),
  };

  return Object.fromEntries(
    codes
      .filter((code) => responseMap[String(code)])
      .map((code) => [String(code), responseMap[String(code)]])
  );
};

const WORKSPACE_OPERATIONAL_ROLE_VALUES = Object.freeze([
  WORKSPACE_ROLES.OWNER,
  WORKSPACE_ROLES.ADMIN,
  WORKSPACE_ROLES.AGENT,
]);

const WORKSPACE_ELEVATED_ROLE_VALUES = Object.freeze([
  WORKSPACE_ROLES.OWNER,
  WORKSPACE_ROLES.ADMIN,
]);

const PLATFORM_ANALYTICS_ROLE_VALUES = Object.freeze([
  PLATFORM_ROLES.SUPER_ADMIN,
  PLATFORM_ROLES.PLATFORM_ADMIN,
]);

const PLATFORM_SUPER_ADMIN_ROLE_VALUES = Object.freeze([
  PLATFORM_ROLES.SUPER_ADMIN,
]);

const BEARER_HEADER = 'Authorization: Bearer access token';

const workspaceAuthProfile = ({ allowedRoleKeys, description }) => ({
  security: [{ bearerAuth: [] }],
  auth: {
    protected: true,
    scheme: 'bearerAuth',
    header: BEARER_HEADER,
    scope: 'workspace',
    workspaceScoped: true,
    requiresActiveUser: true,
    requiresActiveMember: true,
    allowedRoleKeys,
    description,
  },
});

const platformAuthProfile = ({ allowedRoleKeys, description }) => ({
  security: [{ platformBearerAuth: [] }],
  auth: {
    protected: true,
    scheme: 'platformBearerAuth',
    header: BEARER_HEADER,
    scope: 'platform',
    workspaceScoped: false,
    requiresActivePlatformAdmin: true,
    allowedRoleKeys,
    description,
  },
});

const AUTH_PROFILES = {
  public: {
    security: [],
    auth: {
      protected: false,
      scope: 'public',
      description: 'No bearer access token is required.',
    },
  },
  stripeWebhook: {
    security: [],
    auth: {
      protected: true,
      scope: 'webhook',
      signatureHeader: 'stripe-signature',
      description:
        'Stripe signature verification is required; no bearer access token is used.',
    },
  },
  user: {
    security: [{ bearerAuth: [] }],
    auth: {
      protected: true,
      scheme: 'bearerAuth',
      header: BEARER_HEADER,
      scope: 'user',
      workspaceScoped: false,
      requiresActiveUser: true,
      requiresActiveMember: false,
      description:
        'Authenticated active user access token required; no workspace roleKey gate is applied.',
    },
  },
  tenant: workspaceAuthProfile({
    allowedRoleKeys: WORKSPACE_ROLE_VALUES,
    description:
      'Authenticated active workspace member required. Allowed roleKey values: owner, admin, agent, viewer.',
  }),
  workspaceOwnerAdmin: workspaceAuthProfile({
    allowedRoleKeys: WORKSPACE_ELEVATED_ROLE_VALUES,
    description:
      'Authenticated active workspace member required. Allowed roleKey values: owner, admin.',
  }),
  workspaceOwnerAdminAgent: workspaceAuthProfile({
    allowedRoleKeys: WORKSPACE_OPERATIONAL_ROLE_VALUES,
    description:
      'Authenticated active workspace member required. Allowed roleKey values: owner, admin, agent.',
  }),
  platform: platformAuthProfile({
    allowedRoleKeys: PLATFORM_ROLE_VALUES,
    description:
      'Authenticated active platform admin required. Allowed platform role values: super_admin, platform_admin, platform_support.',
  }),
  platformAnalytics: platformAuthProfile({
    allowedRoleKeys: PLATFORM_ANALYTICS_ROLE_VALUES,
    description:
      'Authenticated active platform admin required. Allowed platform role values: super_admin, platform_admin.',
  }),
  platformSuperAdmin: platformAuthProfile({
    allowedRoleKeys: PLATFORM_SUPER_ADMIN_ROLE_VALUES,
    description:
      'Authenticated active platform admin required. Allowed platform role value: super_admin.',
  }),
};

const resolveAuthProfile = (security) =>
  AUTH_PROFILES[security] || AUTH_PROFILES.tenant;

const appendAuthorizationDescription = (description, auth) => {
  if (!auth?.protected || !auth.description) {
    return description;
  }

  if (/Authorization:/i.test(String(description || ''))) {
    return description;
  }

  const separator = description ? ' ' : '';
  return `${description || ''}${separator}Authorization: ${auth.description}`;
};

export const operation = ({
  tags,
  summary,
  description,
  operationId,
  security = 'tenant',
  auth,
  includeLang = true,
  parameters = [],
  requestBody,
  responses,
  success,
  errors = ['401', '403', '422', '500'],
}) => {
  const authProfile = resolveAuthProfile(security);
  const resolvedAuth = auth
    ? { ...authProfile.auth, ...auth }
    : authProfile.auth;
  const resolvedDescription = appendAuthorizationDescription(
    description,
    resolvedAuth
  );

  return {
    tags: Array.isArray(tags) ? tags : [tags],
    summary,
    description: resolvedDescription,
    operationId,
    ...(authProfile.security.length > 0
      ? { security: authProfile.security }
      : {}),
    'x-auth': resolvedAuth,
    parameters: [
      ...(includeLang ? [parameterRef('LangHeader')] : []),
      ...parameters,
    ],
    ...(requestBody ? { requestBody } : {}),
    responses: responses || {
      200: successResponse(success),
      ...commonErrorResponses(errors),
    },
  };
};

export const paginatedPayload = (itemsKey, itemSchemaName) => ({
  page: integerSchema({ minimum: 1 }),
  limit: integerSchema({ minimum: 1 }),
  total: integerSchema({ minimum: 0 }),
  results: integerSchema({ minimum: 0 }),
  [itemsKey]: arrayOf(ref(itemSchemaName)),
});

export const mergePaths = (...pathGroups) =>
  pathGroups.reduce((paths, group) => ({ ...paths, ...group }), {});
