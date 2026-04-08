import { billingConfig } from '../../../config/billing.config.js';
import { BILLING_SUBSCRIPTION_STATUS } from '../../../constants/billing-subscription-status.js';
import { PLATFORM_ROLES } from '../../../constants/platform-roles.js';
import { WORKSPACE_STATUS } from '../../../constants/workspace-status.js';
import { Addon } from '../../billing/models/addon.model.js';
import { Entitlement } from '../../billing/models/entitlement.model.js';
import { Plan } from '../../billing/models/plan.model.js';
import { Subscription } from '../../billing/models/subscription.model.js';
import { normalizeEntitlementSnapshot } from '../../billing/utils/billing-canonical.js';
import { File } from '../../files/models/file.model.js';
import { Mailbox } from '../../mailboxes/models/mailbox.model.js';
import { PlatformMetricDaily } from '../../platform/models/platform-metric-daily.model.js';
import { Ticket } from '../../tickets/models/ticket.model.js';
import { User } from '../../users/models/user.model.js';
import { Workspace } from '../../workspaces/models/workspace.model.js';
import {
  buildMetricsBuckets,
  formatMetricsBucketKey,
  normalizeAdminMetricsFilters,
  serializeAdminMetricsFilters,
} from '../utils/admin-analytics-filters.js';

const REVENUE_VISIBLE_ROLE = PLATFORM_ROLES.SUPER_ADMIN;
const REVENUE_ACTIVE_STATUSES = new Set([
  BILLING_SUBSCRIPTION_STATUS.ACTIVE,
  BILLING_SUBSCRIPTION_STATUS.PAST_DUE,
]);

const normalizeObjectId = (value) => String(value || '');

const isRevenueVisible = (platformAdmin) =>
  platformAdmin?.role === REVENUE_VISIBLE_ROLE;

const createCounterRecord = (keys) =>
  Object.fromEntries(keys.map((key) => [key, 0]));

const sortByCountDesc = (left, right) => {
  if (right.count !== left.count) {
    return right.count - left.count;
  }

  return String(left.label || left.key || '').localeCompare(
    String(right.label || right.key || '')
  );
};

const toDistribution = (counts, mapItem) =>
  Object.entries(counts)
    .map(([key, count]) => mapItem(key, count))
    .filter((item) => item && item.count > 0)
    .sort(sortByCountDesc);

const buildBaseAnalyticsPayload = ({ area, visibility, platformAdmin, filters }) => ({
  report: area,
  visibility,
  platformRole: platformAdmin.role,
  generatedAt: new Date().toISOString(),
  ...(filters ? { filters: serializeAdminMetricsFilters(filters) } : {}),
});

const getOverviewRange = () => {
  const filters = normalizeAdminMetricsFilters({});
  return {
    from: filters.from,
    to: filters.to,
  };
};

const getCurrentStorageBytes = async () => {
  const [result] = await File.aggregate([
    {
      $match: {
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
  ]);

  return Number(result?.total || 0);
};

const getWorkspaceStatusCounts = async () => {
  const rows = await Workspace.aggregate([
    {
      $match: {
        deletedAt: null,
      },
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
      },
    },
  ]);

  return rows.reduce(
    (accumulator, row) => ({
      ...accumulator,
      [row._id]: Number(row.count || 0),
    }),
    createCounterRecord(Object.values(WORKSPACE_STATUS))
  );
};

const getSubscriptionStatusCounts = async () => {
  const rows = await Subscription.aggregate([
    {
      $match: {
        deletedAt: null,
      },
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
      },
    },
  ]);

  return rows.reduce(
    (accumulator, row) => ({
      ...accumulator,
      [row._id]: Number(row.count || 0),
    }),
    createCounterRecord(Object.values(BILLING_SUBSCRIPTION_STATUS))
  );
};

