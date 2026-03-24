import { buildValidationError } from '../../../shared/middlewares/validate.js';
import { createError } from '../../../shared/errors/createError.js';
import { buildPagination } from '../../../shared/utils/pagination.js';
import { escapeRegex } from '../../../shared/utils/regex.js';
import {
  normalizeObjectId,
  toObjectIdIfValid,
} from '../../../shared/utils/object-id.js';
import { WORKSPACE_ROLES } from '../../../constants/workspace-roles.js';
import { Mailbox } from '../../mailboxes/models/mailbox.model.js';
import { Ticket } from '../../tickets/models/ticket.model.js';
import { Workspace } from '../../workspaces/models/workspace.model.js';
import { BusinessHours } from '../models/business-hours.model.js';
import { SlaPolicy } from '../models/sla-policy.model.js';
import {
  collectBusinessHoursScheduleIssues,
  isValidIanaTimezone,
  normalizeWeeklySchedule,
} from '../utils/business-hours.helpers.js';
import {
  buildRulesByPriorityView,
  collectSlaPolicyRulesIssues,
  normalizeProvidedRulesByPriority,
  normalizeRulesByPriority,
} from '../utils/sla-policy.helpers.js';
import {
  findBusinessHoursInWorkspaceOrThrow,
  findSlaPolicyInWorkspaceOrThrow,
} from './sla-reference.service.js';
import { deriveTicketSlaState } from './sla-ticket-runtime.service.js';

const ELEVATED_WORKSPACE_ROLES = new Set([
  WORKSPACE_ROLES.OWNER,
  WORKSPACE_ROLES.ADMIN,
]);

const BUSINESS_HOURS_SORT_ALLOWLIST = Object.freeze({
  name: { name: 1, _id: 1 },
  '-name': { name: -1, _id: 1 },
  createdAt: { createdAt: 1, _id: 1 },
  '-createdAt': { createdAt: -1, _id: 1 },
  updatedAt: { updatedAt: 1, _id: 1 },
  '-updatedAt': { updatedAt: -1, _id: 1 },
});

const SLA_POLICY_SORT_ALLOWLIST = Object.freeze({
  name: { name: 1, _id: 1 },
  '-name': { name: -1, _id: 1 },
  createdAt: { createdAt: 1, _id: 1 },
  '-createdAt': { createdAt: -1, _id: 1 },
  updatedAt: { updatedAt: 1, _id: 1 },
  '-updatedAt': { updatedAt: -1, _id: 1 },
});

const DEFAULT_BUSINESS_HOURS_SORT = {
  name: 1,
  _id: 1,
};

const DEFAULT_SLA_POLICY_SORT = {
  isDefault: -1,
  isActive: -1,
  createdAt: -1,
  _id: 1,
};

const BUSINESS_HOURS_PROJECTION = {
  _id: 1,
  workspaceId: 1,
  name: 1,
  timezone: 1,
  weeklySchedule: 1,
  createdAt: 1,
  updatedAt: 1,
};

const BUSINESS_HOURS_OPTIONS_PROJECTION = {
  _id: 1,
  name: 1,
  timezone: 1,
};

const BUSINESS_HOURS_SUMMARY_PROJECTION = {
  _id: 1,
  name: 1,
  timezone: 1,
};

const SLA_POLICY_PROJECTION = {
  _id: 1,
  workspaceId: 1,
  name: 1,
  isActive: 1,
  isDefault: 1,
  rulesByPriority: 1,
  businessHoursId: 1,
  createdAt: 1,
  updatedAt: 1,
};

const parseNullableBoolean = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();

  if (['1', 'true', 'yes'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no'].includes(normalized)) {
    return false;
  }

  return null;
};

const isElevatedWorkspaceRole = (roleKey) =>
  ELEVATED_WORKSPACE_ROLES.has(String(roleKey || '').toLowerCase());

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

const buildSearchClause = ({ q, fields }) => {
  const normalized = String(q || '').trim();

  if (!normalized) {
    return null;
  }

  const escaped = escapeRegex(normalized);

  return {
    $or: fields.map((field) => ({
      [field]: {
        $regex: escaped,
        $options: 'i',
      },
    })),
  };
};

const buildSort = ({ sort, allowlist, fallback }) =>
  allowlist[String(sort || '').trim()] || fallback;

