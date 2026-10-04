'use strict';

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
      return await homey.users.getUsers();
    } catch (error) {
      log(`homey.users.getUsers fejlede: ${error.message}`);
    }
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

/** Personal/local API token with Flow scope (Developer Tools) — same access as CLI. */
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

  const fromPat = await runPersonalTokenMobilePush(homey, args, log);
  if (fromPat) return fromPat;

  const hasPat = Boolean(String(homey.settings.get('push_api_token') || '').trim());
  if (!hasPat) {
    log('Mobil push: tilføj push_api_token i app-indstillinger (lokal API-nøgle med Flow-scope)');
  }

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
 * Phone push via personal API token when configured; optional timeline fallback.
 * @returns {Promise<string>} channel id for logging
 */
async function sendPushNotification(homey, message, log = () => {}) {
  const text = String(message || '').trim();
  if (!text) return 'skip';

  const mobile = await sendMobilePush(homey, text, log);
  if (mobile) return mobile;

  const timelineFallback = homey.settings.get('notification_timeline_fallback') !== false;
  if (!timelineFallback) {
    log('Mobil push mislykkedes — timeline-fallback er slået fra');
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
  PUSH_CARD_ID,
  MOBILE_PUSH_FLOW_ATTEMPTS
};
