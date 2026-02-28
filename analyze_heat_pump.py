#!/usr/bin/env python3
import re
from collections import defaultdict

def analyze_heat_pump_data():
    print('Heat Pump Performance Analysis - Ecodan Curve Samples 3')
    print('=' * 60)
    
    # Data storage
    temp_ranges = defaultdict(lambda: {
        'flow_temps': [], 'powers': [], 'frequencies': [], 'count': 0
    })
    
    # Read and parse CSV
    with open('HomeAssistant/ecodan/ecodan_curve_samples-3.csv', 'r') as f:
        for line in f:
            outdoor_match = re.search(r'outdoor_avg_60m=([-\d.]+)', line)
            flow_match = re.search(r'flow_avg_10m=([\d.]+)', line)
            power_match = re.search(r'powerNow=(\d+)', line)
            freq_match = re.search(r'freqNow=(\d+)', line)
            
            if outdoor_match and flow_match and power_match and freq_match:
                outdoor_temp = float(outdoor_match.group(1))
                flow_temp = float(flow_match.group(1))
                power = int(power_match.group(1))
                frequency = int(freq_match.group(1))
                
                # Group by temperature ranges
                if outdoor_temp < -5:
                    temp_range = 'Very Cold (< -5°C)'
                elif outdoor_temp < -2:
                    temp_range = 'Cold (-5 to -2°C)'
                elif outdoor_temp < 0:
                    temp_range = 'Freezing (-2 to 0°C)'
                elif outdoor_temp < 3:
                    temp_range = 'Cool (0 to 3°C)'
                elif outdoor_temp < 7:
                    temp_range = 'Mild (3 to 7°C)'
                elif outdoor_temp < 12:
                    temp_range = 'Moderate (7 to 12°C)'
                else:
                    temp_range = 'Warm (> 12°C)'
                
                temp_ranges[temp_range]['flow_temps'].append(flow_temp)
                temp_ranges[temp_range]['powers'].append(power)
                temp_ranges[temp_range]['frequencies'].append(frequency)
                temp_ranges[temp_range]['count'] += 1
    
    # Calculate and display averages
    print('\nOUTDOOR TEMPERATURE RANGE ANALYSIS:')
    print()
    
    for temp_range in sorted(temp_ranges.keys()):
        data = temp_ranges[temp_range]
        if data['count'] > 0:
            avg_flow = sum(data['flow_temps']) / len(data['flow_temps'])
            avg_power = sum(data['powers']) / len(data['powers'])
            avg_freq = sum(data['frequencies']) / len(data['frequencies'])
            
            print(f'{temp_range}:')
            print(f'  Samples: {data["count"]:,}')
            print(f'  Avg Flow Temperature: {avg_flow:.1f}°C')
            print(f'  Avg Power Consumption: {avg_power:.0f}W')
            print(f'  Avg Compressor Frequency: {avg_freq:.0f}Hz')
            print()
    
    # Overall statistics
    all_outdoor_temps = []
    all_flow_temps = []
    all_powers = []
    
    with open('HomeAssistant/ecodan/ecodan_curve_samples-3.csv', 'r') as f:
        for line in f:
            outdoor_match = re.search(r'outdoor_avg_60m=([-\d.]+)', line)
            flow_match = re.search(r'flow_avg_10m=([\d.]+)', line)
            power_match = re.search(r'powerNow=(\d+)', line)
            
            if outdoor_match and flow_match and power_match:
                all_outdoor_temps.append(float(outdoor_match.group(1)))
                all_flow_temps.append(float(flow_match.group(1)))
                all_powers.append(int(power_match.group(1)))
    
    print('OVERALL STATISTICS:')
    print(f'Total Samples: {len(all_outdoor_temps):,}')
    print(f'Outdoor Temperature Range: {min(all_outdoor_temps):.1f}°C to {max(all_outdoor_temps):.1f}°C')
    print(f'Average Outdoor Temperature: {sum(all_outdoor_temps)/len(all_outdoor_temps):.1f}°C')
    print(f'Flow Temperature Range: {min(all_flow_temps):.1f}°C to {max(all_flow_temps):.1f}°C')
    print(f'Average Flow Temperature: {sum(all_flow_temps)/len(all_flow_temps):.1f}°C')
    print(f'Average Power Consumption: {sum(all_powers)/len(all_powers):.0f}W')

if __name__ == "__main__":
    analyze_heat_pump_data()