const getEntitlementPressureSummary = async () => {
  const entitlements = await Entitlement.find({
    deletedAt: null,
  })
    .select('features limits usage')
    .lean();

  return entitlements.reduce(
    (summary, entitlementDocument) => {
      const entitlement = normalizeEntitlementSnapshot(entitlementDocument);
      const overLimit = entitlement.overLimit || {};
      const features = entitlement.features || {};

      return {
        workspacesWithEntitlements: summary.workspacesWithEntitlements + 1,
        overSeatLimit: summary.overSeatLimit + (overLimit.seats ? 1 : 0),
        overMailboxLimit:
          summary.overMailboxLimit + (overLimit.mailboxes ? 1 : 0),
        overStorageLimit:
          summary.overStorageLimit + (overLimit.storageBytes ? 1 : 0),
        overUploadsPerMonthLimit:
          summary.overUploadsPerMonthLimit +
          (overLimit.uploadsPerMonth ? 1 : 0),
        overTicketsPerMonthLimit:
          summary.overTicketsPerMonthLimit +
          (overLimit.ticketsPerMonth ? 1 : 0),
        anyOverLimit: summary.anyOverLimit + (overLimit.any ? 1 : 0),
        slaDisabled: summary.slaDisabled + (features.slaEnabled === false ? 1 : 0),
      };
    },
    {
      workspacesWithEntitlements: 0,
      overSeatLimit: 0,
      overMailboxLimit: 0,
      overStorageLimit: 0,
      overUploadsPerMonthLimit: 0,
      overTicketsPerMonthLimit: 0,
      anyOverLimit: 0,
      slaDisabled: 0,
    }
  );
};

const buildPlanAndAddonMaps = async (subscriptions) => {
  const planIds = new Set();
  const planKeys = new Set();
  const addonIds = new Set();
  const addonKeys = new Set();

  for (const subscription of subscriptions) {
    if (subscription.planId) {
      planIds.add(normalizeObjectId(subscription.planId));
    }

    if (subscription.planKey) {
      planKeys.add(subscription.planKey);
    }

    for (const item of subscription.addonItems || []) {
      if (item?.addonId) {
        addonIds.add(normalizeObjectId(item.addonId));
      }

      if (item?.addonKey) {
        addonKeys.add(item.addonKey);
      }
    }
  }

  const [plans, addons] = await Promise.all([
    planIds.size || planKeys.size
      ? Plan.find({
          $or: [
            ...(planIds.size ? [{ _id: { $in: [...planIds] } }] : []),
            ...(planKeys.size ? [{ key: { $in: [...planKeys] } }] : []),
          ],
        }).lean()
      : [],
    addonIds.size || addonKeys.size
      ? Addon.find({
          $or: [
            ...(addonIds.size ? [{ _id: { $in: [...addonIds] } }] : []),
            ...(addonKeys.size ? [{ key: { $in: [...addonKeys] } }] : []),
          ],
        }).lean()
      : [],
  ]);

  return {
    plansById: new Map(plans.map((plan) => [normalizeObjectId(plan._id), plan])),
    plansByKey: new Map(plans.map((plan) => [plan.key, plan])),
    addonsById: new Map(
      addons.map((addon) => [normalizeObjectId(addon._id), addon])
    ),
    addonsByKey: new Map(addons.map((addon) => [addon.key, addon])),
  };
};

const resolvePlanForSubscription = (subscription, planMaps) =>
  (subscription.planId &&
    planMaps.plansById.get(normalizeObjectId(subscription.planId))) ||
  (subscription.planKey && planMaps.plansByKey.get(subscription.planKey)) ||
  null;

const resolveAddonForSubscriptionItem = (item, addonMaps) =>
  (item?.addonId && addonMaps.addonsById.get(normalizeObjectId(item.addonId))) ||
  (item?.addonKey && addonMaps.addonsByKey.get(item.addonKey)) ||
  null;

