#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${ROOT}/Homey/com.janhjordie.evchargeplanner"

REQUIRED_FILES=(
  "app.json"
  "app.js"
  "README.txt"
  "assets/icon.svg"
  "settings/index.html"
  "assets/images/small.png"
  "assets/images/large.png"
  "assets/images/xlarge.png"
  "drivers/ev_planner/device.js"
  "drivers/ev_planner/driver.js"
)

if [[ ! -d "${APP_DIR}" ]]; then
  echo "Fejl: App-mappe ikke fundet: ${APP_DIR}" >&2
  exit 1
fi

if ! command -v homey >/dev/null 2>&1; then
  echo "Fejl: homey CLI ikke installeret (npm install -g homey)" >&2
  exit 1
fi

missing=()
for rel in "${REQUIRED_FILES[@]}"; do
  if [[ ! -f "${APP_DIR}/${rel}" ]]; then
    missing+=("${rel}")
  fi
done

if ((${#missing[@]} > 0)); then
  echo "Fejl: Manglende filer i ${APP_DIR}:" >&2
  for rel in "${missing[@]}"; do
    echo "  - ${rel}" >&2
  done
  echo "Kør 'git pull' eller gendan filerne, og prøv igen." >&2
  exit 1
fi

if [[ ! -f "${APP_DIR}/env.json" && -f "${APP_DIR}/env.json.example" ]]; then
  cp "${APP_DIR}/env.json.example" "${APP_DIR}/env.json"
  echo "Oprettede env.json fra env.json.example"
fi

echo "Validerer EV Charge Planner ..."
if ! homey app validate --level debug -p "${APP_DIR}"; then
  echo "Fejl: App-validering fejlede. Tjek at assets/icon.svg og settings/index.html findes." >&2
  exit 1
fi

echo "Installerer EV Charge Planner på Homey (lokal API, uden Athom cloud) ..."
if ! node "${ROOT}/scripts/homey-local-install.mjs" "${APP_DIR}"; then
  echo "Fejl: Lokal install fejlede. Tjek Homey/.homey-address eller HOMEY_ADDRESS." >&2
  exit 1
fi
