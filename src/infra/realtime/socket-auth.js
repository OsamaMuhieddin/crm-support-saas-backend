import { createError } from '../../shared/errors/createError.js';
import {
  parseBearerToken,
  resolveActiveAccessContext,
} from '../../shared/services/auth-context.service.js';
import {
  isWidgetSocketToken,
  resolveWidgetRealtimeAuthContext,
} from '../../modules/widget/services/widget-realtime.service.js';
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

const extractSocketCredential = (socket) => {
  const widgetSessionToken = normalizeSocketToken(
    socket?.handshake?.auth?.widgetSessionToken
  );

  if (widgetSessionToken) {
    return {
      type: 'widget',
      token: widgetSessionToken,
    };
  }

  const authToken = normalizeSocketToken(socket?.handshake?.auth?.token);

  if (authToken && isWidgetSocketToken(authToken)) {
    return {
      type: 'widget',
      token: authToken,
    };
  }

  const headerToken = normalizeSocketToken(
    socket?.handshake?.headers?.authorization
  );

  if (headerToken) {
    return {
      type: 'internal',
      token: headerToken,
    };
  }

  if (authToken) {
    return {
      type: 'internal',
      token: authToken,
    };
  }

  return null;
};

const clearWidgetSocketData = (socket) => {
  delete socket.data.widgetSessionToken;
  delete socket.data.widget;
  delete socket.data.widgetSession;
};

const clearInternalSocketData = (socket) => {
  delete socket.data.accessToken;
  delete socket.data.member;
  delete socket.data.currentUser;
  delete socket.data.session;
};

const applyInternalRealtimeSocketAuthContext = ({ socket, token, context }) => {
  const { auth, session, currentUser, member } = context;

  clearWidgetSocketData(socket);
  socket.data.realtimeAuthType = 'internal';
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

const applyWidgetRealtimeSocketAuthContext = ({ socket, token, context }) => {
  clearInternalSocketData(socket);
  socket.data.realtimeAuthType = 'widget';
  socket.data.widgetSessionToken = token;
  socket.data.auth = context.auth;
  socket.data.widget = context.widget;
  socket.data.widgetSession = context.widgetSession;
};

export const refreshRealtimeSocketAuthContext = async (socket) => {
  const authType = socket?.data?.realtimeAuthType;

  if (authType === 'widget') {
    const token = socket?.data?.widgetSessionToken;

    if (!token) {
      throw createError('errors.auth.invalidToken', 401);
    }

    const context = await resolveWidgetRealtimeAuthContext({
      sessionToken: token,
    });

    applyWidgetRealtimeSocketAuthContext({
      socket,
      token,
      context,
    });

    return context;
  }

  const token = socket?.data?.accessToken;

  if (!token) {
    throw createError('errors.auth.invalidToken', 401);
  }

  const context = await resolveActiveAccessContext(token);
  applyInternalRealtimeSocketAuthContext({
    socket,
    token,
    context,
  });

  return context;
};

export const authenticateRealtimeSocket = async (socket, next) => {
  try {
    const credential = extractSocketCredential(socket);

    if (!credential?.token) {
      throw createError('errors.auth.invalidToken', 401);
    }

    if (credential.type === 'widget') {
      const context = await resolveWidgetRealtimeAuthContext({
        sessionToken: credential.token,
      });

      applyWidgetRealtimeSocketAuthContext({
        socket,
        token: credential.token,
        context,
      });

      return next();
    }

    const context = await resolveActiveAccessContext(credential.token);
    applyInternalRealtimeSocketAuthContext({
      socket,
      token: credential.token,
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
