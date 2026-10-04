'use strict';

// BacklogTrace: EVC-003
const {
  NIGHT_CHARGE_WINDOW_START,
  NIGHT_CHARGE_WINDOW_END,
  DAY_CHARGE_WINDOW_START,
  DAY_CHARGE_WINDOW_END
} = require('../constants');
const { formatHourNumber } = require('../timezone');
const { minutesOfDay } = require('./windowConfig');

function slotMinutes(slot) {
  return slot.hour * 60 + slot.minute;
}

function windowStartMinutes(window) {
  return window.startHour * 60 + (window.startMinute ?? 0);
}

function windowEndMinutesExclusive(window) {
  return window.endHour * 60 + (window.endMinute ?? 0);
}

function formatWindowTime(hour, minute = 0) {
  return `${formatHourNumber(hour)}:${String(minute).padStart(2, '0')}`;
}

function normalizeClock(clockOrHour) {
  if (typeof clockOrHour === 'number') {
    return { hour: clockOrHour, minute: 0 };
  }

  return {
    hour: clockOrHour.hour,
    minute: clockOrHour.minute ?? 0
  };
}

function resolveDayStart(windowConfig = {}) {
  return {
    hour: windowConfig.dayChargeStart ?? DAY_CHARGE_WINDOW_START,
    minute: windowConfig.dayChargeStartMinute ?? 0
  };
}

function resolveDayEnd(windowConfig = {}) {
  return {
    hour: windowConfig.dayChargeEnd ?? DAY_CHARGE_WINDOW_END,
    minute: windowConfig.dayChargeEndMinute ?? 0
  };
}

function resolveNightStart(windowConfig = {}) {
  return {
    hour: windowConfig.nightChargeStart ?? NIGHT_CHARGE_WINDOW_START,
    minute: windowConfig.nightChargeStartMinute ?? 0
  };
}

function resolveNightEnd(windowConfig = {}) {
  return {
    hour: windowConfig.nightChargeEnd ?? NIGHT_CHARGE_WINDOW_END,
    minute: windowConfig.nightChargeEndMinute ?? 0
  };
}

function resolvePlanSwitchMinutes(windowConfig = {}) {
  const dayStart = resolveDayStart(windowConfig);
  const dayEnd = resolveDayEnd(windowConfig);
  const dayStartMinuteOfDay = minutesOfDay(dayStart.hour, dayStart.minute);
  const dayEndMinuteOfDay = minutesOfDay(dayEnd.hour, dayEnd.minute);

  return {
    dayPlanSwitchMinuteOfDay: windowConfig.dayPlanSwitchMinuteOfDay
      ?? Math.max(0, dayStartMinuteOfDay - 120),
    nightPlanSwitchMinuteOfDay: windowConfig.nightPlanSwitchMinuteOfDay ?? dayEndMinuteOfDay
  };
}

