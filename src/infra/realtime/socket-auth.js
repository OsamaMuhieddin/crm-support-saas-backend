import { createError } from '../../shared/errors/createError.js';
import {
  parseBearerToken,
  resolveActiveAccessContext,
} from '../../shared/services/auth-context.service.js';
import { createSocketIoErrorFromError } from './contracts.js';
import { logRealtimeDebug } from './logger.js';

const normalizeSocketToken = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  return parseBearerToken(normalized) || normalized;
};

const extractSocketToken = (socket) => {
  const headerToken = normalizeSocketToken(
    socket?.handshake?.headers?.authorization
  );

  if (headerToken) {
    return headerToken;
  }

  return normalizeSocketToken(socket?.handshake?.auth?.token);
};

const applyRealtimeSocketAuthContext = ({ socket, token, context }) => {
  const { auth, session, currentUser, member } = context;

  socket.data.accessToken = token;
  socket.data.auth = auth;
  socket.data.member = member;
  socket.data.currentUser = currentUser;
  socket.data.session = {
    _id: String(session._id),
    userId: String(session.userId),
    workspaceId: String(session.workspaceId),
    expiresAt: session.expiresAt,
  };
};

export const refreshRealtimeSocketAuthContext = async (socket) => {
  const token = socket?.data?.accessToken;

  if (!token) {
    throw createError('errors.auth.invalidToken', 401);
  }

  const context = await resolveActiveAccessContext(token);
  applyRealtimeSocketAuthContext({
    socket,
    token,
    context,
  });

  return context;
};

export const authenticateRealtimeSocket = async (socket, next) => {
  try {
    const token = extractSocketToken(socket);

    if (!token) {
      throw createError('errors.auth.invalidToken', 401);
    }

    const context = await resolveActiveAccessContext(token);
    applyRealtimeSocketAuthContext({
      socket,
      token,
      context,
    });

    return next();
  } catch (error) {
    logRealtimeDebug('Rejected realtime socket handshake.', {
      socketId: socket?.id || null,
      messageKey: error?.messageKey || 'errors.unknown',
    });

    return next(createSocketIoErrorFromError(error));
  }
};
