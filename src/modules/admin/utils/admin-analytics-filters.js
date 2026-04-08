export const ADMIN_METRICS_GROUP_BY_VALUES = ['day', 'week', 'month'];
export const ADMIN_METRICS_ALLOWED_QUERY_FIELDS = ['from', 'to', 'groupBy'];

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

export const normalizeAdminMetricsFilters = (query = {}) => {
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
    groupBy: ADMIN_METRICS_GROUP_BY_VALUES.includes(query.groupBy)
      ? query.groupBy
      : 'day',
  };
};

export const serializeAdminMetricsFilters = (filters) => ({
  from: filters.from.toISOString(),
  to: filters.to.toISOString(),
  groupBy: filters.groupBy,
});

export const getMetricsBucketStart = (value, groupBy) => {
  if (groupBy === 'month') {
    return startOfUtcMonth(value);
  }

  if (groupBy === 'week') {
    return startOfUtcWeek(value);
  }

  return startOfUtcDay(value);
};

export const formatMetricsBucketKey = (value, groupBy) => {
  const date = getMetricsBucketStart(value, groupBy);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  if (groupBy === 'month') {
    return `${year}-${month}`;
  }

  return `${year}-${month}-${day}`;
};

export const buildMetricsBuckets = (filters) => {
  const buckets = [];
  let current = getMetricsBucketStart(filters.from, filters.groupBy);

  while (current <= filters.to) {
    const start = new Date(current);
    const end = endOfBucket(start, filters.groupBy);

    buckets.push({
      key: formatMetricsBucketKey(start, filters.groupBy),
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
