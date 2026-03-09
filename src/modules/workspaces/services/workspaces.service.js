import bcrypt from 'bcryptjs';
import { Workspace } from '../models/workspace.model.js';
import { WorkspaceInvite } from '../models/workspace-invite.model.js';
import { WorkspaceMember } from '../models/workspace-member.model.js';
import { User } from '../../users/models/user.model.js';
import { Session } from '../../users/models/session.model.js';
import { MEMBER_STATUS } from '../../../constants/member-status.js';
import { WORKSPACE_ROLES } from '../../../constants/workspace-roles.js';
import { INVITE_STATUS } from '../../../constants/invite-status.js';
import { OTP_PURPOSE } from '../../../constants/otp-purpose.js';
import { createError } from '../../../shared/errors/createError.js';
import { buildValidationError } from '../../../shared/middlewares/validate.js';
import { normalizeEmail } from '../../../shared/utils/normalize.js';
import { buildPagination } from '../../../shared/utils/pagination.js';
import { authConfig } from '../../../config/auth.config.js';
import {
  generateSecureToken,
  hashValue,
} from '../../../shared/utils/security.js';
import {
  sendInviteEmail,
  sendOtpEmailFireAndForget,
} from '../../../shared/services/email.service.js';
import { createOtp } from '../../auth/services/otp.service.js';
import { mintAccessTokenForSession } from '../../auth/services/session.service.js';
import { ensureWorkspaceDefaultMailbox } from '../../mailboxes/services/mailboxes.service.js';

const oneDayMs = 24 * 60 * 60 * 1000;

const slugify = (value) => {
  const base = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return base || 'workspace';
};

const deriveWorkspaceName = (user) => {
  const profileName = user?.profile?.name?.trim();
  if (profileName) {
    return profileName.slice(0, 120);
  }

  const emailPrefix = String(user?.email || 'workspace')
    .split('@')[0]
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim();

  const fallback = emailPrefix || 'Workspace';
  return `${fallback} Workspace`.slice(0, 120);
};

const ensureUniqueSlug = async (baseValue) => {
  const baseSlug = slugify(baseValue);
  let candidate = baseSlug;
  let attempt = 2;

  while (
    await Workspace.exists({
      slug: candidate,
      deletedAt: null,
    })
  ) {
    candidate = `${baseSlug}-${attempt}`;
    attempt += 1;
  }

  return candidate;
};

const buildInviteView = (invite) => ({
  _id: invite._id,
  workspaceId: invite.workspaceId,
  email: invite.email,
  roleKey: invite.roleKey,
  status: invite.status,
  expiresAt: invite.expiresAt,
  acceptedAt: invite.acceptedAt,
  invitedByUserId: invite.invitedByUserId,
  createdAt: invite.createdAt,
  updatedAt: invite.updatedAt,
});

const buildWorkspaceView = (workspace) => ({
  _id: String(workspace._id),
  name: workspace.name,
  slug: workspace.slug,
  status: workspace.status,
});

const buildWorkspaceMembershipView = (workspace) => ({
  name: workspace.name,
  slug: workspace.slug,
  status: workspace.status,
});

const buildMembershipView = ({ member, workspace, userId }) => ({
  workspaceId: String(workspace._id),
  workspace: buildWorkspaceMembershipView(workspace),
  roleKey: member.roleKey,
  memberStatus: member.status,
  isOwner:
    member.roleKey === WORKSPACE_ROLES.OWNER ||
    String(workspace.ownerUserId) === String(userId),
});

const findWorkspaceById = async (workspaceId) =>
  Workspace.findOne({
    _id: workspaceId,
    deletedAt: null,
  })
    .select('_id name slug status ownerUserId')
    .lean();

const findActiveMemberForWorkspace = async ({ userId, workspaceId }) =>
  WorkspaceMember.findOne({
    workspaceId,
    userId,
    status: MEMBER_STATUS.ACTIVE,
    deletedAt: null,
  })
    .select('_id workspaceId roleKey status')
    .lean();