const findWorkspaceOrThrow = async ({
  workspaceId,
  projection = '_id defaultSlaPolicyId',
}) => {
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

const buildBusinessHoursView = (businessHours) => ({
  _id: normalizeObjectId(businessHours._id),
  workspaceId: normalizeObjectId(businessHours.workspaceId),
  name: businessHours.name,
  timezone: businessHours.timezone,
  weeklySchedule: normalizeWeeklySchedule(businessHours.weeklySchedule || []),
  createdAt: businessHours.createdAt,
  updatedAt: businessHours.updatedAt,
});

const buildBusinessHoursOptionView = (businessHours) => ({
  _id: normalizeObjectId(businessHours._id),
  name: businessHours.name,
  timezone: businessHours.timezone,
});

const buildSlaPolicyView = ({
  policy,
  businessHoursById = new Map(),
  defaultPolicyId = null,
}) => {
  const policyId = normalizeObjectId(policy._id);
  const businessHours = policy.businessHoursId
    ? businessHoursById.get(String(policy.businessHoursId)) || null
    : null;

  return {
    _id: policyId,
    workspaceId: normalizeObjectId(policy.workspaceId),
    name: policy.name,
    isActive: Boolean(policy.isActive),
    isDefault: defaultPolicyId !== null && policyId === defaultPolicyId,
    businessHoursId: policy.businessHoursId
      ? normalizeObjectId(policy.businessHoursId)
      : null,
    businessHours: businessHours
      ? {
          _id: normalizeObjectId(businessHours._id),
          name: businessHours.name,
          timezone: businessHours.timezone,
        }
      : null,
    rulesByPriority: buildRulesByPriorityView(policy.rulesByPriority || {}),
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt,
  };
};

const buildSlaPolicyOptionView = ({ policy, defaultPolicyId = null }) => ({
  _id: normalizeObjectId(policy._id),
  name: policy.name,
  isActive: Boolean(policy.isActive),
  isDefault:
    defaultPolicyId !== null &&
    normalizeObjectId(policy._id) === String(defaultPolicyId),
});

const normalizeBusinessHoursCreatePayload = (payload = {}) => ({
  name: String(payload.name || '').trim(),
  timezone: String(payload.timezone || '').trim(),
  weeklySchedule: normalizeWeeklySchedule(payload.weeklySchedule || []),
});

const normalizeBusinessHoursUpdatePayload = (payload = {}) => {
  const normalized = {};

  if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
    normalized.name = String(payload.name || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'timezone')) {
    normalized.timezone = String(payload.timezone || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'weeklySchedule')) {
    normalized.weeklySchedule = normalizeWeeklySchedule(
      payload.weeklySchedule || []
    );
  }

  return normalized;
};

const normalizeSlaPolicyCreatePayload = (payload = {}) => ({
  name: String(payload.name || '').trim(),
  businessHoursId: normalizeNullableString(payload.businessHoursId),
  rulesByPriority: normalizeRulesByPriority(payload.rulesByPriority || {}),
});

const normalizeSlaPolicyUpdatePayload = (payload = {}) => {
  const normalized = {};

  if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
    normalized.name = String(payload.name || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'businessHoursId')) {
    normalized.businessHoursId = normalizeNullableString(
      payload.businessHoursId
    );
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'rulesByPriority')) {
    normalized.rulesByPriority = normalizeProvidedRulesByPriority(
      payload.rulesByPriority || {}
    );
  }

  return normalized;
};

