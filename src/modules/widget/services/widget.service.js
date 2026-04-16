import { WORKSPACE_ROLES } from '../../../constants/workspace-roles.js';
import { disconnectRealtimeWidgetSessionSocketsBatch } from '../../../infra/realtime/index.js';
import { DEFAULT_LANG } from '../../../i18n/index.js';
import { createError } from '../../../shared/errors/createError.js';
import { buildPagination } from '../../../shared/utils/pagination.js';
import {
  normalizeObjectId,
  toObjectIdIfValid,
} from '../../../shared/utils/object-id.js';
import { escapeRegex } from '../../../shared/utils/regex.js';
import { Mailbox } from '../../mailboxes/models/mailbox.model.js';
import { Workspace } from '../../workspaces/models/workspace.model.js';
import { WidgetSession } from '../models/widget-session.model.js';
import { Widget } from '../models/widget.model.js';
import { buildPublicWidgetRealtimeView } from './widget-realtime.service.js';

const SORT_ALLOWLIST = Object.freeze({
  name: { name: 1, _id: 1 },
  '-name': { name: -1, _id: 1 },
  createdAt: { createdAt: 1, _id: 1 },
  '-createdAt': { createdAt: -1, _id: 1 },
  updatedAt: { updatedAt: 1, _id: 1 },
  '-updatedAt': { updatedAt: -1, _id: 1 },
});

const DEFAULT_LIST_SORT = {
  isActive: -1,
  createdAt: -1,
  _id: 1,
};

const WIDGET_BASE_PROJECTION = {
  _id: 1,
  workspaceId: 1,
  mailboxId: 1,
  publicKey: 1,
  name: 1,
  branding: 1,
  behavior: 1,
  isActive: 1,
  createdAt: 1,
  updatedAt: 1,
};

const WIDGET_OPTIONS_PROJECTION = {
  _id: 1,
  publicKey: 1,
  name: 1,
  isActive: 1,
};

const MAILBOX_SUMMARY_PROJECTION = {
  _id: 1,
  name: 1,
  isActive: 1,
};

const normalizeNullableString = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

const parseNullableBoolean = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const lowered = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(lowered)) {
    return true;
  }

  if (['0', 'false', 'no'].includes(lowered)) {
    return false;
  }

  return null;
};

const isElevatedWorkspaceRole = (roleKey) =>
  roleKey === WORKSPACE_ROLES.OWNER || roleKey === WORKSPACE_ROLES.ADMIN;

const buildMailboxSummaryView = (mailbox) => {
  if (!mailbox) {
    return null;
  }

  return {
    _id: normalizeObjectId(mailbox._id),
    name: mailbox.name,
    isActive: Boolean(mailbox.isActive),
  };
};

const buildWidgetView = (widget, mailbox = null) => ({
  _id: normalizeObjectId(widget._id),
  workspaceId: normalizeObjectId(widget.workspaceId),
  mailboxId: normalizeObjectId(widget.mailboxId),
  publicKey: widget.publicKey,
  name: widget.name,
  branding: {
    displayName: widget.branding?.displayName || null,
    accentColor: widget.branding?.accentColor || null,
    launcherLabel: widget.branding?.launcherLabel || null,
    welcomeTitle: widget.branding?.welcomeTitle || null,
    welcomeMessage: widget.branding?.welcomeMessage || null,
  },
  behavior: {
    defaultLocale: widget.behavior?.defaultLocale || DEFAULT_LANG,
    collectName: widget.behavior?.collectName !== false,
    collectEmail: Boolean(widget.behavior?.collectEmail),
  },
  mailbox: buildMailboxSummaryView(mailbox),
  isActive: Boolean(widget.isActive),
  createdAt: widget.createdAt,
  updatedAt: widget.updatedAt,
});

const buildWidgetOptionView = (widget) => ({
  _id: normalizeObjectId(widget._id),
  publicKey: widget.publicKey,
  name: widget.name,
  isActive: Boolean(widget.isActive),
});

const buildWidgetActionView = (widget) => ({
  _id: normalizeObjectId(widget._id),
  isActive: Boolean(widget.isActive),
});

const buildPublicBootstrapView = (widget) => ({
  publicKey: widget.publicKey,
  name: widget.name,
  locale: widget.behavior?.defaultLocale || DEFAULT_LANG,
  branding: {
    displayName: widget.branding?.displayName || widget.name,
    accentColor: widget.branding?.accentColor || null,
    launcherLabel: widget.branding?.launcherLabel || null,
    welcomeTitle: widget.branding?.welcomeTitle || null,
    welcomeMessage: widget.branding?.welcomeMessage || null,
  },
  behavior: {
    collectName: widget.behavior?.collectName !== false,
    collectEmail: Boolean(widget.behavior?.collectEmail),
  },
  capabilities: {
    messaging: true,
    verifiedRecovery: true,
    realtime: true,
  },
});

