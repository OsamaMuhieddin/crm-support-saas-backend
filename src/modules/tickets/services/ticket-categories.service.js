import { WORKSPACE_ROLES } from '../../../constants/workspace-roles.js';
import { createError } from '../../../shared/errors/createError.js';
import { buildPagination } from '../../../shared/utils/pagination.js';
import { escapeRegex } from '../../../shared/utils/regex.js';
import { Workspace } from '../../workspaces/models/workspace.model.js';
import { TicketCategory } from '../models/ticket-category.model.js';
import {
  normalizeObjectId,
  normalizeNullableString,
  parseNullableBoolean,
  toObjectIdIfValid,
} from '../utils/ticket.helpers.js';
import { toValidationError } from '../utils/ticket-validation.js';

const SORT_ALLOWLIST = Object.freeze({
  order: { order: 1, name: 1, _id: 1 },
  '-order': { order: -1, name: 1, _id: 1 },
  name: { name: 1, _id: 1 },
  '-name': { name: -1, _id: 1 },
  createdAt: { createdAt: 1, _id: 1 },
  '-createdAt': { createdAt: -1, _id: 1 },
  updatedAt: { updatedAt: 1, _id: 1 },
  '-updatedAt': { updatedAt: -1, _id: 1 },
});

const DEFAULT_LIST_SORT = {
  path: 1,
  order: 1,
  name: 1,
  _id: 1,
};

const CATEGORY_BASE_PROJECTION = {
  _id: 1,
  workspaceId: 1,
  name: 1,
  slug: 1,
  parentId: 1,
  path: 1,
  order: 1,
  isActive: 1,
  createdAt: 1,
  updatedAt: 1,
};

const CATEGORY_OPTIONS_PROJECTION = {
  _id: 1,
  name: 1,
  slug: 1,
  parentId: 1,
  path: 1,
};

const isElevatedWorkspaceRole = (roleKey) =>
  roleKey === WORKSPACE_ROLES.OWNER || roleKey === WORKSPACE_ROLES.ADMIN;

const normalizeCategorySlug = (value) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  return (
    value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-_]/g, '') || undefined
  );
};

const buildCategoryPath = ({ parentPath = null, slug }) => {
  const normalizedSlug = normalizeCategorySlug(slug);
  if (!normalizedSlug) {
    return null;
  }

  const normalizedParentPath = String(parentPath || '').trim();
  if (!normalizedParentPath) {
    return normalizedSlug;
  }

  return `${normalizedParentPath}/${normalizedSlug}`;
};

const buildCategoryView = (category) => ({
  _id: normalizeObjectId(category._id),
  workspaceId: normalizeObjectId(category.workspaceId),
  name: category.name,
  slug: category.slug,
  parentId: category.parentId ? normalizeObjectId(category.parentId) : null,
  path: category.path,
  order: Number(category.order || 0),
  isActive: Boolean(category.isActive),
  createdAt: category.createdAt,
  updatedAt: category.updatedAt,
});

const buildCategoryOptionView = (category) => ({
  _id: normalizeObjectId(category._id),
  name: category.name,
  slug: category.slug,
  parentId: category.parentId ? normalizeObjectId(category.parentId) : null,
  path: category.path,
});

