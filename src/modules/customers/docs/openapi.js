import {
  arrayOf,
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

const pageParams = [
  queryParam('page', integerSchema({ minimum: 1 })),
  queryParam('limit', integerSchema({ minimum: 1, maximum: 100 })),
];

const contactFilters = [
  queryParam('q', stringSchema({ minLength: 1, maxLength: 120 })),
  queryParam('search', stringSchema({ minLength: 1, maxLength: 120 })),
  queryParam('organizationId', idSchema('Organization id.')),
  queryParam('email', stringSchema({ format: 'email', maxLength: 320 })),
];

const contactSort = queryParam(
  'sort',
  stringSchema({
    enum: [
      'fullName',
      '-fullName',
      'email',
      '-email',
      'createdAt',
      '-createdAt',
      'updatedAt',
      '-updatedAt',
    ],
  })
);

const organizationFilters = [
  queryParam('q', stringSchema({ minLength: 1, maxLength: 120 })),
  queryParam('search', stringSchema({ minLength: 1, maxLength: 120 })),
  queryParam('domain', stringSchema({ minLength: 1, maxLength: 253 })),
];

const organizationSort = queryParam(
  'sort',
  stringSchema({
    enum: [
      'name',
      '-name',
      'domain',
      '-domain',
      'createdAt',
      '-createdAt',
      'updatedAt',
      '-updatedAt',
    ],
  })
);

const contactBodySchema = (required = []) =>
  objectSchema(
    {
      fullName: stringSchema({ minLength: 1, maxLength: 180 }),
      organizationId: { ...idSchema('Organization id.'), nullable: true },
      email: stringSchema({ format: 'email', maxLength: 320, nullable: true }),
      phone: stringSchema({ maxLength: 40, nullable: true }),
      tags: arrayOf(stringSchema({ minLength: 1, maxLength: 50 }), {
        maxItems: 20,
        nullable: true,
      }),
      customFields: objectSchema(
        {},
        {
          additionalProperties: true,
          nullable: true,
          description:
            'Up to 20 keys. Values may be string, number, boolean, or null.',
        }
      ),
    },
    { required, additionalProperties: false }
  );

const organizationBodySchema = (required = []) =>
  objectSchema(
    {
      name: stringSchema({ minLength: 1, maxLength: 180 }),
      domain: stringSchema({ minLength: 1, maxLength: 253, nullable: true }),
      notes: stringSchema({ maxLength: 5000, nullable: true }),
    },
    { required, additionalProperties: false }
  );

export const customersOpenApiPaths = {
  '/customers/contacts': {
    get: operation({
      tags: 'Customer Contacts',
      summary: 'List contacts',
      operationId: 'listContacts',
      description:
        'Purpose: list contacts in the active workspace. Viewers can read. Anti-enumeration: data is scoped to the active workspace.',
      parameters: [...pageParams, ...contactFilters, contactSort],
      success: {
        payload: {
          page: integerSchema({ minimum: 1 }),
          limit: integerSchema({ minimum: 1 }),
          total: integerSchema({ minimum: 0 }),
          results: integerSchema({ minimum: 0 }),
          contacts: arrayOf(ref('Contact')),
        },
      },
    }),
    post: operation({
      tags: 'Customer Contacts',
      summary: 'Create contact',
      operationId: 'createContact',
      description:
        'Purpose: create a contact in the active workspace. Authorization: owner, admin, or agent roleKey required. Referenced organization must belong to the same workspace.',
      requestBody: jsonRequest(contactBodySchema(['fullName'])),
      success: {
        messageKey: 'success.contact.created',
        payload: {
          contact: ref('Contact'),
        },
      },
    }),
  },
  '/customers/contacts/options': {
    get: operation({
      tags: 'Customer Contacts',
      summary: 'List contact options',
      operationId: 'listContactOptions',
      description:
        'Purpose: return compact contact options for selectors in the active workspace.',
      parameters: [
        ...contactFilters,
        queryParam('limit', integerSchema({ minimum: 1, maximum: 50 })),
      ],
      success: {
        payload: {
          options: arrayOf(ref('ContactOption')),
        },
      },
    }),
  },
  '/customers/contacts/{id}': {
    get: operation({
      tags: 'Customer Contacts',
      summary: 'Get contact',
      operationId: 'getContact',
      description:
        'Purpose: return contact detail. Anti-enumeration: missing and cross-workspace contacts collapse to not found.',
      parameters: [pathIdParam()],
      success: {
        payload: {
          contact: ref('Contact'),
        },
      },
      errors: ['401', '403', '404', '422', '500'],
    }),
    patch: operation({
      tags: 'Customer Contacts',
      summary: 'Update contact',
      operationId: 'updateContact',
      description:
        'Purpose: update a contact. Authorization: owner, admin, or agent roleKey required. At least one allowed field is required.',
      parameters: [pathIdParam()],
      requestBody: jsonRequest(contactBodySchema()),
      success: {
        messageKey: 'success.contact.updated',
        payload: {
          contact: ref('Contact'),
        },
      },
      errors: ['401', '403', '404', '422', '500'],
    }),
  },
  '/customers/contacts/{id}/identities': {
    get: operation({
      tags: 'Contact Identities',
      summary: 'List contact identities',
      operationId: 'listContactIdentities',
      description:
        'Purpose: list identities attached to a contact in the active workspace. Anti-enumeration: cross-workspace contacts collapse to not found.',
      parameters: [pathIdParam('id', 'Contact id.')],
      success: {
        payload: {
          identities: arrayOf(ref('ContactIdentity')),
        },
      },
      errors: ['401', '403', '404', '422', '500'],
    }),
    post: operation({
      tags: 'Contact Identities',
      summary: 'Create contact identity',
      operationId: 'createContactIdentity',
      description:
        'Purpose: add an email, phone, or WhatsApp identity to a contact. Authorization: owner, admin, or agent roleKey required.',
      parameters: [pathIdParam('id', 'Contact id.')],
      requestBody: jsonRequest(
        objectSchema(
          {
            type: stringSchema({ enum: ['email', 'phone', 'whatsapp'] }),
            value: stringSchema({ minLength: 1, maxLength: 320 }),
          },
          { required: ['type', 'value'], additionalProperties: false }
        )
      ),
      success: {
        messageKey: 'success.contactIdentity.created',
        payload: {
          identity: ref('ContactIdentity'),
        },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/customers/organizations': {
    get: operation({
      tags: 'Customer Organizations',
      summary: 'List organizations',
      operationId: 'listOrganizations',
      description:
        'Purpose: list customer organizations in the active workspace. Viewers can read. Anti-enumeration: data is workspace-scoped.',
      parameters: [...pageParams, ...organizationFilters, organizationSort],
      success: {
        payload: {
          page: integerSchema({ minimum: 1 }),
          limit: integerSchema({ minimum: 1 }),
          total: integerSchema({ minimum: 0 }),
          results: integerSchema({ minimum: 0 }),
          organizations: arrayOf(ref('Organization')),
        },
      },
    }),
    post: operation({
      tags: 'Customer Organizations',
      summary: 'Create organization',
      operationId: 'createOrganization',
      description:
        'Purpose: create a customer organization. Authorization: owner, admin, or agent roleKey required.',
      requestBody: jsonRequest(organizationBodySchema(['name'])),
      success: {
        messageKey: 'success.organization.created',
        payload: {
          organization: ref('Organization'),
        },
      },
      errors: ['401', '403', '409', '422', '500'],
    }),
  },
  '/customers/organizations/options': {
    get: operation({
      tags: 'Customer Organizations',
      summary: 'List organization options',
      operationId: 'listOrganizationOptions',
      description:
        'Purpose: return compact organization options for selectors in the active workspace.',
      parameters: [
        queryParam('q', stringSchema({ minLength: 1, maxLength: 120 })),
        queryParam('search', stringSchema({ minLength: 1, maxLength: 120 })),
        queryParam('limit', integerSchema({ minimum: 1, maximum: 50 })),
      ],
      success: {
        payload: {
          options: arrayOf(ref('OrganizationOption')),
        },
      },
    }),
  },
  '/customers/organizations/{id}': {
    get: operation({
      tags: 'Customer Organizations',
      summary: 'Get organization',
      operationId: 'getOrganization',
      description:
        'Purpose: return organization detail. Anti-enumeration: missing and cross-workspace organizations collapse to not found.',
      parameters: [pathIdParam()],
      success: {
        payload: {
          organization: ref('Organization'),
        },
      },
      errors: ['401', '403', '404', '422', '500'],
    }),
    patch: operation({
      tags: 'Customer Organizations',
      summary: 'Update organization',
      operationId: 'updateOrganization',
      description:
        'Purpose: update an organization. Authorization: owner, admin, or agent roleKey required. At least one allowed field is required.',
      parameters: [pathIdParam()],
      requestBody: jsonRequest(organizationBodySchema()),
      success: {
        messageKey: 'success.organization.updated',
        payload: {
          organization: ref('Organization'),
        },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
};
