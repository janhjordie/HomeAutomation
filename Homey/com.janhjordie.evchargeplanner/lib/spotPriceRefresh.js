'use strict';

const Homey = require('homey');
const { buildAppConfig } = require('./evaluator');
const { fetchPrices } = require('./price/fetchPrices');
const { fetchStromligningNowPrice } = require('./price/stromligning');
const { findCurrentSlot } = require('./price/slotBuilder');
const { LogicCompat } = require('./logicCompat');
const { formatSlotTime, getDateTimePartsInTimeZone } = require('./timezone');

async function resolveStromligningApiKey(homey, appConfig) {
  if (appConfig.stromligningApiKey) {
    return appConfig.stromligningApiKey;
  }

  const logicCompat = new LogicCompat(homey, () => {});
  return logicCompat.getStromligningApiKeyFromLogic();
}

function mergeCurrentQuarterSlot(nowPriceSlot, timeZone, now = new Date()) {
  const current = getDateTimePartsInTimeZone(now, timeZone);

  return {
    ...nowPriceSlot,
    date: current.date,
    hour: current.hour,
    minute: current.minute,
    timestamp: now.getTime()
  };
}

async function fetchCurrentSpotPrice(homey, appSettings = {}, env = Homey.env) {
  const appConfig = buildAppConfig(appSettings, env);
  appConfig.stromligningApiKey = await resolveStromligningApiKey(homey, appConfig);
  const now = new Date();

  if (appConfig.stromligningApiKey) {
    try {
      const nowPrice = await fetchStromligningNowPrice(
        appConfig.stromligningApiKey,
        appConfig.priceArea
      );

      return {
        spotPriceInclVat: nowPrice.spotPriceInclVat,
        currentSlot: mergeCurrentQuarterSlot(nowPrice.currentSlot, appConfig.timeZone, now),
        fetchLog: `Spotpris fra Stromligning now (${nowPrice.resolution}).`,
        priceSource: nowPrice.priceSource
      };
    } catch (nowError) {
      // Fall back to day-ahead slot data below.
    }
  }

  const priceData = await fetchPrices({
    priceArea: appConfig.priceArea,
    stromligningApiKey: appConfig.stromligningApiKey,
    now,
    timeZone: appConfig.timeZone
  });

  const currentSlot = findCurrentSlot(priceData.allSlots, now, appConfig.timeZone);

  return {
    spotPriceInclVat: currentSlot?.spotPriceInclVat ?? null,
    currentSlot,
    fetchLog: priceData.fetchLog,
    priceSource: priceData.priceSource
  };
}

async function setSpotPriceCapability(device, value) {
  const rounded = Number(value);
  if (!Number.isFinite(rounded)) {
    return false;
  }

  const current = Number(device.getCapabilityValue('spot_price'));
  if (current === rounded) {
    await device.setCapabilityValue('spot_price', Number((rounded + 0.001).toFixed(3)));
  }

  await device.setCapabilityValue('spot_price', rounded);
  return true;
}

async function setSpotPriceQuarterCapability(device, currentSlot) {
  if (!device.hasCapability('spot_price_quarter') || !currentSlot) {
    return false;
  }

  const quarterLabel = formatSlotTime(currentSlot);
  await device.setCapabilityValue('spot_price_quarter', quarterLabel);
  return true;
}

async function updateDeviceSpotPrice(device, options = {}) {
  if (!device?.hasCapability?.('spot_price')) {
    return null;
  }

  const appSettings = typeof options.getAppSettings === 'function'
    ? options.getAppSettings()
    : options.appSettings || {};
  const spotData = await fetchCurrentSpotPrice(device.homey, appSettings, options.env || Homey.env);
  const spotPrice = Number(spotData.spotPriceInclVat);

  if (!Number.isFinite(spotPrice)) {
    return null;
  }

  const rounded = Number(spotPrice.toFixed(2));
  await setSpotPriceCapability(device, rounded);
  await setSpotPriceQuarterCapability(device, spotData.currentSlot);

  if (typeof options.log === 'function') {
    options.log(`spot_price=${rounded} kvarter=${formatSlotTime(spotData.currentSlot || {})} (${options.reason || 'spot_refresh'})`);
  }

  return {
    spotPrice: rounded,
    currentSlot: spotData.currentSlot
  };
}

module.exports = {
  fetchCurrentSpotPrice,
  setSpotPriceCapability,
  setSpotPriceQuarterCapability,
  updateDeviceSpotPrice
};
