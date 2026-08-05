'use strict';

const {
  DEFAULT_EASEE_DEVICE_ID,
  DEFAULT_EASEE_CIRCUIT_CURRENT
} = require('./constants');
const { managerApiRequest } = require('./homeyManagerApi');

const CAP_TARGET_CIRCUIT_CURRENT = 'target_circuit_current';
const CAP_ONOFF = 'onoff';
const CAP_EVCHARGER_CHARGING = 'evcharger_charging';
const CAP_MEASURE_POWER = 'measure_power';
const CAP_CHARGING_STATE = 'evcharger_charging_state';
const CAP_CHARGER_STATUS = 'charger_status';

function buildEaseeConfig(appSettings = {}) {
  const deviceId = String(appSettings.easee_device_id || '').trim();
  const circuitCurrent = Number(appSettings.easee_circuit_current);
  const controlEnabled = appSettings.easee_control_enabled !== false;

  return {
    enabled: controlEnabled && deviceId.length > 0,
    deviceId,
    circuitCurrent: Number.isInteger(circuitCurrent) && circuitCurrent > 0
      ? circuitCurrent
      : DEFAULT_EASEE_CIRCUIT_CURRENT,
    syncPower: appSettings.easee_sync_power !== false
  };
}

function readEaseeStateFromDevice(device) {
  if (!device) {
    return null;
  }

  const caps = device.capabilitiesObj || {};

  return {
    deviceId: device.id,
    name: device.name,
    measurePower: Number(caps[CAP_MEASURE_POWER]?.value) || 0,
    onoff: Boolean(caps[CAP_ONOFF]?.value),
    evchargerCharging: Boolean(caps[CAP_EVCHARGER_CHARGING]?.value),
    chargingState: caps[CAP_CHARGING_STATE]?.value || null,
    targetCircuitCurrent: Number(caps[CAP_TARGET_CIRCUIT_CURRENT]?.value) || 0,
    chargerStatus: caps[CAP_CHARGER_STATUS]?.value || null
  };
}

function shouldStartEasee(state, circuitCurrent) {
  return !state?.onoff || state.targetCircuitCurrent < circuitCurrent;
}

function shouldStopEasee(state) {
  return Boolean(state?.onoff) || (state?.targetCircuitCurrent || 0) > 0;
}

class EaseeChargerController {
  constructor(homey, log = console.log) {
    this.homey = homey;
    this.log = log;
  }

  async getEaseeDevice(deviceId) {
    if (!deviceId) {
      return null;
    }

    try {
      return await managerApiRequest(
        this.homey,
        'GET',
        `/manager/devices/device/${deviceId}`
      );
    } catch (error) {
      this.log(`Easee device ${deviceId} via Manager API: ${error.message}`);
    }

    if (typeof this.homey?.devices?.getDevice === 'function') {
      try {
        return await this.homey.devices.getDevice({ id: deviceId });
      } catch (error) {
        this.log(`Easee device ${deviceId} ikke fundet: ${error.message}`);
      }
    }

    return null;
  }

  async setEaseeCapability(deviceId, capabilityId, value) {
    await managerApiRequest(
      this.homey,
      'PUT',
      `/manager/devices/device/${deviceId}/capability/${capabilityId}`,
      { value }
    );
  }

  async readState(config) {
    const deviceId = config?.deviceId;
    if (!deviceId) {
      return null;
    }

    const device = await this.getEaseeDevice(deviceId);
    return readEaseeStateFromDevice(device);
  }

  async applyChargeNow(config, chargeNow) {
    if (!config?.enabled) {
      return {
        skipped: true,
        reason: 'easee_control_disabled',
        chargeNow: Boolean(chargeNow)
      };
    }

    const device = await this.getEaseeDevice(config.deviceId);
    if (!device) {
      return {
        skipped: true,
        reason: 'easee_device_not_found',
        chargeNow: Boolean(chargeNow)
      };
    }

    const state = readEaseeStateFromDevice(device);

    if (chargeNow) {
      if (!shouldStartEasee(state, config.circuitCurrent)) {
        return {
          action: 'noop',
          chargeNow: true,
          state: await this._refreshState(config.deviceId)
        };
      }

      await this.setEaseeCapability(config.deviceId, CAP_TARGET_CIRCUIT_CURRENT, config.circuitCurrent);
      await this.setEaseeCapability(config.deviceId, CAP_ONOFF, true);
      await this.setEaseeCapability(config.deviceId, CAP_EVCHARGER_CHARGING, true);
      this.log(`Easee start: ${config.circuitCurrent}A på ${device.name}`);

      return {
        action: 'start',
        chargeNow: true,
        state: await this._refreshState(config.deviceId)
      };
    }

    if (!shouldStopEasee(state)) {
      return {
        action: 'noop',
        chargeNow: false,
        state: await this._refreshState(config.deviceId)
      };
    }

    await this.setEaseeCapability(config.deviceId, CAP_TARGET_CIRCUIT_CURRENT, 0);
    await this.setEaseeCapability(config.deviceId, CAP_ONOFF, false);
    await this.setEaseeCapability(config.deviceId, CAP_EVCHARGER_CHARGING, false);
    this.log(`Easee stop: ${device.name}`);

    return {
      action: 'stop',
      chargeNow: false,
      state: await this._refreshState(config.deviceId)
    };
  }

  async _refreshState(deviceId) {
    const refreshed = await this.getEaseeDevice(deviceId);
    return readEaseeStateFromDevice(refreshed);
  }
}

module.exports = {
  DEFAULT_EASEE_DEVICE_ID,
  DEFAULT_EASEE_CIRCUIT_CURRENT,
  buildEaseeConfig,
  readEaseeStateFromDevice,
  shouldStartEasee,
  shouldStopEasee,
  EaseeChargerController
};
