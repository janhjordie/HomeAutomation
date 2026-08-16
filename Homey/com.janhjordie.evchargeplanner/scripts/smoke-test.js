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

function testChargeNowOnlyDuringPlanSlots() {
  const { evaluateChargePlan } = require('../lib/planner/chargePlan');
  const slots = [];

  for (let hour = 9; hour < 17; hour++) {
    for (const minute of [0, 15, 30, 45]) {
      const spotPriceInclVat = hour < 13 ? 0.22 : 0.05;
      slots.push({
        date: '2026-08-05',
        hour,
        minute,
        timestamp: hour * 100 + minute,
        spotPriceInclVat
      });
    }
  }

  const current = slots.find((slot) => slot.hour === 11 && slot.minute === 15);
  const result = evaluateChargePlan(slots, 3, 0.30, current, { planOnly: true });

  assert.strictEqual(result.charge_now, false);
  assert.ok(result.planSlots.every((slot) => slot.hour >= 13));
}

function testChargeNowThresholdMode() {
  const { evaluateChargePlan } = require('../lib/planner/chargePlan');
  const slots = [];

  for (let hour = 9; hour < 17; hour++) {
    for (const minute of [0, 15, 30, 45]) {
      const spotPriceInclVat = hour < 13 ? 0.22 : 0.05;
      slots.push({
        date: '2026-08-05',
        hour,
        minute,
        timestamp: hour * 100 + minute,
        spotPriceInclVat
      });
    }
  }

  const current = slots.find((slot) => slot.hour === 11 && slot.minute === 15);
  const result = evaluateChargePlan(slots, 3, 0.30, current, { planOnly: false });

  assert.strictEqual(result.charge_now, true);
}

