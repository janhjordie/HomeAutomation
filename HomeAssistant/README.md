# Home Assistant Layout

This folder is organized by origin so it is easier to see what mirrors the live
Home Assistant `/config` folder and what is project-level source, docs, or data.

## Folder Guide

- `config/` — Mirror of the live Home Assistant `/config` folder.
- `config/includes/` — YAML fragments included from `configuration.yaml`.
- `deye-battery-rescue/` — Deye rescue automation package plus its design and deployment docs.
- `deye-analytics/` — Deye monitoring and analytics automation source files.
- `ecodan/` — Heat pump automation source, analysis data, and strategy docs.
- `deye_weekly_log-*.csv` and other CSV files — Captured data and generated reports.

## Rule Of Thumb

If a file should exist directly inside Home Assistant `/config`, it belongs in
`HomeAssistant/config/`. If it is an automation source, analysis file, guide, or
captured data file used by the project, it stays outside that mirror.

## Entity Catalog

This section lists the custom Home Assistant entities defined or documented by
this repo.

Scope:
- Includes repo-managed entities created by the current `config/configuration.yaml` mirror.
- Includes helper entities that automations expect, even when they are created manually in the UI.
- Does not attempt to list every external integration entity such as `sensor.solarcust0186_*`.

## Active Config Entities

These are the custom entities created by the current config mirror in
`HomeAssistant/config/`.

### Statistics Sensors

Source: `config/configuration.yaml`

- `sensor.deye_voltage_min_24h`
- `sensor.ecodan_outdoor_avg_60m`
- `sensor.ecodan_flow_avg_10m`

### REST Sensors

Source: `config/includes/deye-spot-price-rest.yaml`

- `sensor.deye_spot_price_cache`

### Input Number Helpers

Source: `config/includes/deye-spot-price-helpers.yaml`

- `input_number.deye_grid_buy_cost_today_kr`
- `input_number.deye_grid_buy_cost_yesterday_kr`
- `input_number.deye_grid_sell_value_today_kr`
- `input_number.deye_grid_sell_value_yesterday_kr`
- `input_number.deye_pv_value_today_kr`
- `input_number.deye_pv_value_yesterday_kr`
- `input_number.deye_grid_buy_cost_total_kr`
- `input_number.deye_grid_sell_value_total_kr`
- `input_number.deye_pv_value_total_kr`
- `input_number.deye_battery_discharge_value_today_kr`
- `input_number.deye_battery_discharge_value_yesterday_kr`
- `input_number.deye_battery_discharge_value_total_kr`

### Utility Meter Sensors

Source: `config/includes/deye-soba-dashboard-sensors.yaml`

- `sensor.deye_grid_bought_today`
- `sensor.deye_grid_sold_today`
- `sensor.deye_consumption_today`
- `sensor.deye_pv_today`
- `sensor.deye_battery_charge_today`
- `sensor.deye_battery_discharge_today`
- `sensor.deye_grid_buy_cost_daily`
- `sensor.deye_grid_buy_cost_weekly`
- `sensor.deye_grid_buy_cost_monthly`
- `sensor.deye_grid_sell_value_daily`
- `sensor.deye_grid_sell_value_weekly`
- `sensor.deye_grid_sell_value_monthly`
- `sensor.deye_pv_value_daily`
- `sensor.deye_pv_value_weekly`
- `sensor.deye_pv_value_monthly`
- `sensor.deye_battery_support_value_daily`
- `sensor.deye_battery_support_value_weekly`
- `sensor.deye_battery_support_value_monthly`

### Template Sensors

Source: `config/includes/deye-soba-dashboard-sensors-template.yaml`