const resolvePolicyVisibility = ({ roleKey, isActive, includeInactive }) => {
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

const buildBusinessHoursReferenceMap = async (policies) => {
  const businessHoursIds = [
    ...new Set(
      policies
        .map((policy) =>
          policy.businessHoursId ? String(policy.businessHoursId) : null
        )
        .filter(Boolean)
    ),
  ];
  const workspaceIds = [
    ...new Set(
      policies
        .map((policy) =>
          policy.workspaceId ? toObjectIdIfValid(policy.workspaceId) : null
        )
        .filter(Boolean)
    ),
  ];

  if (businessHoursIds.length === 0 || workspaceIds.length === 0) {
    return new Map();
  }

  const businessHours = await BusinessHours.find({
    _id: { $in: businessHoursIds },
    workspaceId: { $in: workspaceIds },
    deletedAt: null,
  })
    .select(BUSINESS_HOURS_SUMMARY_PROJECTION)
    .lean();

  return new Map(businessHours.map((item) => [String(item._id), item]));
};

const setWorkspaceDefaultSlaPolicyPointer = async ({
  workspaceId,
  policyId,
}) => {
  const updateResult = await Workspace.updateOne(
    {
      _id: toObjectIdIfValid(workspaceId),
      deletedAt: null,
    },
    {
      $set: {
        defaultSlaPolicyId: policyId ? toObjectIdIfValid(policyId) : null,
      },
    }
  );

  if (!updateResult?.matchedCount) {
    throw createError('errors.workspace.notFound', 404);
  }
};

const normalizeDefaultPolicyId = (value) =>
  value ? normalizeObjectId(value) : null;

const buildSlaPolicyActionView = ({ policy, defaultPolicyId = null }) => ({
  _id: normalizeObjectId(policy._id),
  name: policy.name,
  isActive: Boolean(policy.isActive),
  isDefault:
    defaultPolicyId !== null &&
    normalizeObjectId(policy._id) === String(defaultPolicyId),
});

const syncPolicyDefaultFlags = async ({ workspaceId, policyId = null }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const policyObjectId = policyId ? toObjectIdIfValid(policyId) : null;

  await SlaPolicy.updateMany(
    {
      workspaceId: workspaceObjectId,
      deletedAt: null,
      isDefault: true,
      ...(policyObjectId
        ? {
            _id: {
              $ne: policyObjectId,
            },
          }
        : {}),
    },
    {
      $set: {
        isDefault: false,
      },
    }
  );

  if (policyObjectId) {
    await SlaPolicy.updateOne(
      {
        _id: policyObjectId,
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
  }
};

const readCanonicalDefaultSlaPolicyState = async ({
  workspaceId,
  expectedPolicyId,
}) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const normalizedExpectedPolicyId =
    expectedPolicyId === undefined
      ? undefined
      : normalizeDefaultPolicyId(expectedPolicyId);

  const [workspace, defaultPolicies] = await Promise.all([
    Workspace.findOne({
      _id: workspaceObjectId,
      deletedAt: null,
    })
      .select('_id defaultSlaPolicyId')
      .lean(),
    SlaPolicy.find({
      workspaceId: workspaceObjectId,
      deletedAt: null,
      isDefault: true,
    })
      .select('_id isActive isDefault')
      .lean(),
  ]);

  const workspaceDefaultPolicyId = normalizeDefaultPolicyId(
    workspace?.defaultSlaPolicyId
  );

  const defaultPolicy =
    workspaceDefaultPolicyId === null
      ? null
      : await SlaPolicy.findOne({
          _id: toObjectIdIfValid(workspaceDefaultPolicyId),
          workspaceId: workspaceObjectId,
          deletedAt: null,
        })
          .select('_id isActive isDefault')
          .lean();

  const matchesExpected =
    normalizedExpectedPolicyId === undefined ||
    workspaceDefaultPolicyId === normalizedExpectedPolicyId;
  const hasMatchingDefaultFlags =
    workspaceDefaultPolicyId === null
      ? defaultPolicies.length === 0
      : defaultPolicies.length === 1 &&
        normalizeObjectId(defaultPolicies[0]._id) === workspaceDefaultPolicyId;
  const hasValidDefaultPolicy =
    workspaceDefaultPolicyId === null
      ? true
      : Boolean(defaultPolicy?.isDefault && defaultPolicy?.isActive);

  return {
    workspace,
    defaultPolicy,
    defaultPolicyId: workspaceDefaultPolicyId,
    isConsistent:
      Boolean(workspace) &&
      matchesExpected &&
      hasMatchingDefaultFlags &&
      hasValidDefaultPolicy,
  };
};

const repairCanonicalDefaultSlaPolicyState = async ({ workspaceId }) => {
  const workspace = await findWorkspaceOrThrow({
    workspaceId,
    projection: '_id defaultSlaPolicyId',
  });
  const workspaceObjectId = toObjectIdIfValid(workspaceId);

  let canonicalPolicyId = workspace.defaultSlaPolicyId
    ? toObjectIdIfValid(workspace.defaultSlaPolicyId)
    : null;

  if (canonicalPolicyId) {
    const targetPolicy = await SlaPolicy.findOne({
      _id: canonicalPolicyId,
      workspaceId: workspaceObjectId,
      deletedAt: null,
    })
      .select('_id isActive')
      .lean();

    if (!targetPolicy || !targetPolicy.isActive) {
      canonicalPolicyId = null;
      await setWorkspaceDefaultSlaPolicyPointer({
        workspaceId: workspaceObjectId,
        policyId: null,
      });
    }
  }

  await syncPolicyDefaultFlags({
    workspaceId: workspaceObjectId,
    policyId: canonicalPolicyId,
  });
};

const toSlaDefaultConflictError = (error) => {
  if (error?.statusCode) {
    return error;
  }

  return createError('errors.sla.defaultConflict', 409);
};

const applyCanonicalDefaultSlaPolicy = async ({ workspaceId, policyId }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const policyObjectId = policyId ? toObjectIdIfValid(policyId) : null;
  const normalizedPolicyId = normalizeDefaultPolicyId(policyObjectId);

  if (policyObjectId) {
    const targetPolicy = await SlaPolicy.findOne({
      _id: policyObjectId,
      workspaceId: workspaceObjectId,
      deletedAt: null,
    })
      .select('_id isActive')
      .lean();

    if (!targetPolicy) {
      throw createError('errors.sla.policyNotFound', 404);
    }

    if (!targetPolicy.isActive) {
      throw createError('errors.sla.policyInactive', 409);
    }
  }

  let syncError = null;

  try {
    await setWorkspaceDefaultSlaPolicyPointer({
      workspaceId: workspaceObjectId,
      policyId: policyObjectId,
    });
  } catch (error) {
    syncError = error;

    try {
      await setWorkspaceDefaultSlaPolicyPointer({
        workspaceId: workspaceObjectId,
        policyId: policyObjectId,
      });
    } catch {
      // Best-effort retry only. Final read-back decides the outcome.
    }
  }

  try {
    await syncPolicyDefaultFlags({
      workspaceId: workspaceObjectId,
      policyId: policyObjectId,
    });
  } catch (error) {
    if (!syncError) {
      syncError = error;
    }
  }

  let state = await readCanonicalDefaultSlaPolicyState({
    workspaceId: workspaceObjectId,
    expectedPolicyId: normalizedPolicyId,
  });

  if (!state.isConsistent) {
    try {
      await repairCanonicalDefaultSlaPolicyState({
        workspaceId: workspaceObjectId,
      });
    } catch (error) {
      if (!syncError) {
        syncError = error;
      }
    }

    state = await readCanonicalDefaultSlaPolicyState({
      workspaceId: workspaceObjectId,
      expectedPolicyId: normalizedPolicyId,
    });
  }

  if (!state.isConsistent) {
    throw toSlaDefaultConflictError(syncError);
  }

  return state;
};

const clearPolicyAssignments = async ({ workspaceId, policyId }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const policyObjectId = toObjectIdIfValid(policyId);

  const mailboxUpdateResult = await Mailbox.updateMany(
    {
      workspaceId: workspaceObjectId,
      deletedAt: null,
      slaPolicyId: policyObjectId,
    },
    {
      $set: {
        slaPolicyId: null,
      },
    }
  );

  const workspaceDefaultClearResult = await Workspace.updateOne(
    {
      _id: workspaceObjectId,
      deletedAt: null,
      defaultSlaPolicyId: policyObjectId,
    },
    {
      $set: {
        defaultSlaPolicyId: null,
      },
    }
  );

  return {
    clearedMailboxOverridesCount: mailboxUpdateResult?.modifiedCount || 0,
    clearedWorkspaceDefault:
      (workspaceDefaultClearResult?.modifiedCount || 0) > 0,
  };
};

export const validateBusinessHoursPayload = (payload, { requireAllFields }) => {
  const issues = [];

  if (
    requireAllFields ||
    Object.prototype.hasOwnProperty.call(payload || {}, 'timezone')
  ) {
    if (!isValidIanaTimezone(payload?.timezone)) {
      issues.push(
        buildValidationError('timezone', 'errors.validation.invalidTimezone')
      );
    }
  }

  if (
    requireAllFields ||
    Object.prototype.hasOwnProperty.call(payload || {}, 'weeklySchedule')
  ) {
    issues.push(
      ...collectBusinessHoursScheduleIssues(payload?.weeklySchedule).map(
        (issue) => buildValidationError(issue.field, issue.messageKey)
      )
    );
  }

  return issues;
};

export const validateSlaPolicyPayload = (payload, { requireAllFields }) => {
  const issues = [];

  if (
    requireAllFields ||
    Object.prototype.hasOwnProperty.call(payload || {}, 'rulesByPriority')
  ) {
    issues.push(
      ...collectSlaPolicyRulesIssues(payload?.rulesByPriority, {
        requireAtLeastOneRule: true,
        requireAllPriorities: requireAllFields,
      }).map((issue) => buildValidationError(issue.field, issue.messageKey))
    );
  }

  return issues;
};

export const listBusinessHours = async ({
  workspaceId,
  page = 1,
  limit = 20,
  q = null,
  search = null,
  sort = null,
}) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (safePage - 1) * safeLimit;
  const query = {
    workspaceId: toObjectIdIfValid(workspaceId),
    deletedAt: null,
  };

  const searchClause = buildSearchClause({
    q: q || search,
    fields: ['name', 'timezone'],
  });

  if (searchClause) {
    Object.assign(query, searchClause);
  }

  const [total, businessHours] = await Promise.all([
    BusinessHours.countDocuments(query),
    BusinessHours.find(query)
      .sort(
        buildSort({
          sort,
          allowlist: BUSINESS_HOURS_SORT_ALLOWLIST,
          fallback: DEFAULT_BUSINESS_HOURS_SORT,
        })
      )
      .skip(skip)
      .limit(safeLimit)
      .select(BUSINESS_HOURS_PROJECTION)
      .lean(),
  ]);

  return {
    ...buildPagination({
      page: safePage,
      limit: safeLimit,
      total,
      results: businessHours.length,
    }),
    businessHours: businessHours.map((item) => buildBusinessHoursView(item)),
  };
};

export const listBusinessHoursOptions = async ({
  workspaceId,
  q = null,
  search = null,
  limit = 20,
}) => {
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const query = {
    workspaceId: toObjectIdIfValid(workspaceId),
    deletedAt: null,
  };

  const searchClause = buildSearchClause({
    q: q || search,
    fields: ['name', 'timezone'],
  });

  if (searchClause) {
    Object.assign(query, searchClause);
  }

  const options = await BusinessHours.find(query)
    .sort({ name: 1, _id: 1 })
    .limit(safeLimit)
    .select(BUSINESS_HOURS_OPTIONS_PROJECTION)
    .lean();

  return {
    options: options.map((item) => buildBusinessHoursOptionView(item)),
  };
};

export const getBusinessHoursById = async ({
  workspaceId,
  businessHoursId,
}) => {
  const businessHours = await findBusinessHoursInWorkspaceOrThrow({
    workspaceId,
    businessHoursId,
    projection: BUSINESS_HOURS_PROJECTION,
  });

  return {
    businessHours: buildBusinessHoursView(
      businessHours.toObject ? businessHours.toObject() : businessHours
    ),
  };
};

export const createBusinessHours = async ({ workspaceId, payload }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const normalized = normalizeBusinessHoursCreatePayload(payload);

  await findWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    projection: '_id',
  });

  const businessHours = await BusinessHours.create({
    workspaceId: workspaceObjectId,
    ...normalized,
  });

  return {
    businessHours: buildBusinessHoursView(businessHours),
  };
};