const throwMappedCategoryWriteError = (error) => {
  if (error?.code !== 11000) {
    throw error;
  }

  const conflictKeys = [
    ...Object.keys(error?.keyPattern || {}),
    ...Object.keys(error?.keyValue || {}),
    String(error?.message || ''),
  ].join(' ');

  if (conflictKeys.includes('slug')) {
    throw createError('errors.ticketCategory.slugAlreadyUsed', 409);
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

const findCategoryInWorkspaceOrThrow = async ({
  workspaceId,
  categoryId,
  includeInactive = true,
  projection = CATEGORY_BASE_PROJECTION,
  lean = false,
}) => {
  const query = {
    _id: categoryId,
    workspaceId,
    deletedAt: null,
  };

  if (!includeInactive) {
    query.isActive = true;
  }

  let cursor = TicketCategory.findOne(query).select(projection);
  if (lean) {
    cursor = cursor.lean();
  }

  const category = await cursor;

  if (!category) {
    throw createError('errors.ticketCategory.notFound', 404);
  }

  return category;
};

const resolveParentCategory = async ({
  workspaceId,
  categoryId = null,
  parentId,
}) => {
  if (parentId === null || parentId === undefined || parentId === '') {
    return null;
  }

  const parentObjectId = toObjectIdIfValid(parentId);
  const categoryObjectId = categoryId ? toObjectIdIfValid(categoryId) : null;

  if (categoryObjectId && String(parentObjectId) === String(categoryObjectId)) {
    throw toValidationError(
      'parentId',
      'errors.ticketCategory.parentCannotBeSelf'
    );
  }

  const parent = await TicketCategory.findOne({
    _id: parentObjectId,
    workspaceId,
    deletedAt: null,
  })
    .select('_id parentId path')
    .lean();

  if (!parent) {
    throw createError('errors.ticketCategory.notFound', 404);
  }

  if (!categoryObjectId) {
    return parent;
  }

  const visited = new Set();
  let current = parent;

  while (current) {
    const currentId = String(current._id);

    if (currentId === String(categoryObjectId)) {
      throw toValidationError('parentId', 'errors.ticketCategory.parentCycle');
    }

    if (visited.has(currentId)) {
      throw toValidationError('parentId', 'errors.ticketCategory.parentCycle');
    }

    visited.add(currentId);

    if (!current.parentId) {
      break;
    }

    current = await TicketCategory.findOne({
      _id: current.parentId,
      workspaceId,
      deletedAt: null,
    })
      .select('_id parentId')
      .lean();

    if (!current) {
      break;
    }
  }

  return parent;
};

const updateDescendantPaths = async ({ workspaceId, oldPath, newPath }) => {
  if (!oldPath || oldPath === newPath) {
    return;
  }

  const prefix = `${oldPath}/`;
  const descendants = await TicketCategory.find({
    workspaceId,
    deletedAt: null,
    path: {
      $regex: `^${escapeRegex(prefix)}`,
    },
  })
    .select('_id path')
    .lean();

  if (descendants.length === 0) {
    return;
  }

  await TicketCategory.bulkWrite(
    descendants.map((descendant) => ({
      updateOne: {
        filter: {
          _id: descendant._id,
          workspaceId,
          deletedAt: null,
        },
        update: {
          $set: {
            path: descendant.path.replace(prefix, `${newPath}/`),
          },
        },
      },
    }))
  );
};

const normalizeCreatePayload = (payload = {}) => ({
  name: String(payload.name || '').trim(),
  slug: normalizeNullableString(payload.slug),
  parentId:
    payload.parentId === null
      ? null
      : toObjectIdIfValid(normalizeNullableString(payload.parentId)),
  order:
    payload.order === undefined || payload.order === null
      ? 0
      : Number(payload.order),
});

const normalizeUpdatePayload = (payload = {}) => {
  const normalized = {};

  if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
    normalized.name = String(payload.name || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'slug')) {
    normalized.slug = normalizeNullableString(payload.slug);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'parentId')) {
    const normalizedParentId = normalizeNullableString(payload.parentId);
    normalized.parentId =
      normalizedParentId === null
        ? null
        : toObjectIdIfValid(normalizedParentId);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'order')) {
    normalized.order = Number(payload.order);
  }

  return normalized;
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
      { slug: { $regex: escaped, $options: 'i' } },
      { path: { $regex: escaped, $options: 'i' } },
    ],
  };
};

const buildSort = (sort) => SORT_ALLOWLIST[sort] || DEFAULT_LIST_SORT;

export const createTicketCategory = async ({ workspaceId, payload }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const normalized = normalizeCreatePayload(payload);

  await findWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
  });

  const slug = normalizeCategorySlug(normalized.slug || normalized.name);
  if (!slug) {
    throw toValidationError('slug', 'errors.validation.invalid');
  }

  const parent = await resolveParentCategory({
    workspaceId: workspaceObjectId,
    parentId: normalized.parentId,
  });

  try {
    const category = await TicketCategory.create({
      workspaceId: workspaceObjectId,
      name: normalized.name,
      slug,
      parentId: parent?._id || null,
      path: buildCategoryPath({
        parentPath: parent?.path || null,
        slug,
      }),
      order: normalized.order,
      isActive: true,
    });

    return {
      category: buildCategoryView(category),
    };
  } catch (error) {
    throwMappedCategoryWriteError(error);
  }
};

