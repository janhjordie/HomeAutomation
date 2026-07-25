'use strict';

// BacklogTrace: EVC-006, EVC-007, EVC-008, EVC-011
const Homey = require('homey');
const {
  buildDeviceConfig,
  buildAppConfig,
  evaluateChargePlanForDevice
} = require('../../lib/evaluator');
const { LogicCompat } = require('../../lib/logicCompat');
const { ValidationLogger } = require('../../lib/validationLogger');
const {
  ensureSystemChargingCapabilities,
  syncChargingCapabilities
} = require('../../lib/chargingCapabilities');

class EvPlannerDevice extends Homey.Device {
  async onInit() {
    this.log(`EV Planner device initialized: ${this.getName()}`);
    this._previousChargeNow = this.getCapabilityValue('charge_now');

    await ensureSystemChargingCapabilities(this);
    this._updatingChargingState = false;

    this.registerCapabilityListener('force_charge', async (value) => {
      if (this._updatingChargingState) {
        return;
      }

      await this.setSettings({ force_charge: value });
      await this.evaluateNow('force_charge_toggle');
    });

    this.registerCapabilityListener('evcharger_charging', async (value) => {
      if (this._updatingChargingState) {
        return;
      }

      await this.setSettings({ force_charge: value });
      this._updatingChargingState = true;
      try {
        await this.setCapabilityValue('force_charge', Boolean(value));
      } finally {
        this._updatingChargingState = false;
      }

      await this.evaluateNow('evcharger_charging_toggle');
    });

    await this.evaluateNow('device_init');
  }

  async onSettings() {
    await this.evaluateNow('settings_changed');
  }

  _getDeviceSettings() {
    return {
      charge_hours: this.getSetting('charge_hours'),
      force_charge: this.getCapabilityValue('force_charge'),
      one_shot_enabled: this.getSetting('one_shot_enabled'),
      one_shot_charge_hours: this.getSetting('one_shot_charge_hours'),
      one_shot_ready_by: this.getSetting('one_shot_ready_by')
    };
  }

  _getAppConfig() {
    const settings = {
      price_area: this.homey.settings.get('price_area'),
      spot_threshold: this.homey.settings.get('spot_threshold'),
      charger_kw: this.homey.settings.get('charger_kw'),
      mirror_logic_variables: this.homey.settings.get('mirror_logic_variables'),
      validation_enabled: this.homey.settings.get('validation_enabled'),
      stromligning_api_key: this.homey.settings.get('stromligning_api_key'),
      day_charge_start: this.homey.settings.get('day_charge_start'),
      day_charge_end: this.homey.settings.get('day_charge_end'),
      night_charge_start: this.homey.settings.get('night_charge_start'),
      night_charge_end: this.homey.settings.get('night_charge_end'),
      default_charge_hours: this.homey.settings.get('default_charge_hours')
    };

    return buildAppConfig(settings, Homey.env);
  }

  async _maybeSyncFromLogic(deviceSettings) {
    if (!this._getAppConfig().mirrorLogicVariables) {
      return deviceSettings;
    }

    const logicCompat = new LogicCompat(this.homey, this.log.bind(this));
    return logicCompat.syncDeviceFromLogic(deviceSettings);
  }

  async _maybeMirrorToLogic(result, deviceSettings) {
    if (!this._getAppConfig().mirrorLogicVariables) {
      return;
    }

    const logicCompat = new LogicCompat(this.homey, this.log.bind(this));
    await logicCompat.ensureChargeLogicVariables();
    await logicCompat.mirrorEvaluationToLogic(result);
    await logicCompat.syncDeviceToLogic(deviceSettings);
  }

  async _applyOneShotState(result, deviceSettings) {
    if (result.oneShotDisabledReason) {
      await this.setSettings({ one_shot_enabled: false });
      deviceSettings.one_shot_enabled = false;
    }
  }

  async _triggerFlowCards(result) {
    const planUpdated = this.homey.flow.getDeviceTriggerCard('plan_updated');
    const spotPrice = Number.isFinite(result.currentSlot?.spotPriceInclVat)
      ? result.currentSlot.spotPriceInclVat
      : 0;

    await planUpdated.trigger(this, {
      charge_message: result.charge_message || '',
      charge_schedule: result.charge_schedule || 'ingen',
      spot_price: spotPrice
    }, {
      charge_message: result.charge_message || '',
      charge_schedule: result.charge_schedule || 'ingen',
      spot_price: spotPrice
    });

    const chargeNow = Boolean(result.charge_now);
    if (chargeNow !== this._previousChargeNow) {
      this._previousChargeNow = chargeNow;
    }
  }

  async _recordValidation(result) {
    const validationEnabled = this.homey.settings.get('validation_enabled');
    if (!validationEnabled) {
      return;
    }

    const validationLogger = new ValidationLogger(this.homey, this.log.bind(this));
    await validationLogger.recordComparison(this.getName(), result, null);
  }

  async evaluateNow(reason = 'manual') {
    let deviceSettings = this._getDeviceSettings();

    try {
      deviceSettings = await this._maybeSyncFromLogic(deviceSettings);
      const appConfig = this._getAppConfig();

      if (!appConfig.stromligningApiKey) {
        const logicCompat = new LogicCompat(this.homey, this.log.bind(this));
        appConfig.stromligningApiKey = await logicCompat.getStromligningApiKeyFromLogic();
      }

      const deviceConfig = buildDeviceConfig(deviceSettings, {
        default_charge_hours: appConfig.defaultChargeHours
      });
      const result = await evaluateChargePlanForDevice(deviceConfig, appConfig);

      await this._applyOneShotState(result, deviceSettings);
      await this.setCapabilityValue('charge_now', Boolean(result.charge_now));
      await this.setCapabilityValue('charge_message', result.charge_message || '');
      await this.setCapabilityValue('charge_schedule', result.charge_schedule || 'ingen');

      this._updatingChargingState = true;
      try {
        await this.setCapabilityValue('force_charge', Boolean(deviceConfig.forceCharge));
        await syncChargingCapabilities(this, {
          chargeNow: result.charge_now,
          chargerKw: appConfig.chargerKw
        });
      } finally {
        this._updatingChargingState = false;
      }

      await this._maybeMirrorToLogic(result, {
        ...deviceSettings,
        force_charge: deviceConfig.forceCharge,
        one_shot_enabled: result.oneShotDisabledReason ? false : deviceConfig.oneShotEnabled
      });

      await this._triggerFlowCards(result);
      await this._recordValidation(result);

      this.log(`[${reason}] charge_now=${result.charge_now} | ${result.charge_message}`);
      if (result.fetchLog) {
        this.log(result.fetchLog);
      }
      if (result.usesHourlyExpandedPrices) {
        this.log('Bemaerk: Priser er timebaserede (4 ens kvarter/time).');
      }

      return result;
    } catch (error) {
      this.error(`Evaluation failed (${reason}):`, error.message);

      const priceApiError = this.homey.flow.getDeviceTriggerCard('price_api_error');
      await priceApiError.trigger(this, {
        error_message: error.message
      }, {
        error_message: error.message
      });

      await this.homey.app.sendApiFailureNotification(error);
      throw error;
    }
  }
}

module.exports = EvPlannerDevice;
