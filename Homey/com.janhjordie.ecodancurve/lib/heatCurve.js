'use strict';

/**
 * Standard weather-compensation curve (DK / air-to-water HP):
 * - Mild plateau ~15–20 °C ude → minimum fremløb (Ecodan/mecloud min typisk 25 °C)
 * - Reference: 12 °C ude → 32 °C fremløb (dit tuningspunkt)
 * - Koldt design ~-12 °C ude (DS 418) → højere fremløb
 * Piecewise linear mellem punkter (som FTC/Ecodan “to punkter”, udvidet med plateau).
 */
const DEFAULT_CURVE_POINTS = [
  { outdoor: 20, flow: 25 },
  { outdoor: 15, flow: 29 },
  { outdoor: 12, flow: 32 },
  { outdoor: 0, flow: 42 },
  { outdoor: -12, flow: 48 }
];

function normalizePoints(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return [...DEFAULT_CURVE_POINTS];
  }

  const normalized = points
    .map((point) => ({
      outdoor: Number(point.outdoor),
      flow: Number(point.flow)
    }))
    .filter((point) => Number.isFinite(point.outdoor) && Number.isFinite(point.flow))
    .sort((a, b) => a.outdoor - b.outdoor);

  return normalized.length ? normalized : [...DEFAULT_CURVE_POINTS];
}

function interpolateFlow(outdoorC, points, options = {}) {
  const flowMin = Number(options.flowMin);
  const flowMax = Number(options.flowMax);
  const offset = Number(options.offset) || 0;
  const curve = normalizePoints(points);

  if (!Number.isFinite(outdoorC)) {
    return null;
  }

  const first = curve[0];
  const last = curve[curve.length - 1];
  let flow;

  if (outdoorC <= first.outdoor) {
    flow = first.flow;
  } else if (outdoorC >= last.outdoor) {
    flow = last.flow;
  } else {
    for (let i = 0; i < curve.length - 1; i++) {
      const left = curve[i];
      const right = curve[i + 1];
      if (outdoorC >= left.outdoor && outdoorC <= right.outdoor) {
        const span = right.outdoor - left.outdoor;
        const ratio = span === 0 ? 0 : (outdoorC - left.outdoor) / span;
        flow = left.flow + ratio * (right.flow - left.flow);
        break;
      }
    }
  }

  if (!Number.isFinite(flow)) {
    return null;
  }

  flow += offset;

  if (Number.isFinite(flowMin)) {
    flow = Math.max(flowMin, flow);
  }
  if (Number.isFinite(flowMax)) {
    flow = Math.min(flowMax, flow);
  }

  return Math.round(flow * 10) / 10;
}

function parseCurvePointsJson(raw) {
  if (!raw) {
    return normalizePoints(null);
  }

  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) {
      return normalizePoints(parsed);
    }
    if (parsed && Array.isArray(parsed.points)) {
      return normalizePoints(parsed.points);
    }
  } catch {
    return normalizePoints(null);
  }

  return normalizePoints(null);
}

function serializeCurvePoints(points) {
  return JSON.stringify(normalizePoints(points));
}

module.exports = {
  DEFAULT_CURVE_POINTS,
  normalizePoints,
  interpolateFlow,
  parseCurvePointsJson,
  serializeCurvePoints
};
