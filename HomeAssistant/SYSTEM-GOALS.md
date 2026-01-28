# Deye Battery Management - System Goals

## Primary Objectives

### 1. SOC-Based Discharge Protection (Deye-03)
**Goal:** Prevent rapid voltage collapse by limiting discharge current based on battery State of Charge.

**Strategy:**
- **Override SolarBalance (SoBa) discharge settings** continuously
- Linear power curve: 50% SOC = 3000W → 25% SOC = 1000W (80W per percentage point)
- Enforcement every 30 seconds + instant on any discharge current change
- Takes priority over SoBa's 1-15 minute update cycle

**Why this works:**
- SoBa updates inverter every 5 seconds (reads data)
- SoBa sends commands every 1-15 minutes
- Deye-03 enforces limits within 30 seconds maximum
- Our automation always "wins" the override battle

### 2. Adaptive Learning from Rescue Events *(Future Enhancement)*
**Goal:** Reduce discharge limits if rescue procedures trigger frequently.

**Proposed Logic:**
```
If rescue triggered N times in 6 hours:
  → Reduce base winter cap from 60A to 50A
  → Reduce SOC curve by 10% (2700W at 50% instead of 3000W)
  → Increase back gradually over 24 hours if no rescues

Example:
  Normal:    40% SOC = 2200W (46A)
  After 3x:  40% SOC = 1980W (41A)  ← 10% reduction
```

**Implementation:** Track rescue events in `input_number.deye_rescue_count_6h`

### 3. Emergency Voltage Rescue (Deye-01)
**Goal:** Prevent battery deep-discharge and F58 protection errors.

**Activation Thresholds:**
- **Emergency:** < 47.2V (instant, no load requirement)
- **Panic:** < 47.8V (instant)
- **Hard:** < 48.0V (5 second delay)
- **Preemptive:** < 49.2-49.6V + high load (15-20s delay)

**Rescue Actions:**
- Limit discharge to 10A (safety mode)
- Enable 5A grid charging
- Loop until voltage recovers to 47.8-50.2V
- Restore normal operation when safe

### 4. Pattern Recognition *(Future Enhancement)*
**Goal:** Detect recurring rescue patterns and adjust proactively.

**Not yet implemented - ideas for improvement.**

## Operational Context

### Time-of-Day Behavior
**Critical Period: 17:00-23:00**
- High electricity prices → SoBa activates battery discharge
- Heat pump runs continuously (winter heating demand)
- Load spikes from cooking (17:00-20:00)
- **99% of voltage drops occur in this window**

### Heat Pump Load Pattern (Winter)
**Normal Operation:** 1000-3000W continuous  
**Defrost Cycles:** Sudden drops to ~300W, then spike to 3500W+  
**Combined with cooking:** Can exceed 4000-5000W total

**Challenge:** Load swings from 300W → 3500W in seconds
- SoBa can't react fast enough (1-15 min command cycle)
- Voltage drops rapidly under sudden load
- Current SOC limits help but may need time-aware tuning

### SolarBalance Integration
**SoBa Update Pattern:**
- Reads inverter data: **Every 5 seconds**
- Sends discharge commands: **Every 1-15 minutes** (variable)
- Our enforcement: **Every 30 seconds** + instant on changes

**Override Strategy:**
1. SoBa sets discharge to 90A
2. Within 30 seconds, Deye-03 enforces SOC limit (e.g., 44A)
3. SoBa sees 44A, may try to increase again
4. Deye-03 re-enforces within 30 seconds
5. **Result:** Our limits always win

## Potential Improvements

### 1. Time-Based Conservative Mode ✨ RECOMMENDED
**Problem:** 99% of issues occur 17:00-23:00  
**Solution:** More aggressive SOC limits during high-risk hours

```yaml
# After 17:00, reduce power curve by 20%
if now().hour >= 17 and now().hour < 23:
  POWER_MAX: 2400W  # instead of 3000W
  POWER_MIN: 800W   # instead of 1000W
```

**Result at 40% SOC:**
- Normal (daytime): 2200W (46A)
- Conservative (evening): 1760W (37A) ← 20% safer

