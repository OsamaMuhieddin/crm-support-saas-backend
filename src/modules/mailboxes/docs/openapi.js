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

const listMailboxParams = [
  queryParam('page', integerSchema({ minimum: 1 })),
  queryParam('limit', integerSchema({ minimum: 1, maximum: 100 })),
  queryParam('q', stringSchema({ minLength: 1, maxLength: 120 })),
  queryParam('search', stringSchema({ minLength: 1, maxLength: 120 })),
  queryParam('isActive', booleanSchema()),
  queryParam('isDefault', booleanSchema()),
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

const mailboxBody = (required = []) =>
  objectSchema(
    {
      name: stringSchema({ minLength: 1, maxLength: 120 }),
      type: stringSchema({ enum: ['email'] }),
      emailAddress: stringSchema({
        format: 'email',
        maxLength: 320,
        nullable: true,
      }),
      fromName: stringSchema({ minLength: 1, maxLength: 120, nullable: true }),
      replyTo: stringSchema({
        format: 'email',
        maxLength: 320,
        nullable: true,
      }),
      signatureText: stringSchema({
        minLength: 1,
        maxLength: 10000,
        nullable: true,
      }),
      signatureHtml: stringSchema({
        minLength: 1,
        maxLength: 50000,
        nullable: true,
      }),
      slaPolicyId: { ...idSchema('SLA policy id.'), nullable: true },
    },
    { required, additionalProperties: false }
  );

export const mailboxesOpenApiPaths = {
  '/mailboxes': {
    get: operation({
      tags: 'Mailboxes',
      summary: 'List mailboxes',
      operationId: 'listMailboxes',
      description:
        'Purpose: list workspace mailboxes. Viewers can read active mailboxes. Elevated roles may include inactive records.',
      parameters: listMailboxParams,
      success: {
        payload: {
          page: integerSchema({ minimum: 1 }),
          limit: integerSchema({ minimum: 1 }),
          total: integerSchema({ minimum: 0 }),
          results: integerSchema({ minimum: 0 }),
          mailboxes: arrayOf(ref('Mailbox')),
        },
      },
    }),
    post: operation({
      tags: 'Mailboxes',
      summary: 'Create mailbox',
      operationId: 'createMailbox',
      description:
        'Purpose: create an email mailbox. Authorization: owner or admin roleKey required. Referenced SLA policy must belong to the active workspace.',
      requestBody: jsonRequest(mailboxBody(['name'])),
      success: {
        messageKey: 'success.mailbox.created',
        payload: {
          mailbox: ref('Mailbox'),
        },
      },
      errors: ['401', '403', '409', '422', '500'],
    }),
  },
  '/mailboxes/options': {
    get: operation({
      tags: 'Mailboxes',
      summary: 'List mailbox options',
      operationId: 'listMailboxOptions',
      description:
        'Purpose: return compact mailbox options for selectors in the active workspace.',
      parameters: [
        queryParam('q', stringSchema({ minLength: 1, maxLength: 120 })),
        queryParam('search', stringSchema({ minLength: 1, maxLength: 120 })),
        queryParam('limit', integerSchema({ minimum: 1, maximum: 50 })),
        queryParam('isActive', booleanSchema()),
        queryParam('includeInactive', booleanSchema()),
      ],
      success: {
        payload: {
          options: arrayOf(ref('MailboxOption')),
        },
      },
    }),
  },
  '/mailboxes/{id}': {
    get: operation({
      tags: 'Mailboxes',
      summary: 'Get mailbox',
      operationId: 'getMailbox',
      description:
        'Purpose: return mailbox detail. Anti-enumeration: missing, inactive-forbidden, and cross-workspace mailboxes collapse to not found where applicable.',
      parameters: [pathIdParam()],
      success: {
        payload: {
          mailbox: ref('Mailbox'),
        },
      },
      errors: ['401', '403', '404', '422', '500'],
    }),
    patch: operation({
      tags: 'Mailboxes',
      summary: 'Update mailbox',
      operationId: 'updateMailbox',
      description:
        'Purpose: update mailbox settings. Authorization: owner or admin roleKey required. At least one allowed field is required.',
      parameters: [pathIdParam()],
      requestBody: jsonRequest(mailboxBody()),
      success: {
        messageKey: 'success.mailbox.updated',
        payload: {
          mailbox: ref('Mailbox'),
        },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/mailboxes/{id}/set-default': {
    post: operation({
      tags: 'Mailboxes',
      summary: 'Set default mailbox',
      operationId: 'setDefaultMailbox',
      description:
        'Purpose: make a mailbox the workspace default. Authorization: owner or admin roleKey required. Action response is compact.',
      parameters: [pathIdParam()],
      requestBody: emptyJsonRequest(),
      success: {
        messageKey: 'success.mailbox.defaultSet',
        payload: {
          mailbox: ref('MailboxAction'),
        },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/mailboxes/{id}/activate': {
    post: operation({
      tags: 'Mailboxes',
      summary: 'Activate mailbox',
      operationId: 'activateMailbox',
      description:
        'Purpose: activate a mailbox. Authorization: owner or admin roleKey required. Action response is compact.',
      parameters: [pathIdParam()],
      requestBody: emptyJsonRequest(),
      success: {
        messageKey: 'success.mailbox.activated',
        payload: {
          mailbox: ref('MailboxAction'),
        },
      },
      errors: ['401', '403', '404', '422', '500'],
    }),
  },
  '/mailboxes/{id}/deactivate': {
    post: operation({
      tags: 'Mailboxes',
      summary: 'Deactivate mailbox',
      operationId: 'deactivateMailbox',
      description:
        'Purpose: deactivate a mailbox when business rules allow it. Authorization: owner or admin roleKey required. Action response is compact.',
      parameters: [pathIdParam()],
      requestBody: emptyJsonRequest(),
      success: {
        messageKey: 'success.mailbox.deactivated',
        payload: {
          mailbox: ref('MailboxAction'),
        },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
};
