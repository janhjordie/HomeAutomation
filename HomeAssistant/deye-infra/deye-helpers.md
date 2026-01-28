# Deye-Helpers v1.0.0: Helper Entities

Required for adaptive power limiting and rescue coordination.

## Installation in Home Assistant

### Option 1 (Recommended - UI)

1. Go to **Settings → Devices & Services → Helpers**
2. Click **"+ CREATE HELPER"** for each entity below
3. Match the name, min/max, step, and icon exactly

### Option 2 (YAML)

1. Add the definitions below to your `configuration.yaml`, or
2. Create `/config/helpers.yaml` and include it in `configuration.yaml`:
   ```yaml
   input_number: !include helpers.yaml
   input_boolean: !include helpers.yaml
   input_text: !include helpers.yaml
   ```
3. Restart Home Assistant

> **NOTE:** Helper entities CANNOT be created by automations - they must be defined in config files or created through the UI before automations run.

---

## Helper Entity Definitions

### Rescue Frequency Tracking

```yaml
input_number:
  deye_rescue_count_6h:
    name: "Deye Rescue Count (6h)"
    min: 0
    max: 20
    step: 1
    initial: 0
    icon: mdi:counter
```

```yaml
input_datetime:
  deye_last_rescue_time:
    name: "Deye Last Rescue Time"
    has_date: true
    has_time: true
    icon: mdi:clock-alert
```

### State Flags

```yaml
input_boolean:
  deye_rescue_active:
    name: "Deye Rescue Active"
    initial: off
    icon: mdi:battery-alert
```

```yaml
input_boolean:
  deye_ev_charging_active:
    name: "Deye EV Charging Active"
    initial: off
    icon: mdi:ev-station
```

```yaml
input_boolean:
  deye_defrost_detected:
    name: "Deye Heat Pump Defrost Detected"
    initial: off
    icon: mdi:snowflake-alert
```

### Load Tracking

```yaml
input_number:
  deye_load_previous:
    name: "Deye Previous Load"
    min: 0
    max: 10000
    step: 1
    initial: 0
    unit_of_measurement: "W"
    icon: mdi:flash
```

```yaml
input_number:
  deye_defrost_temporary_limit:
    name: "Deye Defrost Temporary Limit"
    min: 0
    max: 100
    step: 1
    initial: 60
    unit_of_measurement: "A"
    icon: mdi:gauge
```

### Zone Tracking

```yaml
input_text:
  deye_discharge_zone:
    name: "Deye Discharge Zone"
    initial: "none"
    icon: mdi:gauge
```

---

## Quick Reference

| Entity ID | Type | Purpose |
|-----------|------|---------|
| `input_number.deye_rescue_count_6h` | Number (0-20) | Tracks rescue events in 6h window for adaptive learning |
| `input_datetime.deye_last_rescue_time` | DateTime | Timestamp of last rescue activation |
| `input_boolean.deye_rescue_active` | Boolean | Indicates rescue mode is active (priority system) |
| `input_boolean.deye_ev_charging_active` | Boolean | Indicates EV charging is active (highest priority) |
| `input_boolean.deye_defrost_detected` | Boolean | Heat pump defrost detection flag |
| `input_number.deye_load_previous` | Number (0-10000W) | Previous load reading for spike detection |
| `input_number.deye_defrost_temporary_limit` | Number (0-100A) | Temporary discharge limit during defrost |
| `input_text.deye_discharge_zone` | Text | Current discharge zone (none/low/deep/super) |
