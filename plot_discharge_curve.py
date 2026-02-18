#!/usr/bin/env python3
"""
Generate discharge curve plot for Deye battery system
2500W constant load from 17:00, starting at 90% SOC
Full discharge curve from 90% to 15%
v1.0.36: 60A max, SOC_MAX=30%
"""

import matplotlib.pyplot as plt
import numpy as np
from datetime import datetime, timedelta

# Simulation parameters
START_SOC = 90  # %
SOC_MAX = 30
SOC_MIN = 15
POWER_MIN = 600
POWER_MAX = 3500
BOOST = 1.05
FLAT_DISCHARGE_A = 60
LOAD_W = 2500  # Constant house load
BATTERY_CAPACITY_WH = 10000

# Time simulation
start_time = datetime.strptime("17:00", "%H:%M")
times = []
soc_values = []
voltage_values = []
discharge_a_values = []
battery_output_w = []
grid_input_w = []

# Initialize
current_soc = START_SOC
current_time = start_time
dt_minutes = 5  # 5-minute intervals

# Simulation loop (17:00 to 11:00 next day = 18 hours)
for _ in range(int(18 * 60 / dt_minutes)):
    times.append(current_time)
    soc_values.append(current_soc)
    
    # Voltage estimation based on SOC (simplified)
    if current_soc >= 80:
        voltage = 52.5 - (90 - current_soc) * 0.02
    elif current_soc >= 60:
        voltage = 52.0 - (80 - current_soc) * 0.025
    elif current_soc >= 45:
        voltage = 51.5 - (60 - current_soc) * 0.033
    elif current_soc >= 35:
        voltage = 51.0 - (45 - current_soc) * 0.05
    elif current_soc >= 25:
        voltage = 50.5 - (35 - current_soc) * 0.03
    else:
        voltage = 50.0 - (25 - current_soc) * 0.02
    
    voltage = max(voltage, 49.5)  # Floor at 49.5V
    voltage_values.append(voltage)
    
    # Calculate SOC power limit (matching automation logic)
    if current_soc >= SOC_MAX:
        soc_power_limit_w = FLAT_DISCHARGE_A * voltage
    elif current_soc <= SOC_MIN:
        soc_power_limit_w = POWER_MIN * BOOST
    else:
        normalized = (current_soc - SOC_MIN) / (SOC_MAX - SOC_MIN)
        normalized = max(0, min(normalized, 1))
        exponential = normalized * normalized
        soc_power_limit_w = (POWER_MIN + (POWER_MAX - POWER_MIN) * exponential) * BOOST
    
    # Voltage-based power clamp
    if voltage < 49.8:
        power_clamped_w = 50
    elif voltage < 50.2:
        power_clamped_w = 300
    elif voltage < 50.5:
        power_clamped_w = 600
    elif voltage < 50.8:
        power_clamped_w = 900
    elif voltage < 51.2:
        power_clamped_w = 1200
    else:
        # Soft zone calculation (simplified)
        power_clamped_w = min(soc_power_limit_w, 3500)
    
    # SOC derating
    if current_soc < 30 and voltage < 51.0:
        soc_derating = 0.7
    else:
        soc_derating = 1.0
    
    final_power_limit_w = power_clamped_w * soc_derating
    
    # Calculate discharge amperes
    if current_soc >= SOC_MAX:
        discharge_a = FLAT_DISCHARGE_A
    else:
        discharge_a = min(final_power_limit_w / voltage, FLAT_DISCHARGE_A)
    
    discharge_a_values.append(discharge_a)
    
    # Actual battery output (cannot exceed load)
    battery_w = min(discharge_a * voltage, LOAD_W)
    battery_output_w.append(battery_w)
    
    # Grid input (rest of load)
    grid_w = max(0, LOAD_W - battery_w)
    grid_input_w.append(grid_w)
    
    # Update SOC for next iteration
    energy_consumed_wh = battery_w * (dt_minutes / 60)
    soc_change = (energy_consumed_wh / BATTERY_CAPACITY_WH) * 100
    current_soc = max(current_soc - soc_change, 10)  # Floor at 10%
    
    current_time = current_time + timedelta(minutes=dt_minutes)

# Convert times to hours from start
time_hours = [(t - start_time).total_seconds() / 3600 for t in times]

