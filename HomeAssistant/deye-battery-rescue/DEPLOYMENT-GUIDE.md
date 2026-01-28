# Adaptive Power Limiting - Deployment Guide

## 📦 What's New in v4.0.0

This release adds **intelligent adaptive power limiting** to prevent voltage collapse based on real-world usage patterns, without trying to predict specific appliances.

### Key Features

1. **Time-Based Conservative Mode** (17:00-23:00)
   - Applies 0.8x multiplier (20% reduction) during high-risk hours
   - Responds to evening electricity price increases triggering battery discharge
   - Accounts for combined heat pump + cooking loads

2. **Rescue Frequency Adaptive Learning**
   - Tracks rescues in 6-hour rolling window
   - 5% power reduction per rescue (max 20% after 4+ rescues)
   - Self-tunes based on actual system behavior

3. **Load Spike Detection**
   - Detects rapid load increases >2000W
   - Applies temporary 0.7x multiplier (30% reduction)
   - Handles unpredictable heat pump defrost, cooking, etc.

4. **Combined Adaptive Multiplier**
   - Multiplies all three factors: `time × rescue × spike`
   - Example: Evening (0.8) + 2 rescues (0.9) + spike (0.7) = 0.504x (50% reduction)
   - Applies to both POWER_MAX and POWER_MIN in SOC curve

## 📁 Files Updated

```
deye-battery-rescue/
├── deye-00-helpers.yaml          [NEW] - Helper entities
├── deye-01-panic-rescue.yaml     v2.3.0 → v2.4.0
├── deye-02-discharge-cap.yaml    v3.0.0 → v4.0.0
├── deye-03-ev-guard.yaml         v1.0.0 → v1.0.1 (docs only)
└── deye-04-rescue-counter-reset.yaml [NEW]
```

## 🚀 Deployment Steps

### 1. Upload Helper Entities (CRITICAL FIRST)

```bash
# Upload to Home Assistant config directory
scp deye-00-helpers.yaml homeassistant:/config/
```

**Then in Home Assistant UI:**

1. Navigate to **Settings → Automations & Scenes**
2. Click **⋮** (three dots) → **Edit in YAML**
3. Copy contents of `deye-00-helpers.yaml`
4. Paste into a new file or include via `!include`
5. **Reload YAML configuration** (Developer Tools → YAML → Reload Helpers)

**Verify helpers created:**
- Go to **Settings → Devices & Services → Helpers**
- Search for "deye" - should see 6 new entities:
  - `input_number.deye_rescue_count_6h`
  - `input_datetime.deye_last_rescue_time`
  - `input_boolean.deye_rescue_active`
  - `input_boolean.deye_ev_charging_active`
  - `input_number.deye_load_previous`
  - `input_text.deye_discharge_zone`

### 2. Upload Updated Automations

```bash
# Upload all automation files
scp deye-01-panic-rescue.yaml homeassistant:/config/automations/
scp deye-02-discharge-cap.yaml homeassistant:/config/automations/
scp deye-03-ev-guard.yaml homeassistant:/config/automations/
scp deye-04-rescue-counter-reset.yaml homeassistant:/config/automations/
```

### 3. Reload Automations

**In Home Assistant:**
1. Go to **Developer Tools → YAML**
2. Click **Reload Automations**
3. Wait for confirmation

**Or via CLI:**
```bash
ha automation reload
```

### 4. Verify Deployment

**Check automation list:**
1. **Settings → Automations & Scenes**
2. Look for:
   - ✅ Deye-01 v2.4.0: Panic Rescue (Multi-Mode Voltage Protection)
   - ✅ Deye-02 v4.0.0: Adaptive Discharge Power Cap
   - ✅ Deye-03 v1.0.1: EV Charge Guard (webhook)
   - ✅ Deye-04 v1.0.0: Rescue Counter 6h Rolling Window Reset

**Initial State Check:**
```yaml
# Developer Tools → States
input_number.deye_rescue_count_6h: 0
input_number.deye_load_previous: 0
input_text.deye_discharge_zone: "none"
```

## 🧪 Testing Plan

### Test 1: Time-Based Mode (5 minutes)

**At 12:00 (daytime):**
1. Trigger deye-02 manually or wait for 30s cycle
2. Check notification: Should show `Time (12h): x100% ☀️`
3. Power limits should be normal (100% multiplier)

**At 18:00 (evening):**
1. Trigger deye-02
2. Check notification: Should show `Time (18h): x80% 🌙`
3. Power limits should be reduced by 20%

### Test 2: Rescue Counter (15 minutes)

**Trigger a rescue:**
1. Manually lower SOC sensor or voltage (Developer Tools → States)
2. Watch for rescue activation
3. Check `input_number.deye_rescue_count_6h` - should increment to 1
4. Check `input_datetime.deye_last_rescue_time` - should update

**Check adaptive response:**
1. Wait for deye-02 to trigger
2. Check notification: Should show `Rescues (1): x95%`
3. Power limits should be reduced by 5%

**Verify reset:**
1. Wait 6 hours OR manually trigger deye-04
2. Check counter resets to 0

### Test 3: Load Spike Detection (10 minutes)

**Simulate load spike:**
1. Turn on high-load appliance (heat pump, oven, etc.)
2. Wait for deye-02 30s trigger
3. Check notification for load delta
4. If load increased >2000W, should show `Spike (Δ2500W): x70% ⚡`

**Verify recovery:**
1. Wait 30-60 seconds (next cycle)
2. Notification should show `Spike (Δ100W): x100% ✓`

### Test 4: Combined Adaptive (Real-World)

