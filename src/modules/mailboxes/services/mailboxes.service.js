import mongoose from 'mongoose';
import { WORKSPACE_ROLES } from '../../../constants/workspace-roles.js';
import { MAILBOX_TYPE } from '../../../constants/mailbox-type.js';
import { createError } from '../../../shared/errors/createError.js';
import { buildPagination } from '../../../shared/utils/pagination.js';
import { escapeRegex } from '../../../shared/utils/regex.js';
import { Mailbox } from '../models/mailbox.model.js';
import { Workspace } from '../../workspaces/models/workspace.model.js';
import { findSlaPolicyInWorkspaceOrThrow } from '../../sla/services/sla-reference.service.js';
import {
  assertWorkspaceMailboxWriteAllowed,
  assertWorkspaceSlaWriteAllowed,
} from '../../billing/services/billing-enforcement.service.js';

const DEFAULT_MAILBOX_NAME = 'Support';

const SORT_ALLOWLIST = Object.freeze({
  name: { name: 1, _id: 1 },
  '-name': { name: -1, _id: 1 },
  createdAt: { createdAt: 1, _id: 1 },
  '-createdAt': { createdAt: -1, _id: 1 },
  updatedAt: { updatedAt: 1, _id: 1 },
  '-updatedAt': { updatedAt: -1, _id: 1 },
});

const DEFAULT_LIST_SORT = {
  isDefault: -1,
  createdAt: -1,
  _id: 1,
};

const MAILBOX_BASE_PROJECTION = {
  _id: 1,
  workspaceId: 1,
  name: 1,
  type: 1,
  emailAddress: 1,
  fromName: 1,
  replyTo: 1,
  signatureText: 1,
  signatureHtml: 1,
  slaPolicyId: 1,
  isDefault: 1,
  isActive: 1,
  createdAt: 1,
  updatedAt: 1,
};

const MAILBOX_OPTIONS_PROJECTION = {
  _id: 1,
  name: 1,
  isDefault: 1,
};

const normalizeObjectId = (value) => String(value || '');

const toObjectIdIfValid = (value) => {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }

  return value;
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

const buildMailboxView = (mailbox) => ({
  _id: normalizeObjectId(mailbox._id),
  workspaceId: normalizeObjectId(mailbox.workspaceId),
  name: mailbox.name,
  type: mailbox.type,
  emailAddress: mailbox.emailAddress,
  fromName: mailbox.fromName,
  replyTo: mailbox.replyTo,
  signatureText: mailbox.signatureText,
  signatureHtml: mailbox.signatureHtml,
  slaPolicyId: mailbox.slaPolicyId
    ? normalizeObjectId(mailbox.slaPolicyId)
    : null,
  isDefault: Boolean(mailbox.isDefault),
  isActive: Boolean(mailbox.isActive),
  createdAt: mailbox.createdAt,
  updatedAt: mailbox.updatedAt,
});

const buildMailboxOptionView = (mailbox) => ({
  _id: normalizeObjectId(mailbox._id),
  name: mailbox.name,
  isDefault: Boolean(mailbox.isDefault),
});

const buildMailboxActionView = (mailbox) => ({
  _id: normalizeObjectId(mailbox._id),
  isDefault: Boolean(mailbox.isDefault),
  isActive: Boolean(mailbox.isActive),
});

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

const throwMappedMailboxWriteError = (error) => {
  if (error?.code !== 11000) {
    throw error;
  }

  const keyPattern = error?.keyPattern || {};
  const keyValue = error?.keyValue || {};
  const conflictKeys = [
    ...Object.keys(keyPattern),
    ...Object.keys(keyValue),
    String(error?.message || ''),
  ].join(' ');

  if (conflictKeys.includes('emailAddressNormalized')) {
    throw createError('errors.mailbox.emailAlreadyUsed', 409);
  }

  if (conflictKeys.includes('isDefault')) {
    throw createError('errors.mailbox.defaultConflict', 409);
  }

  throw createError('errors.validation.failed', 409);
};

const findMailboxInWorkspaceOrThrow = async ({ workspaceId, mailboxId }) => {
  const mailbox = await Mailbox.findOne({
    _id: mailboxId,
    workspaceId,
    deletedAt: null,
  });

  if (!mailbox) {
    throw createError('errors.mailbox.notFound', 404);
  }

  return mailbox;
};

