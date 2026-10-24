'use strict';

const assert = require('assert');
const { interpolateFlow, DEFAULT_CURVE_POINTS } = require('../lib/heatCurve');
const {
  createOutdoorSampleStore,
  addOutdoorSample,
  getFilteredOutdoor
} = require('../lib/outdoorFilter');
const { canApplyFlowTarget } = require('../lib/mecloudHeatpump');
const {
  shouldWriteFlowTargetTimeline,
  formatFlowTargetTimelineExcerpt
} = require('../lib/flowTargetTimeline');
const { FLOW_TARGET_TIMELINE_INTERVAL_MS } = require('../lib/constants');

function testHeatCurve() {
  assert.strictEqual(interpolateFlow(20, DEFAULT_CURVE_POINTS, { flowMin: 25, flowMax: 55 }), 25);
  assert.strictEqual(interpolateFlow(15, DEFAULT_CURVE_POINTS, { flowMin: 25, flowMax: 55 }), 29);
  assert.strictEqual(interpolateFlow(12, DEFAULT_CURVE_POINTS, { flowMin: 25, flowMax: 55 }), 32);
  assert.strictEqual(interpolateFlow(0, DEFAULT_CURVE_POINTS, { flowMin: 25, flowMax: 55 }), 42);
  assert.strictEqual(interpolateFlow(-12, DEFAULT_CURVE_POINTS, { flowMin: 25, flowMax: 55 }), 48);
  assert.strictEqual(interpolateFlow(18, DEFAULT_CURVE_POINTS, { flowMin: 25, flowMax: 55 }), 26.6);
  assert.strictEqual(interpolateFlow(0, DEFAULT_CURVE_POINTS, {
    flowMin: 25,
    flowMax: 55,
    offset: 1
  }), 43);
}

function testOutdoorFilter() {
  const store = createOutdoorSampleStore();
  const now = Date.now();

  addOutdoorSample(store, { outdoor: 2, defrost: false, at: now - 600000 }, { avgWindowMin: 15 });
  addOutdoorSample(store, { outdoor: 2.2, defrost: false, at: now - 300000 }, { avgWindowMin: 15 });
  const filtered = getFilteredOutdoor(store, { avgWindowMin: 15, now });
  assert.ok(filtered.sampleCount >= 2);
  assert.ok(Math.abs(filtered.outdoor - 2.1) < 0.2);

  const spike = addOutdoorSample(store, {
    outdoor: 8,
    defrost: false,
    at: now
  }, { avgWindowMin: 15, maxDeltaC: 2 });
  assert.strictEqual(spike.accepted, false);
  assert.strictEqual(spike.reason, 'outdoor_spike');

  const defrost = addOutdoorSample(store, {
    outdoor: 5,
    defrost: true,
    at: now + 1000
  }, { avgWindowMin: 15, defrostCooldownMin: 15 });
  assert.strictEqual(defrost.accepted, false);
  assert.strictEqual(defrost.reason, 'defrost_active');
}

function testFlowGate() {
  assert.strictEqual(canApplyFlowTarget({
    zone1State: 'heating',
    operationalState: 'heating',
    thermostatMode: 'flow'
  }).ok, true);

  assert.strictEqual(canApplyFlowTarget({
    zone1State: 'idle',
    operationalState: 'idle',
    thermostatMode: 'flow'
  }).ok, false);

  assert.strictEqual(canApplyFlowTarget({
    zone1State: 'heating',
    operationalState: 'heating',
    thermostatMode: 'room'
  }).ok, false);
}

function testFlowTargetTimeline() {
  const now = Date.now();
  assert.strictEqual(
    shouldWriteFlowTargetTimeline({
      targetFlow: 32,
      reason: 'scheduler',
      lastLoggedTarget: null,
      lastLoggedAt: null,
      now
    }).write,
    false
  );

  assert.strictEqual(
    shouldWriteFlowTargetTimeline({
      targetFlow: 32,
      reason: 'app_boot',
      lastLoggedTarget: null,
      lastLoggedAt: null,
      now
    }).write,
    true
  );

  assert.strictEqual(
    shouldWriteFlowTargetTimeline({
      targetFlow: 33,
      reason: 'scheduler',
      lastLoggedTarget: 32,
      lastLoggedAt: now - FLOW_TARGET_TIMELINE_INTERVAL_MS - 1000,
      now
    }).write,
    true
  );

  assert.strictEqual(
    shouldWriteFlowTargetTimeline({
      targetFlow: 33,
      reason: 'scheduler',
      lastLoggedTarget: 32,
      lastLoggedAt: now - 1000,
      now
    }).reason,
    'throttled'
  );

  const excerpt = formatFlowTargetTimelineExcerpt({
    targetFlow: 33,
    outdoorFiltered: 12.3,
    curveOffset: 1,
    previousTarget: 32
  });
  assert.ok(excerpt.includes('33'));
  assert.ok(excerpt.includes('12.3'));
  assert.ok(excerpt.includes('+1'));
}

function main() {
  testHeatCurve();
  testOutdoorFilter();
  testFlowGate();
  testFlowTargetTimeline();
  console.log('Smoke tests passed');
}

main();
