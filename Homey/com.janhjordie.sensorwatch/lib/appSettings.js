'use strict';

const {
  DEFAULT_STALE_HOURS,
  DEFAULT_MODEL_IDS,
  ALERT_STATE_KEY,
  DISABLED_IEEE_KEY
} = require('./constants');

function parseIdList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean).map(String);
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
  } catch {
    return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  }
}

function normalizeIeee(value) {
  return String(value || '').trim().toLowerCase();
}

function getAppSettings(homey) {
  const modelIds = parseIdList(homey.settings.get('watch_model_ids_json'));
  const disabled = parseIdList(homey.settings.get(DISABLED_IEEE_KEY)).map(normalizeIeee);
  // Legacy exclude list also counts as disabled
  const legacyExclude = parseIdList(homey.settings.get('exclude_ieee_addrs_json')).map(normalizeIeee);
  const disabledSet = new Set([...disabled, ...legacyExclude]);

  return {
    watch_model_ids: modelIds.length > 0 ? modelIds : [...DEFAULT_MODEL_IDS],
    stale_after_hours: Number(homey.settings.get('stale_after_hours')) || DEFAULT_STALE_HOURS,
    include_ieee_addrs: parseIdList(homey.settings.get('include_ieee_addrs_json')).map(normalizeIeee),
    disabled_ieee_addrs: [...disabledSet],
    notification_timeline_fallback: homey.settings.get('notification_timeline_fallback') !== false
  };
}

function getAlertState(homey) {
  const raw = homey.settings.get(ALERT_STATE_KEY);
  if (!raw) {
    return {};
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') {
    return raw;
  }
  return {};
}

async function setAlertState(homey, state) {
  await homey.settings.set(ALERT_STATE_KEY, state);
}

async function setDeviceEnabled(homey, ieeeAddress, enabled) {
  const ieee = normalizeIeee(ieeeAddress);
  if (!ieee) {
    throw new Error('Mangler IEEE-adresse');
  }

  const current = parseIdList(homey.settings.get(DISABLED_IEEE_KEY)).map(normalizeIeee);
  const next = new Set(current);
  if (enabled) {
    next.delete(ieee);
  } else {
    next.add(ieee);
  }

  await homey.settings.set(DISABLED_IEEE_KEY, JSON.stringify([...next]));
  return {
    id: ieee,
    enabled: !next.has(ieee),
    disabled_ieee_addrs: [...next]
  };
}

module.exports = {
  getAppSettings,
  getAlertState,
  setAlertState,
  setDeviceEnabled,
  parseIdList,
  normalizeIeee
};