function getChargePlanWindow(clockOrHour, todayDate, yesterdayDate, tomorrowDate, windowConfig = {}) {
  const clock = normalizeClock(clockOrHour);
  const minuteOfDay = minutesOfDay(clock.hour, clock.minute);
  const dayStart = resolveDayStart(windowConfig);
  const dayEnd = resolveDayEnd(windowConfig);
  const nightStart = resolveNightStart(windowConfig);
  const nightEnd = resolveNightEnd(windowConfig);
  const { dayPlanSwitchMinuteOfDay, nightPlanSwitchMinuteOfDay } = resolvePlanSwitchMinutes(windowConfig);

  if (minuteOfDay < dayPlanSwitchMinuteOfDay) {
    return {
      planType: 'night',
      planKey: `night-${todayDate}`,
      label: `${yesterdayDate} ${formatWindowTime(nightStart.hour, nightStart.minute)} -> ${todayDate} ${formatWindowTime(nightEnd.hour, nightEnd.minute)}`,
      startDate: yesterdayDate,
      startHour: nightStart.hour,
      startMinute: nightStart.minute,
      endDate: todayDate,
      endHour: nightEnd.hour,
      endMinute: nightEnd.minute,
      messagePrefix: 'Natteopladning'
    };
  }

  if (minuteOfDay < nightPlanSwitchMinuteOfDay) {
    return {
      planType: 'day',
      planKey: `day-${todayDate}`,
      label: `${todayDate} ${formatWindowTime(dayStart.hour, dayStart.minute)} -> ${todayDate} ${formatWindowTime(dayEnd.hour, dayEnd.minute)}`,
      startDate: todayDate,
      startHour: dayStart.hour,
      startMinute: dayStart.minute,
      endDate: todayDate,
      endHour: dayEnd.hour,
      endMinute: dayEnd.minute,
      messagePrefix: 'Dagopladning'
    };
  }

  return {
    planType: 'night',
    planKey: `night-${tomorrowDate}`,
    label: `${todayDate} ${formatWindowTime(nightStart.hour, nightStart.minute)} -> ${tomorrowDate} ${formatWindowTime(nightEnd.hour, nightEnd.minute)}`,
    startDate: todayDate,
    startHour: nightStart.hour,
    startMinute: nightStart.minute,
    endDate: tomorrowDate,
    endHour: nightEnd.hour,
    endMinute: nightEnd.minute,
    messagePrefix: 'Natteopladning'
  };
}

function isSlotInWindow(slot, window) {
  const startMinutes = windowStartMinutes(window);
  const endMinutes = windowEndMinutesExclusive(window);

  if (window.startDate === window.endDate) {
    return slot.date === window.startDate
      && slotMinutes(slot) >= startMinutes
      && slotMinutes(slot) < endMinutes;
  }

  return (slot.date === window.startDate && slotMinutes(slot) >= startMinutes)
    || (slot.date === window.endDate && slotMinutes(slot) < endMinutes);
}

function getSlotsForWindow(allSlots, window) {
  return allSlots
    .filter((slot) => isSlotInWindow(slot, window))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function isForceChargeActive(forceCharge) {
  return Boolean(forceCharge);
}

function isNightChargeAllowed(nightChargeEnabled, chargePlanWindow) {
  if (chargePlanWindow.planType !== 'night') {
    return true;
  }

  return nightChargeEnabled !== false;
}

function buildDayChargeWindow(todayDate, windowConfig = {}) {
  const dayStart = resolveDayStart(windowConfig);
  const dayEnd = resolveDayEnd(windowConfig);

  return {
    planType: 'day',
    planKey: `day-${todayDate}`,
    label: `${todayDate} ${formatWindowTime(dayStart.hour, dayStart.minute)} -> ${todayDate} ${formatWindowTime(dayEnd.hour, dayEnd.minute)}`,
    startDate: todayDate,
    startHour: dayStart.hour,
    startMinute: dayStart.minute,
    endDate: todayDate,
    endHour: dayEnd.hour,
    endMinute: dayEnd.minute,
    messagePrefix: 'Dagopladning'
  };
}

function buildTonightChargeWindow(todayDate, tomorrowDate, windowConfig = {}) {
  const nightStart = resolveNightStart(windowConfig);
  const nightEnd = resolveNightEnd(windowConfig);

  return {
    planType: 'night',
    planKey: `night-${tomorrowDate}`,
    label: `${todayDate} ${formatWindowTime(nightStart.hour, nightStart.minute)} -> ${tomorrowDate} ${formatWindowTime(nightEnd.hour, nightEnd.minute)}`,
    startDate: todayDate,
    startHour: nightStart.hour,
    startMinute: nightStart.minute,
    endDate: tomorrowDate,
    endHour: nightEnd.hour,
    endMinute: nightEnd.minute,
    messagePrefix: 'Natteopladning'
  };
}

module.exports = {
  getChargePlanWindow,
  buildDayChargeWindow,
  buildTonightChargeWindow,
  isSlotInWindow,
  getSlotsForWindow,
  isForceChargeActive,
  isNightChargeAllowed,
  formatWindowTime
};
