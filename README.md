# Home Automation: Deye Hybrid Inverter + Rosen Batt Battery Protection

A **Home Assistant-based solution** to prevent battery degradation and critical F58 errors on a **Deye 12kW Hybrid EU 3-phase inverter** with **Rosen Batt 48V 10kW battery**, integrated with **SolarBalance** for grid support.

## 🎯 What This Solves

### The Problem: F58 Battery Communication Faults

The **Rosen Batt BMS** does not properly communicate power limits to the **Deye inverter**, causing:
- Excessive discharge current at low SOC
- Rapid voltage collapse (47.2V - 49.2V)
- Frequent **F58 errors** (BMS communication fault)
- Battery stress and potential damage

**Other users with Rosen Batt + Deye systems report the same issue** — this is a known protocol incompatibility.

### The Solution: SOC-Based Power Limiting

This automation implements what the BMS should tell the inverter:
- **Monitor battery SOC** in real-time
- **Enforce safe discharge limits** based on SOC curve:
  - 50% SOC: 3000W max (90A @ 48V)
  - 35% SOC: 1880W max (~39A)
  - 25% SOC: 1000W max (21A)
- **Prevent voltage collapse** by limiting current before it happens
- **Eliminate F58 errors** through proactive power management

**Result:** No more critical battery faults. Battery protected at all SOC levels.

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   DEYE HYBRID INVERTER                  │
│                    12kW 3-Phase EU                      │
│          (Modbus TCP via SolarCustom Integration)       │
└──────────────────────────────┬──────────────────────────┘
                               │ (Modbus writes)
                               ↓
         ┌─────────────────────────────────────────┐
         │      HOME ASSISTANT AUTOMATIONS          │
         │  (3-Tier Priority Rescue System)        │
         └─────────────────────────────────────────┘
              ↑              ↑              ↑
              │              │              │
         Priority 1     Priority 2     Priority 3
         ┌─────────┐    ┌─────────┐    ┌─────────┐
         │  EV     │    │ Voltage │    │   SOC   │
         │  Guard  │ >> │ Rescue  │ >> │ Limiter │
         │(Deye-03)│    │(Deye-01)│    │(Deye-02)│
         └────┬────┘    └────┬────┘    └────┬────┘
              │              │              │
              └──────────────┴──────────────┘
                             ↓
            ┌──────────────────────────────┐
            │   ROSEN BATT 48V 10KW        │
            │  (SolarBalance Integration)  │
            └──────────────────────────────┘


SECONDARY: HEATING SYSTEM
┌──────────────────────────────────────────┐
│  Mitsubishi Ecodan 8kW Air-to-Water HP   │
│    (MELCloud via Homey Pro Webhook)      │
└─────────────────┬───────────────────────┘
                  │ (HTTP webhook)
           ┌──────┴───────┐
           ↓              ↑
     ┌──────────────┐ ┌─────────┐
     │  Homey Pro   │→│   HA    │
     │ (Flow Logic) │ │ (HA UI) │
     └──────────────┘ └─────────┘
        (Local)        (Webhook)
