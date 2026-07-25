'use strict';

// BacklogTrace: EVC-003, EVC-007
const {
  DK_TIME_ZONE,
  DEFAULT_CHARGE_HOURS,
  DEFAULT_ONE_SHOT_CHARGE_HOURS,
  DEFAULT_ONE_SHOT_READY_BY,
  DEFAULT_SPOT_CHARGE_THRESHOLD_KR_INCL_VAT,
  DEFAULT_CHARGER_KW,
  SLOT_MINUTES
} = require('./constants');
const { formatDateInTimeZone, addDays, getHourInTimeZone } = require('./timezone');
const { fetchPrices } = require('./price/fetchPrices');
const { findCurrentSlot, getSlotKey } = require('./price/slotBuilder');
const { getChargePlanWindow, getSlotsForWindow, isDayForceChargeActive } = require('./planner/windows');
const { buildWindowConfig } = require('./planner/windowConfig');
const { evaluateChargePlan } = require('./planner/chargePlan');
const {
  resolveOneShotDeadline,
  getOneShotWindowSlots,
  isOneShotFinished,
  formatChargeSchedule,
  formatChargeSlotsDetailed,
  buildChargeMessage
} = require('./planner/oneShot');
const { aggregateSlotsToHours, findCheapestDishwasherSlot } = require('./planner/dishwasher');

function buildDeviceConfig(settings = {}, appDefaults = {}) {
  const chargeHours = Number(settings.charge_hours);
  const defaultChargeHours = Number(appDefaults.default_charge_hours);
  const fallbackChargeHours = Number.isInteger(defaultChargeHours) && defaultChargeHours > 0
    ? defaultChargeHours
    : DEFAULT_CHARGE_HOURS;
  const oneShotHours = Number(settings.one_shot_charge_hours);

  return {
    chargeHours: Number.isInteger(chargeHours) && chargeHours > 0 ? chargeHours : fallbackChargeHours,
    forceCharge: Boolean(settings.force_charge),
    oneShotEnabled: Boolean(settings.one_shot_enabled),
    oneShotChargeHours: Number.isInteger(oneShotHours) && oneShotHours > 0
      ? oneShotHours
      : DEFAULT_ONE_SHOT_CHARGE_HOURS,
    oneShotReadyBy: String(settings.one_shot_ready_by || DEFAULT_ONE_SHOT_READY_BY).trim()
  };
}

function buildAppConfig(appSettings = {}, env = {}) {
  const defaultChargeHours = Number(appSettings.default_charge_hours);

  return {
    priceArea: appSettings.price_area || 'DK2',
    spotThreshold: Number(appSettings.spot_threshold) || DEFAULT_SPOT_CHARGE_THRESHOLD_KR_INCL_VAT,
    chargerKw: Number(appSettings.charger_kw) || DEFAULT_CHARGER_KW,
    stromligningApiKey: appSettings.stromligning_api_key || env.STROMLIGNING_API_KEY || '',
    timeZone: DK_TIME_ZONE,
    mirrorLogicVariables: appSettings.mirror_logic_variables !== false,
    defaultChargeHours: Number.isInteger(defaultChargeHours) && defaultChargeHours > 0
      ? defaultChargeHours
      : DEFAULT_CHARGE_HOURS,
    windowConfig: buildWindowConfig(appSettings)
  };
}

