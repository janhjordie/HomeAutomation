#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${ROOT}/Homey/com.janhjordie.evchargeplanner"

if [[ ! -f "${APP_DIR}/app.json" ]]; then
  echo "Fejl: Homey app ikke fundet i ${APP_DIR}" >&2
  exit 1
fi

if ! command -v homey >/dev/null 2>&1; then
  echo "Fejl: homey CLI ikke installeret (npm install -g homey)" >&2
  exit 1
fi

echo "Installerer EV Charge Planner fra ${APP_DIR} ..."
cd "${APP_DIR}"
homey app install
