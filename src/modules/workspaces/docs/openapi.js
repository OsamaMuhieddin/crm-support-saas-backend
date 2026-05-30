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
  booleanSchema,
} from '../../../docs/openapi/helpers.js';

const workspaceIdParam = pathIdParam(
  'workspaceId',
  'Workspace id. Must match the active workspace in the access token.'
);
const inviteIdParam = pathIdParam('inviteId', 'Workspace invite id.');
const userIdParam = pathIdParam('userId', 'Workspace member user id.');
const memberFilters = [
  queryParam('q', stringSchema({ minLength: 1, maxLength: 120 })),
  queryParam('search', stringSchema({ minLength: 1, maxLength: 120 })),
  queryParam(
    'roleKey',
    stringSchema({ enum: ['owner', 'admin', 'agent', 'viewer'] })
  ),
  queryParam(
    'status',
    stringSchema({ enum: ['active', 'suspended', 'removed'] })
  ),
  queryParam('assignable', booleanSchema()),
  queryParam('participantEligible', booleanSchema()),
  queryParam('includeRemoved', booleanSchema()),
  queryParam(
    'sort',
    stringSchema({
      enum: [
        'name',
        '-name',
        'email',
        '-email',
        'createdAt',
        '-createdAt',
        'joinedAt',
        '-joinedAt',
      ],
    })
  ),
];

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
        'Purpose: invite a user to the active workspace. Authorization: owner or admin roleKey required. Owners may invite owner/admin/agent/viewer; admins may invite agent/viewer only. Active and suspended members block duplicate invites. Removed members may be restored by re-invite, and acceptance reuses the existing membership record. Anti-enumeration: workspaceId must match the active token workspace.',
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
  '/workspaces/{workspaceId}/members': {
    get: operation({
      tags: 'Workspace Members',
      summary: 'List workspace members',
      operationId: 'listWorkspaceMembers',
      security: 'tenant',
      description:
        'Purpose: list and search workspace members for member pages, assignment pickers, participant pickers, invite duplicate warnings, and autocomplete. Anti-enumeration: workspaceId must match the active token workspace. Visibility: owner/admin may request active, suspended, or removed members and see email; agent receives active members only and sees email; viewer receives active members only with minimal profile data and no email. Viewer email sorts fall back to safe name ordering without email tie-breaks. participantEligible=true returns active users eligible for at least one participant type; viewers are watcher-only and collaborators require owner/admin/agent.',
      parameters: [
        workspaceIdParam,
        queryParam('page', integerSchema({ minimum: 1 })),
        queryParam('limit', integerSchema({ minimum: 1, maximum: 100 })),
        ...memberFilters,
      ],
      success: {
        payload: {
          page: integerSchema({ minimum: 1 }),
          limit: integerSchema({ minimum: 1, maximum: 100 }),
          total: integerSchema({ minimum: 0 }),
          results: integerSchema({ minimum: 0 }),
          members: arrayOf(ref('WorkspaceMemberSummary')),
        },
      },
      errors: ['401', '403', '422', '500'],
    }),
  },
  '/workspaces/{workspaceId}/members/options': {
    get: operation({
      tags: 'Workspace Members',
      summary: 'List workspace member options',
      operationId: 'listWorkspaceMemberOptions',
      security: 'tenant',
      description:
        'Purpose: return compact workspace member summaries for dropdowns and autocomplete. Supports q/search aliases plus role, status, assignable, participantEligible, includeRemoved, limit, and sort filters. Anti-enumeration and email visibility match the full member list endpoint; viewer email sorts fall back to safe name ordering without email tie-breaks. participantEligible=true means eligible for at least one participant type; frontend participant-type controls must keep viewers as watcher-only.',
      parameters: [
        workspaceIdParam,
        queryParam('limit', integerSchema({ minimum: 1, maximum: 50 })),
        ...memberFilters,
      ],
      success: {
        payload: {
          results: integerSchema({ minimum: 0 }),
          members: arrayOf(ref('WorkspaceMemberOption')),
        },
      },
      errors: ['401', '403', '422', '500'],
    }),
  },
  '/workspaces/{workspaceId}/members/{userId}': {
    get: operation({
      tags: 'Workspace Members',
      summary: 'Get workspace member',
      operationId: 'getWorkspaceMember',
      security: 'tenant',
      description:
        'Purpose: resolve one workspace member by user id for drawer/detail screens. Anti-enumeration: workspaceId must match the active token workspace; agent/viewer access to suspended or removed members collapses to not found. Viewer responses omit email.',
      parameters: [workspaceIdParam, userIdParam],
      success: {
        payload: {
          member: ref('WorkspaceMemberSummary'),
        },
      },
      errors: ['401', '403', '404', '422', '500'],
    }),
    patch: operation({
      tags: 'Workspace Members',
      summary: 'Change workspace member role',
      operationId: 'updateWorkspaceMemberRole',
      security: 'tenant',
      description:
        'Purpose: change a workspace member role. Authorization: owner can manage any other member when last-owner safety is preserved; admin can manage only agent/viewer members and can assign only agent/viewer roles. Self role changes are blocked. Successful role changes revoke the affected user sessions for this workspace and disconnect realtime sockets best-effort. Existing ticket assignments are preserved; if a former agent becomes ineligible, owner/admin users must explicitly unassign and assign a replacement.',
      parameters: [workspaceIdParam, userIdParam],
      requestBody: jsonRequest(ref('WorkspaceMemberRoleChangeRequest')),
      success: {
        messageKey: 'success.workspace.memberUpdated',
        payload: {
          member: ref('WorkspaceMemberAction'),
        },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/workspaces/{workspaceId}/members/{userId}/suspend': {
    post: operation({
      tags: 'Workspace Members',
      summary: 'Suspend workspace member',
      operationId: 'suspendWorkspaceMember',
      security: 'tenant',
      description:
        'Purpose: suspend an active workspace member while preserving historical attribution. Owner can suspend any other role when at least one active owner remains; admin can suspend only agent/viewer members. Suspended members are excluded from assignable and participantEligible filters. Existing ticket assignments are not cleared. Successful suspension revokes the affected user sessions for this workspace and disconnects realtime sockets best-effort.',
      parameters: [workspaceIdParam, userIdParam],
      success: {
        messageKey: 'success.workspace.memberSuspended',
        payload: {
          member: ref('WorkspaceMemberAction'),
        },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/workspaces/{workspaceId}/members/{userId}/activate': {
    post: operation({
      tags: 'Workspace Members',
      summary: 'Activate suspended workspace member',
      operationId: 'activateWorkspaceMember',
      security: 'tenant',
      description:
        'Purpose: reactivate a suspended workspace member. Removed members cannot be activated directly and must be restored through invite flow. Reactivation checks billing seat capacity with the existing workspace member activation guard. Owner can reactivate any other suspended member; admin can reactivate only suspended agent/viewer members. Successful activation revokes the affected user sessions for this workspace and disconnects realtime sockets best-effort.',
      parameters: [workspaceIdParam, userIdParam],
      success: {
        messageKey: 'success.workspace.memberActivated',
        payload: {
          member: ref('WorkspaceMemberAction'),
        },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/workspaces/{workspaceId}/members/{userId}/remove': {
    post: operation({
      tags: 'Workspace Members',
      summary: 'Remove workspace member',
      operationId: 'removeWorkspaceMember',
      security: 'tenant',
      description:
        'Purpose: soft-remove a workspace member while preserving user, ticket, message, file, report, and audit attribution. Owner can remove any other role when at least one active owner remains; admin can remove only agent/viewer members. Removed members are excluded from active, assignable, and participantEligible views; owner/admin can still request removed members. Successful removal revokes the affected user sessions for this workspace and disconnects realtime sockets best-effort.',
      parameters: [workspaceIdParam, userIdParam],
      success: {
        messageKey: 'success.workspace.memberRemoved',
        payload: {
          member: ref('WorkspaceMemberAction'),
        },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
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
        'Purpose: accept an invite token for an email address. Removed-member acceptance reuses the existing membership record, applies the invited roleKey, and restores active membership. Stale removed-member invites fail with alreadyMember if the membership is already active again, without overwriting the current role. This does not auto-switch an existing active workspace session; workspace switching remains explicit through POST /workspaces/switch.',
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
