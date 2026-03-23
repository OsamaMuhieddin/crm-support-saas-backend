import { TICKET_STATUS } from '../../../constants/ticket-status.js';
import { toObjectIdIfValid } from '../../../shared/utils/object-id.js';
import { BusinessHours } from '../models/business-hours.model.js';
import { SlaPolicy } from '../models/sla-policy.model.js';
import { normalizeWeeklySchedule } from '../utils/business-hours.helpers.js';
import {
  addBusinessMinutes,
  calculateBusinessMinutesBetween,
} from '../utils/business-time.helpers.js';
import {
  getSlaRuleForPriority,
  resolveSlaSelection,
} from '../utils/sla-policy.helpers.js';

const ACTIVE_RESOLUTION_STATUSES = new Set([
  TICKET_STATUS.NEW,
  TICKET_STATUS.OPEN,
  TICKET_STATUS.PENDING,
]);

const roundMinutes = (value) => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Number(value.toFixed(3));
};

const hasResolvedStatus = (status) =>
  status === TICKET_STATUS.SOLVED || status === TICKET_STATUS.CLOSED;

const hasFirstResponseSla = (sla = {}) =>
  sla.firstResponseTargetMinutes !== null &&
  sla.firstResponseTargetMinutes !== undefined;

const hasResolutionSla = (sla = {}) =>
  sla.resolutionTargetMinutes !== null &&
  sla.resolutionTargetMinutes !== undefined;

const buildBusinessHoursSnapshot = (businessHours) => ({
  businessHoursId: businessHours?._id || null,
  businessHoursName: businessHours?.name || null,
  businessHoursTimezone: businessHours?.timezone || null,
  businessHoursWeeklySchedule: normalizeWeeklySchedule(
    businessHours?.weeklySchedule || []
  ),
});

const getTicketSlaBusinessHours = (sla = {}) => {
  if (!sla.businessHoursTimezone) {
    return null;
  }

  return {
    timezone: sla.businessHoursTimezone,
    weeklySchedule: normalizeWeeklySchedule(
      sla.businessHoursWeeklySchedule || []
    ),
  };
};

const markFirstResponseBreach = (sla = {}) => {
  if (!sla.firstResponseDueAt) {
    return;
  }

  sla.isFirstResponseBreached = true;

  if (!sla.firstResponseBreachedAt) {
    sla.firstResponseBreachedAt = sla.firstResponseDueAt;
  }
};

const markResolutionBreach = (sla = {}) => {
  sla.isResolutionBreached = true;

  if (!sla.resolutionBreachedAt && sla.resolutionDueAt) {
    sla.resolutionBreachedAt = sla.resolutionDueAt;
  }
};

const syncLegacyRemainingAliases = (sla = {}) => {
  sla.firstResponseRemainingMinutes =
    sla.firstResponseAt || !hasFirstResponseSla(sla)
      ? 0
      : sla.firstResponseTargetMinutes;
  sla.resolutionRemainingMinutes = hasResolutionSla(sla)
    ? sla.resolutionRemainingBusinessMinutes
    : null;
};

const consumeResolutionBusinessMinutes = ({
  sla,
  at,
  clearRunningSince = false,
}) => {
  if (!hasResolutionSla(sla) || !sla.resolutionRunningSince) {
    return 0;
  }

  const businessHours = getTicketSlaBusinessHours(sla);

  if (!businessHours) {
    if (clearRunningSince) {
      sla.resolutionRunningSince = null;
    }
    return 0;
  }

  const consumedIncrement = calculateBusinessMinutesBetween({
    startAt: sla.resolutionRunningSince,
    endAt: at,
    businessHours,
  });

  if (consumedIncrement > 0) {
    const nextConsumed = roundMinutes(
      Number(sla.resolutionConsumedBusinessMinutes || 0) + consumedIncrement
    );
    const remaining = roundMinutes(
      Math.max(0, Number(sla.resolutionTargetMinutes || 0) - nextConsumed)
    );

    sla.resolutionConsumedBusinessMinutes = nextConsumed;
    sla.resolutionRemainingBusinessMinutes = remaining;
  }

  if (sla.resolutionDueAt && new Date(at) > new Date(sla.resolutionDueAt)) {
    markResolutionBreach(sla);
  }

  sla.resolutionRunningSince = clearRunningSince ? null : new Date(at);
  syncLegacyRemainingAliases(sla);

  return consumedIncrement;
};

const pauseResolutionSla = ({ sla, at }) => {
  if (!hasResolutionSla(sla) || sla.isResolutionPaused === true) {
    return;
  }

  consumeResolutionBusinessMinutes({
    sla,
    at,
    clearRunningSince: true,
  });

  sla.isResolutionPaused = true;
  sla.resolutionPausedAt = new Date(at);
  sla.resolutionDueAt = null;
  syncLegacyRemainingAliases(sla);
};