- `sensor.deye_spot_price_buy_now`
- `sensor.deye_spot_price_sell_now`
- `sensor.deye_grid_buy_cost_today`
- `sensor.deye_grid_buy_cost_yesterday`
- `sensor.deye_grid_sell_value_today`
- `sensor.deye_grid_sell_value_yesterday`
- `sensor.deye_pv_value_today`
- `sensor.deye_pv_value_yesterday`
- `sensor.deye_grid_buy_cost_total`
- `sensor.deye_grid_sell_value_total`
- `sensor.deye_pv_value_total`
- `sensor.deye_battery_support_value_today`
- `sensor.deye_battery_support_value_yesterday`
- `sensor.deye_battery_support_value_total`
- `sensor.deye_pv_value_this_week`
- `sensor.deye_pv_value_last_week`
- `sensor.deye_pv_value_this_month`
- `sensor.deye_pv_value_last_month`
- `sensor.deye_grid_buy_cost_this_week`
- `sensor.deye_grid_buy_cost_this_month`
- `sensor.deye_grid_sell_value_this_week`
- `sensor.deye_grid_sell_value_this_month`
- `sensor.deye_battery_support_value_this_week`
- `sensor.deye_battery_support_value_this_month`
- `sensor.deye_house_load_live`
- `sensor.deye_grid_import_live`
- `sensor.deye_grid_export_live`
- `sensor.deye_pv_live`
- `sensor.deye_battery_live`
- `sensor.deye_consumption_today_live`
- `sensor.deye_consumption_yesterday`
- `sensor.deye_grid_bought_today_live`
- `sensor.deye_grid_bought_yesterday`
- `sensor.deye_grid_sold_today_live`
- `sensor.deye_grid_sold_yesterday`
- `sensor.deye_pv_today_live`
- `sensor.deye_pv_yesterday`
- `sensor.deye_battery_charge_today_live`
- `sensor.deye_battery_charge_yesterday`
- `sensor.deye_battery_discharge_today_live`
- `sensor.deye_battery_discharge_yesterday`

## Required Helper Entities

These entities are referenced by automations and should exist in the live Home
Assistant setup. Some are documented for UI/manual creation rather than being
created by the current config mirror.

### EV And Voltage Helpers

Source: `config/includes/deye-ev-helpers.yaml`

- `input_datetime.deye_ev_charge_end_time`
- `counter.deye_ev_webhook_count`
- `input_number.deye_previous_voltage`
- `input_number.deye_voltage_lockout_until`
- `input_boolean.deye_voltage_lockout_active`
- `input_boolean.deye_critical_voltage_recovery_lock`
- `input_select.deye_recovery_mode`

### Rescue And Coordination Helpers

Source: `config/deye-helpers.md`

- `input_number.deye_rescue_count_6h`
- `input_datetime.deye_last_rescue_time`
- `input_boolean.deye_rescue_active`
- `input_boolean.deye_ev_charging_active`
- `input_boolean.deye_critical_voltage_recovery_lock`
- `input_select.deye_recovery_mode`
- `input_number.deye_load_previous`
- `input_text.deye_discharge_zone`

## Optional Include Entities

These are defined in repo include files but are not currently wired into the
active `config/configuration.yaml` mirror.

### Load Smoothing Sensor

Source: `config/includes/deye-load-helpers.yaml`

- `sensor.house_load_avg_15m`

## Practical Usage

For dashboards and summaries, the most useful custom entities are usually:

- `sensor.deye_pv_value_today`
- `sensor.deye_pv_value_yesterday`
- `sensor.deye_pv_value_this_week`
- `sensor.deye_pv_value_last_week`
- `sensor.deye_pv_value_this_month`
- `sensor.deye_pv_value_last_month`
- `sensor.deye_grid_buy_cost_today`
- `sensor.deye_grid_sell_value_today`
- `sensor.deye_battery_support_value_today`
- `sensor.deye_house_load_live`
- `sensor.deye_grid_import_live`
- `sensor.deye_grid_export_live`
- `sensor.deye_pv_live`
- `sensor.deye_battery_live`

## Related Files

- `config/configuration.yaml` — Main Home Assistant config mirror.
- `config/automations.yaml` — Main Home Assistant automations mirror.
- `config/includes/` — Include fragments loaded by the config mirror.
- `deye-battery-rescue/` — Deye automation source files and rescue docs.
- `deye-analytics/` — Deye monitoring and economics automation source files.
- `ecodan/` — Heat pump automation source, samples, and strategy notes.