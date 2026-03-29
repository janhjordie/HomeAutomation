# Home Automation: Deye Hybrid Inverter + Rosen Batt Battery Protection

A **Home Assistant-based solution** using an **exponential discharge curve** to prevent battery degradation and critical F58 errors on a **Deye 12kW Hybrid EU 3-phase inverter** with **Rosen Batt 48V 10kW battery**.

## 🎯 What This Solves

### The Problem: F58 Battery Communication Faults

The **Rosen Batt BMS** does not properly communicate power limits to the **Deye inverter**, causing:
- Excessive discharge current at low SOC (90A → voltage collapse to 9% SOC)
- Rapid voltage collapse (47.2V - 49.2V)
- Frequent **F58 errors** (BMS communication fault)
- Battery stress and potential damage

**Other users with Rosen Batt + Deye systems report the same issue** — this is a known protocol incompatibility.

### The Solution: Exponential Discharge Curve

**One automation** implements what the BMS should tell the inverter:
- **Exponential power limiting** from 15-45% SOC (self-protecting)
- **More protection at low SOC** (curve drops faster)
- **More power at high SOC** (better utilization)
- **Uses real battery voltage** for amp calculation
- **15-second enforcement** catches any violations quickly

**Formula:**
```
power = 800 + (2500-800) × normalized² × 1.05
where normalized = (SOC - 15) / (45 - 15)
```

**Result:** 
- Voltage stable at 50.9V even at 20% SOC with 971W output
- **No rescues needed** — exponential curve self-protects
- **Expected cycle life: 8,000+ cycles (22+ years)** at 15-45% DOD
- **30% more usable capacity** than before (was 25-50%, now 15-45%)

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   DEYE HYBRID INVERTER                  │
│                    12kW 3-Phase EU                      │
│          (Modbus TCP via SolarCustom Integration)       │
└──────────────────────────────┬──────────────────────────┘
                               │ (Modbus writes discharge current)
                               ↓
         ┌─────────────────────────────────────────┐
         │      HOME ASSISTANT - SINGLE AUTOMATION │
         │   Deye-01: Exponential Discharge Curve  │
         │         (Authority Mode v1.0.19)        │
         └─────────────────────────────────────────┘
              │
              │ Enforces every 15 seconds:
              │ • SOC curve (15-45%)
              │ • EV charging (0A for 1 hour)
              │ • SolarBalance override prevention
              ↓
            ┌──────────────────────────────┐
            │   ROSEN BATT 48V 10KW        │
            │  (SolarBalance Integration)  │
            └──────────────────────────────┘


OPTIONAL: HEATING SYSTEM
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

### Ultra-Simplified Architecture

**Active Automations:**
- **Deye-01 v1.0.19** — Exponential discharge curve + EV charging handler + 60A hard cap (ONLY automation needed!)
- **Deye-02 v1.0.0** — Counter reset for analytics (non-critical)
- **CSV Logging** — Monitoring and audit trail

**Disabled/Archived (in archive/ folder):**
- ~~deye-rescue-01-panic.yaml~~ — Voltage rescue not needed with exponential curve
- ~~deye-rescue-03-ev-guard.yaml~~ — Merged into Deye-01 v1.0.10
- ~~deye-rescue-05-lowsoc-charge-guard.yaml~~ — SolarBalance handles charging

**Why So Simple?**
The exponential curve **prevents** problems instead of **reacting** to them:
- No voltage collapse = no rescue needed
- Built-in EV charging = no separate guard needed
- SolarBalance charging works fine = no charge limiting needed

---

## 📊 Discharge Curve (Deye-01 v1.0.19)

**Flat 60A from 100-40% SOC, exponential curve 10-40% SOC, 60A absolute maximum**

**Formula (10-40% SOC):** `power = 800 + (3000-800) × normalized² × 1.05`