# Create the plot
fig, axes = plt.subplots(4, 1, figsize=(12, 10), sharex=True)
fig.suptitle('Deye Battery Discharge Curve - 2500W Constant Load from 17:00\nv1.0.36: 15-30% SOC Curve, 60A Max, Voltage-Safe Protection', 
             fontsize=14, fontweight='bold')

# Plot 1: SOC
axes[0].plot(time_hours, soc_values, 'b-', linewidth=2, label='Battery SOC')
axes[0].axhline(y=30, color='g', linestyle='--', alpha=0.5, label='SOC_MAX (30%)')
axes[0].axhline(y=15, color='orange', linestyle='--', alpha=0.5, label='SOC_MIN (15%)')
axes[0].set_ylabel('SOC (%)', fontsize=11, fontweight='bold')
axes[0].grid(True, alpha=0.3)
axes[0].legend(loc='upper right')
axes[0].set_ylim([10, 95])

# Plot 2: Voltage
axes[1].plot(time_hours, voltage_values, 'r-', linewidth=2, label='Battery Voltage')
axes[1].axhline(y=51.2, color='g', linestyle='--', alpha=0.5, label='Normal Zone (≥51.2V)')
axes[1].axhline(y=50.2, color='orange', linestyle='--', alpha=0.5, label='Soft Zone 2 (50.2V)')
axes[1].axhline(y=49.8, color='red', linestyle='--', alpha=0.5, label='Critical (49.8V)')
axes[1].set_ylabel('Voltage (V)', fontsize=11, fontweight='bold')
axes[1].grid(True, alpha=0.3)
axes[1].legend(loc='upper right')
axes[1].set_ylim([49.4, 53.0])

# Plot 3: Discharge Current
axes[2].plot(time_hours, discharge_a_values, 'purple', linewidth=2, label='Discharge Current')
axes[2].axhline(y=60, color='g', linestyle='--', alpha=0.5, label='Max (60A)')
axes[2].axhline(y=1, color='red', linestyle='--', alpha=0.5, label='Minimum (1A)')
axes[2].set_ylabel('Discharge (A)', fontsize=11, fontweight='bold')
axes[2].grid(True, alpha=0.3)
axes[2].legend(loc='upper right')
axes[2].set_ylim([0, 65])

# Plot 4: Power Distribution
axes[3].fill_between(time_hours, 0, battery_output_w, alpha=0.6, color='green', label='Battery Output')
axes[3].fill_between(time_hours, battery_output_w, [b+g for b,g in zip(battery_output_w, grid_input_w)], 
                     alpha=0.6, color='orange', label='Grid Input')
axes[3].axhline(y=LOAD_W, color='black', linestyle='-', linewidth=1, alpha=0.7, label=f'Total Load ({LOAD_W}W)')
axes[3].set_ylabel('Power (W)', fontsize=11, fontweight='bold')
axes[3].set_xlabel('Time from 17:00 (hours)', fontsize=11, fontweight='bold')
axes[3].grid(True, alpha=0.3)
axes[3].legend(loc='upper right')
axes[3].set_ylim([0, 3000])

# Format x-axis with time labels
time_labels = []
for h in range(0, 19, 2):  # Every 2 hours
    t = start_time + timedelta(hours=h)
    time_labels.append(t.strftime('%H:%M'))

axes[3].set_xticks(range(0, 19, 2))
axes[3].set_xticklabels(time_labels)

plt.tight_layout()
plt.savefig('/Users/janhjordie/Projects/janhjordie/HomeAutomation/discharge_curve_2500w.png', 
            dpi=150, bbox_inches='tight')
print("Plot saved to: discharge_curve_2500w.png")
print(f"\nKey metrics:")
print(f"  Initial SOC: {START_SOC}%")
print(f"  Final SOC: {soc_values[-1]:.1f}%")
print(f"  Final voltage: {voltage_values[-1]:.2f}V")
print(f"  Total battery energy used: {(START_SOC - soc_values[-1]) * BATTERY_CAPACITY_WH / 100:.0f}Wh")
print(f"  Time at minimum 1A: {sum(1 for d in discharge_a_values if d < 2) * dt_minutes / 60:.1f} hours")
