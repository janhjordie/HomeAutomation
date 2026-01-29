# Home Automation Copilot Instructions

## System Architecture Overview

This repository manages a **Home Automation system** with two main components:

### 1. **Deye Battery Protection System** (Home Assistant)
- **Purpose:** Prevent battery deep-discharge and voltage collapse on a Deye 12kW Hybrid 3-phase inverter with Rosen Batt 48V 10kW battery
- **Root Problem:** Rosen Batt BMS doesn't communicate power limits to Deye inverter → F58 errors, excessive discharge at low SOC
- **Solution:** Real-time SOC-based power limiting via 3-tier automation priority system
- **Critical Period:** 17:00-23:00 (high electricity prices + peak loads + heat pump + cooking)
- **Data Flow:** Real-time sensor inputs → 3-tier automation priority → Modbus TCP writes → Inverter control

### 2. **Heat Pump Integration** (Homey → Home Assistant)
- **System:** Mitsubishi Ecodan 8kW air-to-water heat pump
- **Purpose:** Adaptive flow temperature based on outdoor temp and battery state
- **Communication:** Homey Pro (local) → Home Assistant webhooks (cloud) → CSV logging
- **Dependency:** One-way only; no reverse control yet

---

## Priority Automation Hierarchy

**Three independent automations with strict priority blocking (all in `/HomeAssistant/deye-battery-rescue/`):**

| Priority | Automation | File | Current Version | Key Trigger |
|----------|-----------|------|-----------------|--------------|
| **0️⃣ AUTHORITY** | SOC Curve (Always Enforced) | `deye-rescue-02-discharge-cap.yaml` | v1.0.2 | **Discharge entity writes + every 30sec** |
| **1** | EV Charge Guard | `deye-rescue-03-ev-guard.yaml` | v1.0.0 | EV charging webhook |
| **2** | Voltage Rescue (Panic) | `deye-rescue-01-panic.yaml` | v1.0.2 | 6 voltage thresholds + SOC < 20% |

**⚠️ CRITICAL CHANGE (v1.0.2):**
- **Deye-02 is now AUTHORITATIVE** — discharge ALWAYS follows SOC curve, no exceptions
- **Enforcement every 30 seconds** (was 1 minute) — catches any violations faster
- **No blocking by rescue/EV flags** — SOC curve is the floor that even emergency modes respect
- **Deye-01 cleanup now sets discharge safely** using the SOC curve calculation, then Deye-02 enforces it

**How it works:**
1. Deye-01 (rescue) calculates SOC-based limit during cleanup
2. Deye-01 sets discharge to min(seasonal_limit, SOC_limit)
3. Deye-02 immediately triggers on that change
4. **Deye-02 enforces the actual SOC curve** — always the authoritative source
5. Every 30 seconds, Deye-02 re-checks to catch any drift (SolarBalance interference)

---

## SOC-Based Power Limiting (Deye-02 Core Logic)

**Linear relationship: 80W power reduction per 1% SOC decrease**
```
50% SOC → 2500W max (~52A @ 48V)
40% SOC → 1700W max (~35A @ 48V)  ← Recovery threshold
25% SOC → 600W max  (~13A @ 48V)  ← Min power for sustained discharge
```

**Formula in automation:**
```yaml
power_limit = 600 + (soc - 25) * 80  # Between 25-50% SOC
# At 50% SOC: 600 + (50-25)*80 = 2600W ≈ 2500W
# At 40% SOC: 600 + (40-25)*80 = 1800W ≈ 1700W (recovery point)
```

---

## Voltage Rescue Thresholds (Deye-01)

**All in `deye-rescue-01-panic.yaml` triggers section (hardcoded, no config file):**

