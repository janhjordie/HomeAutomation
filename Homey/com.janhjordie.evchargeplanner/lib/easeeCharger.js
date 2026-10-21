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
const ACTIVE_POWER_THRESHOLD_W = 100;
const START_VERIFY_DELAY_MS = 2000;
const LIGHT_VERIFY_DELAY_MS = 500;
const START_KICK_DELAY_MS = 400;
const MAX_START_ATTEMPTS = 2;
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

async function unwrapCapabilityValue(value) {
  if (value && typeof value.then === 'function') {
    return await value;
  }

  return value;
}

function deviceCapabilityIds(device) {
  if (Array.isArray(device?.capabilities)) {
    return device.capabilities;
  }

  return Object.keys(device?.capabilitiesObj || {});
}

function deviceHasCapability(device, capabilityId) {
  return deviceCapabilityIds(device).includes(capabilityId);
}

async function readCapabilityValue(device, capabilityId) {
  if (typeof device.getCapabilityValue === 'function') {
    try {
      const objectForm = await unwrapCapabilityValue(device.getCapabilityValue({ capabilityId }));
      if (objectForm !== undefined) {
        return objectForm;
      }
    } catch (error) {
      // Fall through to legacy string signature.
    }

    try {
      return await unwrapCapabilityValue(device.getCapabilityValue(capabilityId));
    } catch (error) {
      return undefined;
    }
  }

  return device.capabilitiesObj?.[capabilityId]?.value;
}

async function readEaseeStateFromDevice(device) {
  if (!device) {
    return null;
  }

  const measurePower = Number(await readCapabilityValue(device, CAP_MEASURE_POWER)) || 0;
  const hasOnoff = deviceHasCapability(device, CAP_ONOFF);
  const evchargerCharging = Boolean(await readCapabilityValue(device, CAP_EVCHARGER_CHARGING));
  const onoffRaw = hasOnoff ? await readCapabilityValue(device, CAP_ONOFF) : undefined;
  const onoff = onoffRaw === null || onoffRaw === undefined
    ? evchargerCharging
    : Boolean(onoffRaw);
  const chargingState = await readCapabilityValue(device, CAP_CHARGING_STATE) || null;
  const targetCircuitCurrent = Number(await readCapabilityValue(device, CAP_TARGET_CIRCUIT_CURRENT)) || 0;
  const chargerStatus = await readCapabilityValue(device, CAP_CHARGER_STATUS) || null;

  return {
    deviceId: device.id,
    name: device.name,
    measurePower,
    hasOnoff,
    onoff,
    evchargerCharging,
    chargingState,
    targetCircuitCurrent,
    chargerStatus
  };
}

function isEaseeDeliveringPower(state) {
  const powerW = Number(state?.measurePower);
  return Number.isFinite(powerW) && powerW > ACTIVE_POWER_THRESHOLD_W;
}

/** True only when measurable power indicates charging (ignores stale capability flags). */
function isEaseeActivelyCharging(state) {
  return isEaseeDeliveringPower(state);
}

function isEaseeStartSatisfied(state, circuitCurrent) {
  if (!state) {
    return false;
  }

  if (!isEaseeDeliveringPower(state)) {
    return false;
  }

  const target = Number(state.targetCircuitCurrent) || 0;
  const outputOn = state.evchargerCharging || (state.hasOnoff && state.onoff);
  return outputOn && target >= circuitCurrent;
}

function isEaseePaused(state) {
  if (!state) {
    return false;
  }

  const status = String(state.chargerStatus || '').toLowerCase();
  const chargingState = String(state.chargingState || '').toLowerCase();
  return status === 'paused' || chargingState.includes('paused');
}

function shouldStartEasee(state, circuitCurrent) {
  if (!state) {
    return true;
  }

  if (isEaseePaused(state)) {
    return true;
  }

  return !isEaseeStartSatisfied(state, circuitCurrent);
}

