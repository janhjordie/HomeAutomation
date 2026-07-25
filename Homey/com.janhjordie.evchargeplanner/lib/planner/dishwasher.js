'use strict';

// BacklogTrace: EVC-003
const { formatLocalTime } = require('../timezone');
const { formatHourNumber } = require('../timezone');

function aggregateSlotsToHours(windowSlots) {
  const buckets = new Map();

  for (const slot of windowSlots) {
    const key = `${slot.date}T${String(slot.hour).padStart(2, '0')}`;
    const bucket = buckets.get(key) || {
      date: slot.date,
      hour: slot.hour,
      timestamp: slot.timestamp,
      spotPriceInclVatSum: 0,
      count: 0
    };

    bucket.spotPriceInclVatSum += slot.spotPriceInclVat;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  return Array.from(buckets.values())
    .map((bucket) => ({
      date: bucket.date,
      hour: bucket.hour,
      timestamp: bucket.timestamp,
      price: bucket.spotPriceInclVatSum / bucket.count
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function findCheapestDishwasherSlot(windowHours, timeZone) {
  let bestSlot = null;

  for (let index = 0; index < windowHours.length; index++) {
    const currentEntry = windowHours[index];
    const nextEntry = windowHours[index + 1];

    if (!nextEntry || nextEntry.timestamp - currentEntry.timestamp !== 60 * 60 * 1000) {
      continue;
    }

    const candidate = {
      startTimestamp: currentEntry.timestamp,
      endTimestamp: currentEntry.timestamp + (90 * 60 * 1000),
      totalPrice: (currentEntry.price * 1.0) + (nextEntry.price * 0.5),
      startHour: currentEntry.hour
    };

    if (!bestSlot || candidate.totalPrice < bestSlot.totalPrice) {
      bestSlot = candidate;
    }
  }

  if (!bestSlot) {
    return null;
  }

  return {
    ...bestSlot,
    startTime: formatLocalTime(bestSlot.startTimestamp, timeZone),
    endTime: formatLocalTime(bestSlot.endTimestamp, timeZone),
    message: `Opvask kl. ${formatHourNumber(bestSlot.startHour)}`
  };
}

module.exports = {
  aggregateSlotsToHours,
  findCheapestDishwasherSlot
};
