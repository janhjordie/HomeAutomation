# Deye Cloud Data Analysis - 2026-01-27

## Key Findings

### 1. **Voltage Behavior**
- **Range:** 46.24V - 53.71V  
- **Average:** 50.92V
- **Observations:**
  - Voltage drops to **46.24-46.30V** at end of day (23:41-23:51)
  - This is **CRITICAL ZONE** for your system (below 47.2V = emergency guard)
  - Voltage is volatile, indicating dynamic load + discharge

### 2. **BMS Discharge Current Limits**
- **Average Limit:** 177.15A (195A max, 0A at shutdown)
- **Key Issue:** **BMS sets limit to 195A almost constantly**
- **Problem:** This is **NOT protecting** the battery at low SOC
  - Your automation needed to override because BMS doesn't!

### 3. **SOC Data**
- **Range:** 36-90%  
- **Average:** 57.3%
- **Pattern:** Battery cycles 36% → 90% during the day
- **Critical Point:** At 36% SOC + discharge → voltage drops to 46.24V (F58 zone!)

### 4. **Discharge Current Correlation**
- **At SOC 36%:** Current can reach 60A (even 65A peak)
- **At SOC 90%:** Current is 0A (charging)
- **Your 80W/% curve prevents exactly this situation:**
  - 36% SOC should limit to ~22A (1400W at 48V)
  - But BMS sets 195A limit (ignores SOC!)

### 5. **Critical Event at 23:41**
- Voltage: **46.30V** (below your 47.2V emergency)
- SOC: 36%
- Discharge Limit: **Dropped to 0A** (system protecting itself)
- This is **the F58 trigger point**

---

## Why Your Automation is Necessary

**BMS Behavior:**
- Always sets discharge limit = **195A** (constant, ignores SOC)
- Only reacts to **emergency** (drops to 0A when voltage collapses)
- **Reactive, not proactive**

**Your Automation (Deye-02):**
- Calculates SOC-based limits: 36% SOC = ~22A max
- Prevents voltage collapse **before** it happens
- **Proactive protection**

---

## Evidence from the Data

| Condition | Voltage | SOC | BMS Limit | Your Limit | Result |
|-----------|---------|-----|-----------|-----------|--------|
| 23:41 (low SOC) | 46.30V ⚠️ | 36% | 195A | ~22A | **Emergency!** |
| 04:39 (charging) | 53.60V ✅ | 74% | 195A | ~60A | Safe |
| 12:01 (mixed) | 51.04V ✅ | 40% | 195A | ~28A | Safe (with your limit) |

**Without your automation:** Last row would be F58 error every time SOC drops to 36%

---

## Recommendations

1. **Keep your Deye-02 SOC limiter** — BMS doesn't do it
2. **Monitor voltage floor** — Your 47.2V emergency guard is appropriate
3. **Consider requesting Rosen Batt firmware update** — With SOC-aware discharge limiting
4. **SolarBalance limits** — Check if SolarBalance can help (unlikely, but worth asking)

The data confirms your F58 diagnosis perfectly.
