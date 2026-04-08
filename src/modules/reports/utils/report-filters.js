import { buildValidationError } from '../../../shared/middlewares/validate.js';
import { toObjectIdIfValid } from '../../../shared/utils/object-id.js';

export const REPORT_GROUP_BY_VALUES = ['day', 'week', 'month'];
export const REPORT_ALLOWED_QUERY_FIELDS = [
  'from',
  'to',
  'groupBy',
  'mailboxId',
  'assigneeId',
  'priority',
  'categoryId',
  'tagId',
];
export const MAX_REPORT_RANGE_DAYS = 366;

const DEFAULT_RANGE_DAYS = 30;

const toDateOrNull = (value) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const startOfUtcDay = (value) => {
  const date = new Date(value);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
};

const endOfUtcDay = (value) => {
  const date = startOfUtcDay(value);
  date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCMilliseconds(date.getUTCMilliseconds() - 1);
  return date;
};

const addUtcDays = (value, days) => {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
};

const startOfUtcWeek = (value) => {
  const date = startOfUtcDay(value);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addUtcDays(date, diff);
};

const startOfUtcMonth = (value) => {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
};

const endOfBucket = (start, groupBy) => {
  const next = new Date(start);

  if (groupBy === 'month') {
    next.setUTCMonth(next.getUTCMonth() + 1);
  } else if (groupBy === 'week') {
    next.setUTCDate(next.getUTCDate() + 7);
  } else {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  next.setUTCMilliseconds(next.getUTCMilliseconds() - 1);
  return next;
};

export const buildAllowedReportsQueryValidation = () => (req) => {
  const query = req.query || {};
  const unknownFields = Object.keys(query).filter(
    (field) => !REPORT_ALLOWED_QUERY_FIELDS.includes(field)
  );

  return unknownFields.map((field) =>
    buildValidationError(field, 'errors.validation.unknownField')
  );
};

export const normalizeReportFilters = (query = {}) => {
  const today = new Date();
  const rawFrom = toDateOrNull(query.from);
  const rawTo = toDateOrNull(query.to);

  const to = rawTo ? endOfUtcDay(rawTo) : endOfUtcDay(today);
  const from = rawFrom
    ? startOfUtcDay(rawFrom)
    : startOfUtcDay(addUtcDays(to, -(DEFAULT_RANGE_DAYS - 1)));

  return {
    from,
    to,
    groupBy: REPORT_GROUP_BY_VALUES.includes(query.groupBy)
      ? query.groupBy
      : 'day',
    mailboxId: query.mailboxId ? String(query.mailboxId) : null,
    assigneeId: query.assigneeId ? String(query.assigneeId) : null,
    priority: query.priority ? String(query.priority) : null,
    categoryId: query.categoryId ? String(query.categoryId) : null,
    tagId: query.tagId ? String(query.tagId) : null,
  };
};

export const serializeReportFilters = (filters) => ({
  from: filters.from.toISOString(),
  to: filters.to.toISOString(),
  groupBy: filters.groupBy,
  mailboxId: filters.mailboxId,
  assigneeId: filters.assigneeId,
  priority: filters.priority,
  categoryId: filters.categoryId,
  tagId: filters.tagId,
});

export const buildTicketScopeMatch = ({ workspaceId, filters }) => {
  const match = {
    workspaceId: toObjectIdIfValid(workspaceId),
    deletedAt: null,
  };

  if (filters.mailboxId) {
    match.mailboxId = toObjectIdIfValid(filters.mailboxId);
  }

  if (filters.assigneeId) {
    match.assigneeId = toObjectIdIfValid(filters.assigneeId);
  }

  if (filters.priority) {
    match.priority = filters.priority;
  }

  if (filters.categoryId) {
    match.categoryId = toObjectIdIfValid(filters.categoryId);
  }

  if (filters.tagId) {
    match.tagIds = toObjectIdIfValid(filters.tagId);
  }

  return match;
};

const buildDateRangeMatch = (field, filters) => ({
  [field]: {
    $gte: filters.from,
    $lte: filters.to,
  },
});

export const buildCreatedTicketMatch = ({ workspaceId, filters }) => ({
  ...buildTicketScopeMatch({ workspaceId, filters }),
  ...buildDateRangeMatch('createdAt', filters),
});

export const buildSolvedTicketMatch = ({ workspaceId, filters }) => ({
  ...buildTicketScopeMatch({ workspaceId, filters }),
  $or: [
    buildDateRangeMatch('sla.resolvedAt', filters),
    {
      status: 'solved',
      ...buildDateRangeMatch('statusChangedAt', filters),
    },
  ],
});

export const buildClosedTicketMatch = ({ workspaceId, filters }) => ({
  ...buildTicketScopeMatch({ workspaceId, filters }),
  status: 'closed',
  ...buildDateRangeMatch('closedAt', filters),
});

export const isDateInRange = (value, filters) => {
  const date = toDateOrNull(value);

  if (!date) {
    return false;
  }

  return date >= filters.from && date <= filters.to;
};

export const isSolvedInRange = (ticket, filters) => {
  const resolvedAt = ticket?.sla?.resolvedAt;

  if (resolvedAt && isDateInRange(resolvedAt, filters)) {
    return true;
  }

  return ticket?.status === 'solved' && isDateInRange(ticket?.statusChangedAt, filters);
};

export const isClosedInRange = (ticket, filters) =>
  ticket?.status === 'closed' && isDateInRange(ticket?.closedAt, filters);

export const getBucketStart = (value, groupBy) => {
  if (groupBy === 'month') {
    return startOfUtcMonth(value);
  }

  if (groupBy === 'week') {
    return startOfUtcWeek(value);
  }

  return startOfUtcDay(value);
};

export const formatBucketKey = (value, groupBy) => {
  const date = getBucketStart(value, groupBy);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  if (groupBy === 'month') {
    return `${year}-${month}`;
  }

  return `${year}-${month}-${day}`;
};

export const buildTimeBuckets = (filters) => {
  const buckets = [];
  let current = getBucketStart(filters.from, filters.groupBy);

  while (current <= filters.to) {
    const start = new Date(current);
    const end = endOfBucket(start, filters.groupBy);

    buckets.push({
      key: formatBucketKey(start, filters.groupBy),
      start: start.toISOString(),
      end: end.toISOString(),
    });

    if (filters.groupBy === 'month') {
      current = new Date(
        Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1)
      );
    } else if (filters.groupBy === 'week') {
      current = addUtcDays(current, 7);
    } else {
      current = addUtcDays(current, 1);
    }
  }

  return buckets;
};
