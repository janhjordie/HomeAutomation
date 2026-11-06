Sensor Watch (com.janhjordie.sensorwatch)
=========================================

Overvåger Zigbee-noder via Homeys node-liste
(samme data som https://tools.developer.homey.app/tools/zigbee ).

Standard model-filtre: `lumi.weather` og `lumi.sensor*` (wildcard — fx smoke, ht.agl02, magnet).
Signal: node `lastSeen` — hvis ældre end X timer → push (sandsynligvis dødt batteri).

Push: samme Homey mobil-push som EV Ladeplan (notification_user).

API:
  GET  /api/app/com.janhjordie.sensorwatch/status
  POST /api/app/com.janhjordie.sensorwatch/check-now
  POST /api/app/com.janhjordie.sensorwatch/test-push

Deploy:
  ./deploy-sensorwatch.sh
