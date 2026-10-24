'use strict';

const Homey = require('homey');
const {
  DEFAULT_HEATPUMP_DEVICE_ID,
  DEFAULT_HEATPUMP_DEVICE_NAME,
  EVALUATION_INTERVAL_MS
} = require('./lib/constants');
const { MecloudHeatpumpController } = require('./lib/mecloudHeatpump');
const { serializeCurvePoints, DEFAULT_CURVE_POINTS } = require('./lib/heatCurve');
const { getAppSettings } = require('./lib/appSettings');
const { ensureDefaultDevice, getCurveDeviceInstances } = require('./lib/deviceProvisioner');

const CURVE_DEFAULTS_VERSION = 5;

class EcodanCurveApp extends Homey.App {
  async onInit() {
    this.log('Ecodan Curve app initialized');
    this._curveDevices = new Map();
    this._evaluationTimer = null;

    this._ensureDefaultSettings();
    this._migrateCurveDefaults();

    try {
      await ensureDefaultDevice(this.homey, this.log.bind(this), this.error.bind(this));
    } catch (error) {
      this.error(`Ecodan kurve provisioning fejlede: ${error.message}`);
    }

    this._startScheduler();

    this.homey.setTimeout(async () => {
      try {
        const probe = await this.probeHeatpump();
        if (probe.found) {
          this.log(`Heatpump fundet: ${probe.name} (${probe.deviceId}), ${probe.capabilities?.length || 0} capabilities`);
        } else {
          this.error(`Heatpump ikke fundet: ${probe.error || 'ukendt'}`);
        }
      } catch (error) {
        this.error(`Heatpump probe fejlede: ${error.message}`);
      }

      await this.evaluateAllDevices('app_boot');
    }, 5000);

    this.homey.on('unload', () => {
      if (this._evaluationTimer) {
        this.homey.clearInterval(this._evaluationTimer);
      }
    });
  }

  _migrateCurveDefaults() {
    if (this.homey.settings.get('curve_points_custom') === true) {
      return;
    }

    const version = this.homey.settings.get('curve_defaults_version');
    if (version !== undefined && version !== null && version >= CURVE_DEFAULTS_VERSION) {
      return;
    }

    this.homey.settings.set('curve_points_json', serializeCurvePoints(DEFAULT_CURVE_POINTS));
    this.homey.settings.set('curve_defaults_version', CURVE_DEFAULTS_VERSION);
    this.log(`Kurve-defaults opdateret til v${CURVE_DEFAULTS_VERSION} (glat standardkurve)`);
  }

  _ensureDefaultSettings() {
    const defaults = {
      heatpump_device_id: DEFAULT_HEATPUMP_DEVICE_ID,
      heatpump_device_name: DEFAULT_HEATPUMP_DEVICE_NAME,
      heatpump_control_enabled: true,
      outdoor_avg_window_min: 15,
      defrost_cooldown_min: 15,
      outdoor_max_delta_c: 2,
      flow_min_c: 25,
      flow_max_c: 55,
      flow_deadband_c: 0.5,
      curve_offset_c: 0,
      curve_points_json: serializeCurvePoints(DEFAULT_CURVE_POINTS)
    };

    for (const [key, value] of Object.entries(defaults)) {
      const current = this.homey.settings.get(key);
      if (current === undefined || current === null) {
        this.homey.settings.set(key, value);
      }
    }
  }

  registerCurveDevice(device) {
    this._curveDevices.set(device.getId(), device);
  }

  unregisterCurveDevice(device) {
    this._curveDevices.delete(device.getId());
  }

  _startScheduler() {
    const run = (reason) => {
      this.evaluateAllDevices(reason).catch((error) => {
        this.error(`Scheduler (${reason}) fejlede: ${error.message}`);
      });
    };

    run('scheduler_boot');
    this._evaluationTimer = this.homey.setInterval(() => run('scheduler'), EVALUATION_INTERVAL_MS);
    this.log(`Scheduler started (every ${EVALUATION_INTERVAL_MS / 60000} minutes)`);
  }

  async evaluateAllDevices(reason = 'scheduler') {
    const devices = await this._getCurveDeviceInstances();
    for (const device of devices) {
      try {
        await device.evaluateNow(reason);
      } catch (error) {
        this.error(`Evaluate ${device.getName()} fejlede: ${error.message}`);
      }
    }
    return devices.length;
  }

  async _getCurveDeviceInstances() {
    if (this._curveDevices.size > 0) {
      return [...this._curveDevices.values()];
    }

    return getCurveDeviceInstances(this.homey, this.log.bind(this));
  }

  async probeHeatpump() {
    const settings = getAppSettings(this.homey);
    const controller = new MecloudHeatpumpController(this.homey, this.log.bind(this));
    return controller.probeCapabilities({
      deviceId: settings.heatpump_device_id,
      deviceName: settings.heatpump_device_name
    });
  }
}

module.exports = EcodanCurveApp;
