#!/usr/bin/env bash
set -euo pipefail

DRIVER_ID="homey:app:com.janhjordie.evchargeplanner:ev_planner"
DEVICE_NAME="${1:-EV Ladeplan}"
DEVICE_DATA_ID="${2:-ev-planner-primary}"

if ! command -v homey >/dev/null 2>&1; then
  echo "Fejl: homey CLI ikke installeret" >&2
  exit 1
fi

existing="$(homey api raw --path /api/manager/devices/device --json 2>/dev/null | python3 -c "
import json, sys
driver = sys.argv[1]
data = json.load(sys.stdin)
items = data if isinstance(data, list) else list(data.values())
matches = [d for d in items if d.get('driverId') == driver]
print(matches[0]['id'] if matches else '')
" "$DRIVER_ID" 2>/dev/null || true)"

if [[ -n "${existing}" ]]; then
  echo "EV Ladeplan findes allerede: ${existing}"
  exit 0
fi

echo "Opretter pair session ..."
session_id="$(homey api drivers create-pair-session \
  --body "{\"type\":\"pair\",\"driverId\":\"${DRIVER_ID}\"}" \
  --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"

echo "Parer ${DEVICE_NAME} ..."
device_json="$(homey api raw \
  --path "/api/manager/drivers/pairsession/${session_id}/device" \
  -X POST \
  --body "{\"name\":\"${DEVICE_NAME}\",\"data\":{\"id\":\"${DEVICE_DATA_ID}\"}}" \
  --json)"

device_id="$(printf '%s' "$device_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
echo "Oprettet EV Ladeplan: ${device_id}"

echo "Lukker pair session ..."
homey api drivers delete-pair-session --id "${session_id}" --json >/dev/null 2>&1 || true

echo "Genstarter app ..."
homey api apps restart-app --id com.janhjordie.evchargeplanner --json >/dev/null
sleep 5

echo "Kører første evaluering ..."
homey api raw --path /api/app/com.janhjordie.evchargeplanner/evaluate-all -X POST --json
