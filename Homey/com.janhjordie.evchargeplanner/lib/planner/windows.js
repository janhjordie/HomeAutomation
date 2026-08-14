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
const { formatHour } = require('../timezone');

function getChargePlanWindow(currentHour, todayDate, yesterdayDate, tomorrowDate, windowConfig = {}) {
  const dayStart = windowConfig.dayChargeStart ?? DAY_CHARGE_WINDOW_START;
  const dayEnd = windowConfig.dayChargeEnd ?? DAY_CHARGE_WINDOW_END;
  const nightStart = windowConfig.nightChargeStart ?? NIGHT_CHARGE_WINDOW_START;
  const nightEnd = windowConfig.nightChargeEnd ?? NIGHT_CHARGE_WINDOW_END;
  const dayPlanSwitch = windowConfig.dayPlanSwitchHour ?? DAY_PLAN_SWITCH_HOUR;
  const nightPlanSwitch = windowConfig.nightPlanSwitchHour ?? NIGHT_PLAN_SWITCH_HOUR;

  if (currentHour < dayPlanSwitch) {
    return {
      planType: 'night',
      planKey: `night-${todayDate}`,
      label: `${yesterdayDate} ${formatHour(nightStart)} -> ${todayDate} ${formatHour(nightEnd)}`,
      startDate: yesterdayDate,
      startHour: nightStart,
      endDate: todayDate,
      endHour: nightEnd,
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
    label: `${todayDate} ${formatHour(nightStart)} -> ${tomorrowDate} ${formatHour(nightEnd)}`,
    startDate: todayDate,
    startHour: nightStart,
    endDate: tomorrowDate,
    endHour: nightEnd,
    messagePrefix: 'Natteopladning'
  };
}

function isSlotInWindow(slot, window) {
  if (window.startDate === window.endDate) {
    return slot.date === window.startDate
      && slot.hour >= window.startHour
      && slot.hour < window.endHour;
  }

  return (slot.date === window.startDate && slot.hour >= window.startHour)
    || (slot.date === window.endDate && slot.hour < window.endHour);
}

function getSlotsForWindow(allSlots, window) {
  return allSlots
    .filter((slot) => isSlotInWindow(slot, window))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function isDayForceChargeActive(forceCharge, chargePlanWindow) {
  return Boolean(forceCharge) && chargePlanWindow.planType === 'day';
}

function isNightChargeAllowed(nightChargeEnabled, chargePlanWindow) {
  if (chargePlanWindow.planType !== 'night') {
    return true;
  }

  return nightChargeEnabled !== false;
}

module.exports = {
  getChargePlanWindow,
  isSlotInWindow,
  getSlotsForWindow,
  isDayForceChargeActive,
  isNightChargeAllowed
};
