'use strict';

const Homey = require('homey');
const {
  CHECK_INTERVAL_MS,
  DEFAULT_STALE_HOURS,
  DEFAULT_MODEL_IDS,
  DISABLED_IEEE_KEY
} = require('./lib/constants');
const { runSensorCheck, buildStatusRows, fetchZigbeeNodes } = require('./lib/sensorMonitor');
const { getAppSettings, setDeviceEnabled } = require('./lib/appSettings');
const { ensureHomeyPushCredentials } = require('./lib/pushCredentials');

const HOMEY_TIME_ZONE = 'Europe/Copenhagen';
const DAILY_CHECK_HOUR = 8;

function getTimeZoneParts(timestamp) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: HOMEY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(timestamp));

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );
}

function getTimeZoneOffsetMs(timestamp) {
  const parts = getTimeZoneParts(timestamp);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - timestamp;
}

function getNextDailyCheckDelay(now = Date.now()) {
  const current = getTimeZoneParts(now);
  let localTargetUtc = Date.UTC(
    current.year,
    current.month - 1,
    current.day,
    DAILY_CHECK_HOUR,
    0,
    0
  );
  let target = localTargetUtc - getTimeZoneOffsetMs(localTargetUtc);

  if (target <= now) {
    localTargetUtc = Date.UTC(
      current.year,
      current.month - 1,
      current.day + 1,
      DAILY_CHECK_HOUR,
      0,
      0
    );
    target = localTargetUtc - getTimeZoneOffsetMs(localTargetUtc);
  }

  return Math.max(1000, target - now);
}

class SensorWatchApp extends Homey.App {
  async onInit() {
    this.log('Sensor Watch initialized (Zigbee lastSeen)');
    this._checkTimer = null;
    this._ensureDefaultSettings();

    try {
      await ensureHomeyPushCredentials(this.homey, this.log.bind(this));
    } catch (error) {
      this.error(`Push-credentials: ${error.message}`);
    }

    this._startScheduler();
    this._scheduleStartupTestPush();

    this.homey.setTimeout(() => {
      this.runCheck('app_boot').catch((error) => {
        this.error(`Boot check fejlede: ${error.message}`);
      });
    }, 10000);

    this.homey.on('unload', () => {
      if (this._checkTimer) {
        this.homey.clearInterval(this._checkTimer);
      }
      if (this._dailyCheckTimer) {
        this.homey.clearTimeout(this._dailyCheckTimer);
      }
    });
  }

  _scheduleStartupTestPush() {
    this.homey.setTimeout(() => {
      this._sendStartupTestPush().catch((error) => {
        this.error(`Startup test-push fejlede: ${error.message}`);
      });
    }, 8000);
  }

  async _sendStartupTestPush() {
    const { sendPushNotification } = require('./lib/pushNotification');
    const { buildStalePushMessage } = require('./lib/sensorMonitor');
    const message = buildStalePushMessage();
    const channel = await sendPushNotification(
      this.homey,
      message,
      (line) => this.log(line)
    );
    this.log(`Startup push via ${channel}: ${message}`);
  }

  async onSettings({ changedKeys = [] } = {}) {
    const changed = Array.isArray(changedKeys) ? changedKeys : [];
    if (changed.includes('notification_user')) {
      await this.homey.settings.set('notification_user_id', null);
      await this.homey.settings.set('notification_user_athom_id', null);
    }
    if (changed.includes('check_interval_minutes')) {
      this._startScheduler();
    }
  }

  _ensureDefaultSettings() {
    const intervalMin = Number(this.homey.settings.get('check_interval_minutes'));
    const defaults = {
      watch_model_ids_json: JSON.stringify(DEFAULT_MODEL_IDS),
      stale_after_hours: DEFAULT_STALE_HOURS,
      check_interval_minutes: intervalMin > 0 ? intervalMin : CHECK_INTERVAL_MS / 60000,
      notification_user: 'Jan Hjørdie',
      notification_timeline_fallback: false,
      include_ieee_addrs_json: '[]',
      [DISABLED_IEEE_KEY]: '[]'
    };

    for (const [key, value] of Object.entries(defaults)) {
      const current = this.homey.settings.get(key);
      if (current === undefined || current === null || current === '') {
        this.homey.settings.set(key, value);
      }
    }

    const modelsRaw = String(this.homey.settings.get('watch_model_ids_json') || '').trim();
    if (
      modelsRaw === '["lumi.sensor_smoke"]'
      || modelsRaw === '["lumi.weather","lumi.sensor*"]'
      || modelsRaw === JSON.stringify(['lumi.weather', 'lumi.sensor*'])
    ) {
      this.homey.settings.set('watch_model_ids_json', JSON.stringify(DEFAULT_MODEL_IDS));
    }

    // Older builds defaulted timeline on; Homey mobile push must not fall back silently.
    if (this.homey.settings.get('notification_timeline_fallback') === true) {
      this.homey.settings.set('notification_timeline_fallback', false);
    }
  }

  _getCheckIntervalMs() {
    const minutes = Number(this.homey.settings.get('check_interval_minutes'));
    if (Number.isFinite(minutes) && minutes >= 15) {
      return minutes * 60 * 1000;
    }
    return CHECK_INTERVAL_MS;
  }

  _startScheduler() {
    if (this._checkTimer) {
      this.homey.clearInterval(this._checkTimer);
    }

    const intervalMs = this._getCheckIntervalMs();
    const tick = () => {
      this.runCheck('scheduler').catch((error) => {
        this.error(`Scheduler check fejlede: ${error.message}`);
      });
    };

    this._checkTimer = this.homey.setInterval(tick, intervalMs);
    this._scheduleDailyCheck();
    this.log(`Scheduler: check every ${intervalMs / 60000} minutes`);
  }

  _scheduleDailyCheck() {
    if (this._dailyCheckTimer) {
      this.homey.clearTimeout(this._dailyCheckTimer);
    }

    const delay = getNextDailyCheckDelay();
    this._dailyCheckTimer = this.homey.setTimeout(() => {
      this.runCheck('daily_scheduler').catch((error) => {
        this.error(`Daily check fejlede: ${error.message}`);
      }).finally(() => {
        this._scheduleDailyCheck();
      });
    }, delay);

    this.log(`Daily stale check scheduled in ${Math.round(delay / 60000)} minutes`);
  }

  async runCheck(reason = 'manual') {
    return runSensorCheck(this.homey, {
      reason,
      log: this.log.bind(this)
    });
  }

  async setDeviceEnabled(ieeeAddress, enabled) {
    return setDeviceEnabled(this.homey, ieeeAddress, enabled);
  }

  async getMonitorStatus() {
    const settings = getAppSettings(this.homey);
    const nodes = await fetchZigbeeNodes(this.homey);
    const rows = buildStatusRows(nodes, settings);
    return {
      settings: {
        watch_model_ids: settings.watch_model_ids,
        stale_after_hours: settings.stale_after_hours,
        check_interval_minutes: this._getCheckIntervalMs() / 60000
      },
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
}

module.exports = SensorWatchApp;