### 2. Heat Pump Defrost Detection ✨ RECOMMENDED
**Problem:** Sudden 300W → 3500W swings during defrost  
**Solution:** Detect rapid load increases and pre-limit discharge

```yaml
# If load increases >2000W in <10 seconds
# Temporarily reduce discharge by 30% for 2 minutes
if load_increase > 2000 and time_delta < 10:
  temporary_limit = current_limit * 0.7
```

**Benefit:** Cushions voltage drop during defrost spike

### 3. Rescue Frequency Counter
**Problem:** Repeated rescues indicate limits are too high  
**Solution:** Track rescues and adapt automatically

```yaml
# Count rescues in rolling 6-hour window
# Reduce limits by 5% per rescue (max 20%)
rescue_multiplier = 1 - (min(rescue_count_6h, 4) * 0.05)
adjusted_power = base_power * rescue_multiplier
```

**Example:**
- 0 rescues: 100% of normal limits
- 2 rescues: 90% of normal limits (10% safer)
- 4+ rescues: 80% of normal limits (20% safer)

### 4. Season-Aware Base Caps
**Already Implemented:** Winter 60A, Summer 90A  
**Enhancement:** Adjust based on outdoor temperature

```yaml
# Colder = more heat pump load = lower caps
if outdoor_temp < 0°C:  base_cap = 50A  # Very cold
elif outdoor_temp < 5°C: base_cap = 60A  # Cold (current winter)
else: base_cap = 90A  # Mild/summer
```

### 5. Load Prediction Buffer
**Problem:** SoBa doesn't predict sudden load changes  
**Solution:** Monitor load trend and pre-adjust

```yaml
# If load increasing >100W per minute for 3 minutes
# Reduce discharge by 10% preemptively
if load_trend > 100 and trend_duration > 3:
  buffer_reduction = 0.9
```

**Use case:** Detects cooking starting, reduces discharge before voltage drops

## Priority Implementation Order

1. **✅ DONE:** SOC-based sliding limits (Deye-03 v3.0.0)
2. **✅ DONE:** Emergency rescue with proper cleanup (Deye-01 v2.3.0)
3. **🔴 HIGH:** Time-based conservative mode (17:00-23:00)
4. **🟡 MEDIUM:** Rescue frequency counter with auto-adjustment
5. **🟡 MEDIUM:** Heat pump defrost spike detection
6. **🟢 LOW:** Temperature-based seasonal caps
7. **🟢 LOW:** Load trend prediction buffer

## Success Metrics

**Current Achievements:**
- ✅ SOC-based limits working (60A at 50% SOC instead of 90A)
- ✅ Rescue activates at critical voltage (< 47.2V)
- ✅ Overrides SolarBalance successfully
- ✅ No F58 errors since implementation

**Target Improvements:**
- 🎯 Reduce rescue activations by 80% (time-based + defrost detection)
- 🎯 Zero voltage drops below 48V during normal operation
- 🎯 Adaptive learning responds within 6 hours of pattern change
- 🎯 Seamless coexistence with SolarBalance (no user intervention)

## Technical Notes

### Why Every 30 Seconds Works
- SoBa command interval: 1-15 minutes
- Our enforcement: 30 seconds
- **Ratio:** We check 2-30× more frequently than SoBa commands
- **Result:** We always enforce our limits before SoBa can override

### Why Rescue Flag Order Matters
```
WRONG:  Set 90A → rescue flag OFF → Deye-03 blocked
RIGHT:  Rescue flag OFF → set 90A → Deye-03 enforces SOC limit
```

### Why Emergency Mode Sets 10A Discharge
- Creates state change: 90A → 10A (rescue) → 90A (cleanup)
- State change triggers Deye-03
- Deye-03 enforces SOC limit: 90A → 44A
- Without this: 90A → 90A (no change, no trigger)

---

**Last Updated:** 2026-01-28  
**System Version:** Deye-01 v2.3.0, Deye-03 v3.0.0, Deye-09 v1.0.0
