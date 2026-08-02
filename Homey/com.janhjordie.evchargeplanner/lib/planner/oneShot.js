'use strict';

// BacklogTrace: EVC-003
const { DEFAULT_ONE_SHOT_READY_BY } = require('../constants');
const { normalizeQuarterMinute, getDateTimePartsInTimeZone, formatHourNumber } = require('../timezone');
const { SLOTS_PER_HOUR, SLOT_MS, getSlotKey } = require('../price/slotBuilder');

function parseReadyByTime(readyByText) {
  const match = String(readyByText || '').trim().match(/^(\d{1,2})[:.](\d{2})$/);

  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return {
    hour,
    minute: normalizeQuarterMinute(minute)
  };
}

function resolveOneShotDeadline(now, readyByText, todayDate, tomorrowDate, timeZone) {
  const readyBy = parseReadyByTime(readyByText) || parseReadyByTime(DEFAULT_ONE_SHOT_READY_BY);
  const nowParts = getDateTimePartsInTimeZone(now, timeZone);
  const nowMinutes = nowParts.hour * 60 + nowParts.minute;
  const readyMinutes = readyBy.hour * 60 + readyBy.minute;
  const useToday = nowMinutes < readyMinutes;
  const date = useToday ? todayDate : tomorrowDate;

  return {
    date,
    hour: readyBy.hour,
    minute: readyBy.minute,
    label: `${date} ${formatHourNumber(readyBy.hour)}:${String(readyBy.minute).padStart(2, '0')}`
  };
}

function isSlotBeforeDeadline(slot, deadline) {
  if (slot.date !== deadline.date) {
    return slot.date < deadline.date;
  }

  if (slot.hour !== deadline.hour) {
    return slot.hour < deadline.hour;
  }

  return slot.minute < deadline.minute;
}

function isSlotAtOrAfterNow(slot, now, timeZone) {
  const nowParts = getDateTimePartsInTimeZone(now, timeZone);

  if (slot.date !== nowParts.date) {
    return slot.date > nowParts.date;
  }

  if (slot.hour !== nowParts.hour) {
    return slot.hour > nowParts.hour;
  }

  return slot.minute >= nowParts.minute;
}

