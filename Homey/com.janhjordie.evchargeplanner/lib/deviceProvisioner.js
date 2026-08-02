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

  const response = await homey.api.get('/manager/devices/device');
  const devices = Array.isArray(response) ? response : Object.values(response || {});

  return devices.filter((device) => device.driverId === driverId);
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

  return homey.api.post(`/manager/drivers/pairsession/${session.id}/device`, {
    name,
    data: { id: dataId }
  });
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

async function ensureDefaultDevice(homey, log = () => {}, error = () => {}) {
  const driverId = getDriverId(homey);
  const existingDevices = await getPlannerDeviceInstances(homey, log);
  const managedDevices = await listManagedPlannerDevices(homey, driverId);

  if (existingDevices.length > 0 || managedDevices.length > 0) {
    const count = Math.max(existingDevices.length, managedDevices.length);
    log(`EV Ladeplan enhed findes allerede (${count})`);
    return {
      created: false,
      deviceCount: count,
      devices: (managedDevices.length ? managedDevices : existingDevices).map((device) => ({
        id: device.id || device.getData?.()?.id,
        name: device.name || device.getName?.()
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
  ensureDefaultDevice,
  createPlannerDevice
};
