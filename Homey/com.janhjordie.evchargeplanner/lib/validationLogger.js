'use strict';

// BacklogTrace: EVC-013
class ValidationLogger {
  constructor(homey, log = console.log) {
    this.homey = homey;
    this.log = log;
    this.storageKey = 'validation_log';
    this.maxEntries = 2000;
  }

  async recordComparison(deviceName, appResult, scriptResult) {
    const entry = {
      ts: new Date().toISOString(),
      device: deviceName,
      app_charge_now: Boolean(appResult?.charge_now),
      script_charge_now: scriptResult == null ? null : Boolean(scriptResult?.charge_now),
      match: scriptResult == null
        ? null
        : Boolean(appResult?.charge_now) === Boolean(scriptResult?.charge_now),
      app_message: appResult?.charge_message || '',
      script_message: scriptResult?.charge_message || ''
    };

    const history = await this.getHistory();
    history.push(entry);

    if (history.length > this.maxEntries) {
      history.splice(0, history.length - this.maxEntries);
    }

    await this.homey.settings.set(this.storageKey, history);

    if (entry.match === false) {
      this.log(`[EVC-013] Mismatch for ${deviceName}: app=${entry.app_charge_now}, script=${entry.script_charge_now}`);
    }

    return entry;
  }

  async getHistory() {
    return this.homey.settings.get(this.storageKey) || [];
  }

  async getSummary() {
    const history = await this.getHistory();
    const comparable = history.filter((entry) => entry.match !== null);

    if (!comparable.length) {
      return {
        total: history.length,
        comparable: 0,
        matches: 0,
        mismatches: 0,
        matchRate: null
      };
    }

    const matches = comparable.filter((entry) => entry.match).length;

    return {
      total: history.length,
      comparable: comparable.length,
      matches,
      mismatches: comparable.length - matches,
      matchRate: matches / comparable.length
    };
  }
}

module.exports = {
  ValidationLogger
};
