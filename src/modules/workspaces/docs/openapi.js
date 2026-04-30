import {
  arrayOf,
  idSchema,
  jsonRequest,
  objectSchema,
  operation,
  pathIdParam,
  ref,
  stringSchema,
  queryParam,
  integerSchema,
} from '../../../docs/openapi/helpers.js';

const workspaceIdParam = pathIdParam(
  'workspaceId',
  'Workspace id. Must match the active workspace in the access token.'
);
const inviteIdParam = pathIdParam('inviteId', 'Workspace invite id.');

export const workspacesOpenApiPaths = {
  '/workspaces/mine': {
    get: operation({
      tags: 'Workspaces',
      summary: 'List my workspace memberships',
      operationId: 'listMyWorkspaces',
      security: 'user',
      description:
        'Purpose: list active workspace memberships for the current user with workspace basics, roleKey, and current-workspace flag.',
      success: {
        payload: {
          currentWorkspaceId: {
            ...idSchema('Current workspace id.'),
            nullable: true,
          },
          memberships: arrayOf(ref('WorkspaceMembership')),
        },
      },
      errors: ['401', '403', '500'],
    }),
  },
  '/workspaces/switch': {
    post: operation({
      tags: 'Workspaces',
      summary: 'Switch active workspace',
      operationId: 'switchWorkspace',
      security: 'user',
      description:
        'Purpose: explicitly switch the active workspace for the current session and return a fresh workspace-scoped access token. This is the only endpoint that changes active workspace context.',
      requestBody: jsonRequest(
        objectSchema(
          {
            workspaceId: idSchema('Target workspace id.'),
          },
          { required: ['workspaceId'], additionalProperties: true }
        )
      ),
      success: {
        messageKey: 'success.workspace.switched',
        payload: {
          accessToken: stringSchema(),
          workspace: ref('WorkspaceSummary'),
          roleKey: stringSchema({
            enum: ['owner', 'admin', 'agent', 'viewer'],
          }),
        },
      },
      errors: ['401', '403', '404', '422', '500'],
    }),
  },
  '/workspaces/{workspaceId}/invites': {
    get: operation({
      tags: 'Workspace Invites',
      summary: 'List workspace invites',
      operationId: 'listWorkspaceInvites',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: list invites for the active workspace. Authorization: owner or admin roleKey required. Anti-enumeration: workspaceId must match the active token workspace.',
      parameters: [
        workspaceIdParam,
        queryParam(
          'status',
          stringSchema({ enum: ['pending', 'accepted', 'revoked', 'expired'] })
        ),
        queryParam('page', integerSchema({ minimum: 1 })),
        queryParam('limit', integerSchema({ minimum: 1, maximum: 100 })),
      ],
      success: {
        payload: {
          page: integerSchema({ minimum: 1 }),
          limit: integerSchema({ minimum: 1 }),
          total: integerSchema({ minimum: 0 }),
          results: integerSchema({ minimum: 0 }),
          invites: arrayOf(ref('WorkspaceInvite')),
        },
      },
      errors: ['401', '403', '422', '500'],
    }),
    post: operation({
      tags: 'Workspace Invites',
      summary: 'Create workspace invite',
      operationId: 'createWorkspaceInvite',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: invite a user to the active workspace. Authorization: owner or admin roleKey required. Anti-enumeration: workspaceId must match the active token workspace.',
      parameters: [workspaceIdParam],
      requestBody: jsonRequest(
        objectSchema(
          {
            email: stringSchema({ format: 'email', maxLength: 320 }),
            roleKey: stringSchema({
              enum: ['owner', 'admin', 'agent', 'viewer'],
            }),
          },
          { required: ['email', 'roleKey'], additionalProperties: true }
        )
      ),
      success: {
        messageKey: 'success.invite.created',
        payload: {
          invite: ref('WorkspaceInvite'),
        },
      },
      errors: ['401', '403', '409', '422', '500'],
    }),
  },
  '/workspaces/{workspaceId}/invites/{inviteId}': {
    get: operation({
      tags: 'Workspace Invites',
      summary: 'Get workspace invite',
      operationId: 'getWorkspaceInvite',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: fetch a single invite in the active workspace. Authorization: owner or admin roleKey required. Anti-enumeration: missing or cross-workspace invites return not found or forbidden according to tenant checks.',
      parameters: [workspaceIdParam, inviteIdParam],
      success: {
        payload: {
          invite: ref('WorkspaceInvite'),
        },
      },
      errors: ['401', '403', '404', '422', '500'],
    }),
  },
  '/workspaces/{workspaceId}/invites/{inviteId}/resend': {
    post: operation({
      tags: 'Workspace Invites',
      summary: 'Resend workspace invite',
      operationId: 'resendWorkspaceInvite',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: resend a pending invite. Authorization: owner or admin roleKey required. Request body accepts no fields.',
      parameters: [workspaceIdParam, inviteIdParam],
      success: { messageKey: 'success.invite.resent' },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/workspaces/{workspaceId}/invites/{inviteId}/revoke': {
    post: operation({
      tags: 'Workspace Invites',
      summary: 'Revoke workspace invite',
      operationId: 'revokeWorkspaceInvite',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: revoke a pending invite. Authorization: owner or admin roleKey required. Request body accepts no fields.',
      parameters: [workspaceIdParam, inviteIdParam],
      success: { messageKey: 'success.invite.revoked' },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/workspaces/invites/accept': {
    post: operation({
      tags: 'Workspace Invites',
      summary: 'Accept workspace invite',
      operationId: 'acceptWorkspaceInvite',
      security: 'public',
      description:
        'Purpose: accept an invite token for an email address. This does not auto-switch an existing active workspace session; workspace switching remains explicit through POST /workspaces/switch.',
      requestBody: jsonRequest(
        objectSchema(
          {
            token: stringSchema({ minLength: 16, maxLength: 512 }),
            email: stringSchema({ format: 'email', maxLength: 320 }),
            password: stringSchema({
              minLength: 8,
              maxLength: 128,
              format: 'password',
            }),
            name: stringSchema({ minLength: 1, maxLength: 160 }),
          },
          { required: ['token', 'email'], additionalProperties: true }
        )
      ),
      success: {
        messageKey: 'success.invite.accepted',
        payload: {
          workspaceId: idSchema('Invite workspace id.'),
          roleKey: stringSchema({
            enum: ['owner', 'admin', 'agent', 'viewer'],
          }),
        },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
};
