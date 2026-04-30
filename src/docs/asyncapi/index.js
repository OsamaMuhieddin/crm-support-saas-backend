import { realtimeConfig } from '../../config/realtime.config.js';

const ref = (schemaName) => ({
  $ref: `#/components/schemas/${schemaName}`,
});

const messageRef = (messageName) => ({
  $ref: `#/components/messages/${messageName}`,
});

const stringSchema = ({
  enum: enumValues,
  format,
  pattern,
  description,
  example,
} = {}) => ({
  type: 'string',
  ...(enumValues ? { enum: enumValues } : {}),
  ...(format ? { format } : {}),
  ...(pattern ? { pattern } : {}),
  ...(description ? { description } : {}),
  ...(example !== undefined ? { example } : {}),
});

const integerSchema = ({ minimum, example } = {}) => ({
  type: 'integer',
  ...(minimum !== undefined ? { minimum } : {}),
  ...(example !== undefined ? { example } : {}),
});

const booleanSchema = ({ example } = {}) => ({
  type: 'boolean',
  ...(example !== undefined ? { example } : {}),
});

const nullable = (schema) => ({
  oneOf: [schema, { type: 'null' }],
});

const arrayOf = (items) => ({
  type: 'array',
  items,
});

const objectSchema = (
  properties = {},
  { required = [], additionalProperties = false, description, example } = {}
) => ({
  type: 'object',
  ...(description ? { description } : {}),
  properties,
  ...(required.length > 0 ? { required } : {}),
  additionalProperties,
  ...(example !== undefined ? { example } : {}),
});

const objectIdSchema = (description = 'MongoDB ObjectId') =>
  stringSchema({
    pattern: '^[a-fA-F0-9]{24}$',
    example: '64f1a6f3b7c9a0a1b2c3d4e5',
    description,
  });

const anyObjectSchema = objectSchema({}, { additionalProperties: true });

const message = ({ name, title, summary, payload, examples = [] }) => ({
  name,
  title,
  summary,
  payload,
  ...(examples.length > 0 ? { examples } : {}),
});

const ackExtension = (successCodes) => ({
  success: messageRef('RealtimeAck'),
  error: messageRef('RealtimeErrorAck'),
  successCodes,
});

const clientEvent = ({
  operationId,
  summary,
  description,
  messageName,
  auth,
  rooms = [],
  successCodes = [],
}) => ({
  description,
  subscribe: {
    operationId,
    summary,
    message: messageRef(messageName),
    'x-direction': 'client-to-server',
    'x-auth': auth,
    'x-rooms': rooms,
    'x-ack': ackExtension(successCodes),
  },
});

const serverEvent = ({
  operationId,
  summary,
  description,
  messageName,
  rooms = [],
}) => ({
  description,
  publish: {
    operationId,
    summary,
    message: messageRef(messageName),
    'x-direction': 'server-to-client',
    'x-rooms': rooms,
  },
});

const internalAuth = {
  mode: 'internal_access_token',
  acceptedLocations: [
    'handshake.auth.token',
    'Authorization: Bearer access token',
  ],
  workspaceScoped: true,
  requiresActiveUser: true,
  requiresActiveMember: true,
  allowedRoleKeys: ['owner', 'admin', 'agent', 'viewer'],
};

const widgetAuth = {
  mode: 'widget_session',
  acceptedLocations: [
    'handshake.auth.widgetSessionToken',
    'handshake.auth.token',
  ],
  tokenPrefix: 'wgs_',
  rejectedTokenPrefixes: ['wgr_'],
};

const ticketRooms = ['ticket:{ticketId}', 'workspace:{workspaceId}'];

