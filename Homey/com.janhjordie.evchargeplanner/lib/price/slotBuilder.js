'use strict';

// BacklogTrace: EVC-003, EVC-004
const { SLOT_MINUTES, VAT_MULTIPLIER } = require('../constants');
const { normalizeQuarterMinute } = require('../timezone');

const SLOT_MS = SLOT_MINUTES * 60 * 1000;
const SLOTS_PER_HOUR = 60 / SLOT_MINUTES;

function parseSlotDK(dateTimeDK) {
  const [datePart, timePart] = dateTimeDK.split('T');
  const [hourPart, minutePart = '00'] = timePart.split(':');

  return {
    date: datePart,
    hour: Number(hourPart),
    minute: Number(minutePart.slice(0, 2))
  };
}

function getSpotPriceInclVat(spotPriceExVat, spotPriceInclVat) {
  if (Number.isFinite(spotPriceInclVat)) {
    return spotPriceInclVat;
  }

  return spotPriceExVat * VAT_MULTIPLIER;
}

function getSlotKey(slot) {
  return `${slot.date}T${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}`;
}

function buildQuarterPricesFromEnergiDataService(records) {
  return records
    .map((record) => {
      const parsed = parseSlotDK(record.TimeDK);
      const minute = normalizeQuarterMinute(parsed.minute);
      const spotPriceExVat = record.DayAheadPriceDKK / 1000;

      return {
        date: parsed.date,
        hour: parsed.hour,
        minute,
        timestamp: new Date(`${record.TimeUTC}Z`).getTime(),
        spotPrice: spotPriceExVat,
        spotPriceInclVat: getSpotPriceInclVat(spotPriceExVat)
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

function buildQuarterPricesFromStromligning(prices) {
  return prices
    .map((entry) => {
      const parsed = parseSlotDK(entry.localDate);
      const minute = normalizeQuarterMinute(parsed.minute);
      const electricity = entry.details?.electricity || {};
      const spotPriceExVat = electricity.value || 0;
      const spotPriceInclVat = getSpotPriceInclVat(spotPriceExVat, electricity.total);

      return {
        date: parsed.date,
        hour: parsed.hour,
        minute,
        timestamp: new Date(entry.date).getTime(),
        spotPrice: spotPriceExVat,
        spotPriceInclVat
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

function expandHourlySlotsToQuarters(slots) {
  if (slots.length < 2) {
    return slots;
  }

  const sorted = [...slots].sort((a, b) => a.timestamp - b.timestamp);
  const averageGapMs = (sorted[sorted.length - 1].timestamp - sorted[0].timestamp)
    / (sorted.length - 1);

  if (averageGapMs <= SLOT_MS * 1.5) {
    return slots;
  }

  const expanded = [];

  for (const slot of sorted) {
    for (let quarter = 0; quarter < SLOTS_PER_HOUR; quarter++) {
      const minute = quarter * SLOT_MINUTES;

      expanded.push({
        ...slot,
        minute,
        timestamp: slot.timestamp + (quarter * SLOT_MS)
      });
    }
  }

  return expanded.sort((a, b) => a.timestamp - b.timestamp);
}

function isHourlyExpandedSlots(slots) {
  if (slots.length < SLOTS_PER_HOUR + 1) {
    return false;
  }

  const buckets = new Map();

  for (const slot of slots) {
    const key = `${slot.date}T${String(slot.hour).padStart(2, '0')}`;
    const bucket = buckets.get(key) || new Set();
    bucket.add(slot.spotPriceInclVat.toFixed(6));
    buckets.set(key, bucket);
  }

  let hoursWithMultipleQuarters = 0;
  let hoursWithIdenticalQuarters = 0;

  for (const uniquePrices of buckets.values()) {
    if (uniquePrices.size === 0) {
      continue;
    }

    hoursWithMultipleQuarters += 1;

    if (uniquePrices.size === 1) {
      hoursWithIdenticalQuarters += 1;
    }
  }

  return hoursWithMultipleQuarters > 0
    && hoursWithIdenticalQuarters / hoursWithMultipleQuarters >= 0.9;
}

function findCurrentSlot(allSlots, now, timeZone) {
  const { getDateTimePartsInTimeZone } = require('../timezone');
  const current = getDateTimePartsInTimeZone(now, timeZone);
  const currentKey = `${current.date}T${String(current.hour).padStart(2, '0')}:${String(current.minute).padStart(2, '0')}`;

  return allSlots.find((slot) => getSlotKey(slot) === currentKey) || {
    date: current.date,
    hour: current.hour,
    minute: current.minute,
    timestamp: now.getTime(),
    spotPrice: null,
    spotPriceInclVat: null
  };
}

module.exports = {
  parseSlotDK,
  getSpotPriceInclVat,
  getSlotKey,
  buildQuarterPricesFromEnergiDataService,
  buildQuarterPricesFromStromligning,
  expandHourlySlotsToQuarters,
  isHourlyExpandedSlots,
  findCurrentSlot,
  SLOT_MS,
  SLOTS_PER_HOUR
};
