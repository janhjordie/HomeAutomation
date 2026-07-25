EV Charge Planner optimizes electric vehicle charging using Danish 15-minute spot prices.

Features:
- Day window (09:00-17:00): charge when spot < threshold OR cheapest planned slots
- Night window (21:00-06:00): same 15-minute logic
- Force charge override during daytime
- One-shot charge mode with deadline
- Virtual device per charger (pair twice for two EVs)
- Optional Logic variable mirroring for parallel migration from HomeyScript

Requirements:
- Homey Pro >= 13.0.0
- Strømligning API key in app settings (fallback when EDS is down)

Install (development):
1. npm install -g homey
2. cd Homey/com.janhjordie.evchargeplanner
3. homey app install
4. Open app settings in Homey and paste Strømligning API key

Pair devices (IMPORTANT — not from app settings page):
1. Homey app → Enheder → + (Tilføj enhed)
2. Scroll ned til sektionen Apps / Homey apps
3. Vælg "EV Charge Planner" eller "EV Ladeplan"
4. Vælg "EV Ladeplan" i listen og tryk Tilføj
5. Gentag for anden bil hvis nødvendigt

If the app does not appear under Tilføj enhed:
- Restart the app (Apps → EV Charge Planner → Restart)
- Reinstall: homey app install
- Check Homey app log for "EV Planner driver initialized"