async function evaluateChargePlanForDevice(deviceConfig, appConfig, options = {}) {
  const now = options.now || new Date();
  const timeZone = appConfig.timeZone || DK_TIME_ZONE;
  const today = formatDateInTimeZone(now, timeZone);
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const currentHour = getHourInTimeZone(now, timeZone);

  const priceData = await fetchPrices({
    priceArea: appConfig.priceArea,
    stromligningApiKey: appConfig.stromligningApiKey,
    now,
    timeZone
  });

  const {
    allSlots,
    todaySlots,
    tomorrowSlots,
    priceSource,
    priceResolution,
    usesHourlyExpandedPrices,
    fetchLog
  } = priceData;

  const currentSlot = findCurrentSlot(allSlots, now, timeZone);
  let chargePlanWindow = getChargePlanWindow(
    currentHour,
    today,
    yesterday,
    tomorrow,
    appConfig.windowConfig
  );
  let chargeWindowSlots = getSlotsForWindow(allSlots, chargePlanWindow);
  let activeChargeHoursNeeded = deviceConfig.chargeHours;
  let oneShotActive = false;
  let oneShotDeadline = null;
  let oneShotDisabledReason = null;

  if (deviceConfig.oneShotEnabled) {
    oneShotDeadline = resolveOneShotDeadline(
      now,
      deviceConfig.oneShotReadyBy,
      today,
      tomorrow,
      timeZone
    );
    chargeWindowSlots = getOneShotWindowSlots(allSlots, now, oneShotDeadline, timeZone);
    activeChargeHoursNeeded = deviceConfig.oneShotChargeHours;
    oneShotActive = true;
    chargePlanWindow = {
      planType: 'oneshot',
      planKey: `oneshot-${oneShotDeadline.date}-${deviceConfig.oneShotReadyBy}`,
      label: `nu -> ${oneShotDeadline.label}`,
      messagePrefix: 'Engangsopladning'
    };
  }

  const cheapestDishwasherSlot = findCheapestDishwasherSlot(
    aggregateSlotsToHours(chargeWindowSlots),
    timeZone
  );

  if (chargeWindowSlots.length === 0) {
    const waitingForTomorrowPrices = !oneShotActive
      && chargePlanWindow.endDate === tomorrow
      && tomorrowSlots.length === 0;

    if (oneShotActive) {
      oneShotDisabledReason = `ingen kvarter tilbage foer deadline ${oneShotDeadline.label}`;
    }

    const forceChargeActive = !oneShotActive
      && isDayForceChargeActive(deviceConfig.forceCharge, chargePlanWindow, currentSlot);

    const charge_message = oneShotActive
      ? `Engangsopladning afsluttet (ingen kvarter foer ${oneShotDeadline.label}).`
      : forceChargeActive
        ? `Dagopladning: tvungen opladning aktiv.${cheapestDishwasherSlot ? ` ${cheapestDishwasherSlot.message}.` : ''}`
        : cheapestDishwasherSlot
          ? `Ingen ${chargePlanWindow.messagePrefix.toLowerCase()} endnu. ${cheapestDishwasherSlot.message}.`
          : waitingForTomorrowPrices
            ? `Ingen beregning endnu: priser for i morgen (${tomorrow}) er ikke tilgaengelige.`
            : `Ingen ${chargePlanWindow.messagePrefix.toLowerCase()} endnu`;

    return {
      charge_now: forceChargeActive,
      charge_message,
      charge_schedule: 'ingen',
      totalCost: 0,
      oneShotActive: false,
      oneShotDisabledReason,
      forceChargeActive,
      priceSource,
      priceResolution,
      usesHourlyExpandedPrices,
      fetchLog,
      currentSlot,
      chargePlanWindow,
      evaluation: null,
      debug: {
        todaySlots,
        tomorrowSlots,
        currentSlotKey: getSlotKey(currentSlot)
      }
    };
  }

  const evaluation = evaluateChargePlan(
    chargeWindowSlots,
    activeChargeHoursNeeded,
    appConfig.spotThreshold,
    currentSlot,
    { useSpotThreshold: !oneShotActive }
  );

  evaluation.dishwasherMessageSuffix = cheapestDishwasherSlot
    ? ` ${cheapestDishwasherSlot.message}.`
    : '';

  if (oneShotActive) {
    evaluation.oneShotActive = true;
    evaluation.oneShotDeadlineLabel = oneShotDeadline.label;

    if (isOneShotFinished(now, oneShotDeadline, evaluation.planSlots, currentSlot, timeZone)) {
      oneShotDisabledReason = `klar-tidspunkt naaet eller plan afsluttet (${oneShotDeadline.label})`;

      return {
        charge_now: false,
        charge_message: `Engangsopladning afsluttet (klar ${oneShotDeadline.label}).`,
        charge_schedule: 'ingen',
        totalCost: 0,
        oneShotActive: false,
        oneShotDisabledReason,
        forceChargeActive: false,
        priceSource,
        priceResolution,
        usesHourlyExpandedPrices,
        fetchLog,
        currentSlot,
        chargePlanWindow,
        evaluation,
        debug: {
          todaySlots,
          tomorrowSlots,
          currentSlotKey: getSlotKey(currentSlot)
        }
      };
    }
  } else {
    const forceChargeActive = isDayForceChargeActive(
      deviceConfig.forceCharge,
      chargePlanWindow,
      currentSlot
    );

    if (forceChargeActive) {
      evaluation.charge_now = true;
      evaluation.forceChargeActive = true;
    }
  }

  const scheduleSlots = oneShotActive ? evaluation.planSlots : evaluation.chargingSlots;
  const scheduleSummary = formatChargeSchedule(scheduleSlots, timeZone);
  const scheduleDetailed = formatChargeSlotsDetailed(scheduleSlots);
  const charge_message = buildChargeMessage(
    chargePlanWindow,
    evaluation,
    currentSlot,
    appConfig.spotThreshold
  );
  const totalSpotInclVatCost = evaluation.chargingSlots.reduce(
    (sum, slot) => sum + slot.spotPriceInclVat,
    0
  ) * appConfig.chargerKw * (SLOT_MINUTES / 60);

  return {
    charge_now: evaluation.charge_now,
    charge_message,
    charge_schedule: scheduleSummary,
    totalCost: totalSpotInclVatCost,
    oneShotActive,
    oneShotDisabledReason,
    forceChargeActive: Boolean(evaluation.forceChargeActive),
    priceSource,
    priceResolution,
    usesHourlyExpandedPrices,
    fetchLog,
    currentSlot,
    chargePlanWindow,
    evaluation,
    debug: {
      todaySlots,
      tomorrowSlots,
      currentSlotKey: getSlotKey(currentSlot),
      scheduleDetailed,
      activeChargeHoursNeeded,
      chargeSlotsNeeded: evaluation.chargeSlotsNeeded
    }
  };
}

module.exports = {
  buildDeviceConfig,
  buildAppConfig,
  evaluateChargePlanForDevice
};