```

### Heating Integration
- **Heat Pump:** Mitsubishi Ecodan 8kW air-to-water
- **Connectivity:** MELCloud API → Homey Pro → Home Assistant webhook
- **Function:** Adaptive flow temperature based on SOC and outdoor temp
- **Purpose:** Optimize heating when battery high, reduce load when battery low

### Three-Tier Automation Priority

| Priority | Automation | File | Purpose |
|----------|-----------|------|---------|
| **1** | **EV Charge Guard** | `deye-rescue-03-ev-guard.yaml` | Stop discharge (0A) when EV charging |
| **2** | **Panic/Voltage Rescue** | `deye-rescue-01-panic.yaml` | Emergency: Grid charge + limit discharge when voltage critical |
| **3** | **SOC Limiter** | `deye-rescue-02-discharge-cap.yaml` | Continuous: Enforce SOC-based power curve |

Each automation respects higher priorities — no conflicts.

---

## 📊 SOC Power Curve (Deye-02)

**Linear relationship: 80W per 1% SOC**

```
SOC%  │ Power (W) │ Current @ 48V (A)
──────┼───────────┼──────────────────
50%   │ 3000W     │ 62.5A → capped at 60A (winter) / 90A (summer)
45%   │ 2400W     │ 50A
40%   │ 1800W     │ 37.5A
35%   │ 1400W     │ 29A
30%   │ 1200W     │ 25A
25%   │ 1000W     │ 21A (hard floor)
<25%  │ 1000W     │ 21A (constant)
```

**Seasonal Adjustments:**
- **Winter (Oct-Mar):** Base 60A (conservative)
- **Summer (Apr-Sep):** Base 90A (aggressive)

**Voltage Protection Thresholds (Deye-01):**
- 50.2V: Stop rescue (complete)
- 49.6V: Preemptive limit with load (Deye-02 + Deye-01)
- 49.2V: Preemptive limit with discharge + load
- 49.0V: Deep rescue (hard limit 10A)
- 47.8V: Panic (instant grid charge)
- 47.2V: Emergency guard (no load needed)

---

## 🛠️ Hardware Setup

**Inverter:**
- Deye Hybrid EU 3-phase (12kW)
- Firmware: Latest (check regularly)
- Connection: Modbus TCP via SolarCustom Home Assistant integration

**Battery:**
- Rosen Batt 48V 10kW LiFePO4
- BMS firmware: Check for updates (may not fix protocol issue)
- Communication: CAN-bus to inverter (unreliable)

**Grid Support:**
- SolarBalance platform (https://solarbalance.dk/)
- Updates inverter settings every 1-15 minutes
- Our automations override its discharge settings when needed

**Secondary (Optional):**
- **Mitsubishi Ecodan 8kW air-to-water heat pump** 
- Integration via **Homey Pro webhook** (MELCloud API)
- Adaptive flow temperature control:
  - High SOC (>60%): Full heating power
  - Medium SOC (40-60%): Moderate heating
  - Low SOC (<40%): Reduced heating (protect battery)
- Data pipeline: MELCloud API → Homey Pro flow → Home Assistant webhook → CSV logging

---

## 🚀 Deployment

### Prerequisites
- Home Assistant (2024.1+)
- SolarCustom integration (Modbus TCP)
- YAML automations enabled

### Installation

1. **Copy automation files:**
   ```bash
   # Battery rescue automations
   cp -r deye-battery-rescue/ ~/.config/homeassistant/automations/
   
   # Analytics & monitoring
   cp -r deye-analytics/ ~/.config/homeassistant/automations/
   ```

2. **Create helper entities** (Settings → Devices & Services → Helpers):
   ```yaml
   input_boolean:
     deye_rescue_active: "Rescue mode active"
     deye_ev_charging_active: "EV charging active"
   
   input_number:
     deye_rescue_count_6h: "Rescue count (6h window)"
     deye_load_previous: "Previous load power"
   
   input_text:
     deye_discharge_zone: "Current discharge zone"
   ```

3. **Reload automations:**
   - Settings → Automations & Scenes → Reload automations

4. **Test:**
   - Use Developer Tools → Automations → Trigger
   - Watch notifications appear in Home Assistant
   - Monitor voltage/discharge in Deye UI

---

## 📋 Key Files

### Battery Protection
- **[deye-rescue-01-panic.yaml](HomeAssistant/deye-battery-rescue/deye-rescue-01-panic.yaml)** — Voltage-based emergency rescue (Priority 2)
- **[deye-rescue-02-discharge-cap.yaml](HomeAssistant/deye-battery-rescue/deye-rescue-02-discharge-cap.yaml)** — SOC-based limiter (Priority 3) ⭐ **Main solution**
- **[deye-rescue-03-ev-guard.yaml](HomeAssistant/deye-battery-rescue/deye-rescue-03-ev-guard.yaml)** — EV charge blocker (Priority 1)
- **[deye-rescue-04-counter-reset.yaml](HomeAssistant/deye-battery-rescue/deye-rescue-04-counter-reset.yaml)** — Rescue frequency tracking

### Configuration
- **[deye-helpers.md](HomeAssistant/deye-infra/deye-helpers.md)** — Required Home Assistant helpers
- **[deye-config.yaml](HomeAssistant/deye-infra/deye-config.yaml)** — Centralized constants

### Analytics & Monitoring
- **[deye-analytics-01-learn-voltage.yaml](HomeAssistant/deye-analytics/deye-analytics-01-learn-voltage.yaml)** — Adaptive voltage thresholds
- **[deye-monitor-01-logging.yaml](HomeAssistant/deye-analytics/deye-monitor-01-logging.yaml)** — CSV activity logging

### Heat Pump Integration
- **[ecodan-webhook-handler.yaml](HomeAssistant/ecodan/ecodan-webhook-handler.yaml)** — MELCloud data pipeline from Homey Pro
- **[ecodan_curve_samples.csv](HomeAssistant/ecodan/ecodan_curve_samples.csv)** — Heat pump setpoint curves
- **[ecodan_hourly_summary.csv](HomeAssistant/ecodan/ecodan_hourly_summary.csv)** — Daily heating activity log

### Documentation
- **[SYSTEM-DIAGRAM.md](HomeAssistant/SYSTEM-DIAGRAM.md)** — Visual priority system
- **[SYSTEM-GOALS.md](HomeAssistant/SYSTEM-GOALS.md)** — Operational objectives
- **[.github/copilot-instructions.md](.github/copilot-instructions.md)** — AI agent guidelines

---

## 📈 Monitoring

### Notifications
**Real-time feedback when automation runs:**

- 🔵 **Deye-02 Triggered** — Automation fired, showing SOC limit calculation
- ✅ **Deye-02 Enforced** — Discharge current was changed to comply with SOC limit
- ⏭️ **Deye-02 Skipped** — Already at correct limit, no change needed

**Key info shown:**
- Current SOC % and power limit
- Discharge current before/after
- Priority flags (Rescue/EV/Connection status)

### Logging
- **CSV files** (HomeAssistant/ecodan/) — Daily activity log
- **Home Assistant Traces** — Detailed automation execution log
- **Deye UI** — Real-time inverter metrics (voltage, current, power)

### Debugging
Check [.github/copilot-instructions.md](.github/copilot-instructions.md) for troubleshooting checklists.

---

## 🔄 How It Works

### Step 1: Monitor (Every Second)
- Deye inverter sends sensor updates via Modbus TCP
- Home Assistant reads: SOC, voltage, discharge current, load power
- SolarBalance updates inverter settings (overrides our values periodically)

### Step 2: Calculate (When Triggered)
Deye-02 fires on:
- Discharge current changes (ANY value)
- SOC changes
- Every 1 minute (backup check)

**Calculation:**
```jinja
soc_power_limit = POWER_MIN + ((SOC - 25) / (50 - 25)) * (POWER_MAX - POWER_MIN)
soc_limit_a = min(base_cap, soc_power_limit / 48)
```

### Step 3: Enforce (If Mismatch)
```
If current_discharge ≠ soc_limit_a:
  → Set discharge = soc_limit_a
  → Notify (enforcement happened)
