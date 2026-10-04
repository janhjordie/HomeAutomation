'use strict';

const { DEFAULT_CHARGE_HOURS, DEFAULT_ONE_SHOT_CHARGE_HOURS, MAX_CHARGE_HOURS } = require('./constants');

const CHARGE_HOURS_MIN = 0.5;
const CHARGE_HOURS_STEP = 0.5;

function snapChargeHours(value) {
  return Math.round(value * 2) / 2;
}

function parseChargeHours(value, fallback = DEFAULT_CHARGE_HOURS) {
  const num = Number(value);

  if (!Number.isFinite(num)) {
    return snapChargeHours(fallback);
  }

  const clamped = Math.min(MAX_CHARGE_HOURS, Math.max(CHARGE_HOURS_MIN, num));
  return snapChargeHours(clamped);
}

function isValidChargeHours(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours)) {
    return false;
  }

  const snapped = snapChargeHours(hours);
  return snapped >= CHARGE_HOURS_MIN
    && snapped <= MAX_CHARGE_HOURS
    && Math.abs(snapped - hours) < 0.001;
}

function formatChargeHoursForNotification(hours) {
  const value = parseChargeHours(hours, 0);
  if (value <= 0) {
    return null;
  }

  if (value % 1 === 0) {
    return String(value);
  }

  return value.toFixed(1).replace('.', ',');
}

module.exports = {
  CHARGE_HOURS_MIN,
  CHARGE_HOURS_STEP,
  snapChargeHours,
  parseChargeHours,
  isValidChargeHours,
  formatChargeHoursForNotification,
  DEFAULT_ONE_SHOT_CHARGE_HOURS
};
