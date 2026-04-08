import { INVITE_STATUS } from '../../../constants/invite-status.js';
import { MEMBER_STATUS } from '../../../constants/member-status.js';
import { TICKET_PRIORITY_VALUES } from '../../../constants/ticket-priority.js';
import { TICKET_STATUS } from '../../../constants/ticket-status.js';
import { Subscription } from '../../billing/models/subscription.model.js';
import { File } from '../../files/models/file.model.js';
import { Mailbox } from '../../mailboxes/models/mailbox.model.js';
import { deriveTicketSlaState } from '../../sla/services/sla-ticket-runtime.service.js';
import { Ticket } from '../../tickets/models/ticket.model.js';
import { TicketCategory } from '../../tickets/models/ticket-category.model.js';
import { TicketTag } from '../../tickets/models/ticket-tag.model.js';
import { User } from '../../users/models/user.model.js';
import { WorkspaceInvite } from '../../workspaces/models/workspace-invite.model.js';
import { WorkspaceMember } from '../../workspaces/models/workspace-member.model.js';
import { normalizeObjectId, toObjectIdIfValid } from '../../../shared/utils/object-id.js';
import {
  buildTicketScopeMatch,
  buildTimeBuckets,
  formatBucketKey,
  isClosedInRange,
  isDateInRange,
  isSolvedInRange,
  normalizeReportFilters,
  serializeReportFilters,
} from '../utils/report-filters.js';

const OPENISH_STATUSES = new Set([
  TICKET_STATUS.NEW,
  TICKET_STATUS.OPEN,
  TICKET_STATUS.PENDING,
  TICKET_STATUS.WAITING_ON_CUSTOMER,
]);

const SLA_FIRST_RESPONSE_STATUSES = ['pending', 'met', 'breached', 'not_applicable'];
const SLA_RESOLUTION_STATUSES = ['running', 'paused', 'met', 'breached', 'not_applicable'];

const REPORT_TICKET_SELECT = [
  '_id',
  'workspaceId',
  'mailboxId',
  'status',
  'priority',
  'categoryId',
  'tagIds',
  'assigneeId',
  'createdAt',
  'statusChangedAt',
  'closedAt',
  'sla',
].join(' ');

const normalizeName = (value) => String(value || '').trim();

const sortByCountDesc = (left, right) => {
  if (right.count !== left.count) {
    return right.count - left.count;
  }

  return String(left.label || left.key || '').localeCompare(
    String(right.label || right.key || '')
  );
};

const createCounterRecord = (keys) =>
  Object.fromEntries(keys.map((key) => [key, 0]));

const incrementRecord = (record, key, amount = 1) => {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    record[key] = 0;
  }

  record[key] += amount;
};

const toBreakdownFromMap = (counts, buildItem) =>
  Object.entries(counts)
    .map(([key, count]) => buildItem(key, count))
    .filter((item) => item && item.count > 0)
    .sort(sortByCountDesc);

const createSeriesIndex = (filters, factory) => {
  const buckets = buildTimeBuckets(filters);

  return {
    order: buckets.map((bucket) => bucket.key),
    map: Object.fromEntries(
      buckets.map((bucket) => [
        bucket.key,
        {
          key: bucket.key,
          start: bucket.start,
          end: bucket.end,
          ...factory(bucket),
        },
      ])
    ),
  };
};

const finalizeSeries = (seriesIndex) =>
  seriesIndex.order.map((key) => seriesIndex.map[key]);

const applyDateToSeries = ({
  seriesIndex,
  date,
  filters,
  apply,
}) => {
  if (!isDateInRange(date, filters)) {
    return;
  }

  const key = formatBucketKey(date, filters.groupBy);
  const bucket = seriesIndex.map[key];

  if (!bucket) {
    return;
  }

  apply(bucket);
};

