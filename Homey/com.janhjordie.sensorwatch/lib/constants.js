'use strict';

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** Smoke/weather end-devices: silent for this long => likely dead battery. */
const DEFAULT_STALE_HOURS = 72;
/** Daily stale notifications become eligible at 08:00 Europe/Copenhagen. */
const DAILY_NOTIFICATION_HOUR = 8;
/**
 * Exact IDs and globs (`*` = any chars).
 * `(empty)` = Zigbee nodes with missing modelId (older Aqara sensors).
 */
const DEFAULT_MODEL_IDS = ['lumi.weather', 'lumi.sensor*', '(empty)'];
const EMPTY_MODEL_TOKEN = '(empty)';
const ALERT_STATE_KEY = 'alert_state_json';
const DISABLED_IEEE_KEY = 'disabled_ieee_addrs_json';

module.exports = {
  CHECK_INTERVAL_MS,
  DEFAULT_STALE_HOURS,
  DAILY_NOTIFICATION_HOUR,
  DEFAULT_MODEL_IDS,
  EMPTY_MODEL_TOKEN,
  ALERT_STATE_KEY,
  DISABLED_IEEE_KEY
};
