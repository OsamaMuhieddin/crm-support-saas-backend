import { BILLING_SUBSCRIPTION_STATUS } from '../../../constants/billing-subscription-status.js';
import { INVITE_STATUS } from '../../../constants/invite-status.js';
import { MEMBER_STATUS, MEMBER_STATUS_VALUES } from '../../../constants/member-status.js';
import { WORKSPACE_STATUS } from '../../../constants/workspace-status.js';
import { createError } from '../../../shared/errors/createError.js';
import { escapeRegex } from '../../../shared/utils/regex.js';
import { buildPagination } from '../../../shared/utils/pagination.js';
import { Entitlement } from '../../billing/models/entitlement.model.js';
import { Subscription } from '../../billing/models/subscription.model.js';
import { UsageMeter } from '../../billing/models/usage-meter.model.js';
import { File } from '../../files/models/file.model.js';
import { Mailbox } from '../../mailboxes/models/mailbox.model.js';
import { Ticket } from '../../tickets/models/ticket.model.js';
import { User } from '../../users/models/user.model.js';
import { Workspace } from '../../workspaces/models/workspace.model.js';
import { WorkspaceInvite } from '../../workspaces/models/workspace-invite.model.js';
import { WorkspaceMember } from '../../workspaces/models/workspace-member.model.js';

const LIST_SORTS = {
  createdAt: { createdAt: 1, _id: 1 },
  '-createdAt': { createdAt: -1, _id: -1 },
  updatedAt: { updatedAt: 1, _id: 1 },
  '-updatedAt': { updatedAt: -1, _id: -1 },
  name: { name: 1, _id: 1 },
  '-name': { name: -1, _id: -1 },
  status: { status: 1, createdAt: -1 },
  '-status': { status: -1, createdAt: -1 },
};

const normalizeObjectId = (value) => String(value || '');

const toNullableDate = (value) => (value ? new Date(value) : null);

const normalizeSearch = (query = {}) => {
  const value =
    typeof query.q === 'string' && query.q.trim()
      ? query.q.trim()
      : typeof query.search === 'string' && query.search.trim()
        ? query.search.trim()
        : null;

  return value || null;
};

const toUsageMap = ({
  workspaceIds,
  activeMemberCounts,
  pendingInviteCounts,
  activeMailboxCounts,
  storageBytesRows,
}) => {
  const activeMembersByWorkspaceId = new Map(
    activeMemberCounts.map((row) => [normalizeObjectId(row._id), Number(row.count || 0)])
  );
  const pendingInvitesByWorkspaceId = new Map(
    pendingInviteCounts.map((row) => [normalizeObjectId(row._id), Number(row.count || 0)])
  );
  const activeMailboxesByWorkspaceId = new Map(
    activeMailboxCounts.map((row) => [normalizeObjectId(row._id), Number(row.count || 0)])
  );
  const storageBytesByWorkspaceId = new Map(
    storageBytesRows.map((row) => [normalizeObjectId(row._id), Number(row.total || 0)])
  );

  return new Map(
    workspaceIds.map((workspaceId) => {
      const activeMembers = activeMembersByWorkspaceId.get(workspaceId) || 0;
      const pendingInvites = pendingInvitesByWorkspaceId.get(workspaceId) || 0;

      return [
        workspaceId,
        {
          seatsUsed: activeMembers + pendingInvites,
          activeMailboxes: activeMailboxesByWorkspaceId.get(workspaceId) || 0,
          storageBytes: storageBytesByWorkspaceId.get(workspaceId) || 0,
        },
      ];
    })
  );
};

