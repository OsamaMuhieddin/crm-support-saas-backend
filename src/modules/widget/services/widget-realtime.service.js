import { getRealtimeRuntimeStatus } from '../../../infra/realtime/index.js';
import { createError } from '../../../shared/errors/createError.js';
import {
  normalizeObjectId,
  toObjectIdIfValid,
} from '../../../shared/utils/object-id.js';
import { Mailbox } from '../../mailboxes/models/mailbox.model.js';
import { Widget } from '../models/widget.model.js';
import {
  findWidgetSessionByTokenHash,
  normalizeWidgetSessionToken,
} from './widget-session-view.service.js';

const WIDGET_SESSION_TOKEN_PREFIX = 'wgs_';
const WIDGET_RECOVERY_TOKEN_PREFIX = 'wgr_';

const WIDGET_REALTIME_EVENT_NAMES = Object.freeze([
  'widget.message.created',
  'widget.conversation.updated',
]);

export const buildPublicWidgetRealtimeView = () => {
  const runtime = getRealtimeRuntimeStatus();

  return {
    enabled: Boolean(runtime.enabled),
    socketPath: runtime.path,
    transports: runtime.transports,
    auth: {
      mode: 'widget_session',
      field: 'widgetSessionToken',
      tokenPrefix: WIDGET_SESSION_TOKEN_PREFIX,
    },
    subscribeEvent: 'widget.subscribe',
    unsubscribeEvent: 'widget.unsubscribe',
    events: WIDGET_REALTIME_EVENT_NAMES,
  };
};

const isWidgetRecoveryToken = (token) =>
  String(token || '').startsWith(WIDGET_RECOVERY_TOKEN_PREFIX);

const isWidgetSessionToken = (token) =>
  String(token || '').startsWith(WIDGET_SESSION_TOKEN_PREFIX);

export const isWidgetSocketToken = (token) =>
  isWidgetSessionToken(token) || isWidgetRecoveryToken(token);

export const assertWidgetRealtimeTokenAllowed = (token) => {
  const normalizedToken = normalizeWidgetSessionToken(token);

  if (!normalizedToken || !isWidgetSessionToken(normalizedToken)) {
    throw createError('errors.auth.invalidToken', 401);
  }

  return normalizedToken;
};

const findActiveWidgetByIdOrThrow = async ({ widgetId, workspaceId }) => {
  const widget = await Widget.findOne({
    _id: toObjectIdIfValid(widgetId),
    workspaceId: toObjectIdIfValid(workspaceId),
    deletedAt: null,
    isActive: true,
  })
    .select('_id workspaceId mailboxId publicKey name isActive')
    .lean();

  if (!widget) {
    throw createError('errors.auth.invalidToken', 401);
  }

  const mailbox = await Mailbox.findOne({
    _id: widget.mailboxId,
    workspaceId: widget.workspaceId,
    deletedAt: null,
    isActive: true,
  })
    .select('_id')
    .lean();

  if (!mailbox) {
    throw createError('errors.auth.invalidToken', 401);
  }

  return widget;
};

export const resolveWidgetRealtimeAuthContext = async ({ sessionToken }) => {
  const normalizedToken = assertWidgetRealtimeTokenAllowed(sessionToken);
  const widgetSession = await findWidgetSessionByTokenHash({
    sessionToken: normalizedToken,
  });

  if (!widgetSession) {
    throw createError('errors.auth.invalidToken', 401);
  }

  const widget = await findActiveWidgetByIdOrThrow({
    widgetId: widgetSession.widgetId,
    workspaceId: widgetSession.workspaceId,
  });

  return {
    auth: {
      type: 'widget',
      workspaceId: normalizeObjectId(widgetSession.workspaceId),
      widgetId: normalizeObjectId(widget._id),
      widgetPublicKey: widget.publicKey,
      widgetSessionId: normalizeObjectId(widgetSession._id),
      ticketId: widgetSession.ticketId
        ? normalizeObjectId(widgetSession.ticketId)
        : null,
    },
    widget,
    widgetSession: {
      _id: normalizeObjectId(widgetSession._id),
      workspaceId: normalizeObjectId(widgetSession.workspaceId),
      widgetId: normalizeObjectId(widgetSession.widgetId),
      contactId: widgetSession.contactId
        ? normalizeObjectId(widgetSession.contactId)
        : null,
      ticketId: widgetSession.ticketId
        ? normalizeObjectId(widgetSession.ticketId)
        : null,
      recoveryVerifiedAt: widgetSession.recoveryVerifiedAt || null,
      createdAt: widgetSession.createdAt,
      updatedAt: widgetSession.updatedAt,
    },
    widgetSessionDocument: widgetSession,
  };
};
