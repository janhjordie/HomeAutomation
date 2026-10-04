'use strict';

const { formatDateInTimeZone, addDays } = require('./timezone');
const { DK_TIME_ZONE } = require('./constants');
const {
  buildDayChargeWindow,
  buildTonightChargeWindow,
  getSlotsForWindow
} = require('./planner/windows');

function formatKr(value) {
  return Number(value).toFixed(2).replace('.', ',');
}

function minSpotPrice(slots) {
  if (!slots?.length) {
    return null;
  }

  return slots.reduce(
    (min, slot) => Math.min(min, slot.spotPriceInclVat),
    slots[0].spotPriceInclVat
  );
}

function buildTomorrowPriceFingerprint(tomorrowSlots) {
  if (!tomorrowSlots?.length) {
    return null;
  }

  const minPrice = minSpotPrice(tomorrowSlots);
  const dates = [...new Set(tomorrowSlots.map((slot) => slot.date))].sort().join(',');
  return `${dates}|${tomorrowSlots.length}|${minPrice?.toFixed(4)}`;
}

function buildPriceSavingsMessage(allSlots, appConfig, now = new Date()) {
  const timeZone = appConfig.timeZone || DK_TIME_ZONE;
  const today = formatDateInTimeZone(now, timeZone);
  const tomorrow = addDays(today, 1);
  const windowConfig = appConfig.windowConfig || {};

  const dayTodayWindow = buildDayChargeWindow(today, windowConfig);
  const dayTomorrowWindow = buildDayChargeWindow(tomorrow, windowConfig);
  const nightTonightWindow = buildTonightChargeWindow(today, tomorrow, windowConfig);
  const nightTomorrowWindow = buildTonightChargeWindow(tomorrow, addDays(tomorrow, 1), windowConfig);

  const todayDaySlots = getSlotsForWindow(allSlots, dayTodayWindow);
  const tomorrowDaySlots = getSlotsForWindow(allSlots, dayTomorrowWindow);
  const tonightSlots = getSlotsForWindow(allSlots, nightTonightWindow);
  const tomorrowNightSlots = getSlotsForWindow(allSlots, nightTomorrowWindow);

  if (!tomorrowDaySlots.length && !tomorrowNightSlots.length) {
    return null;
  }

  const lines = [];
  const minTodayDay = minSpotPrice(todayDaySlots);
  const minTomorrowDay = minSpotPrice(tomorrowDaySlots);
  const minTonight = minSpotPrice(tonightSlots);
  const minTomorrowNight = minSpotPrice(tomorrowNightSlots);

  if (minTodayDay != null && minTomorrowDay != null && minTomorrowDay < minTodayDay) {
    const diff = minTodayDay - minTomorrowDay;
    lines.push(
      `Dag i morgen: ${formatKr(minTomorrowDay)} kr/kWh (i dag ${formatKr(minTodayDay)}, spar ${formatKr(diff)} kr/kWh)`
    );
  }

  if (minTonight != null && minTomorrowNight != null && minTomorrowNight < minTonight) {
    const diff = minTonight - minTomorrowNight;
    lines.push(
      `Næste nat: ${formatKr(minTomorrowNight)} kr/kWh (denne nat ${formatKr(minTonight)}, spar ${formatKr(diff)} kr/kWh)`
    );
  }

  if (!lines.length) {
    return null;
  }

  return `Nye elpriser — penge at spare:\n${lines.join('\n')}`;
}

module.exports = {
  formatKr,
  minSpotPrice,
  buildTomorrowPriceFingerprint,
  buildPriceSavingsMessage
};
