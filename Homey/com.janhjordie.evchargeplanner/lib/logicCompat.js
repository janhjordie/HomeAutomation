'use strict';

// BacklogTrace: EVC-011
const { LOGIC_VARIABLES, DEFAULT_ONE_SHOT_CHARGE_HOURS, MAX_CHARGE_HOURS } = require('./constants');

function parseLogicBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value ?? '').trim().toLowerCase();

  if (normalized === 'true' || normalized === '1' || normalized === 'on') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'off' || normalized === '') {
    return false;
  }

  return Boolean(value);
}

function coerceLogicValue(variable, value) {
  if (variable.type === 'boolean') {
    return parseLogicBoolean(value);
  }

  if (variable.type === 'number') {
    return Number(value);
  }

  return value == null ? '' : String(value);
}

function normalizeLogicVariables(response) {
  if (Array.isArray(response)) {
    return response;
  }

  if (response && typeof response === 'object') {
    return Object.values(response);
  }

  return [];
}

function isMissingSessionError(error) {
  const message = String(error?.message || error || '');
  return message.includes('Missing Session');
}

function isMissingScopesError(error) {
  const message = String(error?.message || error || '');
  return message.includes('Missing Scopes');
}

class LogicCompat {
  constructor(homey, log = console.log) {
    this.homey = homey;
    this.log = log;
    this._managerApiUnavailable = false;
    this._nativeLogicUnavailable = false;
    this._ownerApiToken = null;
    this._localApiUrl = null;
    this._logicWriteBlocked = false;
  }

  usesNativeLogic() {
    if (this._nativeLogicUnavailable) {
      return false;
    }

    const logic = this.homey?.logic;
    return Boolean(
      logic
      && (
        typeof logic.updateVariable === 'function'
        || typeof logic.getVariables === 'function'
        || typeof logic.getVariable === 'function'
      )
    );
  }

  usesManagerApi() {
    return (
      !this._managerApiUnavailable
      && typeof this.homey?.api?.get === 'function'
      && typeof this.homey?.api?.put === 'function'
      && typeof this.homey?.api?.post === 'function'
    );
  }

  isAvailable() {
    return this.usesNativeLogic() || this.usesManagerApi();
  }

  async _readLogicVariablesNative() {
    const logic = this.homey.logic;

    if (typeof logic.getVariables === 'function') {
      const all = await logic.getVariables();
      return normalizeLogicVariables(all);
    }

    return [];
  }

  async _ensureOwnerApiAccess() {
    if (this._ownerApiToken && this._localApiUrl) {
      return true;
    }

    if (typeof this.homey.api?.getOwnerApiToken !== 'function') {
      return false;
    }

    try {
      this._ownerApiToken = await this.homey.api.getOwnerApiToken();
      if (typeof this.homey.api?.getLocalUrl === 'function') {
        this._localApiUrl = await this.homey.api.getLocalUrl();
      }
      return Boolean(this._ownerApiToken && this._localApiUrl);
    } catch (error) {
      this.log(`Kunne ikke hente owner API token: ${error.message}`);
      return false;
    }
  }

