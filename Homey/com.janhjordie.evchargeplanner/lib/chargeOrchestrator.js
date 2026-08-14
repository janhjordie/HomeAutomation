'use strict';

const {
  buildEaseeConfig,
  EaseeChargerController,
  shouldStartEasee,
  shouldStopEasee
} = require('./easeeCharger');

function easeeNeedsSync(chargeNow, state, circuitCurrent) {
  if (!state) {
    return true;
  }

  if (chargeNow) {
    return shouldStartEasee(state, circuitCurrent);
  }

  return shouldStopEasee(state);
}

async function syncEaseeCharger(homey, appSettings, chargeNow, log = () => {}, options = {}) {
  const easeeConfig = buildEaseeConfig(appSettings);
  if (!easeeConfig.enabled) {
    return { easeeConfig, easeeResult: null };
  }

  const controller = new EaseeChargerController(homey, log);
  const knownState = options.knownState
    || await controller.readState(easeeConfig, { cacheMs: options.cacheMs });

  if (!options.forceSync && !easeeNeedsSync(Boolean(chargeNow), knownState, easeeConfig.circuitCurrent)) {
    return {
      easeeConfig,
      easeeResult: {
        action: 'noop',
        skipped: true,
        reason: 'easee_state_matches',
        chargeNow: Boolean(chargeNow),
        state: knownState
      }
    };
  }

  try {
    const easeeResult = await controller.applyChargeNow(
      easeeConfig,
      Boolean(chargeNow),
      {
        knownState,
        forceRefresh: options.forceRefresh
      }
    );
    return { easeeConfig, easeeResult };
  } catch (error) {
    log(`Easee sync fejlede: ${error.message}`);
    return {
      easeeConfig,
      easeeResult: {
        skipped: true,
        reason: 'easee_sync_error',
        error: error.message,
        chargeNow: Boolean(chargeNow),
        state: knownState
      }
    };
  }
}

async function orchestrateChargeTransition({
  homey,
  appSettings,
  chargeNow,
  previousChargeNow,
  easeeState = null,
  log = () => {},
  forceEaseeSync = false
}) {
  const nextChargeNow = Boolean(chargeNow);
  const previous = Boolean(previousChargeNow);
  const changed = nextChargeNow !== previous;
  const easeeConfig = buildEaseeConfig(appSettings);

  let knownState = easeeState;
  if (easeeConfig.enabled && !knownState) {
    const controller = new EaseeChargerController(homey, log);
    knownState = await controller.readState(easeeConfig);
  }

  const needsEaseeSync = easeeConfig.enabled
    && (forceEaseeSync || changed || easeeNeedsSync(nextChargeNow, knownState, easeeConfig.circuitCurrent));

  const { easeeResult } = needsEaseeSync
    ? await syncEaseeCharger(homey, appSettings, nextChargeNow, log, {
      knownState,
      forceSync: forceEaseeSync || changed,
      forceRefresh: forceEaseeSync || changed
    })
    : {
      easeeConfig,
      easeeResult: {
        action: 'noop',
        skipped: true,
        reason: 'easee_sync_skipped',
        chargeNow: nextChargeNow,
        state: knownState
      }
    };

  return {
    changed,
    chargeNow: nextChargeNow,
    previousChargeNow: previous,
    easeeConfig,
    easeeResult,
    easeeState: easeeResult?.state || knownState,
    shouldTriggerStarted: changed && nextChargeNow,
    shouldTriggerStopped: changed && !nextChargeNow
  };
}

module.exports = {
  easeeNeedsSync,
  syncEaseeCharger,
  orchestrateChargeTransition
};