const buildRevenueSummary = async ({ visible, subscriptions }) => {
  if (!visible) {
    return {
      visible: false,
      currentMrrCents: null,
      currency: null,
      managedSubscriptionCount: 0,
      source: null,
    };
  }

  const managedSubscriptions = subscriptions.filter(
    (subscription) =>
      typeof subscription.stripeSubscriptionId === 'string' &&
      subscription.stripeSubscriptionId.trim() &&
      REVENUE_ACTIVE_STATUSES.has(subscription.status)
  );

  if (!managedSubscriptions.length) {
    return {
      visible: true,
      currentMrrCents: 0,
      currency: billingConfig.currency,
      managedSubscriptionCount: 0,
      unsupportedSubscriptionCount: 0,
      source: 'managed_subscription_snapshot',
    };
  }

  const maps = await buildPlanAndAddonMaps(managedSubscriptions);
  let currentMrrCents = 0;
  let unsupportedSubscriptionCount = 0;

  for (const subscription of managedSubscriptions) {
    const plan = resolvePlanForSubscription(subscription, maps);

    if (!plan || typeof plan.price !== 'number') {
      unsupportedSubscriptionCount += 1;
      continue;
    }

    let subscriptionMrrCents = Number(plan.price || 0) * 100;
    let supported = true;

    for (const item of subscription.addonItems || []) {
      const addon = resolveAddonForSubscriptionItem(item, maps);

      if (!addon || typeof addon.price !== 'number') {
        supported = false;
        break;
      }

      subscriptionMrrCents +=
        Number(addon.price || 0) *
        100 *
        Math.max(1, Number(item.quantity || 1));
    }

    if (!supported) {
      unsupportedSubscriptionCount += 1;
      continue;
    }

    currentMrrCents += subscriptionMrrCents;
  }

  return {
    visible: true,
    currentMrrCents,
    currency: billingConfig.currency,
    managedSubscriptionCount: managedSubscriptions.length,
    unsupportedSubscriptionCount,
    source: 'managed_subscription_snapshot',
  };
};

const buildPlanDistribution = async (subscriptions) => {
  if (!subscriptions.length) {
    return [];
  }

  const maps = await buildPlanAndAddonMaps(subscriptions);
  const counts = {};

  for (const subscription of subscriptions) {
    const plan = resolvePlanForSubscription(subscription, maps);
    const key = plan?.key || subscription.planKey || 'unknown';
    const label = plan?.name || subscription.planKey || 'Unknown';

    if (!counts[key]) {
      counts[key] = {
        key,
        label,
        count: 0,
      };
    }

    counts[key].count += 1;
  }

  return Object.values(counts).sort(sortByCountDesc);
};

const buildSubscriptionStatusDistribution = (counts) =>
  toDistribution(counts, (key, count) => ({
    key,
    label: key,
    count,
  }));

const getBillingLifecycleSummary = (subscriptions) => {
  const now = Date.now();

  return subscriptions.reduce(
    (summary, subscription) => ({
      trialing: summary.trialing + (subscription.status === BILLING_SUBSCRIPTION_STATUS.TRIALING ? 1 : 0),
      pastDue: summary.pastDue + (subscription.status === BILLING_SUBSCRIPTION_STATUS.PAST_DUE ? 1 : 0),
      incomplete:
        summary.incomplete +
        (subscription.status === BILLING_SUBSCRIPTION_STATUS.INCOMPLETE ? 1 : 0),
      incompleteExpired:
        summary.incompleteExpired +
        (subscription.status === BILLING_SUBSCRIPTION_STATUS.INCOMPLETE_EXPIRED ? 1 : 0),
      canceled: summary.canceled + (subscription.status === BILLING_SUBSCRIPTION_STATUS.CANCELED ? 1 : 0),
      inGracePeriod:
        summary.inGracePeriod +
        (subscription.status === BILLING_SUBSCRIPTION_STATUS.PAST_DUE &&
        subscription.graceEndsAt &&
        new Date(subscription.graceEndsAt).getTime() >= now
          ? 1
          : 0),
      partialBlockActive:
        summary.partialBlockActive +
        (subscription.partialBlockStartsAt &&
        new Date(subscription.partialBlockStartsAt).getTime() <= now
          ? 1
          : 0),
      cancelAtPeriodEnd:
        summary.cancelAtPeriodEnd + (subscription.cancelAtPeriodEnd ? 1 : 0),
      providerManaged:
        summary.providerManaged +
        (subscription.stripeSubscriptionId ? 1 : 0),
    }),
    {
      trialing: 0,
      pastDue: 0,
      incomplete: 0,
      incompleteExpired: 0,
      canceled: 0,
      inGracePeriod: 0,
      partialBlockActive: 0,
      cancelAtPeriodEnd: 0,
      providerManaged: 0,
    }
  );
};

