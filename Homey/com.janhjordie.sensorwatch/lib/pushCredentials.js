'use strict';

const { managerApiRequest } = require('./homeyManagerApi');

const EV_APP_ID = 'com.janhjordie.evchargeplanner';

async function readAppSetting(homey, appId, name) {
  try {
    if (typeof homey.api?.get === 'function') {
      return await homey.api.get(`/manager/apps/app/${appId}/setting/${name}`);
    }
  } catch {
    // fall through
  }
  try {
    return await managerApiRequest(homey, 'GET', `/manager/apps/app/${appId}/setting/${name}`);
  } catch {
    return undefined;
  }
}

/**
 * Seed Homey mobile-push credentials the same way EV Charge Planner already has them.
 * Copies push_api_token + cached user ids when Sensor Watch is missing them.
 */
async function ensureHomeyPushCredentials(homey, log = () => {}) {
  const hasToken = Boolean(String(homey.settings.get('push_api_token') || '').trim());
  const hasUserIds = Boolean(
    homey.settings.get('notification_user_id')
    && homey.settings.get('notification_user_athom_id')
  );

  if (!hasToken) {
    const token = await readAppSetting(homey, EV_APP_ID, 'push_api_token');
    if (token && String(token).trim()) {
      await homey.settings.set('push_api_token', String(token).trim());
      log('Importerede Homey push_api_token fra EV Ladeplan');
    }
  }

  if (!hasUserIds) {
    const userId = await readAppSetting(homey, EV_APP_ID, 'notification_user_id');
    const athomId = await readAppSetting(homey, EV_APP_ID, 'notification_user_athom_id');
    if (userId && athomId) {
      await homey.settings.set('notification_user_id', userId);
      await homey.settings.set('notification_user_athom_id', athomId);
      log('Importerede Homey push-bruger fra EV Ladeplan');
    }
  }

  // Timeline is not Homey mobile push — keep off unless user explicitly enables it.
  if (homey.settings.get('notification_timeline_fallback') === undefined
    || homey.settings.get('notification_timeline_fallback') === null
    || homey.settings.get('notification_timeline_fallback') === '') {
    await homey.settings.set('notification_timeline_fallback', false);
  }
}

module.exports = {
  ensureHomeyPushCredentials,
  EV_APP_ID
};