export const listTicketCategories = async ({
  workspaceId,
  roleKey,
  page = 1,
  limit = 20,
  q = null,
  search = null,
  parentId = null,
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

  if (parentId) {
    query.parentId = toObjectIdIfValid(parentId);
  }

  const searchClause = buildSearchClause(q || search);
  if (searchClause) {
    Object.assign(query, searchClause);
  }

  const [total, categories] = await Promise.all([
    TicketCategory.countDocuments(query),
    TicketCategory.find(query)
      .sort(buildSort(String(sort || '').trim()))
      .skip(skip)
      .limit(safeLimit)
      .select(CATEGORY_BASE_PROJECTION)
      .lean(),
  ]);

  return {
    ...buildPagination({
      page: safePage,
      limit: safeLimit,
      total,
      results: categories.length,
    }),
    categories: categories.map((category) => buildCategoryView(category)),
  };
};

export const listTicketCategoryOptions = async ({
  workspaceId,
  roleKey,
  q = null,
  search = null,
  parentId = null,
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

  if (parentId) {
    query.parentId = toObjectIdIfValid(parentId);
  }

  const searchClause = buildSearchClause(q || search);
  if (searchClause) {
    Object.assign(query, searchClause);
  }

  const options = await TicketCategory.find(query)
    .sort(DEFAULT_LIST_SORT)
    .limit(safeLimit)
    .select(CATEGORY_OPTIONS_PROJECTION)
    .lean();

  return {
    options: options.map((category) => buildCategoryOptionView(category)),
  };
};

export const getTicketCategoryById = async ({
  workspaceId,
  categoryId,
  roleKey,
}) => {
  const category = await findCategoryInWorkspaceOrThrow({
    workspaceId,
    categoryId,
    includeInactive: isElevatedWorkspaceRole(roleKey),
    lean: true,
  });

  return {
    category: buildCategoryView(category),
  };
};

export const updateTicketCategory = async ({
  workspaceId,
  categoryId,
  payload,
}) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const categoryObjectId = toObjectIdIfValid(categoryId);
  const normalized = normalizeUpdatePayload(payload);

  await findWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
  });

  const category = await findCategoryInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    categoryId: categoryObjectId,
    lean: false,
  });

  const oldPath = category.path || buildCategoryPath({ slug: category.slug });

  if (Object.prototype.hasOwnProperty.call(normalized, 'name')) {
    category.name = normalized.name;
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'order')) {
    category.order = normalized.order;
  }

  let parent = null;
  const hasParentUpdate = Object.prototype.hasOwnProperty.call(
    normalized,
    'parentId'
  );
  const hasSlugUpdate = Object.prototype.hasOwnProperty.call(
    normalized,
    'slug'
  );

  if (hasParentUpdate) {
    parent = await resolveParentCategory({
      workspaceId: workspaceObjectId,
      categoryId: categoryObjectId,
      parentId: normalized.parentId,
    });
    category.parentId = parent?._id || null;
  } else if (category.parentId) {
    parent = await TicketCategory.findOne({
      _id: category.parentId,
      workspaceId: workspaceObjectId,
      deletedAt: null,
    })
      .select('_id path')
      .lean();
  }

  if (hasSlugUpdate) {
    const nextSlug = normalizeCategorySlug(normalized.slug || category.name);
    if (!nextSlug) {
      throw toValidationError('slug', 'errors.validation.invalid');
    }

    category.slug = nextSlug;
  }

  if (hasParentUpdate || hasSlugUpdate || !category.path) {
    category.path = buildCategoryPath({
      parentPath: parent?.path || null,
      slug: category.slug,
    });
  }

  try {
    await category.save();
    await updateDescendantPaths({
      workspaceId: workspaceObjectId,
      oldPath,
      newPath: category.path,
    });

    return {
      category: buildCategoryView(category),
    };
  } catch (error) {
    throwMappedCategoryWriteError(error);
  }
};

export const activateTicketCategory = async ({ workspaceId, categoryId }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);

  await findWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
  });

  const category = await findCategoryInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    categoryId,
    lean: false,
  });

  if (!category.isActive) {
    category.isActive = true;
    await category.save();
  }

  return {
    category: buildCategoryView(category),
  };
};

export const deactivateTicketCategory = async ({ workspaceId, categoryId }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);

  await findWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
  });

  const category = await findCategoryInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    categoryId,
    lean: false,
  });

  if (category.isActive) {
    category.isActive = false;
    await category.save();
  }

  return {
    category: buildCategoryView(category),
  };
};
