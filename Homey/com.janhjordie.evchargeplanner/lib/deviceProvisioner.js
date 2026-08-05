'use strict';

const { ensureDeviceFavorite } = require('./deviceFavorites');

const DEFAULT_DEVICE_NAME = 'EV Ladeplan';
const DEFAULT_DEVICE_DATA_ID = 'ev-planner-primary';

function getDriverId(homey) {
  return `homey:app:${homey.manifest.id}:ev_planner`;
}

async function listDriverDevices(driver) {
  const devices = driver.getDevices();
  return Array.isArray(devices) ? devices : await devices;
}

async function listManagedPlannerDevices(homey, driverId) {
  if (typeof homey.api?.get !== 'function') {
    return [];
  }

  try {
    const response = await homey.api.get('/manager/devices/device');
    const devices = Array.isArray(response) ? response : Object.values(response || {});
    return devices.filter((device) => device.driverId === driverId);
  } catch (error) {
    return [];
  }
}

async function getPlannerDeviceInstances(homey, log = () => {}) {
  const driver = homey.drivers.getDriver('ev_planner');
  const driverId = getDriverId(homey);
  const boundDevices = await listDriverDevices(driver);

  if (boundDevices.length > 0) {
    return boundDevices;
  }

  const managedDevices = await listManagedPlannerDevices(homey, driverId);
  const instances = [];

  for (const managedDevice of managedDevices) {
    try {
      const instance = driver.getDevice({ id: managedDevice.id });
      if (instance) {
        instances.push(instance);
      }
    } catch (error) {
      log(`Kunne ikke binde EV Ladeplan ${managedDevice.id}: ${error.message}`);
    }
  }

  return instances;
}

async function createPlannerDeviceViaManagerApi(homey, options = {}) {
  if (typeof homey.api?.post !== 'function') {
    throw new Error('Homey Manager API er ikke tilgaengelig');
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
    data: { id: dataId }
  });

  if (typeof homey.api?.delete === 'function') {
    try {
      await homey.api.delete(`/manager/drivers/pairsession/${session.id}`);
    } catch (error) {
      // Pair session may already be closed by Homey after device creation.
    }
  }

  return device;
}

async function createPlannerDevice(homey, options = {}) {
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
        data: { id: dataId }
      }
    });
  }

  return createPlannerDeviceViaManagerApi(homey, options);
}

async function deleteManagedPlannerDevice(homey, deviceId, log = () => {}) {
  if (!deviceId || typeof homey.api?.delete !== 'function') {
    return false;
  }

  try {
    await homey.api.delete(`/manager/devices/device/${deviceId}`);
    return true;
  } catch (error) {
    log(`Kunne ikke slette EV Ladeplan ${deviceId}: ${error.message}`);
    return false;
  }
}

async function repairOrphanedPlannerDevices(homey, log = () => {}) {
  const driver = homey.drivers.getDriver('ev_planner');
  const driverId = getDriverId(homey);
  const managedDevices = await listManagedPlannerDevices(homey, driverId);

  if (managedDevices.length === 0) {
    return { repaired: false, boundCount: 0 };
  }

  const registeredCount = homey.app?._plannerDevices?.size || 0;
  if (registeredCount > 0) {
    return { repaired: false, boundCount: registeredCount };
  }

  log(`EV Ladeplan orphan fundet (${managedDevices.length}) — genopretter enhed...`);

  for (const managedDevice of managedDevices) {
    await deleteManagedPlannerDevice(homey, managedDevice.id, log);
  }

  const device = await createPlannerDevice(homey);
  const deviceId = device.id || device.data?.id;

  if (deviceId) {
    await ensureDeviceFavorite(homey, deviceId, log);
  }

  log(`EV Ladeplan genoprettet: ${device.name || DEFAULT_DEVICE_NAME}`);
  return {
    repaired: true,
    device: {
      id: deviceId,
      name: device.name || DEFAULT_DEVICE_NAME
    }
  };
}

async function ensureDefaultDevice(homey, log = () => {}, error = () => {}) {
  const repairResult = await repairOrphanedPlannerDevices(homey, log);
  if (repairResult.repaired) {
    return {
      created: true,
      repaired: true,
      deviceCount: 1,
      device: repairResult.device
    };
  }

  const driverId = getDriverId(homey);
  const existingDevices = await getPlannerDeviceInstances(homey, log);
  const managedDevices = await listManagedPlannerDevices(homey, driverId);

  if (existingDevices.length > 0) {
    log(`EV Ladeplan enhed findes allerede (${existingDevices.length})`);
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
    log(`EV Ladeplan enhed findes allerede (${managedDevices.length})`);
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
    const device = await createPlannerDevice(homey);
    const deviceId = device.id || device.data?.id;
    if (deviceId) {
      await ensureDeviceFavorite(homey, deviceId, log);
    }
    log(`Auto-oprettede EV Ladeplan enhed: ${device.name || DEFAULT_DEVICE_NAME}`);
    return {
      created: true,
      deviceCount: 1,
      device: {
        id: device.id || device.data?.id || DEFAULT_DEVICE_DATA_ID,
        name: device.name || DEFAULT_DEVICE_NAME
      }
    };
  } catch (provisionError) {
    error(`Kunne ikke auto-oprette EV Ladeplan enhed: ${provisionError.message}`);
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
  listManagedPlannerDevices,
  getPlannerDeviceInstances,
  createPlannerDeviceViaManagerApi,
  repairOrphanedPlannerDevices,
  ensureDefaultDevice,
  createPlannerDevice
};
