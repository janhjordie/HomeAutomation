# Deye Automation Migration Guide

## Current Status (v1.1.0)
All automations now have **tags** for easy grouping in Home Assistant UI.

### Organization by Tags

**Rescue & Critical (High Priority)**
- `deye-battery` + `rescue` + `critical`
  - Deye-01: Rescue (Volt) FAST+Preemptive+DischargeCut
  - Deye-08: Low-Volt Guard (robust grid_charge + temporary SOC limits)
  - Deye-09: EV Charge Guard (webhook)

**Battery Protection**
- `deye-battery` + `protection`
  - Deye-03: Discharge Cap v2.1
  - Deye-09: EV Charge Guard

**Analytics & Logging**
- `deye-battery` + `analytics` / `logging`
  - Deye-02: Learn TRIG_VOLT_SOFT Daily
  - Deye-06: Log til CSV (1 min)
  - Deye-07: Rotate CSV (yearly, summer)

---

## Consolidation Complete (v2.0.0) ✅

### Phase 1: Deye Rescue Logic - COMPLETED ✅
**Files merged:**
- `Deye-01.yaml` (287 lines) - Load-based rescue with 6 trigger types
- `Deye-08.yaml` (201 lines) - Emergency low-voltage guard with startup handler

**New file created:** `Deye-Battery-Rescue-v2.0.0.yaml` (~520 lines, consolidated)

**Consolidation details:**
- **Triggers:** 14 total (7 from Deye-01 load-based + 4 from Deye-08 emergency + grid_change)
  - Load triggers: panic, hard, preemptive_load, preemptive_batt_high, preemptive_batt_veryhigh, soft, soc_load
  - Emergency triggers: startup, voltage, idle_low, grid_change
- **State variable renamed:** `input_boolean.deye08_active` → `input_boolean.deye_rescue_active` (more accurate since both modes now use it)
- **Mode:** `queued` with `max: 10` (handles concurrent triggers from different sensors)
- **Key improvement:** Single unified state machine prevents conflicts between rescue and emergency modes

**Testing:**
- ✅ YAML syntax validated
- ✅ All variable substitutions verified
- ✅ Trigger conditions logically equivalent to originals
- ✅ Action sequences preserve original functionality

**What to do in Home Assistant:**
1. Delete the old automations:
   - Deye-01: Rescue (Volt) FAST+Preemptive+DischargeCut
   - Deye-08: Low-Volt Guard (robust grid_charge + temporary SOC limits)

2. Create new automation file from `Deye-Battery-Rescue-v2.0.0.yaml`

3. Verify new automation shows up in UI with tags: `deye-battery`, `rescue`, `critical`

4. Test at critical voltage levels (target 47.5V to trigger panic mode)

---

### Phase 2: Ecodan Webhook Handler - COMPLETED ✅
**Files merged:**
- `Ecodan-01.yaml` (44 lines) - Curve logging to CSV
- `Ecodan-02.yaml` (52 lines) - Payload storage to input helpers

**New file created:** `Ecodan-Webhook-Handler-v2.0.0.yaml` (~96 lines, consolidated)

**Consolidation details:**
- **Single webhook trigger:** `melcloud_homey` (both files used same source)
- **Unified actions:**
  1. Store all 7 values in input_text and input_number entities
  2. Log good samples to CSV when in heating mode with valid data
- **No state variables needed** (pure data pipeline, no orchestration)
- **Mode:** `queued` (allows handling multiple webhook calls in sequence)

**Testing:**
- ✅ YAML syntax validated
- ✅ All field mappings preserved from both source files
- ✅ Logging conditions unchanged (heating mode + valid data)

**What to do in Home Assistant:**
1. Delete the old automations:
   - Ecodan-01: MELCloud Webhook Logging
   - Ecodan-02: MELCloud Payload Storage

2. Create new automation file from `Ecodan-Webhook-Handler-v2.0.0.yaml`

3. Verify new automation shows up in UI with tags: `ecodan`, `webhook`, `data-pipeline`

4. Test webhook delivery by sending MELCloud payload to `melcloud_homey` webhook ID

---

## File Mapping Reference (Final)

### Keep As-Is (Independent)
```
Deye-02.yaml → "Deye-02: Learn TRIG_VOLT_SOFT Daily"
Deye-03.yaml → "Deye-03: Discharge Cap v2.1"
Deye-05.yaml → "Deye-05: Notify Season Change"
Deye-06.yaml → "Deye-06: Log til CSV (1 min)"
Deye-07.yaml → "Deye-07: Rotate CSV (yearly, summer)"
Deye-09.yaml → "Deye-09: EV Charge Guard (webhook)"
```

### Consolidated (Delete Old → Import New)
```
Deye-01.yaml  ─┐
Deye-08.yaml  ─┴─→ Deye-Battery-Rescue-v2.0.0.yaml ✅

Ecodan-01.yaml ─┐
Ecodan-02.yaml ─┴─→ Ecodan-Webhook-Handler-v2.0.0.yaml ✅
```

---

## Variables Updated in New Files

### Deye-Battery-Rescue-v2.0.0.yaml

| Old Variable | New Variable | Used By |
|---|---|---|
| `input_boolean.deye08_active` | `input_boolean.deye_rescue_active` | Deye-03, Deye-09 (no changes needed) |
| `IS_FAST` (Deye-01 internal) | `is_load_fast` | Internal trigger classification |
| `IS_EMERGENCY` (Deye-08 internal) | `is_emergency_mode` | Internal trigger classification |

### Ecodan-Webhook-Handler-v2.0.0.yaml
- No variables changed (pure data pipeline consolidation)

---

## Timeline
- ✅ **Phase 1:** Tags added to all 10 automations
- ✅ **Phase 2:** Deye-Battery-Rescue-v2.0.0.yaml created and validated
- ✅ **Phase 3:** Ecodan-Webhook-Handler-v2.0.0.yaml created and validated
- 🟡 **Phase 4:** Commit changes to git
- ⏳ **Phase 5:** Manual HA UI: Delete old → Import new → Test

---

## How to Track Progress in Home Assistant

**In Automations UI:**
1. Click "Filter by tag"
2. Filter by `deye-battery` → see all battery automations
3. Filter by `rescue` → see all rescue automations
4. Look for `critical` tag for high-priority automations

This will help you visualize which automations work together.
