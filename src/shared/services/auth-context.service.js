import jwt from 'jsonwebtoken';
import { authConfig } from '../../config/auth.config.js';
import { MEMBER_STATUS } from '../../constants/member-status.js';
import { WORKSPACE_STATUS } from '../../constants/workspace-status.js';
import { Session } from '../../modules/users/models/session.model.js';
import { User } from '../../modules/users/models/user.model.js';
import { WorkspaceMember } from '../../modules/workspaces/models/workspace-member.model.js';
import { Workspace } from '../../modules/workspaces/models/workspace.model.js';
import { createError } from '../errors/createError.js';

const bearerPrefix = 'Bearer ';

export const parseBearerToken = (authHeader) => {
  if (typeof authHeader !== 'string') {
    return null;
  }

  if (!authHeader.startsWith(bearerPrefix)) {
    return null;
  }

  const token = authHeader.slice(bearerPrefix.length).trim();
  return token.length > 0 ? token : null;
};

export const verifyAccessToken = (token) =>
  jwt.verify(token, authConfig.jwt.accessSecret, {
    issuer: authConfig.jwt.issuer,
    audience: authConfig.jwt.audience,
  });

export const assertAccessTokenPayload = (payload) => {
  if (
    !payload ||
    payload.typ !== 'access' ||
    payload.ver !== 1 ||
    !payload.sub ||
    !payload.sid ||
    !payload.wid ||
    !payload.r
  ) {
    throw createError('errors.auth.invalidToken', 401);
  }

  return payload;
};

export const resolveAccessAuthContext = async (token) => {
  if (!token || typeof token !== 'string') {
    throw createError('errors.auth.invalidToken', 401);
  }

  let payload = null;

  try {
    payload = verifyAccessToken(token);
  } catch (error) {
    throw createError('errors.auth.invalidToken', 401);
  }

  assertAccessTokenPayload(payload);

  const session = await Session.findById(payload.sid)
    .select('_id userId workspaceId revokedAt expiresAt')
    .lean();

  const isSessionInvalid =
    !session ||
    String(session.userId) !== String(payload.sub) ||
    !session.workspaceId ||
    String(session.workspaceId) !== String(payload.wid) ||
    session.revokedAt ||
    new Date(session.expiresAt).getTime() <= Date.now();

  if (isSessionInvalid) {
    throw createError('errors.auth.sessionRevoked', 401);
  }

  return {
    payload,
    session,
    auth: {
      userId: String(payload.sub),
      sessionId: String(payload.sid),
      workspaceId: String(payload.wid),
      roleKey: String(payload.r),
    },
  };
};

export const resolveAccessAuthContextFromHeader = async (
  authorizationHeader
) => {
  const token = parseBearerToken(authorizationHeader);

  if (!token) {
    throw createError('errors.auth.invalidToken', 401);
  }

  return resolveAccessAuthContext(token);
};

export const loadActiveUserContext = async ({ userId }) => {
  if (!userId) {
    throw createError('errors.auth.invalidToken', 401);
  }

  const user = await User.findOne({
    _id: userId,
    deletedAt: null,
  })
    .select('_id status')
    .lean();

  if (!user) {
    throw createError('errors.auth.invalidToken', 401);
  }

  if (user.status !== 'active') {
    throw createError('errors.auth.userSuspended', 403);
  }

  return user;
};

export const loadActiveMemberContext = async ({ workspaceId, userId }) => {
  if (!workspaceId || !userId) {
    throw createError('errors.auth.invalidToken', 401);
  }

  const member = await WorkspaceMember.findOne({
    workspaceId,
    userId,
    status: MEMBER_STATUS.ACTIVE,
    deletedAt: null,
  })
    .select('_id workspaceId userId roleKey status')
    .lean();

  if (!member) {
    throw createError('errors.auth.forbiddenTenant', 403);
  }

  const workspace = await Workspace.findOne({
    _id: workspaceId,
    deletedAt: null,
  })
    .select('_id status')
    .lean();

  if (!workspace) {
    throw createError('errors.workspace.notFound', 404);
  }

  if (workspace.status === WORKSPACE_STATUS.SUSPENDED) {
    throw createError('errors.workspace.suspended', 403);
  }

  return {
    _id: String(member._id),
    workspaceId: String(member.workspaceId),
    userId: String(member.userId),
    roleKey: member.roleKey,
    status: member.status,
  };
};

export const resolveActiveAccessContext = async (token) => {
  const { auth, payload, session } = await resolveAccessAuthContext(token);
  const [currentUser, member] = await Promise.all([
    loadActiveUserContext({ userId: auth.userId }),
    loadActiveMemberContext({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
    }),
  ]);

  return {
    payload,
    session,
    auth,
    currentUser,
    member,
  };
};
