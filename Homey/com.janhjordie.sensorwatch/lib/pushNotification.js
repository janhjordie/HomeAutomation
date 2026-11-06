'use strict';

const { runManagerFlowCardAction, managerApiRequest } = require('./homeyManagerApi');

const PUSH_CARD_ID = 'homey:manager:mobile:push_text';

/** Same URI pattern as Homey docs / forum (CLI-verified). */
const MOBILE_PUSH_FLOW_ATTEMPTS = [
  {
    uri: 'homey:flowcardaction:homey:manager:mobile:push_text',
    id: PUSH_CARD_ID
  },
  {
    uri: 'homey:manager:mobile',
    id: PUSH_CARD_ID
  }
];

function normalizeUserName(value) {
  return String(value || '').trim().toLowerCase();
}

function usersToList(users) {
  if (!users) return [];
  if (Array.isArray(users)) return users;
  if (typeof users === 'object') return Object.values(users);
  return [];
}

function pickNotificationUser(users, preferredName) {
  const list = usersToList(users);
  if (!list.length) return null;

  const preferred = normalizeUserName(preferredName);
  if (preferred) {
    const exact = list.find((user) => normalizeUserName(user.name) === preferred);
    if (exact) return exact;

    const partial = list.find((user) => {
      const name = normalizeUserName(user.name);
      return name.includes(preferred) || preferred.includes(name);
    });
    if (partial) return partial;
  }

  return list[0];
}

function toPushUserArg(user) {
  const id = user?.id;
  const athomId = user?.athomId || user?.athom_id || id;
  if (!id || !athomId) return null;
  return { id, athomId };
}

async function fetchHomeyUsers(homey, log) {
  if (typeof homey.users?.getUsers === 'function') {
    try {
      const users = await homey.users.getUsers();
      const list = usersToList(users);
      if (list.length) return list;
    } catch (error) {
      log(`homey.users.getUsers fejlede: ${error.message}`);
    }
  }

  // Apps often lack ManagerUsers — same data via Manager API (homey:manager:api).
  try {
    if (typeof homey.api?.get === 'function') {
      const viaApi = await homey.api.get('/manager/users/user');
      const list = usersToList(viaApi);
      if (list.length) return list;
    }
  } catch (error) {
    log(`homey.api.get users fejlede: ${error.message}`);
  }

  try {
    const viaManager = await managerApiRequest(homey, 'GET', '/manager/users/user');
    return usersToList(viaManager);
  } catch (error) {
    log(`manager users fejlede: ${error.message}`);
  }

  return [];
}

async function resolveNotificationUser(homey, log) {
  const preferredName = String(homey.settings.get('notification_user') || '').trim();
  const cachedId = homey.settings.get('notification_user_id');
  const cachedAthomId = homey.settings.get('notification_user_athom_id');
  if (cachedId && cachedAthomId) {
    return toPushUserArg({ id: cachedId, athomId: cachedAthomId });
  }

  const users = await fetchHomeyUsers(homey, log);
  const match = pickNotificationUser(users, preferredName);
  const pushUser = toPushUserArg(match);
  if (!pushUser) {
    log(`Push: ingen bruger fundet (ønsket navn: "${preferredName || '(første bruger)'}")`);
    return null;
  }

  await homey.settings.set('notification_user_id', pushUser.id);
  await homey.settings.set('notification_user_athom_id', pushUser.athomId);
  if (match?.name) {
    log(`Push-bruger: ${match.name} (id=${pushUser.id})`);
  }
  return pushUser;
}

function isMobilePushChannel(channel) {
  return typeof channel === 'string' && channel.startsWith('mobile');
}

async function runFlowCardPush(api, args, log, label) {
  for (const { uri, id } of MOBILE_PUSH_FLOW_ATTEMPTS) {
    try {
      await api.flow.runFlowCardAction({ uri, id, args });
      return `mobile-${label}:${id}`;
    } catch (error) {
      log(`${label} push (${uri}) fejlede: ${error.message}`);
    }
  }
  return null;
}

function createAppFlowApi(homey) {
  if (typeof homey.flow?.runFlowCardAction !== 'function') {
    return null;
  }
  return {
    flow: {
      runFlowCardAction: (opts) => homey.flow.runFlowCardAction(opts)
    }
  };
}

async function runMobilePushViaAppFlow(homey, args, log) {
  const api = createAppFlowApi(homey);
  if (!api) {
    return null;
  }
  return runFlowCardPush(api, args, log, 'app');
}

