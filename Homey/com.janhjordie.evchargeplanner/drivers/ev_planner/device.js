'use strict';

// BacklogTrace: EVC-006, EVC-007, EVC-008, EVC-011
const Homey = require('homey');
const {
  buildDeviceConfig,
  buildAppConfig,
  evaluateChargePlanForDevice
} = require('../../lib/evaluator');
const { LogicCompat } = require('../../lib/logicCompat');
const { LOGIC_VARIABLES, MAX_CHARGE_HOURS, DEFAULT_CHARGER_KW, MIN_SPOT_THRESHOLD_KR_INCL_VAT, MAX_SPOT_THRESHOLD_KR_INCL_VAT } = require('../../lib/constants');
const { ValidationLogger } = require('../../lib/validationLogger');
const {
  ensureSystemChargingCapabilities,
  syncChargingCapabilities,
  buildEaseeChargingSync
} = require('../../lib/chargingCapabilities');
const { buildEaseeConfig, EaseeChargerController } = require('../../lib/easeeCharger');
const { ensureDeviceFavorite } = require('../../lib/deviceFavorites');
const {
  ensureUiCapabilities,
  syncUiCapabilitiesFromSettings
} = require('../../lib/deviceUiCapabilities');
const { getMsUntilNextQuarterBoundary, QUARTER_MS } = require('../../lib/quarterScheduler');
const { updateDeviceSpotPrice } = require('../../lib/spotPriceRefresh');
const { orchestrateChargeTransition } = require('../../lib/chargeOrchestrator');

class EvPlannerDevice extends Homey.Device {
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
    this.log(`EV Planner device initialized: ${this.getName()}`);
    if (this.homey.app?.registerPlannerDevice) {
      this.homey.app.registerPlannerDevice(this);
    }
    await ensureDeviceFavorite(this.homey, this.getId(), this.log.bind(this), this);
    this._previousChargeNow = this.getCapabilityValue('charge_now');

    await ensureSystemChargingCapabilities(this);
    await ensureUiCapabilities(this);
    if (!this.hasCapability('spot_price')) {
      await this.addCapability('spot_price');
    }
    if (!this.hasCapability('spot_price_quarter')) {
      await this.addCapability('spot_price_quarter');
    }
    const initialSettings = await this._refreshOneShotHoursFromLogic({
      charge_hours: this.getSetting('charge_hours'),
      one_shot_enabled: this.getSetting('one_shot_enabled'),
      one_shot_charge_hours: this.getSetting('one_shot_charge_hours'),
      night_charge_enabled: this.getSetting('night_charge_enabled'),
      spot_threshold: this.getSetting('spot_threshold'),
      cheapest_plan_only: this.getSetting('cheapest_plan_only')
    });
    await syncUiCapabilitiesFromSettings(this, initialSettings);

    this._updatingChargingState = false;
    this._updatingUiCapabilities = false;
    this._evaluating = false;

    this.registerCapabilityListener('force_charge', async (value) => {
      if (this._updatingChargingState) {
        return;
      }

      await this.setSettings({ force_charge: value });
      await this.evaluateNow('force_charge_toggle');
    });