const findActiveContextForWorkspace = async ({ userId, workspaceId }) => {
  if (!workspaceId) {
    return null;
  }

  const member = await findActiveMemberForWorkspace({ userId, workspaceId });
  if (!member) {
    return null;
  }

  const workspace = await findWorkspaceById(workspaceId);
  if (!workspace) {
    return null;
  }

  return buildMembershipView({ member, workspace, userId });
};

const listAllActiveMembershipContexts = async ({ userId }) => {
  const members = await WorkspaceMember.find({
    userId,
    status: MEMBER_STATUS.ACTIVE,
    deletedAt: null,
  })
    .sort({ createdAt: 1 })
    .select('_id workspaceId roleKey status')
    .lean();

  if (members.length === 0) {
    return [];
  }

  const workspaceIds = [
    ...new Set(members.map((item) => String(item.workspaceId))),
  ];
  const workspaces = await Workspace.find({
    _id: { $in: workspaceIds },
    deletedAt: null,
  })
    .select('_id name slug status ownerUserId')
    .lean();

  const workspaceById = new Map(
    workspaces.map((workspace) => [String(workspace._id), workspace])
  );

  return members
    .map((member) => {
      const workspace = workspaceById.get(String(member.workspaceId));
      if (!workspace) {
        return null;
      }

      return buildMembershipView({ member, workspace, userId });
    })
    .filter(Boolean);
};

const resolveActiveWorkspaceContext = async ({
  userId,
  sessionWorkspaceId = null,
}) => {
  const user = await User.findOne({
    _id: userId,
    deletedAt: null,
  })
    .select('_id defaultWorkspaceId lastWorkspaceId')
    .lean();

  if (!user) {
    throw createError('errors.auth.invalidToken', 401);
  }

  const candidates = [
    sessionWorkspaceId ? String(sessionWorkspaceId) : null,
    user.lastWorkspaceId ? String(user.lastWorkspaceId) : null,
    user.defaultWorkspaceId ? String(user.defaultWorkspaceId) : null,
  ].filter(Boolean);

  const seen = new Set();
  for (const workspaceId of candidates) {
    if (seen.has(workspaceId)) {
      continue;
    }

    seen.add(workspaceId);

    const context = await findActiveContextForWorkspace({
      userId,
      workspaceId,
    });
    if (context) {
      return context;
    }
  }

  const activeMemberships = await listAllActiveMembershipContexts({ userId });
  if (activeMemberships.length > 0) {
    return activeMemberships[0];
  }

  throw createError('errors.auth.forbiddenTenant', 403);
};

const markInviteExpiredIfNeeded = async (invite) => {
  if (invite.expiresAt.getTime() > Date.now()) {
    return false;
  }

  if (invite.status === INVITE_STATUS.PENDING) {
    invite.status = INVITE_STATUS.EXPIRED;
    await invite.save();
  }

  return true;
};

const findInviteByRawToken = async (token) => {
  if (!token) {
    throw createError('errors.invite.invalid', 400);
  }

  const invite = await WorkspaceInvite.findOne({
    tokenHash: hashValue(token),
    deletedAt: null,
  });

  if (!invite) {
    throw createError('errors.invite.invalid', 400);
  }

  if (invite.status === INVITE_STATUS.REVOKED) {
    throw createError('errors.invite.revoked', 400);
  }

  if (invite.status !== INVITE_STATUS.PENDING) {
    throw createError('errors.invite.invalid', 400);
  }

  const isExpired = await markInviteExpiredIfNeeded(invite);
  if (isExpired) {
    throw createError('errors.invite.expired', 400);
  }

  return invite;
};

const createOrActivateMember = async ({ workspaceId, userId, roleKey }) => {
  const existing = await WorkspaceMember.findOne({ workspaceId, userId });

  if (existing) {
    existing.status = MEMBER_STATUS.ACTIVE;
    existing.removedAt = null;
    existing.deletedAt = null;
    existing.deletedByUserId = null;
    existing.roleKey = roleKey;
    await existing.save();
    return existing;
  }

  return WorkspaceMember.create({
    workspaceId,
    userId,
    roleKey,
    status: MEMBER_STATUS.ACTIVE,
    joinedAt: new Date(),
  });
};