const findWorkspaceOrThrow = async ({
  workspaceId,
  projection = '_id defaultMailboxId',
}) => {
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

const chooseCanonicalDefaultMailboxId = ({ workspace, mailboxes }) => {
  if (!Array.isArray(mailboxes) || mailboxes.length === 0) {
    return null;
  }

  const byId = new Map(
    mailboxes.map((mailbox) => [String(mailbox._id), mailbox])
  );
  const workspaceDefaultId = workspace?.defaultMailboxId
    ? String(workspace.defaultMailboxId)
    : null;
  const defaultCandidates = mailboxes.filter((mailbox) => mailbox.isDefault);

  if (defaultCandidates.length === 0) {
    if (workspaceDefaultId && byId.has(workspaceDefaultId)) {
      return workspaceDefaultId;
    }

    const firstActive = mailboxes.find((mailbox) => mailbox.isActive);
    return String((firstActive || mailboxes[0])._id);
  }

  if (defaultCandidates.length === 1) {
    return String(defaultCandidates[0]._id);
  }

  const workspaceDefaultCandidate = defaultCandidates.find(
    (mailbox) => String(mailbox._id) === workspaceDefaultId
  );

  if (workspaceDefaultCandidate) {
    return String(workspaceDefaultCandidate._id);
  }

  return String(defaultCandidates[0]._id);
};

const setCanonicalMailboxFlags = async ({ workspaceId, defaultMailboxId }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const defaultObjectId = toObjectIdIfValid(defaultMailboxId);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await Mailbox.updateMany(
      {
        workspaceId: workspaceObjectId,
        deletedAt: null,
        isDefault: true,
        _id: { $ne: defaultObjectId },
      },
      {
        $set: {
          isDefault: false,
        },
      }
    );

    try {
      const updateResult = await Mailbox.updateOne(
        {
          _id: defaultObjectId,
          workspaceId: workspaceObjectId,
          deletedAt: null,
        },
        {
          $set: {
            isDefault: true,
            isActive: true,
          },
        }
      );

      if (!updateResult?.matchedCount) {
        throw createError('errors.mailbox.notFound', 404);
      }

      return;
    } catch (error) {
      if (error?.statusCode === 404) {
        throw error;
      }

      if (error?.code === 11000 && attempt === 0) {
        continue;
      }

      throwMappedMailboxWriteError(error);
    }
  }
};

const setWorkspaceDefaultMailboxId = async ({
  workspaceId,
  defaultMailboxId,
}) => {
  const updateResult = await Workspace.updateOne(
    {
      _id: workspaceId,
      deletedAt: null,
    },
    {
      $set: {
        defaultMailboxId,
      },
    }
  );

  if (!updateResult?.matchedCount) {
    throw createError('errors.workspace.notFound', 404);
  }
};

const readCanonicalDefaultState = async ({ workspaceId, defaultMailboxId }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const defaultObjectId = toObjectIdIfValid(defaultMailboxId);

  const [workspace, mailbox, defaultMailboxes] = await Promise.all([
    Workspace.findOne({
      _id: workspaceObjectId,
      deletedAt: null,
    })
      .select('_id defaultMailboxId')
      .lean(),
    Mailbox.findOne({
      _id: defaultObjectId,
      workspaceId: workspaceObjectId,
      deletedAt: null,
    })
      .select(MAILBOX_BASE_PROJECTION)
      .lean(),
    Mailbox.find({
      workspaceId: workspaceObjectId,
      deletedAt: null,
      isDefault: true,
    })
      .select('_id')
      .lean(),
  ]);

  const hasSingleDefault =
    defaultMailboxes.length === 1 &&
    String(defaultMailboxes[0]._id) === String(defaultObjectId);
  const workspaceMatches =
    Boolean(workspace?.defaultMailboxId) &&
    String(workspace.defaultMailboxId) === String(defaultObjectId);
  const mailboxIsDefaultAndActive = Boolean(
    mailbox?.isDefault && mailbox?.isActive
  );

  return {
    workspace,
    mailbox,
    isConsistent:
      Boolean(workspace) &&
      Boolean(mailbox) &&
      hasSingleDefault &&
      workspaceMatches &&
      mailboxIsDefaultAndActive,
  };
};

const toDefaultConflictError = (error) => {
  if (error?.statusCode) {
    return error;
  }

  return createError('errors.mailbox.defaultConflict', 409);
};