**Best test: Evening with real loads (17:00-23:00):**
1. Let system run naturally during high-risk hours
2. Watch notifications for combined multipliers
3. Example: `ADAPTIVE: x56%` means:
   - Time: 0.8 (evening)
   - Rescues: 1.0 (none recent)
   - Spike: 0.7 (detected spike)
   - Combined: 0.8 × 1.0 × 0.7 = 0.56

## 📊 Monitoring

### Key Metrics to Watch

**Notification Examples:**

```
✅ NORMAL (daytime, no rescues, no spike):
ADAPTIVE: x100%
Time (14h): x100% ☀️
Rescues (0): x100%
Spike (Δ200W): x100% ✓
```

```
⚠️ CONSERVATIVE (evening, 1 rescue, spike detected):
ADAPTIVE: x53%
Time (19h): x80% 🌙
Rescues (1): x95%
Spike (Δ2800W): x70% ⚡
```

```
🔴 AGGRESSIVE (evening, 4+ rescues, spike detected):
ADAPTIVE: x45%
Time (20h): x80% 🌙
Rescues (4): x80%
Spike (Δ3100W): x70% ⚡
```

### Success Indicators

**Week 1: Baseline**
- Count rescue activations during 17:00-23:00
- Note peak SOC drops and voltage minimums
- Track how often combined multiplier goes below 70%

**Week 2-4: Adaptive Learning**
- Rescue count should stabilize or decrease
- System should self-tune to your usage patterns
- Voltage drops should be less severe
- SOC should stay above 35-40% during evening loads

## 🐛 Troubleshooting

### Issue: Helpers not found

**Error:** `Entity input_number.deye_rescue_count_6h not found`

**Fix:**
1. Verify deye-00-helpers.yaml uploaded correctly
2. Reload helpers: Developer Tools → YAML → Reload Helpers
3. Check Settings → Devices & Services → Helpers for entities
4. If missing, manually create via UI or check YAML syntax

### Issue: Counter not incrementing

**Symptoms:** Rescues happen but counter stays at 0

**Fix:**
1. Check deye-01 automation is active (v2.4.0)
2. Verify `input_number.deye_rescue_count_6h` exists
3. Check automation trace: Settings → Automations → Deye-01 → Traces
4. Look for action "Increment rescue counter" in trace

### Issue: Power limits not changing

**Symptoms:** Notification shows adaptive multipliers but limits stay same

**Fix:**
1. Verify deye-02 is v4.0.0 (check alias in automation list)
2. Check notification shows both:
   - ADAPTIVE: x[value]%
   - SOC Limit with updated values
3. Verify POWER_MAX and POWER_MIN calculations in variables
4. Check automation trace for variable values

### Issue: Time mode not activating

**Symptoms:** Evening hours (17:00-23:00) but still shows x100%

**Fix:**
1. Check Home Assistant system time: Settings → System → General
2. Verify timezone correct
3. Check notification shows correct `current_hour`
4. Look for `is_evening` variable in automation trace

## 📈 Expected Behavior

### Typical Daily Pattern

**00:00-06:00:** 
- Time multiplier: 1.0 (nighttime, low risk)
- Rescue counter resets at 00:00, 06:00

**06:00-17:00:**
- Time multiplier: 1.0 (daytime, low risk)
- Standard SOC curve applies

**17:00-23:00:** 🔴 HIGH RISK
- Time multiplier: 0.8 (evening mode active)
- Watch for rescue counter increments
- Load spikes most likely during cooking/heat pump

**23:00-00:00:**
- Time multiplier: 1.0 (late evening, risk decreasing)
- Prepare for midnight counter reset

### Rescue Frequency Learning Pattern

**First rescue:** 
- Counter: 1
- Multiplier: 0.95 (5% reduction)
- System begins learning

**Second rescue within 6h:**
- Counter: 2
- Multiplier: 0.90 (10% reduction)
- Trend detected

**Third-fourth rescue:**
- Counter: 3-4
- Multiplier: 0.85-0.80 (15-20% reduction)
- System in defensive mode

**Six hours without rescue:**
- Counter: resets to 0
- Multiplier: 1.0
- System returns to normal

## 🎯 Next Steps

After successful deployment and testing:

1. **Monitor for 1 week** - Collect baseline data
2. **Adjust if needed** - Tune multipliers based on observed patterns:
   - Time window: Change 17:00-23:00 if different peak hours
   - Rescue reduction: Change 5% to 3-7% based on sensitivity
   - Spike threshold: Change 2000W to 1500-2500W based on loads
3. **Long-term tracking** - Use deye-analytics to log patterns
4. **Season changes** - May need different settings winter vs summer

## 📚 References

- **SYSTEM-DIAGRAM.md** - Complete architecture overview
- **SYSTEM-GOALS.md** - Future improvements and roadmap
- **deye-config.yaml** - Centralized constants (if using)

## ✅ Deployment Checklist

- [ ] Backup current automations
- [ ] Upload deye-00-helpers.yaml
- [ ] Reload helpers in Home Assistant
- [ ] Verify all 6 helper entities created
- [ ] Upload 4 automation files
- [ ] Reload automations
- [ ] Verify all 4 automations visible with correct versions
- [ ] Test time-based mode (check at different hours)
- [ ] Test rescue counter increment (trigger rescue)
- [ ] Test load spike detection (high-load appliance)
- [ ] Monitor first evening (17:00-23:00) operation
- [ ] Verify counter reset after 6 hours
- [ ] Review notifications for adaptive multipliers
- [ ] Track rescue frequency over first week
- [ ] Compare voltage stability vs. baseline

**Estimated deployment time:** 30-45 minutes
**Recommended deployment window:** Daytime (low battery usage) to test safely

---

**Version:** v4.0.0  
**Date:** 2025-01-XX  
**Author:** Jan Hjordie  
**System:** Deye Inverter + Ecodan Heat Pump + Home Assistant
