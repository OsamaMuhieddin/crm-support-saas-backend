import { WORKSPACE_ROLES } from '../../../constants/workspace-roles.js';
import { createError } from '../../../shared/errors/createError.js';
import { buildPagination } from '../../../shared/utils/pagination.js';
import { escapeRegex } from '../../../shared/utils/regex.js';
import { Workspace } from '../../workspaces/models/workspace.model.js';
import { TicketTag } from '../models/ticket-tag.model.js';
import {
  normalizeObjectId,
  parseNullableBoolean,
  toObjectIdIfValid,
} from '../utils/ticket.helpers.js';

const SORT_ALLOWLIST = Object.freeze({
  name: { name: 1, _id: 1 },
  '-name': { name: -1, _id: 1 },
  createdAt: { createdAt: 1, _id: 1 },
  '-createdAt': { createdAt: -1, _id: 1 },
  updatedAt: { updatedAt: 1, _id: 1 },
  '-updatedAt': { updatedAt: -1, _id: 1 },
});

const DEFAULT_LIST_SORT = {
  name: 1,
  _id: 1,
};

const TAG_BASE_PROJECTION = {
  _id: 1,
  workspaceId: 1,
  name: 1,
  isActive: 1,
  createdAt: 1,
  updatedAt: 1,
};

const TAG_OPTIONS_PROJECTION = {
  _id: 1,
  name: 1,
};

const isElevatedWorkspaceRole = (roleKey) =>
  roleKey === WORKSPACE_ROLES.OWNER || roleKey === WORKSPACE_ROLES.ADMIN;

const buildTicketTagView = (tag) => ({
  _id: normalizeObjectId(tag._id),
  workspaceId: normalizeObjectId(tag.workspaceId),
  name: tag.name,
  isActive: Boolean(tag.isActive),
  createdAt: tag.createdAt,
  updatedAt: tag.updatedAt,
});

const buildTicketTagOptionView = (tag) => ({
  _id: normalizeObjectId(tag._id),
  name: tag.name,
});

const throwMappedTagWriteError = (error) => {
  if (error?.code !== 11000) {
    throw error;
  }

  const conflictKeys = [
    ...Object.keys(error?.keyPattern || {}),
    ...Object.keys(error?.keyValue || {}),
    String(error?.message || ''),
  ].join(' ');

  if (conflictKeys.includes('nameNormalized')) {
    throw createError('errors.ticketTag.nameAlreadyUsed', 409);
  }

  throw createError('errors.validation.failed', 409);
};

const findWorkspaceOrThrow = async ({ workspaceId, projection = '_id' }) => {
  const workspace = await Workspace.findOne({
    _id: workspaceId,
    deletedAt: null,
  })
    .select(projection)
    .lean();

  if (!workspace) {
    throw createError('errors.workspace.notFound', 404);
  }

  return workspace;
};

const findTicketTagInWorkspaceOrThrow = async ({
  workspaceId,
  tagId,
  includeInactive = true,
  projection = TAG_BASE_PROJECTION,
  lean = false,
}) => {
  const query = {
    _id: tagId,
    workspaceId,
    deletedAt: null,
  };

  if (!includeInactive) {
    query.isActive = true;
  }

  let cursor = TicketTag.findOne(query).select(projection);
  if (lean) {
    cursor = cursor.lean();
  }

  const tag = await cursor;

  if (!tag) {
    throw createError('errors.ticketTag.notFound', 404);
  }

  return tag;
};

const normalizeCreatePayload = (payload = {}) => ({
  name: String(payload.name || '').trim(),
});

const normalizeUpdatePayload = (payload = {}) => {
  const update = {};

  if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
    update.name = String(payload.name || '').trim();
  }

  return update;
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
    ],
  };
};

const buildSort = (sort) => SORT_ALLOWLIST[sort] || DEFAULT_LIST_SORT;

export const createTicketTag = async ({ workspaceId, payload }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const normalized = normalizeCreatePayload(payload);

  await findWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
  });

  try {
    const tag = await TicketTag.create({
      workspaceId: workspaceObjectId,
      name: normalized.name,
      isActive: true,
    });

    return {
      tag: buildTicketTagView(tag),
    };
  } catch (error) {
    throwMappedTagWriteError(error);
  }
};

export const listTicketTags = async ({
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
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (safePage - 1) * safeLimit;
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

  const [total, tags] = await Promise.all([
    TicketTag.countDocuments(query),
    TicketTag.find(query)
      .sort(buildSort(String(sort || '').trim()))
      .skip(skip)
      .limit(safeLimit)
      .select(TAG_BASE_PROJECTION)
      .lean(),
  ]);

  return {
    ...buildPagination({
      page: safePage,
      limit: safeLimit,
      total,
      results: tags.length,
    }),
    tags: tags.map((tag) => buildTicketTagView(tag)),
  };
};

export const listTicketTagOptions = async ({
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

  const options = await TicketTag.find(query)
    .sort(DEFAULT_LIST_SORT)
    .limit(safeLimit)
    .select(TAG_OPTIONS_PROJECTION)
    .lean();

  return {
    options: options.map((tag) => buildTicketTagOptionView(tag)),
  };
};

export const getTicketTagById = async ({ workspaceId, tagId, roleKey }) => {
  const tag = await findTicketTagInWorkspaceOrThrow({
    workspaceId,
    tagId,
    includeInactive: isElevatedWorkspaceRole(roleKey),
    lean: true,
  });

  return {
    tag: buildTicketTagView(tag),
  };
};

export const updateTicketTag = async ({ workspaceId, tagId, payload }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const normalized = normalizeUpdatePayload(payload);

  await findWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
  });

  const tag = await findTicketTagInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    tagId,
    lean: false,
  });

  for (const [key, value] of Object.entries(normalized)) {
    tag[key] = value;
  }

  try {
    await tag.save();

    return {
      tag: buildTicketTagView(tag),
    };
  } catch (error) {
    throwMappedTagWriteError(error);
  }
};

export const activateTicketTag = async ({ workspaceId, tagId }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);

  await findWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
  });

  const tag = await findTicketTagInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    tagId,
    lean: false,
  });

  if (!tag.isActive) {
    tag.isActive = true;
    await tag.save();
  }

  return {
    tag: buildTicketTagView(tag),
  };
};

export const deactivateTicketTag = async ({ workspaceId, tagId }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);

  await findWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
  });

  const tag = await findTicketTagInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    tagId,
    lean: false,
  });

  if (tag.isActive) {
    tag.isActive = false;
    await tag.save();
  }

  return {
    tag: buildTicketTagView(tag),
  };
};