export const updateBusinessHours = async ({
  workspaceId,
  businessHoursId,
  payload,
}) => {
  const businessHours = await findBusinessHoursInWorkspaceOrThrow({
    workspaceId,
    businessHoursId,
  });
  const normalized = normalizeBusinessHoursUpdatePayload(payload);

  for (const [key, value] of Object.entries(normalized)) {
    businessHours[key] = value;
  }

  await businessHours.save();

  return {
    businessHours: buildBusinessHoursView(businessHours),
  };
};

export const listSlaPolicies = async ({
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
  const effectiveIsActive = resolvePolicyVisibility({
    roleKey,
    isActive,
    includeInactive,
  });

  const query = {
    workspaceId: toObjectIdIfValid(workspaceId),
    deletedAt: null,
  };

  if (effectiveIsActive !== null) {
    query.isActive = effectiveIsActive;
  }

  const searchClause = buildSearchClause({
    q: q || search,
    fields: ['name'],
  });

  if (searchClause) {
    Object.assign(query, searchClause);
  }

  const [workspace, total, policies] = await Promise.all([
    findWorkspaceOrThrow({
      workspaceId,
      projection: '_id defaultSlaPolicyId',
    }),
    SlaPolicy.countDocuments(query),
    SlaPolicy.find(query)
      .sort(
        buildSort({
          sort,
          allowlist: SLA_POLICY_SORT_ALLOWLIST,
          fallback: DEFAULT_SLA_POLICY_SORT,
        })
      )
      .skip(skip)
      .limit(safeLimit)
      .select(SLA_POLICY_PROJECTION)
      .lean(),
  ]);

  const businessHoursById = await buildBusinessHoursReferenceMap(policies);
  const defaultPolicyId = workspace.defaultSlaPolicyId
    ? String(workspace.defaultSlaPolicyId)
    : null;

  return {
    ...buildPagination({
      page: safePage,
      limit: safeLimit,
      total,
      results: policies.length,
    }),
    policies: policies.map((policy) =>
      buildSlaPolicyView({
        policy,
        businessHoursById,
        defaultPolicyId,
      })
    ),
  };
};

export const listSlaPolicyOptions = async ({
  workspaceId,
  roleKey,
  q = null,
  search = null,
  isActive = null,
  includeInactive = null,
  limit = 20,
}) => {
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const effectiveIsActive = resolvePolicyVisibility({
    roleKey,
    isActive,
    includeInactive,
  });

  const query = {
    workspaceId: toObjectIdIfValid(workspaceId),
    deletedAt: null,
  };

  if (effectiveIsActive !== null) {
    query.isActive = effectiveIsActive;
  }

  const searchClause = buildSearchClause({
    q: q || search,
    fields: ['name'],
  });

  if (searchClause) {
    Object.assign(query, searchClause);
  }

  const [workspace, policies] = await Promise.all([
    findWorkspaceOrThrow({
      workspaceId,
      projection: '_id defaultSlaPolicyId',
    }),
    SlaPolicy.find(query)
      .sort({ isDefault: -1, isActive: -1, name: 1, _id: 1 })
      .limit(safeLimit)
      .select('_id name isActive')
      .lean(),
  ]);

  const defaultPolicyId = workspace.defaultSlaPolicyId
    ? String(workspace.defaultSlaPolicyId)
    : null;

  return {
    options: policies.map((policy) =>
      buildSlaPolicyOptionView({
        policy,
        defaultPolicyId,
      })
    ),
  };
};

export const getSlaPolicyById = async ({ workspaceId, policyId, roleKey }) => {
  const policy = await findSlaPolicyInWorkspaceOrThrow({
    workspaceId,
    policyId,
    projection: SLA_POLICY_PROJECTION,
  });

  if (!isElevatedWorkspaceRole(roleKey) && !policy.isActive) {
    throw createError('errors.sla.policyNotFound', 404);
  }

  const [workspace, businessHoursById] = await Promise.all([
    findWorkspaceOrThrow({
      workspaceId,
      projection: '_id defaultSlaPolicyId',
    }),
    buildBusinessHoursReferenceMap([policy]),
  ]);

  return {
    policy: buildSlaPolicyView({
      policy: policy.toObject ? policy.toObject() : policy,
      businessHoursById,
      defaultPolicyId: workspace.defaultSlaPolicyId
        ? String(workspace.defaultSlaPolicyId)
        : null,
    }),
  };
};

export const createSlaPolicy = async ({ workspaceId, payload }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const normalized = normalizeSlaPolicyCreatePayload(payload);

  await findWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    projection: '_id',
  });

  const businessHours = await findBusinessHoursInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    businessHoursId: normalized.businessHoursId,
    projection: BUSINESS_HOURS_SUMMARY_PROJECTION,
  });

  const policy = await SlaPolicy.create({
    workspaceId: workspaceObjectId,
    name: normalized.name,
    businessHoursId: businessHours._id,
    rulesByPriority: normalized.rulesByPriority,
    isActive: true,
    isDefault: false,
  });

  return {
    policy: buildSlaPolicyView({
      policy,
      businessHoursById: new Map([[String(businessHours._id), businessHours]]),
      defaultPolicyId: null,
    }),
  };
};

