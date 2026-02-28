#!/usr/bin/env python3
import re
from collections import defaultdict

# Analyze voltage stability by SOC ranges
soc_ranges = {
    '80-90%': (80, 90),
    '70-79%': (70, 79),
    '60-69%': (60, 69),
    '50-59%': (50, 59),
    '40-49%': (40, 49),
    '30-39%': (30, 39),
    '20-29%': (20, 29),
    '<20%': (0, 19)
}

soc_data = defaultdict(lambda: {
    'voltages': [],
    'deltas': [],
    'loads': [],
    'batt_discharge': [],
    'grid_charge_count': 0
})

with open('/Users/janhjordie/Projects/janhjordie/HomeAutomation/HomeAssistant/deye_weekly_log-7.csv', 'r') as f:
    for line in f:
        soc_match = re.search(r'soc=([\d.]+)', line)
        v_match = re.search(r'volt=([\d.]+)', line)
        vd_match = re.search(r'volt_delta=([-\d.]+)', line)
        load_match = re.search(r'load_w=([\d.]+)', line)
        batt_match = re.search(r'batt_discharge_w=([\d.]+)', line)
        
        if not all([soc_match, v_match, vd_match]):
            continue
        
        soc = float(soc_match.group(1))
        volt = float(v_match.group(1))
        volt_delta = abs(float(vd_match.group(1)))
        load = float(load_match.group(1)) if load_match else 0
        batt_discharge = float(batt_match.group(1)) if batt_match else 0
        
        # Find appropriate SOC range
        for range_name, (min_soc, max_soc) in soc_ranges.items():
            if min_soc <= soc <= max_soc:
                soc_data[range_name]['voltages'].append(volt)
                soc_data[range_name]['deltas'].append(volt_delta)
                soc_data[range_name]['loads'].append(load)
                soc_data[range_name]['batt_discharge'].append(batt_discharge)
                if 'grid_charge=on' in line:
                    soc_data[range_name]['grid_charge_count'] += 1
                break

print("="*90)
print("VOLTAGE STABILITY BY STATE OF CHARGE (SOC) - Last 2 Days")
print("="*90)

# Sort SOC ranges from high to low for display
sorted_ranges = ['80-90%', '70-79%', '60-69%', '50-59%', '40-49%', '30-39%', '20-29%', '<20%']

for range_name in sorted_ranges:
    data = soc_data[range_name]
    if not data['voltages']:
        continue
    
    voltages = data['voltages']
    deltas = data['deltas']
    loads = data['loads']
    count = len(voltages)
    
    stable_pct = 100 * sum(1 for d in deltas if d < 0.3) / len(deltas)
    problem_pct = 100 * sum(1 for v in voltages if v < 49.2) / len(voltages)
    critical_pct = 100 * sum(1 for v in voltages if v < 48.0) / len(voltages)
    emergency_pct = 100 * sum(1 for v in voltages if v < 47.2) / len(voltages)
    
    # Determine health icon
    if stable_pct > 70 and problem_pct < 5:
        icon = "✅"
    elif stable_pct > 40 and problem_pct < 20:
        icon = "⚠️ "
    else:
        icon = "🔴"
    
    print(f"\n{icon} SOC {range_name} ({count:,} samples, {count/34.3:.1f}% of time)")
    print("-"*90)
    print(f"  Voltage:       {min(voltages):.2f}V - {max(voltages):.2f}V  (avg: {sum(voltages)/len(voltages):.2f}V)")
    print(f"  Avg Load:      {sum(loads)/len(loads):.0f}W")
    print(f"  Stability:     {stable_pct:.1f}% (<0.3V/min change)")
    print(f"  Avg Δ/min:     {sum(deltas)/len(deltas):.3f}V")
    print(f"  Max Δ/min:     {max(deltas):.3f}V")
    print(f"  Voltage <49.2V: {problem_pct:.1f}% of time")
    print(f"  Voltage <48.0V: {critical_pct:.1f}% of time")
    print(f"  Voltage <47.2V: {emergency_pct:.1f}% of time")
    print(f"  Grid charging: {data['grid_charge_count']} times")

print(f"\n{'='*90}")
print("INSIGHTS & RECOMMENDATIONS")
print(f"{'='*90}")

# Find best and worst SOC ranges
best_soc = None
worst_soc = None
best_stability = 0
worst_stability = 100

for range_name in sorted_ranges:
    data = soc_data[range_name]
    if not data['voltages']:
        continue
    
    stability = 100 * sum(1 for d in data['deltas'] if d < 0.3) / len(data['deltas'])
    
    if stability > best_stability:
        best_stability = stability
        best_soc = range_name
    
    if stability < worst_stability:
        worst_stability = stability
        worst_soc = range_name

print(f"\n📊 Most Stable SOC Range: {best_soc} ({best_stability:.1f}% stable)")
print(f"📊 Least Stable SOC Range: {worst_soc} ({worst_stability:.1f}% stable)")

# Identify safe operating zone
safe_ranges = []
for range_name in sorted_ranges:
    data = soc_data[range_name]
    if not data['voltages']:
        continue
    
    stability = 100 * sum(1 for d in data['deltas'] if d < 0.3) / len(data['deltas'])
    problem = 100 * sum(1 for v in data['voltages'] if v < 49.2) / len(data['voltages'])
    
    if stability > 40 and problem < 20:
        safe_ranges.append(range_name)

if safe_ranges:
    print(f"\n✅ Safe Operating Zone: {', '.join(safe_ranges)}")
    print(f"   (>40% stability & <20% problematic voltage)")
else:
    print(f"\n⚠️  No clearly safe operating zone identified - battery shows stress at all SOC levels")

# Check for stuck SOCs
for range_name in sorted_ranges:
    data = soc_data[range_name]
    if not data['voltages']:
        continue
    
    emergency = 100 * sum(1 for v in data['voltages'] if v < 47.2) / len(data['voltages'])
    
    if emergency > 30:  # If >30% of time in emergency voltage
        print(f"\n⚠️  SOC {range_name}: Excessive emergency voltage events ({emergency:.1f}%)")
        print(f"    This suggests BMS protection mode or cell imbalance at this SOC level")

print(f"\n🎯 Recommended Actions Based on SOC Analysis:")
print(f"   1. Avoid discharging below the least stable SOC range")
print(f"   2. Monitor cell balance if instability occurs at specific SOC levels")
print(f"   3. Consider capacity test if voltage instability spans multiple SOC ranges")
