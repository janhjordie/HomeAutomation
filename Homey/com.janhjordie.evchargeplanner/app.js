'use strict';

// BacklogTrace: EVC-002, EVC-005, EVC-007, EVC-011, EVC-013
const Homey = require('homey');
const { EVALUATION_INTERVAL_MS } = require('./lib/constants');
const { LogicCompat } = require('./lib/logicCompat');
const { ValidationLogger } = require('./lib/validationLogger');
const { ensureDefaultDevice } = require('./lib/deviceProvisioner');

class EvChargePlannerApp extends Homey.App {
  async onInit() {
    this.log('EV Charge Planner app initialized');
    this._evaluationTimer = null;

    try {
      this._ensureDefaultSettings();
      await this._ensureStromligningApiKey();
      await this._ensureLogicVariables();
      await this._ensureDefaultDevice();
      this._startScheduler();
    } catch (error) {
      this.error('App init failed:', error.message);
    }

    this.homey.on('unload', () => {
      if (this._evaluationTimer) {
        this.homey.clearInterval(this._evaluationTimer);
      }
    });
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
      default_charge_hours: 3
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
    }

    this._evaluationTimer = this.homey.setInterval(async () => {
      try {
        await this.evaluateAllDevices('scheduler');
      } catch (error) {
        this.error('Scheduler evaluation failed:', error.message);
      }
    }, EVALUATION_INTERVAL_MS);

    this.log(`Scheduler started (every ${EVALUATION_INTERVAL_MS / 60000} minutes)`);
  }

  async evaluateAllDevices(reason = 'manual') {
    const driver = this.homey.drivers.getDriver('ev_planner');
    const devices = await driver.getDevices();

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
