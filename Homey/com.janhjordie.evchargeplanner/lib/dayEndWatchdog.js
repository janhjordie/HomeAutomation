'use strict';

const { DAY_CHARGE_WINDOW_END, DK_TIME_ZONE } = require('./constants');
const { getClockPartsInTimeZone } = require('./quarterScheduler');

const WATCH_BEFORE_MINUTES = 5;
const WATCH_AFTER_MINUTES = 5;
const WATCH_TICK_MS = 60 * 1000;

function resolveDayEndHour(dayChargeEnd) {
  const hour = Number(dayChargeEnd);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return DAY_CHARGE_WINDOW_END;
  }

  return hour;
}

function getMinuteOfDay(clock) {
  return clock.hour * 60 + clock.minute;
}

function getWatchWindowMinutes(dayEndHour) {
  const end = resolveDayEndHour(dayEndHour);

  return {
    startMinute: end * 60 - WATCH_BEFORE_MINUTES,
    endMinute: end * 60 + WATCH_AFTER_MINUTES
  };
}

function isInDayEndWatchWindow(now = new Date(), dayEndHour = DAY_CHARGE_WINDOW_END, timeZone = DK_TIME_ZONE) {
  const clock = getClockPartsInTimeZone(now, timeZone);
  const minuteOfDay = getMinuteOfDay(clock);
  const { startMinute, endMinute } = getWatchWindowMinutes(dayEndHour);

  return minuteOfDay >= startMinute && minuteOfDay <= endMinute;
}

function hasPassedDayEnd(now = new Date(), dayEndHour = DAY_CHARGE_WINDOW_END, timeZone = DK_TIME_ZONE) {
  const clock = getClockPartsInTimeZone(now, timeZone);
  const minuteOfDay = getMinuteOfDay(clock);
  const endMinute = resolveDayEndHour(dayEndHour) * 60;

  return minuteOfDay >= endMinute;
}

function getMsUntilDayEndWatchStart(now = new Date(), dayEndHour = DAY_CHARGE_WINDOW_END, timeZone = DK_TIME_ZONE) {
  if (isInDayEndWatchWindow(now, dayEndHour, timeZone)) {
    return 0;
  }

  const clock = getClockPartsInTimeZone(now, timeZone);
  const minuteOfDay = getMinuteOfDay(clock);
  const subMinuteMs = (clock.second * 1000) + clock.millisecond;
  const { startMinute, endMinute } = getWatchWindowMinutes(dayEndHour);

  if (minuteOfDay < startMinute) {
    const minutesUntil = startMinute - minuteOfDay;
    return Math.max(0, (minutesUntil * 60 * 1000) - subMinuteMs);
  }

  if (minuteOfDay > endMinute) {
    const minutesUntilTomorrow = (24 * 60 - minuteOfDay) + startMinute;
    return Math.max(0, (minutesUntilTomorrow * 60 * 1000) - subMinuteMs);
  }

  return 0;
}

module.exports = {
  WATCH_BEFORE_MINUTES,
  WATCH_AFTER_MINUTES,
  WATCH_TICK_MS,
  resolveDayEndHour,
  isInDayEndWatchWindow,
  hasPassedDayEnd,
  getMsUntilDayEndWatchStart
};
