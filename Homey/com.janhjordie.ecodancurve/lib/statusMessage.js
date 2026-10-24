'use strict';

const STATUS_LABELS = {
  flow_applied: 'Skrevet til pumpe',
  calculated: 'Klar',
  noop: 'OK (deadband)',
  control_disabled: 'Kurvestyring fra',
  not_heating: 'Venter: ikke varme',
  heatpump_not_found: 'Heatpump mangler',
  thermostat_mode_room: 'Ikke flow-mode',
  skipped: 'Ikke skrevet'
};

function formatOffsetSigned(offsetC) {
  const value = Number(offsetC) || 0;
  if (value === 0) {
    return '0';
  }
  return value > 0 ? `+${value}` : String(value);
}

function formatCurveTargetInfo(targetFlow, targetFlowBase, curveOffset, options = {}) {
  if (targetFlow == null || targetFlowBase == null) {
    return '—';
  }
  const offset = Number(curveOffset) || 0;
  let line;
  if (offset === 0) {
    line = `Mål ${targetFlow} °C · kurve ${targetFlowBase} °C · offset 0`;
  } else {
    line = `Mål ${targetFlow} °C · kurve ${targetFlowBase} °C · offset ${formatOffsetSigned(offset)}`;
  }

  const physicalMin = Number(options.physicalFlowMinC);
  if (Number.isFinite(physicalMin) && targetFlow < physicalMin) {
    line += ` · fysisk min ca. ${physicalMin} °C (ignorer målt fremløb)`;
  }
  return line;
}

function formatCurveStatusMessage(status, sampleReason) {
  let text = STATUS_LABELS[status] || String(status || '—');
  if (sampleReason) {
    text += ` · ${sampleReason}`;
  }
  if (text.length > 48) {
    return `${text.slice(0, 45)}…`;
  }
  return text;
}

module.exports = {
  formatOffsetSigned,
  formatCurveTargetInfo,
  formatCurveStatusMessage
};
