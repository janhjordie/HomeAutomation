'use strict';

// BacklogTrace: EVC-003, EVC-004
const assert = require('assert');
const { buildDeviceConfig, buildAppConfig, evaluateChargePlanForDevice } = require('../lib/evaluator');
const { evaluateChargePlan } = require('../lib/planner/chargePlan');
const { getChargePlanWindow } = require('../lib/planner/windows');
const { getSlotKey } = require('../lib/price/slotBuilder');

function testBuildDeviceConfig() {
  const config = buildDeviceConfig({ charge_hours: 2, force_charge: true });
  assert.strictEqual(config.chargeHours, 2);
  assert.strictEqual(config.forceCharge, true);
}

function testEvaluateChargePlan() {
  const slots = [
    { date: '2026-07-24', hour: 9, minute: 0, timestamp: 1, spotPriceInclVat: 0.50 },
    { date: '2026-07-24', hour: 9, minute: 15, timestamp: 2, spotPriceInclVat: 0.20 },
    { date: '2026-07-24', hour: 9, minute: 30, timestamp: 3, spotPriceInclVat: 0.55 },
    { date: '2026-07-24', hour: 9, minute: 45, timestamp: 4, spotPriceInclVat: 0.18 }
  ];

  const current = slots[1];
  const result = evaluateChargePlan(slots, 1, 0.30, current);

  assert.strictEqual(result.charge_now, true);
  assert.ok(result.chargingSlots.length >= 2);
}

function testDayWindow() {
  const window = getChargePlanWindow(10, '2026-07-24', '2026-07-23', '2026-07-25', {
    dayChargeStart: 9,
    dayChargeEnd: 17,
    nightChargeStart: 21,
    nightChargeEnd: 6,
    dayPlanSwitchHour: 7,
    nightPlanSwitchHour: 17
  });
  assert.strictEqual(window.planType, 'day');
}

function testChargingCapabilities() {
  const { getMeasurePowerW, getChargingState } = require('../lib/chargingCapabilities');
  assert.strictEqual(getMeasurePowerW(true, 11), 11000);
  assert.strictEqual(getMeasurePowerW(false, 11), 0);
  assert.strictEqual(getChargingState(true), 'plugged_in_charging');
  assert.strictEqual(getChargingState(false), 'plugged_in');
}

function testWindowConfig() {
  const { buildWindowConfig } = require('../lib/planner/windowConfig');
  const config = buildWindowConfig({ day_charge_start: 10, day_charge_end: 18 });
  assert.strictEqual(config.dayChargeStart, 10);
  assert.strictEqual(config.dayChargeEnd, 18);
  assert.strictEqual(config.dayPlanSwitchHour, 8);
  assert.strictEqual(config.nightPlanSwitchHour, 18);
}

async function testLiveFetchOptional() {
  if (process.env.SKIP_LIVE_FETCH === '1') {
    console.log('SKIP live fetch');
    return;
  }

  const appConfig = buildAppConfig({ price_area: 'DK2', spot_threshold: 0.30, charger_kw: 11 }, {});
  const deviceConfig = buildDeviceConfig({ charge_hours: 3 });

  const result = await evaluateChargePlanForDevice(deviceConfig, appConfig);
  assert.ok(typeof result.charge_now === 'boolean');
  assert.ok(typeof result.charge_message === 'string');
  console.log(`Live fetch OK: charge_now=${result.charge_now}, source=${result.priceSource}`);
}

function testOneShotSessionFinish() {
  const {
    isOneShotSessionFinished,
    buildOneShotSessionKey,
    parseCachedPlanKeys,
    serializeCachedPlanKeys
  } = require('../lib/planner/oneShot');
  const { SLOT_MS } = require('../lib/price/slotBuilder');

  const deadline = { date: '2026-07-25', hour: 9, minute: 30 };
  const slots = [
    { date: '2026-07-25', hour: 3, minute: 0, timestamp: Date.parse('2026-07-25T01:00:00.000Z') },
    { date: '2026-07-25', hour: 3, minute: 15, timestamp: Date.parse('2026-07-25T01:00:00.000Z') + SLOT_MS }
  ];
  const afterPlan = new Date(slots[1].timestamp + SLOT_MS + 1000);

  assert.strictEqual(
    isOneShotSessionFinished(afterPlan, deadline, slots, 'Europe/Copenhagen'),
    true
  );

  const sessionKey = buildOneShotSessionKey(deadline, 7, '09:30');
  assert.ok(sessionKey.includes('2026-07-25'));
  assert.deepStrictEqual(
    parseCachedPlanKeys(serializeCachedPlanKeys(['2026-07-25T03:00', '2026-07-25T03:15'])),
    ['2026-07-25T03:00', '2026-07-25T03:15']
  );
}

function testEaseeConfig() {
  const { buildEaseeConfig, shouldStartEasee, shouldStopEasee } = require('../lib/easeeCharger');

  const enabled = buildEaseeConfig({
    easee_control_enabled: true,
    easee_device_id: 'ecc2f7c6-b239-4281-9033-28c68272d8f2',
    easee_circuit_current: 16
  });
  assert.strictEqual(enabled.enabled, true);
  assert.strictEqual(enabled.circuitCurrent, 16);

  assert.strictEqual(shouldStartEasee({ onoff: false, targetCircuitCurrent: 0 }, 16), true);
  assert.strictEqual(shouldStartEasee({ onoff: true, targetCircuitCurrent: 16 }, 16), false);
  assert.strictEqual(shouldStopEasee({ onoff: true, targetCircuitCurrent: 16 }), true);
  assert.strictEqual(shouldStopEasee({ onoff: false, targetCircuitCurrent: 0 }), false);
}

async function main() {
  testBuildDeviceConfig();
  testEvaluateChargePlan();
  testDayWindow();
  testWindowConfig();
  testChargingCapabilities();
  testOneShotSessionFinish();
  testEaseeConfig();
  await testLiveFetchOptional();
  console.log('Smoke tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