const applyCanonicalDefaultMailbox = async ({
  workspaceId,
  defaultMailboxId,
}) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const defaultObjectId = toObjectIdIfValid(defaultMailboxId);

  const targetMailbox = await Mailbox.findOne({
    _id: defaultObjectId,
    workspaceId: workspaceObjectId,
    deletedAt: null,
  })
    .select('_id')
    .lean();

  if (!targetMailbox) {
    throw createError('errors.mailbox.notFound', 404);
  }

  await setCanonicalMailboxFlags({
    workspaceId: workspaceObjectId,
    defaultMailboxId: defaultObjectId,
  });

  let syncError = null;
  try {
    await setWorkspaceDefaultMailboxId({
      workspaceId: workspaceObjectId,
      defaultMailboxId: defaultObjectId,
    });
  } catch (error) {
    syncError = error;

    try {
      await setWorkspaceDefaultMailboxId({
        workspaceId: workspaceObjectId,
        defaultMailboxId: defaultObjectId,
      });
    } catch {
      // Best-effort re-sync only; final consistency check below decides outcome.
    }
  }

  const state = await readCanonicalDefaultState({
    workspaceId: workspaceObjectId,
    defaultMailboxId: defaultObjectId,
  });

  if (!state.isConsistent) {
    throw toDefaultConflictError(syncError);
  }

  if (syncError) {
    // Re-sync succeeded after an initial pointer update failure.
    return {
      workspace: state.workspace,
      mailbox: state.mailbox,
      repaired: true,
    };
  }

  return {
    workspace: state.workspace,
    mailbox: state.mailbox,
    repaired: false,
  };
};

const normalizeCreatePayload = (payload = {}) => ({
  name: String(payload.name || '').trim(),
  type: payload.type || MAILBOX_TYPE.EMAIL,
  emailAddress: normalizeNullableString(payload.emailAddress) || null,
  fromName: normalizeNullableString(payload.fromName) || null,
  replyTo: normalizeNullableString(payload.replyTo) || null,
  signatureText: normalizeNullableString(payload.signatureText) || null,
  signatureHtml: normalizeNullableString(payload.signatureHtml) || null,
  slaPolicyId: normalizeNullableString(payload.slaPolicyId) || null,
});

const normalizeUpdatePayload = (payload = {}) => {
  const update = {};

  if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
    update.name = String(payload.name || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'type')) {
    update.type = payload.type;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'emailAddress')) {
    update.emailAddress = normalizeNullableString(payload.emailAddress);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'fromName')) {
    update.fromName = normalizeNullableString(payload.fromName);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'replyTo')) {
    update.replyTo = normalizeNullableString(payload.replyTo);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'signatureText')) {
    update.signatureText = normalizeNullableString(payload.signatureText);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'signatureHtml')) {
    update.signatureHtml = normalizeNullableString(payload.signatureHtml);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'slaPolicyId')) {
    update.slaPolicyId = normalizeNullableString(payload.slaPolicyId);
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
      {
        emailAddressNormalized: {
          $regex: escaped,
          $options: 'i',
        },
      },
    ],
  };
};

const buildSort = (sort) => SORT_ALLOWLIST[sort] || DEFAULT_LIST_SORT;

