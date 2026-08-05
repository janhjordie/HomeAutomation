'use strict';

const { buildEaseeConfig, EaseeChargerController } = require('./easeeCharger');

async function syncEaseeCharger(homey, appSettings, chargeNow, log = () => {}) {
  const easeeConfig = buildEaseeConfig(appSettings);
  if (!easeeConfig.enabled) {
    return { easeeConfig, easeeResult: null };
  }

  const controller = new EaseeChargerController(homey, log);

  try {
    const easeeResult = await controller.applyChargeNow(easeeConfig, Boolean(chargeNow));
    return { easeeConfig, easeeResult };
  } catch (error) {
    log(`Easee sync fejlede: ${error.message}`);
    return {
      easeeConfig,
      easeeResult: {
        skipped: true,
        reason: 'easee_sync_error',
        error: error.message,
        chargeNow: Boolean(chargeNow)
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
  log = () => {}
}) {
  const nextChargeNow = Boolean(chargeNow);
  const previous = Boolean(previousChargeNow);
  const changed = nextChargeNow !== previous;

  const { easeeConfig, easeeResult } = await syncEaseeCharger(
    homey,
    appSettings,
    nextChargeNow,
    log
  );

  return {
    changed,
    chargeNow: nextChargeNow,
    previousChargeNow: previous,
    easeeConfig,
    easeeResult,
    easeeState: easeeResult?.state || easeeState,
    shouldTriggerStarted: changed && nextChargeNow,
    shouldTriggerStopped: changed && !nextChargeNow
  };
}

module.exports = {
  syncEaseeCharger,
  orchestrateChargeTransition
};