    this.registerCapabilityListener('night_charge_enabled', async (value) => {
      if (this._updatingUiCapabilities) {
        return;
      }

      await this.setSettings({ night_charge_enabled: Boolean(value) });
      await this.evaluateNow('night_charge_toggle');
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

    this.registerCapabilityListener('one_shot_enabled', async (value) => {
      if (this._updatingUiCapabilities) {
        return;
      }

      if (value) {
        await this.enableOneShot({
          chargeHours: this.getCapabilityValue('one_shot_charge_hours') || this.getSetting('one_shot_charge_hours'),
          readyBy: this.getSetting('one_shot_ready_by')
        });
      } else {
        await this.disableOneShot('ui_toggle');
      }

      await this.evaluateNow('one_shot_toggle');
    });

    this.registerCapabilityListener('cheapest_plan_only', async (value) => {
      if (this._updatingUiCapabilities) {
        return;
      }

      await this.setSettings({ cheapest_plan_only: Boolean(value) });
      await this.evaluateNow('cheapest_plan_only_toggle');
    });

    this.registerCapabilityListener('spot_threshold', async (value) => {
      if (this._updatingUiCapabilities) {
        return;
      }

      const threshold = Number(value);
      if (!Number.isFinite(threshold)
        || threshold < MIN_SPOT_THRESHOLD_KR_INCL_VAT
        || threshold > MAX_SPOT_THRESHOLD_KR_INCL_VAT) {
        throw new Error(`Spot-graense skal vaere mellem ${MIN_SPOT_THRESHOLD_KR_INCL_VAT} og ${MAX_SPOT_THRESHOLD_KR_INCL_VAT}`);
      }

      const rounded = Number(threshold.toFixed(2));
      await this.setSettings({ spot_threshold: rounded });
      if (this.hasCapability('spot_threshold')) {
        await this.setCapabilityValue('spot_threshold', rounded);
      }
      await this.evaluateNow('spot_threshold_changed');
    });

    this.registerCapabilityListener('charge_hours', async (value) => {
      if (this._updatingUiCapabilities) {
        return;
      }

      const hours = Math.round(Number(value));
      if (!Number.isInteger(hours) || hours < 1 || hours > MAX_CHARGE_HOURS) {
        throw new Error(`Ladetimer skal vaere mellem 1 og ${MAX_CHARGE_HOURS}`);
      }

      await this.setSettings({ charge_hours: hours });
      if (this.hasCapability('charge_hours')) {
        await this.setCapabilityValue('charge_hours', hours);
      }
      await this.evaluateNow('charge_hours_changed');
    });

    this.registerCapabilityListener('one_shot_charge_hours', async (value) => {
      if (this._updatingUiCapabilities) {
        return;
      }

      const hours = Math.round(Number(value));
      if (!Number.isInteger(hours) || hours < 1 || hours > MAX_CHARGE_HOURS) {
        throw new Error(`Engangsopladning timer skal vaere mellem 1 og ${MAX_CHARGE_HOURS}`);
      }

      await this.setSettings({ one_shot_charge_hours: hours });
      if (this.hasCapability('one_shot_charge_hours')) {
        await this.setCapabilityValue('one_shot_charge_hours', hours);
      }
      if (this.getCapabilityValue('one_shot_enabled')) {
        await this.evaluateNow('one_shot_hours_changed');
      }
    });

    await this.evaluateNow('device_init');
    this._bindEaseeDisplaySync();
    this._bindQuarterScheduler();
  }

  async onDeleted() {
    this._teardownQuarterScheduler();
    this._teardownEaseeDisplaySync();
    if (this.homey.app?.unregisterPlannerDevice) {
      this.homey.app.unregisterPlannerDevice(this);
    }
  }

  async onSettings() {
    await syncUiCapabilitiesFromSettings(this, {
      charge_hours: this.getSetting('charge_hours'),
      one_shot_enabled: this.getSetting('one_shot_enabled'),
      one_shot_charge_hours: this.getSetting('one_shot_charge_hours'),
      night_charge_enabled: this.getSetting('night_charge_enabled'),
      spot_threshold: this.getSetting('spot_threshold'),
      cheapest_plan_only: this.getSetting('cheapest_plan_only')
    });
    await this.evaluateNow('settings_changed');
  }

  _getDeviceSettings() {
    const chargeHours = Number(this.getSetting('charge_hours'));
    const oneShotEnabled = this.getSetting('one_shot_enabled') === true;
    const oneShotChargeHours = Number(this.getSetting('one_shot_charge_hours'));
    const nightChargeEnabled = this.hasCapability('night_charge_enabled')
      ? this.getCapabilityValue('night_charge_enabled')
      : this.getSetting('night_charge_enabled');
    const spotThresholdSetting = this.getSetting('spot_threshold');
    const spotThresholdCapability = this.hasCapability('spot_threshold')
      ? this.getCapabilityValue('spot_threshold')
      : null;
    const spotThreshold = Number.isFinite(Number(spotThresholdCapability))
      ? spotThresholdCapability
      : spotThresholdSetting;

    return {
      charge_hours: chargeHours,
      force_charge: this.getCapabilityValue('force_charge'),
      night_charge_enabled: nightChargeEnabled,
      one_shot_enabled: oneShotEnabled,
      one_shot_charge_hours: oneShotChargeHours,
      one_shot_ready_by: this.getSetting('one_shot_ready_by'),
      // Settings are source of truth — capability was being reset to false each evaluate.
      cheapest_plan_only: this.getSetting('cheapest_plan_only') === true,
      spot_threshold: spotThreshold
    };
  }

  _getAppSettings() {
    return {
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
      default_charge_hours: this.homey.settings.get('default_charge_hours'),
      easee_control_enabled: this.homey.settings.get('easee_control_enabled'),
      easee_device_id: this.homey.settings.get('easee_device_id'),
      easee_circuit_current: this.homey.settings.get('easee_circuit_current'),
      easee_sync_power: this.homey.settings.get('easee_sync_power')
    };
  }

  _getAppConfig() {
    return buildAppConfig(this._getAppSettings(), Homey.env);
  }

  async _refreshOneShotHoursFromLogic(deviceSettings) {
    const logicCompat = new LogicCompat(this.homey, this.log.bind(this));
    const refreshed = await logicCompat.applyOneShotChargeHoursFromLogic(deviceSettings);

    if (refreshed.one_shot_charge_hours === deviceSettings.one_shot_charge_hours) {
      return refreshed;
    }

    await this.setSettings({ one_shot_charge_hours: refreshed.one_shot_charge_hours });

    if (this.hasCapability('one_shot_charge_hours')) {
      this._updatingUiCapabilities = true;
      try {
        await this.setCapabilityValue('one_shot_charge_hours', refreshed.one_shot_charge_hours);
      } finally {
        this._updatingUiCapabilities = false;
      }
    }

    return refreshed;
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

  async _getOneShotCache() {
    return {
      sessionKey: await this.getStoreValue('one_shot_session_key'),
      planKeys: await this.getStoreValue('one_shot_cached_plan_keys')
    };
  }

  async _clearOneShotCache() {
    await this.setStoreValue('one_shot_session_key', null);
    await this.setStoreValue('one_shot_cached_plan_keys', null);
  }

  async _applyOneShotCache(result) {
    if (!result.oneShotCacheUpdate) {
      return;
    }

    if (result.oneShotCacheUpdate.clear) {
      await this._clearOneShotCache();
      return;
    }

    if (result.oneShotCacheUpdate.sessionKey) {
      await this.setStoreValue('one_shot_session_key', result.oneShotCacheUpdate.sessionKey);
      await this.setStoreValue('one_shot_cached_plan_keys', result.oneShotCacheUpdate.planKeys);
    }
  }

  async disableOneShot(reason = 'manual') {
    await this.setSettings({ one_shot_enabled: false });
    if (this.hasCapability('one_shot_enabled')) {
      this._updatingUiCapabilities = true;
      try {
        await this.setCapabilityValue('one_shot_enabled', false);
      } finally {
        this._updatingUiCapabilities = false;
      }
    }
    await this._clearOneShotCache();

    if (this._getAppConfig().mirrorLogicVariables) {
      const logicCompat = new LogicCompat(this.homey, this.log.bind(this));
      await logicCompat.disableOneShotCharge(reason);
    }
  }

  async enableOneShot({ chargeHours, readyBy }) {
    await this._clearOneShotCache();
    await this.setSettings({
      one_shot_enabled: true,
      one_shot_charge_hours: chargeHours,
      one_shot_ready_by: readyBy
    });
    if (this.hasCapability('one_shot_enabled')) {
      this._updatingUiCapabilities = true;
      try {
        await this.setCapabilityValue('one_shot_enabled', true);
        if (this.hasCapability('one_shot_charge_hours')) {
          await this.setCapabilityValue('one_shot_charge_hours', Number(chargeHours));
        }
      } finally {
        this._updatingUiCapabilities = false;
      }
    }

    if (this._getAppConfig().mirrorLogicVariables) {
      const logicCompat = new LogicCompat(this.homey, this.log.bind(this));
      await logicCompat.ensureChargeLogicVariables();
      await logicCompat.enableOneShotCharge();
      await logicCompat.setLogicVariable(
        LOGIC_VARIABLES.ONE_SHOT_CHARGE_HOURS,
        chargeHours,
        'number',
        7
      );
      await logicCompat.setLogicVariable(
        LOGIC_VARIABLES.ONE_SHOT_READY_BY,
        readyBy,
        'string',
        '09:30'
      );
    }
  }

  async _applyOneShotState(result, deviceSettings) {
    if (!result.oneShotDisabledReason) {
      return;
    }

    await this.setSettings({ one_shot_enabled: false });
    deviceSettings.one_shot_enabled = false;
    await this._clearOneShotCache();

    if (this._getAppConfig().mirrorLogicVariables) {
      const logicCompat = new LogicCompat(this.homey, this.log.bind(this));
      await logicCompat.disableOneShotCharge(result.oneShotDisabledReason);
    }

    this.log(`Engangsopladning deaktiveret: ${result.oneShotDisabledReason}`);
  }

  async _readEaseeChargingState(appSettings) {
    const easeeConfig = buildEaseeConfig(appSettings);
    if (!easeeConfig.syncPower || !easeeConfig.deviceId) {
      return null;
    }

    const controller = new EaseeChargerController(this.homey, this.log.bind(this));
    return controller.readState({ deviceId: easeeConfig.deviceId });
  }

  async syncEaseeDisplayFromCharger() {
    const appSettings = this._getAppSettings();
    const easeeState = await this._readEaseeChargingState(appSettings);
    if (!easeeState) {
      return;
    }

    const chargerKw = Number(appSettings.charger_kw) || DEFAULT_CHARGER_KW;
    this._updatingChargingState = true;
    try {
      await syncChargingCapabilities(this, buildEaseeChargingSync(
        easeeState,
        this.getCapabilityValue('charge_now'),
        chargerKw
      ));
    } finally {
      this._updatingChargingState = false;
    }
  }

  _bindEaseeDisplaySync() {
    const easeeConfig = buildEaseeConfig(this._getAppSettings());
    if (!easeeConfig.syncPower || !easeeConfig.deviceId) {
      return;
    }

    this._teardownEaseeDisplaySync();

    this._easeeDisplayTimer = this.homey.setInterval(() => {
      this.syncEaseeDisplayFromCharger().catch((error) => {
        this.error(`Easee display sync fejlede: ${error.message}`);
      });
    }, 60 * 1000);

    if (typeof this.homey.devices?.on === 'function') {
      this._easeeDeviceUpdateHandler = (device) => {
        if (device?.id !== easeeConfig.deviceId) {
          return;
        }

        this.syncEaseeDisplayFromCharger().catch((error) => {
          this.error(`Easee display sync fejlede: ${error.message}`);
        });
      };
      this.homey.devices.on('device.update', this._easeeDeviceUpdateHandler);
    }
  }

  _teardownEaseeDisplaySync() {
    if (this._easeeDisplayTimer) {
      this.homey.clearInterval(this._easeeDisplayTimer);
      this._easeeDisplayTimer = null;
    }

    if (this._easeeDeviceUpdateHandler && typeof this.homey.devices?.off === 'function') {
      this.homey.devices.off('device.update', this._easeeDeviceUpdateHandler);
      this._easeeDeviceUpdateHandler = null;
    }
  }

  _bindQuarterScheduler() {
    this._teardownQuarterScheduler();

    const run = async () => {
      await this.evaluateNow('quarter_scheduler');
    };

    const delay = getMsUntilNextQuarterBoundary();
    this.log(`Quarter scheduler starter om ${Math.round(delay / 1000)}s`);

    this._quarterBootTimer = this.homey.setTimeout(() => {
      run().catch((error) => {
        this.error(`Quarter scheduler fejlede: ${error.message}`);
      });
      this._quarterTimer = this.homey.setInterval(() => {
        run().catch((error) => {
          this.error(`Quarter scheduler fejlede: ${error.message}`);
        });
      }, QUARTER_MS);
    }, delay);
  }

  _teardownQuarterScheduler() {
    if (this._quarterBootTimer) {
      this.homey.clearTimeout(this._quarterBootTimer);
      this._quarterBootTimer = null;
    }

    if (this._quarterTimer) {
      this.homey.clearInterval(this._quarterTimer);
      this._quarterTimer = null;
    }
  }

  async refreshSpotPriceNow(reason = 'spot_refresh') {
    return updateDeviceSpotPrice(this, {
      getAppSettings: () => this._getAppSettings(),
      env: Homey.env,
      log: (message) => this.log(`[${reason}] ${message}`),
      reason
    });
  }

  async _triggerFlowCards(result, orchestration = {}) {
    const planUpdated = this.homey.flow.getDeviceTriggerCard('plan_updated');
    const spotPrice = Number.isFinite(result.currentSlot?.spotPriceInclVat)
      ? result.currentSlot.spotPriceInclVat
      : 0;
    const tokens = {
      charge_message: result.charge_message || '',
      charge_schedule: result.charge_schedule || 'ingen',
      spot_price: spotPrice
    };

    await planUpdated.trigger(this, tokens, tokens);

    if (orchestration.shouldTriggerStarted) {
      const chargeStarted = this.homey.flow.getDeviceTriggerCard('charge_started');
      await chargeStarted.trigger(this, tokens, tokens).catch((error) => {
        this.log(`charge_started trigger fejlede: ${error.message}`);
      });
    }

    if (orchestration.shouldTriggerStopped) {
      const chargeStopped = this.homey.flow.getDeviceTriggerCard('charge_stopped');
      await chargeStopped.trigger(this, tokens, tokens).catch((error) => {
        this.log(`charge_stopped trigger fejlede: ${error.message}`);
      });
    }

    this._previousChargeNow = Boolean(result.charge_now);
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
    if (this._evaluating) {
      return null;
    }

    this._evaluating = true;
    let deviceSettings = this._getDeviceSettings();

    try {
      deviceSettings = await this._maybeSyncFromLogic(deviceSettings);
      const appSettings = this._getAppSettings();
      const appConfig = buildAppConfig(appSettings, Homey.env);

      if (!appConfig.stromligningApiKey) {
        const logicCompat = new LogicCompat(this.homey, this.log.bind(this));
        appConfig.stromligningApiKey = await logicCompat.getStromligningApiKeyFromLogic();
      }

      const deviceConfig = buildDeviceConfig(deviceSettings, {
        default_charge_hours: appConfig.defaultChargeHours,
        spot_threshold: appConfig.spotThreshold
      });
      const oneShotCache = await this._getOneShotCache();
      const result = await evaluateChargePlanForDevice(deviceConfig, appConfig, { oneShotCache });

      await this._applyOneShotState(result, deviceSettings);
      await this._applyOneShotCache(result);
      const previousChargeNow = Boolean(this._previousChargeNow);
      await this.setCapabilityValue('charge_now', Boolean(result.charge_now));
      await this.setCapabilityValue('charge_message', result.charge_message || '');
      await this.setCapabilityValue('charge_schedule', result.charge_schedule || 'ingen');
      await this.refreshSpotPriceNow(`${reason}_evaluate`);

      const orchestration = await orchestrateChargeTransition({
        homey: this.homey,
        appSettings,
        chargeNow: result.charge_now,
        previousChargeNow,
        log: this.log.bind(this)
      });

      const easeeConfig = orchestration.easeeConfig;
      const easeeResult = orchestration.easeeResult;
      const easeeState = easeeConfig?.syncPower && easeeConfig?.deviceId
        ? (orchestration.easeeState || await this._readEaseeChargingState(appSettings))
        : null;

      this._updatingChargingState = true;
      this._updatingUiCapabilities = true;
      try {
        await this.setCapabilityValue('force_charge', Boolean(deviceConfig.forceCharge));
        await syncUiCapabilitiesFromSettings(this, {
          charge_hours: deviceConfig.chargeHours,
          one_shot_enabled: result.oneShotDisabledReason ? false : deviceConfig.oneShotEnabled,
          one_shot_charge_hours: deviceConfig.oneShotChargeHours,
          night_charge_enabled: deviceConfig.nightChargeEnabled,
          cheapest_plan_only: deviceConfig.cheapestPlanOnly,
          spot_threshold: deviceConfig.spotThreshold
        });
        await syncChargingCapabilities(this, buildEaseeChargingSync(
          easeeState,
          result.charge_now,
          appConfig.chargerKw
        ));
      } finally {
        this._updatingChargingState = false;
        this._updatingUiCapabilities = false;
      }

      if (easeeResult?.action && easeeResult.action !== 'noop') {
        this.log(`Easee ${easeeResult.action}: charge_now=${result.charge_now}`);
      }

      await this._maybeMirrorToLogic(result, {
        ...deviceSettings,
        force_charge: deviceConfig.forceCharge,
        night_charge_enabled: deviceConfig.nightChargeEnabled,
        one_shot_enabled: result.oneShotDisabledReason ? false : deviceConfig.oneShotEnabled
      });

      await this._triggerFlowCards(result, orchestration);
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
      await this.setAvailable();
      await this.refreshSpotPriceNow(`${reason}_spot_fallback`).catch(() => {});

      const priceApiError = this.homey.flow.getDeviceTriggerCard('price_api_error');
      await priceApiError.trigger(this, {
        error_message: error.message
      }, {
        error_message: error.message
      }).catch(() => {});

      await this.homey.app.sendApiFailureNotification(error).catch(() => {});
      return null;
    } finally {
      this._evaluating = false;
    }
  }
}

module.exports = EvPlannerDevice;