const buildSort = (sort) => SORT_ALLOWLIST[sort] || DEFAULT_LIST_SORT;

const buildSearchClause = (q) => {
  const normalized = String(q || '').trim();
  if (!normalized) {
    return null;
  }

  const escaped = escapeRegex(normalized);
  return {
    $or: [
      { name: { $regex: escaped, $options: 'i' } },
      { nameNormalized: { $regex: escaped, $options: 'i' } },
      { publicKey: { $regex: escaped, $options: 'i' } },
    ],
  };
};

const resolveListVisibility = ({ roleKey, isActive, includeInactive }) => {
  const canViewInactive = isElevatedWorkspaceRole(roleKey);
  const parsedIsActive = parseNullableBoolean(isActive);
  const parsedIncludeInactive = parseNullableBoolean(includeInactive) === true;

  if (!canViewInactive && parsedIncludeInactive) {
    throw createError('errors.auth.forbiddenTenant', 403);
  }

  if (!canViewInactive && parsedIsActive === false) {
    throw createError('errors.auth.forbiddenTenant', 403);
  }

  if (parsedIsActive !== null) {
    return parsedIsActive;
  }

  return parsedIncludeInactive ? null : true;
};

const throwMappedWidgetWriteError = (error) => {
  if (error?.code !== 11000) {
    throw error;
  }

  const conflictKeys = [
    ...Object.keys(error?.keyPattern || {}),
    ...Object.keys(error?.keyValue || {}),
    String(error?.message || ''),
  ].join(' ');

  if (conflictKeys.includes('publicKey')) {
    throw createError('errors.widget.publicKeyConflict', 409);
  }

  throw createError('errors.validation.failed', 409);
};

const findWorkspaceOrThrow = async ({ workspaceId, projection = '_id' }) => {
  const workspace = await Workspace.findOne({
    _id: toObjectIdIfValid(workspaceId),
    deletedAt: null,
  })
    .select(projection)
    .lean();

  if (!workspace) {
    throw createError('errors.workspace.notFound', 404);
  }

  return workspace;
};

const findWidgetInWorkspaceOrThrow = async ({
  workspaceId,
  widgetId,
  includeInactive = true,
  projection = WIDGET_BASE_PROJECTION,
  lean = false,
}) => {
  const query = {
    _id: toObjectIdIfValid(widgetId),
    workspaceId: toObjectIdIfValid(workspaceId),
    deletedAt: null,
  };

  if (!includeInactive) {
    query.isActive = true;
  }

  let cursor = Widget.findOne(query).select(projection);
  if (lean) {
    cursor = cursor.lean();
  }

  const widget = await cursor;

  if (!widget) {
    throw createError('errors.widget.notFound', 404);
  }

  return widget;
};

const findActiveMailboxInWorkspaceOrThrow = async ({
  workspaceId,
  mailboxId,
}) => {
  const mailbox = await Mailbox.findOne({
    _id: toObjectIdIfValid(mailboxId),
    workspaceId: toObjectIdIfValid(workspaceId),
    deletedAt: null,
    isActive: true,
  })
    .select(MAILBOX_SUMMARY_PROJECTION)
    .lean();

  if (!mailbox) {
    throw createError('errors.mailbox.notFound', 404);
  }

  return mailbox;
};

export const findActivePublicWidgetByPublicKeyOrThrow = async ({
  publicKey,
  projection = WIDGET_BASE_PROJECTION,
}) => {
  const widget = await Widget.findOne({
    publicKey: String(publicKey || '').trim(),
    deletedAt: null,
    isActive: true,
  })
    .select(projection)
    .lean();

  if (!widget) {
    throw createError('errors.widget.notFound', 404);
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
    throw createError('errors.widget.notFound', 404);
  }

  return widget;
};

const loadMailboxMap = async ({ workspaceId, mailboxIds = [] }) => {
  const normalizedIds = [...new Set(mailboxIds.map((id) => String(id || '')))]
    .filter(Boolean)
    .map((id) => toObjectIdIfValid(id));

  if (normalizedIds.length === 0) {
    return new Map();
  }

  const mailboxes = await Mailbox.find({
    _id: { $in: normalizedIds },
    workspaceId: toObjectIdIfValid(workspaceId),
    deletedAt: null,
  })
    .select(MAILBOX_SUMMARY_PROJECTION)
    .lean();

  return new Map(mailboxes.map((mailbox) => [String(mailbox._id), mailbox]));
};

const hydrateWidgetView = async (widget) => {
  const mailboxMap = await loadMailboxMap({
    workspaceId: widget.workspaceId,
    mailboxIds: [widget.mailboxId],
  });

  return buildWidgetView(widget, mailboxMap.get(String(widget.mailboxId)));
};

