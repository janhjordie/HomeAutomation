'use strict';

const Homey = require('homey');
const { evaluateCurveTick } = require('../../lib/curveController');
const { getAppSettings } = require('../../lib/appSettings');
const { ensureDeviceFavorite } = require('../../lib/deviceFavorites');
const { refreshDeviceDriverIcon } = require('../../lib/deviceIconRefresh');
const { maybeNotifyFlowTargetTimeline } = require('../../lib/flowTargetTimeline');

const DEVICE_CAPABILITIES = [
  'flow_target_curve',
  'curve_target_info',
  'heatpump_flow_setpoint',
  'outdoor_temp_filtered',
  'outdoor_temp_raw',
  'curve_control_message'
];

const LEGACY_CAPABILITIES = [
  'flow_temp_actual',
  'flow_temp_target',
  'curve_offset_c',
  'measure_temperature.outdoor_raw',
  'measure_temperature.outdoor_filtered',
  'measure_temperature.curve',
  'measure_temperature.flow_setpoint',
  'measure_outdoor_raw',
  'measure_outdoor_filtered',
  'measure_flow_curve',
  'measure_flow_setpoint'
];

const OFFSET_MIN = -5;
const OFFSET_MAX = 5;

class EcodanCurveDevice extends Homey.Device {
  async onInit() {
    try {
      await this._initializeDevice();
      await this.setAvailable();
    } catch (error) {
      this.error(`onInit failed: ${error.message}`);
      await this.setAvailable();
    }
  }

  async _initializeDevice() {
    this.log(`Ecodan curve device initialized: ${this.getName()}`);
    if (this.homey.app?.registerCurveDevice) {
      this.homey.app.registerCurveDevice(this);
    }

    if (!this.hasCapability('target_temperature')) {
      await this.addCapability('target_temperature');
    }
    if (!this.hasCapability('measure_temperature')) {
      await this.addCapability('measure_temperature');
    }
    if (!this.hasCapability('curve_control_enabled')) {
      await this.addCapability('curve_control_enabled');
    }
    await this.setCapabilityOptions('curve_control_enabled', {
      uiQuickAction: true,
      uiState: false,
      title: {
        en: 'Curve control',
        da: 'Kurvestyring'
      }
    });

    for (const capabilityId of DEVICE_CAPABILITIES) {
      if (!this.hasCapability(capabilityId)) {
        await this.addCapability(capabilityId);
      }
    }

    for (const legacyId of LEGACY_CAPABILITIES) {
      if (this.hasCapability(legacyId)) {
        await this.removeCapability(legacyId);
      }
    }

    await this.setCapabilityValue('curve_control_enabled', true);

    await refreshDeviceDriverIcon(this, this.log.bind(this));
    await ensureDeviceFavorite(this.homey, this.getId(), this.log.bind(this), this);

    this.registerCapabilityListener('curve_control_enabled', async () => {
      await this.evaluateNow('curve_control_toggle');
    });

    this.registerCapabilityListener('target_temperature', async (value) => {
      await this._onTargetTemperatureAdjusted(value);
    });

    const stored = await this.getStoreValue('outdoor_sample_store');
    this._sampleStore = stored || null;
    this._evaluating = false;
    this._syncingCapabilities = false;

    await this.evaluateNow('device_init');
  }

  onDeleted() {
    if (this.homey.app?.unregisterCurveDevice) {
      this.homey.app.unregisterCurveDevice(this);
    }
  }

  _getAppSettings() {
    return getAppSettings(this.homey);
  }

  _getDeviceSettings() {
    return {
      curve_offset_c: this.getSetting('curve_offset_c'),
      outdoor_avg_window_min: this.getSetting('outdoor_avg_window_min')
    };
  }

  async _onTargetTemperatureAdjusted(value) {
    if (this._syncingCapabilities) {
      return;
    }

    const base = Number(this.getCapabilityValue('flow_target_curve'));
    const target = Number(value);
    if (!Number.isFinite(base) || !Number.isFinite(target)) {
      return;
    }

    let offset = Math.round((target - base) * 10) / 10;
    offset = Math.max(OFFSET_MIN, Math.min(OFFSET_MAX, offset));

    await this.setSettings({ curve_offset_c: offset });
    await this.evaluateNow('target_dial');
  }

  async evaluateNow(reason = 'manual') {
    if (this._evaluating) {
      return null;
    }

    this._evaluating = true;
    try {
      const result = await evaluateCurveTick({
        homey: this.homey,
        appSettings: this._getAppSettings(),
        deviceSettings: this._getDeviceSettings(),
        controlEnabled: Boolean(this.getCapabilityValue('curve_control_enabled')),
        sampleStore: this._sampleStore,
        log: this.log.bind(this)
      });

      if (result.sampleStore) {
        this._sampleStore = result.sampleStore;
        await this.setStoreValue('outdoor_sample_store', result.sampleStore);
      }

      await this._applyResult(result, reason);
      return result;
    } finally {
      this._evaluating = false;
    }
  }

  async _applyResult(result, reason) {
    if (!result?.ok) {
      await this.setCapabilityValue('curve_control_message', result?.message || result?.status || 'fejl');
      this.log(`[${reason}] ${result?.status}: ${result?.message}`);
      return;
    }

    const {
      state,
      outdoorRaw,
      outdoorFiltered,
      targetFlow,
      targetFlowBase,
      curveOffset,
      targetInfo
    } = result;
    const outdoorForDisplay = outdoorFiltered ?? outdoorRaw ?? state?.outdoor ?? null;

    this._syncingCapabilities = true;
    try {
      if (outdoorForDisplay != null) {
        await this.setCapabilityValue('outdoor_temp_filtered', outdoorForDisplay);
      }
      if (outdoorRaw != null) {
        await this.setCapabilityValue('outdoor_temp_raw', outdoorRaw);
      } else if (state?.outdoor != null) {
        await this.setCapabilityValue('outdoor_temp_raw', state.outdoor);
      }

      if (targetFlowBase != null) {
        await this.setCapabilityValue('flow_target_curve', targetFlowBase);
      }
      if (curveOffset != null && Number.isFinite(Number(curveOffset))) {
        const offset = Number(curveOffset);
        await this.setCapabilityValue('measure_temperature', offset);
      }
      if (targetFlow != null) {
        await this.setCapabilityValue('target_temperature', targetFlow);
      }
      if (state?.flowTarget != null) {
        await this.setCapabilityValue('heatpump_flow_setpoint', state.flowTarget);
      }
      if (targetInfo) {
        await this.setCapabilityValue('curve_target_info', targetInfo);
      }

      await this.setCapabilityValue('curve_control_message', result.message || result.status);
    } finally {
      this._syncingCapabilities = false;
    }

    this.log(`[${reason}] ${result.status} — ${targetInfo || result.message}`);

    await maybeNotifyFlowTargetTimeline(this.homey, this, {
      targetFlow,
      outdoorFiltered,
      curveOffset,
      reason
    }, this.log.bind(this));
  }
}

module.exports = EcodanCurveDevice;