  async _managerApiRequest(method, path, body = undefined) {
    if (await this._ensureOwnerApiAccess()) {
      const url = `${this._localApiUrl}/api${path}`;
      const headers = {
        Authorization: `Bearer ${this._ownerApiToken}`
      };

      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }

      const response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${method} ${path} failed (${response.status}): ${text}`);
      }

      if (response.status === 204) {
        return null;
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return response.json();
      }

      return null;
    }

    if (!this.usesManagerApi()) {
      throw new Error('Manager API ikke tilgaengelig');
    }

    if (method === 'GET') {
      return this.homey.api.get(path);
    }
    if (method === 'POST') {
      return this.homey.api.post(path, body);
    }
    if (method === 'PUT') {
      return this.homey.api.put(path, body);
    }

    throw new Error(`Unsupported manager API method: ${method}`);
  }

  async _readLogicVariablesManagerApi() {
    const response = await this._managerApiRequest('GET', '/manager/logic/variable');
    return normalizeLogicVariables(response);
  }

  async getLogicVariables() {
    if (this.usesNativeLogic()) {
      try {
        return await this._readLogicVariablesNative();
      } catch (error) {
        if (isMissingSessionError(error)) {
          this._nativeLogicUnavailable = true;
        }
        this.log(`homey.logic.getVariables fejlede: ${error.message}`);
      }
    }

    if (!this.usesManagerApi()) {
      return [];
    }

    try {
      return await this._readLogicVariablesManagerApi();
    } catch (error) {
      if (isMissingSessionError(error)) {
        this._managerApiUnavailable = true;
        this.log('Logic manager API session ikke tilgaengelig.');
      } else {
        this.log(`Logic manager API read fejlede: ${error.message}`);
      }
      return [];
    }
  }

  async getLogicVarByName(name) {
    if (!this.isAvailable()) {
      return null;
    }

    const all = await this.getLogicVariables();
    return all.find((variable) => variable.name === name) || null;
  }

  async _createLogicVariableNative(name, type, defaultValue) {
    if (typeof this.homey.logic?.createVariable !== 'function') {
      return null;
    }

    this.log(`Opretter Logic-variabel '${name}' (${type}) via homey.logic.`);
    return this.homey.logic.createVariable({
      variable: {
        name,
        type,
        value: defaultValue
      }
    });
  }

  async _createLogicVariableManagerApi(name, type, defaultValue) {
    this.log(`Opretter Logic-variabel '${name}' (${type}) via manager API.`);
    const created = await this._managerApiRequest('POST', '/manager/logic/variable', {
      variable: {
        name,
        type,
        value: defaultValue
      }
    });
    return created?.variable || created;
  }

  async ensureLogicVariable(name, type, defaultValue) {
    if (!this.isAvailable()) {
      return null;
    }

    const existing = await this.getLogicVarByName(name);
    if (existing) {
      return existing;
    }

    if (this.usesNativeLogic()) {
      try {
        return await this._createLogicVariableNative(name, type, defaultValue);
      } catch (error) {
        this.log(`homey.logic.createVariable fejlede for '${name}': ${error.message}`);
      }
    }

    if (!this.usesManagerApi()) {
      return null;
    }

    try {
      return await this._createLogicVariableManagerApi(name, type, defaultValue);
    } catch (error) {
      this.log(`Logic create fejlede for '${name}': ${error.message}`);
      return null;
    }
  }

  async _updateLogicVariableNative(variable, coercedValue) {
    await this.homey.logic.updateVariable({
      id: variable.id,
      variable: { value: coercedValue }
    });
  }

  async _updateLogicVariableManagerApi(variable, coercedValue) {
    try {
      await this._managerApiRequest('PUT', `/manager/logic/variable/${variable.id}`, {
        value: coercedValue
      });
    } catch (error) {
      await this._managerApiRequest('PUT', `/manager/logic/variable/${variable.id}`, {
        variable: { value: coercedValue }
      });
    }
  }

  async setLogicVariable(name, value, type, defaultValue) {
    if (this._logicWriteBlocked) {
      return false;
    }

    if (!this.isAvailable()) {
      this.log(`Logic '${name}' ikke opdateret — ingen tilgaengelig Logic-backend.`);
      return false;
    }

    const variable = await this.ensureLogicVariable(name, type, defaultValue);
    if (!variable) {
      this.log(`Logic '${name}' ikke opdateret — variabel findes ikke.`);
      return false;
    }

    const coercedValue = coerceLogicValue(variable, value);

    if (this.usesNativeLogic()) {
      try {
        await this._updateLogicVariableNative(variable, coercedValue);
        return true;
      } catch (error) {
        this.log(`homey.logic.updateVariable fejlede for '${name}': ${error.message}`);
      }
    }

    if (!this.usesManagerApi()) {
      return false;
    }

    try {
      await this._updateLogicVariableManagerApi(variable, coercedValue);
      return true;
    } catch (error) {
      if (isMissingScopesError(error)) {
        this._logicWriteBlocked = true;
        this.log(
          'Logic-skrivning blokeret (Missing Scopes). Brug Homey/SyncEvLogicFromDevice.js eller device Flow-kort i stedet.'
        );
        return false;
      }
      this.log(`Logic '${name}' ikke opdateret: ${error.message}`);
      return false;
    }
  }

  async ensureChargeLogicVariables() {
    if (!this.isAvailable()) {
      this.log('Logic manager ikke tilgaengelig — springer variabel-oprettelse over.');
      return;
    }

    await this.ensureLogicVariable(LOGIC_VARIABLES.FORCE_CHARGE, 'boolean', false);
    await this.ensureLogicVariable(LOGIC_VARIABLES.CHARGE_HOURS, 'number', 3);
    await this.ensureLogicVariable(LOGIC_VARIABLES.CHARGE_NOW, 'boolean', false);
    await this.ensureLogicVariable(LOGIC_VARIABLES.CHARGE_MESSAGE, 'string', '');
    await this.ensureLogicVariable(LOGIC_VARIABLES.ONE_SHOT_CHARGE, 'boolean', false);
    await this.ensureLogicVariable(LOGIC_VARIABLES.ONE_SHOT_CHARGE_HOURS, 'number', 7);
    await this.ensureLogicVariable(LOGIC_VARIABLES.ONE_SHOT_READY_BY, 'string', '09:30');
    await this.ensureLogicVariable(LOGIC_VARIABLES.NIGHT_CHARGE, 'boolean', true);
  }

  async mirrorEvaluationToLogic(payload) {
    if (!this.isAvailable()) {
      return;
    }

    const messageUpdated = await this.setLogicVariable(
      LOGIC_VARIABLES.CHARGE_MESSAGE,
      payload.charge_message || '',
      'string',
      ''
    );
    const chargeNowUpdated = await this.setLogicVariable(
      LOGIC_VARIABLES.CHARGE_NOW,
      payload.charge_now || false,
      'boolean',
      false
    );

    if (!messageUpdated || !chargeNowUpdated) {
      this.log('Logic-spejling ufuldstaendig for charge_message/charge_now.');
    }
  }

  async getOneShotChargeHoursFromLogic() {
    const variable = await this.getLogicVarByName(LOGIC_VARIABLES.ONE_SHOT_CHARGE_HOURS);
    if (!variable) {
      return null;
    }

    const hours = Number(variable.value);
    if (!Number.isInteger(hours) || hours <= 0) {
      return null;
    }

    return Math.min(hours, MAX_CHARGE_HOURS);
  }

  async applyOneShotChargeHoursFromLogic(deviceSettings) {
    const hours = await this.getOneShotChargeHoursFromLogic();
    if (hours == null) {
      return deviceSettings;
    }

    return {
      ...deviceSettings,
      one_shot_charge_hours: hours
    };
  }

  async syncDeviceFromLogic(deviceSettings) {
    if (!this.isAvailable()) {
      return deviceSettings;
    }

    const forceChargeVar = await this.getLogicVarByName(LOGIC_VARIABLES.FORCE_CHARGE);
    const oneShotReadyVar = await this.getLogicVarByName(LOGIC_VARIABLES.ONE_SHOT_READY_BY);
    const nightChargeVar = await this.getLogicVarByName(LOGIC_VARIABLES.NIGHT_CHARGE);

    return {
      ...deviceSettings,
      force_charge: forceChargeVar ? parseLogicBoolean(forceChargeVar.value) : deviceSettings.force_charge,
      night_charge_enabled: nightChargeVar
        ? parseLogicBoolean(nightChargeVar.value)
        : deviceSettings.night_charge_enabled,
      one_shot_ready_by: oneShotReadyVar
        ? String(oneShotReadyVar.value)
        : deviceSettings.one_shot_ready_by
    };
  }

  async syncDeviceToLogic(deviceSettings) {
    if (!this.isAvailable()) {
      return;
    }

    await this.setLogicVariable(
      LOGIC_VARIABLES.FORCE_CHARGE,
      deviceSettings.force_charge,
      'boolean',
      false
    );
    await this.setLogicVariable(
      LOGIC_VARIABLES.CHARGE_HOURS,
      deviceSettings.charge_hours,
      'number',
      3
    );
    await this.setLogicVariable(
      LOGIC_VARIABLES.ONE_SHOT_CHARGE,
      deviceSettings.one_shot_enabled,
      'boolean',
      false
    );
    await this.setLogicVariable(
      LOGIC_VARIABLES.NIGHT_CHARGE,
      deviceSettings.night_charge_enabled !== false,
      'boolean',
      true
    );
    await this.setLogicVariable(
      LOGIC_VARIABLES.ONE_SHOT_CHARGE_HOURS,
      deviceSettings.one_shot_charge_hours,
      'number',
      7
    );
    await this.setLogicVariable(
      LOGIC_VARIABLES.ONE_SHOT_READY_BY,
      deviceSettings.one_shot_ready_by,
      'string',
      '09:30'
    );
  }

  async disableOneShotCharge(reason = '') {
    const updated = await this.setLogicVariable(
      LOGIC_VARIABLES.ONE_SHOT_CHARGE,
      false,
      'boolean',
      false
    );

    if (updated && reason) {
      this.log(`Logic oneShotCharge slaaet fra: ${reason}`);
    }

    return updated;
  }

  async enableOneShotCharge() {
    return this.setLogicVariable(
      LOGIC_VARIABLES.ONE_SHOT_CHARGE,
      true,
      'boolean',
      false
    );
  }

  async getStromligningApiKeyFromLogic() {
    const variable = await this.getLogicVarByName(LOGIC_VARIABLES.STROMLIGNING_API_KEY);

    if (!variable) {
      return '';
    }

    return String(variable.value || '').trim();
  }
}

module.exports = {
  LogicCompat,
  parseLogicBoolean,
  isMissingSessionError,
  isMissingScopesError
};
