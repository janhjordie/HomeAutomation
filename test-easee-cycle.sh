#!/usr/bin/env bash
set -euo pipefail

PLANNER_ID="${1:-4039cbdf-8ce4-4c30-8e5b-81a431752f5c}"
EASEE_ID="${2:-ecc2f7c6-b239-4281-9033-28c68272d8f2}"

read_state() {
  local label="$1"
  echo "=== ${label} ==="
  homey api raw --path "/api/manager/devices/device/${EASEE_ID}" --json --jq '{
    onoff: .capabilitiesObj.onoff.value,
    circuit: .capabilitiesObj["target_circuit_current"].value,
    power: .capabilitiesObj.measure_power.value,
    state: .capabilitiesObj.evcharger_charging_state.value
  }'
  homey api raw --path "/api/manager/devices/device/${PLANNER_ID}" --json --jq '{
    charge_now: .capabilitiesObj.charge_now.value,
    force_charge: .capabilitiesObj.force_charge.value,
    power: .capabilitiesObj.measure_power.value,
    message: .capabilitiesObj.charge_message.value
  }'
}

read_state "Før test"
echo "=== Start: force_charge=true + evaluate (virker kun 09-17 for charge_now) ==="
homey api devices set-capability-value --device-id "$PLANNER_ID" --capability-id force_charge --value true --json
sleep 2
homey api raw --path /api/app/com.janhjordie.evchargeplanner/evaluate-all -X POST --json
sleep 3
read_state "Efter start"

echo "=== Stop: force_charge=false + evaluate ==="
homey api devices set-capability-value --device-id "$PLANNER_ID" --capability-id force_charge --value false --json
sleep 2
homey api raw --path /api/app/com.janhjordie.evchargeplanner/evaluate-all -X POST --json
sleep 3
read_state "Efter stop"
