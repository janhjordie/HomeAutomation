'use strict';

// BacklogTrace: EVC-004
const {
  STROMLIGNING_API_BASE_URL,
  STROMLIGNING_SUPPLIER_ID,
  STROMLIGNING_CUSTOMER_GROUP_ID,
  STROMLIGNING_AGGREGATION
} = require('../constants');
const {
  buildQuarterPricesFromStromligning,
  expandHourlySlotsToQuarters
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

module.exports = {
  fetchStromligningPriceData
};
