import jinja2

template = """
{% set soc = 26 %}
{% set is_winter = False %}
{% set is_summer_load = True %}
{% set is_high_load_stress = False %}

      {% set W_SOC_T1 = 40 %}
      {% set W_SOC_T2 = 32 %}
      {% set W_SOC_T3 = 26 %}
      {% set W_SOC_T4 = 20 %}
      {% set W_SOC_T5 = 15 %}

      {% set S_SOC_T1 = 30 %}
      {% set S_SOC_T2 = 26 %}
      {% set S_SOC_T3 = 22 %}
      {% set S_SOC_T4 = 18 %}
      {% set S_SOC_T5 = 15 %}
      
      {% set SOC_T1 = S_SOC_T1 if is_summer_load else W_SOC_T1 %}
      {% set SOC_T2 = S_SOC_T2 if is_summer_load else W_SOC_T2 %}
      {% set SOC_T3 = S_SOC_T3 if is_summer_load else W_SOC_T3 %}
      {% set SOC_T4 = S_SOC_T4 if is_summer_load else W_SOC_T4 %}
      {% set SOC_T5 = S_SOC_T5 if is_summer_load else W_SOC_T5 %}

      {% set W_V1 = 60 %}
      {% set W_V2 = 50 %}
      {% set W_V3 = 35 %}
      {% set W_V4 = 20 %}
      {% set W_V5 = 8 %}

      {% set S_V1 = 25 %}
      {% set S_V2 = 18 %}
      {% set S_V3 = 12 %}
      {% set S_V4 = 8 %}
      {% set S_V5 = 5 %}

      {% set v1 = W_V1 if is_winter else S_V1 %}
      {% set v2 = W_V2 if is_winter else S_V2 %}
      {% set v3 = W_V3 if is_winter else S_V3 %}
      {% set v4 = W_V4 if is_winter else S_V4 %}
      {% set v5 = W_V5 if is_winter else S_V5 %}
      
      {% if soc >= SOC_T1 %}
        Branch T1: {{ v1 }}
      {% elif soc >= SOC_T2 %}
        {% set ratio = (soc - SOC_T2) / (SOC_T1 - SOC_T2) %}
        Branch T2: {{ (v2 + (v1 - v2) * ratio) | round(0) }}
      {% elif soc >= SOC_T3 %}
        {% set ratio = (soc - SOC_T3) / (SOC_T2 - SOC_T3) %}
        Branch T3: {{ (v3 + (v2 - v3) * ratio) | round(0) }}
      {% elif soc >= SOC_T4 %}
        {% set ratio = (soc - SOC_T4) / (SOC_T3 - SOC_T4) %}
        Branch T4: {{ (v4 + (v3 - v4) * ratio) | round(0) }}
      {% elif soc >= SOC_T5 %}
        {% set ratio = (soc - SOC_T5) / (SOC_T4 - SOC_T5) %}
        Branch T5: {{ (v5 + (v4 - v5) * ratio) | round(0) }}
      {% else %}
        Min Branch
      {% endif %}
"""

print(jinja2.Template(template).render())
