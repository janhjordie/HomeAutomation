'use strict';

// BacklogTrace: EVC-004
const {
  STROMLIGNING_API_BASE_URL,
  STROMLIGNING_SUPPLIER_ID,
  STROMLIGNING_CUSTOMER_GROUP_ID,
  STROMLIGNING_AGGREGATION
} = require('../constants');
const { DEFAULT_PRICE_AREA } = require('../constants');
const { normalizeQuarterMinute } = require('../timezone');
const {
  buildQuarterPricesFromStromligning,
  expandHourlySlotsToQuarters,
  getSpotPriceInclVat,
  parseSlotDK
} = require('./slotBuilder');

async function fetchStromligningPriceData(apiKey, todayDate, tomorrowDate) {
  if (!apiKey) {
    throw new Error('Stromligning API-nøgle mangler');
  }

  const params = new URLSearchParams({
    supplierId: STROMLIGNING_SUPPLIER_ID,
    customerGroupId: STROMLIGNING_CUSTOMER_GROUP_ID,
    aggregation: STROMLIGNING_AGGREGATION
  });
  const url = `${STROMLIGNING_API_BASE_URL}/prices?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-API-Key': apiKey
    }
  });

  if (!res.ok) {
    throw new Error(`Stromligning API fejl (${res.status})`);
  }

  const json = await res.json();

  if (!json.prices || json.prices.length === 0) {
    throw new Error('Ingen Stromligning-priser fundet');
  }

  const allSlots = expandHourlySlotsToQuarters(buildQuarterPricesFromStromligning(json.prices));
  const slots = allSlots.filter((entry) => entry.date === todayDate || entry.date === tomorrowDate);
  const todaySlots = slots.filter((entry) => entry.date === todayDate);
  const tomorrowSlots = slots.filter((entry) => entry.date === tomorrowDate);

  if (todaySlots.length === 0) {
    throw new Error(`Ingen Stromligning-priser fundet for i dag (${todayDate})`);
  }

  return {
    allSlots,
    todaySlots,
    tomorrowSlots,
    priceSource: 'stromligning',
    priceResolution: '1h->15m'
  };
}

function buildSlotFromStromligningPriceEntry(entry) {
  const parsed = parseSlotDK(entry.localDate || '');
  const electricity = entry.details?.electricity || {};
  const spotPriceExVat = electricity.value || 0;
  const spotPriceInclVat = getSpotPriceInclVat(spotPriceExVat, electricity.total);

  return {
    date: parsed.date,
    hour: parsed.hour,
    minute: normalizeQuarterMinute(parsed.minute),
    timestamp: new Date(entry.date || Date.now()).getTime(),
    spotPrice: spotPriceExVat,
    spotPriceInclVat
  };
}

async function fetchStromligningNowPrice(apiKey, priceArea = DEFAULT_PRICE_AREA) {
  if (!apiKey) {
    throw new Error('Stromligning API-nøgle mangler');
  }

  const params = new URLSearchParams({
    supplierId: STROMLIGNING_SUPPLIER_ID,
    customerGroupId: STROMLIGNING_CUSTOMER_GROUP_ID,
    priceArea
  });
  const url = `${STROMLIGNING_API_BASE_URL}/prices/now?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-API-Key': apiKey
    }
  });

  if (!res.ok) {
    throw new Error(`Stromligning now API fejl (${res.status})`);
  }

  const json = await res.json();
  const entry = json.price;

  if (!entry) {
    throw new Error('Ingen Stromligning now-pris fundet');
  }

  const currentSlot = buildSlotFromStromligningPriceEntry(entry);

  return {
    spotPriceInclVat: currentSlot.spotPriceInclVat,
    currentSlot,
    resolution: entry.resolution || '15m',
    priceSource: 'stromligning_now'
  };
}

module.exports = {
  fetchStromligningPriceData,
  fetchStromligningNowPrice,
  buildSlotFromStromligningPriceEntry
};
