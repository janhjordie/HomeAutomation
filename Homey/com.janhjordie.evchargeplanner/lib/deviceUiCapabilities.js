'use strict';

const UI_CAPABILITIES = [
  'night_charge_enabled',
  'one_shot_enabled',
  'charge_hours',
  'one_shot_charge_hours'
];

async function ensureUiCapabilities(device) {
  for (const capability of UI_CAPABILITIES) {
    if (!device.hasCapability(capability)) {
      await device.addCapability(capability);
    }
  }
}

async function syncUiCapabilitiesFromSettings(device, settings = {}) {
  const updates = [];

  if (device.hasCapability('one_shot_enabled')) {
    updates.push(device.setCapabilityValue('one_shot_enabled', Boolean(settings.one_shot_enabled)));
  }

  if (device.hasCapability('night_charge_enabled')) {
    updates.push(device.setCapabilityValue('night_charge_enabled', settings.night_charge_enabled !== false));
  }

  if (device.hasCapability('charge_hours')) {
    const chargeHours = Number(settings.charge_hours);
    if (Number.isInteger(chargeHours) && chargeHours > 0) {
      updates.push(device.setCapabilityValue('charge_hours', chargeHours));
    }
  }

  if (device.hasCapability('one_shot_charge_hours')) {
    const oneShotHours = Number(settings.one_shot_charge_hours);
    if (Number.isInteger(oneShotHours) && oneShotHours > 0) {
      updates.push(device.setCapabilityValue('one_shot_charge_hours', oneShotHours));
    }
  }

  await Promise.all(updates);
}

module.exports = {
  UI_CAPABILITIES,
  ensureUiCapabilities,
  syncUiCapabilitiesFromSettings
};
