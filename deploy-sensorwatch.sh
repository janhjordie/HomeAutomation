#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${ROOT}/Homey/com.janhjordie.sensorwatch"

if [[ ! -d "${APP_DIR}" ]]; then
  echo "Fejl: App-mappe ikke fundet: ${APP_DIR}" >&2
  exit 1
fi

if ! command -v homey >/dev/null 2>&1; then
  echo "Fejl: homey CLI ikke installeret (npm install -g homey)" >&2
  exit 1
fi

echo "Genererer ikoner ..."
bash "${ROOT}/scripts/generate-homey-icons.sh"

echo "Smoke tests ..."
node "${APP_DIR}/scripts/smoke-test.js"

if [[ -f "${APP_DIR}/package.json" ]]; then
  echo "Installerer app-afhængigheder (npm) ..."
  (cd "${APP_DIR}" && npm ci --omit=dev 2>/dev/null || npm install --omit=dev)
fi

echo "Bygger app.json fra compose ..."
homey app build -p "${APP_DIR}" 2>/dev/null || true

echo "Validerer Sensor Battery Watch ..."
if ! homey app validate --level debug -p "${APP_DIR}"; then
  echo "Fejl: App-validering fejlede." >&2
  exit 1
fi

echo "Installerer Sensor Battery Watch på Homey ..."
if homey app install -p "${APP_DIR}" 2>/dev/null; then
  echo "Installeret via homey app install."
elif ! node "${ROOT}/scripts/homey-local-install.mjs" "${APP_DIR}"; then
  echo "Fejl: Install fejlede. Tjek Homey/.homey-address eller HOMEY_ADDRESS." >&2
  exit 1
fi