| Voltage | Condition | Delay | Action |
|---------|-----------|-------|--------|
| **< 47.2V** | Emergency (idle, any power) | instant | Grid charge 10A + discharge 10A max |
| **< 47.8V** | Panic (instant) | instant | Same as emergency |
| **< 48.0V** | Hard rescue (any load) | 5 sec | Same as emergency |
| **< 49.2V** | Preemptive (load > 2400W) | 20 sec | Same as emergency |
| **< 49.4V** | Preemptive (batt discharge > 1500W) | 15 sec | Same as emergency |
| **< 49.6V** | Preemptive (batt discharge > 2500W) | 10 sec | Same as emergency |
| **< 48.3V** | Soft learned (dynamic, usually) | 2 min | Same as emergency |

**SOC Trigger:** If SOC < 20% and voltage rising:
- Aggressive pre-rescue at 49.5V (prevents later emergency)
- Logs frequency to `input_number.deye_rescue_count_6h` for trend analysis

---

## Helper Entities (in `/deye-infra/deye-helpers.md`)

**Priority Control Flags:**
- `input_boolean.deye_rescue_active` — Set ON during Deye-01 rescue (blocks Deye-02 completely)
- `input_boolean.deye_ev_charging_active` — Set ON by Deye-03 EV webhook (blocks Deye-02 completely)

**Analytics & Adaptive Learning:**
- `input_number.deye_rescue_count_6h` — Tracks rescues in rolling 6-hour window (reset by Deye-04 every 6h)
- `input_number.deye_trig_volt_soft_learned` — Adaptive soft trigger voltage learned from pattern analysis
- `input_text.deye_discharge_zone` — Current zone name ("morning", "evening", etc.) for SOC curve adjustment

---

## Developer Workflows

### Home Assistant Automations (YAML in `/HomeAssistant/deye-battery-rescue/`)

**🚨 CRITICAL VERSIONING RULE:**
- ALWAYS increment PATCH version in `alias:` on EVERY change (even typos or 1-line fixes)
- Format: `"Deye-Rescue-XX vX.Y.Z: Description"` → increment only Z: `1.0.0 → 1.0.1 → 1.0.2`
- Update version in notification titles too if they display it
- NO EXCEPTIONS — this is for audit trail + preventing accidental rollbacks

**Standard Edit Workflow:**
1. Edit YAML directly (files auto-reload) or use Home Assistant UI (Settings → Automations)
2. Validate syntax: `python3 -c "import yaml; yaml.safe_load(open('file.yaml'))"` (indentation is CRITICAL)
3. Test trigger: Developer Tools → Automations → Select automation → Test Trigger
4. Check sequence: Automation detail page → Trace tab (shows action execution order)
5. Deploy: UI changes need "Reload Automations"; YAML files auto-reload

**Key Files:**
- `deye-rescue-01-panic.yaml` — Voltage triggers, rescue sequencing, grid charging logic
- `deye-rescue-02-discharge-cap.yaml` — SOC power limiting, instant enforcement
- `deye-rescue-03-ev-guard.yaml` — EV charging guard, discharge kill-switch
- `deye-rescue-04-counter-reset.yaml` — Reset 6-hour rescue counter for rolling window (no-op for normal work)

### Monitoring & Analytics (`/HomeAssistant/deye-analytics/`)
- `deye-monitor-01-logging.yaml` — **1-minute CSV logging** of all battery/automation state (essential for conflict diagnosis)
- `deye-monitor-02-csv-rotate.yaml` — Yearly cleanup of old logs
- `deye-analytics-01-learn-voltage.yaml` — Adaptive learning of soft trigger voltage
- `deye-analytics-02-season-notify.yaml` — Seasonal change notifications

**CSV Output:** `/HomeAssistant/deye_weekly_log.csv` — use for post-incident analysis

### Homey Scripts (JavaScript in `/Homey/`)
- **Deployment:** Edit in Homey mobile app → Flows → Scripts
- **Testing:** Homey Pro → Settings → Debugging (check logs after triggering flow)
- `HA_Integration.js` — Webhook POST helper for MELCloud heat pump data
- `SendEVWebhook.js` — POST to Home Assistant webhook when Easee EV charging starts/stops

