'use strict';

const {
  DEFAULT_HEATPUMP_DEVICE_ID,
  DEFAULT_HEATPUMP_DEVICE_NAME,
  DEFAULT_OUTDOOR_AVG_WINDOW_MIN,
  DEFAULT_DEFROST_COOLDOWN_MIN,
  DEFAULT_MAX_OUTDOOR_DELTA_C,
  DEFAULT_FLOW_MIN_C,
  DEFAULT_FLOW_MAX_C,
  DEFAULT_FLOW_DEADBAND_C
} = require('./constants');
const { DEFAULT_CURVE_POINTS, serializeCurvePoints } = require('./heatCurve');

const APP_SETTING_DEFAULTS = {
  heatpump_device_id: DEFAULT_HEATPUMP_DEVICE_ID,
  heatpump_device_name: DEFAULT_HEATPUMP_DEVICE_NAME,
  heatpump_control_enabled: true,
  outdoor_avg_window_min: DEFAULT_OUTDOOR_AVG_WINDOW_MIN,
  defrost_cooldown_min: DEFAULT_DEFROST_COOLDOWN_MIN,
  outdoor_max_delta_c: DEFAULT_MAX_OUTDOOR_DELTA_C,
  flow_min_c: DEFAULT_FLOW_MIN_C,
  flow_max_c: DEFAULT_FLOW_MAX_C,
  flow_deadband_c: DEFAULT_FLOW_DEADBAND_C,
  curve_offset_c: 0,
  curve_points_json: serializeCurvePoints(DEFAULT_CURVE_POINTS)
};

const APP_SETTING_KEYS = [
  'heatpump_device_id',
  'heatpump_device_name',
  'heatpump_control_enabled',
  'outdoor_avg_window_min',
  'defrost_cooldown_min',
  'outdoor_max_delta_c',
  'flow_min_c',
  'flow_max_c',
  'flow_deadband_c',
  'curve_offset_c',
  'curve_points_json'
];

function isMissingSetting(value) {
  return value === undefined || value === null
    || (typeof value === 'string' && value.trim() === '');
}

function getAppSettings(homey) {
  const settings = { ...APP_SETTING_DEFAULTS };
  for (const key of APP_SETTING_KEYS) {
    const value = homey.settings.get(key);
    if (!isMissingSetting(value)) {
      settings[key] = value;
    }
  }
  return settings;
}

module.exports = {
  APP_SETTING_KEYS,
  APP_SETTING_DEFAULTS,
  getAppSettings
};
