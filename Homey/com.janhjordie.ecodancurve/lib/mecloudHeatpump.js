'use strict';

const { managerApiRequest } = require('./homeyManagerApi');
const { REQUIRED_THERMOSTAT_MODE } = require('./constants');

const CAP_OUTDOOR = 'measure_temperature.outdoor';
const CAP_FLOW = 'measure_temperature.flow';
const CAP_FLOW_TARGET = 'target_temperature.flow_heat';
const CAP_DEFROST = 'alarm_generic.defrost';
const CAP_OP_STATE = 'operational_state';
const CAP_OP_ZONE1 = 'operational_state.zone1';
const CAP_THERMOSTAT_MODE = 'thermostat_mode';
const CAP_ONOFF = 'onoff';

const TRACKED_CAPABILITIES = [
  CAP_OUTDOOR,
  CAP_FLOW,
  CAP_FLOW_TARGET,
  CAP_DEFROST,
  CAP_OP_STATE,
  CAP_OP_ZONE1,
  CAP_THERMOSTAT_MODE,
  CAP_ONOFF,
  'measure_power',
  'measure_frequency'
];

function buildHeatpumpConfig(appSettings = {}) {
  const deviceId = String(appSettings.heatpump_device_id ?? '').trim();
  const deviceName = String(appSettings.heatpump_device_name ?? '').trim();
  const controlEnabled = appSettings.heatpump_control_enabled !== false;

  return {
    enabled: controlEnabled && (deviceId.length > 0 || deviceName.length > 0),
    deviceId,
    deviceName
  };
}

async function readCapabilityValue(device, capabilityId) {
  if (typeof device.getCapabilityValue === 'function') {
    try {
      const objectForm = await device.getCapabilityValue({ capabilityId });
      if (objectForm !== undefined) {
        return objectForm;
      }
    } catch {
      // Fall through.
    }

    try {
      return await device.getCapabilityValue(capabilityId);
    } catch {
      return undefined;
    }
  }

  return device.capabilitiesObj?.[capabilityId]?.value;
}

function readCapabilityMeta(device, capabilityId) {
  const entry = device.capabilitiesObj?.[capabilityId];
  return {
    value: entry?.value,
    lastUpdated: entry?.lastUpdated || null
  };
}

async function readHeatpumpStateFromDevice(device) {
  if (!device) {
    return null;
  }

  const outdoor = Number(await readCapabilityValue(device, CAP_OUTDOOR));
  const flow = Number(await readCapabilityValue(device, CAP_FLOW));
  const flowTarget = Number(await readCapabilityValue(device, CAP_FLOW_TARGET));
  const defrost = Boolean(await readCapabilityValue(device, CAP_DEFROST));
  const operationalState = await readCapabilityValue(device, CAP_OP_STATE) || null;
  const zone1State = await readCapabilityValue(device, CAP_OP_ZONE1) || null;
  const thermostatMode = await readCapabilityValue(device, CAP_THERMOSTAT_MODE) || null;
  const onoff = Boolean(await readCapabilityValue(device, CAP_ONOFF));

  return {
    deviceId: device.id,
    name: device.name,
    outdoor: Number.isFinite(outdoor) ? outdoor : null,
    flow: Number.isFinite(flow) ? flow : null,
    flowTarget: Number.isFinite(flowTarget) ? flowTarget : null,
    defrost,
    operationalState,
    zone1State,
    thermostatMode,
    onoff,
    capabilities: Array.isArray(device.capabilities)
      ? device.capabilities
      : Object.keys(device.capabilitiesObj || {})
  };
}

function isHeatingState(state) {
  const zone1 = String(state?.zone1State || '').toLowerCase();
  const op = String(state?.operationalState || '').toLowerCase();
  return zone1 === 'heating' || op === 'heating';
}

function canApplyFlowTarget(state) {
  if (!state) {
    return { ok: false, reason: 'heatpump_not_found' };
  }

  if (!isHeatingState(state)) {
    return { ok: false, reason: 'not_heating' };
  }

  const mode = String(state.thermostatMode || '').toLowerCase();
  if (mode && mode !== REQUIRED_THERMOSTAT_MODE) {
    return { ok: false, reason: `thermostat_mode_${mode}` };
  }

  return { ok: true };
}

class MecloudHeatpumpController {
  constructor(homey, log = console.log) {
    this.homey = homey;
    this.log = log;
    this._resolvedDeviceId = null;
  }