**Webhook Format (must match Home Assistant automation):**
```javascript
// POST to: http://homeassistant.local:8123/api/webhook/deye_ev_start_easee
{
  "action": "start",  // or "stop"
  "timestamp": 1234567890,
  "power_kw": 7.5
}
```

---

## Key Patterns & Conventions

### 1. Safe Float Defaults in Jinja2
Always guard state access with float filters:
```yaml
# Missing/unknown states treated safely:
{{ states('sensor.voltage') | float(999) }}  # High default (won't trigger low-volt rescue)
{{ states('sensor.power') | float(0) }}      # Zero default (safe for power/current)
{{ states('sensor.soc') | float(50) }}       # Reasonable default (50% SOC)
```

### 2. Template Trigger Multi-Conditions
```yaml
- trigger: template
  value_template: |
    {{ (states('sensor.solarcust0186_battery_voltage') | float(999)) < 49.2
       and (states('sensor.solarcust0186_load_totalpower') | float(0)) > 2400 }}
  for: "00:00:20"  # Additional delay AFTER condition becomes true
```

### 3. Mode Queuing for Overlapping Triggers
```yaml
mode: queued
max: 10  # Prevents lost events when voltage + discharge triggers fire simultaneously
```

### 4. Variables Section (Calculated Once, Used Everywhere)
```yaml
variables:
  is_winter: "{{ (now().month) in [10,11,12,1,2,3] }}"
  DISCHARGE_A: "{{ 60 if is_winter else 90 }}"
  rescue_active: "{{ is_state('input_boolean.deye_rescue_active','on') }}"
```
Calculated in variables → referenced in all conditions/choose/notifications (efficient)

### 5. Choose/When for Multi-Branch Logic
```yaml
- choose:
    - conditions: [...]  # IF
      sequence: [...]    # THEN
    - conditions: [...]  # ELSE IF
      sequence: [...]    # THEN
  default: [...]         # ELSE (when no conditions match)
```

### 6. Blocking Pattern (Higher Priority Automation)
```yaml
conditions:
  - condition: state
    entity_id: input_boolean.deye_rescue_active
    state: "on"
    # If rescue is ON, this automation does NOT run
```
Used in Deye-02 to respect higher-priority rescues; if rescue_active=on, SOC limiter skips

---

## Cross-Component Communication

### HA → Deye Inverter (Modbus TCP via SolarCustom)
- **Protocol:** Modbus TCP (SolarCustom integration reads from inverter)
- **Update Cycle:** Our automations override SolarBalance settings every 30s
- **Write Entities:**
  - `number.solarcust0186_maximum_battery_discharge_current` (0-100A)
  - `switch.solarcust0186_grid_charge` (on/off)
  - `number.solarcust0186_maximum_battery_charge_current` (0-20A)

### Homey → HA Webhooks
- **EV Charging:** POST to `webhook_id: deye_ev_start_easee` (Start/Stop event)
- **MELCloud Heat Pump:** POST to `webhook_id: melcloud_homey` (Periodic temperature data)
- **Response:** HA automation receives webhook → updates helper entities → triggers cascading automations

### HA → Homey (Device Control)
- Not implemented; one-way communication only (Homey → HA)
- Could add reverse webhook in future for grid_charge feedback to optimize heat pump

---

## Common Maintenance Tasks

### Adding a New Rescue Trigger in Deye-01
1. Add new trigger block with unique `id:` in triggers section
2. Set voltage threshold and delay (`for:` parameter)
3. Verify trigger doesn't conflict with existing thresholds
4. Test: Home Assistant → Developer Tools → Automations → Select Deye-01 → Test Trigger
5. Check Trace tab to confirm trigger fires and sequence executes

### Adjusting SOC Curve (Deye-02)
1. Edit `deye-rescue-02-discharge-cap.yaml` variables section (lines 38-43)
2. Modify these constants:
   - `SOC_MAX`: 50 (SOC at which max power applies)
   - `SOC_MIN`: 25 (SOC at which min power applies)
   - `POWER_MAX`: 2500 (max power in watts at SOC_MAX)
   - `POWER_MIN`: 600 (min power in watts at SOC_MIN)