export const realtimeAsyncApiDocument = {
  asyncapi: '2.6.0',
  info: {
    title: 'CRM Support SaaS Realtime API',
    version: '1.0.0',
    description: [
      'Socket.IO event contract for internal workspace realtime and public widget realtime.',
      '',
      'Internal staff sockets use the same workspace-scoped access token model as protected HTTP routes. Public widget sockets use wgs_* widget session tokens only; recovery tokens are rejected for socket auth.',
      '',
      'REST and MongoDB remain the source of truth. Realtime events are live UI notifications and collaboration state; clients should re-fetch canonical HTTP resources when unsure.',
      '',
      'Reconnect notes: after POST /api/workspaces/switch, logout, logout-all, change-password, or reset-password, affected sockets can be disconnected. Clients should reconnect with the current token and re-subscribe rooms.',
    ].join('\n'),
  },
  servers: {
    default: {
      url: '/',
      protocol: 'socket.io',
      protocolVersion: '4',
      description: `Default Socket.IO namespace "/" using path ${realtimeConfig.path}.`,
      security: [{ internalAccessToken: [] }, { widgetSessionToken: [] }],
      bindings: {
        socketio: {
          path: realtimeConfig.path,
          transports: realtimeConfig.transports,
        },
      },
    },
  },
  channels: {
    'workspace.subscribe': clientEvent({
      operationId: 'receiveWorkspaceSubscribe',
      summary: 'Subscribe to the active workspace room',
      description:
        'Client emits this after internal socket auth to receive workspace-scoped ticket events. Optional workspaceId must match the authenticated token workspace.',
      messageName: 'WorkspaceSubscribeCommand',
      auth: internalAuth,
      rooms: ['workspace:{workspaceId}'],
      successCodes: ['realtime.workspace.subscribed'],
    }),
    'workspace.unsubscribe': clientEvent({
      operationId: 'receiveWorkspaceUnsubscribe',
      summary: 'Unsubscribe from the active workspace room',
      description:
        'Client emits this to leave the active workspace room. Optional workspaceId must match the authenticated token workspace.',
      messageName: 'WorkspaceSubscribeCommand',
      auth: internalAuth,
      rooms: ['workspace:{workspaceId}'],
      successCodes: ['realtime.workspace.unsubscribed'],
    }),
    'ticket.subscribe': clientEvent({
      operationId: 'receiveTicketSubscribe',
      summary: 'Subscribe to a ticket room',
      description:
        'Client emits this to join a readable ticket room. A ticket.presence.snapshot event is sent to the socket after successful subscription.',
      messageName: 'TicketCommand',
      auth: internalAuth,
      rooms: ['ticket:{ticketId}'],
      successCodes: ['realtime.ticket.subscribed'],
    }),
    'ticket.unsubscribe': clientEvent({
      operationId: 'receiveTicketUnsubscribe',
      summary: 'Unsubscribe from a ticket room',
      description:
        'Client emits this to leave a readable ticket room and clear collaboration state for that socket on the ticket.',
      messageName: 'TicketCommand',
      auth: internalAuth,
      rooms: ['ticket:{ticketId}'],
      successCodes: ['realtime.ticket.unsubscribed'],
    }),
    'ticket.presence.set': clientEvent({
      operationId: 'receiveTicketPresenceSet',
      summary: 'Set ticket presence',
      description:
        'Client emits this while viewing or composing on a subscribed ticket. Requires an active ticket subscription.',
      messageName: 'TicketPresenceSetCommand',
      auth: internalAuth,
      rooms: ['ticket:{ticketId}'],
      successCodes: ['realtime.ticket.presence.updated'],
    }),
    'ticket.typing.start': clientEvent({
      operationId: 'receiveTicketTypingStart',
      summary: 'Start ticket typing indicator',
      description:
        'Client emits this while composing a public reply or internal note on a subscribed ticket.',
      messageName: 'TicketTypingStartCommand',
      auth: internalAuth,
      rooms: ['ticket:{ticketId}'],
      successCodes: ['realtime.ticket.typing.started'],
    }),
    'ticket.typing.stop': clientEvent({
      operationId: 'receiveTicketTypingStop',
      summary: 'Stop ticket typing indicator',
      description:
        'Client emits this to clear its typing indicator on a subscribed ticket.',
      messageName: 'TicketCommand',
      auth: internalAuth,
      rooms: ['ticket:{ticketId}'],
      successCodes: ['realtime.ticket.typing.stopped'],
    }),
    'ticket.soft_claim.set': clientEvent({
      operationId: 'receiveTicketSoftClaimSet',
      summary: 'Set ticket soft claim',
      description:
        'Client emits this to indicate temporary intent to work on a subscribed ticket.',
      messageName: 'TicketCommand',
      auth: internalAuth,
      rooms: ['ticket:{ticketId}'],
      successCodes: ['realtime.ticket.softClaim.set'],
    }),
    'ticket.soft_claim.clear': clientEvent({
      operationId: 'receiveTicketSoftClaimClear',
      summary: 'Clear ticket soft claim',
      description:
        'Client emits this to clear its temporary work claim on a subscribed ticket.',
      messageName: 'TicketCommand',
      auth: internalAuth,
      rooms: ['ticket:{ticketId}'],
      successCodes: ['realtime.ticket.softClaim.cleared'],
    }),
    'widget.subscribe': clientEvent({
      operationId: 'receiveWidgetSubscribe',
      summary: 'Subscribe public widget session',
      description:
        'Public widget client emits this after authenticating with a wgs_* widget session token. The server joins only the verified widget-session room and returns a fresh session snapshot in the ack.',
      messageName: 'EmptyCommand',
      auth: widgetAuth,
      rooms: ['widget-session:{widgetSessionId}'],
      successCodes: ['realtime.widget.subscribed'],
    }),
    'widget.unsubscribe': clientEvent({
      operationId: 'receiveWidgetUnsubscribe',
      summary: 'Unsubscribe public widget session',
      description:
        'Public widget client emits this to leave its verified widget-session room.',
      messageName: 'EmptyCommand',
      auth: widgetAuth,
      rooms: ['widget-session:{widgetSessionId}'],
      successCodes: ['realtime.widget.unsubscribed'],
    }),
    'ticket.presence.snapshot': serverEvent({
      operationId: 'publishTicketPresenceSnapshot',
      summary: 'Ticket collaboration snapshot',
      description:
        'Server emits this directly to a socket after ticket.subscribe succeeds.',
      messageName: 'TicketPresenceSnapshotEvent',
      rooms: ['socket:{socketId}'],
    }),
    'ticket.presence.changed': serverEvent({
      operationId: 'publishTicketPresenceChanged',
      summary: 'Ticket presence changed',
      description:
        'Server emits this to a ticket room when presence changes or expires.',
      messageName: 'TicketPresenceChangedEvent',
      rooms: ['ticket:{ticketId}'],
    }),
    'ticket.typing.changed': serverEvent({
      operationId: 'publishTicketTypingChanged',
      summary: 'Ticket typing changed',
      description:
        'Server emits this to a ticket room when typing state changes or expires.',
      messageName: 'TicketTypingChangedEvent',
      rooms: ['ticket:{ticketId}'],
    }),
    'ticket.soft_claim.changed': serverEvent({
      operationId: 'publishTicketSoftClaimChanged',
      summary: 'Ticket soft claim changed',
      description:
        'Server emits this to a ticket room when the temporary soft claim changes or expires.',
      messageName: 'TicketSoftClaimChangedEvent',
      rooms: ['ticket:{ticketId}'],
    }),
    'ticket.created': serverEvent({
      operationId: 'publishTicketCreated',
      summary: 'Ticket created',
      description:
        'Server emits this to the workspace and ticket rooms when a ticket is created.',
      messageName: 'TicketLiveEvent',
      rooms: ticketRooms,
    }),
    'ticket.updated': serverEvent({
      operationId: 'publishTicketUpdated',
      summary: 'Ticket updated',
      description:
        'Server emits this to the workspace and ticket rooms when ticket fields change.',
      messageName: 'TicketLiveEvent',
      rooms: ticketRooms,
    }),
    'ticket.assigned': serverEvent({
      operationId: 'publishTicketAssigned',
      summary: 'Ticket assigned',
      description:
        'Server emits this to the workspace and ticket rooms when assignment is set.',
      messageName: 'TicketAssignmentEvent',
      rooms: ticketRooms,
    }),
    'ticket.unassigned': serverEvent({
      operationId: 'publishTicketUnassigned',
      summary: 'Ticket unassigned',
      description:
        'Server emits this to the workspace and ticket rooms when assignment is cleared.',
      messageName: 'TicketAssignmentEvent',
      rooms: ticketRooms,
    }),
    'ticket.status_changed': serverEvent({
      operationId: 'publishTicketStatusChanged',
      summary: 'Ticket status changed',
      description:
        'Server emits this to the workspace and ticket rooms when status changes.',
      messageName: 'TicketLiveEvent',
      rooms: ticketRooms,
    }),
    'ticket.solved': serverEvent({
      operationId: 'publishTicketSolved',
      summary: 'Ticket solved',
      description:
        'Server emits this to the workspace and ticket rooms when a ticket is solved.',
      messageName: 'TicketLiveEvent',
      rooms: ticketRooms,
    }),
    'ticket.closed': serverEvent({
      operationId: 'publishTicketClosed',
      summary: 'Ticket closed',
      description:
        'Server emits this to the workspace and ticket rooms when a ticket is closed.',
      messageName: 'TicketLiveEvent',
      rooms: ticketRooms,
    }),
    'ticket.reopened': serverEvent({
      operationId: 'publishTicketReopened',
      summary: 'Ticket reopened',
      description:
        'Server emits this to the workspace and ticket rooms when a ticket is reopened.',
      messageName: 'TicketLiveEvent',
      rooms: ticketRooms,
    }),
    'message.created': serverEvent({
      operationId: 'publishMessageCreated',
      summary: 'Ticket message created',
      description:
        'Server emits this to the ticket room when a ticket message is created.',
      messageName: 'MessageCreatedEvent',
      rooms: ['ticket:{ticketId}'],
    }),
    'conversation.updated': serverEvent({
      operationId: 'publishConversationUpdated',
      summary: 'Ticket conversation updated',
      description:
        'Server emits this to the workspace and ticket rooms after conversation summary changes.',
      messageName: 'ConversationUpdatedEvent',
      rooms: ticketRooms,
    }),
    'ticket.participant_changed': serverEvent({
      operationId: 'publishTicketParticipantChanged',
      summary: 'Ticket participant changed',
      description:
        'Server emits this to the workspace and ticket rooms when participant metadata changes.',
      messageName: 'TicketParticipantChangedEvent',
      rooms: ticketRooms,
    }),
    'user.notice': serverEvent({
      operationId: 'publishUserNotice',
      summary: 'User-targeted realtime notice',
      description:
        'Server emits this to a single authenticated user room for assignment and participant notices.',
      messageName: 'UserNoticeEvent',
      rooms: ['user:{userId}'],
    }),
    'widget.message.created': serverEvent({
      operationId: 'publishWidgetMessageCreated',
      summary: 'Public widget message created',
      description:
        'Server emits this to verified public widget-session rooms when a public widget-visible message is created.',
      messageName: 'WidgetMessageCreatedEvent',
      rooms: ['widget-session:{widgetSessionId}'],
    }),
    'widget.conversation.updated': serverEvent({
      operationId: 'publishWidgetConversationUpdated',
      summary: 'Public widget conversation updated',
      description:
        'Server emits this to verified public widget-session rooms when public conversation state changes.',
      messageName: 'WidgetConversationUpdatedEvent',
      rooms: ['widget-session:{widgetSessionId}'],
    }),
  },
  components: {
    securitySchemes: {
      internalAccessToken: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Workspace-scoped access token. Accepted from handshake.auth.token or Authorization bearer header.',
      },
      widgetSessionToken: {
        type: 'apiKey',
        in: 'user',
        name: 'widgetSessionToken',
        description:
          'Public widget session token. Accepted from handshake.auth.widgetSessionToken or handshake.auth.token.',
      },
    },
    messages: {
      RealtimeAck: message({
        name: 'ack',
        title: 'Realtime success acknowledgement',
        summary:
          'Socket ack returned to client callbacks for accepted commands.',
        payload: ref('RealtimeAck'),
      }),
      RealtimeErrorAck: message({
        name: 'ack',
        title: 'Realtime error acknowledgement',
        summary:
          'Socket ack returned to client callbacks for rejected commands.',
        payload: ref('RealtimeErrorAck'),
      }),
      EmptyCommand: message({
        name: 'empty',
        title: 'Empty command payload',
        summary: 'No payload fields are required.',
        payload: ref('EmptyCommandPayload'),
      }),
      WorkspaceSubscribeCommand: message({
        name: 'workspace.subscribe',
        title: 'Workspace subscription command',
        summary: 'Optional workspaceId must match the authenticated workspace.',
        payload: ref('WorkspaceSubscriptionPayload'),
      }),
      TicketCommand: message({
        name: 'ticket.command',
        title: 'Ticket-scoped command',
        summary: 'Ticket id command payload.',
        payload: ref('TicketCommandPayload'),
      }),
      TicketPresenceSetCommand: message({
        name: 'ticket.presence.set',
        title: 'Ticket presence command',
        summary: 'Presence state payload for a subscribed ticket.',
        payload: ref('TicketPresenceSetPayload'),
      }),
      TicketTypingStartCommand: message({
        name: 'ticket.typing.start',
        title: 'Ticket typing start command',
        summary: 'Typing mode payload for a subscribed ticket.',
        payload: ref('TicketTypingStartPayload'),
      }),
      TicketPresenceSnapshotEvent: message({
        name: 'ticket.presence.snapshot',
        title: 'Ticket presence snapshot event',
        summary: 'Snapshot sent directly to a subscribing socket.',
        payload: ref('TicketPresenceSnapshotEnvelope'),
      }),
      TicketPresenceChangedEvent: message({
        name: 'ticket.presence.changed',
        title: 'Ticket presence changed event',
        summary: 'Presence list changed for a ticket.',
        payload: ref('TicketPresenceChangedEnvelope'),
      }),
      TicketTypingChangedEvent: message({
        name: 'ticket.typing.changed',
        title: 'Ticket typing changed event',
        summary: 'Typing list changed for a ticket.',
        payload: ref('TicketTypingChangedEnvelope'),
      }),
      TicketSoftClaimChangedEvent: message({
        name: 'ticket.soft_claim.changed',
        title: 'Ticket soft claim changed event',
        summary: 'Temporary ticket work claim changed.',
        payload: ref('TicketSoftClaimChangedEnvelope'),
      }),
      TicketLiveEvent: message({
        name: 'ticket.live',
        title: 'Ticket live event',
        summary: 'Ticket resource payload for ticket lifecycle events.',
        payload: ref('TicketLiveEnvelope'),
      }),
      TicketAssignmentEvent: message({
        name: 'ticket.assignment',
        title: 'Ticket assignment event',
        summary: 'Ticket assignment payload.',
        payload: ref('TicketAssignmentEnvelope'),
      }),
      MessageCreatedEvent: message({
        name: 'message.created',
        title: 'Message created event',
        summary: 'Ticket message and conversation payload.',
        payload: ref('MessageCreatedEnvelope'),
      }),
      ConversationUpdatedEvent: message({
        name: 'conversation.updated',
        title: 'Conversation updated event',
        summary: 'Ticket conversation summary payload.',
        payload: ref('ConversationUpdatedEnvelope'),
      }),
      TicketParticipantChangedEvent: message({
        name: 'ticket.participant_changed',
        title: 'Ticket participant changed event',
        summary: 'Participant metadata changed payload.',
        payload: ref('TicketParticipantChangedEnvelope'),
      }),
      UserNoticeEvent: message({
        name: 'user.notice',
        title: 'User notice event',
        summary: 'User-targeted notice payload.',
        payload: ref('UserNoticeEnvelope'),
      }),
      WidgetMessageCreatedEvent: message({
        name: 'widget.message.created',
        title: 'Widget message created event',
        summary: 'Public widget message payload.',
        payload: ref('WidgetMessageCreatedEnvelope'),
      }),
      WidgetConversationUpdatedEvent: message({
        name: 'widget.conversation.updated',
        title: 'Widget conversation updated event',
        summary: 'Public widget conversation payload.',
        payload: ref('WidgetConversationUpdatedEnvelope'),
      }),
    },
    schemas: {
      ObjectId: objectIdSchema(),
      EmptyCommandPayload: objectSchema({}, { additionalProperties: false }),
      WorkspaceSubscriptionPayload: objectSchema(
        {
          workspaceId: objectIdSchema(
            'Optional workspace id. Must match the authenticated workspace.'
          ),
        },
        { additionalProperties: false }
      ),
      TicketCommandPayload: objectSchema(
        {
          ticketId: objectIdSchema('Ticket id.'),
        },
        { required: ['ticketId'], additionalProperties: false }
      ),
      TicketPresenceSetPayload: objectSchema(
        {
          ticketId: objectIdSchema('Ticket id.'),
          state: stringSchema({
            enum: ['viewing', 'replying', 'internal_note'],
            example: 'replying',
          }),
        },
        { required: ['ticketId', 'state'], additionalProperties: false }
      ),
      TicketTypingStartPayload: objectSchema(
        {
          ticketId: objectIdSchema('Ticket id.'),
          mode: stringSchema({
            enum: ['public_reply', 'internal_note'],
            example: 'public_reply',
          }),
        },
        { required: ['ticketId', 'mode'], additionalProperties: false }
      ),
      RealtimeAck: objectSchema(
        {
          ok: booleanSchema({ example: true }),
          code: stringSchema({ example: 'realtime.ticket.subscribed' }),
          messageKey: stringSchema({ example: 'success.ok' }),
          data: nullable(anyObjectSchema),
        },
        {
          required: ['ok', 'code', 'messageKey', 'data'],
          additionalProperties: false,
        }
      ),
      RealtimeErrorAck: objectSchema(
        {
          ok: booleanSchema({ example: false }),
          code: stringSchema({ example: 'errors.validation.invalidId' }),
          messageKey: stringSchema({ example: 'errors.validation.invalidId' }),
          data: nullable(anyObjectSchema),
        },
        {
          required: ['ok', 'code', 'messageKey', 'data'],
          additionalProperties: false,
        }
      ),
      RealtimeEnvelopeBase: objectSchema(
        {
          event: stringSchema({ example: 'ticket.updated' }),
          eventId: stringSchema({ format: 'uuid' }),
          occurredAt: stringSchema({ format: 'date-time' }),
          workspaceId: nullable(objectIdSchema('Workspace id.')),
          actorUserId: nullable(objectIdSchema('Actor user id.')),
        },
        {
          required: [
            'event',
            'eventId',
            'occurredAt',
            'workspaceId',
            'actorUserId',
          ],
          additionalProperties: true,
        }
      ),
      RealtimeUser: objectSchema({}, { additionalProperties: true }),
      CollaborationPresenceEntry: objectSchema(
        {
          userId: objectIdSchema('User id.'),
          state: stringSchema({
            enum: ['viewing', 'replying', 'internal_note'],
          }),
          updatedAt: stringSchema({ format: 'date-time' }),
          user: ref('RealtimeUser'),
        },
        { additionalProperties: true }
      ),
      CollaborationTypingEntry: objectSchema(
        {
          userId: objectIdSchema('User id.'),
          mode: stringSchema({ enum: ['public_reply', 'internal_note'] }),
          updatedAt: stringSchema({ format: 'date-time' }),
          user: ref('RealtimeUser'),
        },
        { additionalProperties: true }
      ),
      CollaborationSoftClaim: nullable(
        objectSchema(
          {
            userId: objectIdSchema('User id.'),
            claimedAt: stringSchema({ format: 'date-time' }),
            updatedAt: stringSchema({ format: 'date-time' }),
            user: ref('RealtimeUser'),
          },
          { additionalProperties: true }
        )
      ),
      TicketPresenceSnapshotData: objectSchema(
        {
          ticketId: objectIdSchema('Ticket id.'),
          presence: arrayOf(ref('CollaborationPresenceEntry')),
          typing: arrayOf(ref('CollaborationTypingEntry')),
          softClaim: ref('CollaborationSoftClaim'),
        },
        { required: ['ticketId', 'presence', 'typing', 'softClaim'] }
      ),
      TicketPresenceChangedData: objectSchema(
        {
          ticketId: objectIdSchema('Ticket id.'),
          presence: arrayOf(ref('CollaborationPresenceEntry')),
        },
        { required: ['ticketId', 'presence'] }
      ),
      TicketTypingChangedData: objectSchema(
        {
          ticketId: objectIdSchema('Ticket id.'),
          typing: arrayOf(ref('CollaborationTypingEntry')),
        },
        { required: ['ticketId', 'typing'] }
      ),
      TicketSoftClaimChangedData: objectSchema(
        {
          ticketId: objectIdSchema('Ticket id.'),
          softClaim: ref('CollaborationSoftClaim'),
        },
        { required: ['ticketId', 'softClaim'] }
      ),
      TicketLiveData: objectSchema(
        {
          ticket: anyObjectSchema,
        },
        { required: ['ticket'], additionalProperties: true }
      ),
      TicketAssignmentData: objectSchema(
        {
          ticket: anyObjectSchema,
          assignee: nullable(anyObjectSchema),
          previousAssigneeId: nullable(objectIdSchema('Previous assignee id.')),
          previousAssignee: nullable(anyObjectSchema),
          assignmentMode: stringSchema({ example: 'assign' }),
        },
        { required: ['ticket'], additionalProperties: true }
      ),
      MessageCreatedData: objectSchema(
        {
          ticket: anyObjectSchema,
          conversation: anyObjectSchema,
          message: anyObjectSchema,
        },
        { required: ['ticket', 'conversation', 'message'] }
      ),
      ConversationUpdatedData: objectSchema(
        {
          ticket: anyObjectSchema,
          conversation: anyObjectSchema,
        },
        { required: ['ticket', 'conversation'] }
      ),
      TicketParticipantChangedData: objectSchema(
        {
          action: stringSchema({ example: 'saved' }),
          ticket: anyObjectSchema,
          participant: nullable(anyObjectSchema),
          affectedUserId: nullable(objectIdSchema('Affected user id.')),
        },
        { required: ['action', 'ticket'], additionalProperties: true }
      ),
      UserNoticeData: objectSchema(
        {
          noticeType: stringSchema({ example: 'ticket_assigned' }),
          ticket: anyObjectSchema,
        },
        { required: ['noticeType', 'ticket'], additionalProperties: true }
      ),
      WidgetMessageCreatedData: objectSchema(
        {
          message: anyObjectSchema,
          conversation: anyObjectSchema,
        },
        { required: ['message', 'conversation'] }
      ),
      WidgetConversationUpdatedData: objectSchema(
        {
          conversation: anyObjectSchema,
        },
        { required: ['conversation'] }
      ),
      TicketPresenceSnapshotEnvelope: {
        allOf: [
          ref('RealtimeEnvelopeBase'),
          objectSchema({
            event: stringSchema({ enum: ['ticket.presence.snapshot'] }),
            data: ref('TicketPresenceSnapshotData'),
          }),
        ],
      },
      TicketPresenceChangedEnvelope: {
        allOf: [
          ref('RealtimeEnvelopeBase'),
          objectSchema({
            event: stringSchema({ enum: ['ticket.presence.changed'] }),
            data: ref('TicketPresenceChangedData'),
          }),
        ],
      },
      TicketTypingChangedEnvelope: {
        allOf: [
          ref('RealtimeEnvelopeBase'),
          objectSchema({
            event: stringSchema({ enum: ['ticket.typing.changed'] }),
            data: ref('TicketTypingChangedData'),
          }),
        ],
      },
      TicketSoftClaimChangedEnvelope: {
        allOf: [
          ref('RealtimeEnvelopeBase'),
          objectSchema({
            event: stringSchema({ enum: ['ticket.soft_claim.changed'] }),
            data: ref('TicketSoftClaimChangedData'),
          }),
        ],
      },
      TicketLiveEnvelope: {
        allOf: [
          ref('RealtimeEnvelopeBase'),
          objectSchema({
            event: stringSchema({
              enum: [
                'ticket.created',
                'ticket.updated',
                'ticket.status_changed',
                'ticket.solved',
                'ticket.closed',
                'ticket.reopened',
              ],
            }),
            data: ref('TicketLiveData'),
          }),
        ],
      },
      TicketAssignmentEnvelope: {
        allOf: [
          ref('RealtimeEnvelopeBase'),
          objectSchema({
            event: stringSchema({
              enum: ['ticket.assigned', 'ticket.unassigned'],
            }),
            data: ref('TicketAssignmentData'),
          }),
        ],
      },
      MessageCreatedEnvelope: {
        allOf: [
          ref('RealtimeEnvelopeBase'),
          objectSchema({
            event: stringSchema({ enum: ['message.created'] }),
            data: ref('MessageCreatedData'),
          }),
        ],
      },
      ConversationUpdatedEnvelope: {
        allOf: [
          ref('RealtimeEnvelopeBase'),
          objectSchema({
            event: stringSchema({ enum: ['conversation.updated'] }),
            data: ref('ConversationUpdatedData'),
          }),
        ],
      },
      TicketParticipantChangedEnvelope: {
        allOf: [
          ref('RealtimeEnvelopeBase'),
          objectSchema({
            event: stringSchema({ enum: ['ticket.participant_changed'] }),
            data: ref('TicketParticipantChangedData'),
          }),
        ],
      },
      UserNoticeEnvelope: {
        allOf: [
          ref('RealtimeEnvelopeBase'),
          objectSchema({
            event: stringSchema({ enum: ['user.notice'] }),
            data: ref('UserNoticeData'),
          }),
        ],
      },
      WidgetMessageCreatedEnvelope: {
        allOf: [
          ref('RealtimeEnvelopeBase'),
          objectSchema({
            event: stringSchema({ enum: ['widget.message.created'] }),
            data: ref('WidgetMessageCreatedData'),
          }),
        ],
      },
      WidgetConversationUpdatedEnvelope: {
        allOf: [
          ref('RealtimeEnvelopeBase'),
          objectSchema({
            event: stringSchema({ enum: ['widget.conversation.updated'] }),
            data: ref('WidgetConversationUpdatedData'),
          }),
        ],
      },
      RealtimeRuntime: objectSchema(
        {
          enabled: booleanSchema(),
          socketPath: stringSchema({ example: realtimeConfig.path }),
          transports: arrayOf(stringSchema()),
          namespace: stringSchema({ example: '/' }),
          reconnect: stringSchema({
            example:
              'Reconnect with the current token and resubscribe rooms after workspace switch or session revocation.',
          }),
        },
        { additionalProperties: false }
      ),
    },
  },
  'x-runtime': {
    enabled: realtimeConfig.enabled,
    socketPath: realtimeConfig.path,
    transports: realtimeConfig.transports,
    namespace: '/',
    features: realtimeConfig.features,
    collaboration: {
      requiresTicketSubscription:
        realtimeConfig.collaboration.requiresTicketSubscription,
      presenceTtlMs: realtimeConfig.collaboration.presenceTtlMs,
      typingTtlMs: realtimeConfig.collaboration.typingTtlMs,
      softClaimTtlMs: realtimeConfig.collaboration.softClaimTtlMs,
      actionThrottleMs: realtimeConfig.collaboration.actionThrottleMs,
    },
  },
};

