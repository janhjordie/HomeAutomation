'use strict';

const DEFAULT_DEVICE_NAME = 'EV Ladeplan';
const DEFAULT_DEVICE_DATA_ID = 'ev-planner-primary';

function getDriverId(homey) {
  return `homey:app:${homey.manifest.id}:ev_planner`;
}

async function listDriverDevices(driver) {
  const devices = driver.getDevices();
  return Array.isArray(devices) ? devices : await devices;
}

async function createPlannerDevice(homey, options = {}) {
  const name = options.name || DEFAULT_DEVICE_NAME;
  const dataId = options.dataId || DEFAULT_DEVICE_DATA_ID;

  if (typeof homey.drivers?.createPairSession !== 'function'
    || typeof homey.drivers?.createPairSessionDevice !== 'function') {
    throw new Error('Device provisioning API is not available on this Homey');
  }

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

async function ensureDefaultDevice(homey, log = () => {}, error = () => {}) {
  const driver = homey.drivers.getDriver('ev_planner');
  const existingDevices = await listDriverDevices(driver);

  if (existingDevices.length > 0) {
    log(`EV Ladeplan enhed findes allerede (${existingDevices.length})`);
    return {
      created: false,
      deviceCount: existingDevices.length,
      devices: existingDevices.map((device) => ({
        id: device.getData()?.id,
        name: device.getName()
      }))
    };
  }

  try {
    const device = await createPlannerDevice(homey);
    log(`Auto-oprettede EV Ladeplan enhed: ${device.name || DEFAULT_DEVICE_NAME}`);
    return {
      created: true,
      deviceCount: 1,
      device: {
        id: device.data?.id || DEFAULT_DEVICE_DATA_ID,
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
  ensureDefaultDevice,
  createPlannerDevice
};
