'use strict';

const { DEFAULT_CHARGER_KW } = require('./constants');

const SYSTEM_CHARGING_CAPABILITIES = [
  'measure_power',
  'evcharger_charging',
  'evcharger_charging_state'
];

function getMeasurePowerW(chargeNow, chargerKw) {
  if (!chargeNow) {
    return 0;
  }

  const kw = Number(chargerKw);
  return Math.round((Number.isFinite(kw) && kw > 0 ? kw : DEFAULT_CHARGER_KW) * 1000);
}

function getChargingState(chargeNow) {
  return chargeNow ? 'plugged_in_charging' : 'plugged_in';
}

async function ensureSystemChargingCapabilities(device) {
  for (const capability of SYSTEM_CHARGING_CAPABILITIES) {
    if (!device.hasCapability(capability)) {
      await device.addCapability(capability);
    }
  }
}

async function syncChargingCapabilities(device, {
  chargeNow,
  chargerKw,
  powerW,
  chargingState,
  evchargerCharging
}) {
  const charging = typeof evchargerCharging === 'boolean'
    ? evchargerCharging
    : Boolean(chargeNow);
  const resolvedPowerW = Number.isFinite(powerW)
    ? Math.round(powerW)
    : getMeasurePowerW(charging, chargerKw);
  const resolvedState = chargingState || getChargingState(charging);

  await device.setCapabilityValue('measure_power', resolvedPowerW);
  await device.setCapabilityValue('evcharger_charging', charging);
  await device.setCapabilityValue('evcharger_charging_state', resolvedState);
}

function buildEaseeChargingSync(easeeState, chargeNow, chargerKw) {
  if (!easeeState) {
    return {
      chargeNow,
      chargerKw
    };
  }

  const powerW = Number(easeeState.measurePower) || 0;
  const evchargerCharging = Boolean(easeeState.evchargerCharging) || powerW > 0;
  const chargingState = easeeState.chargingState
    || (powerW > 0 ? 'plugged_in_charging' : 'plugged_in');

  return {
    chargeNow,
    chargerKw,
    powerW,
    chargingState,
    evchargerCharging
  };
}

module.exports = {
  SYSTEM_CHARGING_CAPABILITIES,
  getMeasurePowerW,
  getChargingState,
  ensureSystemChargingCapabilities,
  syncChargingCapabilities,
  buildEaseeChargingSync
};