const getTicketLabelMaps = async ({ workspaceId, tickets, includeTags = false }) => {
  const mailboxIds = new Set();
  const categoryIds = new Set();
  const assigneeIds = new Set();
  const tagIds = new Set();

  for (const ticket of tickets) {
    if (ticket.mailboxId) {
      mailboxIds.add(normalizeObjectId(ticket.mailboxId));
    }

    if (ticket.categoryId) {
      categoryIds.add(normalizeObjectId(ticket.categoryId));
    }

    if (ticket.assigneeId) {
      assigneeIds.add(normalizeObjectId(ticket.assigneeId));
    }

    if (includeTags) {
      for (const tagId of ticket.tagIds || []) {
        tagIds.add(normalizeObjectId(tagId));
      }
    }
  }

  const [mailboxes, categories, assignees, tags] = await Promise.all([
    mailboxIds.size
      ? Mailbox.find({
          workspaceId: toObjectIdIfValid(workspaceId),
          _id: { $in: [...mailboxIds].map((id) => toObjectIdIfValid(id)) },
          deletedAt: null,
        })
          .select('_id name')
          .lean()
      : [],
    categoryIds.size
      ? TicketCategory.find({
          workspaceId: toObjectIdIfValid(workspaceId),
          _id: { $in: [...categoryIds].map((id) => toObjectIdIfValid(id)) },
          deletedAt: null,
        })
          .select('_id name')
          .lean()
      : [],
    assigneeIds.size
      ? User.find({
          _id: { $in: [...assigneeIds].map((id) => toObjectIdIfValid(id)) },
          deletedAt: null,
        })
          .select('_id email profile.name')
          .lean()
      : [],
    includeTags && tagIds.size
      ? TicketTag.find({
          workspaceId: toObjectIdIfValid(workspaceId),
          _id: { $in: [...tagIds].map((id) => toObjectIdIfValid(id)) },
          deletedAt: null,
        })
          .select('_id name')
          .lean()
      : [],
  ]);

  return {
    mailboxMap: new Map(
      mailboxes.map((mailbox) => [
        normalizeObjectId(mailbox._id),
        normalizeName(mailbox.name) || 'Unnamed mailbox',
      ])
    ),
    categoryMap: new Map(
      categories.map((category) => [
        normalizeObjectId(category._id),
        normalizeName(category.name) || 'Unnamed category',
      ])
    ),
    assigneeMap: new Map(
      assignees.map((user) => [
        normalizeObjectId(user._id),
        normalizeName(user?.profile?.name) || normalizeName(user.email),
      ])
    ),
    tagMap: new Map(
      tags.map((tag) => [
        normalizeObjectId(tag._id),
        normalizeName(tag.name) || 'Unnamed tag',
      ])
    ),
  };
};

const buildStatusBreakdown = (tickets) => {
  const counts = {};

  for (const ticket of tickets) {
    incrementRecord(counts, ticket.status);
  }

  return toBreakdownFromMap(counts, (key, count) => ({
    key,
    label: key,
    count,
  }));
};

const buildPriorityBreakdown = (tickets) => {
  const counts = createCounterRecord(TICKET_PRIORITY_VALUES);

  for (const ticket of tickets) {
    incrementRecord(counts, ticket.priority);
  }

  return toBreakdownFromMap(counts, (key, count) => ({
    key,
    label: key,
    count,
  }));
};

const buildReferenceBreakdown = (tickets, getId, labelMap, type) => {
  const counts = {};

  for (const ticket of tickets) {
    const id = getId(ticket);

    if (!id) {
      continue;
    }

    incrementRecord(counts, id);
  }

  return toBreakdownFromMap(counts, (id, count) => ({
    type,
    id,
    label: labelMap.get(id) || 'Unknown',
    count,
  }));
};

const buildTagBreakdown = (tickets, tagMap) => {
  const counts = {};

  for (const ticket of tickets) {
    for (const tagId of ticket.tagIds || []) {
      incrementRecord(counts, normalizeObjectId(tagId));
    }
  }

  return toBreakdownFromMap(counts, (id, count) => ({
    type: 'tag',
    id,
    label: tagMap.get(id) || 'Unknown',
    count,
  }));
};

const getTicketDateProjection = async ({ workspaceId, filters }) =>
  Ticket.find(buildTicketScopeMatch({ workspaceId, filters }))
    .select(REPORT_TICKET_SELECT)
    .lean();

