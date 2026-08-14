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

const DEFAULT_STATE_CACHE_MS = 45 * 1000;
const RATE_LIMIT_PATTERN = /429|rate limit|too many requests/i;

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

function isRateLimitError(error) {
  return Boolean(error?.message && RATE_LIMIT_PATTERN.test(error.message));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class EaseeChargerController {
  constructor(homey, log = console.log) {
    this.homey = homey;
    this.log = log;
    this._stateCache = new Map();
  }

  invalidateCache(deviceId) {
    if (deviceId) {
      this._stateCache.delete(deviceId);
    }
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

  async setEaseeCapability(deviceId, capabilityId, value, options = {}) {
    const maxAttempts = options.maxAttempts ?? 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await managerApiRequest(
          this.homey,
          'PUT',
          `/manager/devices/device/${deviceId}/capability/${capabilityId}`,
          { value }
        );
        this.invalidateCache(deviceId);
        return;
      } catch (error) {
        if (!isRateLimitError(error) || attempt === maxAttempts) {
          throw error;
        }

        const waitMs = Math.min(2000 * attempt, 10000);
        this.log(`Easee rate limit på ${capabilityId}, venter ${waitMs}ms (forsøg ${attempt}/${maxAttempts})`);
        await delay(waitMs);
      }
    }
  }

  async readState(config, options = {}) {
    const deviceId = config?.deviceId;
    if (!deviceId) {
      return null;
    }

    const cacheMs = Number(options.cacheMs) ?? DEFAULT_STATE_CACHE_MS;
    const cached = this._stateCache.get(deviceId);
    if (!options.forceRefresh && cached && Date.now() - cached.at < cacheMs) {
      return cached.state;
    }

    const device = await this.getEaseeDevice(deviceId);
    const state = readEaseeStateFromDevice(device);
    if (state) {
      this._stateCache.set(deviceId, { state, at: Date.now() });
    }

    return state;
  }

  async applyChargeNow(config, chargeNow, options = {}) {
    if (!config?.enabled) {
      return {
        skipped: true,
        reason: 'easee_control_disabled',
        chargeNow: Boolean(chargeNow)
      };
    }

    const state = options.knownState || await this.readState(config, { forceRefresh: options.forceRefresh });
    if (!state) {
      const device = await this.getEaseeDevice(config.deviceId);
      if (!device) {
        return {
          skipped: true,
          reason: 'easee_device_not_found',
          chargeNow: Boolean(chargeNow)
        };
      }
    }

    const currentState = state || readEaseeStateFromDevice(await this.getEaseeDevice(config.deviceId));

    if (chargeNow) {
      if (!shouldStartEasee(currentState, config.circuitCurrent)) {
        return {
          action: 'noop',
          chargeNow: true,
          state: currentState
        };
      }

      if (currentState.targetCircuitCurrent < config.circuitCurrent) {
        await this.setEaseeCapability(
          config.deviceId,
          CAP_TARGET_CIRCUIT_CURRENT,
          config.circuitCurrent
        );
      }
      if (!currentState.onoff) {
        await this.setEaseeCapability(config.deviceId, CAP_ONOFF, true);
      }
      if (!currentState.evchargerCharging) {
        await this.setEaseeCapability(config.deviceId, CAP_EVCHARGER_CHARGING, true);
      }
      this.log(`Easee start: ${config.circuitCurrent}A på ${currentState.name || config.deviceId}`);

      return {
        action: 'start',
        chargeNow: true,
        state: await this.readState(config, { forceRefresh: true, cacheMs: 0 })
      };
    }

    if (!shouldStopEasee(currentState)) {
      return {
        action: 'noop',
        chargeNow: false,
        state: currentState
      };
    }

    if (currentState.targetCircuitCurrent > 0) {
      await this.setEaseeCapability(config.deviceId, CAP_TARGET_CIRCUIT_CURRENT, 0);
    }
    if (currentState.onoff) {
      await this.setEaseeCapability(config.deviceId, CAP_ONOFF, false);
    }
    if (currentState.evchargerCharging) {
      await this.setEaseeCapability(config.deviceId, CAP_EVCHARGER_CHARGING, false);
    }
    this.log(`Easee stop: ${currentState.name || config.deviceId}`);

    return {
      action: 'stop',
      chargeNow: false,
      state: await this.readState(config, { forceRefresh: true, cacheMs: 0 })
    };
  }
}

module.exports = {
  DEFAULT_EASEE_DEVICE_ID,
  DEFAULT_EASEE_CIRCUIT_CURRENT,
  DEFAULT_STATE_CACHE_MS,
  buildEaseeConfig,
  readEaseeStateFromDevice,
  shouldStartEasee,
  shouldStopEasee,
  isRateLimitError,
  EaseeChargerController
};