function getOneShotWindowSlots(allSlots, now, deadline, timeZone) {
  return allSlots
    .filter((slot) => isSlotAtOrAfterNow(slot, now, timeZone) && isSlotBeforeDeadline(slot, deadline))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function buildOneShotSessionKey(deadline, chargeHours, readyBy) {
  return `${deadline.date}-${readyBy}-${chargeHours}`;
}

function parseCachedPlanKeys(raw) {
  if (!raw) {
    return [];
  }

  return String(raw).split('|').filter(Boolean);
}

function serializeCachedPlanKeys(keys) {
  return keys.join('|');
}

function getSlotsByKeys(allSlots, keys) {
  if (!keys.length) {
    return [];
  }

  const keySet = new Set(keys);

  return allSlots
    .filter((slot) => keySet.has(getSlotKey(slot)))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function isPastOneShotDeadline(now, deadline, timeZone) {
  const nowParts = getDateTimePartsInTimeZone(now, timeZone);

  return !isSlotBeforeDeadline(
    { date: nowParts.date, hour: nowParts.hour, minute: nowParts.minute },
    deadline
  );
}

function isOneShotSessionFinished(now, deadline, cachedPlanSlots, timeZone) {
  if (isPastOneShotDeadline(now, deadline, timeZone)) {
    return true;
  }

  if (!cachedPlanSlots.length) {
    return true;
  }

  const lastSlot = cachedPlanSlots.at(-1);
  return now.getTime() >= lastSlot.timestamp + SLOT_MS;
}

function isOneShotFinished(now, deadline, planSlots, currentSlot, timeZone) {
  return isOneShotSessionFinished(now, deadline, planSlots, timeZone);
}

function formatSlotLabel(slot) {
  const { formatSlotTime } = require('../timezone');
  return `${slot.date} ${formatSlotTime(slot)}`;
}

function formatChargeSchedule(slots, timeZone) {
  if (!slots.length) {
    return 'ingen';
  }

  const ordered = [...slots].sort((a, b) => a.timestamp - b.timestamp);
  const ranges = [];
  let rangeStart = ordered[0];
  let rangeEnd = ordered[0];

  for (let index = 1; index < ordered.length; index++) {
    const slot = ordered[index];
    const expectedNext = rangeEnd.timestamp + SLOT_MS;

    if (slot.timestamp === expectedNext) {
      rangeEnd = slot;
      continue;
    }

    ranges.push({ start: rangeStart, end: rangeEnd });
    rangeStart = slot;
    rangeEnd = slot;
  }

  ranges.push({ start: rangeStart, end: rangeEnd });

  return ranges.map(({ start, end }) => {
    const endTime = new Date(end.timestamp + SLOT_MS);
    const endParts = getDateTimePartsInTimeZone(endTime, timeZone);
    const { formatSlotTime, formatHourNumber } = require('../timezone');
    const endLabel = `${formatHourNumber(endParts.hour)}:${String(endParts.minute).padStart(2, '0')}`;

    if (start.date === endParts.date) {
      return `${formatSlotTime(start)}-${endLabel}`;
    }

    return `${formatSlotLabel(start)} -> ${endParts.date} ${endLabel}`;
  }).join(', ');
}

function formatChargeSlotsDetailed(slots) {
  return [...slots]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((slot) => `${formatSlotLabel(slot)} (${slot.spotPriceInclVat.toFixed(2)})`)
    .join(', ');
}

function buildChargeMessage(chargePlanWindow, evaluation, currentSlot, spotThreshold) {
  const {
    chargingSlots,
    thresholdSlots,
    planSlots,
    charge_now,
    nextChargingSlot,
    chargeSlotsNeeded,
    forceChargeActive,
    oneShotActive,
    oneShotDeadlineLabel
  } = evaluation;
  const dishwasherMessageSuffix = evaluation.dishwasherMessageSuffix || '';
  const { formatSlotTime } = require('../timezone');
  const currentSpotText = Number.isFinite(currentSlot.spotPriceInclVat)
    ? currentSlot.spotPriceInclVat.toFixed(2)
    : '?';
  const scheduleSlots = oneShotActive ? planSlots : chargingSlots;
  const scheduleText = formatChargeSchedule(scheduleSlots);

  if (charge_now && oneShotActive) {
    return `Engangsopladning: lader nu (spot ${currentSpotText}), klar ${oneShotDeadlineLabel}. Plan: ${scheduleText}.${dishwasherMessageSuffix}`;
  }

  if (oneShotActive) {
    const nextText = nextChargingSlot
      ? `naeste kl. ${formatSlotTime(nextChargingSlot)} (spot ${nextChargingSlot.spotPriceInclVat.toFixed(2)})`
      : 'ingen flere kvarter foer deadline';
    const planHours = (planSlots.length / SLOTS_PER_HOUR).toFixed(1);

    return `Engangsopladning: ${planHours}t planlagt, klar ${oneShotDeadlineLabel}. Plan: ${scheduleText}. ${nextText}.${dishwasherMessageSuffix}`;
  }

  if (charge_now && forceChargeActive) {
    return `Dagopladning: tvungen opladning aktiv (spot ${currentSpotText}).${dishwasherMessageSuffix}`;
  }

  if (charge_now) {
    const reason = currentSlot.spotPriceInclVat < spotThreshold
      ? `spot ${currentSpotText}`
      : `plan (${currentSpotText})`;

    return `${chargePlanWindow.messagePrefix}: lader nu (${reason}). Plan: ${scheduleText}.${dishwasherMessageSuffix}`;
  }

  if (chargingSlots.length === 0) {
    return `Ingen ${chargePlanWindow.messagePrefix.toLowerCase()} endnu.${dishwasherMessageSuffix}`;
  }

  const nextText = nextChargingSlot
    ? `naeste kl. ${formatSlotTime(nextChargingSlot)} (spot ${nextChargingSlot.spotPriceInclVat.toFixed(2)})`
    : 'ingen flere kvarter i vinduet';
  const thresholdHours = (thresholdSlots.length / SLOTS_PER_HOUR).toFixed(1);
  const planHours = (planSlots.length / SLOTS_PER_HOUR).toFixed(1);

  return `${chargePlanWindow.messagePrefix}: ${thresholdHours}t under ${spotThreshold.toFixed(2)}, ${planHours}t i ${chargeSlotsNeeded}-kvarters plan. Plan: ${scheduleText}. ${nextText}.${dishwasherMessageSuffix}`;
}

module.exports = {
  parseReadyByTime,
  resolveOneShotDeadline,
  isSlotBeforeDeadline,
  isSlotAtOrAfterNow,
  getOneShotWindowSlots,
  buildOneShotSessionKey,
  parseCachedPlanKeys,
  serializeCachedPlanKeys,
  getSlotsByKeys,
  isPastOneShotDeadline,
  isOneShotSessionFinished,
  isOneShotFinished,
  formatChargeSchedule,
  formatChargeSlotsDetailed,
  buildChargeMessage
};