const buildSlaSummary = (tickets) => {
  const firstResponseStatusCounts = createCounterRecord(SLA_FIRST_RESPONSE_STATUSES);
  const resolutionStatusCounts = createCounterRecord(SLA_RESOLUTION_STATUSES);
  let applicableTickets = 0;
  let breachedTickets = 0;

  for (const ticket of tickets) {
    const state = deriveTicketSlaState({
      sla: ticket.sla || {},
      now: new Date(),
    });

    incrementRecord(firstResponseStatusCounts, state.firstResponseStatus);
    incrementRecord(resolutionStatusCounts, state.resolutionStatus);

    if (state.isApplicable) {
      applicableTickets += 1;
    }

    if (state.isBreached) {
      breachedTickets += 1;
    }
  }

  const complianceRate =
    applicableTickets > 0
      ? Number((((applicableTickets - breachedTickets) / applicableTickets) * 100).toFixed(2))
      : null;

  return {
    applicableTickets,
    breachedTickets,
    nonBreachedTickets: Math.max(0, applicableTickets - breachedTickets),
    complianceRate,
    firstResponseStatusCounts,
    resolutionStatusCounts,
  };
};

const buildOverviewUsageBlock = async (workspaceId) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const now = new Date();

  const [activeMembers, pendingInvites, activeMailboxes, storageBytesAgg, subscription] =
    await Promise.all([
      WorkspaceMember.countDocuments({
        workspaceId: workspaceObjectId,
        status: MEMBER_STATUS.ACTIVE,
        deletedAt: null,
      }),
      WorkspaceInvite.countDocuments({
        workspaceId: workspaceObjectId,
        status: INVITE_STATUS.PENDING,
        deletedAt: null,
        expiresAt: { $gt: now },
      }),
      Mailbox.countDocuments({
        workspaceId: workspaceObjectId,
        deletedAt: null,
        isActive: true,
      }),
      File.aggregate([
        {
          $match: {
            workspaceId: workspaceObjectId,
            deletedAt: null,
            storageStatus: 'ready',
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$sizeBytes' },
          },
        },
      ]),
      Subscription.findOne({
        workspaceId: workspaceObjectId,
        deletedAt: null,
      })
        .select('status')
        .lean(),
    ]);

  return {
    seatsUsed: Number(activeMembers || 0) + Number(pendingInvites || 0),
    activeMailboxes: Number(activeMailboxes || 0),
    storageBytes: Number(storageBytesAgg?.[0]?.total || 0),
    currentBillingStatus: subscription?.status || null,
  };
};

const buildBaseReportPayload = ({ area, visibility, roleKey, filters }) => ({
  report: area,
  visibility,
  viewerRoleKey: roleKey,
  generatedAt: new Date().toISOString(),
  filters: serializeReportFilters(filters),
});

export const getWorkspaceReportsOverview = async ({
  workspaceId,
  roleKey,
  query = {},
}) => {
  const filters = normalizeReportFilters(query);
  const scopeTickets = await getTicketDateProjection({ workspaceId, filters });
  const rangeTickets = scopeTickets.filter((ticket) =>
    isDateInRange(ticket.createdAt, filters)
  );
  const { mailboxMap } = await getTicketLabelMaps({
    workspaceId,
    tickets: rangeTickets,
  });
  const slaSummary = buildSlaSummary(rangeTickets);
  const usage = await buildOverviewUsageBlock(workspaceId);

  return {
    ...buildBaseReportPayload({
      area: 'overview',
      visibility: 'workspace',
      roleKey,
      filters,
    }),
    summary: {
      totalTicketsInRange: rangeTickets.length,
      backlogTickets: scopeTickets.filter((ticket) => OPENISH_STATUSES.has(ticket.status)).length,
      solvedTicketsInRange: scopeTickets.filter((ticket) => isSolvedInRange(ticket, filters)).length,
      closedTicketsInRange: scopeTickets.filter((ticket) => isClosedInRange(ticket, filters)).length,
    },
    breakdowns: {
      status: buildStatusBreakdown(rangeTickets),
      priority: buildPriorityBreakdown(rangeTickets),
      mailbox: buildReferenceBreakdown(
        rangeTickets,
        (ticket) => normalizeObjectId(ticket.mailboxId),
        mailboxMap,
        'mailbox'
      ),
    },
    sla: slaSummary,
    usage,
  };
};