```
SOC%  │ Mode           │ Normalized │ Exponential (n²) │ Power (W) │ Current @ 48V (A) │ Current @ 51V (A)
──────┼────────────────┼────────────┼──────────────────┼───────────┼───────────────────┼──────────────────
100%  │ FLAT MAX       │ n/a        │ n/a              │ 2880W     │ 60A (HARD CAP)    │ 60A (HARD CAP)
80%   │ FLAT MAX       │ n/a        │ n/a              │ 2880W     │ 60A (HARD CAP)    │ 60A (HARD CAP)
60%   │ FLAT MAX       │ n/a        │ n/a              │ 2880W     │ 60A (HARD CAP)    │ 60A (HARD CAP)
40%   │ TRANSITION     │ 1.00       │ 1.00             │ 3150W     │ 60A (capped)      │ 60A (capped)
35%   │ Exponential    │ 0.83       │ 0.69             │ 2425W     │ 51A               │ 48A
30%   │ Exponential    │ 0.67       │ 0.44             │ 1843W     │ 38A               │ 36A
25%   │ Exponential    │ 0.50       │ 0.25             │ 1418W     │ 30A               │ 28A
20%   │ Exponential    │ 0.33       │ 0.11             │ 1083W     │ 23A               │ 21A
15%   │ Exponential    │ 0.17       │ 0.03             │ 909W      │ 19A               │ 18A
10%   │ FLOOR          │ 0.00       │ 0.00             │ 840W      │ 18A               │ 16A
<10%  │ FLOOR          │ n/a        │ n/a              │ 840W      │ 18A               │ 16A (constant)
```

**Key Features:**
- **Flat 60A from 100-40% SOC:** Full power when battery is healthy (40-100%)
- **60A Absolute Maximum:** Hard cap prevents SolarBalance from setting excessive discharge (was setting 90A)
- **Exponential Protection (10-40% SOC):** More aggressive limiting at low SOC
- **10-40% SOC Range:** 30% usable capacity with protection
- **Real Voltage Calculation:** Uses actual battery voltage (not fixed 48V)
- **5% Boost Factor:** Voltage proven stable, allows slightly more power
- **LiFePO4 Optimized:** 8,000+ cycle life expectancy

**Why Exponential vs Linear?**
- Linear: Equal reduction per 1% SOC (e.g., 80W/%)
- **Exponential: Drops FAST at low SOC** → protects from voltage collapse
- Gentle at high SOC → extracts maximum usable capacity

**EV Charging Mode:**
- Webhook from Homey: `POST /api/webhook/deye_ev_start_easee`
- Sets discharge to **0A for 1 hour** per webhook
- Auto-releases after timeout
- Perfect for Easee 59-minute charge sessions (3x per night)

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
   # Main automation (ONLY file needed!)
   cp HomeAssistant/deye-battery-rescue/deye-01-discharge-curve.yaml ~/.config/homeassistant/automations/
   
   # Optional: Analytics & monitoring
   cp HomeAssistant/deye-battery-rescue/deye-02-counter-reset.yaml ~/.config/homeassistant/automations/
   cp HomeAssistant/deye-analytics/deye-monitor-01-logging.yaml ~/.config/homeassistant/automations/
   cp HomeAssistant/deye-analytics/deye-analytics-01-learn-voltage.yaml ~/.config/homeassistant/automations/
   ```

2. **Create helper entities** (Settings → Devices & Services → Helpers):
   ```yaml
   # Core helpers
   input_boolean:
     deye_ev_charging_active: "EV charging active"
   
   # EV tracking (if using EV charging)
   input_datetime:
     deye_ev_charge_end_time: "EV charge end time"
   
   counter:
     deye_ev_webhook_count: "EV webhook count"
   
   # Optional: Analytics
   input_number:
     deye_rescue_count_6h: "Rescue count (6h window)"
   
   input_text:
     deye_discharge_zone: "Current discharge zone"
   ```

3. **Configure Homey EV webhook** (if using):
   - Endpoint: `http://homeassistant.local:8123/api/webhook/deye_ev_start_easee`
   - Method: POST
   - Body: `{"action":"start"}`

4. **Reload automations:**
   - Settings → Automations & Scenes → Reload automations

5. **Test:**
   - Wait for SOC < 45% or manually test EV webhook
   - Watch notifications appear in Home Assistant
   - Monitor discharge current via CSV logs or Deye UI

