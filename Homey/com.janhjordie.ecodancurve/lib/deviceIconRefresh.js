'use strict';

const { managerApiRequest } = require('./homeyManagerApi');

/** Bump when driver icon.svg changes so existing devices pick up the new artwork. */
const DRIVER_ICON_REVISION = 2;

const DRIVER_ICON_PATH = '/icon.svg';

async function refreshDeviceDriverIcon(device, log = () => {}) {
  const storeKey = 'driver_icon_revision';
  const current = await device.getStoreValue(storeKey);
  if (current === DRIVER_ICON_REVISION) {
    return false;
  }

  const deviceId = device.getId();
  const homey = device.homey;

  try {
    await managerApiRequest(homey, 'PUT', `/manager/devices/device/${deviceId}`, {
      icon: DRIVER_ICON_PATH
    });
    await device.setStoreValue(storeKey, DRIVER_ICON_REVISION);
    log(`Opdaterede enhedsikon (${DRIVER_ICON_PATH})`);
    return true;
  } catch (error) {
    log(`Kunne ikke opdatere enhedsikon: ${error.message}`);
    return false;
  }
}

module.exports = {
  DRIVER_ICON_PATH,
  DRIVER_ICON_REVISION,
  refreshDeviceDriverIcon
};
