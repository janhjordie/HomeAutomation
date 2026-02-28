#!/usr/bin/env python3
import re
from datetime import datetime
from collections import defaultdict

def analyze_evening_periods():
    print('EVENING PERIOD ANALYSIS (17:00-22:00)')
    print('=' * 70)
    print('Focusing on the Critical Period: 17:00-22:00')
    print('(Previously: high electricity prices + peak loads + heat pump + cooking)')
    print()

    evening_data = []
    evening_voltages = []
    evening_socs = []
    evening_loads = []
    evening_battery_power = []
    evening_discharge_limits = []
    rescue_events_evening = 0
    
    total_evening_minutes = 0
    
    with open('HomeAssistant/deye_weekly_log-8.csv', 'r') as f:
        for line in f:
            # Extract timestamp
            ts_match = re.match(r'^([^,]+)', line)
            if ts_match:
                try:
                    # Parse timestamp
                    dt_str = ts_match.group(1).replace('T', ' ').split('+')[0]
                    dt = datetime.fromisoformat(dt_str)
                    
                    # Check if time is in evening period (17:00-22:00)
                    if 17 <= dt.hour <= 21:  # 17:00-21:59 (up to but not including 22:00)
                        total_evening_minutes += 1
                        
                        # Extract all metrics for this evening sample
                        soc_match = re.search(r'soc=([\d.]+)', line)
                        volt_match = re.search(r'volt=([\d.]+)', line)
                        load_match = re.search(r'load_w=([\d.]+)', line)
                        batt_match = re.search(r'batt_w=([\d.]+)', line)
                        discharge_match = re.search(r'max_discharge_a=(\d+)', line)
                        
                        data_point = {
                            'timestamp': dt,
                            'date': dt.date(),
                            'time': dt.strftime('%H:%M')
                        }
                        
                        if soc_match:
                            soc = float(soc_match.group(1))
                            evening_socs.append(soc)
                            data_point['soc'] = soc
                            
                        if volt_match:
                            volt = float(volt_match.group(1))
                            evening_voltages.append(volt)
                            data_point['voltage'] = volt
                            
                        if load_match:
                            load = float(load_match.group(1))
                            evening_loads.append(load)
                            data_point['load_w'] = load
                            
                        if batt_match:
                            batt = float(batt_match.group(1))
                            evening_battery_power.append(batt)
                            data_point['battery_w'] = batt
                            
                        if discharge_match:
                            discharge = int(discharge_match.group(1))
                            evening_discharge_limits.append(discharge)
                            data_point['discharge_limit_a'] = discharge
                        
                        if 'grid_charge=on' in line:
                            rescue_events_evening += 1
                            data_point['rescue'] = True
                        
                        evening_data.append(data_point)
                        
                except:
                    continue
    
    # Summary statistics
    if not evening_voltages:
        print("No evening data found!")
        return
        
    min_volt = min(evening_voltages)
    max_volt = max(evening_voltages)
    avg_volt = sum(evening_voltages) / len(evening_voltages)
    
    min_soc = min(evening_socs)
    max_soc = max(evening_socs)
    avg_soc = sum(evening_socs) / len(evening_socs)
    
    avg_load = sum(evening_loads) / len(evening_loads) if evening_loads else 0
    max_load = max(evening_loads) if evening_loads else 0
    
    print(f'EVENING PERIOD SUMMARY ({total_evening_minutes} minutes analyzed)')
    print('=' * 70)
    print(f'Voltage Performance:')
    print(f'  Range: {min_volt:.2f}V - {max_volt:.2f}V')
    print(f'  Average: {avg_volt:.2f}V')
    print(f'  ✓ Emergency threshold (47.2V): {"SAFE" if min_volt >= 47.2 else "VIOLATED"}')
    print(f'  ✓ Panic threshold (47.8V): {"SAFE" if min_volt >= 47.8 else "VIOLATED"}')
    print(f'  ✓ Hard rescue threshold (48.0V): {"SAFE" if min_volt >= 48.0 else "VIOLATED"}')
    print(f'  ✓ Warning threshold (49.2V): {"SAFE" if min_volt >= 49.2 else "VIOLATED"}')
    
    print(f'\nSOC Performance:')
    print(f'  Range: {min_soc:.1f}% - {max_soc:.1f}%')
    print(f'  Average: {avg_soc:.1f}%')
    
    print(f'\nLoad Analysis:')
    print(f'  Average Load: {avg_load:.0f}W')
    print(f'  Peak Load: {max_load:.0f}W')
    print(f'  Heat Pump Impact: {"MINIMAL" if avg_load < 2000 else "HIGH"}')
    
    # Voltage category analysis
    voltage_categories = defaultdict(int)
    for volt in evening_voltages:
        if volt >= 53.0:
            voltage_categories['Excellent (≥53.0V)'] += 1
        elif volt >= 52.0:
            voltage_categories['Good (52.0-52.9V)'] += 1
        elif volt >= 51.0:
            voltage_categories['Fair (51.0-51.9V)'] += 1
        elif volt >= 50.0:
            voltage_categories['Poor (50.0-50.9V)'] += 1
        else:
            voltage_categories['Critical (<50.0V)'] += 1
    
    print(f'\nEvening Voltage Distribution:')
    for category, count in sorted(voltage_categories.items(), reverse=True):
        pct = (count / len(evening_voltages)) * 100
        print(f'  {category}: {count} samples ({pct:.1f}%)')
    
    # Daily evening comparison
    print(f'\nDaily Evening Performance:')
    daily_evening = defaultdict(lambda: {'voltages': [], 'socs': [], 'loads': [], 'rescues': 0})
    
    for data in evening_data:
        date = data['date']
        if 'voltage' in data:
            daily_evening[date]['voltages'].append(data['voltage'])
        if 'soc' in data:
            daily_evening[date]['socs'].append(data['soc'])
        if 'load_w' in data:
            daily_evening[date]['loads'].append(data['load_w'])
        if data.get('rescue', False):
            daily_evening[date]['rescues'] += 1
    
    for date in sorted(daily_evening.keys()):
        day_data = daily_evening[date]
        if day_data['voltages']:
            avg_v = sum(day_data['voltages']) / len(day_data['voltages'])
            min_v = min(day_data['voltages'])
            avg_soc = sum(day_data['socs']) / len(day_data['socs']) if day_data['socs'] else 0
            avg_load = sum(day_data['loads']) / len(day_data['loads']) if day_data['loads'] else 0
            print(f'  {date}: Avg Volt: {avg_v:.2f}V, Min Volt: {min_v:.2f}V, '
                  f'Avg SOC: {avg_soc:.1f}%, Avg Load: {avg_load:.0f}W, Rescues: {day_data["rescues"]}')
    
    print(f'\n{"=" * 70}')
    print(f'HEAT PUMP IMPACT ASSESSMENT')
    print(f'{"=" * 70}')
    
    # Compare to typical winter evening loads
    typical_winter_evening = 3000  # Typical winter evening with heat pump + cooking
    current_avg_load = avg_load
    reduction = typical_winter_evening - current_avg_load
    reduction_pct = (reduction / typical_winter_evening) * 100
    
    print(f'Load Reduction Analysis:')
    print(f'  Current Avg Evening Load: {current_avg_load:.0f}W')
    print(f'  Typical Winter Evening: ~{typical_winter_evening}W')
    print(f'  Load Reduction: {reduction:.0f}W ({reduction_pct:.1f}% decrease)')
    print(f'  Heat Pump Status: {"MINIMAL LOAD" if current_avg_load < 2000 else "STILL ACTIVE"}')
    
    print(f'\nBATTERY STRESS INDICATORS:')
    critical_voltage_time = sum(1 for v in evening_voltages if v < 49.2) / len(evening_voltages) * 100
    low_soc_time = sum(1 for s in evening_socs if s < 30) / len(evening_socs) * 100
    
    print(f'  Critical Voltage Time (<49.2V): {critical_voltage_time:.1f}%')
    print(f'  Low SOC Time (<30%): {low_soc_time:.1f}%')
    print(f'  Total Evening Rescues: {rescue_events_evening}')
    print(f'  Battery Stress Level: {"MINIMAL" if critical_voltage_time < 5 and rescue_events_evening < 50 else "MODERATE" if critical_voltage_time < 20 else "HIGH"}')

if __name__ == "__main__":
    analyze_evening_periods()