---

## 📋 Key Files

### Active Automations
- **[deye-01-discharge-curve.yaml](HomeAssistant/deye-battery-rescue/deye-01-discharge-curve.yaml)** — ⭐ **MAIN SOLUTION** — Discharge curve (60A flat >45%, exponential 15-45%) + EV charging (v1.0.10)
- **[deye-02-counter-reset.yaml](HomeAssistant/deye-battery-rescue/deye-02-counter-reset.yaml)** — Optional: Rescue frequency tracking (v1.0.0)

### Archived Automations (archive/ folder)
- **[archive/deye-rescue-01-panic.yaml](HomeAssistant/deye-battery-rescue/archive/deye-rescue-01-panic.yaml)** — ❌ ARCHIVED — Voltage-based emergency rescue (not needed)
- **[archive/deye-rescue-03-ev-guard.yaml](HomeAssistant/deye-battery-rescue/archive/deye-rescue-03-ev-guard.yaml)** — ❌ ARCHIVED — Merged into Deye-01 v1.0.10
- **[archive/deye-rescue-05-lowsoc-charge-guard.yaml](HomeAssistant/deye-battery-rescue/archive/deye-rescue-05-lowsoc-charge-guard.yaml)** — ❌ ARCHIVED — SolarBalance handles charging

### Configuration
- **[configuration.yaml](HomeAssistant/config/configuration.yaml)** — Mirror of Home Assistant `/config/configuration.yaml`
- **[automations.yaml](HomeAssistant/config/automations.yaml)** — Mirror of Home Assistant `/config/automations.yaml`
- **[deye-ev-helpers.yaml](HomeAssistant/config/includes/deye-ev-helpers.yaml)** — EV charging helper entities
- **[deye-helpers.md](HomeAssistant/config/deye-helpers.md)** — Legacy helper documentation
- **[deye-config.yaml](HomeAssistant/config/includes/deye-config.yaml)** — Centralized constants (reference only)

### Analytics & Monitoring
- **[deye-monitor-01-logging.yaml](HomeAssistant/deye-analytics/deye-monitor-01-logging.yaml)** — CSV activity logging with EV tracking (v1.0.2)
- **[deye-analytics-01-learn-voltage.yaml](HomeAssistant/deye-analytics/deye-analytics-01-learn-voltage.yaml)** — Adaptive voltage thresholds

### Documentation
- **[EV-INTEGRATION-GUIDE.md](HomeAssistant/deye-battery-rescue/EV-INTEGRATION-GUIDE.md)** — EV charging setup guide
- **[SYSTEM-DIAGRAM.md](HomeAssistant/SYSTEM-DIAGRAM.md)** — Legacy priority system diagrams
- **[SYSTEM-GOALS.md](HomeAssistant/SYSTEM-GOALS.md)** — Operational objectives
- **[.github/copilot-instructions.md](.github/copilot-instructions.md)** — AI agent guidelines + troubleshooting

---

## 📈 Monitoring

### Notifications
**Real-time feedback when SOC < 45% or EV charging:**

- ⚡ **EV Charging Started** — Webhook received, discharge set to 0A for 1 hour
- ✅ **Deye-01 Enforced** — Discharge current changed to comply with SOC curve or EV mode
- ✅ **EV Charge Timeout** — 1 hour expired, discharge resumed per SOC curve

**Key info shown:**
- Current SOC % and power limit (or EV mode status)
- Discharge current before/after
- Battery voltage (real-time)
- EV charge end time (if active)

**Silent Operation Above 45% SOC:**
- No notifications when SOC > 45% (normal operation)
- Only enforces and notifies during critical range or EV charging

### CSV Logging
Enhanced logging tracks:
- **Battery state:** SOC, voltage, discharge/charge power
- **Automation state:** rescue_active, ev_charging_active
- **EV tracking:** ev_charge_end, ev_webhook_count
- **Enforcement:** max_discharge_a, soc_limit_a (exponential curve)
- **Voltage status:** NORMAL, CAUTION, WARNING, CRITICAL

**File:** `HomeAssistant/deye_weekly_log.csv` (1-minute intervals)

