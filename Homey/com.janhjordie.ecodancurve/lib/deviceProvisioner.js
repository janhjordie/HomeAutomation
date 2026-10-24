'use strict';

const { ensureDeviceFavorite } = require('./deviceFavorites');
const { DRIVER_ICON_PATH } = require('./deviceIconRefresh');

const DEFAULT_DEVICE_NAME = 'Ecodan kurve';
const DEFAULT_DEVICE_DATA_ID = 'ecodan-curve-primary';

function getDriverId(homey) {
  return `homey:app:${homey.manifest.id}:ecodan_curve`;
}

async function listDriverDevices(driver) {
  const devices = driver.getDevices();
  return Array.isArray(devices) ? devices : await devices;
}

async function listManagedCurveDevices(homey, driverId) {
  if (typeof homey.api?.get !== 'function') {
    return [];
  }

  try {
    const response = await homey.api.get('/manager/devices/device');
    const devices = Array.isArray(response) ? response : Object.values(response || {});
    return devices.filter((device) => device.driverId === driverId);
  } catch {
    return [];
  }
}

async function getCurveDeviceInstances(homey, log = () => {}) {
  try {
    const driver = homey.drivers.getDriver('ecodan_curve');
    const boundDevices = await listDriverDevices(driver);

    if (boundDevices.length > 0) {
      return boundDevices;
    }

    const driverId = getDriverId(homey);
    const managedDevices = await listManagedCurveDevices(homey, driverId);
    const instances = [];

    for (const managedDevice of managedDevices) {
      try {
        const instance = driver.getDevice({ id: managedDevice.id });
        if (instance) {
          instances.push(instance);
        }
      } catch (error) {
        log(`Kunne ikke binde Ecodan kurve ${managedDevice.id}: ${error.message}`);
      }
    }

    return instances;
  } catch {
    return [];
  }
}

async function createCurveDeviceViaManagerApi(homey, options = {}) {
  if (typeof homey.api?.post !== 'function') {
    throw new Error('Homey Manager API er ikke tilgængelig');
  }

  const name = options.name || DEFAULT_DEVICE_NAME;
  const dataId = options.dataId || DEFAULT_DEVICE_DATA_ID;
  const driverId = getDriverId(homey);

  const session = await homey.api.post('/manager/drivers/pairsession', {
    type: 'pair',
    driverId
  });

  const device = await homey.api.post(`/manager/drivers/pairsession/${session.id}/device`, {
    name,
    data: { id: dataId },
    icon: DRIVER_ICON_PATH
  });

  if (typeof homey.api?.delete === 'function') {
    try {
      await homey.api.delete(`/manager/drivers/pairsession/${session.id}`);
    } catch {
      // Pair session may already be closed.
    }
  }

  return device;
}

async function createCurveDevice(homey, options = {}) {
  const name = options.name || DEFAULT_DEVICE_NAME;
  const dataId = options.dataId || DEFAULT_DEVICE_DATA_ID;

  if (typeof homey.drivers?.createPairSession === 'function'
    && typeof homey.drivers?.createPairSessionDevice === 'function') {
    const session = await homey.drivers.createPairSession({
      type: 'pair',
      driverId: getDriverId(homey)
    });

    return homey.drivers.createPairSessionDevice({
      id: session.id,
      device: {
        name,
        data: { id: dataId },
        icon: DRIVER_ICON_PATH
      }
    });
  }

  return createCurveDeviceViaManagerApi(homey, options);
}

async function deleteManagedCurveDevice(homey, deviceId, log = () => {}) {
  if (!deviceId || typeof homey.api?.delete !== 'function') {
    return false;
  }

  try {
    await homey.api.delete(`/manager/devices/device/${deviceId}`);
    return true;
  } catch (error) {
    log(`Kunne ikke slette Ecodan kurve ${deviceId}: ${error.message}`);
    return false;
  }
}

async function repairOrphanedCurveDevices(homey, log = () => {}) {
  const driver = homey.drivers.getDriver('ecodan_curve');
  const driverId = getDriverId(homey);
  const managedDevices = await listManagedCurveDevices(homey, driverId);

  if (managedDevices.length === 0) {
    return { repaired: false, boundCount: 0 };
  }

  const registeredCount = homey.app?._curveDevices?.size || 0;
  if (registeredCount > 0) {
    return { repaired: false, boundCount: registeredCount };
  }

  log(`Ecodan kurve orphan fundet (${managedDevices.length}) — genopretter enhed...`);

  for (const managedDevice of managedDevices) {
    await deleteManagedCurveDevice(homey, managedDevice.id, log);
  }

  const device = await createCurveDevice(homey);
  const deviceId = device.id || device.data?.id;

  if (deviceId) {
    await ensureDeviceFavorite(homey, deviceId, log);
  }

  log(`Ecodan kurve genoprettet: ${device.name || DEFAULT_DEVICE_NAME}`);
  return {
    repaired: true,
    device: {
      id: deviceId,
      name: device.name || DEFAULT_DEVICE_NAME
    }
  };
}

async function ensureDefaultDevice(homey, log = () => {}, error = () => {}) {
  const repairResult = await repairOrphanedCurveDevices(homey, log);
  if (repairResult.repaired) {
    return {
      created: true,
      repaired: true,
      deviceCount: 1,
      device: repairResult.device
    };
  }

  const driverId = getDriverId(homey);
  const existingDevices = await getCurveDeviceInstances(homey, log);
  const managedDevices = await listManagedCurveDevices(homey, driverId);

  if (existingDevices.length > 0) {
    log(`Ecodan kurve findes allerede (${existingDevices.length})`);
    for (const device of existingDevices) {
      const deviceId = device.getId?.() || device.id;
      await ensureDeviceFavorite(homey, deviceId, log, device.getId ? device : null);
    }
    return {
      created: false,
      deviceCount: existingDevices.length,
      devices: existingDevices.map((device) => ({
        id: device.getId?.() || device.id,
        name: device.getName?.() || device.name
      }))
    };
  }

  if (managedDevices.length > 0) {
    log(`Ecodan kurve findes allerede (${managedDevices.length})`);
    return {
      created: false,
      deviceCount: managedDevices.length,
      devices: managedDevices.map((device) => ({
        id: device.id,
        name: device.name
      }))
    };
  }

  try {
    const device = await createCurveDevice(homey);
    const deviceId = device.id || device.data?.id;
    if (deviceId) {
      await ensureDeviceFavorite(homey, deviceId, log);
    }
    log(`Auto-oprettede Ecodan kurve: ${device.name || DEFAULT_DEVICE_NAME}`);
    return {
      created: true,
      deviceCount: 1,
      device: {
        id: device.id || device.data?.id || DEFAULT_DEVICE_DATA_ID,
        name: device.name || DEFAULT_DEVICE_NAME
      }
    };
  } catch (provisionError) {
    error(`Kunne ikke auto-oprette Ecodan kurve: ${provisionError.message}`);
    return {
      created: false,
      error: provisionError.message
    };
  }
}

module.exports = {
  DEFAULT_DEVICE_NAME,
  DEFAULT_DEVICE_DATA_ID,
  getDriverId,
  getCurveDeviceInstances,
  ensureDefaultDevice,
  createCurveDevice
};