const getWorkspaceUsageMap = async (workspaceIds = []) => {
  if (!workspaceIds.length) {
    return new Map();
  }

  const now = new Date();
  const [activeMemberCounts, pendingInviteCounts, activeMailboxCounts, storageBytesRows] =
    await Promise.all([
      WorkspaceMember.aggregate([
        {
          $match: {
            workspaceId: { $in: workspaceIds },
            status: MEMBER_STATUS.ACTIVE,
            deletedAt: null,
          },
        },
        {
          $group: {
            _id: '$workspaceId',
            count: { $sum: 1 },
          },
        },
      ]),
      WorkspaceInvite.aggregate([
        {
          $match: {
            workspaceId: { $in: workspaceIds },
            status: INVITE_STATUS.PENDING,
            deletedAt: null,
            expiresAt: { $gt: now },
          },
        },
        {
          $group: {
            _id: '$workspaceId',
            count: { $sum: 1 },
          },
        },
      ]),
      Mailbox.aggregate([
        {
          $match: {
            workspaceId: { $in: workspaceIds },
            deletedAt: null,
            isActive: true,
          },
        },
        {
          $group: {
            _id: '$workspaceId',
            count: { $sum: 1 },
          },
        },
      ]),
      File.aggregate([
        {
          $match: {
            workspaceId: { $in: workspaceIds },
            deletedAt: null,
            storageStatus: 'ready',
          },
        },
        {
          $group: {
            _id: '$workspaceId',
            total: { $sum: '$sizeBytes' },
          },
        },
      ]),
    ]);

  return toUsageMap({
    workspaceIds: workspaceIds.map((workspaceId) => normalizeObjectId(workspaceId)),
    activeMemberCounts,
    pendingInviteCounts,
    activeMailboxCounts,
    storageBytesRows,
  });
};

const buildOwnerView = (owner) => {
  if (!owner?._id) {
    return null;
  }

  return {
    _id: normalizeObjectId(owner._id),
    email: owner.email,
    name: owner?.profile?.name || null,
  };
};

const buildSubscriptionView = (subscription) => {
  if (!subscription?._id) {
    return null;
  }

  return {
    _id: normalizeObjectId(subscription._id),
    status: subscription.status,
    provider: subscription.provider || null,
    planKey: subscription.planKey || null,
    trialEndsAt: toNullableDate(subscription.trialEndsAt),
    currentPeriodEnd: toNullableDate(subscription.currentPeriodEnd),
    graceEndsAt: toNullableDate(subscription.graceEndsAt),
    pastDueAt: toNullableDate(subscription.pastDueAt),
    cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
    lastSyncedAt: toNullableDate(subscription.lastSyncedAt),
  };
};

const buildListWorkspaceRow = ({ workspace, usage }) => ({
  _id: normalizeObjectId(workspace._id),
  name: workspace.name,
  slug: workspace.slug,
  status: workspace.status,
  createdAt: workspace.createdAt,
  owner: buildOwnerView(workspace.owner),
  billing: buildSubscriptionView(workspace.subscription),
  usage: usage || {
    seatsUsed: 0,
    activeMailboxes: 0,
    storageBytes: 0,
  },
});

const buildSearchMatch = (search) => {
  if (!search) {
    return null;
  }

  const regex = new RegExp(escapeRegex(search), 'i');

  return {
    $or: [
      { name: regex },
      { slug: regex },
      { 'owner.email': regex },
      { 'owner.profile.name': regex },
    ],
  };
};

const findWorkspaceByIdOrThrow = async (workspaceId) => {
  const workspace = await Workspace.findOne({
    _id: workspaceId,
    deletedAt: null,
  })
    .select(
      '_id name slug status ownerUserId defaultMailboxId defaultSlaPolicyId createdAt updatedAt'
    )
    .lean();

  if (!workspace) {
    throw createError('errors.workspace.notFound', 404);
  }

  return workspace;
};

const resolveWorkspaceActiveStatus = async ({ workspaceId }) => {
  const subscription = await Subscription.findOne({
    workspaceId,
    deletedAt: null,
  })
    .select('status')
    .lean();

  if (subscription?.status === BILLING_SUBSCRIPTION_STATUS.TRIALING) {
    return WORKSPACE_STATUS.TRIAL;
  }

  return WORKSPACE_STATUS.ACTIVE;
};

const buildTicketStatusCounts = (rows = []) => {
  const counts = {};

  for (const row of rows) {
    counts[row._id] = Number(row.count || 0);
  }

  return counts;
};

