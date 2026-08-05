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

function formatChargeScheduleRanges(slots, timeZone) {
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

  return ranges.map(({ start, end }) => formatScheduleRange(start, end, timeZone)).join(', ');
}

function getSlotEndParts(slot) {
  const { addDays } = require('../timezone');
  let minute = Number(slot.minute) + 15;
  let hour = Number(slot.hour);
  let date = slot.date;

  if (minute >= 60) {
    minute -= 60;
    hour += 1;
  }

  if (hour >= 24) {
    hour -= 24;
    date = addDays(date, 1);
  }

  return { date, hour, minute };
}

function formatScheduleRange(start, end, timeZone) {
  const endParts = getSlotEndParts(end);
  const { formatSlotTime, formatHourNumber } = require('../timezone');
  const endLabel = `${formatHourNumber(endParts.hour)}:${String(endParts.minute).padStart(2, '0')}`;

  if (start.date === endParts.date) {
    return `${formatSlotTime(start)}-${endLabel}`;
  }

  return `${formatSlotLabel(start)} -> ${endParts.date} ${endLabel}`;
}

function formatChargeSchedule(slots, timeZone) {
  if (!slots.length) {
    return 'ingen';
  }

  // Total wall-clock span from first to last selected slot (gaps included).
  // With 3 charge hours the span is often longer than 3h when cheapest slots are split.
  const ordered = [...slots].sort((a, b) => a.timestamp - b.timestamp);
  return formatScheduleRange(ordered[0], ordered[ordered.length - 1], timeZone);
}

function formatChargeSlotsDetailed(slots) {
  return [...slots]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((slot) => `${formatSlotLabel(slot)} (${slot.spotPriceInclVat.toFixed(2)})`)
    .join(', ');
}

function shouldChargeOneShotNow(evaluation, currentSlot, spotThreshold) {
  if (!currentSlot || !evaluation?.planSlotKeys?.has(getSlotKey(currentSlot))) {
    return false;
  }

  const price = Number(currentSlot.spotPriceInclVat);
  if (Number.isFinite(price) && price < spotThreshold) {
    return true;
  }

  const futurePlanSlots = (evaluation.planSlots || [])
    .filter((slot) => slot.timestamp >= currentSlot.timestamp);

  return futurePlanSlots.length <= 1;
}

function buildChargeMessage(chargePlanWindow, evaluation, currentSlot, spotThreshold, timeZone) {
  const {
    chargingSlots,
    thresholdSlots,
    planSlots,
    charge_now,
    nextPlanSlot,
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
  const scheduleText = formatChargeSchedule(planSlots, timeZone);
  const nextSlot = nextPlanSlot;

  if (charge_now && oneShotActive) {
    return `Engangsopladning: lader nu (spot ${currentSpotText}), klar ${oneShotDeadlineLabel}. Plan: ${scheduleText}.${dishwasherMessageSuffix}`;
  }

  if (oneShotActive) {
    const nextText = nextSlot
      ? `naeste kl. ${formatSlotTime(nextSlot)} (spot ${nextSlot.spotPriceInclVat.toFixed(2)})`
      : 'ingen flere kvarter foer deadline';
    const planHours = (planSlots.length / SLOTS_PER_HOUR).toFixed(1);

    if (!charge_now) {
      return `Engangsopladning: venter (spot ${currentSpotText}, graense ${spotThreshold.toFixed(2)}). ${planHours}t planlagt, klar ${oneShotDeadlineLabel}. Plan: ${scheduleText}. ${nextText}.${dishwasherMessageSuffix}`;
    }

    return `Engangsopladning: ${planHours}t planlagt, klar ${oneShotDeadlineLabel}. Plan: ${scheduleText}. ${nextText}.${dishwasherMessageSuffix}`;
  }

  if (charge_now && forceChargeActive) {
    return `Dagopladning: tvungen opladning aktiv (spot ${currentSpotText}).${dishwasherMessageSuffix}`;
  }

  if (charge_now) {
    const { getSlotKey } = require('../price/slotBuilder');
    const inPlan = evaluation.planSlotKeys?.has(getSlotKey(currentSlot));
    const reason = !evaluation.cheapestPlanOnly && !inPlan
      ? `spot ${currentSpotText}`
      : evaluation.cheapestPlanOnly || inPlan
        ? `plan (${currentSpotText})`
        : `spot ${currentSpotText}`;

    return `${chargePlanWindow.messagePrefix}: lader nu (${reason}). Plan: ${scheduleText}.${dishwasherMessageSuffix}`;
  }

  if (chargingSlots.length === 0) {
    return `Ingen ${chargePlanWindow.messagePrefix.toLowerCase()} endnu.${dishwasherMessageSuffix}`;
  }

  const nextText = nextSlot
    ? `naeste kl. ${formatSlotTime(nextSlot)} (spot ${nextSlot.spotPriceInclVat.toFixed(2)})`
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
  formatChargeScheduleRanges,
  formatChargeSlotsDetailed,
  buildChargeMessage,
  shouldChargeOneShotNow
};