async function runMobilePushViaManagerApi(homey, args, log) {
  for (const { uri, id } of MOBILE_PUSH_FLOW_ATTEMPTS) {
    try {
      await runManagerFlowCardAction(homey, uri, id, args);
      return `mobile-manager:${id}`;
    } catch (error) {
      log(`manager push (${uri}) fejlede: ${error.message}`);
    }
  }
  return null;
}

async function runMobilePushViaOwnerToken(homey, args, log) {
  if (typeof homey.api?.getOwnerApiToken !== 'function'
    || typeof homey.api?.getLocalUrl !== 'function') {
    return null;
  }

  try {
    const token = await homey.api.getOwnerApiToken();
    const address = await homey.api.getLocalUrl();
    if (!token || !address) {
      return null;
    }
    const { HomeyAPI } = require('homey-api');
    const api = await HomeyAPI.createLocalAPI({ address, token });
    return runFlowCardPush(api, args, log, 'owner');
  } catch (error) {
    log(`Owner token push setup fejlede: ${error.message}`);
    return null;
  }
}

/** Personal/local API token from app settings (Developer Tools) — same path EV Charge Planner uses. */
async function runPersonalTokenMobilePush(homey, args, log) {
  const token = String(homey.settings.get('push_api_token') || '').trim();
  if (!token || typeof homey.api?.getLocalUrl !== 'function') {
    return null;
  }

  try {
    const { HomeyAPI } = require('homey-api');
    const address = await homey.api.getLocalUrl();
    const api = await HomeyAPI.createLocalAPI({ address, token });
    return runFlowCardPush(api, args, log, 'pat');
  } catch (error) {
    log(`PAT push setup fejlede: ${error.message}`);
    return null;
  }
}

async function sendMobilePush(homey, message, log) {
  const user = await resolveNotificationUser(homey, log);
  if (!user) return null;

  const args = {
    user: { id: user.id, athomId: user.athomId },
    text: message
  };

  // Prefer the same path EV Charge Planner uses successfully (personal API token).
  const fromPat = await runPersonalTokenMobilePush(homey, args, log);
  if (fromPat) return fromPat;

  const fromOwner = await runMobilePushViaOwnerToken(homey, args, log);
  if (fromOwner) return fromOwner;

  const fromManager = await runMobilePushViaManagerApi(homey, args, log);
  if (fromManager) return fromManager;

  const fromApp = await runMobilePushViaAppFlow(homey, args, log);
  if (fromApp) return fromApp;

  return null;
}

async function sendTimelineNotification(homey, message, log) {
  if (typeof homey.flow?.runFlowCardAction === 'function') {
    try {
      await homey.flow.runFlowCardAction({
        uri: 'homey:flowcardaction:homey:manager:notifications:create_notification',
        id: 'homey:manager:notifications:create_notification',
        args: { text: message }
      });
      return 'timeline-flow';
    } catch (flowNotificationError) {
      log(`Flow timeline-notifikation fejlede: ${flowNotificationError.message}`);
    }
  }

  if (typeof homey.notifications?.createNotification === 'function') {
    try {
      await homey.notifications.createNotification({ excerpt: message });
      return 'timeline';
    } catch (notificationError) {
      log(`Homey.notifications fejlede: ${notificationError.message}`);
    }
  }

  return null;
}

/**
 * Homey mobile push (push_text) — same as EV Charge Planner.
 * Timeline only if notification_timeline_fallback is true.
 * @returns {Promise<string>} channel id for logging
 */
async function sendPushNotification(homey, message, log = () => {}) {
  const text = String(message || '').trim();
  if (!text) return 'skip';

  const mobile = await sendMobilePush(homey, text, log);
  if (mobile) return mobile;

  const timelineFallback = homey.settings.get('notification_timeline_fallback') === true;
  if (!timelineFallback) {
    log('Homey mobil push mislykkedes (ingen timeline-fallback)');
    log(`NOTIFIKATION (kun log): ${text}`);
    return 'log';
  }

  log('Mobil push ikke tilgængelig — bruger timeline som fallback');
  const timeline = await sendTimelineNotification(homey, text, log);
  if (timeline) return timeline;

  log(`NOTIFIKATION (kun log): ${text}`);
  return 'log';
}

module.exports = {
  normalizeUserName,
  pickNotificationUser,
  isMobilePushChannel,
  sendPushNotification,
  sendMobilePush,
  sendTimelineNotification,
  fetchHomeyUsers,
  resolveNotificationUser,
  PUSH_CARD_ID,
  MOBILE_PUSH_FLOW_ATTEMPTS
};
