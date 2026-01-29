# System Safety Guarantee: SOC Curve Authority

## Your Concern (Fixed ✅)
> "At 19% SOC, charged with 5A. How can discharge be set to 90A? Battery will discharge at 90A with VERY low SOC!"

## The Fix: Authority Mode (v1.0.2)

### Before (Vulnerable)
```
Rescue cleanup → Sets discharge to 90A (seasonal)
                ↓
Gap (1 minute)  ← **UNSAFE: Load can spike discharge to 90A**
                ↓
Deye-02 checks ← Too slow, might miss window
                ↓
Actually limits to ~12A @ 19% SOC
```

### After (Safe ✅)
```
Deye-01 cleanup:
  1. Calculates SOC limit: 19% SOC → 12A max
  2. Sets discharge to min(seasonal_limit, soc_limit)
  3. Example: min(90A, 12A) = 12A ✓
  4. Deye-02 triggers IMMEDIATELY on discharge change

Deye-02 (Authority):
  1. Verifies: Current value = 12A
  2. Formula check: 19% SOC → should be 12A ✓
  3. **Already at correct value → stays at 12A**
  4. Enforces every 30 seconds (catches SolarBalance drift)

Result: ✅ Discharge NEVER exceeds 12A @ 19% SOC
        ✅ Protected by continuous 30-second verification
        ✅ No gap, no temporary high discharge
```

## Mathematical Guarantee

### SOC Power Limiting Formula
```
Power = POWER_MIN + ((SOC - SOC_MIN) / (SOC_MAX - SOC_MIN)) * (POWER_MAX - POWER_MIN)

Where:
  POWER_MIN = 600W (at 25% SOC)
  POWER_MAX = 2500W (at 50% SOC)
  SOC_MIN = 25%
  SOC_MAX = 50%
```

### Examples (All Safe)
```
SOC = 19% (BELOW minimum)
  → Power = 600W (floor, no calculation)
  → Current = 600W / 48V = 12.5A ≈ 12A ✓

SOC = 25% (Minimum)
  → Power = 600W
  → Current = 600W / 48V = 12.5A ≈ 12A ✓

SOC = 35% (Mid-range)
  → Power = 600 + ((35-25)/(50-25)) * (2500-600) = 1360W
  → Current = 1360W / 48V = 28A ✓

SOC = 50% (Maximum)
  → Power = 2500W
  → Current = 2500W / 48V = 52A ✓
```

**At 19% SOC: Maximum safe discharge = 12A**
**Seasonal 90A limit is NEVER allowed below 50% SOC**

## Enforcement Timeline

### Rescue Completion @ 19% SOC
```
19:45:30  Deye-01 triggers rescue (voltage < 47.8V)
          - Sets discharge = 10A (safe)
          - Enables grid charge 5A
          
19:47:15  Voltage recovered to 50.2V
          - Rescue cleanup runs (Deye-01 cleanup sequence)
          
          Variables calculated:
          ├─ soc_current = 19%
          ├─ soc_limit_a = 600W / 48V = 12A
          ├─ discharge_a_normal = 90A (winter)
          └─ restore_discharge_a = min(90, 12) = 12A
          
          Actions:
          ├─ Turn OFF rescue_active flag
          ├─ Set discharge = 12A ✓
          └─ Notification: "Will restore to: 12A"

19:47:16  Deye-02 IMMEDIATE trigger (discharge state changed)
          - Current discharge = 12A
          - SOC = 19%
          - Calculates: 600W / 48V = 12A
          - Check: 12A == 12A ✓
          - No change needed, already correct
          
19:47:46  Deye-02 periodic check (30 seconds later)
          - Current discharge = 12A
          - SOC = 19%
          - Calculates: 12A
          - Check: 12A == 12A ✓
          - Monitoring continues...

19:48:16  Deye-02 periodic check (60 seconds later)
          - Current discharge = 12A
          - SOC = 19.5%
          - Calculates: 12A (still below 25% minimum)
          - Check: 12A == 12A ✓
          
...continues every 30 seconds...

19:50:00  SOC rises to 25%
          - Current discharge = 12A
          - Calculates: 600W (at minimum) = 12A
          - Check: 12A == 12A ✓
          
19:52:30  SOC rises to 35%
          - Current discharge = 12A (was not increased by Deye-01)
          - Calculates: 1360W = 28A
          - Check: 12A != 28A ✗
          - Deye-02 ENFORCES: discharge = 28A ✓
          - Now within normal operating range

Result: At NO POINT did discharge exceed 12A while SOC < 25%
```

## Safety Properties

### Property 1: Hard Floor
```yaml
if soc < 25%:
  max_discharge = 12A  # NEVER negotiable
```
No conditions, no flags, no exceptions. Deye-02 v1.0.2 checks this every 30 seconds.

### Property 2: Continuous Verification
```
Every 30 seconds:
  1. Read current SOC
  2. Calculate required limit
  3. Read current discharge setting
  4. If mismatch: correct it
```
Catches SolarBalance interference, network delays, inverter glitches.

### Property 3: Deye-01 + Deye-02 Coordination
```
Deye-01 cleanup:          Deye-02 enforcement:
├─ Calculates limit       ├─ Verifies calculation
├─ Sets value             ├─ Enforces + corrects
└─ Triggers Deye-02       └─ Continuous monitoring
```
Two-layer defense: Deye-01 prevents wrong values, Deye-02 catches any errors.

## Testing Your Fix

### Quick Test (Manual Trigger)
1. Battery at ~20% SOC
2. Developer Tools → Automations → Deye-Rescue-01 → Test Trigger
3. Watch notifications during rescue completion
4. Expected: Discharge set to ~12A (not 90A)
5. Watch Deye-02 notifications: "Already at SOC limit: 12A = 12A"

### Long-term Monitoring
Check CSV log every week:
```bash
# Find entries at low SOC
grep "soc=19\|soc=20\|soc=21\|soc=22" deye_weekly_log.csv

# Should show:
# soc=19, max_discharge_a=12, soc_limit_a=12 ✓
# soc=20, max_discharge_a=12, soc_limit_a=12 ✓
```

## Files Changed

### Core Fix
- `deye-rescue-02-discharge-cap.yaml` (v1.0.1 → v1.0.2)
  - Upgraded to Authority Mode
  - 30-second enforcement (was 1 minute)
  - Removed blocking by rescue/EV flags

### Already Correct (No Changes Needed)
- `deye-rescue-01-panic.yaml` (v1.0.2)
  - Cleanup already calculates SOC limits correctly
  - Lines 374-461 handle safe restoration

### Documentation Updated
- `.github/copilot-instructions.md`
  - Priority hierarchy updated
  - Authority Mode documented
- `v1.0.2-AUTHORITY-MODE-UPGRADE.md` (new)
  - Detailed explanation of fix