export const updateSlaPolicy = async ({ workspaceId, policyId, payload }) => {
  const policy = await findSlaPolicyInWorkspaceOrThrow({
    workspaceId,
    policyId,
  });
  const normalized = normalizeSlaPolicyUpdatePayload(payload);

  if (Object.prototype.hasOwnProperty.call(normalized, 'name')) {
    policy.name = normalized.name;
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'businessHoursId')) {
    const businessHours = await findBusinessHoursInWorkspaceOrThrow({
      workspaceId,
      businessHoursId: normalized.businessHoursId,
    });
    policy.businessHoursId = businessHours._id;
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'rulesByPriority')) {
    const currentRules =
      policy.rulesByPriority?.toObject?.() || policy.rulesByPriority || {};
    policy.rulesByPriority = {
      ...normalizeRulesByPriority(currentRules),
      ...normalized.rulesByPriority,
    };
  }

  const mergedRulesForValidation =
    policy.rulesByPriority?.toObject?.() || policy.rulesByPriority || {};
  const mergedRulesIssues = collectSlaPolicyRulesIssues(
    mergedRulesForValidation,
    {
      requireAtLeastOneRule: true,
      requireAllPriorities: true,
    }
  );

  if (mergedRulesIssues.length > 0) {
    throw createError(
      'errors.validation.failed',
      422,
      mergedRulesIssues.map((issue) =>
        buildValidationError(issue.field, issue.messageKey)
      )
    );
  }

  await policy.save();

  return getSlaPolicyById({
    workspaceId,
    policyId: policy._id,
    roleKey: WORKSPACE_ROLES.OWNER,
  });
};

