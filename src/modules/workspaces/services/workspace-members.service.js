import { MEMBER_STATUS } from '../../../constants/member-status.js';
import { WORKSPACE_ROLES } from '../../../constants/workspace-roles.js';
import { revokeUserWorkspaceSessions } from '../../auth/services/session.service.js';
import { assertWorkspaceMemberActivationAllowed } from '../../billing/services/billing-enforcement.service.js';
import { disconnectRealtimeSessionSocketsBatch } from '../../../infra/realtime/index.js';
import { createError } from '../../../shared/errors/createError.js';
import { buildPagination } from '../../../shared/utils/pagination.js';
import { escapeRegex } from '../../../shared/utils/regex.js';
import { toObjectIdIfValid } from '../../../shared/utils/object-id.js';
import { WorkspaceMember } from '../models/workspace-member.model.js';

const ELEVATED_ROLES = new Set([WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN]);
const ADMIN_MANAGEABLE_ROLES = new Set([
  WORKSPACE_ROLES.AGENT,
  WORKSPACE_ROLES.VIEWER,
]);
const EMAIL_VISIBLE_ROLES = new Set([
  WORKSPACE_ROLES.OWNER,
  WORKSPACE_ROLES.ADMIN,
  WORKSPACE_ROLES.AGENT,
]);
const ASSIGNABLE_ROLES = [
  WORKSPACE_ROLES.OWNER,
  WORKSPACE_ROLES.ADMIN,
  WORKSPACE_ROLES.AGENT,
];

const DEFAULT_LIST_SORT = { 'user.profile.name': 1, 'user.email': 1, _id: 1 };
const DEFAULT_SAFE_LIST_SORT = { 'user.profile.name': 1, _id: 1 };
const SORT_ALLOWLIST = Object.freeze({
  name: { 'user.profile.name': 1, 'user.email': 1, _id: 1 },
  '-name': { 'user.profile.name': -1, 'user.email': -1, _id: 1 },
  email: { 'user.email': 1, _id: 1 },
  '-email': { 'user.email': -1, _id: 1 },
  createdAt: { createdAt: 1, _id: 1 },
  '-createdAt': { createdAt: -1, _id: 1 },
  joinedAt: { joinedAt: 1, _id: 1 },
  '-joinedAt': { joinedAt: -1, _id: 1 },
});

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

const isElevatedRole = (roleKey) => ELEVATED_ROLES.has(roleKey);
const isAdminManageableRole = (roleKey) => ADMIN_MANAGEABLE_ROLES.has(roleKey);
const canSeeEmail = (roleKey) => EMAIL_VISIBLE_ROLES.has(roleKey);
const normalizeSearch = ({ q = null, search = null } = {}) =>
  String(q || search || '').trim();

export const buildWorkspaceMemberSort = ({ sort, actorRoleKey }) => {
  const normalizedSort = String(sort || '').trim();

  if (canSeeEmail(actorRoleKey)) {
    return SORT_ALLOWLIST[normalizedSort] || DEFAULT_LIST_SORT;
  }

  if (normalizedSort === '-name') {
    return { 'user.profile.name': -1, _id: 1 };
  }

  if (
    normalizedSort === 'createdAt' ||
    normalizedSort === '-createdAt' ||
    normalizedSort === 'joinedAt' ||
    normalizedSort === '-joinedAt'
  ) {
    return SORT_ALLOWLIST[normalizedSort];
  }

  return DEFAULT_SAFE_LIST_SORT;
};

const resolveStatusFilter = ({ actorRoleKey, status, includeRemoved }) => {
  if (!isElevatedRole(actorRoleKey)) {
    return MEMBER_STATUS.ACTIVE;
  }

  if (status) {
    return status;
  }

  return parseNullableBoolean(includeRemoved) === true
    ? null
    : MEMBER_STATUS.ACTIVE;
};

