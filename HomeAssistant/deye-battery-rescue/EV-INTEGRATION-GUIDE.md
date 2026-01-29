# EV Charging Integration - Deye-02 v1.0.9

## What Changed

**Deye-02 v1.0.9** now handles EV charging logic directly:
- Receives webhook from Homey when EV charging starts
- Sets discharge to **0A for 1 hour** per webhook
- Auto-releases after 1 hour and resumes SOC curve
- Tracks all events in CSV logging

**CSV Logging v1.0.2** enhanced with:
- EV webhook count tracking
- EV charge end time logging
- Discharge enforcement monitoring
- Updated to match Deye-02 v1.0.8 exponential curve (15-45% SOC)

## Setup Required

### 1. Create Helper Entities (via UI or YAML)

**Via Home Assistant UI (Recommended):**
1. Settings → Devices & Services → Helpers → Create Helper
2. Create these helpers:

**Date & Time:**
- Name: `Deye EV Charge End Time`
- Entity ID: `input_datetime.deye_ev_charge_end_time`
- Has date: ✅
- Has time: ✅
- Icon: `mdi:ev-station-clock`

**Counter:**
- Name: `Deye EV Webhook Count`
- Entity ID: `counter.deye_ev_webhook_count`
- Initial: 0
- Restore: ✅
- Icon: `mdi:counter`

**Via YAML (Alternative):**
Add to `configuration.yaml`:
```yaml
input_datetime: !include deye-infra/deye-ev-helpers.yaml
counter: !include deye-infra/deye-ev-helpers.yaml
```

### 2. Homey Webhook (Unchanged)

Your existing webhook script should continue to POST to:
```
http://homeassistant.local:8123/api/webhook/deye_ev_start_easee
```

## How It Works

### EV Charging Session Flow

1. **EV Starts Charging** (e.g., 23:00)
   - Homey sends webhook → Deye-02
   - Deye-02 sets:
     - `input_boolean.deye_ev_charging_active` = ON
     - `input_datetime.deye_ev_charge_end_time` = 00:00 (23:00 + 1 hour)
     - `counter.deye_ev_webhook_count` += 1
     - `discharge = 0A`
   - CSV logs: `ev_charging_active=on, ev_webhook_count=1`

2. **During 1 Hour** (23:00-00:00)
   - Deye-02 enforces `discharge = 0A` every 15 seconds
   - CSV logs every minute: `ev_charging_active=on, max_discharge_a=0`
   - Notifications show: "⚡ EV CHARGING MODE - Discharge: 0A (until 00:00)"

3. **Timeout Expired** (00:00)
   - Deye-02 detects `now() >= ev_charge_end_time`
   - Auto-cleanup:
     - `input_boolean.deye_ev_charging_active` = OFF
     - Notification: "✅ EV Charge Timeout - Discharge will resume per SOC curve"
   - Discharge resumes: SOC curve calculation (e.g., 18A at 25% SOC)

4. **Second Charge Session** (e.g., 01:00)
   - Homey sends another webhook
   - Process repeats, `ev_webhook_count` = 2
   - New end time: 02:00

### CSV Logging Output

**New columns added:**
```csv
timestamp, soc, volt, ..., ev_charging_active, ev_charge_end, ev_webhook_count, max_discharge_a, soc_limit_a, ...
2026-01-29T23:00:15, 35.0, 51.2, ..., on, 2026-01-30T00:00:00, 1, 0, 28, ...
2026-01-29T23:01:15, 35.1, 51.3, ..., on, 2026-01-30T00:00:00, 1, 0, 28, ...
2026-01-30T00:00:15, 35.2, 51.4, ..., off, 2026-01-30T00:00:00, 1, 28, 28, ...
```

**Analysis:**
- `ev_webhook_count` increasing = webhooks received ✓
- `ev_charging_active=on` = EV mode active
- `max_discharge_a=0` during EV charge = enforcement working ✓
- `max_discharge_a` resumes to `soc_limit_a` after timeout = auto-release working ✓

## Testing

### Manual Webhook Test (via curl):
```bash
curl -X POST http://homeassistant.local:8123/api/webhook/deye_ev_start_easee \
  -H "Content-Type: application/json" \
  -d '{"action":"start","power_kw":7.5}'
```

### Expected Result:
1. Notification: "⚡ EV Charging Started - Discharge will be 0A for 1 hour"
2. `sensor.solarcust0186_maximum_battery_discharge_current` = 0A
3. CSV log shows: `ev_charging_active=on, max_discharge_a=0`
4. After 1 hour: Auto-release notification + discharge resumes

## Benefits

✅ **Single Automation:** Deye-02 handles both SOC curve AND EV charging
✅ **1-Hour Timeout:** Protects for Easee's 59-minute charge sessions
✅ **3x Charge Nights:** Each webhook extends protection for 1 hour
✅ **CSV Tracking:** Full audit trail of webhooks and discharge enforcement
✅ **Auto-Cleanup:** No manual intervention needed
✅ **No Deye-03:** Simplified - only Deye-02 needed

## Migration from Deye-03

**Old setup:**
- Deye-03 received webhook
- Set discharge to 0A
- Required manual cleanup or grid power monitoring

**New setup (v1.0.9):**
- Deye-02 receives webhook directly
- Sets discharge to 0A for exactly 1 hour
- Auto-cleanup after timeout
- **You can disable Deye-03** (already done)

## Monitoring

**Check EV integration working:**
1. CSV log: `grep "ev_webhook_count" deye_weekly_log.csv | tail -20`
2. Check helper: `input_datetime.deye_ev_charge_end_time` shows next timeout
3. Check counter: `counter.deye_ev_webhook_count` increments each session
4. Watch discharge: Should be 0A during EV charge, resume after 1 hour

## Version Summary

- **Deye-02:** v1.0.8 → v1.0.9 (added EV webhook + 1-hour timeout)
- **CSV Logging:** v1.0.1 → v1.0.2 (added EV tracking columns)
- **Deye-03:** DISABLED (no longer needed)