const hydrateWidgetListViews = async ({ workspaceId, widgets }) => {
  const mailboxMap = await loadMailboxMap({
    workspaceId,
    mailboxIds: widgets.map((widget) => widget.mailboxId),
  });

  return widgets.map((widget) =>
    buildWidgetView(widget, mailboxMap.get(String(widget.mailboxId)))
  );
};

const normalizeCreatePayload = (payload = {}) => ({
  name: String(payload.name || '').trim(),
  mailboxId: String(payload.mailboxId || '').trim(),
  branding: {
    displayName: normalizeNullableString(payload.branding?.displayName) || null,
    accentColor: normalizeNullableString(payload.branding?.accentColor) || null,
    launcherLabel:
      normalizeNullableString(payload.branding?.launcherLabel) || null,
    welcomeTitle:
      normalizeNullableString(payload.branding?.welcomeTitle) || null,
    welcomeMessage:
      normalizeNullableString(payload.branding?.welcomeMessage) || null,
  },
  behavior: {
    defaultLocale:
      normalizeNullableString(payload.behavior?.defaultLocale) || DEFAULT_LANG,
    collectName:
      payload.behavior?.collectName === undefined
        ? true
        : Boolean(payload.behavior.collectName),
    collectEmail:
      payload.behavior?.collectEmail === undefined
        ? false
        : Boolean(payload.behavior.collectEmail),
  },
});

const normalizeUpdatePayload = (payload = {}) => {
  const update = {};

  if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
    update.name = String(payload.name || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'mailboxId')) {
    update.mailboxId = String(payload.mailboxId || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'branding')) {
    update.branding = {};

    if (
      Object.prototype.hasOwnProperty.call(
        payload.branding || {},
        'displayName'
      )
    ) {
      update.branding.displayName =
        normalizeNullableString(payload.branding?.displayName) || null;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        payload.branding || {},
        'accentColor'
      )
    ) {
      update.branding.accentColor =
        normalizeNullableString(payload.branding?.accentColor) || null;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        payload.branding || {},
        'launcherLabel'
      )
    ) {
      update.branding.launcherLabel =
        normalizeNullableString(payload.branding?.launcherLabel) || null;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        payload.branding || {},
        'welcomeTitle'
      )
    ) {
      update.branding.welcomeTitle =
        normalizeNullableString(payload.branding?.welcomeTitle) || null;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        payload.branding || {},
        'welcomeMessage'
      )
    ) {
      update.branding.welcomeMessage =
        normalizeNullableString(payload.branding?.welcomeMessage) || null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'behavior')) {
    update.behavior = {};

    if (
      Object.prototype.hasOwnProperty.call(
        payload.behavior || {},
        'defaultLocale'
      )
    ) {
      update.behavior.defaultLocale =
        normalizeNullableString(payload.behavior?.defaultLocale) ||
        DEFAULT_LANG;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        payload.behavior || {},
        'collectName'
      )
    ) {
      update.behavior.collectName = Boolean(payload.behavior?.collectName);
    }

    if (
      Object.prototype.hasOwnProperty.call(
        payload.behavior || {},
        'collectEmail'
      )
    ) {
      update.behavior.collectEmail = Boolean(payload.behavior?.collectEmail);
    }
  }

  return update;
};

export const createWidget = async ({ workspaceId, payload }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const normalized = normalizeCreatePayload(payload);

  await findWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
  });

  await findActiveMailboxInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    mailboxId: normalized.mailboxId,
  });

  try {
    const widget = await Widget.create({
      workspaceId: workspaceObjectId,
      mailboxId: toObjectIdIfValid(normalized.mailboxId),
      name: normalized.name,
      branding: normalized.branding,
      behavior: normalized.behavior,
      isActive: true,
    });

    const refreshed = await Widget.findOne({
      _id: widget._id,
      workspaceId: workspaceObjectId,
      deletedAt: null,
    })
      .select(WIDGET_BASE_PROJECTION)
      .lean();

    return {
      widget: await hydrateWidgetView(refreshed || widget.toObject()),
    };
  } catch (error) {
    throwMappedWidgetWriteError(error);
  }
};

