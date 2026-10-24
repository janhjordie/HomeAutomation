'use strict';

const { FLOW_TARGET_TIMELINE_INTERVAL_MS, FLOW_TARGET_TIMELINE_STARTUP_DEDUPE_MS } = require('./constants');

function roundFlowTarget(value) {
  if (value == null || !Number.isFinite(Number(value))) {
    return null;
  }
  return Math.round(Number(value) * 10) / 10;
}

function formatOutdoorFiltered(value) {
  if (value == null || !Number.isFinite(Number(value))) {
    return null;
  }
  return Math.round(Number(value) * 10) / 10;
}

function formatOffsetSigned(offsetC) {
  const value = Number(offsetC) || 0;
  if (value === 0) {
    return '0';
  }
  return value > 0 ? `+${value}` : String(value);
}

function formatFlowTargetTimelineExcerpt({
  targetFlow,
  outdoorFiltered,
  curveOffset,
  previousTarget
}) {
  const target = roundFlowTarget(targetFlow);
  const outdoor = formatOutdoorFiltered(outdoorFiltered);
  const prev = roundFlowTarget(previousTarget);

  let targetPart = `**${target} °C**`;
  if (prev != null && prev !== target) {
    targetPart = `**${target} °C** (fra ${prev} °C)`;
  }

  const outdoorPart = outdoor != null ? ` · ude filt. **${outdoor} °C**` : '';
  const offsetPart = ` · offset **${formatOffsetSigned(curveOffset)} °C**`;

  return `Ecodan fremløb ${targetPart}${outdoorPart}${offsetPart}`;
}

function shouldWriteFlowTargetTimeline({
  targetFlow,
  reason,
  lastLoggedTarget,
  lastLoggedAt,
  now = Date.now()
}) {
  const target = roundFlowTarget(targetFlow);
  if (target == null) {
    return { write: false, reason: 'no_target' };
  }

  const forceStartup = reason === 'app_boot';
  const lastAt = Number(lastLoggedAt) || 0;
  const elapsed = lastAt > 0 ? now - lastAt : Number.POSITIVE_INFINITY;
  const targetChanged = lastLoggedTarget !== target;

  if (forceStartup) {
    if (lastAt > 0 && elapsed < FLOW_TARGET_TIMELINE_STARTUP_DEDUPE_MS) {
      return { write: false, reason: 'startup_dedupe', target };
    }
    return { write: true, reason: 'app_boot', target };
  }

  if (lastAt <= 0) {
    return { write: false, reason: 'awaiting_app_boot', target };
  }

  if (targetChanged && elapsed >= FLOW_TARGET_TIMELINE_INTERVAL_MS) {
    return { write: true, reason: 'target_changed', target };
  }

  if (targetChanged) {
    return { write: false, reason: 'throttled', target };
  }

  return { write: false, reason: 'unchanged', target };
}

async function sendTimelineNotification(homey, message, log = () => {}) {
  if (typeof homey.flow?.runFlowCardAction === 'function') {
    try {
      await homey.flow.runFlowCardAction({
        uri: 'homey:flowcardaction:homey:manager:notifications:create_notification',
        id: 'homey:manager:notifications:create_notification',
        args: { text: message }
      });
      return true;
    } catch (error) {
      log(`Timeline (flow) fejlede: ${error.message}`);
    }
  }

  if (typeof homey.notifications?.createNotification === 'function') {
    try {
      await homey.notifications.createNotification({ excerpt: message });
      return true;
    } catch (error) {
      log(`Timeline fejlede: ${error.message}`);
    }
  }

  return false;
}

async function maybeNotifyFlowTargetTimeline(homey, device, context, log = () => {}) {
  const lastLoggedTarget = await device.getStoreValue('timeline_flow_target');
  const lastLoggedAt = await device.getStoreValue('timeline_flow_at');

  const decision = shouldWriteFlowTargetTimeline({
    targetFlow: context.targetFlow,
    reason: context.reason,
    lastLoggedTarget,
    lastLoggedAt
  });

  if (!decision.write) {
    return decision;
  }

  const excerpt = formatFlowTargetTimelineExcerpt({
    targetFlow: context.targetFlow,
    outdoorFiltered: context.outdoorFiltered,
    curveOffset: context.curveOffset,
    previousTarget: lastLoggedTarget
  });

  const sent = await sendTimelineNotification(homey, excerpt, log);
  if (!sent) {
    return { ...decision, write: false, reason: 'send_failed' };
  }

  const now = Date.now();
  await device.setStoreValue('timeline_flow_target', decision.target);
  await device.setStoreValue('timeline_flow_at', now);
  log(`Timeline: ${excerpt.replace(/\*\*/g, '')}`);

  return { ...decision, sent: true, excerpt };
}

module.exports = {
  formatFlowTargetTimelineExcerpt,
  shouldWriteFlowTargetTimeline,
  maybeNotifyFlowTargetTimeline
};