const loadBillingSubscriptions = async () =>
  Subscription.find({
    deletedAt: null,
  })
    .select(
      '_id planId planKey addonItems status stripeSubscriptionId cancelAtPeriodEnd graceEndsAt partialBlockStartsAt currentPeriodEnd trialEndsAt'
    )
    .lean();

const getMetricsSnapshots = async (filters) => {
  const fromKey = filters.from.toISOString().slice(0, 10);
  const toKey = filters.to.toISOString().slice(0, 10);

  return PlatformMetricDaily.find({
    dateKey: {
      $gte: fromKey,
      $lte: toKey,
    },
  })
    .sort({ dateKey: 1 })
    .select('dateKey totals createdAt updatedAt')
    .lean();
};

const buildMetricsSeries = ({ snapshots, filters, revenueVisible }) => {
  const buckets = buildMetricsBuckets(filters);
  const bucketMap = new Map(
    buckets.map((bucket) => [
      bucket.key,
      {
        key: bucket.key,
        start: bucket.start,
        end: bucket.end,
        latestDateKey: null,
        totals: {
          workspacesCount: null,
          activeUsersCount: null,
          ticketsCount: null,
          revenueCents: null,
        },
      },
    ])
  );

  for (const snapshot of snapshots) {
    const key = formatMetricsBucketKey(snapshot.dateKey, filters.groupBy);
    const bucket = bucketMap.get(key);

    if (!bucket) {
      continue;
    }

    if (!bucket.latestDateKey || snapshot.dateKey > bucket.latestDateKey) {
      bucket.latestDateKey = snapshot.dateKey;
      bucket.totals = {
        workspacesCount:
          typeof snapshot?.totals?.workspacesCount === 'number'
            ? Number(snapshot.totals.workspacesCount)
            : null,
        activeUsersCount:
          typeof snapshot?.totals?.activeUsersCount === 'number'
            ? Number(snapshot.totals.activeUsersCount)
            : null,
        ticketsCount:
          typeof snapshot?.totals?.ticketsCount === 'number'
            ? Number(snapshot.totals.ticketsCount)
            : null,
        revenueCents:
          revenueVisible && typeof snapshot?.totals?.revenueCents === 'number'
            ? Number(snapshot.totals.revenueCents)
            : null,
      };
    }
  }

  const resolvedBuckets = buckets.map((bucket) => bucketMap.get(bucket.key));
  const buildSeries = (field) =>
    resolvedBuckets.map((bucket) => ({
      key: bucket.key,
      start: bucket.start,
      end: bucket.end,
      sourceDateKey: bucket.latestDateKey,
      value: bucket.totals[field],
    }));

  const revenueSeries = revenueVisible ? buildSeries('revenueCents') : null;

  return {
    coverage: {
      expectedBuckets: buckets.length,
      bucketsWithSnapshots: resolvedBuckets.filter((bucket) => bucket.latestDateKey).length,
      availableDailySnapshots: snapshots.length,
      isComplete:
        snapshots.length > 0 &&
        resolvedBuckets.every((bucket) => Boolean(bucket.latestDateKey)),
      aggregationMethod: 'latest_snapshot_in_bucket',
    },
    series: {
      workspaces: buildSeries('workspacesCount'),
      activeUsers: buildSeries('activeUsersCount'),
      tickets: buildSeries('ticketsCount'),
      ...(revenueVisible ? { revenue: revenueSeries } : {}),
    },
  };
};