function shouldStopEasee(state) {
  return Boolean(state?.evchargerCharging)
    || (state?.hasOnoff && state?.onoff)
    || (state?.targetCircuitCurrent || 0) > 0;
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

    if (typeof this.homey?.devices?.getDevice === 'function') {
      try {
        const nativeDevice = await this.homey.devices.getDevice({ id: deviceId });
        if (nativeDevice) {
          return nativeDevice;
        }
      } catch (error) {
        this.log(`Easee device ${deviceId} via SDK: ${error.message}`);
      }
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

    return null;
  }

  async setEaseeCapability(deviceId, capabilityId, value, options = {}) {
    if (typeof this.homey?.devices?.getDevice === 'function') {
      try {
        const nativeDevice = await this.homey.devices.getDevice({ id: deviceId });
        if (nativeDevice && typeof nativeDevice.setCapabilityValue === 'function') {
          await nativeDevice.setCapabilityValue({ capabilityId, value });
          this.invalidateCache(deviceId);
          return;
        }
      } catch (error) {
        this.log(`Easee SDK set ${capabilityId} fejlede: ${error.message}`);
      }
    }

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

    const cacheMs = Number.isFinite(Number(options.cacheMs))
      ? Number(options.cacheMs)
      : DEFAULT_STATE_CACHE_MS;
    const cached = this._stateCache.get(deviceId);
    if (!options.forceRefresh && cached && Date.now() - cached.at < cacheMs) {
      return cached.state;
    }

    return this.readFreshState(config);
  }

  async readFreshState(config) {
    const deviceId = config?.deviceId;
    if (!deviceId) {
      return null;
    }

    this.invalidateCache(deviceId);
    const device = await this.getEaseeDevice(deviceId);
    const state = await readEaseeStateFromDevice(device);
    if (state) {
      this._stateCache.set(deviceId, { state, at: Date.now() });
    }

    return state;
  }

  async setEaseeChargingOutput(config, active, state = {}) {
    const device = await this.getEaseeDevice(config.deviceId);
    const hasOnoff = state.hasOnoff ?? deviceHasCapability(device, CAP_ONOFF);

    await this.setEaseeCapability(config.deviceId, CAP_EVCHARGER_CHARGING, active);

    if (hasOnoff) {
      try {
        await this.setEaseeCapability(config.deviceId, CAP_ONOFF, active);
      } catch (error) {
        this.log(`Easee onoff ${active ? 'start' : 'stop'} fejlede (ignoreres): ${error.message}`);
      }
    }
  }

  async resolveEaseeState(config, options = {}) {
    if (options.forceRefresh) {
      return this.readFreshState(config);
    }

    if (options.knownState) {
      return options.knownState;
    }

    return this.readState(config, { forceRefresh: false });
  }

  async _executeStartSequence(config, initialState, options = {}) {
    const aggressive = options.aggressiveStart === true;
    const maxAttempts = aggressive
      ? (options.maxStartAttempts ?? MAX_START_ATTEMPTS)
      : 1;
    const verifyDelayMs = aggressive
      ? (options.verifyDelayMs ?? START_VERIFY_DELAY_MS)
      : (options.lightVerifyDelayMs ?? LIGHT_VERIFY_DELAY_MS);
    const kickDelayMs = options.kickDelayMs ?? START_KICK_DELAY_MS;
    let lastState = initialState;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        lastState = await this.readFreshState(config) || lastState;
      }

      if (isEaseeStartSatisfied(lastState, config.circuitCurrent)) {
        return {
          action: 'noop',
          chargeNow: true,
          state: lastState,
          startVerified: true
        };
      }

      const target = Number(lastState.targetCircuitCurrent) || 0;
      const paused = isEaseePaused(lastState);
      const outputActive = lastState.evchargerCharging || (lastState.hasOnoff && lastState.onoff);
      const needsKick = paused
        || (!isEaseeDeliveringPower(lastState)
          && (target >= config.circuitCurrent || outputActive || attempt > 1));

      if (paused && outputActive) {
        await this.setEaseeChargingOutput(config, false, lastState);
        await delay(kickDelayMs);
      }

      if (needsKick) {
        await this.setEaseeCapability(config.deviceId, CAP_TARGET_CIRCUIT_CURRENT, 0);
        await delay(kickDelayMs);
      }

      await this.setEaseeCapability(
        config.deviceId,
        CAP_TARGET_CIRCUIT_CURRENT,
        config.circuitCurrent
      );
      await delay(kickDelayMs);

      try {
        await this.setEaseeChargingOutput(config, true, lastState);
      } catch (error) {
        lastError = error;
        this.log(`Easee start output fejlede (forsøg ${attempt}/${maxAttempts}): ${error.message}`);
        if (attempt === maxAttempts) {
          throw error;
        }
        continue;
      }

      await delay(verifyDelayMs);
      lastState = await this.readFreshState(config) || lastState;

      if (isEaseeDeliveringPower(lastState)) {
        this.log(
          `Easee start OK: ${config.circuitCurrent}A på ${lastState.name || config.deviceId} `
          + `(forsøg ${attempt}, ${lastState.measurePower}W)`
        );
        return {
          action: 'start',
          chargeNow: true,
          state: lastState,
          startVerified: true,
          attempts: attempt
        };
      }

      lastError = new Error('easee_start_not_delivering_power');
      this.log(
        `Easee start verify: ingen effekt efter forsøg ${attempt}/${maxAttempts} `
        + `(charging=${lastState.evchargerCharging}, target=${lastState.targetCircuitCurrent}A, power=${lastState.measurePower}W)`
      );

      if (!aggressive) {
        return {
          action: 'start_pending',
          chargeNow: true,
          state: lastState,
          startVerified: false,
          error: lastError.message,
          attempts: attempt
        };
      }
    }

    return {
      action: 'start_failed',
      chargeNow: true,
      state: lastState,
      startVerified: false,
      error: lastError?.message || 'easee_start_verify_failed',
      attempts: maxAttempts
    };
  }

  async applyChargeNow(config, chargeNow, options = {}) {
    if (!config?.enabled) {
      return {
        skipped: true,
        reason: 'easee_control_disabled',
        chargeNow: Boolean(chargeNow)
      };
    }

    let currentState = await this.resolveEaseeState(config, options);
    if (!currentState) {
      const device = await this.getEaseeDevice(config.deviceId);
      if (!device) {
        return {
          skipped: true,
          reason: 'easee_device_not_found',
          chargeNow: Boolean(chargeNow)
        };
      }
      currentState = await readEaseeStateFromDevice(device);
    }

    if (chargeNow) {
      if (!shouldStartEasee(currentState, config.circuitCurrent)) {
        return {
          action: 'noop',
          chargeNow: true,
          state: currentState,
          startVerified: true
        };
      }

      return this._executeStartSequence(config, currentState, options);
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
    if (shouldStopEasee(currentState)) {
      await this.setEaseeChargingOutput(config, false, currentState);
    }
    this.log(`Easee stop: ${currentState.name || config.deviceId}`);

    return {
      action: 'stop',
      chargeNow: false,
      state: await this.readFreshState(config)
    };
  }
}

module.exports = {
  DEFAULT_EASEE_DEVICE_ID,
  DEFAULT_EASEE_CIRCUIT_CURRENT,
  DEFAULT_STATE_CACHE_MS,
  ACTIVE_POWER_THRESHOLD_W,
  START_VERIFY_DELAY_MS,
  LIGHT_VERIFY_DELAY_MS,
  START_KICK_DELAY_MS,
  MAX_START_ATTEMPTS,
  buildEaseeConfig,
  readEaseeStateFromDevice,
  isEaseeDeliveringPower,
  isEaseeActivelyCharging,
  isEaseeStartSatisfied,
  isEaseePaused,
  shouldStartEasee,
  shouldStopEasee,
  isRateLimitError,
  EaseeChargerController
};
