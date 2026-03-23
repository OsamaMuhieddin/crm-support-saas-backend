import {
  normalizeWeeklySchedule,
  parseTimeStringToMinutes,
} from './business-hours.helpers.js';

const WEEKDAY_INDEX_BY_NAME = Object.freeze({
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
});

const formatterCache = new Map();

const roundMinutes = (value) => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Number(value.toFixed(3));
};

const getFormatter = (timeZone) => {
  const cacheKey = String(timeZone || '').trim();

  if (!formatterCache.has(cacheKey)) {
    formatterCache.set(
      cacheKey,
      new Intl.DateTimeFormat('en-US', {
        timeZone: cacheKey,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
        hourCycle: 'h23',
      })
    );
  }

  return formatterCache.get(cacheKey);
};

const padNumber = (value) => String(value).padStart(2, '0');

const getUtcDateParts = (date) => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate(),
});

const compareLocalDateParts = (left, right) => {
  if (left.year !== right.year) {
    return left.year - right.year;
  }

  if (left.month !== right.month) {
    return left.month - right.month;
  }

  return left.day - right.day;
};

const addDaysToLocalDate = (localDate, days) => {
  const shifted = new Date(
    Date.UTC(localDate.year, localDate.month - 1, localDate.day + days)
  );

  return getUtcDateParts(shifted);
};

const getScheduleDay = ({ businessHours, dayOfWeek }) =>
  normalizeWeeklySchedule(businessHours?.weeklySchedule || []).find(
    (day) => day.dayOfWeek === dayOfWeek
  ) || {
    dayOfWeek,
    isOpen: false,
    windows: [],
  };

export const resolveBusinessLocalDateTime = ({ at, timeZone }) => {
  const formatter = getFormatter(timeZone);
  const parts = formatter.formatToParts(new Date(at));

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: WEEKDAY_INDEX_BY_NAME[values.weekday] ?? null,
  };
};

export const getTimeZoneOffsetMinutes = ({ at, timeZone }) => {
  const localParts = resolveBusinessLocalDateTime({ at, timeZone });
  const localAsUtc = Date.UTC(
    localParts.year,
    localParts.month - 1,
    localParts.day,
    localParts.hour,
    localParts.minute,
    localParts.second,
    0
  );

  return (localAsUtc - new Date(at).getTime()) / 60000;
};

export const convertBusinessLocalDateTimeToUtc = ({
  year,
  month,
  day,
  hour = 0,
  minute = 0,
  second = 0,
  timeZone,
}) => {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, second, 0);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const offsetMinutes = getTimeZoneOffsetMinutes({
      at: new Date(utcMs),
      timeZone,
    });
    const adjustedUtcMs =
      Date.UTC(year, month - 1, day, hour, minute, second, 0) -
      offsetMinutes * 60000;

    if (Math.abs(adjustedUtcMs - utcMs) < 1000) {
      utcMs = adjustedUtcMs;
      break;
    }

    utcMs = adjustedUtcMs;
  }

  return new Date(utcMs);
};

export const buildBusinessWindowRangeForLocalDate = ({
  localDate,
  window,
  timeZone,
}) => {
  const startMinutes = parseTimeStringToMinutes(window.start);
  const endMinutes = parseTimeStringToMinutes(window.end);

  if (
    startMinutes === null ||
    endMinutes === null ||
    startMinutes >= endMinutes
  ) {
    return null;
  }

  const startAt = convertBusinessLocalDateTimeToUtc({
    year: localDate.year,
    month: localDate.month,
    day: localDate.day,
    hour: Math.floor(startMinutes / 60),
    minute: startMinutes % 60,
    timeZone,
  });
  const endAt = convertBusinessLocalDateTimeToUtc({
    year: localDate.year,
    month: localDate.month,
    day: localDate.day,
    hour: Math.floor(endMinutes / 60),
    minute: endMinutes % 60,
    timeZone,
  });

  return {
    startAt,
    endAt,
  };
};

export const listBusinessWindowRangesForLocalDate = ({
  businessHours,
  localDate,
}) => {
  const timeZone =
    businessHours?.timezone || businessHours?.businessHoursTimezone;
  const dayOfWeek = new Date(
    Date.UTC(localDate.year, localDate.month - 1, localDate.day)
  ).getUTCDay();
  const scheduleDay = getScheduleDay({
    businessHours,
    dayOfWeek,
  });

  if (!timeZone || scheduleDay.isOpen !== true) {
    return [];
  }

  return (scheduleDay.windows || [])
    .map((window) =>
      buildBusinessWindowRangeForLocalDate({
        localDate,
        window,
        timeZone,
      })
    )
    .filter(Boolean)
    .sort((left, right) => left.startAt - right.startAt);
};