export const getAdminOverview = async ({ platformAdmin }) => {
  const overviewRange = getOverviewRange();
  const [workspaceStatusCounts, activeUsersCount, totalTicketsCount, ticketsInRangeCount, totalMailboxesCount, totalStorageBytes, subscriptionStatusCounts, entitlementPressureSummary, subscriptions] =
    await Promise.all([
      getWorkspaceStatusCounts(),
      User.countDocuments({
        deletedAt: null,
        status: 'active',
      }),
      Ticket.countDocuments({
        deletedAt: null,
      }),
      Ticket.countDocuments({
        deletedAt: null,
        createdAt: {
          $gte: overviewRange.from,
          $lte: overviewRange.to,
        },
      }),
      Mailbox.countDocuments({
        deletedAt: null,
      }),
      getCurrentStorageBytes(),
      getSubscriptionStatusCounts(),
      getEntitlementPressureSummary(),
      loadBillingSubscriptions(),
    ]);

  const totalWorkspaces = Object.values(workspaceStatusCounts).reduce(
    (sum, count) => sum + Number(count || 0),
    0
  );
  const revenue = await buildRevenueSummary({
    visible: isRevenueVisible(platformAdmin),
    subscriptions,
  });

  return {
    overview: {
      ...buildBaseAnalyticsPayload({
        area: 'overview',
        visibility: 'platform_admin',
        platformAdmin,
      }),
      kpis: {
        totalWorkspaces,
        activeWorkspaces: Number(workspaceStatusCounts.active || 0),
        suspendedWorkspaces: Number(workspaceStatusCounts.suspended || 0),
        trialWorkspaces: Number(workspaceStatusCounts.trial || 0),
        activeUsersCount: Number(activeUsersCount || 0),
        totalTicketsCount: Number(totalTicketsCount || 0),
        ticketsCreatedLast30Days: Number(ticketsInRangeCount || 0),
      },
      billing: {
        statusCounts: subscriptionStatusCounts,
        revenue,
      },
      operational: {
        totalMailboxesCount: Number(totalMailboxesCount || 0),
        totalStorageBytes: Number(totalStorageBytes || 0),
        usagePressure: entitlementPressureSummary,
      },
      activityWindow: {
        from: overviewRange.from.toISOString(),
        to: overviewRange.to.toISOString(),
      },
    },
  };
};

export const getAdminMetrics = async ({ platformAdmin, query = {} }) => {
  const filters = normalizeAdminMetricsFilters(query);
  const snapshots = await getMetricsSnapshots(filters);
  const revenueVisible = isRevenueVisible(platformAdmin);
  const metrics = buildMetricsSeries({
    snapshots,
    filters,
    revenueVisible,
  });

  return {
    metrics: {
      ...buildBaseAnalyticsPayload({
        area: 'metrics',
        visibility: 'platform_admin',
        platformAdmin,
        filters,
      }),
      ...metrics,
      historicalDataSource: 'platform_metric_daily',
      availableSections: {
        workspaces: metrics.series.workspaces.some((item) => item.value !== null),
        activeUsers: metrics.series.activeUsers.some((item) => item.value !== null),
        tickets: metrics.series.tickets.some((item) => item.value !== null),
        revenue:
          revenueVisible && metrics.series.revenue
            ? metrics.series.revenue.some((item) => item.value !== null)
            : false,
      },
    },
  };
};

export const getAdminBillingOverview = async ({ platformAdmin }) => {
  const subscriptions = await loadBillingSubscriptions();
  const [statusCounts, planDistribution, entitlementPressureSummary, revenue] =
    await Promise.all([
      getSubscriptionStatusCounts(),
      buildPlanDistribution(subscriptions),
      getEntitlementPressureSummary(),
      buildRevenueSummary({
        visible: isRevenueVisible(platformAdmin),
        subscriptions,
      }),
    ]);

  return {
    billingOverview: {
      ...buildBaseAnalyticsPayload({
        area: 'billing_overview',
        visibility: 'super_admin',
        platformAdmin,
      }),
      subscriptionStatus: {
        counts: statusCounts,
        distribution: buildSubscriptionStatusDistribution(statusCounts),
      },
      plans: {
        distribution: planDistribution,
      },
      lifecycle: getBillingLifecycleSummary(subscriptions),
      usagePressure: entitlementPressureSummary,
      revenue,
    },
  };
};
