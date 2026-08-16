'use strict';

const UI_CAPABILITIES = [
  'night_charge_enabled',
  'one_shot_enabled',
  'cheapest_plan_only',
  'charge_hours',
  'one_shot_charge_hours',
  'night_charge_end',
  'spot_threshold'
];

const { DEFAULT_SPOT_CHARGE_THRESHOLD_KR_INCL_VAT } = require('./constants');
const {
  parseNightChargeEnd,
  partsToDecimalHour
} = require('./planner/windowConfig');

function resolveNightChargeEndDecimal(settings = {}) {
  const parsed = parseNightChargeEnd(settings.night_charge_end);
  return partsToDecimalHour(parsed.hour, parsed.minute);
}

async function ensureUiCapabilities(device) {
  for (const capability of UI_CAPABILITIES) {
    if (!device.hasCapability(capability)) {
      await device.addCapability(capability);
    }
  }
}

async function syncUiCapabilitiesFromSettings(device, settings = {}) {
  const updates = [];
  const has = (key) => Object.prototype.hasOwnProperty.call(settings, key);

  if (device.hasCapability('one_shot_enabled') && has('one_shot_enabled')) {
    updates.push(device.setCapabilityValue('one_shot_enabled', Boolean(settings.one_shot_enabled)));
  }

  if (device.hasCapability('night_charge_enabled') && has('night_charge_enabled')) {
    updates.push(device.setCapabilityValue('night_charge_enabled', settings.night_charge_enabled !== false));
  }

  if (device.hasCapability('cheapest_plan_only') && has('cheapest_plan_only')) {
    updates.push(device.setCapabilityValue('cheapest_plan_only', settings.cheapest_plan_only === true));
  }

  if (device.hasCapability('charge_hours') && has('charge_hours')) {
    const chargeHours = Number(settings.charge_hours);
    if (Number.isInteger(chargeHours) && chargeHours > 0) {
      updates.push(device.setCapabilityValue('charge_hours', chargeHours));
    }
  }

  if (device.hasCapability('one_shot_charge_hours') && has('one_shot_charge_hours')) {
    const oneShotHours = Number(settings.one_shot_charge_hours);
    if (Number.isInteger(oneShotHours) && oneShotHours > 0) {
      updates.push(device.setCapabilityValue('one_shot_charge_hours', oneShotHours));
    }
  }

  if (device.hasCapability('night_charge_end') && has('night_charge_end')) {
    updates.push(device.setCapabilityValue('night_charge_end', resolveNightChargeEndDecimal(settings)));
  }

  if (device.hasCapability('spot_threshold') && has('spot_threshold')) {
    const spotThreshold = Number(settings.spot_threshold);
    if (Number.isFinite(spotThreshold) && spotThreshold > 0) {
      updates.push(device.setCapabilityValue('spot_threshold', spotThreshold));
    } else {
      updates.push(device.setCapabilityValue('spot_threshold', DEFAULT_SPOT_CHARGE_THRESHOLD_KR_INCL_VAT));
    }
  }

  await Promise.all(updates);
}

module.exports = {
  UI_CAPABILITIES,
  ensureUiCapabilities,
  syncUiCapabilitiesFromSettings,
  resolveNightChargeEndDecimal
};