function testBuildDeviceConfigSpotThreshold() {
  const config = buildDeviceConfig({ spot_threshold: 0.42, cheapest_plan_only: true });
  assert.strictEqual(config.spotThreshold, 0.42);
  assert.strictEqual(config.cheapestPlanOnly, true);
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

function testQuarterSchedulerAlignment() {
  const { getMsUntilNextQuarterBoundary } = require('../lib/quarterScheduler');
  const at923 = new Date('2026-08-05T09:23:30.000+02:00');
  const delay = getMsUntilNextQuarterBoundary(at923, 'Europe/Copenhagen');

  assert.ok(delay > 0);
  assert.ok(delay <= 15 * 60 * 1000);
  assert.ok(delay < 7 * 60 * 1000);
}

function testChargeScheduleShowsTotalSpan() {
  const { formatChargeSchedule } = require('../lib/planner/oneShot');
  const { SLOT_MS } = require('../lib/price/slotBuilder');
  const base = Date.parse('2026-08-05T09:00:00.000Z'); // 11:00 DK summer
  const slots = [
    { date: '2026-08-05', hour: 11, minute: 0, timestamp: base, spotPriceInclVat: 0.10 },
    { date: '2026-08-05', hour: 11, minute: 15, timestamp: base + SLOT_MS, spotPriceInclVat: 0.11 },
    { date: '2026-08-05', hour: 14, minute: 0, timestamp: base + (12 * SLOT_MS), spotPriceInclVat: 0.05 },
    { date: '2026-08-05', hour: 14, minute: 15, timestamp: base + (13 * SLOT_MS), spotPriceInclVat: 0.06 }
  ];

  // 11:00 + 11:15 + 14:00 + 14:15 = 1h charge, wall span 11:00-14:30
  assert.strictEqual(formatChargeSchedule(slots, 'Europe/Copenhagen'), '11:00-14:30');
}

function testPlanScheduleUsesPlanSlotsOnly() {
  const { evaluateChargePlan } = require('../lib/planner/chargePlan');
  const { formatChargeSchedule } = require('../lib/planner/oneShot');
  const slots = [];

  for (let hour = 11; hour < 17; hour++) {
    for (const minute of [0, 15, 30, 45]) {
      slots.push({
        date: '2026-08-05',
        hour,
        minute,
        timestamp: hour * 100 + minute,
        spotPriceInclVat: hour < 15 ? 0.20 : 0.80
      });
    }
  }

  const current = slots[0];
  const evaluation = evaluateChargePlan(slots, 3, 0.30, current);
  const schedule = formatChargeSchedule(evaluation.planSlots, 'Europe/Copenhagen');

  assert.strictEqual(evaluation.planSlots.length, 12);
  assert.ok(!schedule.includes('17:00'));
  assert.ok(schedule.includes('11:00'));
}

function testOneShotChargeGate() {
  const { shouldChargeOneShotNow } = require('../lib/planner/oneShot');
  const { getSlotKey } = require('../lib/price/slotBuilder');
  const slot = { date: '2026-08-05', hour: 9, minute: 0, timestamp: 100, spotPriceInclVat: 1.04 };
  const laterSlot = { date: '2026-08-05', hour: 9, minute: 15, timestamp: 200, spotPriceInclVat: 1.02 };
  const evaluation = {
    planSlots: [slot, laterSlot],
    planSlotKeys: new Set([getSlotKey(slot), getSlotKey(laterSlot)])
  };

  assert.strictEqual(shouldChargeOneShotNow(evaluation, slot, 0.30), false);
  assert.strictEqual(shouldChargeOneShotNow(evaluation, laterSlot, 0.30), true);
  assert.strictEqual(shouldChargeOneShotNow(evaluation, { ...slot, spotPriceInclVat: 0.20 }, 0.30), true);
}

function testStromligningNowPriceParser() {
  const { buildSlotFromStromligningPriceEntry } = require('../lib/price/stromligning');
  const slot = buildSlotFromStromligningPriceEntry({
    date: '2026-08-05T08:00:00.000Z',
    localDate: '2026-08-05T10:15:00',
    details: {
      electricity: {
        value: 0.74749,
        total: 0.934363
      }
    }
  });

  assert.strictEqual(slot.hour, 10);
  assert.strictEqual(slot.minute, 15);
  assert.strictEqual(Number(slot.spotPriceInclVat.toFixed(3)), 0.934);
}

function testChargingCapabilities() {
  const {
    getMeasurePowerW,
    getChargingState,
    buildEaseeChargingSync
  } = require('../lib/chargingCapabilities');
  assert.strictEqual(getMeasurePowerW(true, 11), 11000);
  assert.strictEqual(getMeasurePowerW(false, 11), 0);
  assert.strictEqual(getChargingState(true), 'plugged_in_charging');
  assert.strictEqual(getChargingState(false), 'plugged_in');
  assert.deepStrictEqual(
    buildEaseeChargingSync({
      measurePower: 0,
      evchargerCharging: false,
      chargingState: 'plugged_out'
    }, true, 11),
    {
      chargeNow: true,
      chargerKw: 11,
      powerW: 11000,
      chargingState: 'plugged_out',
      evchargerCharging: true
    }
  );
  assert.strictEqual(
    buildEaseeChargingSync({
      measurePower: 10715,
      evchargerCharging: false,
      chargingState: 'plugged_in_charging'
    }, false, 11).powerW,
    10715
  );
}

function testWindowConfig() {
  const { buildWindowConfig, parseNightChargeEnd, partsToDecimalHour } = require('../lib/planner/windowConfig');
  const config = buildWindowConfig({ day_charge_start: 10, day_charge_end: 18, night_charge_end: 7.5 });
  assert.strictEqual(config.dayChargeStart, 10);
  assert.strictEqual(config.dayChargeEnd, 18);
  assert.strictEqual(config.dayPlanSwitchHour, 8);
  assert.strictEqual(config.nightPlanSwitchHour, 18);
  assert.strictEqual(config.nightChargeEnd, 7);
  assert.strictEqual(config.nightChargeEndMinute, 30);

  const parsed = parseNightChargeEnd(6.5);
  assert.strictEqual(partsToDecimalHour(parsed.hour, parsed.minute), 6.5);
}

function testNightWindowHalfHourEnd() {
  const { buildTonightChargeWindow, getSlotsForWindow } = require('../lib/planner/windows');
  const { buildWindowConfig } = require('../lib/planner/windowConfig');
  const windowConfig = buildWindowConfig({ night_charge_end: 6.5 });
  const window = buildTonightChargeWindow('2026-08-16', '2026-08-17', windowConfig);
  const slots = [
    { date: '2026-08-17', hour: 6, minute: 15, timestamp: 1 },
    { date: '2026-08-17', hour: 6, minute: 30, timestamp: 2 }
  ];

  const inWindow = getSlotsForWindow(slots, window);
  assert.strictEqual(inWindow.length, 1);
  assert.strictEqual(inWindow[0].minute, 15);
}

function testCrossMidnightScheduleFormat() {
  const { formatChargeSchedule } = require('../lib/planner/oneShot');
  const { SLOT_MS } = require('../lib/price/slotBuilder');
  const base = Date.parse('2026-08-16T21:45:00.000+02:00');
  const slots = [
    { date: '2026-08-16', hour: 23, minute: 45, timestamp: base, spotPriceInclVat: 0.10 },
    { date: '2026-08-17', hour: 5, minute: 30, timestamp: base + (24 * SLOT_MS), spotPriceInclVat: 0.08 }
  ];

  assert.strictEqual(formatChargeSchedule(slots, 'Europe/Copenhagen'), '23:45-05:45');
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

function testForceChargeOverridesNightDisabled() {
  const { buildDeviceConfig, buildAppConfig, evaluateChargePlanForDevice } = require('../lib/evaluator');
  const { getChargePlanWindow } = require('../lib/planner/windows');

  const nightWindow = getChargePlanWindow(20, '2026-08-16', '2026-08-15', '2026-08-17');
  assert.strictEqual(nightWindow.planType, 'night');

  const slots = [];
  for (let hour = 21; hour < 24; hour++) {
    for (const minute of [0, 15, 30, 45]) {
      slots.push({
        date: '2026-08-16',
        hour,
        minute,
        timestamp: Date.parse(`2026-08-16T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`),
        spotPriceInclVat: 0.40
      });
    }
  }

  const currentSlot = slots[0];
  const deviceConfig = buildDeviceConfig({
    force_charge: true,
    night_charge_enabled: false,
    charge_hours: 3
  });
  const appConfig = buildAppConfig({ price_area: 'DK2', spot_threshold: 0.30, charger_kw: 11 });

  const priceData = {
    allSlots: slots,
    todaySlots: slots,
    tomorrowSlots: [],
    priceSource: 'test',
    priceResolution: '15min',
    usesHourlyExpandedPrices: false,
    fetchLog: 'test'
  };

  const originalFetch = require('../lib/price/fetchPrices').fetchPrices;
  require('../lib/price/fetchPrices').fetchPrices = async () => priceData;

  return evaluateChargePlanForDevice(deviceConfig, appConfig, {
    now: new Date(currentSlot.timestamp),
    oneShotCache: {}
  }).then((result) => {
    require('../lib/price/fetchPrices').fetchPrices = originalFetch;
    assert.strictEqual(result.charge_now, true);
    assert.strictEqual(result.forceChargeActive, true);
    assert.ok(result.charge_message.includes('Natteplan') || result.charge_message.includes('Dagsplan'));
    assert.ok(!result.charge_message.includes('Opvask'));
  });
}

function testDayForceChargeActive() {
  const { getChargePlanWindow, isDayForceChargeActive } = require('../lib/planner/windows');

  const dayWindow = getChargePlanWindow(8, '2026-08-13', '2026-08-12', '2026-08-14');
  assert.strictEqual(dayWindow.planType, 'day');
  assert.strictEqual(isDayForceChargeActive(true, dayWindow), true);

  const nightWindow = getChargePlanWindow(20, '2026-08-13', '2026-08-12', '2026-08-14');
  assert.strictEqual(isDayForceChargeActive(true, nightWindow), true);
}

function testEaseeNeedsSync() {
  const { easeeNeedsSync } = require('../lib/chargeOrchestrator');
  const { shouldStartEasee } = require('../lib/easeeCharger');

  const idleState = {
    onoff: false,
    targetCircuitCurrent: 0,
    evchargerCharging: false
  };
  assert.strictEqual(easeeNeedsSync(true, idleState, 16), true);
  assert.strictEqual(easeeNeedsSync(false, idleState, 16), false);

  const chargingState = {
    onoff: true,
    targetCircuitCurrent: 16,
    evchargerCharging: true
  };
  assert.strictEqual(easeeNeedsSync(true, chargingState, 16), false);
  assert.strictEqual(easeeNeedsSync(false, chargingState, 16), true);
  assert.strictEqual(shouldStartEasee(chargingState, 16), false);
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

function testChargeHoursAffectsPlanSlots() {
  const slots = [];
  for (let hour = 10; hour < 18; hour++) {
    for (const minute of [0, 15, 30, 45]) {
      slots.push({
        date: '2026-08-05',
        hour,
        minute,
        timestamp: hour * 100 + minute,
        spotPriceInclVat: hour < 14 ? 0.40 : 0.10
      });
    }
  }

  const current = slots[0];
  const threeHourPlan = evaluateChargePlan(slots, 3, 0.30, current, { planOnly: true });
  const fiveHourPlan = evaluateChargePlan(slots, 5, 0.30, current, { planOnly: true });

  assert.strictEqual(threeHourPlan.planSlots.length, 12);
  assert.strictEqual(fiveHourPlan.planSlots.length, 20);
}

function testEaseePowerFollowUp() {
  const { EaseePowerFollowUp, STABLE_STOP_MS } = require('../lib/easeePowerFollowUp');

  const followUp = new EaseePowerFollowUp({
    scheduleTimeout: () => 1,
    clearTimeout: () => {},
    pollFn: async () => 0,
    log: () => {}
  });

  followUp.start('test');
  followUp._handlePollResult(5000);
  assert.strictEqual(followUp._session.lastPowerW, 5000);

  const nearEnd = Date.now() + 2000;
  followUp._session.endAt = nearEnd;
  followUp._handlePollResult(11000);
  assert.ok(followUp._session.endAt > nearEnd);

  followUp._session.lastChangeAt = Date.now() - STABLE_STOP_MS - 1;
  followUp._session.pollCount = 3;
  followUp._handlePollResult(11000);
  assert.strictEqual(followUp._session, null);
}

function testPlanNotificationFormat() {
  const {
    describeChargeMode,
    formatPlanNotificationText,
    buildPlanNotificationMessage
  } = require('../lib/planNotification');
  const { buildDeviceConfig } = require('../lib/evaluator');

  const cheapestText = formatPlanNotificationText([
    {
      planLabel: 'Dagsplan',
      schedule: '11:00-16:00',
      windowHours: '09:00-17:00'
    },
    {
      planLabel: 'Natteplan',
      schedule: '23:45-05:45',
      windowHours: '21:00-06:00'
    }
  ], {
    chargeHours: 5,
    modeLabel: describeChargeMode({ cheapestPlanOnly: true, chargeHours: 5 })
  });

  assert.strictEqual(
    cheapestText,
    '5 timer · kun billigste tider\n'
      + 'Dagsplan: 11:00-16:00 (09:00-17:00)\n'
      + 'Natteplan: 23:45-05:45 (21:00-06:00)'
  );

  const spotText = formatPlanNotificationText([
    {
      planLabel: 'Dagsplan',
      schedule: '11:00-16:00',
      windowHours: '09:00-17:00'
    }
  ], {
    chargeHours: 5,
    modeLabel: describeChargeMode({ cheapestPlanOnly: false, spotThreshold: 0.2 })
  });

  assert.ok(spotText.includes('spot under 0,20 kr + plan'));
  assert.ok(spotText.includes('Dagsplan: 11:00-16:00 (09:00-17:00)'));
  assert.strictEqual(
    describeChargeMode({ oneShotReadyBy: '09:30' }, { oneShotActive: true }),
    'engangsopladning til 09:30'
  );

  const oneShotText = formatPlanNotificationText([
    { planLabel: 'Plan', schedule: '23:00-06:00', windowHours: null }
  ], {
    chargeHours: 7,
    modeLabel: 'engangsopladning til 09:30'
  });

  assert.strictEqual(oneShotText, '7 timer · engangsopladning til 09:30\nPlan: 23:00-06:00');

  const deviceConfig = buildDeviceConfig({ charge_hours: 5, cheapest_plan_only: true });
  const flowMessage = buildPlanNotificationMessage(deviceConfig, [
    {
      planLabel: 'Dagsplan',
      schedule: '11:00-16:00',
      windowHours: '09:00-17:00'
    },
    {
      planLabel: 'Natteplan',
      schedule: '23:45-05:45',
      windowHours: '21:00-06:00'
    }
  ], { oneShotActive: false });

  assert.strictEqual(
    flowMessage,
    '5 timer · kun billigste tider\n'
      + 'Dagsplan: 11:00-16:00 (09:00-17:00)\n'
      + 'Natteplan: 23:45-05:45 (21:00-06:00)'
  );
  assert.ok(!flowMessage.includes('Opvask'));
  assert.ok(!flowMessage.includes('engangsopladning'));
}

async function main() {
  testBuildDeviceConfig();
  testBuildDeviceConfigSpotThreshold();
  testEvaluateChargePlan();
  testChargeNowOnlyDuringPlanSlots();
  testChargeNowThresholdMode();
  testChargeScheduleShowsTotalSpan();
  testDayWindow();
  testWindowConfig();
  testNightWindowHalfHourEnd();
  testCrossMidnightScheduleFormat();
  testQuarterSchedulerAlignment();
  testPlanScheduleUsesPlanSlotsOnly();
  testOneShotChargeGate();
  testStromligningNowPriceParser();
  testChargingCapabilities();
  testOneShotSessionFinish();
  testEaseeConfig();
  testDayForceChargeActive();
  testEaseeNeedsSync();
  testEaseePowerFollowUp();
  testPlanNotificationFormat();
  await testForceChargeOverridesNightDisabled();
  testChargeHoursAffectsPlanSlots();
  await testLiveFetchOptional();
  console.log('Smoke tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