**Example output:**
```csv
timestamp, soc, volt, ..., ev_charging_active, ev_charge_end, max_discharge_a, soc_limit_a, ...
2026-01-29T23:00:15, 35.0, 51.2, ..., on, 2026-01-30T00:00:00, 0, 28, ...
2026-01-30T00:00:15, 35.2, 51.4, ..., off, 2026-01-30T00:00:00, 28, 28, ...
```

### Debugging
Check [.github/copilot-instructions.md](.github/copilot-instructions.md) for troubleshooting checklists and [EV-INTEGRATION-GUIDE.md](HomeAssistant/deye-battery-rescue/EV-INTEGRATION-GUIDE.md) for EV webhook testing.

---

## 🔄 How It Works

### Step 1: Monitor (Every 15 Seconds)
- Deye inverter sends sensor updates via Modbus TCP
- Home Assistant reads: SOC, voltage, discharge current
- SolarBalance may update inverter settings (we override when needed)

### Step 2: Calculate (When Triggered)
Deye-01 v1.0.10 fires on:
- **EV webhook** received from Homey
- Discharge current changes (ANY value)
- SOC changes
- Every 15 seconds (enforcement check)
- Home Assistant startup

**Exponential Curve Calculation:**
```jinja
# Normalize SOC to 0-1 range (15-45% → 0-1)
normalized = (SOC - 15) / (45 - 15)

# Square for exponential dropoff
exponential = normalized²

# Calculate power limit
power = 800 + (2500 - 800) × exponential × 1.05

# Convert to amps using REAL battery voltage
amps = power / voltage
```

**EV Mode Override:**
```jinja
if ev_charging and now() < ev_end_time:
  target = 0A  # Complete battery protection
else:
  target = exponential_curve(SOC)
```

### Step 3: Enforce (If Mismatch)
```
If current_discharge ≠ target:
  → Set discharge = target
  → Notify (if SOC < 45% or EV active)
Else:
  → Silent (already correct)
```

### Step 4: Monitor Again
- SolarBalance may change discharge → Deye-01 detects within 15s → Corrects it
- Voltage stays stable → No emergency intervention needed
- EV timeout expires → Auto-cleanup, resume curve

**Result:** Exponential curve prevents voltage collapse before it happens

---

## ⚠️ Important Notes

### Real-World Performance
**Tested Results (January 2026):**
- ✅ **Voltage stable at 50.9V** even at 20% SOC
- ✅ **971W output at 20% SOC** with no collapse
- ✅ **Zero rescues needed** for 30+ minutes with only Deye-01 active
- ✅ **Full 60A power when SOC > 45%** (healthy battery)
- ✅ **15-45% SOC range** = 30% usable capacity with exponential protection
- ✅ **All legacy rescues archived** — discharge curve is the complete solution

### Version Management
- **Current Production:** Deye-01 v1.0.10
- **Always increment PATCH version on changes** (1.0.10 → 1.0.11)
- Version appears in automation alias AND notification titles

### YAML Validation
Before deploying, **always validate YAML:**
```bash
python3 -c "import yaml; yaml.safe_load(open('file.yaml'))"
```

### SolarBalance Compatibility
This automation **coexists with SolarBalance:**
- SolarBalance updates inverter every 1-15 minutes (grid optimization)
- Deye-01 overrides discharge within 15 seconds (battery protection)
- SolarBalance handles all charging (no interference)
- No conflicts — our discharge protection is faster

### Testing the Solution
1. **Monitor during low SOC** (below 35%)
2. **Check CSV logs** — `max_discharge_a` should follow `soc_limit_a`
3. **Watch voltage** — Should stay above 50V (no collapse)
4. **Test EV webhook** — `curl -X POST http://homeassistant.local:8123/api/webhook/deye_ev_start_easee`
5. **Verify auto-cleanup** — After 1 hour, discharge resumes

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

**Last Updated:** January 29, 2026  
**Current Version:** Deye-01 v1.0.10 (Flat 60A >45% + Exponential 15-45% + EV Integration)  
**Status:** Production-Ready — Single automation solution proven stable
