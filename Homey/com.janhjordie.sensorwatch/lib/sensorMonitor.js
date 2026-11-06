'use strict';

const { EMPTY_MODEL_TOKEN } = require('./constants');
const {
  getAppSettings,
  getAlertState,
  setAlertState,
  normalizeIeee
} = require('./appSettings');
const { managerApiRequest } = require('./homeyManagerApi');
const { sendPushNotification, sendTimelineNotification } = require('./pushNotification');

const LAST_STALE_TIMELINE_KEY = 'last_stale_timeline_at';
const LAST_STALE_TIMELINE_FINGERPRINT_KEY = 'last_stale_timeline_fingerprint';
const TIMELINE_DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const HOMEY_TIME_ZONE = 'Europe/Copenhagen';

function listFromApiResponse(response) {
  if (Array.isArray(response)) {
    return response;
  }
  if (response && typeof response === 'object') {
    return Object.values(response);
  }
  return [];
}

function shortName(fullName) {
  const name = String(fullName || '').trim();
  if (!name) return 'Zigbee node';
  const sep = name.indexOf(' - ');
  return sep > 0 ? name.slice(0, sep).trim() : name;
}

/** Match exact model IDs, `(empty)`, or simple globs (`lumi.sensor*`). */
function modelIdMatches(modelId, pattern) {
  const id = String(modelId || '').trim();
  const pat = String(pattern ?? '').trim();
  if (pat === '' || pat === EMPTY_MODEL_TOKEN) {
    return id === '';
  }
  if (!id) return false;
  if (!pat.includes('*')) {
    return id === pat;
  }
  const escaped = pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(id);
}

function isWatchedModelId(modelId, watchModelIds) {
  return (watchModelIds || []).some((pattern) => modelIdMatches(modelId, pattern));
}

/** Model/include match only — disabled devices are still listed in UI. */
function isListedNode(node, settings) {
  const modelId = String(node?.modelId || '').trim();
  if (!isWatchedModelId(modelId, settings.watch_model_ids)) {
    return false;
  }

  const ieee = normalizeIeee(node.ieeeAddress || node.ieeeAddr);
  if (!ieee) {
    return false;
  }

  if (settings.include_ieee_addrs.length > 0
    && !settings.include_ieee_addrs.includes(ieee)) {
    return false;
  }

  return true;
}

function isDeviceEnabled(ieee, settings) {
  return !settings.disabled_ieee_addrs.includes(normalizeIeee(ieee));
}

function getLastSeenMs(node) {
  const value = Number(node?.lastSeen ?? node?.last_seen);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function formatHoursAgo(msAgo) {
  const hours = Math.max(1, Math.round(msAgo / (60 * 60 * 1000)));
  if (hours < 48) {
    return `${hours} timer`;
  }
  const days = Math.round(hours / 24);
  if (days < 60) {
    return `${days} dage`;
  }
  const years = Math.round(days / 365);
  return years <= 1 ? 'ca. 1 år' : `ca. ${years} år`;
}

function localCalendarDay(timestamp) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: HOMEY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(timestamp));
}

function shouldSendStalePush(prev, now = Date.now()) {
  const lastPush = Number(prev?.lastStalePushAt) || 0;
  if (!lastPush) {
    return true;
  }
  return localCalendarDay(lastPush) !== localCalendarDay(now);
}

function buildDeadBatteryTimelineMessage(staleRows) {
  if (!staleRows.length) {
    return 'Sensor Watch: Ingen enheder uden nyere Zigbee-kontakt.';
  }

  const lines = staleRows.map((row) => {
    const ago = row.staleForMs != null
      ? formatHoursAgo(row.staleForMs)
      : 'ukendt tid';
    return `• ${row.name} — ${ago}`;
  });

  return `Sensor Watch — ${staleRows.length} enheder uden nyere Zigbee-kontakt:\n${lines.join('\n')}`;
}

function buildStalePushMessage() {
  return 'Sensor Watch: Enheder mangler nyere Zigbee-kontakt. Se timeline for listen.';
}

function buildTimelineFingerprint(staleRows) {
  return staleRows
    .map((row) => `${row.deviceId}:${row.lastSeen || 'none'}`)
    .sort()
    .join('|');
}

function analyzeNode(node, settings, now = Date.now()) {
  const lastSeen = getLastSeenMs(node);
  const staleMs = settings.stale_after_hours * 60 * 60 * 1000;
  const ieee = normalizeIeee(node.ieeeAddress || node.ieeeAddr);
  const stale = lastSeen == null || (now - lastSeen) >= staleMs;
  const staleForMs = lastSeen == null ? null : Math.max(0, now - lastSeen);
  const enabled = isDeviceEnabled(ieee, settings);

  return {
    deviceId: ieee,
    ieeeAddress: ieee,
    networkAddress: node.networkAddress ?? node.nwkAddr ?? null,
    name: shortName(node.name),
    fullName: node.name || shortName(node.name),
    modelId: String(node.modelId || '').trim() || '(empty)',
    type: node.type || node.deviceType || null,
    lastSeen,
    stale,
    staleForMs,
    enabled
  };
}

