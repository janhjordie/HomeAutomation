#!/usr/bin/env python3
import re
from collections import defaultdict

# Check for low voltage events and rescue activity
low_volt_count = defaultdict(int)
rescue_events = 0
ev_charging_events = 0
discharge_periods = []
low_volt_samples = []

with open('/Users/janhjordie/Projects/janhjordie/HomeAutomation/HomeAssistant/deye_weekly_log-7.csv', 'r') as f:
    for line in f:
        v_match = re.search(r'volt=([\d.]+)', line)
        s_match = re.search(r'soc=([\d.]+)', line)
        
        if v_match:
            volt = float(v_match.group(1))
            
            # Count critical voltage ranges
            if volt < 47.2:
                low_volt_count['<47.2V Emergency'] += 1
                if len(low_volt_samples) < 5:
                    low_volt_samples.append((line.split(',')[0], volt, s_match.group(1) if s_match else 'N/A'))
            elif volt < 48.0:
                low_volt_count['47.2-48.0V Panic'] += 1
            elif volt < 49.2:
                low_volt_count['48.0-49.2V Warning'] += 1
        
        if 'grid_charge=on' in line:
            rescue_events += 1
        if 'ev_charging_active=on' in line:
            ev_charging_events += 1

print("=" * 70)
print("VOLTAGE THRESHOLD ANALYSIS")
print("=" * 70)
for threshold, count in sorted(low_volt_count.items()):
    print(f"  {threshold}: {count} occurrences ({count/34.3:.1f}% of time)")

if low_volt_samples:
    print("\nSample Emergency Voltage Events (<47.2V):")
    for timestamp, volt, soc in low_volt_samples:
        print(f"  {timestamp} - {volt:.2f}V @ {soc}% SOC")

print(f"\n{'=' * 70}")
print(f"SYSTEM INTERVENTION EVENTS")
print(f"{'=' * 70}")
print(f"Rescue Events (grid_charge=on): {rescue_events} occurrences")
print(f"EV Charging Active: {ev_charging_events} occurrences")

# Voltage stability metrics
with open('/Users/janhjordie/Projects/janhjordie/HomeAutomation/HomeAssistant/deye_weekly_log-7.csv', 'r') as f:
    volt_deltas = []
    for line in f:
        vd_match = re.search(r'volt_delta=([-\d.]+)', line)
        if vd_match:
            volt_deltas.append(abs(float(vd_match.group(1))))

print(f"\n{'=' * 70}")
print(f"VOLTAGE STABILITY METRICS")
print(f"{'=' * 70}")
print(f"Average voltage change per minute: {sum(volt_deltas)/len(volt_deltas):.3f}V")
print(f"Maximum voltage change per minute: {max(volt_deltas):.3f}V")
print(f"Voltage changes >0.5V/min: {sum(1 for d in volt_deltas if d > 0.5)}")
print(f"Voltage changes >1.0V/min: {sum(1 for d in volt_deltas if d > 1.0)}")
print(f"Voltage changes >2.0V/min: {sum(1 for d in volt_deltas if d > 2.0)}")
