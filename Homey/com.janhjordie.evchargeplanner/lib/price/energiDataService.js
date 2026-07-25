'use strict';

// BacklogTrace: EVC-004
const { DATASET } = require('../constants');
const {
  buildQuarterPricesFromEnergiDataService,
  expandHourlySlotsToQuarters
} = require('./slotBuilder');

async function fetchEnergiDataServicePriceData(priceArea, yesterdayDate, dayAfterTomorrowDate, todayDate, tomorrowDate) {
  const params = new URLSearchParams({
    start: `${yesterdayDate}T00:00`,
    end: `${dayAfterTomorrowDate}T00:00`,
    filter: JSON.stringify({ PriceArea: priceArea }),
    sort: 'TimeDK ASC',
    limit: '2000'
  });
  const url = `https://api.energidataservice.dk/dataset/${DATASET}?${params.toString()}`;

  const res = await fetch(url);
  const json = await res.json();

  if (!json.records || json.records.length === 0) {
    throw new Error(`Ingen data fundet i ${DATASET} for ${todayDate} eller ${tomorrowDate}`);
  }

  json.records.sort((a, b) => new Date(`${a.TimeUTC}Z`) - new Date(`${b.TimeUTC}Z`));

  const allSlots = expandHourlySlotsToQuarters(buildQuarterPricesFromEnergiDataService(json.records));
  const slots = allSlots.filter((entry) => entry.date === todayDate || entry.date === tomorrowDate);
  const todaySlots = slots.filter((entry) => entry.date === todayDate);
  const tomorrowSlots = slots.filter((entry) => entry.date === tomorrowDate);

  if (todaySlots.length === 0) {
    throw new Error(`Ingen priser fundet for i dag (${todayDate})`);
  }

  return {
    allSlots,
    todaySlots,
    tomorrowSlots,
    priceSource: 'energidataservice',
    priceResolution: '15m'
  };
}

module.exports = {
  fetchEnergiDataServicePriceData
};
