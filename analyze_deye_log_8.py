#!/usr/bin/env python3
import re
from datetime import datetime
from collections import defaultdict

def analyze_deye_log_8():
    print('Detailed Analysis of deye_weekly_log-8.csv')
    print('=' * 70)

    # Initialize data structures
    timestamps = []
    discharge_limits = []
    soc_values = []
    voltage_values = []
    daily_stats = defaultdict(lambda: {'low_soc_count': 0, 'rescue_count': 0, 'avg_discharge_limit': []})
    
    # Read and parse the CSV file
    with open('HomeAssistant/deye_weekly_log-8.csv', 'r') as f:
        for line in f:
            # Extract timestamp
            ts_match = re.match(r'^([^,]+)', line)
            if ts_match:
                timestamps.append(ts_match.group(1))
                
                try:
                    dt = datetime.fromisoformat(ts_match.group(1).replace('T', ' ').split('+')[0])
                    date_key = dt.date()
                    
                    # Extract key metrics
                    soc_match = re.search(r'soc=([\d.]+)', line)
                    volt_match = re.search(r'volt=([\d.]+)', line)
                    discharge_match = re.search(r'max_discharge_a=(\d+)', line)
                    
                    if soc_match:
                        soc = float(soc_match.group(1))
                        soc_values.append(soc)
                        if soc < 25:
                            daily_stats[date_key]['low_soc_count'] += 1
                    
                    if volt_match:
                        voltage_values.append(float(volt_match.group(1)))
                    
                    if discharge_match:
                        discharge_limit = int(discharge_match.group(1))
                        discharge_limits.append(discharge_limit)
                        daily_stats[date_key]['avg_discharge_limit'].append(discharge_limit)
                    
                    if 'grid_charge=on' in line:
                        daily_stats[date_key]['rescue_count'] += 1
                        
                except:
                    continue

    # Time range analysis
    print(f'TIME RANGE: {timestamps[0]} to {timestamps[-1]}')
    print(f'TOTAL MONITORING PERIOD: {len(timestamps)} minutes ({len(timestamps)/60/24:.1f} days)')

    # Discharge current limiting analysis
    print(f'\n{"=" * 70}')
    print(f'DISCHARGE CURRENT LIMITING ANALYSIS')
    print(f'{"=" * 70}')
    
    discharge_distribution = defaultdict(int)
    for limit in discharge_limits:
        if limit <= 10:
            discharge_distribution['0-10A (Severe Limiting)'] += 1
        elif limit <= 20:
            discharge_distribution['11-20A (Heavy Limiting)'] += 1
        elif limit <= 40:
            discharge_distribution['21-40A (Moderate Limiting)'] += 1
        elif limit <= 60:
            discharge_distribution['41-60A (Light Limiting)'] += 1
        else:
            discharge_distribution['61+A (Normal Operation)'] += 1

    for range_name, count in sorted(discharge_distribution.items()):
        pct = (count/len(discharge_limits))*100
        print(f'  {range_name}: {count} occurrences ({pct:.1f}% of time)')

    # Daily statistics
    print(f'\n{"=" * 70}')
    print(f'DAILY STATISTICS')
    print(f'{"=" * 70}')
    
    for date in sorted(daily_stats.keys()):
        stats = daily_stats[date]
        avg_discharge = sum(stats['avg_discharge_limit'])/len(stats['avg_discharge_limit']) if stats['avg_discharge_limit'] else 0
        print(f'{date}: Low SOC (<25%): {stats["low_soc_count"]} times, '
              f'Rescues: {stats["rescue_count"]}, Avg Discharge: {avg_discharge:.0f}A')

    # Key findings summary
    print(f'\n{"=" * 70}')
    print(f'KEY FINDINGS SUMMARY')
    print(f'{"=" * 70}')
    
    min_soc = min(soc_values) if soc_values else 0
    max_soc = max(soc_values) if soc_values else 0
    avg_soc = sum(soc_values)/len(soc_values) if soc_values else 0
    
    min_volt = min(voltage_values) if voltage_values else 0
    max_volt = max(voltage_values) if voltage_values else 0
    avg_volt = sum(voltage_values)/len(voltage_values) if voltage_values else 0
    
    print(f'SOC Range: {min_soc:.1f}% - {max_soc:.1f}% (Average: {avg_soc:.1f}%)')
    print(f'Voltage Range: {min_volt:.2f}V - {max_volt:.2f}V (Average: {avg_volt:.2f}V)')
    print(f'Total Rescue Events: {sum(stats["rescue_count"] for stats in daily_stats.values())}')
    
    # Check for system performance
    severe_limiting_pct = (discharge_distribution.get('0-10A (Severe Limiting)', 0) / len(discharge_limits)) * 100
    critical_soc_time = (sum(1 for soc in soc_values if soc < 20) / len(soc_values)) * 100
    
    print(f'System Health Indicators:')
    print(f'  - Severe limiting (≤10A): {severe_limiting_pct:.1f}% of time') 
    print(f'  - Critical SOC (<20%): {critical_soc_time:.1f}% of time')
    print(f'  - No emergency voltage events (<47.2V): {"✓" if min_volt >= 47.2 else "✗"}')

if __name__ == "__main__":
    analyze_deye_log_8()