// This helper is intentionally limited to workspace bootstrap/backfill/controlled repair.
export const ensureWorkspaceDefaultMailbox = async ({
  workspaceId,
  defaultMailboxName = DEFAULT_MAILBOX_NAME,
}) => {
  const workspace = await findWorkspaceOrThrow({
    workspaceId,
    projection: '_id defaultMailboxId',
  });

  const workspaceObjectId = toObjectIdIfValid(workspace._id);
  const mailboxQuery = {
    workspaceId: workspaceObjectId,
    deletedAt: null,
  };

  let createdDefault = false;
  let changed = false;

  let mailboxes = await Mailbox.find(mailboxQuery)
    .sort({ createdAt: 1, _id: 1 })
    .lean();

  if (mailboxes.length === 0) {
    try {
      const created = await Mailbox.create({
        workspaceId: workspaceObjectId,
        name: defaultMailboxName,
        type: MAILBOX_TYPE.EMAIL,
        emailAddress: null,
        fromName: null,
        replyTo: null,
        signatureText: null,
        signatureHtml: null,
        isDefault: true,
        isActive: true,
      });

      createdDefault = true;
      changed = true;
      mailboxes = [created.toObject()];
    } catch (error) {
      if (error?.code !== 11000) {
        throwMappedMailboxWriteError(error);
      }

      mailboxes = await Mailbox.find(mailboxQuery)
        .sort({ createdAt: 1, _id: 1 })
        .lean();
    }
  }

  const canonicalDefaultMailboxId = chooseCanonicalDefaultMailboxId({
    workspace,
    mailboxes,
  });

  if (!canonicalDefaultMailboxId) {
    return {
      workspaceId: normalizeObjectId(workspace._id),
      defaultMailboxId: null,
      createdDefault,
      changed,
      mailbox: null,
    };
  }

  const beforeDefaults = mailboxes
    .filter((mailbox) => mailbox.isDefault)
    .map((mailbox) => String(mailbox._id));

  if (
    beforeDefaults.length !== 1 ||
    beforeDefaults[0] !== String(canonicalDefaultMailboxId)
  ) {
    changed = true;
  }

  const wasCanonicalInactive = mailboxes.some(
    (mailbox) =>
      String(mailbox._id) === String(canonicalDefaultMailboxId) &&
      !mailbox.isActive
  );

  if (wasCanonicalInactive) {
    changed = true;
  }

  const aligned = await applyCanonicalDefaultMailbox({
    workspaceId: workspaceObjectId,
    defaultMailboxId: canonicalDefaultMailboxId,
  });

  if (
    !workspace.defaultMailboxId ||
    String(workspace.defaultMailboxId) !== String(canonicalDefaultMailboxId)
  ) {
    changed = true;
  }

  return {
    workspaceId: normalizeObjectId(aligned.workspace?._id || workspace._id),
    defaultMailboxId: normalizeObjectId(
      aligned.workspace?.defaultMailboxId || canonicalDefaultMailboxId
    ),
    createdDefault,
    changed,
    mailbox: aligned.mailbox ? buildMailboxView(aligned.mailbox) : null,
  };
};

export const backfillWorkspaceDefaultMailboxes = async () => {
  const workspaces = await Workspace.find({
    deletedAt: null,
  })
    .select('_id')
    .lean();

  let scanned = 0;
  let changed = 0;
  let createdDefault = 0;

  for (const workspace of workspaces) {
    scanned += 1;

    const result = await ensureWorkspaceDefaultMailbox({
      workspaceId: workspace._id,
    });

    if (result.changed) {
      changed += 1;
    }

    if (result.createdDefault) {
      createdDefault += 1;
    }
  }

  return {
    scanned,
    changed,
    createdDefault,
  };
};

export const createMailbox = async ({ workspaceId, payload }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const normalized = normalizeCreatePayload(payload);

  await findWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    projection: '_id',
  });

  try {
    let resolvedSlaPolicyId = null;

    await assertWorkspaceMailboxWriteAllowed({
      workspaceId: workspaceObjectId,
    });

    if (normalized.slaPolicyId) {
      await assertWorkspaceSlaWriteAllowed({
        workspaceId: workspaceObjectId,
      });

      const policy = await findSlaPolicyInWorkspaceOrThrow({
        workspaceId: workspaceObjectId,
        policyId: normalized.slaPolicyId,
        projection: '_id isActive',
        requireActive: true,
      });
      resolvedSlaPolicyId = policy._id;
    }

    const mailbox = await Mailbox.create({
      workspaceId: workspaceObjectId,
      ...normalized,
      slaPolicyId: resolvedSlaPolicyId,
      isDefault: false,
      isActive: true,
    });

    await ensureWorkspaceDefaultMailbox({
      workspaceId: workspaceObjectId,
    });

    const refreshed = await Mailbox.findOne({
      _id: mailbox._id,
      workspaceId: workspaceObjectId,
      deletedAt: null,
    }).lean();

    return {
      mailbox: buildMailboxView(refreshed || mailbox),
    };
  } catch (error) {
    throwMappedMailboxWriteError(error);
  }
};

