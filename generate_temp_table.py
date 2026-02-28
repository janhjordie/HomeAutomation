#!/usr/bin/env python3
import re
from collections import defaultdict

def create_temperature_table():
    # Data storage
    temp_data = defaultdict(list)

    # Read and parse CSV
    with open('HomeAssistant/ecodan/ecodan_curve_samples-3.csv', 'r') as f:
        for line in f:
            outdoor_match = re.search(r'outdoor_avg_60m=([-\d.]+)', line)
            flow_match = re.search(r'flow_avg_10m=([\d.]+)', line)
            
            if outdoor_match and flow_match:
                outdoor_temp = float(outdoor_match.group(1))
                flow_temp = float(flow_match.group(1))
                temp_data[outdoor_temp].append(flow_temp)

    # Calculate averages and create table
    print("Heat Pump Temperature Correlation Table")
    print("=" * 50)
    print(f"{'Outdoor Temp (°C)':<16} {'Avg Flow Temp (°C)':<18} {'Samples'}")
    print("-" * 50)

    # Sort by outdoor temperature
    for outdoor_temp in sorted(temp_data.keys()):
        flow_temps = temp_data[outdoor_temp]
        avg_flow = sum(flow_temps) / len(flow_temps)
        sample_count = len(flow_temps)
        
        print(f"{outdoor_temp:>14.1f}       {avg_flow:>14.1f}       {sample_count:>7}")
    
    print("-" * 50)
    print(f"Total unique outdoor temperatures: {len(temp_data)}")
    print(f"Total data points: {sum(len(flows) for flows in temp_data.values())}")

if __name__ == "__main__":
    create_temperature_table()