export const listAdminWorkspaces = async ({ query = {} }) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;
  const search = normalizeSearch(query);
  const sort = LIST_SORTS[query.sort] || LIST_SORTS['-createdAt'];
  const match = {
    deletedAt: null,
  };

  if (query.status) {
    match.status = query.status;
  }

  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: 'users',
        localField: 'ownerUserId',
        foreignField: '_id',
        as: 'owner',
        pipeline: [
          {
            $project: {
              _id: 1,
              email: 1,
              profile: 1,
            },
          },
        ],
      },
    },
    {
      $set: {
        owner: { $first: '$owner' },
      },
    },
    {
      $lookup: {
        from: 'subscriptions',
        localField: '_id',
        foreignField: 'workspaceId',
        as: 'subscription',
        pipeline: [
          {
            $match: {
              deletedAt: null,
            },
          },
          {
            $project: {
              _id: 1,
              status: 1,
              provider: 1,
              planKey: 1,
              trialEndsAt: 1,
              currentPeriodEnd: 1,
              graceEndsAt: 1,
              pastDueAt: 1,
              cancelAtPeriodEnd: 1,
              lastSyncedAt: 1,
            },
          },
        ],
      },
    },
    {
      $set: {
        subscription: { $first: '$subscription' },
      },
    },
  ];

  const searchMatch = buildSearchMatch(search);
  if (searchMatch) {
    pipeline.push({ $match: searchMatch });
  }

  if (query.billingStatus) {
    pipeline.push({
      $match: {
        'subscription.status': query.billingStatus,
      },
    });
  }

  if (query.planKey) {
    pipeline.push({
      $match: {
        'subscription.planKey': String(query.planKey).trim().toLowerCase(),
      },
    });
  }

  if (typeof query.trialing === 'boolean') {
    pipeline.push({
      $match: query.trialing
        ? { 'subscription.status': BILLING_SUBSCRIPTION_STATUS.TRIALING }
        : {
            $or: [
              { subscription: null },
              { 'subscription.status': { $ne: BILLING_SUBSCRIPTION_STATUS.TRIALING } },
            ],
          },
    });
  }

  pipeline.push(
    { $sort: sort },
    {
      $facet: {
        metadata: [{ $count: 'total' }],
        items: [
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 1,
              name: 1,
              slug: 1,
              status: 1,
              createdAt: 1,
              owner: 1,
              subscription: 1,
            },
          },
        ],
      },
    }
  );

  const [result] = await Workspace.aggregate(pipeline);
  const rows = result?.items || [];
  const total = Number(result?.metadata?.[0]?.total || 0);
  const workspaceIds = rows.map((row) => row._id);
  const usageByWorkspaceId = await getWorkspaceUsageMap(workspaceIds);

  return {
    ...buildPagination({
      page,
      limit,
      total,
      results: rows.length,
    }),
    workspaces: rows.map((row) =>
      buildListWorkspaceRow({
        workspace: row,
        usage: usageByWorkspaceId.get(normalizeObjectId(row._id)),
      })
    ),
  };
};