export const activateSlaPolicy = async ({ workspaceId, policyId }) => {
  const workspace = await findWorkspaceOrThrow({
    workspaceId,
    projection: '_id defaultSlaPolicyId',
  });
  const policy = await findSlaPolicyInWorkspaceOrThrow({
    workspaceId,
    policyId,
  });

  if (!policy.isActive) {
    policy.isActive = true;
    await policy.save();
  }

  return {
    policy: buildSlaPolicyActionView({
      policy,
      defaultPolicyId: normalizeDefaultPolicyId(workspace.defaultSlaPolicyId),
    }),
  };
};

export const deactivateSlaPolicy = async ({
  workspaceId,
  policyId,
  replacementPolicyId = null,
}) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const workspace = await findWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    projection: '_id defaultSlaPolicyId',
  });
  const policy = await findSlaPolicyInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    policyId,
  });
  const normalizedReplacementPolicyId = normalizeNullableString(
    replacementPolicyId
  );
  const policyObjectIdString = normalizeObjectId(policy._id);
  const isWorkspaceDefaultPolicy =
    workspace.defaultSlaPolicyId?.toString?.() === policyObjectIdString;

  let replacementPolicy = null;

  if (normalizedReplacementPolicyId) {
    if (normalizedReplacementPolicyId === policyObjectIdString) {
      throw createError('errors.validation.failed', 422, [
        buildValidationError(
          'replacementPolicyId',
          'errors.sla.replacementPolicyMustDiffer'
        ),
      ]);
    }

    replacementPolicy = await findSlaPolicyInWorkspaceOrThrow({
      workspaceId: workspaceObjectId,
      policyId: normalizedReplacementPolicyId,
      requireActive: true,
    });
  }

  let deactivationImpact = {
    clearedWorkspaceDefault: false,
    clearedMailboxOverridesCount: 0,
    replacementPolicyId: null,
    replacementPolicyName: null,
    requiresDefaultReplacement: false,
  };

  if (policy.isActive) {
    policy.isActive = false;
    policy.isDefault = false;
    await policy.save();

    const clearedAssignments = await clearPolicyAssignments({
      workspaceId: workspaceObjectId,
      policyId: policy._id,
    });
    deactivationImpact = {
      ...deactivationImpact,
      ...clearedAssignments,
    };

    if (deactivationImpact.clearedWorkspaceDefault && replacementPolicy) {
      const state = await applyCanonicalDefaultSlaPolicy({
        workspaceId: workspaceObjectId,
        policyId: replacementPolicy._id,
      });
      deactivationImpact.clearedWorkspaceDefault = false;
      policy.isDefault = false;
      replacementPolicy.isDefault =
        state.defaultPolicyId === normalizeObjectId(replacementPolicy._id);
      deactivationImpact.replacementPolicyId = normalizeObjectId(
        replacementPolicy._id
      );
      deactivationImpact.replacementPolicyName = replacementPolicy.name;
    } else if (deactivationImpact.clearedWorkspaceDefault) {
      await applyCanonicalDefaultSlaPolicy({
        workspaceId: workspaceObjectId,
        policyId: null,
      });
    } else {
      await repairCanonicalDefaultSlaPolicyState({
        workspaceId: workspaceObjectId,
      });
    }

    deactivationImpact = {
      ...deactivationImpact,
      requiresDefaultReplacement:
        deactivationImpact.clearedWorkspaceDefault && !replacementPolicy,
    };
  } else {
    if (isWorkspaceDefaultPolicy) {
      if (replacementPolicy) {
        const state = await applyCanonicalDefaultSlaPolicy({
          workspaceId: workspaceObjectId,
          policyId: replacementPolicy._id,
        });
        replacementPolicy.isDefault =
          state.defaultPolicyId === normalizeObjectId(replacementPolicy._id);
        deactivationImpact.replacementPolicyId = normalizeObjectId(
          replacementPolicy._id
        );
        deactivationImpact.replacementPolicyName = replacementPolicy.name;
      } else {
        await applyCanonicalDefaultSlaPolicy({
          workspaceId: workspaceObjectId,
          policyId: null,
        });
        deactivationImpact.clearedWorkspaceDefault = true;
      }
    } else {
      await repairCanonicalDefaultSlaPolicyState({
        workspaceId: workspaceObjectId,
      });
    }

    deactivationImpact = {
      ...deactivationImpact,
      requiresDefaultReplacement:
        deactivationImpact.clearedWorkspaceDefault && !replacementPolicy,
    };
  }

  const finalState = await readCanonicalDefaultSlaPolicyState({
    workspaceId: workspaceObjectId,
  });
  policy.isDefault =
    normalizeObjectId(policy._id) ===
    normalizeDefaultPolicyId(finalState.workspace?.defaultSlaPolicyId);

  return {
    policy: buildSlaPolicyActionView({
      policy,
      defaultPolicyId: finalState.defaultPolicyId,
    }),
    deactivationImpact,
  };
};

