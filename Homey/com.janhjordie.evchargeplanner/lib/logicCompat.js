'use strict';

// BacklogTrace: EVC-011
const { LOGIC_VARIABLES } = require('./constants');

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

class LogicCompat {
  constructor(homey, log = console.log) {
    this.homey = homey;
    this.log = log;
  }

  isAvailable() {
    return typeof this.homey?.logic?.getVariables === 'function';
  }

  async getLogicVarByName(name) {
    if (!this.isAvailable()) {
      return null;
    }

    const all = await this.homey.logic.getVariables();
    return Object.values(all).find((variable) => variable.name === name) || null;
  }

  async ensureLogicVariable(name, type, defaultValue) {
    if (!this.isAvailable()) {
      return null;
    }

    const existing = await this.getLogicVarByName(name);

    if (existing) {
      return existing;
    }

    if (typeof this.homey.logic?.createVariable !== 'function') {
      this.log(`Logic-variabel '${name}' findes ikke, og createVariable er ikke tilgaengelig.`);
      return null;
    }

    this.log(`Opretter Logic-variabel '${name}' (${type}).`);
    return this.homey.logic.createVariable({
      variable: {
        name,
        type,
        value: defaultValue
      }
    });
  }

  async setLogicVariable(name, value, type, defaultValue) {
    const variable = await this.ensureLogicVariable(name, type, defaultValue);

    if (!variable) {
      return false;
    }

    await this.homey.logic.updateVariable({
      id: variable.id,
      variable: { value: coerceLogicValue(variable, value) }
    });
    return true;
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
  }

  async mirrorEvaluationToLogic(payload) {
    if (!this.isAvailable()) {
      return;
    }

    await this.setLogicVariable(
      LOGIC_VARIABLES.CHARGE_MESSAGE,
      payload.charge_message || '',
      'string',
      ''
    );
    await this.setLogicVariable(
      LOGIC_VARIABLES.CHARGE_NOW,
      payload.charge_now || false,
      'boolean',
      false
    );
  }

  async syncDeviceFromLogic(deviceSettings) {
    if (!this.isAvailable()) {
      return deviceSettings;
    }

    const forceChargeVar = await this.getLogicVarByName(LOGIC_VARIABLES.FORCE_CHARGE);
    const chargeHoursVar = await this.getLogicVarByName(LOGIC_VARIABLES.CHARGE_HOURS);
    const oneShotVar = await this.getLogicVarByName(LOGIC_VARIABLES.ONE_SHOT_CHARGE);
    const oneShotHoursVar = await this.getLogicVarByName(LOGIC_VARIABLES.ONE_SHOT_CHARGE_HOURS);
    const oneShotReadyVar = await this.getLogicVarByName(LOGIC_VARIABLES.ONE_SHOT_READY_BY);

    return {
      ...deviceSettings,
      force_charge: forceChargeVar ? parseLogicBoolean(forceChargeVar.value) : deviceSettings.force_charge,
      charge_hours: chargeHoursVar ? Number(chargeHoursVar.value) : deviceSettings.charge_hours,
      one_shot_enabled: oneShotVar ? parseLogicBoolean(oneShotVar.value) : deviceSettings.one_shot_enabled,
      one_shot_charge_hours: oneShotHoursVar
        ? Number(oneShotHoursVar.value)
        : deviceSettings.one_shot_charge_hours,
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
  parseLogicBoolean
};
