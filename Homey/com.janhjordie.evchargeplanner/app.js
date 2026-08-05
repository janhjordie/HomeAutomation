'use strict';

// BacklogTrace: EVC-002, EVC-005, EVC-007, EVC-011, EVC-013
const Homey = require('homey');
const { EVALUATION_INTERVAL_MS, DEFAULT_EASEE_DEVICE_ID, DEFAULT_EASEE_CIRCUIT_CURRENT } = require('./lib/constants');
const { getMsUntilNextQuarterBoundary, QUARTER_MS } = require('./lib/quarterScheduler');
const { LogicCompat } = require('./lib/logicCompat');
const { ValidationLogger } = require('./lib/validationLogger');
const { ensureDefaultDevice, getPlannerDeviceInstances, repairOrphanedPlannerDevices } = require('./lib/deviceProvisioner');

class EvChargePlannerApp extends Homey.App {
  async onInit() {
    this.log('EV Charge Planner app initialized');
    this._plannerDevices = new Map();
    this._evaluationTimer = null;
    this._evaluationBootTimer = null;

    this._ensureDefaultSettings();

    try {
      await this._ensureStromligningApiKey();
    } catch (error) {
      this.error(`Stromligning API setup failed: ${error.message}`);
    }

    try {
      await this._ensureLogicVariables();
    } catch (error) {
      this.error(`Logic setup failed: ${error.message}`);
    }

    try {
      await this._ensureDefaultDevice();
    } catch (error) {
      this.error(`Default device setup failed: ${error.message}`);
    }

    this._startScheduler();
    this._scheduleBootRepair();
    this._scheduleDeviceQuarterSchedulers();

    this.homey.on('unload', () => {
      if (this._evaluationTimer) {
        this.homey.clearInterval(this._evaluationTimer);
      }
      if (this._evaluationBootTimer) {
        this.homey.clearTimeout(this._evaluationBootTimer);
      }
    });
  }

  registerPlannerDevice(device) {
    this._plannerDevices.set(device.getId(), device);
  }

  unregisterPlannerDevice(device) {
    this._plannerDevices.delete(device.getId());
  }

  _ensureDefaultSettings() {
    const defaults = {
      price_area: 'DK2',
      spot_threshold: 0.30,
      charger_kw: 11,
      notification_user: 'Jan Hjørdie',
      mirror_logic_variables: true,
      validation_enabled: true,
      day_charge_start: 9,
      day_charge_end: 17,
      night_charge_start: 21,
      night_charge_end: 6,
      default_charge_hours: 3,
      easee_control_enabled: true,
      easee_device_id: DEFAULT_EASEE_DEVICE_ID,
      easee_circuit_current: DEFAULT_EASEE_CIRCUIT_CURRENT,
      easee_sync_power: true
    };

    for (const [key, value] of Object.entries(defaults)) {
      if (this.homey.settings.get(key) === null || this.homey.settings.get(key) === undefined) {
        this.homey.settings.set(key, value);
      }
    }
  }

  async _ensureStromligningApiKey() {
    const existing = String(this.homey.settings.get('stromligning_api_key') || '').trim();
    if (existing) {
      return;
    }

    const fromEnv = String(Homey.env?.STROMLIGNING_API_KEY || '').trim();
    if (fromEnv) {
      await this.homey.settings.set('stromligning_api_key', fromEnv);
      this.log('Strømligning API-nøgle importeret fra env.json til app-indstillinger.');
      return;
    }

    const logicCompat = new LogicCompat(this.homey, this.log.bind(this));
    if (!logicCompat.isAvailable()) {
      this.log('Ingen Strømligning API-nøgle endnu — tilføj i app-indstillinger.');
      return;
    }

    const fromLogic = await logicCompat.getStromligningApiKeyFromLogic();
    if (fromLogic) {
      await this.homey.settings.set('stromligning_api_key', fromLogic);
      this.log('Strømligning API-nøgle importeret fra Logic-variabel til app-indstillinger.');
    }
  }

  async _ensureDefaultDevice() {
    return ensureDefaultDevice(this.homey, this.log.bind(this), this.error.bind(this));
  }

  async repairPlannerDevices() {
    return repairOrphanedPlannerDevices(this.homey, this.log.bind(this));
  }

