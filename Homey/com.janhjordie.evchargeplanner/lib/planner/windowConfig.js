'use strict';

const {
  DAY_CHARGE_WINDOW_START,
  DAY_CHARGE_WINDOW_END,
  NIGHT_CHARGE_WINDOW_START,
  NIGHT_CHARGE_WINDOW_END,
  NIGHT_CHARGE_END_MIN,
  NIGHT_CHARGE_END_MAX
} = require('../constants');

const WINDOW_TIME_MIN = 0;
const WINDOW_TIME_MAX = 23.5;

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

function minutesOfDay(hour, minute = 0) {
  return hour * 60 + minute;
}

function snapHalfHourDecimal(value) {
  return Math.round(value * 2) / 2;
}

function parseWindowTime(value, fallbackHour, fallbackMinute = 0) {
  const fallback = partsToDecimalHour(fallbackHour, fallbackMinute);
  const num = Number(value);

  if (!Number.isFinite(num)) {
    return decimalHourToParts(fallback);
  }

  const clamped = Math.min(WINDOW_TIME_MAX, Math.max(WINDOW_TIME_MIN, num));
  const snapped = snapHalfHourDecimal(clamped);
  return decimalHourToParts(snapped);
}

function parseNightChargeEnd(value, fallbackDecimal = NIGHT_CHARGE_WINDOW_END) {
  const fallback = decimalHourToParts(fallbackDecimal);
  const num = Number(value);

  if (!Number.isFinite(num)) {
    return fallback;
  }

  const clamped = Math.min(NIGHT_CHARGE_END_MAX, Math.max(NIGHT_CHARGE_END_MIN, num));
  const snapped = snapHalfHourDecimal(clamped);
  return decimalHourToParts(snapped);
}

function buildWindowConfig(appSettings = {}) {
  const dayStartParts = parseWindowTime(appSettings.day_charge_start, DAY_CHARGE_WINDOW_START, 0);
  const dayEndParts = parseWindowTime(appSettings.day_charge_end, DAY_CHARGE_WINDOW_END, 0);
  const nightStartParts = parseWindowTime(appSettings.night_charge_start, NIGHT_CHARGE_WINDOW_START, 0);
  const nightEndParts = parseWindowTime(appSettings.night_charge_end, NIGHT_CHARGE_WINDOW_END, 0);

  const dayStartMinuteOfDay = minutesOfDay(dayStartParts.hour, dayStartParts.minute);
  const dayEndMinuteOfDay = minutesOfDay(dayEndParts.hour, dayEndParts.minute);

  return {
    dayChargeStart: dayStartParts.hour,
    dayChargeStartMinute: dayStartParts.minute,
    dayChargeEnd: dayEndParts.hour,
    dayChargeEndMinute: dayEndParts.minute,
    nightChargeStart: nightStartParts.hour,
    nightChargeStartMinute: nightStartParts.minute,
    nightChargeEnd: nightEndParts.hour,
    nightChargeEndMinute: nightEndParts.minute,
    dayPlanSwitchMinuteOfDay: Math.max(0, dayStartMinuteOfDay - 120),
    nightPlanSwitchMinuteOfDay: dayEndMinuteOfDay
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
  parseWindowTime,
  parseNightChargeEnd,
  decimalHourToParts,
  partsToDecimalHour,
  minutesOfDay
};
