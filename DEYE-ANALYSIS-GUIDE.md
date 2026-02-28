# Deye Battery CSV Analysis Guide

## Trigger Phrase
**"Analyze HomeAssistant/deye_weekly_log-X.csv"** - Use this exact phrase to trigger comprehensive Deye battery analysis

## Analysis Focus Areas

### 🕕 **Critical Period: 17:00-22:00**
- **Primary focus**: Evening period with high electricity prices
- **Key insight**: When battery provides house load during peak pricing
- **99% relevance**: Most important data for battery performance assessment

### 📊 **Core Metrics to Analyze**

#### 1. **Voltage Safety Assessment**
```python
# Critical thresholds (from deye-rescue-01-panic.yaml)
- Emergency: < 47.2V (instant grid charge trigger)
- Panic: < 47.8V (instant grid charge trigger)  
- Hard rescue: < 48.0V (5 sec delay)
- Warning: < 49.2V (20 sec delay for high loads)
```

#### 2. **SOC Distribution Analysis**
```python
# SOC health ranges
- Critical: < 20% (emergency territory)
- Very Low: 20-25% (heavy limiting active)
- Low: 25-40% (moderate limiting) 
- Medium: 40-50% (light limiting)
- Good: > 50% (normal operation)
```

#### 3. **Discharge Current Limiting**
```python
# Limiting severity levels
- Severe: ≤ 10A (critical protection)
- Heavy: 11-20A (strong protection)
- Moderate: 21-40A (balanced protection)
- Light: 41-60A (mild protection)
- Normal: 61+A (no limiting)
```

#### 4. **Load Pattern Recognition**
```python
# Seasonal detection
- Summer mode: Avg load < 2200W (relaxed SOC tiers)
- Winter mode: Avg load ≥ 2200W (strict SOC tiers)
- Heat pump impact: Load reduction = stress elimination
```

### 🔍 **Analysis Workflow**

#### Step 1: Time Range & Data Volume
- Extract start/end timestamps
- Calculate monitoring period (days/hours)
- Count total data points

#### Step 2: Evening Period Deep Dive (17:00-22:00)
- Filter data for critical evening hours
- Analyze voltage min/max/average
- Check against all safety thresholds
- Calculate load averages and patterns

#### Step 3: System Intervention Assessment
- Count rescue events (`grid_charge=on`)
- Track EV charging periods (`ev_charging_active=on`)
- Measure discharge limiting frequency
- Identify stress indicators

#### Step 4: Seasonal Performance Comparison
- Compare current load vs typical seasonal values
- Calculate heat pump impact reduction
- Assess battery stress elimination

#### Step 5: Daily Trend Analysis
- Break down performance by day
- Track improvement/degradation patterns
- Identify optimal vs challenging periods

### 📋 **Report Generation**

#### Auto-Generate Report File
- **Location**: `HomeAssistant/deye_weekly_log-X-report.md`
- **Purpose**: Track progress and maintain analysis history
- **Format**: Structured markdown with key findings

#### Report Sections
1. **Executive Summary**
   - Overall system health status
   - Key performance indicators
   - Safety compliance verification

2. **Evening Period Analysis**
   - Voltage performance during critical hours
   - Load patterns and heat pump impact
   - Battery stress assessment

3. **System Interventions**
   - Rescue event frequency
   - Discharge limiting patterns
   - Emergency threshold violations

4. **Trend Insights**
   - Daily performance variations
   - Seasonal adaptation effectiveness
   - Recommendations for optimization

### 🎯 **Key Success Indicators**

#### ✅ **Excellent Performance**
- No voltage drops below 49.2V during evening hours
- Average evening load < 2000W (minimal heat pump)
- Zero rescue events during peak periods
- Discharge limiting < 10% of time

#### ⚠️ **Areas for Attention**  
- Voltage drops below 49.2V > 5% of evening time
- High rescue frequency (> 50 events/day)
- Severe limiting (≤ 10A) > 20% of time
- Average evening load > 2500W (active heat pump)

### 🔧 **Analysis Tools**

#### Python Analysis Template
```python
# Key analysis patterns to implement
1. Time-based filtering for evening periods
2. Voltage threshold violation counting  
3. SOC distribution analysis
4. Discharge limiting severity classification
5. Daily trend comparison
6. Load pattern seasonal detection
```

#### Output Requirements
- Console summary with key metrics
- Automated report generation 
- Daily breakdown tables
- Performance trend indicators
- Actionable recommendations

### 📈 **Historical Tracking**

Each analysis should:
- Compare to previous week's performance
- Track seasonal transition effects  
- Monitor SOC tier effectiveness
- Identify optimization opportunities
- Document system evolution

---

**Note**: This analysis framework focuses on the 17:00-22:00 period where 99% of battery stress occurs due to high electricity prices and peak household loads. The goal is to verify voltage safety, assess heat pump impact, and confirm operational effectiveness of the seasonal SOC tier system.