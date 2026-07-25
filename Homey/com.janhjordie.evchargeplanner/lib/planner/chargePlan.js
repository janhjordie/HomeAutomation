'use strict';

// BacklogTrace: EVC-003
const { SLOTS_PER_HOUR } = require('../price/slotBuilder');
const { getSlotKey } = require('../price/slotBuilder');

function selectCheapestPlanSlots(windowSlots, chargeSlotsNeeded) {
  return [...windowSlots]
    .sort((a, b) => {
      if (a.spotPriceInclVat !== b.spotPriceInclVat) {
        return a.spotPriceInclVat - b.spotPriceInclVat;
      }

      return a.timestamp - b.timestamp;
    })
    .slice(0, chargeSlotsNeeded);
}

function evaluateChargePlan(windowSlots, chargeHoursNeeded, spotThresholdInclVat, currentSlot, options = {}) {
  const { useSpotThreshold = true } = options;
  const chargeSlotsNeeded = chargeHoursNeeded * SLOTS_PER_HOUR;
  const planSlots = selectCheapestPlanSlots(windowSlots, chargeSlotsNeeded);
  const planSlotKeys = new Set(planSlots.map(getSlotKey));
  const isBelowThreshold = (slot) => useSpotThreshold && slot.spotPriceInclVat < spotThresholdInclVat;
  const isChargingSlot = (slot) => isBelowThreshold(slot) || planSlotKeys.has(getSlotKey(slot));
  const chargingSlots = windowSlots.filter(isChargingSlot);
  const thresholdSlots = windowSlots.filter(isBelowThreshold);
  const currentSlotKey = currentSlot ? getSlotKey(currentSlot) : null;
  const currentSlotInWindow = Boolean(
    currentSlot && windowSlots.some((slot) => getSlotKey(slot) === currentSlotKey)
  );
  const charge_now = currentSlotInWindow && isChargingSlot(currentSlot);
  const nextChargingSlot = windowSlots.find((slot) =>
    slot.timestamp > (currentSlot?.timestamp || 0) && isChargingSlot(slot)
  );

  return {
    planSlots,
    chargingSlots,
    thresholdSlots,
    charge_now,
    nextChargingSlot,
    chargeSlotsNeeded,
    planSlotKeys
  };
}

module.exports = {
  selectCheapestPlanSlots,
  evaluateChargePlan
};