const buildDeletedAtMatch = ({
  effectiveStatus,
  includeRemoved,
  actorRoleKey,
}) => {
  const includesRemoved =
    isElevatedRole(actorRoleKey) &&
    (effectiveStatus === MEMBER_STATUS.REMOVED ||
      (!effectiveStatus && parseNullableBoolean(includeRemoved) === true));

  if (includesRemoved) {
    return {
      $or: [{ deletedAt: null }, { status: MEMBER_STATUS.REMOVED }],
    };
  }

  return { deletedAt: null };
};

const buildBaseMatch = ({
  workspaceId,
  actorRoleKey,
  roleKey = null,
  status = null,
  includeRemoved = null,
  assignable = null,
  participantEligible = null,
}) => {
  const effectiveStatus = resolveStatusFilter({
    actorRoleKey,
    status,
    includeRemoved,
  });

  const match = {
    workspaceId: toObjectIdIfValid(workspaceId),
    ...buildDeletedAtMatch({ effectiveStatus, includeRemoved, actorRoleKey }),
  };

  if (effectiveStatus) {
    match.status = effectiveStatus;
  }

  const requireSelectable =
    parseNullableBoolean(assignable) === true ||
    parseNullableBoolean(participantEligible) === true;

  if (requireSelectable) {
    match.status = MEMBER_STATUS.ACTIVE;
  }

  if (parseNullableBoolean(assignable) === true) {
    match.roleKey = {
      $in: roleKey
        ? ASSIGNABLE_ROLES.filter(
            (assignableRole) => assignableRole === roleKey
          )
        : ASSIGNABLE_ROLES,
    };
  } else if (roleKey) {
    match.roleKey = roleKey;
  }

  return match;
};

export const buildWorkspaceMemberActionView = (member) => {
  const view = {
    userId: String(member.userId),
    roleKey: member.roleKey,
    memberStatus: member.status,
  };

  if (member.status === MEMBER_STATUS.REMOVED) {
    view.removedAt = member.removedAt || null;
  }

  return view;
};

export const assertWorkspaceMemberAuthority = ({
  actorUserId,
  actorRoleKey,
  targetUserId,
  targetRoleKey,
  nextRoleKey = null,
}) => {
  if (String(actorUserId) === String(targetUserId)) {
    throw createError('errors.workspace.cannotManageSelf', 403);
  }

  if (actorRoleKey === WORKSPACE_ROLES.OWNER) {
    return true;
  }

  if (actorRoleKey !== WORKSPACE_ROLES.ADMIN) {
    throw createError('errors.auth.forbiddenRole', 403);
  }

  const canManageTarget = isAdminManageableRole(targetRoleKey);
  const canAssignRole = !nextRoleKey || isAdminManageableRole(nextRoleKey);

  if (!canManageTarget || !canAssignRole) {
    throw createError('errors.workspace.cannotManageRole', 403);
  }

  return true;
};

export const assertLastOwnerSafety = async ({
  workspaceId,
  targetRoleKey,
  targetStatus,
  nextRoleKey = targetRoleKey,
  nextStatus = targetStatus,
}) => {
  const targetIsActiveOwner =
    targetRoleKey === WORKSPACE_ROLES.OWNER &&
    targetStatus === MEMBER_STATUS.ACTIVE;
  const targetRemainsActiveOwner =
    nextRoleKey === WORKSPACE_ROLES.OWNER &&
    nextStatus === MEMBER_STATUS.ACTIVE;

  if (!targetIsActiveOwner || targetRemainsActiveOwner) {
    return true;
  }

  const activeOwnerCount = await WorkspaceMember.countDocuments({
    workspaceId: toObjectIdIfValid(workspaceId),
    roleKey: WORKSPACE_ROLES.OWNER,
    status: MEMBER_STATUS.ACTIVE,
    deletedAt: null,
  });

  if (activeOwnerCount <= 1) {
    throw createError('errors.workspace.lastOwnerRequired', 409);
  }

  return true;
};