export const getAdminWorkspaceById = async ({ workspaceId }) => {
  const workspace = await findWorkspaceByIdOrThrow(workspaceId);
  const now = new Date();
  const [owner, subscription, entitlement, latestUsageMeter, memberCounts, pendingInvites, mailboxCounts, ticketCounts, storageBytesRows] =
    await Promise.all([
      User.findOne({
        _id: workspace.ownerUserId,
        deletedAt: null,
      })
        .select('_id email profile.name status')
        .lean(),
      Subscription.findOne({
        workspaceId,
        deletedAt: null,
      })
        .select(
          '_id workspaceId status provider planKey trialStartedAt trialEndsAt currentPeriodStart currentPeriodEnd graceStartsAt graceEndsAt pastDueAt partialBlockStartsAt cancelAtPeriodEnd canceledAt lastSyncedAt'
        )
        .lean(),
      Entitlement.findOne({
        workspaceId,
        deletedAt: null,
      })
        .select('features limits usage computedAt sourceSnapshot')
        .lean(),
      UsageMeter.findOne({
        workspaceId,
      })
        .sort({ periodKey: -1 })
        .select('periodKey ticketsCreated uploadsCount updatedAt')
        .lean(),
      WorkspaceMember.aggregate([
        {
          $match: {
            workspaceId: workspace._id,
            deletedAt: null,
          },
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
          },
        },
      ]),
      WorkspaceInvite.countDocuments({
        workspaceId: workspace._id,
        status: INVITE_STATUS.PENDING,
        deletedAt: null,
        expiresAt: { $gt: now },
      }),
      Mailbox.aggregate([
        {
          $match: {
            workspaceId: workspace._id,
            deletedAt: null,
          },
        },
        {
          $group: {
            _id: '$isActive',
            count: { $sum: 1 },
          },
        },
      ]),
      Ticket.aggregate([
        {
          $match: {
            workspaceId: workspace._id,
            deletedAt: null,
          },
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
          },
        },
      ]),
      File.aggregate([
        {
          $match: {
            workspaceId: workspace._id,
            deletedAt: null,
            storageStatus: 'ready',
          },
        },
        {
          $group: {
            _id: '$workspaceId',
            total: { $sum: '$sizeBytes' },
          },
        },
      ]),
    ]);

  const usageByWorkspaceId = await getWorkspaceUsageMap([workspace._id]);
  const currentUsage = usageByWorkspaceId.get(normalizeObjectId(workspace._id)) || {
    seatsUsed: 0,
    activeMailboxes: 0,
    storageBytes: Number(storageBytesRows?.[0]?.total || 0),
  };
  const memberCountsMap = new Map(
    memberCounts.map((row) => [row._id, Number(row.count || 0)])
  );
  const mailboxCountsMap = new Map(
    mailboxCounts.map((row) => [String(row._id), Number(row.count || 0)])
  );
  const totalMailboxes = [...mailboxCountsMap.values()].reduce(
    (sum, count) => sum + count,
    0
  );
  const ticketStatusBreakdown = buildTicketStatusCounts(ticketCounts);
  const totalTickets = Object.values(ticketStatusBreakdown).reduce(
    (sum, count) => sum + Number(count || 0),
    0
  );

  return {
    workspace: {
      _id: normalizeObjectId(workspace._id),
      name: workspace.name,
      slug: workspace.slug,
      status: workspace.status,
      ownerUserId: normalizeObjectId(workspace.ownerUserId),
      defaultMailboxId: workspace.defaultMailboxId
        ? normalizeObjectId(workspace.defaultMailboxId)
        : null,
      defaultSlaPolicyId: workspace.defaultSlaPolicyId
        ? normalizeObjectId(workspace.defaultSlaPolicyId)
        : null,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    },
    owner: buildOwnerView(owner),
    billing: {
      subscription: subscription
        ? {
            ...buildSubscriptionView(subscription),
            trialStartedAt: toNullableDate(subscription.trialStartedAt),
            currentPeriodStart: toNullableDate(subscription.currentPeriodStart),
            graceStartsAt: toNullableDate(subscription.graceStartsAt),
            partialBlockStartsAt: toNullableDate(subscription.partialBlockStartsAt),
            canceledAt: toNullableDate(subscription.canceledAt),
          }
        : null,
      entitlement: entitlement
        ? {
            features: entitlement.features,
            limits: entitlement.limits,
            computedAt: toNullableDate(entitlement.computedAt),
            sourceSnapshot: entitlement.sourceSnapshot || null,
          }
        : null,
    },
    usage: {
      current: currentUsage,
      monthly: latestUsageMeter
        ? {
            periodKey: latestUsageMeter.periodKey,
            ticketsCreated: Number(latestUsageMeter.ticketsCreated || 0),
            uploadsCount: Number(latestUsageMeter.uploadsCount || 0),
            updatedAt: latestUsageMeter.updatedAt,
          }
        : null,
      entitlementSnapshot: entitlement?.usage || null,
    },
    counts: {
      members: Object.fromEntries(
        MEMBER_STATUS_VALUES.map((status) => [
          status,
          memberCountsMap.get(status) || 0,
        ])
      ),
      pendingInvites: Number(pendingInvites || 0),
      mailboxes: {
        total: totalMailboxes,
        active: mailboxCountsMap.get('true') || 0,
      },
      tickets: {
        total: totalTickets,
        statusBreakdown: ticketStatusBreakdown,
      },
    },
  };
};