Else:
  → Notify (already correct)
```

### Step 4: Monitor Again
SolarBalance may change discharge again → Deye-02 triggers → Corrects it

**Result:** Tight feedback loop prevents voltage collapse

---

## ⚠️ Important Notes

### Version Management
- All automations start at **v1.0.0**
- **Always increment PATCH version on changes** (1.0.0 → 1.0.1 → 1.0.2)
- No major/minor version bumps (for internal use only)

### YAML Validation
Before deploying, **always validate YAML:**
```bash
python3 -c "import yaml; yaml.safe_load(open('file.yaml'))"
# or online: https://www.yamllint.com/
```

### SolarBalance Compatibility
This automation **coexists with SolarBalance**:
- SolarBalance updates inverter every 1-15 minutes (grid optimization)
- Our automations override when needed (battery protection)
- No conflicts — ours are faster and higher priority

### Testing the Solution
1. **Wait for low SOC** (below 35%) during high load
2. **Watch notifications** — Deye-02 will enforce limit
3. **Check inverter** — Discharge current drops to calculated limit
4. **Verify voltage** — Should stay above 49V (no F58 errors)

---

## 📞 Support & Community

This solution addresses a **known Rosen Batt + Deye protocol issue**. If you have:
- **Same hardware:** This should work out-of-the-box
- **Similar systems:** Adapt the SOC curve to your battery specs
- **Questions:** Check the [debugging checklists](.github/copilot-instructions.md#debugging-checklist)

**Contribute improvements** via pull requests or issues.

---

## 📄 License

This repository is shared to help others with Deye hybrid inverters and Rosen Batt batteries. Use at your own risk.

---

## 🔗 References

- [Deye Hybrid Inverter Docs](https://deye.com/)
- [Rosen Batt Battery](https://rosenbatt.com/)
- [SolarBalance Platform](https://solarbalance.dk/)
- [Home Assistant Documentation](https://www.home-assistant.io/)
- [Mitsubishi Ecodan Heat Pump](https://www.mitsubishielectric.co.uk/en-gb/products/heating-cooling/air-water-heat-pump-systems/ecodan)
- [MELCloud API (Homey Integration)](https://www.melcloud.com/)
- [Homey Pro Smart Hub](https://homey.app/)

---

**Last Updated:** January 2026  
**Current Version:** 1.0.0  
**Status:** Production-Ready
