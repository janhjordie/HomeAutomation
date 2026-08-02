// =================================================================
// Easee charger control via Homey device API (HomeyScript)
// Bruges i Flows eller manuelt test — app'en styrer Easee automatisk
// når easee_control_enabled er slået til i EV Charge Planner.
// =================================================================

const EASEE_DEVICE_ID = 'ecc2f7c6-b239-4281-9033-28c68272d8f2';
const DEFAULT_CIRCUIT_CURRENT = 16;

const CAP_TARGET_CIRCUIT_CURRENT = 'target_circuit_current';
const CAP_ONOFF = 'onoff';
const CAP_EVCHARGER_CHARGING = 'evcharger_charging';
const CAP_MEASURE_POWER = 'measure_power';
const CAP_CHARGING_STATE = 'evcharger_charging_state';
const CAP_CHARGER_STATUS = 'charger_status';

async function getEaseeDevice() {
  const device = await Homey.devices.getDevice({ id: EASEE_DEVICE_ID });
  if (!device) {
    throw new Error(`Easee device ${EASEE_DEVICE_ID} ikke fundet`);
  }
  return device;
}

function readEaseeState(device) {
  const caps = device.capabilitiesObj || {};
  return {
    id: device.id,
    name: device.name,
    measurePowerW: Number(caps[CAP_MEASURE_POWER]?.value) || 0,
    onoff: Boolean(caps[CAP_ONOFF]?.value),
    evchargerCharging: Boolean(caps[CAP_EVCHARGER_CHARGING]?.value),
    chargingState: caps[CAP_CHARGING_STATE]?.value || null,
    targetCircuitCurrentA: Number(caps[CAP_TARGET_CIRCUIT_CURRENT]?.value) || 0,
    chargerStatus: caps[CAP_CHARGER_STATUS]?.value || null
  };
}

async function startEaseeCharging(circuitCurrent = DEFAULT_CIRCUIT_CURRENT) {
  const device = await getEaseeDevice();
  const amps = Number(circuitCurrent);

  if (!Number.isInteger(amps) || amps <= 0) {
    throw new Error(`Ugyldig circuit current: ${circuitCurrent}`);
  }

  await device.setCapabilityValue(CAP_TARGET_CIRCUIT_CURRENT, amps);
  await device.setCapabilityValue(CAP_ONOFF, true);
  await device.setCapabilityValue(CAP_EVCHARGER_CHARGING, true);

  const state = readEaseeState(device);
  log(`Easee start: ${amps}A | ${state.name} | ${state.measurePowerW}W`);
  return state;
}

async function stopEaseeCharging() {
  const device = await getEaseeDevice();

  await device.setCapabilityValue(CAP_TARGET_CIRCUIT_CURRENT, 0);
  await device.setCapabilityValue(CAP_ONOFF, false);
  await device.setCapabilityValue(CAP_EVCHARGER_CHARGING, false);

  const state = readEaseeState(device);
  log(`Easee stop: ${state.name} | status=${state.chargerStatus}`);
  return state;
}

async function readEaseeChargingState() {
  const device = await getEaseeDevice();
  const state = readEaseeState(device);
  log(`Easee: ${state.name} | ${state.measurePowerW}W | onoff=${state.onoff} | circuit=${state.targetCircuitCurrentA}A | ${state.chargingState}`);
  return state;
}

// Kør med args.charge_now (boolean) fra Flow, eller args.action = 'read'|'start'|'stop'
const action = String(args?.action || '').trim().toLowerCase();
const chargeNow = args?.charge_now;
const circuitCurrent = Number(args?.circuit_current) || DEFAULT_CIRCUIT_CURRENT;

if (action === 'read') {
  return await readEaseeChargingState();
}

if (action === 'start' || chargeNow === true || chargeNow === 'true' || chargeNow === 1) {
  return await startEaseeCharging(circuitCurrent);
}

if (action === 'stop' || chargeNow === false || chargeNow === 'false' || chargeNow === 0) {
  return await stopEaseeCharging();
}

return await readEaseeChargingState();
