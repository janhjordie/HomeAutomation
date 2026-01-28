# Deye Battery Management System - Architecture Diagram

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃                    DEYE BATTERY PROTECTION SYSTEM                        ┃
┃                                                                          ┃
┃  ┌────────────────────────────────────────────────────────────────┐    ┃
┃  │                   SENSOR INPUTS (Real-time)                    │    ┃
┃  ├────────────────────────────────────────────────────────────────┤    ┃
┃  │  • sensor.solarcust0186_battery_voltage          (45-54V)      │    ┃
┃  │  • sensor.solarcust0186_battery_charge_level     (0-100%)      │    ┃
┃  │  • sensor.solarcust0186_load_totalpower          (watts)       │    ┃
┃  │  • sensor.solarcust0186_battery_output_power     (watts)       │    ┃
┃  │  • number.solarcust0186_maximum_battery_discharge_current (A)  │    ┃
┃  └────────────────────────────────────────────────────────────────┘    ┃
┃                                    │                                    ┃
┃                                    ▼                                    ┃
┃  ┌─────────────────────────────────────────────────────────────────┐   ┃
┃  │           AUTOMATION PRIORITY HIERARCHY (Top = Highest)         │   ┃
┃  ├─────────────────────────────────────────────────────────────────┤   ┃
┃  │                                                                  │   ┃
┃  │  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓    │   ┃
┃  │  ┃  PRIORITY 1: Deye-09 (EV Guard) v1.0.0              ┃    │   ┃
┃  │  ┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫    │   ┃
┃  │  ┃  Trigger: Webhook (EV charging start/stop)          ┃    │   ┃
┃  │  ┃  Action:  Sets discharge to 0A during EV charging   ┃    │   ┃
┃  │  ┃           Sets SOC limits to 40%                    ┃    │   ┃
┃  │  ┃  Flag:    input_boolean.deye_ev_charging_active     ┃    │   ┃
┃  │  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛    │   ┃
┃  │                           │                                     │   ┃
┃  │                           ▼                                     │   ┃
┃  │  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓    │   ┃
┃  │  ┃  PRIORITY 2: Deye-01 (Rescue) v2.3.0                ┃    │   ┃
┃  │  ┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫    │   ┃
┃  │  ┃  Triggers: Voltage thresholds                       ┃    │   ┃
┃  │  ┃   • emergency_voltage:     < 47.2V (instant)        ┃    │   ┃
┃  │  ┃   • emergency_idle_low:    < 47.2V + low power      ┃    │   ┃
┃  │  ┃   • load_panic:            < 47.8V (instant)        ┃    │   ┃
┃  │  ┃   • load_hard:             < 48.0V (5s delay)       ┃    │   ┃
┃  │  ┃   • load_preemptive:       < 49.2-49.6V + load      ┃    │   ┃
┃  │  ┃                                                      ┃    │   ┃
┃  │  ┃  Actions:                                            ┃    │   ┃
┃  │  ┃   • Sets charge current to 5-10A                    ┃    │   ┃
┃  │  ┃   • Sets discharge to 10A (safe mode)               ┃    │   ┃
┃  │  ┃   • Enables grid charging                           ┃    │   ┃
┃  │  ┃   • Sets SOC limits to 40%                          ┃    │   ┃
┃  │  ┃   • Loops until voltage recovered                   ┃    │   ┃
┃  │  ┃                                                      ┃    │   ┃
┃  │  ┃  Cleanup (when rescue stops):                       ┃    │   ┃
┃  │  ┃   1. Turn OFF rescue flag FIRST ✓                   ┃    │   ┃
┃  │  ┃   2. Restore discharge to 90A                       ┃    │   ┃
┃  │  ┃   3. Triggers Deye-03 (SOC enforcement)             ┃    │   ┃
┃  │  ┃                                                      ┃    │   ┃
┃  │  ┃  Flag: input_boolean.deye_rescue_active             ┃    │   ┃
┃  │  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛    │   ┃
┃  │                           │                                     │   ┃
┃  │                           ▼                                     │   ┃
┃  │  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓    │   ┃
┃  │  ┃  PRIORITY 3: Deye-03 (SOC Limits) v3.0.0            ┃    │   ┃
┃  │  ┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫    │   ┃
┃  │  ┃  Triggers:                                           ┃    │   ┃
┃  │  ┃   • Discharge current number changes (instant)      ┃    │   ┃
┃  │  ┃   • SOC, voltage, load changes                      ┃    │   ┃
┃  │  ┃   • Every 30 seconds (periodic enforcement)         ┃    │   ┃
┃  │  ┃                                                      ┃    │   ┃
┃  │  ┃  Conditions (only enforces if ALL true):            ┃    │   ┃
┃  │  ┃   ✓ Connection ON                                   ┃    │   ┃
┃  │  ┃   ✓ Discharge > 0A                                  ┃    │   ┃
┃  │  ┃   ✓ Rescue flag OFF/unknown                         ┃    │   ┃
┃  │  ┃   ✓ EV flag OFF/unknown                             ┃    │   ┃
┃  │  ┃                                                      ┃    │   ┃
┃  │  ┃  Action: Calculate & enforce SOC-based limit        ┃    │   ┃
┃  │  ┃   desired = min(zone_cap, base_cap, soc_limit)      ┃    │   ┃
┃  │  ┃   if current ≠ desired → set to desired             ┃    │   ┃
┃  │  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛    │   ┃
┃  │                                                                 │   ┃
┃  └─────────────────────────────────────────────────────────────────┘   ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛


┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃               SOC-BASED POWER LIMIT CURVE (Deye-03)                      ┃
┃                                                                          ┃
┃   Power (W)                                                              ┃
┃   3000 ┤──────────────────────────────────────●                          ┃
┃        │                                      ╱                           ┃
┃   2800 ┤                                    ╱                             ┃
┃        │                                  ╱                               ┃
┃   2600 ┤                                ╱                                 ┃
┃        │                              ╱    Linear interpolation           ┃
┃   2400 ┤                            ╱      80W per 1% SOC                 ┃
┃        │                          ╱                                       ┃
┃   2200 ┤                        ╱                                         ┃
┃        │                      ╱                                           ┃
┃   2000 ┤                    ●  ← 40% SOC = 2000W (42A @ 48V)              ┃
┃        │                  ╱                                               ┃
┃   1800 ┤                ╱                                                 ┃
┃        │              ╱                                                   ┃
┃   1600 ┤            ╱                                                     ┃
┃        │          ╱                                                       ┃
┃   1400 ┤        ╱                                                         ┃
┃        │      ╱                                                           ┃
┃   1200 ┤    ╱                                                             ┃
┃        │  ╱                                                               ┃
┃   1000 ┤●───────────────────────────────────────                          ┃
┃        └─┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬─ SOC (%)              ┃
┃          25  30  35  40  45  50  55  60  65  70  75                      ┃
┃                                                                          ┃
┃   Formula: Power = 1000 + ((SOC - 25) / 25) × 2000                       ┃
┃   Amps:    Current = Power / 48V                                         ┃
┃                                                                          ┃
┃   Examples:                                                              ┃
┃   • 50% SOC → 3000W → 63A (no limit, uses base cap 60A)                 ┃
┃   • 45% SOC → 2600W → 54A                                               ┃
┃   • 40% SOC → 2200W → 46A                                               ┃
┃   • 35% SOC → 1800W → 38A                                               ┃
┃   • 30% SOC → 1400W → 29A                                               ┃
┃   • 25% SOC → 1000W → 21A (hard floor)                                  ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛


┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃                      RESCUE ACTIVATION FLOW                              ┃
┃                                                                          ┃
┃   Battery Voltage Drops                                                 ┃
┃         │                                                               ┃
┃         ▼                                                               ┃
┃   ┌──────────────────────┐                                             ┃
┃   │ Voltage Thresholds:  │                                             ┃
┃   │  • 47.2V Emergency   │◄─── Instant trigger (no load requirement)   ┃
┃   │  • 47.8V Panic       │◄─── Instant trigger                         ┃
┃   │  • 48.0V Hard        │◄─── 5 second delay                          ┃
┃   │  • 49.2V Preemptive  │◄─── + high load condition                   ┃
┃   └──────────────────────┘                                             ┃
┃         │                                                               ┃
┃         ▼                                                               ┃
┃   ┌─────────────────────────────────────────┐                          ┃
┃   │ Check Conditions:                       │                          ┃
┃   │  ✓ Connection ON                        │                          ┃
┃   │  ✓ Automations enabled                  │                          ┃
┃   │  ✓ Load > 1000W (skip for emergency)    │                          ┃
┃   └─────────────────────────────────────────┘                          ┃
┃         │                                                               ┃
┃         ▼                                                               ┃
┃   ┌─────────────────────────────────────────┐                          ┃
┃   │ RESCUE ACTIVATION                       │                          ┃
┃   ├─────────────────────────────────────────┤                          ┃
┃   │ 1. Set rescue flag ON                   │                          ┃
┃   │ 2. Set discharge to 10A (safe)          │                          ┃
┃   │ 3. Set charge current to 5A             │                          ┃
┃   │ 4. Enable grid charging                 │                          ┃
┃   │ 5. Set SOC limits to 40%                │                          ┃
┃   │ 6. Send notifications                   │                          ┃
┃   └─────────────────────────────────────────┘                          ┃
┃         │                                                               ┃
┃         ▼                                                               ┃
┃   ┌─────────────────────────────────────────┐                          ┃
┃   │ RESCUE LOOP (every 20-60s)              │                          ┃
┃   ├─────────────────────────────────────────┤                          ┃
┃   │ While voltage < stop_volt (47.8-50.2V): │                          ┃
┃   │  • Monitor voltage recovery             │                          ┃
┃   │  • Re-enable grid charge if disabled    │                          ┃
┃   │  • Send status notifications            │                          ┃
┃   └─────────────────────────────────────────┘                          ┃
┃         │                                                               ┃
┃         ▼                                                               ┃
┃   Voltage Recovered?                                                   ┃
┃         │                                                               ┃
┃         ▼                                                               ┃
┃   ┌─────────────────────────────────────────┐                          ┃
┃   │ CLEANUP (Critical Order!)               │                          ┃
┃   ├─────────────────────────────────────────┤                          ┃
┃   │ 1. Turn OFF rescue flag ◄── FIRST!      │                          ┃
┃   │ 2. Turn off grid charge                 │                          ┃
┃   │ 3. Restore discharge to 90A             │◄── Triggers Deye-03      ┃
┃   │ 4. Restore SOC limits to 20%            │                          ┃
┃   │ 5. Send completion notifications        │                          ┃
┃   └─────────────────────────────────────────┘                          ┃
┃         │                                                               ┃
┃         ▼                                                               ┃
┃   Deye-03 enforces SOC-based limit                                     ┃
┃   (90A → actual SOC limit, e.g. 44A @ 39%)                             ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛


┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃                  EXAMPLE SCENARIO: Low SOC Discharge                     ┃
┃                                                                          ┃
┃   Initial State: 38% SOC, 50.2V, 90A discharge set by SolarBalance     ┃
┃                                                                          ┃
┃   Step 1: Deye-03 Triggered (discharge current changed)                ┃
┃   ├─ SOC: 38%                                                           ┃
┃   ├─ Calculate: 1000 + ((38-25)/25) × 2000 = 2040W                      ┃
┃   ├─ Convert: 2040W / 48V = 43A (rounded)                               ┃
┃   ├─ Zone: none (no voltage/load stress)                                ┃
┃   ├─ Base cap: 60A (winter)                                             ┃
┃   ├─ Desired: min(60, 43) = 43A                                         ┃
┃   ├─ Current: 90A ≠ Desired: 43A                                        ┃
┃   └─ ACTION: Set discharge to 43A ✓                                     ┃
┃                                                                          ┃
┃   Result: Battery protected from over-discharge                         ┃
┃   • Max discharge: ~2,000W instead of ~4,300W                           ┃
┃   • Voltage stays stable at 50.2V                                       ┃
┃   • SOC drains slower                                                   ┃
┃   • No F58 errors                                                       ┃
┃                                                                          ┃
┃   Step 2: Load increases, voltage drops to 46V                          ┃
┃   ├─ Deye-01 EMERGENCY RESCUE triggers (< 47.2V)                        ┃
┃   ├─ Sets rescue flag ON                                                ┃
┃   ├─ Sets discharge to 10A (safe)                                       ┃
┃   ├─ Sets charge to 5A + enables grid charge                            ┃
┃   └─ Deye-03 sees rescue flag ON → does not interfere                   ┃
┃                                                                          ┃
┃   Step 3: Voltage recovers to 47.8V                                     ┃
┃   ├─ Deye-01 cleanup:                                                   ┃
┃   │   1. Turn OFF rescue flag                                           ┃
┃   │   2. Set discharge to 90A                                           ┃
┃   │   3. Restore SOC limits to 20%                                      ┃
┃   └─ Deye-03 immediately triggers:                                      ┃
┃       • Current: 90A, Desired: 43A (38% SOC)                            ┃
┃       • Sets back to 43A within 1 second ✓                              ┃
┃                                                                          ┃
┃   Final State: 38% SOC, 47.8V, 43A discharge (SOC-protected)           ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛


┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃                         KEY DESIGN DECISIONS                             ┃
┃                                                                          ┃
┃  ✓ Rescue flag turned OFF BEFORE restoring discharge                   ┃
┃    → Allows Deye-03 to immediately enforce SOC limits                   ┃
┃                                                                          ┃
┃  ✓ Emergency rescue sets discharge to 10A during charging               ┃
┃    → Creates state change when cleanup restores to 90A                  ┃
┃    → State change triggers Deye-03                                      ┃
┃                                                                          ┃
┃  ✓ Periodic 30s check in Deye-03                                        ┃
┃    → Catches external overrides from SolarBalance                       ┃
┃    → Maximum 30s delay to correct any wrong values                      ┃
┃                                                                          ┃
┃  ✓ Conditions moved inside actions (after debug notification)           ┃
┃    → Debug notification always shows why automation runs/blocks         ┃
┃                                                                          ┃
┃  ✓ Unknown/unavailable states treated as inactive                       ┃
┃    → Works even if helper entities don't exist                          ┃
┃                                                                          ┃
┃  ✓ Correct SOC sensor: battery_charge_level (not battery_soc)          ┃
┃    → Critical fix that enabled entire SOC-based limiting system         ┃
┃                                                                          ┃
┃  ✓ Emergency triggers skip 1000W load requirement                       ┃
┃    → Rescue activates at critical voltage even with low load            ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```
