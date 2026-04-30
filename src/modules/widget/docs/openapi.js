import {
  arrayOf,
  booleanSchema,
  emptyJsonRequest,
  idSchema,
  integerSchema,
  jsonRequest,
  multipartRequest,
  objectSchema,
  operation,
  pathIdParam,
  pathStringParam,
  queryParam,
  ref,
  stringSchema,
} from '../../../docs/openapi/helpers.js';

const publicKeyParam = pathStringParam(
  'publicKey',
  'Public widget key.',
  stringSchema({ pattern: '^wgt_[a-f0-9]{32}$' })
);

const sessionToken = stringSchema({ pattern: '^wgs_[a-f0-9]{48}$' });
const recoveryToken = stringSchema({ pattern: '^wgr_[a-f0-9]{48}$' });

const widgetBody = (required = []) =>
  objectSchema(
    {
      name: stringSchema({ minLength: 1, maxLength: 120 }),
      mailboxId: idSchema('Mailbox id.'),
      branding: ref('WidgetBranding'),
      behavior: ref('WidgetBehavior'),
    },
    { required, additionalProperties: false }
  );

const widgetListParams = [
  queryParam('page', integerSchema({ minimum: 1 })),
  queryParam('limit', integerSchema({ minimum: 1, maximum: 100 })),
  queryParam('q', stringSchema({ minLength: 1, maxLength: 120 })),
  queryParam('search', stringSchema({ minLength: 1, maxLength: 120 })),
  queryParam('isActive', booleanSchema()),
  queryParam('includeInactive', booleanSchema()),
  queryParam(
    'sort',
    stringSchema({
      enum: [
        'name',
        '-name',
        'createdAt',
        '-createdAt',
        'updatedAt',
        '-updatedAt',
      ],
    })
  ),
];