function buildStatusRows(nodes, settings, now = Date.now()) {
  return nodes
    .filter((node) => isListedNode(node, settings))
    .map((node) => analyzeNode(node, settings, now))
    .sort((a, b) => a.name.localeCompare(b.name, 'da'));
}

async function fetchZigbeeNodes(homey) {
  let state;
  if (typeof homey.api?.get === 'function') {
    try {
      state = await homey.api.get('/manager/zigbee/state');
    } catch (error) {
      state = await managerApiRequest(homey, 'GET', '/manager/zigbee/state');
    }
  } else {
    state = await managerApiRequest(homey, 'GET', '/manager/zigbee/state');
  }

  return listFromApiResponse(state?.nodes);
}

async function runSensorCheck(homey, options = {}) {
  const log = options.log || (() => {});
  const reason = options.reason || 'scheduler';
  const now = Date.now();
  const settings = getAppSettings(homey);
  const alertState = getAlertState(homey);
  const nextAlertState = { ...alertState };
  let mobilePushNeeded = false;

  const nodes = await fetchZigbeeNodes(homey);
  const rows = buildStatusRows(nodes, settings, now);

  for (const row of rows) {
    const prev = nextAlertState[row.deviceId] || {};
    const entry = {
      ...prev,
      lastSeen: row.lastSeen,
      modelId: row.modelId || '(empty)',
      lastCheckedAt: now,
      enabled: row.enabled
    };

    if (!row.enabled) {
      // Keep history but do not alert while disabled
      nextAlertState[row.deviceId] = entry;
      continue;
    }

    if (row.stale) {
      if (shouldSendStalePush(prev, now)) {
        const ago = row.staleForMs != null
          ? formatHoursAgo(row.staleForMs)
          : 'ukendt tid';
        mobilePushNeeded = true;
        entry.lastStalePushAt = now;
        entry.staleAlerted = true;
        log(`[${reason}] STALE ${row.name} (${ago}) lastSeen=${row.lastSeen}`);
      }
    } else if (prev.staleAlerted || prev.lastStalePushAt) {
      entry.staleAlerted = false;
      entry.lastStalePushAt = null;
      log(`[${reason}] RECOVERED ${row.name} (ingen besked sendt)`);
    }

    nextAlertState[row.deviceId] = entry;
  }

  if (mobilePushNeeded) {
    await sendPushNotification(homey, buildStalePushMessage(), log);
  }

  const staleEnabled = rows.filter((row) => row.enabled && row.stale);
  const forceTimeline = Boolean(options.forceTimeline) || reason === 'app_boot';
  const lastTimelineAt = Number(homey.settings.get(LAST_STALE_TIMELINE_KEY)) || 0;
  const timelineFingerprint = buildTimelineFingerprint(staleEnabled);
  const previousFingerprint = String(
    homey.settings.get(LAST_STALE_TIMELINE_FINGERPRINT_KEY) || ''
  );
  const duplicateTimeline = reason !== 'app_boot'
    && timelineFingerprint === previousFingerprint
    && (now - lastTimelineAt) < TIMELINE_DEDUPE_WINDOW_MS;
  const timelineDue = !duplicateTimeline && (
    forceTimeline
    || (
      staleEnabled.length > 0
      && localCalendarDay(lastTimelineAt) !== localCalendarDay(now)
    )
  );

  let timelineChannel = null;
  if (timelineDue) {
    const timelineMessage = buildDeadBatteryTimelineMessage(staleEnabled);
    timelineChannel = await sendTimelineNotification(homey, timelineMessage, log);
    if (timelineChannel) {
      await homey.settings.set(LAST_STALE_TIMELINE_KEY, now);
      await homey.settings.set(
        LAST_STALE_TIMELINE_FINGERPRINT_KEY,
        timelineFingerprint
      );
      log(`[${reason}] Timeline (${timelineChannel}): ${staleEnabled.length} stale`);
    }
  }

  await setAlertState(homey, nextAlertState);

  return {
    reason,
    checkedAt: now,
    watchedCount: rows.filter((row) => row.enabled).length,
    listedCount: rows.length,
    alertsSent: mobilePushNeeded ? 1 : 0,
    timelineChannel,
    staleCount: staleEnabled.length,
    devices: rows.map((row) => ({
      id: row.deviceId,
      name: row.name,
      modelId: row.modelId || '(empty)',
      networkAddress: row.networkAddress,
      lastSeen: row.lastSeen,
      stale: row.stale,
      enabled: row.enabled
    }))
  };
}

module.exports = {
  listFromApiResponse,
  modelIdMatches,
  isWatchedModelId,
  isListedNode,
  isDeviceEnabled,
  shouldSendStalePush,
  localCalendarDay,
  buildStalePushMessage,
  buildDeadBatteryTimelineMessage,
  getLastSeenMs,
  analyzeNode,
  buildStatusRows,
  fetchZigbeeNodes,
  runSensorCheck,
  shortName,
  normalizeIeee
};