const buildInviteLink = (token) => {
  const base = authConfig.frontendBaseUrl.replace(/\/$/, '');
  return `${base}/workspaces/invites/accept?token=${encodeURIComponent(token)}`;
};

const sendWorkspaceInviteEmail = async ({
  invite,
  token,
  invitedByName,
  workspaceName,
}) => {
  await sendInviteEmail({
    to: invite.email,
    invitedByName,
    workspaceName,
    inviteLinkOrToken: buildInviteLink(token),
    roleKey: invite.roleKey,
    expiresAt: invite.expiresAt,
  });
};

export const ensureWorkspaceForVerifiedUser = async ({
  userId,
  inviteToken,
}) => {
  const user = await User.findOne({
    _id: userId,
    deletedAt: null,
  });

  if (!user) {
    throw createError('errors.auth.invalidToken', 401);
  }

  let hasUserChanges = false;
  let inviteContext = null;

  if (inviteToken) {
    const invite = await findInviteByRawToken(inviteToken);

    if (invite.emailNormalized !== user.emailNormalized) {
      throw createError('errors.invite.emailMismatch', 400);
    }

    await createOrActivateMember({
      workspaceId: invite.workspaceId,
      userId: user._id,
      roleKey: invite.roleKey,
    });

    invite.status = INVITE_STATUS.ACCEPTED;
    invite.acceptedAt = new Date();
    await invite.save();

    if (!user.defaultWorkspaceId) {
      user.defaultWorkspaceId = invite.workspaceId;
      hasUserChanges = true;
    }

    inviteContext = await findActiveContextForWorkspace({
      userId: user._id,
      workspaceId: invite.workspaceId,
    });

    if (!inviteContext) {
      throw createError('errors.auth.forbiddenTenant', 403);
    }
  }

  if (!user.defaultWorkspaceId) {
    const workspaceName = deriveWorkspaceName(user);
    const workspaceSlug = await ensureUniqueSlug(workspaceName);

    const workspace = await Workspace.create({
      name: workspaceName,
      slug: workspaceSlug,
      ownerUserId: user._id,
    });

    await WorkspaceMember.create({
      workspaceId: workspace._id,
      userId: user._id,
      roleKey: WORKSPACE_ROLES.OWNER,
      status: MEMBER_STATUS.ACTIVE,
      joinedAt: new Date(),
    });

    await ensureWorkspaceDefaultMailbox({
      workspaceId: workspace._id,
    });

    user.defaultWorkspaceId = workspace._id;
    if (!user.lastWorkspaceId) {
      user.lastWorkspaceId = workspace._id;
    }
    await user.save();
    hasUserChanges = false;
  }

  if (hasUserChanges) {
    await user.save();
  }

  const activeContext = await resolveActiveWorkspaceContext({
    userId: user._id,
    sessionWorkspaceId: null,
  });

  return {
    activeWorkspaceId: activeContext.workspaceId,
    activeRoleKey: activeContext.roleKey,
    activeWorkspace: activeContext.workspace,
    inviteWorkspaceId: inviteContext?.workspaceId || null,
    inviteRoleKey: inviteContext?.roleKey || null,
    inviteWorkspace: inviteContext?.workspace || null,
  };
};

export const getActiveWorkspaceContext = async (input) => {
  const userId = typeof input === 'string' ? input : input?.userId;
  const sessionWorkspaceId =
    typeof input === 'string' ? null : input?.sessionWorkspaceId || null;

  if (!userId) {
    throw createError('errors.auth.invalidToken', 401);
  }

  return resolveActiveWorkspaceContext({ userId, sessionWorkspaceId });
};

export const listMyWorkspaceMemberships = async ({
  userId,
  currentWorkspaceId = null,
}) => {
  const memberships = await listAllActiveMembershipContexts({ userId });
  const normalizedCurrentWorkspaceId = currentWorkspaceId
    ? String(currentWorkspaceId)
    : null;

  return {
    currentWorkspaceId: normalizedCurrentWorkspaceId,
    memberships: memberships.map((membership) => ({
      ...membership,
      isCurrent:
        normalizedCurrentWorkspaceId !== null &&
        membership.workspaceId === normalizedCurrentWorkspaceId,
    })),
  };
};

