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

const ticketIdParam = pathIdParam('id', 'Ticket id.');
const dictionaryIdParam = pathIdParam('id', 'Dictionary resource id.');

const paginationParams = [
  queryParam('page', integerSchema({ minimum: 1 })),
  queryParam('limit', integerSchema({ minimum: 1, maximum: 100 })),
];

const activeVisibilityParams = [
  queryParam('isActive', booleanSchema()),
  queryParam('includeInactive', booleanSchema()),
];

const categoryListParams = [
  ...paginationParams,
  queryParam('q', stringSchema({ minLength: 1, maxLength: 120 })),
  queryParam('search', stringSchema({ minLength: 1, maxLength: 120 })),
  queryParam('parentId', idSchema('Parent category id.')),
  ...activeVisibilityParams,
  queryParam(
    'sort',
    stringSchema({
      enum: [
        'order',
        '-order',
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

const tagListParams = [
  ...paginationParams,
  queryParam('q', stringSchema({ minLength: 1, maxLength: 80 })),
  queryParam('search', stringSchema({ minLength: 1, maxLength: 80 })),
  ...activeVisibilityParams,
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

const ticketListParams = [
  ...paginationParams,
  queryParam('q', stringSchema({ minLength: 1, maxLength: 120 })),
  queryParam('search', stringSchema({ minLength: 1, maxLength: 120 })),
  queryParam(
    'status',
    stringSchema({
      description:
        'One status, comma-separated statuses, or repeated status query parameters.',
      enum: [
        'new',
        'open',
        'pending',
        'waiting_on_customer',
        'solved',
        'closed',
      ],
    })
  ),
  queryParam(
    'priority',
    stringSchema({ enum: ['low', 'normal', 'high', 'urgent'] })
  ),
  queryParam('mailboxId', idSchema('Mailbox id.')),
  queryParam('assigneeId', idSchema('Assignee user id.')),
  queryParam('unassigned', booleanSchema()),
  queryParam('categoryId', idSchema('Category id.')),
  queryParam('tagId', idSchema('Tag id.')),
  queryParam('contactId', idSchema('Contact id.')),
  queryParam('organizationId', idSchema('Organization id.')),
  queryParam(
    'channel',
    stringSchema({ enum: ['manual', 'email', 'widget', 'api', 'system'] })
  ),
  queryParam('includeClosed', booleanSchema()),
  queryParam('createdFrom', stringSchema({ format: 'date-time' })),
  queryParam('createdTo', stringSchema({ format: 'date-time' })),
  queryParam('updatedFrom', stringSchema({ format: 'date-time' })),
  queryParam('updatedTo', stringSchema({ format: 'date-time' })),
  queryParam(
    'sort',
    stringSchema({
      enum: [
        'number',
        '-number',
        'subject',
        '-subject',
        'priority',
        '-priority',
        'createdAt',
        '-createdAt',
        'updatedAt',
        '-updatedAt',
        'lastMessageAt',
        '-lastMessageAt',
      ],
    })
  ),
];

const categoryBody = (required = []) =>
  objectSchema(
    {
      name: stringSchema({ minLength: 1, maxLength: 120 }),
      slug: stringSchema({ minLength: 1, maxLength: 140, nullable: true }),
      parentId: { ...idSchema('Parent category id.'), nullable: true },
      order: integerSchema(),
    },
    { required, additionalProperties: false }
  );

const tagBody = (required = []) =>
  objectSchema(
    {
      name: stringSchema({ minLength: 1, maxLength: 80 }),
    },
    { required, additionalProperties: false }
  );

const ticketInitialMessage = objectSchema(
  {
    type: stringSchema({ enum: ['customer_message', 'internal_note'] }),
    bodyText: stringSchema({ minLength: 1, maxLength: 50000 }),
    bodyHtml: stringSchema({ minLength: 1, maxLength: 50000, nullable: true }),
    attachmentFileIds: arrayOf(idSchema('Attachment file id.'), {
      maxItems: 20,
    }),
  },
  {
    required: ['type', 'bodyText'],
    additionalProperties: false,
    nullable: true,
  }
);

const ticketCreateBody = objectSchema(
  {
    subject: stringSchema({ minLength: 1, maxLength: 240 }),
    mailboxId: { ...idSchema('Mailbox id.'), nullable: true },
    contactId: idSchema('Contact id.'),
    organizationId: { ...idSchema('Organization id.'), nullable: true },
    priority: stringSchema({ enum: ['low', 'normal', 'high', 'urgent'] }),
    categoryId: { ...idSchema('Category id.'), nullable: true },
    tagIds: arrayOf(idSchema('Tag id.'), { maxItems: 100 }),
    assigneeId: { ...idSchema('Assignee user id.'), nullable: true },
    initialMessage: ticketInitialMessage,
  },
  {
    required: ['subject', 'contactId'],
    additionalProperties: false,
    example: {
      subject: 'Cannot access billing portal',
      contactId: '64f1a6f3b7c9a0a1b2c3d4e5',
      priority: 'normal',
      tagIds: ['64f1a6f3b7c9a0a1b2c3d4e6'],
      initialMessage: {
        type: 'customer_message',
        bodyText: 'The customer cannot open the billing portal.',
      },
    },
  }
);

const ticketUpdateBody = objectSchema(
  {
    subject: stringSchema({ minLength: 1, maxLength: 240 }),
    priority: stringSchema({ enum: ['low', 'normal', 'high', 'urgent'] }),
    categoryId: { ...idSchema('Category id.'), nullable: true },
    tagIds: arrayOf(idSchema('Tag id.'), { maxItems: 100 }),
    mailboxId: idSchema('Mailbox id.'),
  },
  { additionalProperties: false }
);

const messageBody = objectSchema(
  {
    type: stringSchema({
      enum: ['customer_message', 'public_reply', 'internal_note'],
    }),
    bodyText: stringSchema({ minLength: 1, maxLength: 50000 }),
    bodyHtml: stringSchema({ minLength: 1, maxLength: 50000, nullable: true }),
    attachmentFileIds: arrayOf(idSchema('Attachment file id.'), {
      maxItems: 20,
    }),
  },
  { required: ['type', 'bodyText'], additionalProperties: false }
);

export const ticketsOpenApiPaths = {
  '/tickets/categories': {
    get: operation({
      tags: 'Ticket Categories',
      summary: 'List ticket categories',
      operationId: 'listTicketCategories',
      description:
        'Purpose: list categories in the active workspace. Viewers can read active categories. Elevated roles may include inactive categories.',
      parameters: categoryListParams,
      success: {
        payload: {
          page: integerSchema({ minimum: 1 }),
          limit: integerSchema({ minimum: 1 }),
          total: integerSchema({ minimum: 0 }),
          results: integerSchema({ minimum: 0 }),
          categories: arrayOf(ref('TicketCategory')),
        },
      },
    }),
    post: operation({
      tags: 'Ticket Categories',
      summary: 'Create ticket category',
      operationId: 'createTicketCategory',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: create a ticket category. Authorization: owner or admin roleKey required. Parent category must be active and in the same workspace.',
      requestBody: jsonRequest(categoryBody(['name'])),
      success: {
        messageKey: 'success.ticketCategory.created',
        payload: { category: ref('TicketCategory') },
      },
      errors: ['401', '403', '409', '422', '500'],
    }),
  },
  '/tickets/categories/options': {
    get: operation({
      tags: 'Ticket Categories',
      summary: 'List ticket category options',
      operationId: 'listTicketCategoryOptions',
      description:
        'Purpose: return compact category options for selectors in the active workspace.',
      parameters: [
        queryParam('q', stringSchema({ minLength: 1, maxLength: 120 })),
        queryParam('search', stringSchema({ minLength: 1, maxLength: 120 })),
        queryParam('parentId', idSchema('Parent category id.')),
        queryParam('limit', integerSchema({ minimum: 1, maximum: 50 })),
        ...activeVisibilityParams,
      ],
      success: { payload: { options: arrayOf(ref('TicketCategoryOption')) } },
    }),
  },
  '/tickets/categories/{id}': {
    get: operation({
      tags: 'Ticket Categories',
      summary: 'Get ticket category',
      operationId: 'getTicketCategory',
      description:
        'Purpose: return category detail. Anti-enumeration: missing, inactive-forbidden, and cross-workspace categories collapse to not found where applicable.',
      parameters: [dictionaryIdParam],
      success: { payload: { category: ref('TicketCategory') } },
      errors: ['401', '403', '404', '422', '500'],
    }),
    patch: operation({
      tags: 'Ticket Categories',
      summary: 'Update ticket category',
      operationId: 'updateTicketCategory',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: update category fields. Authorization: owner or admin roleKey required. At least one allowed field is required.',
      parameters: [dictionaryIdParam],
      requestBody: jsonRequest(categoryBody()),
      success: {
        messageKey: 'success.ticketCategory.updated',
        payload: { category: ref('TicketCategory') },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/tickets/categories/{id}/activate': {
    post: operation({
      tags: 'Ticket Categories',
      summary: 'Activate ticket category',
      operationId: 'activateTicketCategory',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: activate a category. Authorization: owner or admin roleKey required. Request body accepts no fields.',
      parameters: [dictionaryIdParam],
      requestBody: emptyJsonRequest(),
      success: {
        messageKey: 'success.ticketCategory.activated',
        payload: { category: ref('TicketCategory') },
      },
      errors: ['401', '403', '404', '422', '500'],
    }),
  },
  '/tickets/categories/{id}/deactivate': {
    post: operation({
      tags: 'Ticket Categories',
      summary: 'Deactivate ticket category',
      operationId: 'deactivateTicketCategory',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: deactivate a category when business rules allow it. Authorization: owner or admin roleKey required. Request body accepts no fields.',
      parameters: [dictionaryIdParam],
      requestBody: emptyJsonRequest(),
      success: {
        messageKey: 'success.ticketCategory.deactivated',
        payload: { category: ref('TicketCategory') },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/tickets/tags': {
    get: operation({
      tags: 'Ticket Tags',
      summary: 'List ticket tags',
      operationId: 'listTicketTags',
      description:
        'Purpose: list tags in the active workspace. Viewers can read active tags. Elevated roles may include inactive tags.',
      parameters: tagListParams,
      success: {
        payload: {
          page: integerSchema({ minimum: 1 }),
          limit: integerSchema({ minimum: 1 }),
          total: integerSchema({ minimum: 0 }),
          results: integerSchema({ minimum: 0 }),
          tags: arrayOf(ref('TicketTag')),
        },
      },
    }),
    post: operation({
      tags: 'Ticket Tags',
      summary: 'Create ticket tag',
      operationId: 'createTicketTag',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: create a ticket tag. Authorization: owner or admin roleKey required.',
      requestBody: jsonRequest(tagBody(['name'])),
      success: {
        messageKey: 'success.ticketTag.created',
        payload: { tag: ref('TicketTag') },
      },
      errors: ['401', '403', '409', '422', '500'],
    }),
  },
  '/tickets/tags/options': {
    get: operation({
      tags: 'Ticket Tags',
      summary: 'List ticket tag options',
      operationId: 'listTicketTagOptions',
      description:
        'Purpose: return compact tag options for selectors in the active workspace.',
      parameters: [
        queryParam('q', stringSchema({ minLength: 1, maxLength: 80 })),
        queryParam('search', stringSchema({ minLength: 1, maxLength: 80 })),
        queryParam('limit', integerSchema({ minimum: 1, maximum: 50 })),
        ...activeVisibilityParams,
      ],
      success: { payload: { options: arrayOf(ref('TicketTagOption')) } },
    }),
  },
  '/tickets/tags/{id}': {
    get: operation({
      tags: 'Ticket Tags',
      summary: 'Get ticket tag',
      operationId: 'getTicketTag',
      description:
        'Purpose: return tag detail. Anti-enumeration: missing, inactive-forbidden, and cross-workspace tags collapse to not found where applicable.',
      parameters: [dictionaryIdParam],
      success: { payload: { tag: ref('TicketTag') } },
      errors: ['401', '403', '404', '422', '500'],
    }),
    patch: operation({
      tags: 'Ticket Tags',
      summary: 'Update ticket tag',
      operationId: 'updateTicketTag',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: update a tag name. Authorization: owner or admin roleKey required. At least one allowed field is required.',
      parameters: [dictionaryIdParam],
      requestBody: jsonRequest(tagBody()),
      success: {
        messageKey: 'success.ticketTag.updated',
        payload: { tag: ref('TicketTag') },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/tickets/tags/{id}/activate': {
    post: operation({
      tags: 'Ticket Tags',
      summary: 'Activate ticket tag',
      operationId: 'activateTicketTag',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: activate a tag. Authorization: owner or admin roleKey required. Request body accepts no fields.',
      parameters: [dictionaryIdParam],
      requestBody: emptyJsonRequest(),
      success: {
        messageKey: 'success.ticketTag.activated',
        payload: { tag: ref('TicketTag') },
      },
      errors: ['401', '403', '404', '422', '500'],
    }),
  },
  '/tickets/tags/{id}/deactivate': {
    post: operation({
      tags: 'Ticket Tags',
      summary: 'Deactivate ticket tag',
      operationId: 'deactivateTicketTag',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: deactivate a tag when business rules allow it. Authorization: owner or admin roleKey required. Request body accepts no fields.',
      parameters: [dictionaryIdParam],
      requestBody: emptyJsonRequest(),
      success: {
        messageKey: 'success.ticketTag.deactivated',
        payload: { tag: ref('TicketTag') },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/tickets': {
    get: operation({
      tags: 'Tickets',
      summary: 'List tickets',
      operationId: 'listTickets',
      description:
        'Purpose: list tickets in the active workspace. Closed tickets are excluded unless requested. Anti-enumeration: results are workspace-scoped.',
      parameters: ticketListParams,
      success: {
        payload: {
          page: integerSchema({ minimum: 1 }),
          limit: integerSchema({ minimum: 1 }),
          total: integerSchema({ minimum: 0 }),
          results: integerSchema({ minimum: 0 }),
          tickets: arrayOf(ref('Ticket')),
        },
      },
    }),
    post: operation({
      tags: 'Tickets',
      summary: 'Create ticket',
      operationId: 'createTicket',
      security: 'workspaceOwnerAdminAgent',
      description:
        'Purpose: create a protected workspace-scoped ticket. Authorization: owner, admin, or agent roleKey required. mailboxId defaults from workspace.defaultMailboxId when omitted.',
      requestBody: jsonRequest(ticketCreateBody),
      success: {
        messageKey: 'success.ticket.created',
        payload: { ticket: ref('Ticket') },
        example: {
          messageKey: 'success.ticket.created',
          message: 'Ticket created successfully.',
          ticket: {
            _id: '64f1a6f3b7c9a0a1b2c3d4e5',
            workspaceId: '64f1a6f3b7c9a0a1b2c3d4e0',
            number: 1024,
            subject: 'Cannot access billing portal',
            status: 'open',
            priority: 'normal',
            channel: 'manual',
            contactId: '64f1a6f3b7c9a0a1b2c3d4e5',
            messageCount: 1,
          },
        },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/tickets/{id}': {
    get: operation({
      tags: 'Tickets',
      summary: 'Get ticket',
      operationId: 'getTicket',
      description:
        'Purpose: return ticket detail with hydrated references. Anti-enumeration: missing and cross-workspace tickets collapse to not found.',
      parameters: [ticketIdParam],
      success: { payload: { ticket: ref('Ticket') } },
      errors: ['401', '403', '404', '422', '500'],
    }),
    patch: operation({
      tags: 'Tickets',
      summary: 'Update ticket',
      operationId: 'updateTicket',
      security: 'workspaceOwnerAdminAgent',
      description:
        'Purpose: update ticket fields. Authorization: owner, admin, or agent roleKey required. Mailbox can change only while messageCount is 0.',
      parameters: [ticketIdParam],
      requestBody: jsonRequest(ticketUpdateBody),
      success: {
        messageKey: 'success.ticket.updated',
        payload: { ticket: ref('Ticket') },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/tickets/{id}/assign': {
    post: operation({
      tags: 'Ticket Actions',
      summary: 'Assign ticket',
      operationId: 'assignTicket',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: assign a ticket to an active operational member. Authorization: owner or admin roleKey required. Action response is compact.',
      parameters: [ticketIdParam],
      requestBody: jsonRequest(
        objectSchema(
          { assigneeId: idSchema('Assignee user id.') },
          { required: ['assigneeId'], additionalProperties: false }
        )
      ),
      success: {
        messageKey: 'success.ticket.assigned',
        payload: { ticket: ref('TicketAction') },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/tickets/{id}/unassign': {
    post: operation({
      tags: 'Ticket Actions',
      summary: 'Unassign ticket',
      operationId: 'unassignTicket',
      security: 'workspaceOwnerAdminAgent',
      description:
        'Purpose: remove the assignee when allowed. Authorization: owner, admin, or agent roleKey required; agents cannot steal or alter tickets assigned to another user. Action response is compact.',
      parameters: [ticketIdParam],
      requestBody: emptyJsonRequest(),
      success: {
        messageKey: 'success.ticket.unassigned',
        payload: { ticket: ref('TicketAction') },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/tickets/{id}/self-assign': {
    post: operation({
      tags: 'Ticket Actions',
      summary: 'Self-assign ticket',
      operationId: 'selfAssignTicket',
      security: 'workspaceOwnerAdminAgent',
      description:
        'Purpose: assign the ticket to the current user when unassigned or already assigned to them. Authorization: owner, admin, or agent roleKey required. Action response is compact.',
      parameters: [ticketIdParam],
      requestBody: emptyJsonRequest(),
      success: {
        messageKey: 'success.ticket.selfAssigned',
        payload: { ticket: ref('TicketAction') },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/tickets/{id}/status': {
    post: operation({
      tags: 'Ticket Actions',
      summary: 'Update ticket status',
      operationId: 'updateTicketStatus',
      security: 'workspaceOwnerAdminAgent',
      description:
        'Purpose: set ticket status to open, pending, waiting_on_customer, or solved. Authorization: owner, admin, or agent roleKey required. Action response is compact.',
      parameters: [ticketIdParam],
      requestBody: jsonRequest(
        objectSchema(
          {
            status: stringSchema({
              enum: ['open', 'pending', 'waiting_on_customer', 'solved'],
            }),
          },
          { required: ['status'], additionalProperties: false }
        )
      ),
      success: {
        messageKey: 'success.ticket.statusUpdated',
        payload: { ticket: ref('TicketAction') },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/tickets/{id}/solve': {
    post: operation({
      tags: 'Ticket Actions',
      summary: 'Solve ticket',
      operationId: 'solveTicket',
      security: 'workspaceOwnerAdminAgent',
      description:
        'Purpose: mark a ticket solved. Authorization: owner, admin, or agent roleKey required. Action response is compact.',
      parameters: [ticketIdParam],
      requestBody: emptyJsonRequest(),
      success: {
        messageKey: 'success.ticket.solved',
        payload: { ticket: ref('TicketAction') },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/tickets/{id}/close': {
    post: operation({
      tags: 'Ticket Actions',
      summary: 'Close ticket',
      operationId: 'closeTicket',
      security: 'workspaceOwnerAdminAgent',
      description:
        'Purpose: close a ticket. Closed tickets accept internal_note only until explicit reopen. Authorization: owner, admin, or agent roleKey required. Action response is compact.',
      parameters: [ticketIdParam],
      requestBody: emptyJsonRequest(),
      success: {
        messageKey: 'success.ticket.closed',
        payload: { ticket: ref('TicketAction') },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/tickets/{id}/reopen': {
    post: operation({
      tags: 'Ticket Actions',
      summary: 'Reopen ticket',
      operationId: 'reopenTicket',
      security: 'workspaceOwnerAdminAgent',
      description:
        'Purpose: reopen a solved or closed ticket. Authorization: owner, admin, or agent roleKey required. Action response is compact.',
      parameters: [ticketIdParam],
      requestBody: emptyJsonRequest(),
      success: {
        messageKey: 'success.ticket.reopened',
        payload: { ticket: ref('TicketAction') },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/tickets/{id}/conversation': {
    get: operation({
      tags: 'Ticket Messages',
      summary: 'Get ticket conversation',
      operationId: 'getTicketConversation',
      description:
        'Purpose: return the conversation linked to a ticket. Anti-enumeration: missing and cross-workspace tickets collapse to not found.',
      parameters: [ticketIdParam],
      success: { payload: { conversation: ref('TicketConversation') } },
      errors: ['401', '403', '404', '422', '500'],
    }),
  },
  '/tickets/{id}/messages': {
    get: operation({
      tags: 'Ticket Messages',
      summary: 'List ticket messages',
      operationId: 'listTicketMessages',
      description:
        'Purpose: list messages for a ticket conversation. Anti-enumeration: missing and cross-workspace tickets collapse to not found.',
      parameters: [
        ticketIdParam,
        ...paginationParams,
        queryParam(
          'type',
          stringSchema({
            enum: [
              'customer_message',
              'public_reply',
              'internal_note',
              'system_event',
            ],
          })
        ),
        queryParam('sort', stringSchema({ enum: ['createdAt', '-createdAt'] })),
      ],
      success: {
        payload: {
          page: integerSchema({ minimum: 1 }),
          limit: integerSchema({ minimum: 1 }),
          total: integerSchema({ minimum: 0 }),
          results: integerSchema({ minimum: 0 }),
          messages: arrayOf(ref('TicketMessage')),
        },
      },
      errors: ['401', '403', '404', '422', '500'],
    }),
    post: operation({
      tags: 'Ticket Messages',
      summary: 'Create ticket message',
      operationId: 'createTicketMessage',
      security: 'workspaceOwnerAdminAgent',
      description:
        'Purpose: add a manual-first message to a ticket. customer_message sets status open, public_reply sets waiting_on_customer, internal_note does not change status. Authorization: owner, admin, or agent roleKey required.',
      parameters: [ticketIdParam],
      requestBody: jsonRequest(messageBody),
      success: {
        messageKey: 'success.ticket.messageCreated',
        payload: {
          messageRecord: ref('TicketMessage'),
          conversation: ref('TicketConversation'),
          ticketSummary: objectSchema({}, { additionalProperties: true }),
        },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/tickets/{id}/participants': {
    get: operation({
      tags: 'Ticket Participants',
      summary: 'List ticket participants',
      operationId: 'listTicketParticipants',
      description:
        'Purpose: list internal ticket participants. Participants are metadata only and do not grant access.',
      parameters: [ticketIdParam],
      success: { payload: { participants: arrayOf(ref('TicketParticipant')) } },
      errors: ['401', '403', '404', '422', '500'],
    }),
    post: operation({
      tags: 'Ticket Participants',
      summary: 'Save ticket participant',
      operationId: 'saveTicketParticipant',
      security: 'workspaceOwnerAdminAgent',
      description:
        'Purpose: create or update an internal participant as watcher or collaborator. Authorization: owner, admin, or agent roleKey required.',
      parameters: [ticketIdParam],
      requestBody: jsonRequest(
        objectSchema(
          {
            userId: idSchema('Participant user id.'),
            type: stringSchema({ enum: ['watcher', 'collaborator'] }),
          },
          { required: ['userId', 'type'], additionalProperties: false }
        )
      ),
      success: {
        messageKey: 'success.ticket.participantSaved',
        payload: {
          participant: ref('TicketParticipant'),
          ticketSummary: objectSchema({}, { additionalProperties: true }),
        },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/tickets/{id}/participants/{userId}': {
    delete: operation({
      tags: 'Ticket Participants',
      summary: 'Remove ticket participant',
      operationId: 'removeTicketParticipant',
      security: 'workspaceOwnerAdminAgent',
      description:
        'Purpose: remove an internal participant. Authorization: owner, admin, or agent roleKey required. Action response is compact.',
      parameters: [
        ticketIdParam,
        pathIdParam('userId', 'Participant user id.'),
      ],
      success: {
        messageKey: 'success.ticket.participantRemoved',
        payload: {
          ticketSummary: objectSchema({}, { additionalProperties: true }),
        },
      },
      errors: ['401', '403', '404', '422', '500'],
    }),
  },
};