const findMemberForActionOrThrow = async ({ workspaceId, userId }) => {
  const member = await WorkspaceMember.findOne({
    workspaceId: toObjectIdIfValid(workspaceId),
    userId: toObjectIdIfValid(userId),
    $or: [{ deletedAt: null }, { status: MEMBER_STATUS.REMOVED }],
  });

  if (!member) {
    throw createError('errors.workspace.memberNotFound', 404);
  }

  return member;
};

const invalidateAffectedWorkspaceSessions = async ({ workspaceId, userId }) => {
  const revokedSessionIds = await revokeUserWorkspaceSessions({
    workspaceId,
    userId,
  });

  try {
    await disconnectRealtimeSessionSocketsBatch({
      sessionIds: revokedSessionIds,
    });
  } catch (error) {
    console.warn('Workspace member realtime disconnect failed:', {
      workspaceId: String(workspaceId || ''),
      userId: String(userId || ''),
      error: error?.message || 'unknown',
    });
  }

  return revokedSessionIds;
};

const assertNotRemoved = (member) => {
  if (member.status === MEMBER_STATUS.REMOVED) {
    throw createError('errors.workspace.memberRemoved', 409);
  }
};

const buildUserMatch = ({
  actorRoleKey,
  q = null,
  search = null,
  assignable = null,
  participantEligible = null,
}) => {
  const match = {
    'user.deletedAt': null,
  };

  const requireSelectable =
    parseNullableBoolean(assignable) === true ||
    parseNullableBoolean(participantEligible) === true;

  if (requireSelectable) {
    match['user.status'] = 'active';
  }

  const normalizedSearch = normalizeSearch({ q, search });
  if (normalizedSearch) {
    const escaped = escapeRegex(normalizedSearch);
    const clauses = [
      { 'user.profile.name': { $regex: escaped, $options: 'i' } },
    ];

    if (canSeeEmail(actorRoleKey)) {
      clauses.push(
        { 'user.email': { $regex: escaped, $options: 'i' } },
        { 'user.emailNormalized': { $regex: escaped, $options: 'i' } }
      );
    }

    match.$or = clauses;
  }

  return match;
};

const buildMembersPipeline = ({
  workspaceId,
  actorRoleKey,
  page = 1,
  limit = 20,
  q = null,
  search = null,
  roleKey = null,
  status = null,
  assignable = null,
  participantEligible = null,
  includeRemoved = null,
  sort = null,
  paginate = true,
}) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(
    paginate ? 100 : 50,
    Math.max(1, Number(limit) || 20)
  );
  const skip = (safePage - 1) * safeLimit;
  const baseMatch = buildBaseMatch({
    workspaceId,
    actorRoleKey,
    roleKey,
    status,
    includeRemoved,
    assignable,
    participantEligible,
  });
  const userMatch = buildUserMatch({
    actorRoleKey,
    q,
    search,
    assignable,
    participantEligible,
  });

  const dataPipeline = [
    { $match: baseMatch },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: '$user' },
    { $match: userMatch },
    { $sort: buildWorkspaceMemberSort({ sort, actorRoleKey }) },
  ];

  if (paginate) {
    dataPipeline.push({ $skip: skip });
  }
  dataPipeline.push({ $limit: safeLimit });

  return {
    safePage,
    safeLimit,
    dataPipeline,
    countPipeline: [
      { $match: baseMatch },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: '$user' },
      { $match: userMatch },
      { $count: 'total' },
    ],
  };
};

export const buildWorkspaceMemberSummary = ({
  member,
  actorRoleKey,
  compact = false,
}) => {
  const user = member.user || {};
  const userSummary = {
    _id: String(user._id || member.userId),
    name: user.profile?.name || null,
    avatar: user.profile?.avatar || null,
    status: user.status || null,
  };

  if (canSeeEmail(actorRoleKey)) {
    userSummary.email = user.email || null;
  }

  if (compact) {
    const option = {
      userId: String(member.userId),
      roleKey: member.roleKey,
      memberStatus: member.status,
      name: userSummary.name,
      avatar: userSummary.avatar,
    };

    if (canSeeEmail(actorRoleKey)) {
      option.email = userSummary.email;
    }

    return option;
  }

  const view = {
    _id: String(member._id),
    workspaceId: String(member.workspaceId),
    userId: String(member.userId),
    roleKey: member.roleKey,
    memberStatus: member.status,
    joinedAt: member.joinedAt || null,
    user: userSummary,
  };

  if (member.status === MEMBER_STATUS.REMOVED && isElevatedRole(actorRoleKey)) {
    view.removedAt = member.removedAt || null;
  }

  return view;
};