const resumeResolutionSla = ({ sla, at }) => {
  if (!hasResolutionSla(sla)) {
    return;
  }

  sla.isResolutionPaused = false;
  sla.resolutionPausedAt = null;
  sla.resolutionRunningSince = new Date(at);

  const remainingMinutes = Number(sla.resolutionRemainingBusinessMinutes ?? 0);

  if (remainingMinutes <= 0) {
    sla.resolutionDueAt = new Date(at);
    syncLegacyRemainingAliases(sla);
    return;
  }

  const businessHours = getTicketSlaBusinessHours(sla);

  sla.resolutionDueAt = businessHours
    ? addBusinessMinutes({
        startAt: at,
        minutes: remainingMinutes,
        businessHours,
      })
    : null;
  syncLegacyRemainingAliases(sla);
};

const clearResolvedStateForReopen = ({ sla, at }) => {
  sla.resolvedAt = null;

  if (!hasResolutionSla(sla)) {
    return;
  }

  sla.reopenCount = Number(sla.reopenCount || 0) + 1;

  if (Number(sla.resolutionRemainingBusinessMinutes ?? 0) < 0) {
    sla.resolutionRemainingBusinessMinutes = 0;
  }

  if (ACTIVE_RESOLUTION_STATUSES.has(at.nextStatus)) {
    resumeResolutionSla({
      sla,
      at: at.eventAt,
    });
    return;
  }

  if (at.nextStatus === TICKET_STATUS.WAITING_ON_CUSTOMER) {
    sla.isResolutionPaused = true;
    sla.resolutionPausedAt = new Date(at.eventAt);
    sla.resolutionRunningSince = null;
    sla.resolutionDueAt = null;
    syncLegacyRemainingAliases(sla);
  }
};

const resolveResolutionSla = ({ sla, at }) => {
  if (!hasResolutionSla(sla)) {
    return;
  }

  if (sla.isResolutionPaused !== true) {
    consumeResolutionBusinessMinutes({
      sla,
      at,
      clearRunningSince: true,
    });
  }

  sla.isResolutionPaused = false;
  sla.resolutionPausedAt = null;
  sla.resolutionRunningSince = null;
  sla.resolvedAt = new Date(at);

  if (
    sla.isResolutionBreached === true ||
    Number(sla.resolutionRemainingBusinessMinutes ?? 0) <= 0 ||
    (sla.resolutionDueAt && new Date(at) > new Date(sla.resolutionDueAt))
  ) {
    markResolutionBreach(sla);
  }

  syncLegacyRemainingAliases(sla);
};

const shouldClearResolvedStateForTransition = ({ currentStatus, nextStatus }) =>
  hasResolvedStatus(currentStatus) && nextStatus !== TICKET_STATUS.CLOSED;

export const resolveTicketSlaSnapshot = async ({
  workspaceId,
  workspace,
  mailbox,
  priority,
  createdAt = new Date(),
}) => {
  const selection = resolveSlaSelection({
    mailbox,
    workspace,
  });

  if (!selection.policyId) {
    return {};
  }

  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const policy = await SlaPolicy.findOne({
    _id: toObjectIdIfValid(selection.policyId),
    workspaceId: workspaceObjectId,
    deletedAt: null,
    isActive: true,
  })
    .select('_id name businessHoursId rulesByPriority')
    .lean();

  if (!policy?.businessHoursId) {
    return {};
  }

  const businessHours = await BusinessHours.findOne({
    _id: policy.businessHoursId,
    workspaceId: workspaceObjectId,
    deletedAt: null,
  })
    .select('_id name timezone weeklySchedule')
    .lean();

  if (!businessHours?.timezone) {
    return {};
  }

  const rule = getSlaRuleForPriority({
    policy,
    priority,
  });
  const businessHoursSnapshot = buildBusinessHoursSnapshot(businessHours);
  const firstResponseTargetMinutes =
    rule.firstResponseMinutes !== null &&
    rule.firstResponseMinutes !== undefined
      ? Number(rule.firstResponseMinutes)
      : null;
  const resolutionTargetMinutes =
    rule.resolutionMinutes !== null && rule.resolutionMinutes !== undefined
      ? Number(rule.resolutionMinutes)
      : null;
  const businessHoursConfig = {
    timezone: businessHoursSnapshot.businessHoursTimezone,
    weeklySchedule: businessHoursSnapshot.businessHoursWeeklySchedule,
  };

  const snapshot = {
    policyId: policy._id,
    policyName: policy.name || null,
    policySource: selection.source,
    ...businessHoursSnapshot,
    firstResponseTargetMinutes,
    firstResponseRemainingMinutes: firstResponseTargetMinutes,
    firstResponseDueAt:
      firstResponseTargetMinutes === null
        ? null
        : addBusinessMinutes({
            startAt: createdAt,
            minutes: firstResponseTargetMinutes,
            businessHours: businessHoursConfig,
          }),
    firstResponseAt: null,
    firstResponseBreachedAt: null,
    isFirstResponseBreached: false,
    resolutionTargetMinutes,
    resolutionDueAt:
      resolutionTargetMinutes === null
        ? null
        : addBusinessMinutes({
            startAt: createdAt,
            minutes: resolutionTargetMinutes,
            businessHours: businessHoursConfig,
          }),
    resolvedAt: null,
    resolutionBreachedAt: null,
    isResolutionBreached: false,
    resolutionConsumedBusinessMinutes:
      resolutionTargetMinutes === null ? null : 0,
    resolutionRemainingBusinessMinutes: resolutionTargetMinutes,
    resolutionRemainingMinutes: resolutionTargetMinutes,
    resolutionPausedAt: null,
    isResolutionPaused: false,
    resolutionRunningSince:
      resolutionTargetMinutes === null ? null : new Date(createdAt),
    reopenCount: 0,
  };

  syncLegacyRemainingAliases(snapshot);

  return snapshot;
};