export const buildRealtimeAsyncApiHtml = () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CRM Support SaaS Realtime Docs</title>
    <style>
      :root {
        --bg: #f6f7f9;
        --panel: #ffffff;
        --text: #172026;
        --muted: #5d6875;
        --line: #d9e0e7;
        --soft: #eef3f7;
        --accent: #0f6f8f;
        --ok: #237a57;
        --warn: #9a5a00;
      }
      body {
        margin: 0;
        font-family: Arial, sans-serif;
        color: var(--text);
        background: var(--bg);
      }
      main {
        max-width: 1220px;
        margin: 0 auto;
        padding: 28px 20px 48px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 28px;
      }
      h2 {
        margin: 28px 0 8px;
        font-size: 18px;
      }
      h3 {
        margin: 0;
        font-size: 16px;
      }
      p {
        line-height: 1.45;
      }
      a {
        color: var(--accent);
      }
      .meta,
      .concept,
      .channel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 16px;
        margin-top: 12px;
      }
      .toolbar {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 18px;
      }
      .search {
        border: 1px solid var(--line);
        border-radius: 6px;
        flex: 1 1 320px;
        font-size: 14px;
        padding: 10px 12px;
      }
      .filter {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 6px;
        color: var(--text);
        cursor: pointer;
        font-size: 14px;
        padding: 9px 12px;
      }
      .filter.active {
        border-color: var(--accent);
        color: var(--accent);
        font-weight: 700;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
        gap: 12px;
      }
      .concept-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 12px;
      }
      code,
      .chip {
        background: var(--soft);
        border-radius: 4px;
        padding: 2px 5px;
      }
      .channel-header {
        align-items: flex-start;
        display: flex;
        gap: 10px;
        justify-content: space-between;
      }
      .event-name {
        font-size: 15px;
        font-weight: 700;
      }
      .badge {
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        padding: 4px 8px;
        white-space: nowrap;
      }
      .badge.client {
        background: #e8f4f7;
        color: var(--accent);
      }
      .badge.server {
        background: #eaf5ef;
        color: var(--ok);
      }
      .summary {
        color: var(--muted);
        margin: 8px 0 0;
      }
      .details {
        border-top: 1px solid var(--line);
        display: grid;
        gap: 10px;
        margin-top: 14px;
        padding-top: 12px;
      }
      .detail-row {
        display: grid;
        gap: 6px;
      }
      .detail-label {
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
      }
      .chip-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      details {
        border-top: 1px solid var(--line);
        margin-top: 12px;
        padding-top: 12px;
      }
      summary {
        cursor: pointer;
        font-weight: 700;
      }
      pre {
        background: #172026;
        border-radius: 6px;
        color: #f8fafc;
        font-size: 12px;
        line-height: 1.45;
        max-height: 320px;
        overflow: auto;
        padding: 12px;
        white-space: pre-wrap;
      }
      .hidden {
        display: none;
      }
      .count {
        color: var(--muted);
        font-size: 13px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>CRM Support SaaS Realtime API</h1>
      <p>
        Socket.IO event contract for internal workspace clients and public widget clients.
        <a href="./realtime.json">Raw AsyncAPI JSON</a>
      </p>
      <section class="meta" id="runtime">Loading realtime contract...</section>
      <section class="concept-grid" id="concepts"></section>
      <div class="toolbar">
        <input class="search" id="search" placeholder="Search events, rooms, auth, ack codes..." />
        <button class="filter active" data-filter="all" type="button">All</button>
        <button class="filter" data-filter="client-to-server" type="button">Client events</button>
        <button class="filter" data-filter="server-to-client" type="button">Server events</button>
        <span class="count" id="count"></span>
      </div>
      <h2>Events</h2>
      <section class="grid" id="events"></section>
    </main>
    <script>
      const state = {
        filter: 'all',
        query: '',
        events: []
      };

      const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

      const schemaName = (ref) => String(ref || '').split('/').pop() || 'inline';

      const renderChips = (items) => {
        const values = (items || []).filter(Boolean);
        if (!values.length) return '<span class="chip">none</span>';
        return values.map((item) => '<span class="chip">' + escapeHtml(item) + '</span>').join('');
      };

      const messageForOperation = (doc, operation) => {
        const ref = operation.message && operation.message.$ref;
        return ref ? doc.components.messages[schemaName(ref)] : null;
      };

      const payloadSchemaForMessage = (doc, message) => {
        const ref = message && message.payload && message.payload.$ref;
        return ref ? doc.components.schemas[schemaName(ref)] : message && message.payload;
      };

      const renderAuth = (auth) => {
        if (!auth) return 'No auth metadata.';
        const parts = ['Mode: <code>' + escapeHtml(auth.mode || 'n/a') + '</code>'];
        if (auth.workspaceScoped) parts.push('Workspace scoped');
        if (auth.requiresActiveUser) parts.push('Active user required');
        if (auth.requiresActiveMember) parts.push('Active member required');
        if (auth.tokenPrefix) parts.push('Token prefix: <code>' + escapeHtml(auth.tokenPrefix) + '</code>');
        if (auth.allowedRoleKeys) parts.push('Roles: ' + renderChips(auth.allowedRoleKeys));
        if (auth.acceptedLocations) parts.push('Credentials: ' + renderChips(auth.acceptedLocations));
        if (auth.rejectedTokenPrefixes) parts.push('Rejected prefixes: ' + renderChips(auth.rejectedTokenPrefixes));
        return parts.join('<br />');
      };

      const renderAck = (operation) => {
        const ack = operation['x-ack'];
        if (!ack) return 'No Socket.IO ack for server-published events.';
        return [
          'Success ack: <code>' + escapeHtml(schemaName(ack.success && ack.success.$ref)) + '</code>',
          'Error ack: <code>' + escapeHtml(schemaName(ack.error && ack.error.$ref)) + '</code>',
          'Success codes: ' + renderChips(ack.successCodes || [])
        ].join('<br />');
      };

      const renderEvent = (doc, [name, channel]) => {
        const operation = channel.subscribe || channel.publish || {};
        const direction = operation['x-direction'] || (channel.subscribe ? 'client-to-server' : 'server-to-client');
        const rooms = operation['x-rooms'] || [];
        const message = messageForOperation(doc, operation);
        const payloadSchema = payloadSchemaForMessage(doc, message);
        const payloadName = schemaName(message && message.payload && message.payload.$ref);
        const search = [
          name,
          direction,
          operation.summary,
          channel.description,
          JSON.stringify(operation['x-auth'] || {}),
          JSON.stringify(operation['x-ack'] || {}),
          rooms.join(' '),
          payloadName
        ].join(' ').toLowerCase();

        return {
          direction,
          search,
          html: [
            '<article class="channel" data-direction="' + escapeHtml(direction) + '" data-search="' + escapeHtml(search) + '">',
            '<div class="channel-header">',
            '<div><div class="event-name"><code>' + escapeHtml(name) + '</code></div><p class="summary">' + escapeHtml(operation.summary || channel.description || '') + '</p></div>',
            '<span class="badge ' + (direction === 'client-to-server' ? 'client' : 'server') + '">' + escapeHtml(direction) + '</span>',
            '</div>',
            '<div class="details">',
            '<div class="detail-row"><div class="detail-label">Purpose</div><div>' + escapeHtml(channel.description || operation.summary || '') + '</div></div>',
            '<div class="detail-row"><div class="detail-label">Rooms</div><div class="chip-list">' + renderChips(rooms.length ? rooms : ['direct socket']) + '</div></div>',
            '<div class="detail-row"><div class="detail-label">Auth</div><div>' + renderAuth(operation['x-auth']) + '</div></div>',
            '<div class="detail-row"><div class="detail-label">Acknowledgements</div><div>' + renderAck(operation) + '</div></div>',
            '<div class="detail-row"><div class="detail-label">Message / payload</div><div><code>' + escapeHtml(message ? message.name : name) + '</code> payload <code>' + escapeHtml(payloadName) + '</code></div></div>',
            '</div>',
            '<details><summary>Payload schema</summary><pre>' + escapeHtml(JSON.stringify(payloadSchema || {}, null, 2)) + '</pre></details>',
            '</article>'
          ].join('')
        };
      };

      const renderConcepts = (doc) => {
        const runtime = doc['x-runtime'] || {};
        document.getElementById('concepts').innerHTML = [
          '<article class="concept"><h3>Auth</h3><p>Internal sockets use bearer access tokens. Public widget sockets use <code>wgs_*</code> widget session tokens.</p></article>',
          '<article class="concept"><h3>Acknowledgements</h3><p>Client events return callback acks with <code>ok</code>, <code>code</code>, <code>messageKey</code>, and <code>data</code>. Rejected commands use the realtime error ack shape.</p></article>',
          '<article class="concept"><h3>Rooms</h3><p>Room names are shown per event. Workspace, ticket, user, session, and widget-session rooms are server-controlled.</p></article>',
          '<article class="concept"><h3>Reconnect</h3><p>After workspace switch or session revocation, reconnect with the current token and resubscribe rooms.</p></article>',
          '<article class="concept"><h3>Collaboration TTLs</h3><p>Presence: <code>' + escapeHtml(runtime.collaboration?.presenceTtlMs) + 'ms</code><br />Typing: <code>' + escapeHtml(runtime.collaboration?.typingTtlMs) + 'ms</code><br />Soft claim: <code>' + escapeHtml(runtime.collaboration?.softClaimTtlMs) + 'ms</code></p></article>'
        ].join('');
      };

      const applyFilters = () => {
        const cards = Array.from(document.querySelectorAll('.channel'));
        let visible = 0;
        for (const card of cards) {
          const matchesFilter = state.filter === 'all' || card.dataset.direction === state.filter;
          const matchesSearch = !state.query || card.dataset.search.includes(state.query);
          const show = matchesFilter && matchesSearch;
          card.classList.toggle('hidden', !show);
          if (show) visible += 1;
        }
        document.getElementById('count').textContent = visible + ' of ' + cards.length + ' events';
      };

      fetch('./realtime.json')
        .then((response) => response.json())
        .then((doc) => {
          const runtime = doc['x-runtime'] || {};
          document.getElementById('runtime').innerHTML =
            '<h3>Runtime</h3>' +
            '<div>Socket.IO path: <code>' + escapeHtml(runtime.socketPath) + '</code></div>' +
            '<div>Namespace: <code>/</code></div>' +
            '<div>Transports: ' + renderChips(runtime.transports || []) + '</div>';
          renderConcepts(doc);
          const entries = Object.entries(doc.channels || {});
          state.events = entries.map((entry) => renderEvent(doc, entry));
          document.getElementById('events').innerHTML = state.events.map((event) => event.html).join('');
          applyFilters();

          document.getElementById('search').addEventListener('input', (event) => {
            state.query = event.target.value.trim().toLowerCase();
            applyFilters();
          });

          for (const button of document.querySelectorAll('.filter')) {
            button.addEventListener('click', () => {
              state.filter = button.dataset.filter;
              for (const other of document.querySelectorAll('.filter')) {
                other.classList.toggle('active', other === button);
              }
              applyFilters();
            });
          }
        });
    </script>
  </body>
</html>`;
