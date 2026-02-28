#!/usr/bin/env python3
import re
from collections import defaultdict

def create_complete_temp_table():
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
    
    # Create table
    print("Complete Heat Pump Temperature Table")
    print("===================================")
    print("Outdoor °C | Avg Flow °C")
    print("-----------------------")
    
    # Sort by outdoor temperature and display all
    for outdoor_temp in sorted(temp_data.keys()):
        flow_temps = temp_data[outdoor_temp] 
        avg_flow = sum(flow_temps) / len(flow_temps)
        print(f"{outdoor_temp:>8.1f}   |   {avg_flow:>6.1f}")
    
    print("-----------------------")
    print(f"Total temperatures: {len(temp_data)}")

if __name__ == "__main__":
    create_complete_temp_table()