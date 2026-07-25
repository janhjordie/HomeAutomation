'use strict';

const {
  DAY_CHARGE_WINDOW_START,
  DAY_CHARGE_WINDOW_END,
  NIGHT_CHARGE_WINDOW_START,
  NIGHT_CHARGE_WINDOW_END
} = require('../constants');

function parseHour(value, fallback) {
  const hour = Number(value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return fallback;
  }

  return hour;
}

function buildWindowConfig(appSettings = {}) {
  const dayChargeStart = parseHour(appSettings.day_charge_start, DAY_CHARGE_WINDOW_START);
  const dayChargeEnd = parseHour(appSettings.day_charge_end, DAY_CHARGE_WINDOW_END);
  const nightChargeStart = parseHour(appSettings.night_charge_start, NIGHT_CHARGE_WINDOW_START);
  const nightChargeEnd = parseHour(appSettings.night_charge_end, NIGHT_CHARGE_WINDOW_END);

  return {
    dayChargeStart,
    dayChargeEnd,
    nightChargeStart,
    nightChargeEnd,
    dayPlanSwitchHour: Math.max(0, dayChargeStart - 2),
    nightPlanSwitchHour: dayChargeEnd
  };
}

module.exports = {
  buildWindowConfig,
  parseHour
};
