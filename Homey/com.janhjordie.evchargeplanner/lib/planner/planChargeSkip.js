'use strict';

const { SLOT_MS } = require('../price/slotBuilder');
const { getSlotKey } = require('../price/slotBuilder');

function normalizeSkipKeys(keys) {
  if (!Array.isArray(keys)) {
    return [];
  }

  return keys.filter((key) => typeof key === 'string' && key.length > 0);
}

function isSlotSkipped(currentSlot, skipKeys) {
  if (!currentSlot || !skipKeys?.length) {
    return false;
  }

  return skipKeys.includes(getSlotKey(currentSlot));
}

function findContiguousRunBounds(sortedPlanSlots, index) {
  let start = index;
  let end = index;

  while (start > 0 && sortedPlanSlots[start].timestamp - sortedPlanSlots[start - 1].timestamp <= SLOT_MS) {
    start -= 1;
  }

  while (end < sortedPlanSlots.length - 1
    && sortedPlanSlots[end + 1].timestamp - sortedPlanSlots[end].timestamp <= SLOT_MS) {
    end += 1;
  }

  return { start, end };
}

function getPlanChargeSkipKeysFromEvaluation(evaluation, currentSlot) {
  if (!currentSlot || !evaluation) {
    return currentSlot ? [getSlotKey(currentSlot)] : [];
  }

  const planSlots = evaluation.planSlots || [];
  if (!planSlots.length) {
    return [getSlotKey(currentSlot)];
  }

  const sorted = [...planSlots].sort((a, b) => a.timestamp - b.timestamp);
  const currentKey = getSlotKey(currentSlot);
  const index = sorted.findIndex((slot) => getSlotKey(slot) === currentKey);

  if (index < 0) {
    return [currentKey];
  }

  const { start, end } = findContiguousRunBounds(sorted, index);
  return sorted.slice(index, end + 1).map(getSlotKey);
}

function prunePlanChargeSkipKeys(skipKeys, currentSlot) {
  const normalized = normalizeSkipKeys(skipKeys);
  if (!normalized.length || !currentSlot) {
    return normalized;
  }

  const currentKey = getSlotKey(currentSlot);
  if (normalized.includes(currentKey)) {
    return normalized;
  }

  return [];
}

module.exports = {
  normalizeSkipKeys,
  isSlotSkipped,
  getPlanChargeSkipKeysFromEvaluation,
  prunePlanChargeSkipKeys
};