  async resolveDeviceId(config) {
    if (config.deviceId) {
      return config.deviceId;
    }

    if (this._resolvedDeviceId) {
      return this._resolvedDeviceId;
    }

    const targetName = config.deviceName;
    if (!targetName) {
      return null;
    }

    if (typeof this.homey.devices?.getDevices === 'function') {
      const devices = await this.homey.devices.getDevices();
      const match = Object.values(devices || {}).find((device) => device.name === targetName);
      if (match?.id) {
        this._resolvedDeviceId = match.id;
        return match.id;
      }
    }

    try {
      const list = await managerApiRequest(this.homey, 'GET', '/manager/devices/device');
      const devices = Array.isArray(list) ? list : Object.values(list || {});
      const match = devices.find((device) => device.name === targetName);
      if (match?.id) {
        this._resolvedDeviceId = match.id;
        return match.id;
      }
    } catch (error) {
      this.log(`Heatpump lookup via Manager API fejlede: ${error.message}`);
    }

    return null;
  }

  async getHeatpumpDevice(config) {
    const deviceId = await this.resolveDeviceId(config);
    if (!deviceId) {
      return null;
    }

    if (typeof this.homey.devices?.getDevice === 'function') {
      try {
        const nativeDevice = await this.homey.devices.getDevice({ id: deviceId });
        if (nativeDevice) {
          return nativeDevice;
        }
      } catch (error) {
        this.log(`Heatpump ${deviceId} via SDK: ${error.message}`);
      }
    }

    try {
      return await managerApiRequest(
        this.homey,
        'GET',
        `/manager/devices/device/${deviceId}`
      );
    } catch (error) {
      this.log(`Heatpump ${deviceId} via Manager API: ${error.message}`);
    }

    return null;
  }

  async readState(config) {
    const device = await this.getHeatpumpDevice(config);
    return readHeatpumpStateFromDevice(device);
  }

  async probeCapabilities(config) {
    const device = await this.getHeatpumpDevice(config);
    if (!device) {
      return {
        found: false,
        error: 'heatpump_device_not_found'
      };
    }

    const state = await readHeatpumpStateFromDevice(device);
    const capabilitySnapshot = {};

    for (const capabilityId of TRACKED_CAPABILITIES) {
      capabilitySnapshot[capabilityId] = readCapabilityMeta(device, capabilityId);
    }

    return {
      found: true,
      deviceId: device.id,
      name: device.name,
      driverUri: device.driverUri || null,
      state,
      capabilities: device.capabilities || Object.keys(device.capabilitiesObj || {}),
      tracked: capabilitySnapshot
    };
  }

  async setFlowTarget(config, targetC, options = {}) {
    const device = await this.getHeatpumpDevice(config);
    if (!device) {
      return {
        action: 'skipped',
        reason: 'heatpump_device_not_found'
      };
    }

    const state = await readHeatpumpStateFromDevice(device);
    const gate = canApplyFlowTarget(state);
    if (!gate.ok && options.force !== true) {
      return {
        action: 'skipped',
        reason: gate.reason,
        state
      };
    }

    const current = state.flowTarget;
    const deadband = Number(options.deadbandC);
    if (Number.isFinite(current) && Number.isFinite(deadband)
      && Math.abs(current - targetC) < deadband) {
      return {
        action: 'noop',
        reason: 'within_deadband',
        state,
        targetC,
        previousTarget: current
      };
    }

    const deviceId = device.id;

    if (typeof device.setCapabilityValue === 'function') {
      await device.setCapabilityValue({ capabilityId: CAP_FLOW_TARGET, value: targetC });
    } else {
      await managerApiRequest(
        this.homey,
        'PUT',
        `/manager/devices/device/${deviceId}/capability/${CAP_FLOW_TARGET}`,
        { value: targetC }
      );
    }

    this.log(`Flow target ${current ?? '?'}°C → ${targetC}°C på ${state.name || deviceId}`);

    return {
      action: 'set',
      state: await this.readState(config),
      targetC,
      previousTarget: current
    };
  }
}

module.exports = {
  TRACKED_CAPABILITIES,
  buildHeatpumpConfig,
  readHeatpumpStateFromDevice,
  isHeatingState,
  canApplyFlowTarget,
  MecloudHeatpumpController
};
