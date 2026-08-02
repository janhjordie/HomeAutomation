'use strict';

async function ensureDeviceFavorite(homey, deviceId, log = () => {}, device = null) {
  if (!deviceId) {
    return false;
  }

  if (device && await device.getStoreValue('favorite_set')) {
    return false;
  }

  if (typeof homey.api?.get !== 'function' || typeof homey.api?.put !== 'function') {
    return false;
  }

  try {
    const me = await homey.api.get('/manager/users/user/me');
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
    await homey.api.put('/manager/users/user/me/properties/favoriteDevices', {
      value: favorites
    });

    if (device) {
      await device.setStoreValue('favorite_set', true);
    }

    log(`Tilfoejede ${deviceId} til favoritter`);
    return true;
  } catch (error) {
    log(`Kunne ikke saette favorit: ${error.message}`);
    return false;
  }
}

module.exports = {
  ensureDeviceFavorite
};
