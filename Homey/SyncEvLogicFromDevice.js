'use strict';

// Sync EV Ladeplan device capabilities -> Logic variables for legacy Flows.
// Homey apps cannot write Logic variables (Missing Scopes); HomeyScript can.
// Schedule this script every 15 minutes, or run after plan changes.

const DEVICE_NAME = 'EV Ladeplan';
const CHARGE_NOW_VARIABLE_NAME = 'charge_now';
const CHARGE_MESSAGE_VARIABLE_NAME = 'charge_message';

function parseLogicBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'on';
}

async function getLogicVarByName(name) {
  const all = await Homey.logic.getVariables();
  return Object.values(all).find((variable) => variable.name === name) || null;
}

async function setLogicVariable(name, value, type, defaultValue) {
  let variable = await getLogicVarByName(name);

  if (!variable) {
    variable = await Homey.logic.createVariable({
      variable: { name, type, value: defaultValue }
    });
  }

  const coercedValue = type === 'boolean'
    ? parseLogicBoolean(value)
    : type === 'number'
      ? Number(value)
      : String(value ?? '');

  if (variable.value === coercedValue) {
    return false;
  }

  await Homey.logic.updateVariable({
    id: variable.id,
    variable: { value: coercedValue }
  });
  return true;
}

async function findPlannerDevice() {
  const devices = await Homey.devices.getDevices();
  return Object.values(devices).find((device) => device.name === DEVICE_NAME) || null;
}

async function main() {
  const device = await findPlannerDevice();
  if (!device) {
    throw new Error(`Device '${DEVICE_NAME}' not found`);
  }

  const chargeNow = await device.getCapabilityValue('charge_now');
  const chargeMessage = await device.getCapabilityValue('charge_message');

  const updatedNow = await setLogicVariable(
    CHARGE_NOW_VARIABLE_NAME,
    Boolean(chargeNow),
    'boolean',
    false
  );
  const updatedMessage = await setLogicVariable(
    CHARGE_MESSAGE_VARIABLE_NAME,
    chargeMessage || '',
    'string',
    ''
  );

  if (updatedNow || updatedMessage) {
    console.log(`Logic synced: charge_now=${Boolean(chargeNow)} | ${chargeMessage || ''}`);
  } else {
    console.log('Logic already in sync');
  }
}

await main();