export const setDefaultSlaPolicy = async ({ workspaceId, policyId }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const policy = await findSlaPolicyInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    policyId,
    requireActive: true,
  });

  const state = await applyCanonicalDefaultSlaPolicy({
    workspaceId: workspaceObjectId,
    policyId: policy._id,
  });
  policy.isDefault = state.defaultPolicyId === normalizeObjectId(policy._id);
  policy.isActive = true;

  return {
    policy: buildSlaPolicyActionView({
      policy,
      defaultPolicyId: state.defaultPolicyId,
    }),
  };
};

export const getSlaSummary = async ({ workspaceId }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const now = new Date();
  const [
    workspace,
    businessHoursTotal,
    policyTotal,
    activePolicyTotal,
    mailboxTotal,
    tickets,
  ] = await Promise.all([
    findWorkspaceOrThrow({
      workspaceId: workspaceObjectId,
      projection: '_id defaultSlaPolicyId',
    }),
    BusinessHours.countDocuments({
      workspaceId: workspaceObjectId,
      deletedAt: null,
    }),
    SlaPolicy.countDocuments({
      workspaceId: workspaceObjectId,
      deletedAt: null,
    }),
    SlaPolicy.countDocuments({
      workspaceId: workspaceObjectId,
      deletedAt: null,
      isActive: true,
    }),
    Mailbox.countDocuments({
      workspaceId: workspaceObjectId,
      deletedAt: null,
    }),
    Ticket.find({
      workspaceId: workspaceObjectId,
      deletedAt: null,
    })
      .select('_id sla')
      .lean(),
  ]);

  const [mailboxesWithOverrideCount, defaultPolicy] = await Promise.all([
    Mailbox.countDocuments({
      workspaceId: workspaceObjectId,
      deletedAt: null,
      slaPolicyId: {
        $ne: null,
      },
    }),
    workspace.defaultSlaPolicyId
      ? SlaPolicy.findOne({
          _id: workspace.defaultSlaPolicyId,
          workspaceId: workspaceObjectId,
          deletedAt: null,
        })
          .select('_id name isActive')
          .lean()
      : null,
  ]);

  const runtimeCounts = tickets.reduce(
    (accumulator, ticket) => {
      const derived = deriveTicketSlaState({
        sla: ticket.sla,
        now,
      });

      accumulator.firstResponse[derived.firstResponseStatus] += 1;
      accumulator.resolution[derived.resolutionStatus] += 1;

      if (derived.isApplicable) {
        accumulator.applicableTicketCount += 1;
      }

      if (derived.isBreached) {
        accumulator.breachedTicketCount += 1;
      }

      return accumulator;
    },
    {
      applicableTicketCount: 0,
      breachedTicketCount: 0,
      firstResponse: {
        not_applicable: 0,
        pending: 0,
        met: 0,
        breached: 0,
      },
      resolution: {
        not_applicable: 0,
        running: 0,
        paused: 0,
        met: 0,
        breached: 0,
      },
    }
  );

  return {
    summary: {
      businessHours: {
        total: businessHoursTotal,
      },
      policies: {
        total: policyTotal,
        active: activePolicyTotal,
        inactive: Math.max(0, policyTotal - activePolicyTotal),
        defaultPolicyId: workspace.defaultSlaPolicyId
          ? normalizeObjectId(workspace.defaultSlaPolicyId)
          : null,
        defaultPolicyName: defaultPolicy?.name || null,
        defaultPolicyIsActive:
          defaultPolicy?.isActive === true ||
          (defaultPolicy === null && workspace.defaultSlaPolicyId === null),
      },
      mailboxes: {
        total: mailboxTotal,
        withOverrideCount: mailboxesWithOverrideCount,
        withoutOverrideCount: Math.max(
          0,
          mailboxTotal - mailboxesWithOverrideCount
        ),
      },
      runtime: {
        ticketLifecycleIntegrated: true,
        firstResponseEnabled: true,
        resolutionEnabled: true,
        applicableTicketCount: runtimeCounts.applicableTicketCount,
        breachedTicketCount: runtimeCounts.breachedTicketCount,
        firstResponse: runtimeCounts.firstResponse,
        resolution: runtimeCounts.resolution,
      },
    },
  };
};
