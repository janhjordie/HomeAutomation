'use strict';

// BacklogTrace: EVC-003
const {
  NIGHT_CHARGE_WINDOW_START,
  NIGHT_CHARGE_WINDOW_END,
  DAY_CHARGE_WINDOW_START,
  DAY_CHARGE_WINDOW_END,
  DAY_PLAN_SWITCH_HOUR,
  NIGHT_PLAN_SWITCH_HOUR
} = require('../constants');
const { formatHour, formatHourNumber } = require('../timezone');

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

function resolveNightEnd(windowConfig = {}) {
  return {
    hour: windowConfig.nightChargeEnd ?? NIGHT_CHARGE_WINDOW_END,
    minute: windowConfig.nightChargeEndMinute ?? 0
  };
}

function getChargePlanWindow(currentHour, todayDate, yesterdayDate, tomorrowDate, windowConfig = {}) {
  const dayStart = windowConfig.dayChargeStart ?? DAY_CHARGE_WINDOW_START;
  const dayEnd = windowConfig.dayChargeEnd ?? DAY_CHARGE_WINDOW_END;
  const nightStart = windowConfig.nightChargeStart ?? NIGHT_CHARGE_WINDOW_START;
  const nightEnd = resolveNightEnd(windowConfig);
  const dayPlanSwitch = windowConfig.dayPlanSwitchHour ?? DAY_PLAN_SWITCH_HOUR;
  const nightPlanSwitch = windowConfig.nightPlanSwitchHour ?? NIGHT_PLAN_SWITCH_HOUR;

  if (currentHour < dayPlanSwitch) {
    return {
      planType: 'night',
      planKey: `night-${todayDate}`,
      label: `${yesterdayDate} ${formatHour(nightStart)} -> ${todayDate} ${formatWindowTime(nightEnd.hour, nightEnd.minute)}`,
      startDate: yesterdayDate,
      startHour: nightStart,
      endDate: todayDate,
      endHour: nightEnd.hour,
      endMinute: nightEnd.minute,
      messagePrefix: 'Natteopladning'
    };
  }

  if (currentHour < nightPlanSwitch) {
    return {
      planType: 'day',
      planKey: `day-${todayDate}`,
      label: `${todayDate} ${formatHour(dayStart)} -> ${todayDate} ${formatHour(dayEnd)}`,
      startDate: todayDate,
      startHour: dayStart,
      endDate: todayDate,
      endHour: dayEnd,
      messagePrefix: 'Dagopladning'
    };
  }

  return {
    planType: 'night',
    planKey: `night-${tomorrowDate}`,
    label: `${todayDate} ${formatHour(nightStart)} -> ${tomorrowDate} ${formatWindowTime(nightEnd.hour, nightEnd.minute)}`,
    startDate: todayDate,
    startHour: nightStart,
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

function isDayForceChargeActive(forceCharge, chargePlanWindow) {
  return Boolean(forceCharge);
}

function isNightChargeAllowed(nightChargeEnabled, chargePlanWindow) {
  if (chargePlanWindow.planType !== 'night') {
    return true;
  }

  return nightChargeEnabled !== false;
}

function buildDayChargeWindow(todayDate, windowConfig = {}) {
  const dayStart = windowConfig.dayChargeStart ?? DAY_CHARGE_WINDOW_START;
  const dayEnd = windowConfig.dayChargeEnd ?? DAY_CHARGE_WINDOW_END;

  return {
    planType: 'day',
    planKey: `day-${todayDate}`,
    label: `${todayDate} ${formatHour(dayStart)} -> ${todayDate} ${formatHour(dayEnd)}`,
    startDate: todayDate,
    startHour: dayStart,
    endDate: todayDate,
    endHour: dayEnd,
    messagePrefix: 'Dagopladning'
  };
}

function buildTonightChargeWindow(todayDate, tomorrowDate, windowConfig = {}) {
  const nightStart = windowConfig.nightChargeStart ?? NIGHT_CHARGE_WINDOW_START;
  const nightEnd = resolveNightEnd(windowConfig);

  return {
    planType: 'night',
    planKey: `night-${tomorrowDate}`,
    label: `${todayDate} ${formatHour(nightStart)} -> ${tomorrowDate} ${formatWindowTime(nightEnd.hour, nightEnd.minute)}`,
    startDate: todayDate,
    startHour: nightStart,
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
  isDayForceChargeActive,
  isNightChargeAllowed,
  formatWindowTime
};