export const getWorkspaceTicketsReport = async ({
  workspaceId,
  roleKey,
  query = {},
}) => {
  const filters = normalizeReportFilters(query);
  const scopeTickets = await getTicketDateProjection({ workspaceId, filters });
  const rangeTickets = scopeTickets.filter((ticket) =>
    isDateInRange(ticket.createdAt, filters)
  );
  const { mailboxMap, categoryMap, assigneeMap, tagMap } = await getTicketLabelMaps({
    workspaceId,
    tickets: rangeTickets,
    includeTags: true,
  });
  const seriesIndex = createSeriesIndex(filters, () => ({
    created: 0,
    solved: 0,
    closed: 0,
  }));

  for (const ticket of scopeTickets) {
    applyDateToSeries({
      seriesIndex,
      date: ticket.createdAt,
      filters,
      apply: (bucket) => {
        bucket.created += 1;
      },
    });
    applyDateToSeries({
      seriesIndex,
      date: ticket?.sla?.resolvedAt || (ticket.status === TICKET_STATUS.SOLVED ? ticket.statusChangedAt : null),
      filters,
      apply: (bucket) => {
        bucket.solved += 1;
      },
    });
    applyDateToSeries({
      seriesIndex,
      date: ticket.status === TICKET_STATUS.CLOSED ? ticket.closedAt : null,
      filters,
      apply: (bucket) => {
        bucket.closed += 1;
      },
    });
  }

  return {
    ...buildBaseReportPayload({
      area: 'tickets',
      visibility: 'workspace',
      roleKey,
      filters,
    }),
    summary: {
      createdTicketsInRange: rangeTickets.length,
      solvedTicketsInRange: scopeTickets.filter((ticket) => isSolvedInRange(ticket, filters)).length,
      closedTicketsInRange: scopeTickets.filter((ticket) => isClosedInRange(ticket, filters)).length,
    },
    series: {
      volume: finalizeSeries(seriesIndex),
    },
    breakdowns: {
      status: buildStatusBreakdown(rangeTickets),
      priority: buildPriorityBreakdown(rangeTickets),
      mailbox: buildReferenceBreakdown(
        rangeTickets,
        (ticket) => normalizeObjectId(ticket.mailboxId),
        mailboxMap,
        'mailbox'
      ),
      category: buildReferenceBreakdown(
        rangeTickets.filter((ticket) => ticket.categoryId),
        (ticket) => normalizeObjectId(ticket.categoryId),
        categoryMap,
        'category'
      ),
      tag: buildTagBreakdown(rangeTickets, tagMap),
      assignee: buildReferenceBreakdown(
        rangeTickets.filter((ticket) => ticket.assigneeId),
        (ticket) => normalizeObjectId(ticket.assigneeId),
        assigneeMap,
        'assignee'
      ),
    },
  };
};

export const getWorkspaceSlaReport = async ({
  workspaceId,
  roleKey,
  query = {},
}) => {
  const filters = normalizeReportFilters(query);
  const scopeTickets = await getTicketDateProjection({ workspaceId, filters });
  const rangeTickets = scopeTickets.filter((ticket) =>
    isDateInRange(ticket.createdAt, filters)
  );
  const { mailboxMap } = await getTicketLabelMaps({
    workspaceId,
    tickets: rangeTickets,
  });
  const slaOverview = buildSlaSummary(rangeTickets);
  const byPriority = [];

  for (const priority of TICKET_PRIORITY_VALUES) {
    const ticketsForPriority = rangeTickets.filter(
      (ticket) => ticket.priority === priority
    );
    const summary = buildSlaSummary(ticketsForPriority);

    if (summary.applicableTickets > 0 || ticketsForPriority.length > 0) {
      byPriority.push({
        key: priority,
        label: priority,
        ticketCount: ticketsForPriority.length,
        ...summary,
      });
    }
  }

  const mailboxGroups = new Map();

  for (const ticket of rangeTickets) {
    const mailboxId = normalizeObjectId(ticket.mailboxId);

    if (!mailboxGroups.has(mailboxId)) {
      mailboxGroups.set(mailboxId, []);
    }

    mailboxGroups.get(mailboxId).push(ticket);
  }

  const byMailbox = [...mailboxGroups.entries()]
    .map(([mailboxId, tickets]) => ({
      id: mailboxId,
      label: mailboxMap.get(mailboxId) || 'Unknown',
      ticketCount: tickets.length,
      ...buildSlaSummary(tickets),
    }))
    .sort((left, right) => {
      if (right.ticketCount !== left.ticketCount) {
        return right.ticketCount - left.ticketCount;
      }

      return left.label.localeCompare(right.label);
    });

  const seriesIndex = createSeriesIndex(filters, () => ({
    ticketCount: 0,
    applicableTickets: 0,
    breachedTickets: 0,
  }));

  for (const ticket of rangeTickets) {
    applyDateToSeries({
      seriesIndex,
      date: ticket.createdAt,
      filters,
      apply: (bucket) => {
        const state = deriveTicketSlaState({
          sla: ticket.sla || {},
          now: new Date(),
        });

        bucket.ticketCount += 1;

        if (state.isApplicable) {
          bucket.applicableTickets += 1;
        }

        if (state.isBreached) {
          bucket.breachedTickets += 1;
        }
      },
    });
  }

  const trend = finalizeSeries(seriesIndex).map((bucket) => ({
    ...bucket,
    complianceRate:
      bucket.applicableTickets > 0
        ? Number(
            (((bucket.applicableTickets - bucket.breachedTickets) /
              bucket.applicableTickets) *
              100).toFixed(2)
          )
        : null,
  }));

  return {
    ...buildBaseReportPayload({
      area: 'sla',
      visibility: 'workspace',
      roleKey,
      filters,
    }),
    overview: slaOverview,
    breakdowns: {
      byPriority,
      byMailbox,
    },
    series: {
      compliance: trend,
    },
  };
};