export const isWithinBusinessWindow = ({ at, businessHours }) => {
  const currentAt = new Date(at);
  const localDateTime = resolveBusinessLocalDateTime({
    at: currentAt,
    timeZone: businessHours.timezone,
  });
  const windows = listBusinessWindowRangesForLocalDate({
    businessHours,
    localDate: localDateTime,
  });

  return windows.some(
    (window) => currentAt >= window.startAt && currentAt < window.endAt
  );
};

export const getNextBusinessStart = ({ at, businessHours }) => {
  const currentAt = new Date(at);
  const localDateTime = resolveBusinessLocalDateTime({
    at: currentAt,
    timeZone: businessHours.timezone,
  });

  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const localDate =
      dayOffset === 0
        ? {
            year: localDateTime.year,
            month: localDateTime.month,
            day: localDateTime.day,
          }
        : addDaysToLocalDate(localDateTime, dayOffset);
    const windows = listBusinessWindowRangesForLocalDate({
      businessHours,
      localDate,
    });

    for (const window of windows) {
      if (currentAt >= window.startAt && currentAt < window.endAt) {
        return currentAt;
      }

      if (currentAt < window.startAt) {
        return window.startAt;
      }
    }
  }

  return null;
};

const findActiveOrNextBusinessWindow = ({ at, businessHours }) => {
  const currentAt = new Date(at);
  const localDateTime = resolveBusinessLocalDateTime({
    at: currentAt,
    timeZone: businessHours.timezone,
  });

  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const localDate =
      dayOffset === 0
        ? {
            year: localDateTime.year,
            month: localDateTime.month,
            day: localDateTime.day,
          }
        : addDaysToLocalDate(localDateTime, dayOffset);
    const windows = listBusinessWindowRangesForLocalDate({
      businessHours,
      localDate,
    });

    for (const window of windows) {
      if (currentAt < window.endAt) {
        return window;
      }
    }
  }

  return null;
};

export const addBusinessMinutes = ({ startAt, minutes, businessHours }) => {
  if (minutes === null || minutes === undefined) {
    return null;
  }

  const numericMinutes = Number(minutes);

  if (!Number.isFinite(numericMinutes) || numericMinutes < 0) {
    return null;
  }

  if (numericMinutes === 0) {
    return new Date(startAt);
  }

  let remainingMinutes = numericMinutes;
  let cursor = new Date(startAt);

  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const window = findActiveOrNextBusinessWindow({
      at: cursor,
      businessHours,
    });

    if (!window) {
      return null;
    }

    const segmentStartAt = cursor > window.startAt ? cursor : window.startAt;
    const availableMinutes =
      (window.endAt.getTime() - segmentStartAt.getTime()) / 60000;

    if (remainingMinutes <= availableMinutes) {
      return new Date(segmentStartAt.getTime() + remainingMinutes * 60000);
    }

    remainingMinutes -= availableMinutes;
    cursor = new Date(window.endAt);
  }

  return null;
};

export const calculateBusinessMinutesBetween = ({
  startAt,
  endAt,
  businessHours,
}) => {
  const startDate = new Date(startAt);
  const endDate = new Date(endAt);

  if (!(startDate instanceof Date) || !(endDate instanceof Date)) {
    return 0;
  }

  if (endDate <= startDate) {
    return 0;
  }

  let totalMinutes = 0;
  let cursor = startDate;

  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const window = findActiveOrNextBusinessWindow({
      at: cursor,
      businessHours,
    });

    if (!window || window.startAt >= endDate) {
      break;
    }

    const segmentStartAt = cursor > window.startAt ? cursor : window.startAt;
    const segmentEndAt = endDate < window.endAt ? endDate : window.endAt;

    if (segmentEndAt > segmentStartAt) {
      totalMinutes +=
        (segmentEndAt.getTime() - segmentStartAt.getTime()) / 60000;
    }

    if (segmentEndAt >= endDate) {
      break;
    }

    cursor = new Date(window.endAt);
  }

  return roundMinutes(totalMinutes);
};

export const formatBusinessLocalDateKey = ({ at, timeZone }) => {
  const localDateTime = resolveBusinessLocalDateTime({
    at,
    timeZone,
  });

  return `${localDateTime.year}-${padNumber(localDateTime.month)}-${padNumber(
    localDateTime.day
  )}`;
};

export const compareBusinessLocalDates = ({ leftAt, rightAt, timeZone }) =>
  compareLocalDateParts(
    getUtcDateParts(
      convertBusinessLocalDateTimeToUtc({
        ...resolveBusinessLocalDateTime({
          at: leftAt,
          timeZone,
        }),
        timeZone,
      })
    ),
    getUtcDateParts(
      convertBusinessLocalDateTimeToUtc({
        ...resolveBusinessLocalDateTime({
          at: rightAt,
          timeZone,
        }),
        timeZone,
      })
    )
  );