export const switchWorkspaceForSession = async ({
  userId,
  sessionId,
  workspaceId,
}) => {
  const workspace = await findWorkspaceById(workspaceId);
  if (!workspace) {
    throw createError('errors.workspace.notFound', 404);
  }

  const member = await WorkspaceMember.findOne({
    workspaceId,
    userId,
    deletedAt: null,
  })
    .select('_id roleKey status')
    .lean();

  if (!member) {
    throw createError('errors.workspace.notMember', 403);
  }

  if (member.status !== MEMBER_STATUS.ACTIVE) {
    throw createError('errors.workspace.inactiveMember', 403);
  }

  const updateResult = await Session.updateOne(
    {
      _id: sessionId,
      userId,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    },
    {
      $set: { workspaceId },
    }
  );

  if (!updateResult.matchedCount) {
    throw createError('errors.auth.sessionRevoked', 401);
  }

  await User.updateOne(
    {
      _id: userId,
    },
    {
      $set: { lastWorkspaceId: workspaceId },
    }
  );

  const accessToken = await mintAccessTokenForSession({
    userId,
    sessionId,
    workspaceId,
    roleKey: member.roleKey,
  });

  return {
    accessToken,
    workspace: buildWorkspaceView(workspace),
    roleKey: member.roleKey,
  };
};

export const assertTenantAccess = (reqWorkspaceId, authWorkspaceId) => {
  if (String(reqWorkspaceId) !== String(authWorkspaceId)) {
    throw createError('errors.auth.forbiddenTenant', 403);
  }
};

export const createWorkspaceInvite = async ({
  workspaceId,
  email,
  roleKey,
  invitedByUserId,
  invitedByName,
}) => {
  const workspace = await Workspace.findOne({
    _id: workspaceId,
    deletedAt: null,
  })
    .select('name')
    .lean();

  if (!workspace) {
    throw createError('errors.workspace.notFound', 404);
  }

  const emailNormalized = normalizeEmail(email);
  const existingUser = await User.findOne({
    emailNormalized,
    deletedAt: null,
  })
    .select('_id')
    .lean();

  if (existingUser) {
    // Allow re-inviting only if prior membership is removed; block active/suspended membership.
    const existingMembership = await WorkspaceMember.findOne({
      workspaceId,
      userId: existingUser._id,
      deletedAt: null,
      status: { $ne: MEMBER_STATUS.REMOVED },
    })
      .select('_id')
      .lean();

    if (existingMembership) {
      throw createError('errors.invite.alreadyMember', 409);
    }
  }

  const token = generateSecureToken(32);
  const tokenHash = hashValue(token);

  const expiresAt = new Date(
    Date.now() + authConfig.invites.expiresDays * oneDayMs
  );

  try {
    const invite = await WorkspaceInvite.create({
      workspaceId,
      email,
      emailNormalized,
      roleKey,
      invitedByUserId,
      tokenHash,
      status: INVITE_STATUS.PENDING,
      expiresAt,
    });

    await sendWorkspaceInviteEmail({
      invite,
      token,
      invitedByName,
      workspaceName: workspace.name,
    });

    return {
      invite: buildInviteView(invite),
    };
  } catch (error) {
    if (error?.code === 11000) {
      throw createError('errors.invite.alreadyPending', 409);
    }

    throw error;
  }
};

export const listWorkspaceInvites = async ({
  workspaceId,
  status,
  page = 1,
  limit = 10,
}) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 10));
  const skip = (safePage - 1) * safeLimit;

  const query = {
    workspaceId,
    deletedAt: null,
  };

  if (status) {
    query.status = status;
  }

  const [total, invites] = await Promise.all([
    WorkspaceInvite.countDocuments(query),
    WorkspaceInvite.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
  ]);

  const pagination = buildPagination({
    page: safePage,
    limit: safeLimit,
    total,
    results: invites.length,
  });

  return {
    ...pagination,
    invites: invites.map((invite) => buildInviteView(invite)),
  };
};