export const getWorkspaceTeamReport = async ({
  workspaceId,
  roleKey,
  query = {},
}) => {
  const filters = normalizeReportFilters(query);
  const scopeTickets = await getTicketDateProjection({ workspaceId, filters });
  const assigneeTickets = scopeTickets.filter((ticket) => ticket.assigneeId);
  const { assigneeMap } = await getTicketLabelMaps({
    workspaceId,
    tickets: assigneeTickets,
  });
  const groupedByAssignee = new Map();

  for (const ticket of assigneeTickets) {
    const assigneeId = normalizeObjectId(ticket.assigneeId);

    if (!groupedByAssignee.has(assigneeId)) {
      groupedByAssignee.set(assigneeId, []);
    }

    groupedByAssignee.get(assigneeId).push(ticket);
  }

  const workload = [...groupedByAssignee.entries()]
    .map(([assigneeId, tickets]) => {
      const activeAssignedLoad = tickets.filter((ticket) =>
        OPENISH_STATUSES.has(ticket.status)
      ).length;
      const statusCounts = {
        open: tickets.filter((ticket) => ticket.status === TICKET_STATUS.OPEN).length,
        pending: tickets.filter((ticket) => ticket.status === TICKET_STATUS.PENDING).length,
        waitingOnCustomer: tickets.filter(
          (ticket) => ticket.status === TICKET_STATUS.WAITING_ON_CUSTOMER
        ).length,
      };
      const slaSummary = buildSlaSummary(tickets);

      return {
        assignee: {
          id: assigneeId,
          label: assigneeMap.get(assigneeId) || 'Unknown',
        },
        totalAssignedTickets: tickets.length,
        activeAssignedLoad,
        solvedTicketsInRange: tickets.filter((ticket) => isSolvedInRange(ticket, filters)).length,
        closedTicketsInRange: tickets.filter((ticket) => isClosedInRange(ticket, filters)).length,
        statusCounts,
        sla: {
          applicableTickets: slaSummary.applicableTickets,
          breachedTickets: slaSummary.breachedTickets,
          complianceRate: slaSummary.complianceRate,
        },
      };
    })
    .sort((left, right) => {
      if (right.activeAssignedLoad !== left.activeAssignedLoad) {
        return right.activeAssignedLoad - left.activeAssignedLoad;
      }

      return left.assignee.label.localeCompare(right.assignee.label);
    });

  const unassignedActiveLoad = scopeTickets.filter(
    (ticket) => !ticket.assigneeId && OPENISH_STATUSES.has(ticket.status)
  ).length;

  return {
    ...buildBaseReportPayload({
      area: 'team',
      visibility: 'owner_admin',
      roleKey,
      filters,
    }),
    summary: {
      assigneeCount: workload.length,
      assignedActiveLoad: workload.reduce(
        (total, item) => total + item.activeAssignedLoad,
        0
      ),
      unassignedActiveLoad,
      solvedTicketsInRange: workload.reduce(
        (total, item) => total + item.solvedTicketsInRange,
        0
      ),
      closedTicketsInRange: workload.reduce(
        (total, item) => total + item.closedTicketsInRange,
        0
      ),
    },
    workload,
  };
};
