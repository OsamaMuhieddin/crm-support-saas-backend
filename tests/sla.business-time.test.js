import {
  addBusinessMinutes,
  calculateBusinessMinutesBetween,
  getNextBusinessStart,
  isWithinBusinessWindow,
  resolveBusinessLocalDateTime,
} from '../src/modules/sla/utils/business-time.helpers.js';

const businessHoursUtcWeekdays = {
  timezone: 'UTC',
  weeklySchedule: [
    { dayOfWeek: 1, isOpen: true, windows: [{ start: '09:00', end: '17:00' }] },
    { dayOfWeek: 2, isOpen: true, windows: [{ start: '09:00', end: '17:00' }] },
    { dayOfWeek: 3, isOpen: true, windows: [{ start: '09:00', end: '17:00' }] },
    { dayOfWeek: 4, isOpen: true, windows: [{ start: '09:00', end: '17:00' }] },
    { dayOfWeek: 5, isOpen: true, windows: [{ start: '09:00', end: '17:00' }] },
  ],
};

const businessHoursUtcSplitShift = {
  timezone: 'UTC',
  weeklySchedule: [
    {
      dayOfWeek: 1,
      isOpen: true,
      windows: [
        { start: '09:00', end: '12:00' },
        { start: '13:00', end: '17:00' },
      ],
    },
    { dayOfWeek: 2, isOpen: true, windows: [{ start: '09:00', end: '17:00' }] },
  ],
};

describe('SLA business-time helpers', () => {
  test('resolveBusinessLocalDateTime converts using the configured timezone instead of server local time', () => {
    const at = new Date('2026-03-23T06:30:00.000Z');

    expect(
      resolveBusinessLocalDateTime({
        at,
        timeZone: 'UTC',
      })
    ).toEqual(
      expect.objectContaining({
        weekday: 1,
        hour: 6,
        minute: 30,
      })
    );

    expect(
      resolveBusinessLocalDateTime({
        at,
        timeZone: 'Asia/Damascus',
      })
    ).toEqual(
      expect.objectContaining({
        weekday: 1,
        hour: 9,
        minute: 30,
      })
    );
  });

  test('isWithinBusinessWindow respects configured weekday windows', () => {
    expect(
      isWithinBusinessWindow({
        at: new Date('2026-03-23T10:00:00.000Z'),
        businessHours: businessHoursUtcWeekdays,
      })
    ).toBe(true);

    expect(
      isWithinBusinessWindow({
        at: new Date('2026-03-23T18:00:00.000Z'),
        businessHours: businessHoursUtcWeekdays,
      })
    ).toBe(false);
  });

  test('getNextBusinessStart moves to the next opening boundary when current time is closed', () => {
    expect(
      getNextBusinessStart({
        at: new Date('2026-03-23T08:00:00.000Z'),
        businessHours: businessHoursUtcWeekdays,
      })?.toISOString()
    ).toBe('2026-03-23T09:00:00.000Z');

    expect(
      getNextBusinessStart({
        at: new Date('2026-03-22T12:00:00.000Z'),
        businessHours: businessHoursUtcWeekdays,
      })?.toISOString()
    ).toBe('2026-03-23T09:00:00.000Z');
  });

  test('addBusinessMinutes supports same-day, closed-gap, and multi-day carryover', () => {
    expect(
      addBusinessMinutes({
        startAt: new Date('2026-03-23T10:00:00.000Z'),
        minutes: 120,
        businessHours: businessHoursUtcWeekdays,
      })?.toISOString()
    ).toBe('2026-03-23T12:00:00.000Z');

    expect(
      addBusinessMinutes({
        startAt: new Date('2026-03-23T11:30:00.000Z'),
        minutes: 120,
        businessHours: businessHoursUtcSplitShift,
      })?.toISOString()
    ).toBe('2026-03-23T14:30:00.000Z');

    expect(
      addBusinessMinutes({
        startAt: new Date('2026-03-23T16:00:00.000Z'),
        minutes: 120,
        businessHours: businessHoursUtcWeekdays,
      })?.toISOString()
    ).toBe('2026-03-24T10:00:00.000Z');
  });

  test('calculateBusinessMinutesBetween accumulates only open-window time', () => {
    expect(
      calculateBusinessMinutesBetween({
        startAt: new Date('2026-03-23T11:30:00.000Z'),
        endAt: new Date('2026-03-24T10:30:00.000Z'),
        businessHours: businessHoursUtcSplitShift,
      })
    ).toBe(360);
  });

  test('timezone-sensitive cases can be inside business hours in one timezone and outside in another', () => {
    const at = new Date('2026-03-23T06:30:00.000Z');
    const nineToFiveEveryMonday = {
      weeklySchedule: [
        {
          dayOfWeek: 1,
          isOpen: true,
          windows: [{ start: '09:00', end: '17:00' }],
        },
      ],
    };

    expect(
      isWithinBusinessWindow({
        at,
        businessHours: {
          timezone: 'Asia/Damascus',
          ...nineToFiveEveryMonday,
        },
      })
    ).toBe(true);

    expect(
      isWithinBusinessWindow({
        at,
        businessHours: {
          timezone: 'UTC',
          ...nineToFiveEveryMonday,
        },
      })
    ).toBe(false);
  });
});