export const getWorkspaceInviteById = async ({ workspaceId, inviteId }) => {
  const invite = await WorkspaceInvite.findOne({
    _id: inviteId,
    workspaceId,
    deletedAt: null,
  }).lean();

  if (!invite) {
    throw createError('errors.invite.notFound', 404);
  }

  return {
    invite: buildInviteView(invite),
  };
};

export const resendWorkspaceInvite = async ({
  workspaceId,
  inviteId,
  invitedByName,
}) => {
  const invite = await WorkspaceInvite.findOne({
    _id: inviteId,
    workspaceId,
    deletedAt: null,
  });

  if (!invite) {
    throw createError('errors.invite.notFound', 404);
  }

  if (invite.status === INVITE_STATUS.REVOKED) {
    throw createError('errors.invite.revoked', 400);
  }

  if (invite.status !== INVITE_STATUS.PENDING) {
    throw createError('errors.invite.invalid', 400);
  }

  const isExpired = await markInviteExpiredIfNeeded(invite);
  if (isExpired) {
    throw createError('errors.invite.expired', 400);
  }

  const token = generateSecureToken(32);
  invite.tokenHash = hashValue(token);
  invite.expiresAt = new Date(
    Date.now() + authConfig.invites.expiresDays * oneDayMs
  );

  await invite.save();

  const workspace = await Workspace.findOne({
    _id: workspaceId,
    deletedAt: null,
  })
    .select('name')
    .lean();

  if (!workspace) {
    throw createError('errors.workspace.notFound', 404);
  }

  await sendWorkspaceInviteEmail({
    invite,
    token,
    invitedByName,
    workspaceName: workspace.name,
  });

  return {};
};

export const revokeWorkspaceInvite = async ({
  workspaceId,
  inviteId,
  revokedByUserId,
}) => {
  const invite = await WorkspaceInvite.findOne({
    _id: inviteId,
    workspaceId,
    deletedAt: null,
  });

  if (!invite) {
    throw createError('errors.invite.notFound', 404);
  }

  if (invite.status !== INVITE_STATUS.REVOKED) {
    invite.status = INVITE_STATUS.REVOKED;
    invite.deletedAt = new Date();
    invite.deletedByUserId = revokedByUserId;
    await invite.save();
  }

  return {};
};

export const acceptWorkspaceInvite = async ({
  token,
  email,
  password,
  name,
}) => {
  const invite = await findInviteByRawToken(token);

  const emailNormalized = normalizeEmail(email);
  if (!emailNormalized || invite.emailNormalized !== emailNormalized) {
    throw createError('errors.invite.emailMismatch', 400);
  }

  let user = await User.findOne({
    emailNormalized,
    deletedAt: null,
  });

  if (!user) {
    if (!password) {
      throw createError('errors.validation.failed', 422, [
        buildValidationError(
          'password',
          'errors.auth.passwordRequiredForInvite'
        ),
      ]);
    }

    user = await User.create({
      email,
      emailNormalized,
      passwordHash: await bcrypt.hash(password, authConfig.bcryptRounds),
      isEmailVerified: false,
      profile: {
        name: name || null,
      },
    });
  }

  if (user.status !== 'active') {
    throw createError('errors.auth.userSuspended', 403);
  }

  if (!user.isEmailVerified) {
    const otpResult = await createOtp({
      email: user.email,
      userId: user._id,
      purpose: OTP_PURPOSE.VERIFY_EMAIL,
    });

    sendOtpEmailFireAndForget({
      to: user.email,
      purpose: OTP_PURPOSE.VERIFY_EMAIL,
      code: otpResult.code,
    });

    return {
      accepted: false,
      workspaceId: String(invite.workspaceId),
      roleKey: invite.roleKey,
    };
  }

  await createOrActivateMember({
    workspaceId: invite.workspaceId,
    userId: user._id,
    roleKey: invite.roleKey,
  });

  invite.status = INVITE_STATUS.ACCEPTED;
  invite.acceptedAt = new Date();
  await invite.save();

  if (!user.defaultWorkspaceId) {
    user.defaultWorkspaceId = invite.workspaceId;
    await user.save();
  }

  return {
    accepted: true,
    workspaceId: String(invite.workspaceId),
    roleKey: invite.roleKey,
  };
};