export const applyFirstResponseSlaOnPublicReply = ({ ticket, eventAt }) => {
  const sla = ticket?.sla;

  if (!sla || sla.firstResponseAt) {
    return;
  }

  sla.firstResponseAt = new Date(eventAt);

  if (!hasFirstResponseSla(sla)) {
    return;
  }

  sla.firstResponseRemainingMinutes = 0;

  if (
    sla.firstResponseDueAt &&
    new Date(eventAt) > new Date(sla.firstResponseDueAt)
  ) {
    markFirstResponseBreach(sla);
  }
};

export const applyTicketStatusTransitionSla = ({
  ticket,
  currentStatus,
  nextStatus,
  eventAt = new Date(),
}) => {
  if (!ticket?.sla || typeof ticket.sla !== 'object') {
    return;
  }

  const sla = ticket.sla;

  if (shouldClearResolvedStateForTransition({ currentStatus, nextStatus })) {
    clearResolvedStateForReopen({
      sla,
      at: {
        eventAt,
        nextStatus,
      },
    });
  }

  if (!hasResolutionSla(sla)) {
    if (nextStatus === TICKET_STATUS.SOLVED) {
      sla.resolvedAt = new Date(eventAt);
    }
    return;
  }

  if (nextStatus === TICKET_STATUS.WAITING_ON_CUSTOMER) {
    pauseResolutionSla({
      sla,
      at: eventAt,
    });
    return;
  }

  if (ACTIVE_RESOLUTION_STATUSES.has(nextStatus)) {
    if (sla.isResolutionPaused === true) {
      resumeResolutionSla({
        sla,
        at: eventAt,
      });
    }
    return;
  }

  if (nextStatus === TICKET_STATUS.SOLVED) {
    resolveResolutionSla({
      sla,
      at: eventAt,
    });
  }
};

export const deriveTicketSlaState = ({ sla = {}, now = new Date() }) => {
  const currentAt = new Date(now);
  const firstResponseApplicable = hasFirstResponseSla(sla);
  const resolutionApplicable = hasResolutionSla(sla);
  const derivedFirstResponseBreached =
    firstResponseApplicable &&
    (sla.isFirstResponseBreached === true ||
      (sla.firstResponseAt &&
        sla.firstResponseDueAt &&
        new Date(sla.firstResponseAt) > new Date(sla.firstResponseDueAt)) ||
      (!sla.firstResponseAt &&
        sla.firstResponseDueAt &&
        currentAt > new Date(sla.firstResponseDueAt)));
  const derivedResolutionBreached =
    resolutionApplicable &&
    (sla.isResolutionBreached === true ||
      (sla.resolvedAt &&
        sla.resolutionDueAt &&
        new Date(sla.resolvedAt) > new Date(sla.resolutionDueAt)) ||
      (!sla.resolvedAt &&
        sla.resolutionDueAt &&
        currentAt > new Date(sla.resolutionDueAt)) ||
      (!sla.resolvedAt &&
        Number(sla.resolutionRemainingBusinessMinutes ?? 1) <= 0));

  let firstResponseStatus = 'not_applicable';

  if (firstResponseApplicable) {
    if (derivedFirstResponseBreached) {
      firstResponseStatus = 'breached';
    } else if (sla.firstResponseAt) {
      firstResponseStatus = 'met';
    } else {
      firstResponseStatus = 'pending';
    }
  }

  let resolutionStatus = 'not_applicable';

  if (resolutionApplicable) {
    if (sla.resolvedAt && !derivedResolutionBreached) {
      resolutionStatus = 'met';
    } else if (derivedResolutionBreached) {
      resolutionStatus = 'breached';
    } else if (sla.isResolutionPaused === true) {
      resolutionStatus = 'paused';
    } else {
      resolutionStatus = 'running';
    }
  }

  return {
    firstResponseStatus,
    resolutionStatus,
    isFirstResponseBreached: derivedFirstResponseBreached,
    isResolutionBreached: derivedResolutionBreached,
    isApplicable: firstResponseApplicable || resolutionApplicable,
    isBreached: derivedFirstResponseBreached || derivedResolutionBreached,
  };
};
