#!/usr/bin/env python3
import re

# Analyze voltage stability at different load levels
low_load_voltages = []
high_load_voltages = []
low_load_deltas = []
high_load_deltas = []

with open('/Users/janhjordie/Projects/janhjordie/HomeAutomation/HomeAssistant/deye_weekly_log-7.csv', 'r') as f:
    for line in f:
        v_match = re.search(r'volt=([\d.]+)', line)
        vd_match = re.search(r'volt_delta=([-\d.]+)', line)
        load_match = re.search(r'load_w=([\d.]+)', line)
        
        if not all([v_match, load_match, vd_match]):
            continue
        
        volt = float(v_match.group(1))
        load = float(load_match.group(1))
        volt_delta = abs(float(vd_match.group(1)))
        
        # Categorize by load
        if load <= 2500:
            low_load_voltages.append(volt)
            low_load_deltas.append(volt_delta)
        else:
            high_load_voltages.append(volt)
            high_load_deltas.append(volt_delta)

print("="*80)
print("VOLTAGE STABILITY: Load ≤2500W vs Load >2500W (Last 2 Days)")
print("="*80)

print(f"\n📊 LOAD ≤ 2500W PERIODS ({len(low_load_voltages):,} samples, {len(low_load_voltages)/34.3:.1f}% of time)")
print("-"*80)
if low_load_voltages:
    print(f"Voltage Range:     {min(low_load_voltages):.2f}V - {max(low_load_voltages):.2f}V")
    print(f"Voltage Average:   {sum(low_load_voltages)/len(low_load_voltages):.2f}V")
    print(f"Voltage Spread:    {max(low_load_voltages) - min(low_load_voltages):.2f}V")
    print(f"Avg Change/min:    {sum(low_load_deltas)/len(low_load_deltas):.3f}V")
    print(f"Max Change/min:    {max(low_load_deltas):.3f}V")
    print(f"Changes >0.5V/min: {sum(1 for d in low_load_deltas if d > 0.5):,} ({100*sum(1 for d in low_load_deltas if d > 0.5)/len(low_load_deltas):.1f}%)")
    print(f"Changes >1.0V/min: {sum(1 for d in low_load_deltas if d > 1.0):,} ({100*sum(1 for d in low_load_deltas if d > 1.0)/len(low_load_deltas):.1f}%)")
    print(f"Changes >2.0V/min: {sum(1 for d in low_load_deltas if d > 2.0):,} ({100*sum(1 for d in low_load_deltas if d > 2.0)/len(low_load_deltas):.1f}%)")
    print(f"Voltage <49.2V:    {sum(1 for v in low_load_voltages if v < 49.2):,} ({100*sum(1 for v in low_load_voltages if v < 49.2)/len(low_load_voltages):.1f}%)")
    print(f"Voltage <48.0V:    {sum(1 for v in low_load_voltages if v < 48.0):,} ({100*sum(1 for v in low_load_voltages if v < 48.0)/len(low_load_voltages):.1f}%)")

print(f"\n📊 LOAD > 2500W PERIODS ({len(high_load_voltages):,} samples, {len(high_load_voltages)/34.3:.1f}% of time)")
print("-"*80)
if high_load_voltages:
    print(f"Voltage Range:     {min(high_load_voltages):.2f}V - {max(high_load_voltages):.2f}V")
    print(f"Voltage Average:   {sum(high_load_voltages)/len(high_load_voltages):.2f}V")
    print(f"Voltage Spread:    {max(high_load_voltages) - min(high_load_voltages):.2f}V")
    print(f"Avg Change/min:    {sum(high_load_deltas)/len(high_load_deltas):.3f}V")
    print(f"Max Change/min:    {max(high_load_deltas):.3f}V")
    print(f"Changes >0.5V/min: {sum(1 for d in high_load_deltas if d > 0.5):,} ({100*sum(1 for d in high_load_deltas if d > 0.5)/len(high_load_deltas):.1f}%)")
    print(f"Changes >1.0V/min: {sum(1 for d in high_load_deltas if d > 1.0):,} ({100*sum(1 for d in high_load_deltas if d > 1.0)/len(high_load_deltas):.1f}%)")
    print(f"Changes >2.0V/min: {sum(1 for d in high_load_deltas if d > 2.0):,} ({100*sum(1 for d in high_load_deltas if d > 2.0)/len(high_load_deltas):.1f}%)")
    print(f"Voltage <49.2V:    {sum(1 for v in high_load_voltages if v < 49.2):,} ({100*sum(1 for v in high_load_voltages if v < 49.2)/len(high_load_voltages):.1f}%)")
    print(f"Voltage <48.0V:    {sum(1 for v in high_load_voltages if v < 48.0):,} ({100*sum(1 for v in high_load_voltages if v < 48.0)/len(high_load_voltages):.1f}%)")

print(f"\n{'='*80}")
print("COMPARISON SUMMARY")
print(f"{'='*80}")
if low_load_voltages and high_load_voltages:
    low_stable = sum(1 for d in low_load_deltas if d < 0.3) / len(low_load_deltas) * 100
    high_stable = sum(1 for d in high_load_deltas if d < 0.3) / len(high_load_deltas) * 100
    print(f"✅ Stability (<0.3V/min change):")
    print(f"  Low Load (≤2500W):  {low_stable:.1f}% stable")
    print(f"  High Load (>2500W): {high_stable:.1f}% stable")
    print(f"  Improvement:        {low_stable - high_stable:+.1f} percentage points")
    
    low_problem = sum(1 for v in low_load_voltages if v < 49.2) / len(low_load_voltages) * 100
    high_problem = sum(1 for v in high_load_voltages if v < 49.2) / len(high_load_voltages) * 100
    print(f"\n⚠️  Problematic Voltage (<49.2V):")
    print(f"  Low Load (≤2500W):  {low_problem:.1f}% of time")
    print(f"  High Load (>2500W): {high_problem:.1f}% of time")
    
    low_critical = sum(1 for v in low_load_voltages if v < 48.0) / len(low_load_voltages) * 100
    high_critical = sum(1 for v in high_load_voltages if v < 48.0) / len(high_load_voltages) * 100
    print(f"\n🔴 Critical Voltage (<48.0V):")
    print(f"  Low Load (≤2500W):  {low_critical:.1f}% of time")
    print(f"  High Load (>2500W): {high_critical:.1f}% of time")

print(f"\n{'='*80}")
print("USER CLAIM: 'Voltage is very stable when usage is max around 2500W'")
print(f"{'='*80}")
if low_load_voltages and high_load_voltages:
    if low_stable > 60 and low_stable > high_stable + 20:
        print(f"✅ CONFIRMED - {low_stable:.0f}% stable at low load vs {high_stable:.0f}% at high load")
        print(f"   Voltage is significantly more stable when load ≤2500W")
    elif low_stable > 40 and low_stable > high_stable + 10:
        print(f"⚠️  PARTIALLY TRUE - {low_stable:.0f}% stable vs {high_stable:.0f}% at high load")
        print(f"   Modest improvement, but still considerable instability")
    else:
        print(f"❌ NOT SUPPORTED - {low_stable:.0f}% stable vs {high_stable:.0f}% at high load")
        print(f"   Similar instability at both load levels")