export const listWorkspaceMembers = async ({
  workspaceId,
  actorRoleKey,
  page = 1,
  limit = 20,
  q = null,
  search = null,
  roleKey = null,
  status = null,
  assignable = null,
  participantEligible = null,
  includeRemoved = null,
  sort = null,
}) => {
  const { safePage, safeLimit, dataPipeline, countPipeline } =
    buildMembersPipeline({
      workspaceId,
      actorRoleKey,
      page,
      limit,
      q,
      search,
      roleKey,
      status,
      assignable,
      participantEligible,
      includeRemoved,
      sort,
    });

  const [countResult, members] = await Promise.all([
    WorkspaceMember.aggregate(countPipeline),
    WorkspaceMember.aggregate(dataPipeline),
  ]);
  const total = countResult[0]?.total || 0;

  return {
    ...buildPagination({
      page: safePage,
      limit: safeLimit,
      total,
      results: members.length,
    }),
    members: members.map((member) =>
      buildWorkspaceMemberSummary({ member, actorRoleKey })
    ),
  };
};

export const listWorkspaceMemberOptions = async ({
  workspaceId,
  actorRoleKey,
  q = null,
  search = null,
  roleKey = null,
  status = null,
  assignable = null,
  participantEligible = null,
  includeRemoved = null,
  limit = 20,
  sort = null,
}) => {
  const { dataPipeline } = buildMembersPipeline({
    workspaceId,
    actorRoleKey,
    limit,
    q,
    search,
    roleKey,
    status,
    assignable,
    participantEligible,
    includeRemoved,
    sort,
    paginate: false,
  });

  const members = await WorkspaceMember.aggregate(dataPipeline);

  return {
    results: members.length,
    members: members.map((member) =>
      buildWorkspaceMemberSummary({
        member,
        actorRoleKey,
        compact: true,
      })
    ),
  };
};