  _scheduleBootRepair() {
    this.homey.setTimeout(async () => {
      try {
        const repair = await repairOrphanedPlannerDevices(this.homey, this.log.bind(this));
        if (!repair.repaired) {
          await ensureDefaultDevice(this.homey, this.log.bind(this), this.error.bind(this));
        }
        await this.evaluateAllDevices('boot_repair');
      } catch (error) {
        this.error(`Boot repair failed: ${error.message}`);
      }
    }, 5000);
  }

  async createPlannerDevice(name, dataId) {
    const { createPlannerDevice } = require('./lib/deviceProvisioner');
    return createPlannerDevice(this.homey, { name, dataId });
  }

  async _ensureLogicVariables() {
    if (!this.homey.settings.get('mirror_logic_variables')) {
      return;
    }

    const logicCompat = new LogicCompat(this.homey, this.log.bind(this));
    await logicCompat.ensureChargeLogicVariables();
  }

  _startScheduler() {
    if (this._evaluationTimer) {
      this.homey.clearInterval(this._evaluationTimer);
      this._evaluationTimer = null;
    }

    if (this._evaluationBootTimer) {
      this.homey.clearTimeout(this._evaluationBootTimer);
      this._evaluationBootTimer = null;
    }

    const run = async (reason) => {
      try {
        const count = await this.evaluateAllDevices(reason);
        if (count > 0) {
          this.log(`Scheduler evaluated ${count} device(s) (${reason})`);
        } else {
          this.log(`Scheduler fandt ingen EV Planner-enheder (${reason})`);
        }
      } catch (error) {
        this.error(`Scheduler evaluation failed (${reason}):`, error.message);
      }
    };

    run('scheduler_boot');

    const delay = getMsUntilNextQuarterBoundary();
    this._evaluationBootTimer = this.homey.setTimeout(() => {
      run('scheduler');
      this._evaluationTimer = this.homey.setInterval(() => run('scheduler'), QUARTER_MS);
    }, delay);

    this.log(`Scheduler started (every ${EVALUATION_INTERVAL_MS / 60000} minutes, aligned to :00/:15/:30/:45)`);
  }

  _scheduleDeviceQuarterSchedulers() {
    this.homey.setTimeout(async () => {
      try {
        const devices = await this._getPlannerDevices();
        for (const device of devices) {
          if (typeof device.refreshSpotPriceNow === 'function') {
            await device.refreshSpotPriceNow('app_boot').catch(() => {});
          }
          if (typeof device._bindQuarterScheduler === 'function') {
            device._bindQuarterScheduler();
          }
        }

        if (devices.length > 0) {
          this.log(`Quarter scheduler genstartet på ${devices.length} enhed(er)`);
        }
      } catch (error) {
        this.error(`Quarter scheduler setup failed: ${error.message}`);
      }
    }, 8000);
  }

  async _getPlannerDevices() {
    const fromDriver = await getPlannerDeviceInstances(this.homey, this.log.bind(this));
    if (fromDriver.length > 0) {
      return fromDriver;
    }

    if (this._plannerDevices.size > 0) {
      return [...this._plannerDevices.values()];
    }

    return [];
  }

  async evaluateAllDevices(reason = 'manual') {
    const devices = await this._getPlannerDevices();

    if (devices.length === 0) {
      this.log(`Ingen EV Planner devices parret endnu (${reason}).`);
      return 0;
    }

    for (const device of devices) {
      await device.evaluateNow(reason);
    }

    return devices.length;
  }

  async sendApiFailureNotification(error) {
    const userName = this.homey.settings.get('notification_user') || 'Homey';
    const message = `${userName}: EV-opladning kunne ikke hente prisdata. Fejl: ${error.message}`;

    if (typeof this.homey.flow?.runFlowCardAction === 'function') {
      try {
        await this.homey.flow.runFlowCardAction({
          uri: 'homey:flowcardaction:homey:manager:notifications:create_notification',
          id: 'homey:manager:notifications:create_notification',
          args: { text: message }
        });
        return;
      } catch (flowNotificationError) {
        this.log(`Flow-notifikation fejlede: ${flowNotificationError.message}`);
      }
    }

    if (typeof this.homey.notifications?.createNotification === 'function') {
      try {
        await this.homey.notifications.createNotification({ excerpt: message });
        return;
      } catch (notificationError) {
        this.log(`Homey.notifications fejlede: ${notificationError.message}`);
      }
    }

    this.log(`NOTIFIKATION (kun log): ${message}`);
  }

  async getValidationSummary() {
    const validationLogger = new ValidationLogger(this.homey, this.log.bind(this));
    return validationLogger.getSummary();
  }
}

module.exports = EvChargePlannerApp;
