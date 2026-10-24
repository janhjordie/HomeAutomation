Ecodan Curve (com.janhjordie.ecodancurve)
=========================================

Weather-compensated flow temperature for Mitsubishi Ecodan via the mecloud (MELCloud) Homey app.

Default heat pump: device name "Heatpump" (id 4d696a96-ea94-4d7d-b97f-027e86658a80).

API:
  GET  /probe-heatpump  — read capabilities from Heatpump
  POST /evaluate-all    — run curve evaluation on all planner devices

Deploy: ../../deploy-ecodancurve.sh from repo root.

Smoke: npm run smoke
