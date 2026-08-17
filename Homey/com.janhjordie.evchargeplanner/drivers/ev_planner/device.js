'use strict';

// BacklogTrace: EVC-006, EVC-007, EVC-008, EVC-011
const Homey = require('homey');
const {
  buildDeviceConfig,
  buildAppConfig,
  evaluateChargePlanForDevice
} = require('../../lib/evaluator');
const { LogicCompat } = require('../../lib/logicCompat');
const { LOGIC_VARIABLES, MAX_CHARGE_HOURS, DEFAULT_CHARGER_KW, MIN_SPOT_THRESHOLD_KR_INCL_VAT, MAX_SPOT_THRESHOLD_KR_INCL_VAT, NIGHT_CHARGE_END_MIN, NIGHT_CHARGE_END_MAX } = require('../../lib/constants');
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
const { parseNightChargeEnd, partsToDecimalHour } = require('../../lib/planner/windowConfig');
const { getMsUntilNextQuarterBoundary, QUARTER_MS } = require('../../lib/quarterScheduler');
const { updateDeviceSpotPrice } = require('../../lib/spotPriceRefresh');
const { orchestrateChargeTransition } = require('../../lib/chargeOrchestrator');
const { EaseePowerFollowUp } = require('../../lib/easeePowerFollowUp');

