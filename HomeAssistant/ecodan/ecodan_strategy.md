# Ecodan Heat Pump Control Strategy: Weather-Compensated Operation

**Objective:** Transform heat pump from reactive room-mode to proactive outdoor-temperature-based control for predictable loads and optimal battery integration.

**Data Foundation:** 2,784 measurements across 258 unique outdoor temperatures (-9°C to +3°C)  
**Implementation:** Fixed flow temperature lookup based on outdoor temperature (immune to indoor disturbances)

---

## Current Room-Mode Problems

### Indoor Disturbance Issues
- **Someone opens window** → room temp drops → HP cranks up flow temp → **unpredictable power spike**
- **Evening cooking/activity** → room temp rises → HP reduces output → **inconsistent load**  
- **These spikes were likely contributing to battery voltage stress during 17:00-22:00**

### Defrost Cycle Problems
1. **Defrost starts** → HP stops heating (or reverses) → Indoor temp drops 1-2°C
2. **Defrost ends** → Room mode sees "too cold" → **Overcompensation**: Flow temp jumps way above normal
3. **Energy waste**: Higher flow temp than needed for actual outdoor conditions  
4. **Battery impact**: Unexpected power spike just after defrost cycle

---

## Outdoor-Temperature-Based Solution

### Core Strategy
- **Fixed lookup**: -1°C outdoor = 46.5°C flow (always, regardless of windows)
- **Predictable loads**: Battery system can plan for known power consumption
- **No compensation**: Open windows become "user responsibility" - HP maintains consistent output

### Weather-Compensated Defrost Recovery
1. **Defrost starts** → Indoor temp drops (ignored by system)
2. **Defrost ends** → HP returns to **exact outdoor-temp-based flow temp** (e.g., 45.6°C at 0°C outdoor)
3. **No overcompensation** → Room naturally returns to setpoint at optimal efficiency
4. **Predictable loads** → Battery system knows exactly what to expect

---

## Implementation Benefits

### Battery Protection & Integration
- **No surprise power spikes** during evening peak pricing (17:00-22:00)
- **Predictable automation**: SOC curves can account for known heat pump loads
- **Better battery protection**: No power spikes during critical voltage periods
- **Consistent power draw**: Defrost cycles become predictable load events

### Energy Efficiency Gains  
- **Stop "chasing" open windows** with extra power consumption
- **Faster room recovery**: Optimal flow temp is more efficient than overheating
- **Less thermal stress**: No temperature swings in the system
- **Energy waste elimination**: No overcompensation after defrost cycles

### Heat Pump Effectiveness Improvements
- **Steady-state operation**: No constant flow temperature adjustments → **higher COP (Coefficient of Performance)**
- **Optimal modulation**: HP runs at ideal capacity for weather conditions → **maximum efficiency**
- **Reduced cycling**: Consistent operation eliminates inefficient stop/start behavior
- **No hunting behavior**: Eliminates constant temperature searching and overshooting
- **Less mechanical wear**: Steady operation reduces compressor and valve stress
- **Predictable performance**: Heat pump operates in its most efficient zone consistently

### System Stability
- **Consistent operation** regardless of human behavior
- **System immunity** from all indoor disturbances (windows, defrost cycles, cooking heat)
- **Proactive operation**: Maintains optimal output for weather conditions vs reactive room changes

---

## Curve Data Advantages

### Precision & Coverage
- **258 temperature points** for precise mapping
- **Real operational data** (not theoretical curves)  
- **Complete weather range** coverage (-9°C to +3°C actual conditions)
- **Proven performance**: Data from 11 days of actual operation

### Real-World Examples

**Current Optimal Operation (0°C outdoor):**
- **Weather-compensated**: 45.6°C flow temp (consistent)
- **Room-mode after defrost**: Might spike to 48-50°C trying to "catch up"  
- **Your system**: Returns directly to 45.6°C, lets room recover naturally

**Winter Peak Conditions (-7°C outdoor):**
- **Fixed flow temp**: 48.2°C (predictable load)
- **Room-mode with open window**: Could spike to 50-52°C (unpredictable)
- **Battery planning**: System knows exact power requirements in advance

---

## System Transformation

### From Reactive to Proactive
**Before (Room Mode):**
- Heat pump responds to indoor temperature changes
- Unpredictable power consumption  
- Battery system surprised by load spikes
- Energy waste from overcompensation

**After (Weather Compensated):**
- Heat pump maintains optimal output for outdoor conditions
- Predictable power consumption patterns
- Battery system can plan discharge curves accurately  
- Maximum efficiency with no indoor interference

### Integration with Battery Management
This strategy provides the **missing link** between weather conditions and battery planning:
- **Known loads**: Each outdoor temperature maps to specific power consumption
- **No surprises**: Indoor activities don't affect power draw
- **Better SOC planning**: Battery protection can account for actual heat pump needs
- **Evening optimization**: Predictable loads during critical 17:00-22:00 pricing period

---

## Next Steps

1. **Implement temperature lookup system** using curve data from `ecodan_curve.md`
2. **Override room-mode compensation** with fixed outdoor-temp-based flow temperatures  
3. **Integration testing** with battery SOC curves during various weather conditions
4. **Monitor results** for load predictability and battery stress reduction

**Result**: Heat pump becomes a **predictable, weather-dependent load** that integrates seamlessly with battery management system, eliminating power spikes and optimizing energy efficiency.

---

*Strategy based on analysis of 2,784 heat pump measurements and battery performance correlation data*