export const getWorkspaceMemberByUserId = async ({
  workspaceId,
  userId,
  actorRoleKey,
}) => {
  const deletedAtMatch = isElevatedRole(actorRoleKey)
    ? { $or: [{ deletedAt: null }, { status: MEMBER_STATUS.REMOVED }] }
    : { deletedAt: null };
  const statusMatch = isElevatedRole(actorRoleKey)
    ? {}
    : { status: MEMBER_STATUS.ACTIVE };

  const members = await WorkspaceMember.aggregate([
    {
      $match: {
        workspaceId: toObjectIdIfValid(workspaceId),
        userId: toObjectIdIfValid(userId),
        ...deletedAtMatch,
        ...statusMatch,
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: '$user' },
    { $match: { 'user.deletedAt': null } },
    { $limit: 1 },
  ]);

  const member = members[0];
  if (!member) {
    throw createError('errors.workspace.memberNotFound', 404);
  }

  return {
    member: buildWorkspaceMemberSummary({ member, actorRoleKey }),
  };
};

export const updateWorkspaceMemberRole = async ({
  workspaceId,
  userId,
  actorUserId,
  actorRoleKey,
  roleKey,
}) => {
  const member = await findMemberForActionOrThrow({ workspaceId, userId });
  assertNotRemoved(member);

  assertWorkspaceMemberAuthority({
    actorUserId,
    actorRoleKey,
    targetUserId: member.userId,
    targetRoleKey: member.roleKey,
    nextRoleKey: roleKey,
  });

  await assertLastOwnerSafety({
    workspaceId,
    targetRoleKey: member.roleKey,
    targetStatus: member.status,
    nextRoleKey: roleKey,
    nextStatus: member.status,
  });

  const changed = member.roleKey !== roleKey;
  if (changed) {
    member.roleKey = roleKey;
    await member.save();
    await invalidateAffectedWorkspaceSessions({
      workspaceId,
      userId: member.userId,
    });
  }

  return {
    member: buildWorkspaceMemberActionView(member),
  };
};

export const suspendWorkspaceMember = async ({
  workspaceId,
  userId,
  actorUserId,
  actorRoleKey,
}) => {
  const member = await findMemberForActionOrThrow({ workspaceId, userId });
  assertNotRemoved(member);

  assertWorkspaceMemberAuthority({
    actorUserId,
    actorRoleKey,
    targetUserId: member.userId,
    targetRoleKey: member.roleKey,
  });

  await assertLastOwnerSafety({
    workspaceId,
    targetRoleKey: member.roleKey,
    targetStatus: member.status,
    nextRoleKey: member.roleKey,
    nextStatus: MEMBER_STATUS.SUSPENDED,
  });

  const changed = member.status !== MEMBER_STATUS.SUSPENDED;
  if (changed) {
    member.status = MEMBER_STATUS.SUSPENDED;
    member.removedAt = null;
    member.deletedAt = null;
    member.deletedByUserId = null;
    await member.save();
    await invalidateAffectedWorkspaceSessions({
      workspaceId,
      userId: member.userId,
    });
  }

  return {
    member: buildWorkspaceMemberActionView(member),
  };
};

export const activateWorkspaceMember = async ({
  workspaceId,
  userId,
  actorUserId,
  actorRoleKey,
}) => {
  const member = await findMemberForActionOrThrow({ workspaceId, userId });

  if (member.status === MEMBER_STATUS.REMOVED) {
    throw createError('errors.workspace.memberRemoved', 409);
  }

  assertWorkspaceMemberAuthority({
    actorUserId,
    actorRoleKey,
    targetUserId: member.userId,
    targetRoleKey: member.roleKey,
  });

  const changed = member.status !== MEMBER_STATUS.ACTIVE;
  if (changed) {
    await assertWorkspaceMemberActivationAllowed({ workspaceId });

    member.status = MEMBER_STATUS.ACTIVE;
    member.removedAt = null;
    member.deletedAt = null;
    member.deletedByUserId = null;
    await member.save();
    await invalidateAffectedWorkspaceSessions({
      workspaceId,
      userId: member.userId,
    });
  }

  return {
    member: buildWorkspaceMemberActionView(member),
  };
};

export const removeWorkspaceMember = async ({
  workspaceId,
  userId,
  actorUserId,
  actorRoleKey,
}) => {
  const member = await findMemberForActionOrThrow({ workspaceId, userId });

  assertWorkspaceMemberAuthority({
    actorUserId,
    actorRoleKey,
    targetUserId: member.userId,
    targetRoleKey: member.roleKey,
  });

  await assertLastOwnerSafety({
    workspaceId,
    targetRoleKey: member.roleKey,
    targetStatus: member.status,
    nextRoleKey: member.roleKey,
    nextStatus: MEMBER_STATUS.REMOVED,
  });

  const changed = member.status !== MEMBER_STATUS.REMOVED;
  if (changed) {
    const now = new Date();
    member.status = MEMBER_STATUS.REMOVED;
    member.removedAt = now;
    member.deletedAt = now;
    member.deletedByUserId = toObjectIdIfValid(actorUserId);
    await member.save();
    await invalidateAffectedWorkspaceSessions({
      workspaceId,
      userId: member.userId,
    });
  } else {
    let needsSave = false;
    if (!member.removedAt) {
      member.removedAt = new Date();
      needsSave = true;
    }
    if (!member.deletedAt) {
      member.deletedAt = member.removedAt;
      needsSave = true;
    }
    if (!member.deletedByUserId && actorUserId) {
      member.deletedByUserId = toObjectIdIfValid(actorUserId);
      needsSave = true;
    }
    if (needsSave) {
      await member.save();
    }
  }

  return {
    member: buildWorkspaceMemberActionView(member),
  };
};
