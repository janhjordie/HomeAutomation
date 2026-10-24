'use strict';

const { managerApiRequest } = require('./homeyManagerApi');

async function ensureDeviceFavorite(homey, deviceId, log = () => {}, device = null) {
  if (!deviceId) {
    return false;
  }

  if (device && await device.getStoreValue('favorite_set')) {
    return false;
  }

  try {
    const me = await managerApiRequest(homey, 'GET', '/manager/users/user/me');
    const favorites = Array.isArray(me?.properties?.favoriteDevices)
      ? [...me.properties.favoriteDevices]
      : [];

    if (favorites.includes(deviceId)) {
      if (device) {
        await device.setStoreValue('favorite_set', true);
      }
      return false;
    }

    favorites.push(deviceId);
    await managerApiRequest(homey, 'PUT', '/manager/users/user/me/properties/favoriteDevices', {
      value: favorites
    });

    if (device) {
      await device.setStoreValue('favorite_set', true);
    }

    log(`Tilføjede ${deviceId} til favoritter`);
    return true;
  } catch (error) {
    log(`Kunne ikke sætte favorit: ${error.message}`);
    return false;
  }
}

module.exports = {
  ensureDeviceFavorite
};