const PLAN_SETTING_KEYS = [
  'charge_hours',
  'spot_threshold',
  'cheapest_plan_only',
  'night_charge_enabled',
  'night_charge_end',
  'one_shot_enabled',
  'one_shot_charge_hours',
  'one_shot_ready_by',
  'force_charge'
];

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
      night_charge_end: this._resolveNightChargeEndDecimal(),
      spot_threshold: this.getSetting('spot_threshold'),
      cheapest_plan_only: this.getSetting('cheapest_plan_only')
    });
    await syncUiCapabilitiesFromSettings(this, initialSettings);

    this._updatingChargingState = false;
    this._updatingUiCapabilities = false;
    this._evaluating = false;
    this._pendingEvaluate = null;

    this.registerCapabilityListener('force_charge', async (value) => {
      if (this._updatingChargingState) {
        return;
      }

      const forceCharge = Boolean(value);
      await this.setSettings({ force_charge: forceCharge });
      await this._applyForceChargeQuickFeedback(forceCharge);
      this._scheduleEvaluateNow(
        'force_charge_toggle',
        { force_charge: forceCharge },
        { forceEaseeSync: true, skipLogicForceCharge: true }
      );
    });

    this.registerCapabilityListener('night_charge_enabled', async (value) => {
      if (this._updatingUiCapabilities) {
        return;
      }

      await this.setSettings({ night_charge_enabled: Boolean(value) });
      this._scheduleEvaluateNow('night_charge_toggle', {}, { notify: true });
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

      this._scheduleEvaluateNow('evcharger_charging_toggle');
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

      this._scheduleEvaluateNow('one_shot_toggle', {}, { notify: true });
    });

    this.registerCapabilityListener('cheapest_plan_only', async (value) => {
      if (this._updatingUiCapabilities) {
        return;
      }

      await this.setSettings({ cheapest_plan_only: Boolean(value) });
      this._scheduleEvaluateNow('cheapest_plan_only_toggle', {}, { notify: true });
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
      await this.evaluateNow('spot_threshold_changed', { spot_threshold: rounded });
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
      await this.evaluateNow('charge_hours_changed', { charge_hours: hours }, { notify: true, chargeHours: hours });
    });

    this.registerCapabilityListener('night_charge_end', async (value) => {
      if (this._updatingUiCapabilities) {
        return;
      }

      const parsed = parseNightChargeEnd(value);
      const decimal = partsToDecimalHour(parsed.hour, parsed.minute);
      if (decimal < NIGHT_CHARGE_END_MIN || decimal > NIGHT_CHARGE_END_MAX) {
        throw new Error(`Nat-sluttid skal vaere mellem ${NIGHT_CHARGE_END_MIN} og ${NIGHT_CHARGE_END_MAX}`);
      }

      await this.setSettings({ night_charge_end: decimal });
      if (this.hasCapability('night_charge_end')) {
        await this.setCapabilityValue('night_charge_end', decimal);
      }
      await this.evaluateNow('night_charge_end_changed', { night_charge_end: decimal }, { notify: true });
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
      await this.evaluateNow('one_shot_hours_changed', { one_shot_charge_hours: hours });
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

  async onSettings({ newSettings = {}, changedKeys = [] } = {}) {
    const changed = Array.isArray(changedKeys) ? changedKeys : [];
    const planChanged = changed.some((key) => PLAN_SETTING_KEYS.includes(key));

    this._updatingUiCapabilities = true;
    try {
      await syncUiCapabilitiesFromSettings(this, {
        charge_hours: newSettings.charge_hours,
        one_shot_enabled: newSettings.one_shot_enabled,
        one_shot_charge_hours: newSettings.one_shot_charge_hours,
        night_charge_enabled: newSettings.night_charge_enabled,
        night_charge_end: newSettings.night_charge_end,
        spot_threshold: newSettings.spot_threshold,
        cheapest_plan_only: newSettings.cheapest_plan_only
      });
    } finally {
      this._updatingUiCapabilities = false;
    }

    const overrides = this._buildEvaluateOverridesFromSettings(newSettings);
    const hoursChanged = changed.includes('charge_hours')
      && Number.isInteger(Number(newSettings.charge_hours))
      && Number(newSettings.charge_hours) > 0;

    await this.evaluateNow(
      'settings_changed',
      overrides,
      planChanged
        ? {
          notify: changed.includes('charge_hours')
            || changed.includes('night_charge_enabled')
            || changed.includes('cheapest_plan_only')
            || changed.includes('night_charge_end'),
          chargeHours: hoursChanged ? Number(newSettings.charge_hours) : undefined
        }
        : {}
    );
  }

  _buildEvaluateOverridesFromSettings(settings = {}) {
    const overrides = {};

    if (settings.charge_hours != null) {
      overrides.charge_hours = settings.charge_hours;
    }

    if (settings.one_shot_charge_hours != null) {
      overrides.one_shot_charge_hours = settings.one_shot_charge_hours;
    }

    if (settings.night_charge_end != null) {
      overrides.night_charge_end = settings.night_charge_end;
    }

    if (settings.night_charge_enabled != null) {
      overrides.night_charge_enabled = settings.night_charge_enabled !== false;
    }

    if (settings.cheapest_plan_only != null) {
      overrides.cheapest_plan_only = settings.cheapest_plan_only === true;
    }

    if (settings.one_shot_enabled != null) {
      overrides.one_shot_enabled = settings.one_shot_enabled === true;
    }

    if (settings.one_shot_ready_by != null) {
      overrides.one_shot_ready_by = String(settings.one_shot_ready_by);
    }

    if (settings.spot_threshold != null) {
      overrides.spot_threshold = settings.spot_threshold;
    }

    if (settings.force_charge != null) {
      overrides.force_charge = Boolean(settings.force_charge);
    }

    return overrides;
  }

  _resolveIntegerHours(settingValue, capabilityId) {
    const fromSetting = Number(settingValue);
    if (this.hasCapability(capabilityId)) {
      const fromCapability = Number(this.getCapabilityValue(capabilityId));
      if (Number.isInteger(fromCapability) && fromCapability > 0) {
        return fromCapability;
      }
    }

    return fromSetting;
  }

  _resolveNightChargeEndDecimal() {
    if (this.hasCapability('night_charge_end')) {
      const fromCapability = Number(this.getCapabilityValue('night_charge_end'));
      if (Number.isFinite(fromCapability)) {
        return partsToDecimalHour(
          parseNightChargeEnd(fromCapability).hour,
          parseNightChargeEnd(fromCapability).minute
        );
      }
    }

    const fromSetting = Number(this.getSetting('night_charge_end'));
    if (Number.isFinite(fromSetting)) {
      return partsToDecimalHour(
        parseNightChargeEnd(fromSetting).hour,
        parseNightChargeEnd(fromSetting).minute
      );
    }

    const appDefault = Number(this.homey.settings.get('night_charge_end'));
    if (Number.isFinite(appDefault)) {
      return partsToDecimalHour(
        parseNightChargeEnd(appDefault).hour,
        parseNightChargeEnd(appDefault).minute
      );
    }

    return partsToDecimalHour(parseNightChargeEnd(6).hour, parseNightChargeEnd(6).minute);
  }

  _getDeviceSettings(overrides = {}) {
    let chargeHours = this._resolveIntegerHours(this.getSetting('charge_hours'), 'charge_hours');
    let oneShotChargeHours = this._resolveIntegerHours(
      this.getSetting('one_shot_charge_hours'),
      'one_shot_charge_hours'
    );
    const spotThresholdSetting = this.getSetting('spot_threshold');
    const spotThresholdCapability = this.hasCapability('spot_threshold')
      ? this.getCapabilityValue('spot_threshold')
      : null;

    if (overrides.charge_hours != null) {
      const hours = Math.round(Number(overrides.charge_hours));
      if (Number.isInteger(hours) && hours > 0) {
        chargeHours = hours;
      }
    }

    if (overrides.one_shot_charge_hours != null) {
      const hours = Math.round(Number(overrides.one_shot_charge_hours));
      if (Number.isInteger(hours) && hours > 0) {
        oneShotChargeHours = hours;
      }
    }

    let nightChargeEnd = this._resolveNightChargeEndDecimal();
    if (overrides.night_charge_end != null) {
      const parsed = parseNightChargeEnd(overrides.night_charge_end);
      nightChargeEnd = partsToDecimalHour(parsed.hour, parsed.minute);
    }

    const nightChargeEnabled = overrides.night_charge_enabled != null
      ? overrides.night_charge_enabled
      : this.hasCapability('night_charge_enabled')
        ? this.getCapabilityValue('night_charge_enabled')
        : this.getSetting('night_charge_enabled');

    const oneShotEnabled = overrides.one_shot_enabled != null
      ? overrides.one_shot_enabled
      : this.hasCapability('one_shot_enabled')
        ? Boolean(this.getCapabilityValue('one_shot_enabled'))
        : this.getSetting('one_shot_enabled') === true;

    const spotThreshold = overrides.spot_threshold != null
      ? Number(overrides.spot_threshold)
      : Number.isFinite(Number(spotThresholdCapability))
        ? spotThresholdCapability
        : spotThresholdSetting;

    return {
      charge_hours: chargeHours,
      force_charge: overrides.force_charge != null
        ? Boolean(overrides.force_charge)
        : this.getCapabilityValue('force_charge'),
      night_charge_enabled: nightChargeEnabled,
      night_charge_end: nightChargeEnd,
      one_shot_enabled: oneShotEnabled,
      one_shot_charge_hours: oneShotChargeHours,
      one_shot_ready_by: overrides.one_shot_ready_by != null
        ? String(overrides.one_shot_ready_by)
        : this.getSetting('one_shot_ready_by'),
      cheapest_plan_only: overrides.cheapest_plan_only != null
        ? overrides.cheapest_plan_only
        : this.getSetting('cheapest_plan_only') === true,
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

  async _maybeSyncFromLogic(deviceSettings, options = {}) {
    if (!this._getAppConfig().mirrorLogicVariables) {
      return deviceSettings;
    }

    const logicCompat = new LogicCompat(this.homey, this.log.bind(this));
    const synced = await logicCompat.syncDeviceFromLogic(deviceSettings);

    if (options.skipLogicForceCharge) {
      return { ...synced, force_charge: deviceSettings.force_charge };
    }

    return synced;
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

  async syncEaseeDisplayFromCharger(options = {}) {
    const appSettings = this._getAppSettings();
    const easeeConfig = buildEaseeConfig(appSettings);
    if (!easeeConfig.syncPower || !easeeConfig.deviceId) {
      return;
    }

    const controller = new EaseeChargerController(this.homey, this.log.bind(this));
    const easeeState = await controller.readState(
      { deviceId: easeeConfig.deviceId },
      {
        forceRefresh: options.forceRefresh === true,
        cacheMs: options.forceRefresh ? 0 : undefined
      }
    );
    if (!easeeState) {
      return null;
    }

    const chargerKw = Number(appSettings.charger_kw) || DEFAULT_CHARGER_KW;
    const chargeNow = typeof options.chargeNow === 'boolean'
      ? options.chargeNow
      : this.getCapabilityValue('charge_now');

    this._updatingChargingState = true;
    try {
      const syncPayload = buildEaseeChargingSync(
        easeeState,
        chargeNow,
        chargerKw
      );
      await syncChargingCapabilities(this, syncPayload);
      return syncPayload.powerW;
    } finally {
      this._updatingChargingState = false;
    }
  }

  _ensureEaseePowerFollowUp() {
    if (this._easeePowerFollowUp) {
      return this._easeePowerFollowUp;
    }

    this._easeePowerFollowUp = new EaseePowerFollowUp({
      scheduleTimeout: (fn, ms) => this.homey.setTimeout(fn, ms),
      clearTimeout: (id) => this.homey.clearTimeout(id),
      pollFn: async () => this.syncEaseeDisplayFromCharger({ forceRefresh: true }),
      log: (message) => this.log(message)
    });

    return this._easeePowerFollowUp;
  }

  _startEaseePowerFollowUp(reason = 'easee_action') {
    const easeeConfig = buildEaseeConfig(this._getAppSettings());
    if (!easeeConfig.syncPower || !easeeConfig.deviceId) {
      return;
    }

    this._ensureEaseePowerFollowUp().start(reason);
  }

  _stopEaseePowerFollowUp() {
    if (this._easeePowerFollowUp) {
      this._easeePowerFollowUp.stop();
    }
  }

  _bindEaseeDisplaySync() {
    const easeeConfig = buildEaseeConfig(this._getAppSettings());
    if (!easeeConfig.syncPower || !easeeConfig.deviceId) {
      return;
    }

    this._teardownEaseeDisplaySync();

    const scheduleNextDisplaySync = () => {
      const charging = Boolean(this.getCapabilityValue('charge_now'))
        || Boolean(this.getCapabilityValue('evcharger_charging'))
        || Boolean(this.getCapabilityValue('force_charge'));
      const intervalMs = charging ? 60 * 1000 : 5 * 60 * 1000;

      this._easeeDisplayTimer = this.homey.setTimeout(() => {
        this.syncEaseeDisplayFromCharger().catch((error) => {
          this.error(`Easee display sync fejlede: ${error.message}`);
        });
        scheduleNextDisplaySync();
      }, intervalMs);
    };

    this.syncEaseeDisplayFromCharger({ forceRefresh: true }).catch((error) => {
      this.error(`Easee display sync fejlede: ${error.message}`);
    });
    scheduleNextDisplaySync();

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
    this._stopEaseePowerFollowUp();

    if (this._easeeDisplayTimer) {
      this.homey.clearTimeout(this._easeeDisplayTimer);
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

  _scheduleEvaluateNow(reason, overrides = {}, options = {}) {
    this.homey.setTimeout(() => {
      this.evaluateNow(reason, overrides, options).catch((error) => {
        this.error(`Evaluate (${reason}) fejlede: ${error.message}`);
      });
    }, 0);
  }

  async _applyForceChargeQuickFeedback(forceCharge) {
    if (this.getCapabilityValue('one_shot_enabled')) {
      return;
    }

    const nextChargeNow = Boolean(forceCharge);
    const previousChargeNow = Boolean(this._previousChargeNow);

    this._updatingChargingState = true;
    try {
      await this.setCapabilityValue('charge_now', nextChargeNow);
      await this.setCapabilityValue(
        'charge_message',
        nextChargeNow
          ? 'Tvungen opladning aktiveres…'
          : 'Tvungen opladning slukkes…'
      );
      if (nextChargeNow) {
        const chargerKw = Number(this._getAppSettings().charger_kw) || DEFAULT_CHARGER_KW;
        await this.setCapabilityValue('measure_power', Math.round(chargerKw * 1000));
        await this.setCapabilityValue('evcharger_charging', true);
        await this.setCapabilityValue('evcharger_charging_state', 'plugged_in_charging');
      } else {
        await this.setCapabilityValue('evcharger_charging', false);
        await this.setCapabilityValue('evcharger_charging_state', 'plugged_in');
      }
    } finally {
      this._updatingChargingState = false;
    }

    if (nextChargeNow === previousChargeNow) {
      return;
    }

    const appSettings = this._getAppSettings();
    orchestrateChargeTransition({
      homey: this.homey,
      appSettings,
      chargeNow: nextChargeNow,
      previousChargeNow,
      log: this.log.bind(this),
      forceEaseeSync: true
    }).then(async (orchestration) => {
      this._previousChargeNow = nextChargeNow;
      const action = orchestration.easeeResult?.action || orchestration.easeeResult?.reason || 'noop';
      this.log(`Force charge hurtig Easee: ${action}, charge_now=${nextChargeNow}`);
      await this.syncEaseeDisplayFromCharger({
        forceRefresh: true,
        chargeNow: nextChargeNow
      });
      this._startEaseePowerFollowUp('force_charge_toggle');
    }).catch((error) => {
      this.error(`Force charge Easee fejlede: ${error.message}`);
    });
  }

  async evaluateNow(reason = 'manual', overrides = {}, options = {}) {
    if (this._evaluating) {
      const pendingOverrides = this._pendingEvaluate?.overrides || {};
      this._pendingEvaluate = {
        reason,
        overrides: { ...pendingOverrides, ...overrides },
        notify: Boolean(options.notify || this._pendingEvaluate?.notify),
        chargeHours: options.chargeHours ?? this._pendingEvaluate?.chargeHours,
        forceEaseeSync: Boolean(options.forceEaseeSync || this._pendingEvaluate?.forceEaseeSync),
        skipLogicForceCharge: Boolean(options.skipLogicForceCharge || this._pendingEvaluate?.skipLogicForceCharge)
      };
      return null;
    }

    this._evaluating = true;
    let deviceSettings = this._getDeviceSettings(overrides);
    let deviceConfig = null;

    try {
      deviceSettings = await this._maybeSyncFromLogic(deviceSettings, {
        skipLogicForceCharge: options.skipLogicForceCharge === true
      });
      const appSettings = this._getAppSettings();
      const appConfig = buildAppConfig(appSettings, Homey.env);

      if (!appConfig.stromligningApiKey) {
        const logicCompat = new LogicCompat(this.homey, this.log.bind(this));
        appConfig.stromligningApiKey = await logicCompat.getStromligningApiKeyFromLogic();
      }

      deviceConfig = buildDeviceConfig(deviceSettings, {
        default_charge_hours: appConfig.defaultChargeHours,
        spot_threshold: appConfig.spotThreshold,
        night_charge_end: appSettings.night_charge_end
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
        log: this.log.bind(this),
        forceEaseeSync: options.forceEaseeSync === true
      });

      const easeeConfig = orchestration.easeeConfig;
      const easeeResult = orchestration.easeeResult;
      const easeeState = easeeConfig?.syncPower && easeeConfig?.deviceId
        ? orchestration.easeeState
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
          night_charge_end: deviceSettings.night_charge_end,
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

      if (easeeConfig?.syncPower && (orchestration.changed || easeeResult?.action === 'start' || easeeResult?.action === 'stop')) {
        this.syncEaseeDisplayFromCharger({
          forceRefresh: true,
          chargeNow: result.charge_now
        }).catch((error) => {
          this.log(`Easee display efter orchestration fejlede: ${error.message}`);
        });
        this._startEaseePowerFollowUp(reason);
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

      if (options.notify && this.homey.app?.sendPlanUpdatedNotification) {
        const notifyHours = Number.isInteger(options.chargeHours) && options.chargeHours > 0
          ? options.chargeHours
          : result.oneShotActive
            ? deviceConfig.oneShotChargeHours
            : deviceConfig.chargeHours;
        await this.homey.app.sendPlanUpdatedNotification(result, {
          chargeHours: notifyHours,
          deviceConfig
        }).catch((error) => {
          this.log(`Plan-notifikation fejlede: ${error.message}`);
        });
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
      if (this._pendingEvaluate) {
        const pending = this._pendingEvaluate;
        this._pendingEvaluate = null;
        await this.evaluateNow(
          pending.reason,
          pending.overrides,
          {
            notify: pending.notify,
            chargeHours: pending.chargeHours,
            forceEaseeSync: pending.forceEaseeSync,
            skipLogicForceCharge: pending.skipLogicForceCharge
          }
        );
      }
    }
  }
}

module.exports = EvPlannerDevice;
