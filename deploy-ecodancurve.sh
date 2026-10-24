#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${ROOT}/Homey/com.janhjordie.ecodancurve"

REQUIRED_FILES=(
  "app.json"
  "app.js"
  "README.txt"
  "assets/icon.svg"
  "settings/index.html"
  "assets/images/small.png"
  "assets/images/large.png"
  "assets/images/xlarge.png"
  "drivers/ecodan_curve/device.js"
  "drivers/ecodan_curve/driver.js"
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
  echo "Fejl: Manglende filer — kør 'homey app validate' først:" >&2
  for rel in "${missing[@]}"; do
    echo "  - ${rel}" >&2
  done
  exit 1
fi

echo "Validerer Ecodan Curve ..."
homey app validate --level debug -p "${APP_DIR}"

echo "Installerer Ecodan Curve på Homey ..."
if homey app install -p "${APP_DIR}" 2>/dev/null; then
  echo "Installeret via homey app install."
elif ! node "${ROOT}/scripts/homey-local-install.mjs" "${APP_DIR}"; then
  echo "Fejl: Install fejlede." >&2
  exit 1
fi
