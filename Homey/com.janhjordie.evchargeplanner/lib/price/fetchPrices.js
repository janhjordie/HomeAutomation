'use strict';

// BacklogTrace: EVC-004
const { DATASET, DEFAULT_PRICE_AREA } = require('../constants');
const { formatDateInTimeZone, addDays } = require('../timezone');
const { fetchEnergiDataServicePriceData } = require('./energiDataService');
const { fetchStromligningPriceData } = require('./stromligning');
const { isHourlyExpandedSlots } = require('./slotBuilder');

async function fetchPrices(options = {}) {
  const {
    priceArea = DEFAULT_PRICE_AREA,
    stromligningApiKey = '',
    now = new Date(),
    timeZone
  } = options;

  const today = formatDateInTimeZone(now, timeZone);
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const dayAfterTomorrow = addDays(today, 2);

  try {
    const priceData = await fetchEnergiDataServicePriceData(
      priceArea,
      yesterday,
      dayAfterTomorrow,
      today,
      tomorrow
    );

    return {
      ...priceData,
      usesHourlyExpandedPrices: false,
      fetchLog: 'Priser hentet fra Energi Data Service (kvartersoploesning).'
    };
  } catch (edsError) {
    try {
      const priceData = await fetchStromligningPriceData(stromligningApiKey, today, tomorrow);

      return {
        ...priceData,
        usesHourlyExpandedPrices: priceData.priceResolution === '1h->15m'
          || isHourlyExpandedSlots(priceData.todaySlots),
        fetchLog: `${DATASET} utilgaengelig (${edsError.message}). Falder tilbage til Stromligning.`,
        edsError
      };
    } catch (stromligningError) {
      const error = new Error(stromligningError.message);
      error.edsError = edsError;
      error.stromligningError = stromligningError;
      throw error;
    }
  }
}

module.exports = {
  fetchPrices
};
