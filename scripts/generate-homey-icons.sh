#!/usr/bin/env bash
set -euo pipefail

if ! command -v magick >/dev/null 2>&1 && ! command -v convert >/dev/null 2>&1; then
  echo "ImageMagick (magick/convert) required" >&2
  exit 1
fi

IMG="${MAGICK:-magick}"
if ! command -v magick >/dev/null 2>&1; then
  IMG="convert"
fi

render_set() {
  local svg="$1"
  local out_dir="$2"
  mkdir -p "$out_dir"
  "$IMG" -background none "$svg" -resize 75x75 "$out_dir/small.png"
  "$IMG" -background none "$svg" -resize 500x500 "$out_dir/large.png"
  "$IMG" -background none "$svg" -resize 1000x1000 "$out_dir/xlarge.png"
}

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

render_set "$ROOT/Homey/com.janhjordie.ecodancurve/assets/icon.svg" \
  "$ROOT/Homey/com.janhjordie.ecodancurve/assets/images"
render_set "$ROOT/Homey/com.janhjordie.ecodancurve/drivers/ecodan_curve/assets/icon.svg" \
  "$ROOT/Homey/com.janhjordie.ecodancurve/drivers/ecodan_curve/assets/images"

render_set "$ROOT/Homey/com.janhjordie.evchargeplanner/assets/icon.svg" \
  "$ROOT/Homey/com.janhjordie.evchargeplanner/assets/images"
render_set "$ROOT/Homey/com.janhjordie.evchargeplanner/drivers/ev_planner/assets/icon.svg" \
  "$ROOT/Homey/com.janhjordie.evchargeplanner/drivers/ev_planner/assets/images"

echo "Homey icon PNGs generated."