export const widgetOpenApiPaths = {
  '/widgets/public/{publicKey}/bootstrap': {
    get: operation({
      tags: 'Public Widget',
      summary: 'Get public widget bootstrap',
      operationId: 'getPublicWidgetBootstrap',
      security: 'public',
      description:
        'Purpose: load public widget configuration by public key. Anti-enumeration: unknown, inactive, or broken widget configuration returns not found.',
      parameters: [publicKeyParam],
      success: {
        payload: {
          widget: ref('PublicWidgetBootstrap'),
          realtime: objectSchema({}, { additionalProperties: true }),
        },
      },
      errors: ['404', '422', '500'],
    }),
  },
  '/widgets/public/{publicKey}/session': {
    post: operation({
      tags: 'Public Widget',
      summary: 'Initialize public widget session',
      operationId: 'initializePublicWidgetSession',
      security: 'public',
      description:
        'Purpose: create or resume a public widget session. Existing sessionToken is optional.',
      parameters: [publicKeyParam],
      requestBody: jsonRequest(
        objectSchema(
          {
            sessionToken: { ...sessionToken, nullable: true },
          },
          { additionalProperties: false }
        )
      ),
      success: {
        messageKey: 'success.widget.sessionInitialized',
        payload: {
          session: ref('PublicWidgetSession'),
          conversation: objectSchema({}, { additionalProperties: true }),
          realtime: objectSchema({}, { additionalProperties: true }),
        },
      },
      errors: ['404', '422', '500'],
    }),
  },
  '/widgets/public/{publicKey}/messages': {
    post: operation({
      tags: 'Public Widget',
      summary: 'Create public widget message',
      operationId: 'createPublicWidgetMessage',
      security: 'public',
      description:
        'Purpose: send a customer message through a public widget session. Attachments must be uploaded through the public widget file endpoint first.',
      parameters: [publicKeyParam],
      requestBody: jsonRequest(
        objectSchema(
          {
            sessionToken,
            name: stringSchema({
              minLength: 1,
              maxLength: 180,
              nullable: true,
            }),
            email: stringSchema({
              format: 'email',
              maxLength: 320,
              nullable: true,
            }),
            message: stringSchema({ minLength: 1, maxLength: 5000 }),
            attachmentFileIds: arrayOf(idSchema('Attachment file id.'), {
              maxItems: 20,
            }),
          },
          { required: ['sessionToken', 'message'], additionalProperties: false }
        )
      ),
      success: {
        messageKey: 'success.widget.messageCreated',
        payload: {
          session: ref('PublicWidgetSession'),
          realtime: objectSchema({}, { additionalProperties: true }),
          message: ref('PublicWidgetMessage'),
          conversation: objectSchema({}, { additionalProperties: true }),
        },
      },
      errors: ['404', '409', '422', '500'],
    }),
  },
  '/widgets/public/{publicKey}/files': {
    post: operation({
      tags: 'Public Widget',
      summary: 'Upload public widget file',
      operationId: 'uploadPublicWidgetFile',
      security: 'public',
      description:
        'Purpose: upload one attachment for an existing public widget session. Uploaded file ids can then be attached to public widget messages.',
      parameters: [publicKeyParam],
      requestBody: multipartRequest(
        {
          file: stringSchema({ format: 'binary' }),
          sessionToken,
        },
        ['file', 'sessionToken']
      ),
      success: {
        messageKey: 'success.file.uploaded',
        payload: { file: ref('File') },
      },
      errors: ['404', '422', '429', '500', '502'],
    }),
  },
  '/widgets/public/{publicKey}/recovery/request': {
    post: operation({
      tags: 'Public Widget Recovery',
      summary: 'Request widget recovery OTP',
      operationId: 'requestWidgetRecovery',
      security: 'public',
      description:
        'Purpose: request an OTP to recover a previous public widget conversation. Anti-enumeration: email lookup details are not exposed.',
      parameters: [publicKeyParam],
      requestBody: jsonRequest(
        objectSchema(
          { email: stringSchema({ format: 'email', maxLength: 320 }) },
          { required: ['email'], additionalProperties: false }
        )
      ),
      success: {
        messageKey: 'success.widget.recoveryRequested',
        payload: { recovery: ref('PublicWidgetRecovery') },
      },
      errors: ['404', '422', '500'],
    }),
  },
  '/widgets/public/{publicKey}/recovery/verify': {
    post: operation({
      tags: 'Public Widget Recovery',
      summary: 'Verify widget recovery OTP',
      operationId: 'verifyWidgetRecovery',
      security: 'public',
      description:
        'Purpose: verify a recovery OTP and receive a recovery token for continuing or starting a new recovered conversation.',
      parameters: [publicKeyParam],
      requestBody: jsonRequest(
        objectSchema(
          {
            email: stringSchema({ format: 'email', maxLength: 320 }),
            code: stringSchema({ pattern: '^\\d{4,8}$' }),
          },
          { required: ['email', 'code'], additionalProperties: false }
        )
      ),
      success: {
        messageKey: 'success.widget.recoveryVerified',
        payload: { recovery: ref('PublicWidgetRecovery') },
      },
      errors: ['401', '404', '422', '500'],
    }),
  },
  '/widgets/public/{publicKey}/recovery/continue': {
    post: operation({
      tags: 'Public Widget Recovery',
      summary: 'Continue recovered widget conversation',
      operationId: 'continueRecoveredWidgetConversation',
      security: 'public',
      description:
        'Purpose: continue the latest recoverable widget conversation using a recovery token.',
      parameters: [publicKeyParam],
      requestBody: jsonRequest(
        objectSchema(
          { recoveryToken },
          { required: ['recoveryToken'], additionalProperties: false }
        )
      ),
      success: {
        messageKey: 'success.widget.recoveryContinued',
        payload: {
          session: ref('PublicWidgetSession'),
          conversation: objectSchema({}, { additionalProperties: true }),
          realtime: objectSchema({}, { additionalProperties: true }),
        },
      },
      errors: ['401', '404', '409', '422', '500'],
    }),
  },
  '/widgets/public/{publicKey}/recovery/start-new': {
    post: operation({
      tags: 'Public Widget Recovery',
      summary: 'Start new recovered widget conversation',
      operationId: 'startNewRecoveredWidgetConversation',
      security: 'public',
      description:
        'Purpose: start a new widget session after recovery verification.',
      parameters: [publicKeyParam],
      requestBody: jsonRequest(
        objectSchema(
          { recoveryToken },
          { required: ['recoveryToken'], additionalProperties: false }
        )
      ),
      success: {
        messageKey: 'success.widget.recoveryStartedNew',
        payload: {
          session: ref('PublicWidgetSession'),
          conversation: objectSchema({}, { additionalProperties: true }),
          realtime: objectSchema({}, { additionalProperties: true }),
        },
      },
      errors: ['401', '404', '409', '422', '500'],
    }),
  },
  '/widgets': {
    get: operation({
      tags: 'Widgets',
      summary: 'List widgets',
      operationId: 'listWidgets',
      description:
        'Purpose: list widgets in the active workspace. Viewers can read active widgets. Elevated roles may include inactive widgets.',
      parameters: widgetListParams,
      success: {
        payload: {
          page: integerSchema({ minimum: 1 }),
          limit: integerSchema({ minimum: 1 }),
          total: integerSchema({ minimum: 0 }),
          results: integerSchema({ minimum: 0 }),
          widgets: arrayOf(ref('Widget')),
        },
      },
    }),
    post: operation({
      tags: 'Widgets',
      summary: 'Create widget',
      operationId: 'createWidget',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: create a public support widget for a mailbox. Authorization: owner or admin roleKey required.',
      requestBody: jsonRequest(widgetBody(['name', 'mailboxId'])),
      success: {
        messageKey: 'success.widget.created',
        payload: { widget: ref('Widget') },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/widgets/options': {
    get: operation({
      tags: 'Widgets',
      summary: 'List widget options',
      operationId: 'listWidgetOptions',
      description:
        'Purpose: return compact widget options for selectors in the active workspace.',
      parameters: [
        queryParam('q', stringSchema({ minLength: 1, maxLength: 120 })),
        queryParam('search', stringSchema({ minLength: 1, maxLength: 120 })),
        queryParam('limit', integerSchema({ minimum: 1, maximum: 50 })),
        queryParam('isActive', booleanSchema()),
        queryParam('includeInactive', booleanSchema()),
      ],
      success: { payload: { options: arrayOf(ref('WidgetOption')) } },
    }),
  },
  '/widgets/{id}': {
    get: operation({
      tags: 'Widgets',
      summary: 'Get widget',
      operationId: 'getWidget',
      description:
        'Purpose: return widget detail. Anti-enumeration: missing, inactive-forbidden, and cross-workspace widgets collapse to not found where applicable.',
      parameters: [pathIdParam()],
      success: { payload: { widget: ref('Widget') } },
      errors: ['401', '403', '404', '422', '500'],
    }),
    patch: operation({
      tags: 'Widgets',
      summary: 'Update widget',
      operationId: 'updateWidget',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: update widget settings. Authorization: owner or admin roleKey required. At least one allowed top-level or nested field is required.',
      parameters: [pathIdParam()],
      requestBody: jsonRequest(widgetBody()),
      success: {
        messageKey: 'success.widget.updated',
        payload: { widget: ref('Widget') },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/widgets/{id}/activate': {
    post: operation({
      tags: 'Widgets',
      summary: 'Activate widget',
      operationId: 'activateWidget',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: activate a widget. Authorization: owner or admin roleKey required. Action response is compact.',
      parameters: [pathIdParam()],
      requestBody: emptyJsonRequest(),
      success: {
        messageKey: 'success.widget.activated',
        payload: { widget: ref('WidgetAction') },
      },
      errors: ['401', '403', '404', '422', '500'],
    }),
  },
  '/widgets/{id}/deactivate': {
    post: operation({
      tags: 'Widgets',
      summary: 'Deactivate widget',
      operationId: 'deactivateWidget',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: deactivate a widget. Authorization: owner or admin roleKey required. Action response is compact.',
      parameters: [pathIdParam()],
      requestBody: emptyJsonRequest(),
      success: {
        messageKey: 'success.widget.deactivated',
        payload: { widget: ref('WidgetAction') },
      },
      errors: ['401', '403', '404', '422', '500'],
    }),
  },
};
