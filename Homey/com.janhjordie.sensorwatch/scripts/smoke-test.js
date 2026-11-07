'use strict';

const assert = require('assert');
const {
  isListedNode,
  modelIdMatches,
  shouldSendStalePush,
  shouldSendDailyNotification,
  localHour,
  localCalendarDay,
  buildStalePushMessage,
  buildDeadBatteryTimelineMessage,
  getLastSeenMs,
  analyzeNode,
  buildStatusRows,
  shortName
} = require('../lib/sensorMonitor');
const { getAppSettings } = require('../lib/appSettings');

function mockHomey(settings = {}) {
  const store = { ...settings };
  return {
    settings: {
      get: (key) => store[key],
      set: async (key, value) => {
        store[key] = value;
      }
    }
  };
}

function testModelGlobs() {
  assert.strictEqual(modelIdMatches('lumi.weather', 'lumi.weather'), true);
  assert.strictEqual(modelIdMatches('lumi.sensor_smoke', 'lumi.sensor*'), true);
  assert.strictEqual(modelIdMatches('lumi.sensor_ht.agl02', 'lumi.sensor*'), true);
  assert.strictEqual(modelIdMatches('lumi.sensor_magnet.aq2', 'lumi.sensor*'), true);
  assert.strictEqual(modelIdMatches('lumi.weather', 'lumi.sensor*'), false);
  assert.strictEqual(modelIdMatches('lumi.switch.n0agl1', 'lumi.sensor*'), false);
  assert.strictEqual(modelIdMatches('', '(empty)'), true);
  assert.strictEqual(modelIdMatches(null, '(empty)'), true);
  assert.strictEqual(modelIdMatches('lumi.weather', '(empty)'), false);
}

function testWatchedNodeFilter() {
  const settings = getAppSettings(mockHomey({
    watch_model_ids_json: '["lumi.weather","lumi.sensor*","(empty)"]',
    disabled_ieee_addrs_json: '["00:15:8d:00:00:00:00:01"]'
  }));

  assert.strictEqual(isListedNode({
    modelId: 'lumi.sensor_smoke',
    ieeeAddress: '00:15:8d:00:03:3e:85:74',
    name: 'Røgalarm gang - Xiaomi Honeywell smoke detector'
  }, settings), true);

  assert.strictEqual(isListedNode({
    modelId: 'lumi.weather',
    ieeeAddress: '00:15:8d:00:00:00:00:01',
    name: 'Timothy Sensor'
  }, settings), true);

  const disabledRow = analyzeNode({
    modelId: 'lumi.weather',
    ieeeAddress: '00:15:8d:00:00:00:00:01',
    name: 'Timothy Sensor',
    lastSeen: Date.now()
  }, settings);
  assert.strictEqual(disabledRow.enabled, false);

  assert.strictEqual(isListedNode({
    modelId: 'lumi.switch.n0agl1',
    ieeeAddress: '00:15:8d:00:00:00:00:03',
    name: 'Switch'
  }, settings), false);

  assert.strictEqual(isListedNode({
    modelId: null,
    ieeeAddress: '00:15:8d:00:07:f8:0c:89',
    name: 'Stue Sensor'
  }, settings), true);
}

function testDailyStalePush() {
  const now = Date.parse('2026-11-06T11:00:00+01:00');
  assert.strictEqual(shouldSendStalePush({}, now), true);
  assert.strictEqual(
    shouldSendDailyNotification(
      Date.parse('2026-11-05T16:14:00+01:00'),
      Date.parse('2026-11-06T07:59:00+01:00')
    ),
    false
  );
  assert.strictEqual(
    shouldSendStalePush({
      lastStalePushAt: Date.parse('2026-11-06T00:30:00+01:00')
    }, now),
    true
  );
  assert.strictEqual(
    shouldSendStalePush({
      lastStalePushAt: Date.parse('2026-11-05T16:14:00+01:00')
    }, now),
    true
  );
  assert.strictEqual(
    localCalendarDay(now),
    localCalendarDay(Date.parse('2026-11-06T00:30:00+01:00'))
  );
  assert.strictEqual(localHour(now), 11);
  assert.notStrictEqual(
    localCalendarDay(now),
    localCalendarDay(Date.parse('2026-11-05T23:30:00+01:00'))
  );
}

function testTimelineMessage() {
  const empty = buildDeadBatteryTimelineMessage([]);
  assert.ok(empty.includes('Ingen enheder uden nyere Zigbee-kontakt'));

  const msg = buildDeadBatteryTimelineMessage([
    { name: 'Røgalarm gang', staleForMs: 80 * 3600 * 1000, modelId: 'lumi.sensor_smoke' },
    { name: 'Vaskerum', staleForMs: 400 * 24 * 3600 * 1000, modelId: '(empty)' }
  ]);
  assert.ok(msg.includes('Røgalarm gang'));
  assert.ok(msg.includes('Vaskerum'));
  assert.ok(msg.includes('uden nyere Zigbee-kontakt'));
  assert.ok(!msg.includes('lumi.sensor_smoke'));
}

function testStalePushMessageHasNoDeviceList() {
  const msg = buildStalePushMessage();
  assert.ok(msg.includes('Se timeline'));
  assert.ok(!msg.includes('Røgalarm'));
  assert.ok(!msg.includes('Krearum'));
}

function testLastSeenAndStale() {
  const settings = getAppSettings(mockHomey({ stale_after_hours: 72 }));
  const now = Date.now();
  const stale = analyzeNode({
    modelId: 'lumi.sensor_smoke',
    ieeeAddress: 'aa:bb',
    name: 'Røgalarm gang - Xiaomi',
    lastSeen: now - 80 * 3600 * 1000
  }, settings, now);
  assert.strictEqual(stale.stale, true);
  assert.strictEqual(stale.name, 'Røgalarm gang');

  const ok = analyzeNode({
    modelId: 'lumi.sensor_smoke',
    ieeeAddress: 'aa:cc',
    name: 'Røgalarm stue - Xiaomi',
    lastSeen: now - 16 * 60 * 1000
  }, settings, now);
  assert.strictEqual(ok.stale, false);
}

function testBuildRowsSort() {
  const settings = getAppSettings(mockHomey());
  const now = Date.now();
  const rows = buildStatusRows([
    {
      modelId: 'lumi.sensor_smoke',
      ieeeAddress: '1',
      name: 'Røgalarm vaskerum - x',
      lastSeen: now
    },
    {
      modelId: 'lumi.sensor_smoke',
      ieeeAddress: '2',
      name: 'Røgalarm Kælder - x',
      lastSeen: now
    }
  ], settings, now);
  assert.deepStrictEqual(rows.map((r) => r.name), ['Røgalarm Kælder', 'Røgalarm vaskerum']);
}

function testGetLastSeenMs() {
  assert.strictEqual(getLastSeenMs({ lastSeen: 123 }), 123);
  assert.strictEqual(getLastSeenMs({ last_seen: 456 }), 456);
  assert.strictEqual(getLastSeenMs({}), null);
}

function testShortName() {
  assert.strictEqual(shortName('Røgalarm gang - Xiaomi Honeywell smoke detector'), 'Røgalarm gang');
}

const tests = [
  testModelGlobs,
  testWatchedNodeFilter,
  testDailyStalePush,
  testTimelineMessage,
  testStalePushMessageHasNoDeviceList,
  testLastSeenAndStale,
  testBuildRowsSort,
  testGetLastSeenMs,
  testShortName
];

for (const test of tests) {
  test();
}

console.log(`sensorwatch smoke: ${tests.length} tests OK`);