export const listWidgets = async ({
  workspaceId,
  roleKey,
  page = 1,
  limit = 20,
  q = null,
  search = null,
  isActive = null,
  includeInactive = null,
  sort = null,
}) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (safePage - 1) * safeLimit;
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const effectiveIsActive = resolveListVisibility({
    roleKey,
    isActive,
    includeInactive,
  });

  const query = {
    workspaceId: workspaceObjectId,
    deletedAt: null,
  };

  if (effectiveIsActive !== null) {
    query.isActive = effectiveIsActive;
  }

  const searchClause = buildSearchClause(q || search);
  if (searchClause) {
    Object.assign(query, searchClause);
  }

  const [total, widgets] = await Promise.all([
    Widget.countDocuments(query),
    Widget.find(query)
      .sort(buildSort(String(sort || '').trim()))
      .skip(skip)
      .limit(safeLimit)
      .select(WIDGET_BASE_PROJECTION)
      .lean(),
  ]);

  return {
    ...buildPagination({
      page: safePage,
      limit: safeLimit,
      total,
      results: widgets.length,
    }),
    widgets: await hydrateWidgetListViews({
      workspaceId: workspaceObjectId,
      widgets,
    }),
  };
};

export const listWidgetOptions = async ({
  workspaceId,
  roleKey,
  q = null,
  search = null,
  isActive = null,
  includeInactive = null,
  limit = 20,
}) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const effectiveIsActive = resolveListVisibility({
    roleKey,
    isActive,
    includeInactive,
  });

  const query = {
    workspaceId: workspaceObjectId,
    deletedAt: null,
  };

  if (effectiveIsActive !== null) {
    query.isActive = effectiveIsActive;
  }

  const searchClause = buildSearchClause(q || search);
  if (searchClause) {
    Object.assign(query, searchClause);
  }

  const options = await Widget.find(query)
    .sort(DEFAULT_LIST_SORT)
    .limit(safeLimit)
    .select(WIDGET_OPTIONS_PROJECTION)
    .lean();

  return {
    options: options.map((widget) => buildWidgetOptionView(widget)),
  };
};

export const getWidgetById = async ({ workspaceId, widgetId, roleKey }) => {
  const widget = await findWidgetInWorkspaceOrThrow({
    workspaceId,
    widgetId,
    includeInactive: isElevatedWorkspaceRole(roleKey),
    lean: true,
  });

  return {
    widget: await hydrateWidgetView(widget),
  };
};

export const updateWidget = async ({ workspaceId, widgetId, payload }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const normalized = normalizeUpdatePayload(payload);

  await findWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
  });

  const widget = await findWidgetInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    widgetId,
    lean: false,
  });

  if (Object.prototype.hasOwnProperty.call(normalized, 'mailboxId')) {
    await findActiveMailboxInWorkspaceOrThrow({
      workspaceId: workspaceObjectId,
      mailboxId: normalized.mailboxId,
    });

    widget.mailboxId = toObjectIdIfValid(normalized.mailboxId);
    delete normalized.mailboxId;
  }

  for (const [key, value] of Object.entries(normalized)) {
    if (key === 'branding' || key === 'behavior') {
      widget[key] = {
        ...(widget[key]?.toObject?.() || widget[key] || {}),
        ...value,
      };
      continue;
    }

    widget[key] = value;
  }

  try {
    await widget.save();
    const refreshed = await Widget.findOne({
      _id: widget._id,
      workspaceId: workspaceObjectId,
      deletedAt: null,
    })
      .select(WIDGET_BASE_PROJECTION)
      .lean();

    return {
      widget: await hydrateWidgetView(refreshed || widget.toObject()),
    };
  } catch (error) {
    throwMappedWidgetWriteError(error);
  }
};

export const activateWidget = async ({ workspaceId, widgetId }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);

  await findWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
  });

  const widget = await findWidgetInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    widgetId,
    lean: false,
  });

  await findActiveMailboxInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    mailboxId: widget.mailboxId,
  });

  if (!widget.isActive) {
    widget.isActive = true;
    await widget.save();
  }

  return {
    widget: buildWidgetActionView(widget),
  };
};

export const deactivateWidget = async ({ workspaceId, widgetId }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);

  await findWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
  });

  const widget = await findWidgetInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    widgetId,
    lean: false,
  });

  if (widget.isActive) {
    widget.isActive = false;
    await widget.save();
  }

  const widgetSessionIds = (
    await WidgetSession.find({
      workspaceId: workspaceObjectId,
      widgetId: widget._id,
      deletedAt: null,
      invalidatedAt: null,
    })
      .select('_id')
      .lean()
  ).map((session) => normalizeObjectId(session._id));

  if (widgetSessionIds.length > 0) {
    await disconnectRealtimeWidgetSessionSocketsBatch({
      widgetSessionIds,
    });
  }

  return {
    widget: buildWidgetActionView(widget),
  };
};

export const getPublicWidgetBootstrap = async ({ publicKey }) => {
  const widget = await findActivePublicWidgetByPublicKeyOrThrow({
    publicKey,
  });

  return {
    widget: buildPublicBootstrapView(widget),
    realtime: buildPublicWidgetRealtimeView(),
  };
};