3. Formula: Linear interpolation between min/max
   - Example: 35% SOC = 600 + ((35-25)/(50-25)) * (2500-600) = 600 + 400 * 10/25 = 1360W
4. **ALWAYS increment version** from v1.0.Z to v1.0.(Z+1) in both alias and notification titles
5. Test: Change SOC manually and watch notifications to confirm curve is enforced

### Seasonal Current Limits (Winter Oct-Mar = 60A, Summer Apr-Sep = 90A)
- Update in Deye-01 `DISCHARGE_NORMAL_WINTER` / `DISCHARGE_NORMAL_SUMMER` variables
- Also in Deye-02 for consistency
- Changes take effect on next rescue or periodic enforcement (1 minute)

### Inspecting CSV Log for Debugging
1. **Location:** `/HomeAssistant/deye_weekly_log.csv`
2. **Generated by:** `deye-monitor-01-logging.yaml` (every minute)
3. **Essential columns:** `soc`, `volt`, `volt_status`, `rescue_active`, `ev_charging_active`, `max_discharge_a`, `soc_limit_a`
4. **Use case:** Find when automation flags activated, what power limits were enforced, rescue frequency

---

## Debugging Checklist

### Rescue Not Triggering
- [ ] Check voltage sensor exists and updates: `sensor.solarcust0186_battery_voltage`
- [ ] Verify helper entity exists: `input_boolean.deye_rescue_active`
- [ ] Test trigger manually: Developer Tools → Automations → Select Deye-01 → Test Trigger
- [ ] Check Trace tab: Click automation → Trace tab → last execution shows conditions/actions in order
- [ ] Verify Modbus connection: `binary_sensor.solarcust0186_connection_status` must be "on"

### Discharge Not Changing (Not Enforcing)
- [ ] Check Deye-02 ran: Inspect trace or check CSV log for `soc_limit_a` values changing
- [ ] Verify blocking flags: If `deye_rescue_active=on` or `deye_ev_charging_active=on`, Deye-02 doesn't run
- [ ] Check entity writable: Try manually set `number.solarcust0186_maximum_battery_discharge_current` via HA UI
- [ ] Check SolarBalance interference: If SoBa is simultaneously writing, you may see thrashing; use CSV log to diagnose

### EV Charge Not Activating
- [ ] Verify Homey flow posts to correct webhook: `deye_ev_start_easee`
- [ ] Check Home Assistant webhook enabled: Settings → Automations & Scenes → Webhooks (should list `deye_ev_start_easee`)
- [ ] Test webhook manually: `curl -X POST http://homeassistant.local:8123/api/webhook/deye_ev_start_easee -H "Content-Type: application/json" -d '{"action":"start"}'`
- [ ] Check Homey logs: Homey Pro → Settings → Debugging (verify flow runs and HTTP POST succeeds)

### Voltage Oscillating (Thrashing)
- **Symptom:** Voltage bounces up/down within 0.5V constantly, rescue keeps cycling on/off
- **Root Cause:** Load spikes (heat pump, cooking) combined with aggressive SOC limits
- **Diagnosis:** Check CSV log during oscillation — note SOC limit and actual discharge vs. target
- **Fix:** Increase SOC curve minimums (higher power at low SOC) or adjust rescue delay times

---

## References
- [SYSTEM-DIAGRAM.md](HomeAssistant/SYSTEM-DIAGRAM.md) — Visual automation priority & voltage curves
- [SYSTEM-GOALS.md](HomeAssistant/SYSTEM-GOALS.md) — Operational objectives & future enhancements
- [MIGRATION-GUIDE.md](MIGRATION-GUIDE.md) — v2.0 consolidation details
- [deye-config.yaml](HomeAssistant/deye-infra/deye-config.yaml) — Centralized constants (reference only)