export const suspendAdminWorkspace = async ({ workspaceId }) => {
  const workspace = await findWorkspaceByIdOrThrow(workspaceId);

  if (workspace.status === WORKSPACE_STATUS.SUSPENDED) {
    return {
      changed: false,
      workspace: {
        _id: normalizeObjectId(workspace._id),
        status: workspace.status,
      },
    };
  }

  await Workspace.updateOne(
    {
      _id: workspace._id,
    },
    {
      $set: {
        status: WORKSPACE_STATUS.SUSPENDED,
      },
    }
  );

  return {
    changed: true,
    workspace: {
      _id: normalizeObjectId(workspace._id),
      status: WORKSPACE_STATUS.SUSPENDED,
    },
  };
};

export const reactivateAdminWorkspace = async ({ workspaceId }) => {
  const workspace = await findWorkspaceByIdOrThrow(workspaceId);

  if (workspace.status !== WORKSPACE_STATUS.SUSPENDED) {
    return {
      changed: false,
      workspace: {
        _id: normalizeObjectId(workspace._id),
        status: workspace.status,
      },
    };
  }

  const nextStatus = await resolveWorkspaceActiveStatus({
    workspaceId: workspace._id,
  });

  await Workspace.updateOne(
    {
      _id: workspace._id,
    },
    {
      $set: {
        status: nextStatus,
      },
    }
  );

  return {
    changed: true,
    workspace: {
      _id: normalizeObjectId(workspace._id),
      status: nextStatus,
    },
  };
};

export const extendAdminWorkspaceTrial = async ({ workspaceId, days }) => {
  await findWorkspaceByIdOrThrow(workspaceId);

  const subscription = await Subscription.findOne({
    workspaceId,
    deletedAt: null,
  });

  if (!subscription) {
    throw createError('errors.billing.subscriptionNotFound', 404);
  }

  if (
    subscription.status !== BILLING_SUBSCRIPTION_STATUS.TRIALING ||
    subscription.stripeSubscriptionId
  ) {
    throw createError('errors.billing.trialExtensionNotAllowed', 409);
  }

  const daysToExtend = Number(days || 0);
  const baseTrialEnd =
    toNullableDate(subscription.trialEndsAt) || toNullableDate(subscription.currentPeriodEnd);

  if (!baseTrialEnd) {
    throw createError('errors.billing.trialExtensionNotAllowed', 409);
  }

  const nextTrialEnd = new Date(baseTrialEnd);
  nextTrialEnd.setUTCDate(nextTrialEnd.getUTCDate() + daysToExtend);

  subscription.trialEndsAt = nextTrialEnd;
  subscription.graceStartsAt = null;
  subscription.graceEndsAt = null;
  subscription.pastDueAt = null;
  subscription.partialBlockStartsAt = null;
  subscription.canceledAt = null;
  subscription.cancelAtPeriodEnd = false;

  if (
    !subscription.currentPeriodEnd ||
    new Date(subscription.currentPeriodEnd).getTime() <= baseTrialEnd.getTime()
  ) {
    subscription.currentPeriodEnd = nextTrialEnd;
  }

  subscription.lastSyncedAt = new Date();
  await subscription.save();

  if (subscription.status === BILLING_SUBSCRIPTION_STATUS.TRIALING) {
    await Workspace.updateOne(
      {
        _id: workspaceId,
        status: { $ne: WORKSPACE_STATUS.SUSPENDED },
      },
      {
        $set: {
          status: WORKSPACE_STATUS.TRIAL,
        },
      }
    );
  }

  return {
    trialExtension: {
      workspaceId: normalizeObjectId(workspaceId),
      daysExtended: daysToExtend,
      subscriptionStatus: subscription.status,
      trialEndsAt: subscription.trialEndsAt,
      currentPeriodEnd: subscription.currentPeriodEnd,
    },
  };
};
