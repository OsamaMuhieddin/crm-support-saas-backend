const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const BUSINESS_HOURS_DAY_VALUES = Object.freeze([0, 1, 2, 3, 4, 5, 6]);

export const isValidIanaTimezone = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }

  try {
    new Intl.DateTimeFormat('en-US', {
      timeZone: value.trim(),
    });

    return true;
  } catch {
    return false;
  }
};

export const parseTimeStringToMinutes = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  const match = normalized.match(TIME_PATTERN);

  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
};

export const normalizeBusinessHoursWindow = (window = {}) => ({
  start: String(window.start || '').trim(),
  end: String(window.end || '').trim(),
});

export const sortBusinessHoursWindows = (windows = []) =>
  [...windows]
    .map((window) => normalizeBusinessHoursWindow(window))
    .sort((left, right) => {
      const leftStart = parseTimeStringToMinutes(left.start);
      const rightStart = parseTimeStringToMinutes(right.start);

      if (leftStart === null && rightStart === null) {
        return 0;
      }

      if (leftStart === null) {
        return 1;
      }

      if (rightStart === null) {
        return -1;
      }

      if (leftStart !== rightStart) {
        return leftStart - rightStart;
      }

      const leftEnd = parseTimeStringToMinutes(left.end);
      const rightEnd = parseTimeStringToMinutes(right.end);

      if (leftEnd === null && rightEnd === null) {
        return 0;
      }

      if (leftEnd === null) {
        return 1;
      }

      if (rightEnd === null) {
        return -1;
      }

      return leftEnd - rightEnd;
    });

export const buildClosedBusinessHoursDay = (dayOfWeek) => ({
  dayOfWeek,
  isOpen: false,
  windows: [],
});

export const normalizeBusinessHoursDay = (day = {}) => {
  const parsedDayOfWeek = Number(day.dayOfWeek);
  const dayOfWeek = Number.isInteger(parsedDayOfWeek) ? parsedDayOfWeek : null;
  const isOpen = day.isOpen === true;

  return {
    dayOfWeek,
    isOpen,
    windows: isOpen
      ? sortBusinessHoursWindows(Array.isArray(day.windows) ? day.windows : [])
      : [],
  };
};

export const normalizeWeeklySchedule = (weeklySchedule = []) => {
  const normalizedByDay = new Map();

  for (const day of Array.isArray(weeklySchedule) ? weeklySchedule : []) {
    const normalizedDay = normalizeBusinessHoursDay(day);

    if (BUSINESS_HOURS_DAY_VALUES.includes(normalizedDay.dayOfWeek)) {
      normalizedByDay.set(normalizedDay.dayOfWeek, normalizedDay);
    }
  }

  return BUSINESS_HOURS_DAY_VALUES.map(
    (dayOfWeek) => normalizedByDay.get(dayOfWeek) || buildClosedBusinessHoursDay(dayOfWeek)
  );
};

export const collectBusinessHoursScheduleIssues = (weeklySchedule) => {
  const issues = [];

  if (!Array.isArray(weeklySchedule)) {
    return [
      {
        field: 'weeklySchedule',
        messageKey: 'errors.validation.invalid',
      },
    ];
  }

  const seenDays = new Set();

  weeklySchedule.forEach((day, dayIndex) => {
    const baseField = `weeklySchedule[${dayIndex}]`;
    const parsedDayOfWeek = Number(day?.dayOfWeek);
    const dayOfWeek = Number.isInteger(parsedDayOfWeek) ? parsedDayOfWeek : null;

    if (!BUSINESS_HOURS_DAY_VALUES.includes(dayOfWeek)) {
      issues.push({
        field: `${baseField}.dayOfWeek`,
        messageKey: 'errors.validation.invalidEnum',
      });
    } else if (seenDays.has(dayOfWeek)) {
      issues.push({
        field: `${baseField}.dayOfWeek`,
        messageKey: 'errors.validation.duplicateValues',
      });
    } else {
      seenDays.add(dayOfWeek);
    }

    if (typeof day?.isOpen !== 'boolean') {
      issues.push({
        field: `${baseField}.isOpen`,
        messageKey: 'errors.validation.invalidBoolean',
      });
    }

    if (!Array.isArray(day?.windows)) {
      issues.push({
        field: `${baseField}.windows`,
        messageKey: 'errors.validation.invalid',
      });
      return;
    }

    const windows = sortBusinessHoursWindows(day.windows);

    if (day?.isOpen === true && windows.length === 0) {
      issues.push({
        field: `${baseField}.windows`,
        messageKey: 'errors.validation.invalid',
      });
    }

    if (day?.isOpen !== true && windows.length > 0) {
      issues.push({
        field: `${baseField}.windows`,
        messageKey: 'errors.validation.invalid',
      });
    }

    let previousEnd = null;

    windows.forEach((window, windowIndex) => {
      const windowField = `${baseField}.windows[${windowIndex}]`;
      const startMinutes = parseTimeStringToMinutes(window.start);
      const endMinutes = parseTimeStringToMinutes(window.end);

      if (startMinutes === null) {
        issues.push({
          field: `${windowField}.start`,
          messageKey: 'errors.validation.invalidTime',
        });
      }

      if (endMinutes === null) {
        issues.push({
          field: `${windowField}.end`,
          messageKey: 'errors.validation.invalidTime',
        });
      }

      if (
        startMinutes !== null &&
        endMinutes !== null &&
        startMinutes >= endMinutes
      ) {
        issues.push({
          field: windowField,
          messageKey: 'errors.validation.invalidTime',
        });
      }

      if (
        previousEnd !== null &&
        startMinutes !== null &&
        endMinutes !== null &&
        startMinutes < previousEnd
      ) {
        issues.push({
          field: `${baseField}.windows`,
          messageKey: 'errors.validation.invalidTime',
        });
      }

      if (endMinutes !== null) {
        previousEnd = endMinutes;
      }
    });
  });

  return issues;
};
