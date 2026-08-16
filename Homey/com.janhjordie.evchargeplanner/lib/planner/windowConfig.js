'use strict';

const {
  DAY_CHARGE_WINDOW_START,
  DAY_CHARGE_WINDOW_END,
  NIGHT_CHARGE_WINDOW_START,
  NIGHT_CHARGE_WINDOW_END,
  NIGHT_CHARGE_END_MIN,
  NIGHT_CHARGE_END_MAX
} = require('../constants');

function parseHour(value, fallback) {
  const hour = Number(value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return fallback;
  }

  return hour;
}

function decimalHourToParts(decimal) {
  const hour = Math.floor(decimal);
  const minute = Math.round((decimal - hour) * 60);
  return { hour, minute };
}

function partsToDecimalHour(hour, minute = 0) {
  return hour + minute / 60;
}

function parseNightChargeEnd(value, fallbackDecimal = NIGHT_CHARGE_WINDOW_END) {
  const fallback = decimalHourToParts(fallbackDecimal);
  const num = Number(value);

  if (!Number.isFinite(num)) {
    return fallback;
  }

  const clamped = Math.min(NIGHT_CHARGE_END_MAX, Math.max(NIGHT_CHARGE_END_MIN, num));
  const snapped = Math.round(clamped * 2) / 2;
  return decimalHourToParts(snapped);
}

function buildWindowConfig(appSettings = {}) {
  const dayChargeStart = parseHour(appSettings.day_charge_start, DAY_CHARGE_WINDOW_START);
  const dayChargeEnd = parseHour(appSettings.day_charge_end, DAY_CHARGE_WINDOW_END);
  const nightChargeStart = parseHour(appSettings.night_charge_start, NIGHT_CHARGE_WINDOW_START);
  const nightChargeEndParts = parseNightChargeEnd(
    appSettings.night_charge_end,
    NIGHT_CHARGE_WINDOW_END
  );

  return {
    dayChargeStart,
    dayChargeEnd,
    nightChargeStart,
    nightChargeEnd: nightChargeEndParts.hour,
    nightChargeEndMinute: nightChargeEndParts.minute,
    dayPlanSwitchHour: Math.max(0, dayChargeStart - 2),
    nightPlanSwitchHour: dayChargeEnd
  };
}

function mergeDeviceWindowConfig(appWindowConfig = {}, deviceConfig = {}) {
  if (!deviceConfig.nightChargeEnd) {
    return appWindowConfig;
  }

  return {
    ...appWindowConfig,
    nightChargeEnd: deviceConfig.nightChargeEnd.hour,
    nightChargeEndMinute: deviceConfig.nightChargeEnd.minute
  };
}

module.exports = {
  buildWindowConfig,
  mergeDeviceWindowConfig,
  parseHour,
  parseNightChargeEnd,
  decimalHourToParts,
  partsToDecimalHour
};