export const listMailboxes = async ({
  workspaceId,
  roleKey,
  page = 1,
  limit = 20,
  q = null,
  search = null,
  isActive = null,
  isDefault = null,
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

  const parsedIsDefault = parseNullableBoolean(isDefault);
  if (parsedIsDefault !== null) {
    query.isDefault = parsedIsDefault;
  }

  const searchClause = buildSearchClause(q || search);
  if (searchClause) {
    Object.assign(query, searchClause);
  }

  const sortQuery = buildSort(String(sort || '').trim());

  const [total, mailboxes] = await Promise.all([
    Mailbox.countDocuments(query),
    Mailbox.find(query)
      .sort(sortQuery)
      .skip(skip)
      .limit(safeLimit)
      .select(MAILBOX_BASE_PROJECTION)
      .lean(),
  ]);

  return {
    ...buildPagination({
      page: safePage,
      limit: safeLimit,
      total,
      results: mailboxes.length,
    }),
    mailboxes: mailboxes.map((mailbox) => buildMailboxView(mailbox)),
  };
};

export const listMailboxOptions = async ({
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

  const options = await Mailbox.find(query)
    .sort({ isDefault: -1, name: 1, _id: 1 })
    .limit(safeLimit)
    .select(MAILBOX_OPTIONS_PROJECTION)
    .lean();

  return {
    options: options.map((mailbox) => buildMailboxOptionView(mailbox)),
  };
};

export const getMailboxById = async ({ workspaceId, mailboxId, roleKey }) => {
  const query = {
    _id: mailboxId,
    workspaceId,
    deletedAt: null,
  };

  if (!isElevatedWorkspaceRole(roleKey)) {
    query.isActive = true;
  }

  const mailbox = await Mailbox.findOne(query)
    .select(MAILBOX_BASE_PROJECTION)
    .lean();

  if (!mailbox) {
    throw createError('errors.mailbox.notFound', 404);
  }

  return {
    mailbox: buildMailboxView(mailbox),
  };
};

export const updateMailbox = async ({ workspaceId, mailboxId, payload }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);

  await findWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    projection: '_id',
  });

  const mailbox = await findMailboxInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    mailboxId,
  });

  const normalized = normalizeUpdatePayload(payload);

  for (const [key, value] of Object.entries(normalized)) {
    if (key === 'slaPolicyId') {
      if (value === null) {
        mailbox.slaPolicyId = null;
        continue;
      }

      await assertWorkspaceSlaWriteAllowed({
        workspaceId: workspaceObjectId,
      });

      const policy = await findSlaPolicyInWorkspaceOrThrow({
        workspaceId: workspaceObjectId,
        policyId: value,
        projection: '_id isActive',
        requireActive: true,
      });
      mailbox.slaPolicyId = policy._id;
      continue;
    }

    mailbox[key] = value;
  }

  try {
    await mailbox.save();
    return {
      mailbox: buildMailboxView(mailbox),
    };
  } catch (error) {
    throwMappedMailboxWriteError(error);
  }
};

export const setDefaultMailbox = async ({ workspaceId, mailboxId }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);

  await findWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    projection: '_id defaultMailboxId',
  });

  const mailbox = await findMailboxInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    mailboxId,
  });

  if (!mailbox.isActive) {
    throw createError('errors.mailbox.defaultMustBeActive', 409);
  }

  const aligned = await applyCanonicalDefaultMailbox({
    workspaceId: workspaceObjectId,
    defaultMailboxId: mailbox._id,
  });

  return {
    mailbox: buildMailboxActionView(aligned.mailbox),
  };
};

export const activateMailbox = async ({ workspaceId, mailboxId }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);

  await findWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    projection: '_id',
  });

  const mailbox = await findMailboxInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    mailboxId,
  });

  if (!mailbox.isActive) {
    await assertWorkspaceMailboxWriteAllowed({
      workspaceId: workspaceObjectId,
    });

    mailbox.isActive = true;
    await mailbox.save();
  }

  await ensureWorkspaceDefaultMailbox({
    workspaceId: workspaceObjectId,
  });

  return {
    mailbox: buildMailboxActionView(mailbox),
  };
};

export const deactivateMailbox = async ({ workspaceId, mailboxId }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);

  await findWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    projection: '_id',
  });

  const mailbox = await findMailboxInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    mailboxId,
  });

  if (mailbox.isDefault) {
    throw createError('errors.mailbox.defaultCannotDeactivate', 409);
  }

  if (!mailbox.isActive) {
    return {
      mailbox: buildMailboxActionView(mailbox),
    };
  }

  const activeMailboxesCount = await Mailbox.countDocuments({
    workspaceId: workspaceObjectId,
    deletedAt: null,
    isActive: true,
  });

  if (activeMailboxesCount <= 1) {
    throw createError('errors.mailbox.lastActiveCannotDeactivate', 409);
  }

  mailbox.isActive = false;
  await mailbox.save();

  await ensureWorkspaceDefaultMailbox({
    workspaceId: workspaceObjectId,
  });

  return {
    mailbox: buildMailboxActionView(mailbox),
  };
};
