'use strict';

const { formatDateInTimeZone, addDays } = require('./timezone');
const { formatWindowTime } = require('./planner/windows');
const { DK_TIME_ZONE } = require('./constants');
const { evaluateChargePlan } = require('./planner/chargePlan');
const { formatChargeSchedule } = require('./planner/oneShot');
const {
  buildDayChargeWindow,
  buildTonightChargeWindow,
  getSlotsForWindow
} = require('./planner/windows');

function describeChargeMode(deviceConfig = {}, options = {}) {
  if (options.oneShotActive) {
    const readyBy = String(deviceConfig.oneShotReadyBy || '').trim();
    return readyBy ? `engangsopladning til ${readyBy}` : 'engangsopladning';
  }

  if (deviceConfig.cheapestPlanOnly) {
    return 'kun billigste tider';
  }

  const threshold = Number(deviceConfig.spotThreshold);
  const thresholdText = Number.isFinite(threshold)
    ? threshold.toFixed(2).replace('.', ',')
    : '?';

  return `spot under ${thresholdText} kr + plan`;
}

function planLabelForWindow(window) {
  if (window.planType === 'night') {
    return 'Natteplan';
  }

  if (window.planType === 'day') {
    return 'Dagsplan';
  }

  return 'Plan';
}

function formatWindowHours(window) {
  return `${formatWindowTime(window.startHour, window.startMinute ?? 0)}-${formatWindowTime(window.endHour, window.endMinute ?? 0)}`;
}

function summarizeWindowPlan(allSlots, window, deviceConfig, currentSlot, timeZone) {
  const windowHours = formatWindowHours(window);
  const windowSlots = getSlotsForWindow(allSlots, window);

  if (windowSlots.length === 0) {
    return {
      planLabel: planLabelForWindow(window),
      schedule: 'ingen',
      windowHours
    };
  }

  const evaluation = evaluateChargePlan(
    windowSlots,
    deviceConfig.chargeHours,
    deviceConfig.spotThreshold,
    currentSlot,
    {
      useSpotThreshold: !deviceConfig.cheapestPlanOnly,
      planOnly: deviceConfig.cheapestPlanOnly
    }
  );

  return {
    planLabel: planLabelForWindow(window),
    schedule: formatChargeSchedule(evaluation.planSlots, timeZone),
    windowHours
  };
}

function buildPlanSummaries(allSlots, deviceConfig, appConfig, options = {}) {
  const now = options.now || new Date();
  const timeZone = appConfig.timeZone || DK_TIME_ZONE;
  const today = formatDateInTimeZone(now, timeZone);
  const tomorrow = addDays(today, 1);
  const currentSlot = options.currentSlot;

  if (options.oneShotActive) {
    return [{
      planLabel: 'Plan',
      schedule: options.oneShotSchedule || 'ingen',
      windowHours: null
    }];
  }

  const summaries = [];
  const dayWindow = buildDayChargeWindow(today, appConfig.windowConfig);
  summaries.push(summarizeWindowPlan(
    allSlots,
    dayWindow,
    deviceConfig,
    currentSlot,
    timeZone
  ));

  if (deviceConfig.nightChargeEnabled !== false) {
    const nightWindow = buildTonightChargeWindow(today, tomorrow, appConfig.windowConfig);
    summaries.push(summarizeWindowPlan(
      allSlots,
      nightWindow,
      deviceConfig,
      currentSlot,
      timeZone
    ));
  }

  return summaries;
}

function formatPlanSummaryLine(summary) {
  const schedule = summary.schedule || 'ingen';

  if (!summary.windowHours) {
    return `${summary.planLabel}: ${schedule}`;
  }

  return `${summary.planLabel}: ${schedule} (${summary.windowHours})`;
}

function formatPlanNotificationText(planSummaries, options = {}) {
  const hours = Number(options.chargeHours);
  const modeLabel = String(options.modeLabel || '').trim();
  const lines = [];

  if (Number.isInteger(hours) && hours > 0 && modeLabel) {
    lines.push(`${hours} timer · ${modeLabel}`);
  } else if (modeLabel) {
    lines.push(modeLabel);
  } else if (Number.isInteger(hours) && hours > 0) {
    lines.push(`${hours} timer`);
  }

  for (const summary of planSummaries) {
    lines.push(formatPlanSummaryLine(summary));
  }

  return lines.join('\n').trim();
}

function buildPlanNotificationMessage(deviceConfig = {}, planSummaries = [], options = {}) {
  const oneShotActive = Boolean(options.oneShotActive);
  const chargeHours = oneShotActive
    ? Number(deviceConfig.oneShotChargeHours)
    : Number(deviceConfig.chargeHours);
  const modeLabel = describeChargeMode(deviceConfig, { oneShotActive });

  if (!planSummaries?.length) {
    return String(options.fallback || 'ingen plan').trim();
  }

  return formatPlanNotificationText(planSummaries, {
    chargeHours: Number.isInteger(chargeHours) && chargeHours > 0 ? chargeHours : null,
    modeLabel
  });
}

module.exports = {
  describeChargeMode,
  planLabelForWindow,
  formatWindowHours,
  formatPlanSummaryLine,
  buildPlanNotificationMessage,
  buildPlanSummaries,
  formatPlanNotificationText,
  summarizeWindowPlan
};
