'use strict';

const {
  DEFAULT_OUTDOOR_AVG_WINDOW_MIN,
  DEFAULT_DEFROST_COOLDOWN_MIN,
  DEFAULT_MAX_OUTDOOR_DELTA_C,
  DEFAULT_FLOW_MIN_C,
  DEFAULT_FLOW_MAX_C,
  DEFAULT_FLOW_DEADBAND_C,
  DEFAULT_PHYSICAL_FLOW_MIN_C
} = require('./constants');
const { interpolateFlow, parseCurvePointsJson } = require('./heatCurve');
const {
  createOutdoorSampleStore,
  addOutdoorSample,
  getFilteredOutdoor
} = require('./outdoorFilter');
const { MecloudHeatpumpController, canApplyFlowTarget } = require('./mecloudHeatpump');
const { formatCurveStatusMessage, formatCurveTargetInfo } = require('./statusMessage');

function buildControlConfig(appSettings = {}, deviceSettings = {}) {
  return {
    avgWindowMin: Number(deviceSettings.outdoor_avg_window_min)
      || Number(appSettings.outdoor_avg_window_min)
      || DEFAULT_OUTDOOR_AVG_WINDOW_MIN,
    defrostCooldownMin: Number(deviceSettings.defrost_cooldown_min)
      || Number(appSettings.defrost_cooldown_min)
      || DEFAULT_DEFROST_COOLDOWN_MIN,
    maxDeltaC: Number(deviceSettings.outdoor_max_delta_c)
      || Number(appSettings.outdoor_max_delta_c)
      || DEFAULT_MAX_OUTDOOR_DELTA_C,
    flowMin: Number(deviceSettings.flow_min_c)
      || Number(appSettings.flow_min_c)
      || DEFAULT_FLOW_MIN_C,
    flowMax: Number(deviceSettings.flow_max_c)
      || Number(appSettings.flow_max_c)
      || DEFAULT_FLOW_MAX_C,
    deadbandC: Number(deviceSettings.flow_deadband_c)
      || Number(appSettings.flow_deadband_c)
      || DEFAULT_FLOW_DEADBAND_C,
    curveOffset: Number(deviceSettings.curve_offset_c)
      || Number(appSettings.curve_offset_c)
      || 0,
    curvePoints: parseCurvePointsJson(
      deviceSettings.curve_points_json || appSettings.curve_points_json
    )
  };
}

function loadSampleStore(deviceStore) {
  if (deviceStore && Array.isArray(deviceStore.samples)) {
    return {
      samples: deviceStore.samples,
      maxSamples: deviceStore.maxSamples || 96,
      defrostCooldownUntil: deviceStore.defrostCooldownUntil || 0,
      lastAcceptedOutdoor: deviceStore.lastAcceptedOutdoor ?? null
    };
  }

  return createOutdoorSampleStore();
}

function serializeSampleStore(store) {
  return {
    samples: store.samples,
    maxSamples: store.maxSamples,
    defrostCooldownUntil: store.defrostCooldownUntil,
    lastAcceptedOutdoor: store.lastAcceptedOutdoor
  };
}

async function evaluateCurveTick({
  homey,
  appSettings,
  deviceSettings,
  controlEnabled,
  sampleStore,
  log = () => {}
}) {
  const controller = new MecloudHeatpumpController(homey, log);
  const heatpumpConfig = {
    enabled: true,
    deviceId: appSettings.heatpump_device_id,
    deviceName: appSettings.heatpump_device_name
  };

  const probe = await controller.probeCapabilities(heatpumpConfig);
  if (!probe.found) {
    return {
      ok: false,
      status: 'heatpump_not_found',
      message: 'Heatpump ikke fundet — tjek app-indstillinger',
      probe
    };
  }

  const state = probe.state;
  const control = buildControlConfig(appSettings, deviceSettings);
  const store = loadSampleStore(sampleStore);

  let sampleReason = null;
  if (state.outdoor != null) {
    const ingest = addOutdoorSample(store, {
      outdoor: state.outdoor,
      defrost: state.defrost,
      at: Date.now()
    }, {
      avgWindowMin: control.avgWindowMin,
      defrostCooldownMin: control.defrostCooldownMin,
      maxDeltaC: control.maxDeltaC
    });
    if (!ingest.accepted) {
      sampleReason = ingest.reason;
    }
  }

  const filtered = getFilteredOutdoor(store, {
    avgWindowMin: control.avgWindowMin
  });

  const outdoorForCurve = filtered.outdoor ?? state.outdoor;
  const targetFlowBase = outdoorForCurve == null
    ? null
    : interpolateFlow(outdoorForCurve, control.curvePoints, {
      flowMin: control.flowMin,
      flowMax: control.flowMax,
      offset: 0
    });
  const targetFlow = targetFlowBase == null
    ? null
    : interpolateFlow(outdoorForCurve, control.curvePoints, {
      flowMin: control.flowMin,
      flowMax: control.flowMax,
      offset: control.curveOffset
    });

  let applyResult = null;
  let status = 'calculated';

  if (!controlEnabled) {
    status = 'control_disabled';
  } else if (targetFlow == null) {
    status = 'no_target';
  } else {
    const gate = canApplyFlowTarget(state);
    if (!gate.ok) {
      status = gate.reason;
    } else {
      applyResult = await controller.setFlowTarget(heatpumpConfig, targetFlow, {
        deadbandC: control.deadbandC
      });
      status = applyResult.action === 'set' ? 'flow_applied' : applyResult.action;
    }
  }

  const message = formatCurveStatusMessage(status, sampleReason);
  const targetInfo = formatCurveTargetInfo(
    targetFlow,
    targetFlowBase,
    control.curveOffset,
    { physicalFlowMinC: DEFAULT_PHYSICAL_FLOW_MIN_C }
  );

  return {
    ok: true,
    status,
    message,
    targetInfo,
    probe,
    state,
    control,
    outdoorRaw: state.outdoor,
    outdoorFiltered: outdoorForCurve,
    filteredSampleCount: filtered.sampleCount,
    sampleReason,
    targetFlow,
    targetFlowBase,
    curveOffset: control.curveOffset,
    applyResult,
    sampleStore: serializeSampleStore(store)
  };
}

module.exports = {
  buildControlConfig,
  evaluateCurveTick
};
