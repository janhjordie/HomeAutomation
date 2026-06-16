// ==============================
// SETTINGS
// ==============================
const DEFAULT_CHARGE_HOURS = 3;
const KW = 11;
const PRICE_AREA = 'DK2';
const DATASET = 'DayAheadPrices';
const NIGHT_CHARGE_WINDOW_START = 21;
const NIGHT_CHARGE_WINDOW_END = 6;
const DAY_CHARGE_WINDOW_START = 9;
const DAY_CHARGE_WINDOW_END = 17;
const DAY_PLAN_SWITCH_HOUR = 7;
const NIGHT_PLAN_SWITCH_HOUR = 17;
const SPOT_CHARGE_THRESHOLD_KR_INCL_VAT = 0.30;
const SLOT_MINUTES = 15;
const SLOT_MS = SLOT_MINUTES * 60 * 1000;
const SLOTS_PER_HOUR = 60 / SLOT_MINUTES;
const VAT_MULTIPLIER = 1.25;
const STROMLIGNING_API_BASE_URL = 'https://stromligning.dk/api';
const STROMLIGNING_API_KEY_VARIABLE_NAME = 'StromligningApiKey';
const STROMLIGNING_SUPPLIER_ID = 'elektrus_c';
const STROMLIGNING_CUSTOMER_GROUP_ID = 'c';
// Stromligning API tillader kun 1h,1d,1M,1Y - kvarterspriser udvides lokalt fra timepriser.
const STROMLIGNING_AGGREGATION = '1h';
const FORCE_CHARGE_VARIABLE_NAME = 'forceCharge';
const CHARGE_HOURS_VARIABLE_NAME = 'ChargeHours';
const CHARGE_NOW_VARIABLE_NAME = 'charge_now';
const CHARGE_MESSAGE_VARIABLE_NAME = 'charge_message';
const HOMEY_NOTIFICATION_USER_NAME = 'Jan Hjørdie';

// ==============================
// GET REAL TODAY/TOMORROW (DK)
// ==============================
const DK_TIME_ZONE = 'Europe/Copenhagen';

function formatDateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const year = parts.find(part => part.type === 'year').value;
  const month = parts.find(part => part.type === 'month').value;
  const day = parts.find(part => part.type === 'day').value;

  return `${year}-${month}-${day}`;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateInTimeZone(date, 'UTC');
}

function parseSlotDK(dateTimeDK) {
  const [datePart, timePart] = dateTimeDK.split('T');
  const [hourPart, minutePart = '00'] = timePart.split(':');

  return {
    date: datePart,
    hour: Number(hourPart),
    minute: Number(minutePart.slice(0, 2))
  };
}

function normalizeQuarterMinute(minute) {
  return Math.floor(minute / SLOT_MINUTES) * SLOT_MINUTES;
}

function getSpotPriceInclVat(spotPriceExVat, spotPriceInclVat) {
  if (Number.isFinite(spotPriceInclVat)) {
    return spotPriceInclVat;
  }

  return spotPriceExVat * VAT_MULTIPLIER;
}

function getSlotKey(slot) {
  return `${slot.date}T${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}`;
}

function buildQuarterPricesFromEnergiDataService(records) {
  return records
    .map(record => {
      const parsed = parseSlotDK(record.TimeDK);
      const minute = normalizeQuarterMinute(parsed.minute);
      const spotPriceExVat = record.DayAheadPriceDKK / 1000;

      return {
        date: parsed.date,
        hour: parsed.hour,
        minute,
        timestamp: new Date(`${record.TimeUTC}Z`).getTime(),
        spotPrice: spotPriceExVat,
        spotPriceInclVat: getSpotPriceInclVat(spotPriceExVat)
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

function buildQuarterPricesFromStromligning(prices) {
  return prices
    .map(entry => {
      const parsed = parseSlotDK(entry.localDate);
      const minute = normalizeQuarterMinute(parsed.minute);
      const electricity = entry.details?.electricity || {};
      const spotPriceExVat = electricity.value || 0;
      const spotPriceInclVat = getSpotPriceInclVat(
        spotPriceExVat,
        electricity.total
      );

      return {
        date: parsed.date,
        hour: parsed.hour,
        minute,
        timestamp: new Date(entry.date).getTime(),
        spotPrice: spotPriceExVat,
        spotPriceInclVat
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

function expandHourlySlotsToQuarters(slots) {
  if (slots.length < 2) {
    return slots;
  }

  const sorted = [...slots].sort((a, b) => a.timestamp - b.timestamp);
  const averageGapMs = (sorted[sorted.length - 1].timestamp - sorted[0].timestamp)
    / (sorted.length - 1);

  if (averageGapMs <= SLOT_MS * 1.5) {
    return slots;
  }

  const expanded = [];

  for (const slot of sorted) {
    for (let quarter = 0; quarter < SLOTS_PER_HOUR; quarter++) {
      const minute = quarter * SLOT_MINUTES;

      expanded.push({
        ...slot,
        minute,
        timestamp: slot.timestamp + (quarter * SLOT_MS)
      });
    }
  }

  return expanded.sort((a, b) => a.timestamp - b.timestamp);
}

function isHourlyExpandedSlots(slots) {
  if (slots.length < SLOTS_PER_HOUR + 1) {
    return false;
  }

  const buckets = new Map();

  for (const slot of slots) {
    const key = `${slot.date}T${String(slot.hour).padStart(2, '0')}`;
    const bucket = buckets.get(key) || new Set();
    bucket.add(slot.spotPriceInclVat.toFixed(6));
    buckets.set(key, bucket);
  }

  let hoursWithMultipleQuarters = 0;
  let hoursWithIdenticalQuarters = 0;

  for (const uniquePrices of buckets.values()) {
    if (uniquePrices.size === 0) {
      continue;
    }

    hoursWithMultipleQuarters += 1;

    if (uniquePrices.size === 1) {
      hoursWithIdenticalQuarters += 1;
    }
  }

  return hoursWithMultipleQuarters > 0
    && hoursWithIdenticalQuarters / hoursWithMultipleQuarters >= 0.9;
}

async function fetchStromligningPriceData(todayDate, tomorrowDate) {
  const apiKey = await getRequiredLogicString(STROMLIGNING_API_KEY_VARIABLE_NAME);
  const params = new URLSearchParams({
    supplierId: STROMLIGNING_SUPPLIER_ID,
    customerGroupId: STROMLIGNING_CUSTOMER_GROUP_ID,
    aggregation: STROMLIGNING_AGGREGATION
  });
  const url = `${STROMLIGNING_API_BASE_URL}/prices?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-API-Key': apiKey
    }
  });

  if (!res.ok) {
    throw new Error(`Stromligning API fejl (${res.status})`);
  }

  const json = await res.json();

  if (!json.prices || json.prices.length === 0) {
    throw new Error('Ingen Stromligning-priser fundet');
  }

  const allSlots = expandHourlySlotsToQuarters(buildQuarterPricesFromStromligning(json.prices));
  const slots = allSlots.filter(entry => entry.date === todayDate || entry.date === tomorrowDate);
  const todaySlots = slots.filter(entry => entry.date === todayDate);
  const tomorrowSlots = slots.filter(entry => entry.date === tomorrowDate);

  if (todaySlots.length === 0) {
    throw new Error(`Ingen Stromligning-priser fundet for i dag (${todayDate})`);
  }

  return {
    allSlots,
    todaySlots,
    tomorrowSlots,
    priceSource: 'stromligning',
    priceResolution: '1h->15m'
  };
}

async function fetchEnergiDataServicePriceData(yesterdayDate, dayAfterTomorrowDate, todayDate, tomorrowDate) {
  const params = new URLSearchParams({
    start: `${yesterdayDate}T00:00`,
    end: `${dayAfterTomorrowDate}T00:00`,
    filter: JSON.stringify({ PriceArea: PRICE_AREA }),
    sort: 'TimeDK ASC',
    limit: '2000'
  });
  const url = `https://api.energidataservice.dk/dataset/${DATASET}?${params.toString()}`;

  const res = await fetch(url);
  const json = await res.json();

  if (!json.records || json.records.length === 0) {
    throw new Error(`Ingen data fundet i ${DATASET} for ${todayDate} eller ${tomorrowDate}`);
  }

  json.records.sort((a, b) => new Date(`${a.TimeUTC}Z`) - new Date(`${b.TimeUTC}Z`));

  const allSlots = expandHourlySlotsToQuarters(buildQuarterPricesFromEnergiDataService(json.records));
  const slots = allSlots.filter(entry => entry.date === todayDate || entry.date === tomorrowDate);
  const todaySlots = slots.filter(entry => entry.date === todayDate);
  const tomorrowSlots = slots.filter(entry => entry.date === tomorrowDate);

  if (todaySlots.length === 0) {
    throw new Error(`Ingen priser fundet for i dag (${todayDate})`);
  }

  return {
    allSlots,
    todaySlots,
    tomorrowSlots,
    priceSource: 'energidataservice',
    priceResolution: '15m'
  };
}

function formatHour(hour) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function formatHourNumber(hour) {
  return String(hour).padStart(2, '0');
}

function formatSlotTime(slot) {
  return `${formatHourNumber(slot.hour)}:${String(slot.minute).padStart(2, '0')}`;
}

function formatLocalTime(timestamp) {
  return new Intl.DateTimeFormat('da-DK', {
    timeZone: DK_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(new Date(timestamp));
}

function getChargePlanWindow(currentHour, todayDate, yesterdayDate, tomorrowDate) {
  if (currentHour < DAY_PLAN_SWITCH_HOUR) {
    return {
      planType: 'night',
      planKey: `night-${todayDate}`,
      label: `${yesterdayDate} ${formatHour(NIGHT_CHARGE_WINDOW_START)} -> ${todayDate} ${formatHour(NIGHT_CHARGE_WINDOW_END)}`,
      startDate: yesterdayDate,
      startHour: NIGHT_CHARGE_WINDOW_START,
      endDate: todayDate,
      endHour: NIGHT_CHARGE_WINDOW_END,
      messagePrefix: 'Natteopladning'
    };
  }

  if (currentHour < NIGHT_PLAN_SWITCH_HOUR) {
    return {
      planType: 'day',
      planKey: `day-${todayDate}`,
      label: `${todayDate} ${formatHour(DAY_CHARGE_WINDOW_START)} -> ${todayDate} ${formatHour(DAY_CHARGE_WINDOW_END)}`,
      startDate: todayDate,
      startHour: DAY_CHARGE_WINDOW_START,
      endDate: todayDate,
      endHour: DAY_CHARGE_WINDOW_END,
      messagePrefix: 'Dagopladning'
    };
  }

  return {
    planType: 'night',
    planKey: `night-${tomorrowDate}`,
    label: `${todayDate} ${formatHour(NIGHT_CHARGE_WINDOW_START)} -> ${tomorrowDate} ${formatHour(NIGHT_CHARGE_WINDOW_END)}`,
    startDate: todayDate,
    startHour: NIGHT_CHARGE_WINDOW_START,
    endDate: tomorrowDate,
    endHour: NIGHT_CHARGE_WINDOW_END,
    messagePrefix: 'Natteopladning'
  };
}

function isSlotInWindow(slot, window) {
  if (window.startDate === window.endDate) {
    return slot.date === window.startDate
      && slot.hour >= window.startHour
      && slot.hour < window.endHour;
  }

  return (slot.date === window.startDate && slot.hour >= window.startHour)
    || (slot.date === window.endDate && slot.hour < window.endHour);
}

function getSlotsForWindow(allSlots, window) {
  return allSlots
    .filter(slot => isSlotInWindow(slot, window))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function selectCheapestPlanSlots(windowSlots, chargeSlotsNeeded) {
  return [...windowSlots]
    .sort((a, b) => {
      if (a.spotPriceInclVat !== b.spotPriceInclVat) {
        return a.spotPriceInclVat - b.spotPriceInclVat;
      }

      return a.timestamp - b.timestamp;
    })
    .slice(0, chargeSlotsNeeded);
}

function evaluateChargePlan(windowSlots, chargeHoursNeeded, spotThresholdInclVat, currentSlot) {
  const chargeSlotsNeeded = chargeHoursNeeded * SLOTS_PER_HOUR;
  const planSlots = selectCheapestPlanSlots(windowSlots, chargeSlotsNeeded);
  const planSlotKeys = new Set(planSlots.map(getSlotKey));
  const isBelowThreshold = slot => slot.spotPriceInclVat < spotThresholdInclVat;
  const isChargingSlot = slot => isBelowThreshold(slot) || planSlotKeys.has(getSlotKey(slot));
  const chargingSlots = windowSlots.filter(isChargingSlot);
  const thresholdSlots = windowSlots.filter(isBelowThreshold);
  const currentSlotKey = currentSlot ? getSlotKey(currentSlot) : null;
  const currentSlotInWindow = Boolean(
    currentSlot && windowSlots.some(slot => getSlotKey(slot) === currentSlotKey)
  );
  const charge_now = currentSlotInWindow && isChargingSlot(currentSlot);
  const nextChargingSlot = windowSlots.find(slot =>
    slot.timestamp > (currentSlot?.timestamp || 0) && isChargingSlot(slot)
  );

  return {
    planSlots,
    chargingSlots,
    thresholdSlots,
    charge_now,
    nextChargingSlot,
    chargeSlotsNeeded,
    planSlotKeys
  };
}

function aggregateSlotsToHours(windowSlots) {
  const buckets = new Map();

  for (const slot of windowSlots) {
    const key = `${slot.date}T${String(slot.hour).padStart(2, '0')}`;
    const bucket = buckets.get(key) || {
      date: slot.date,
      hour: slot.hour,
      timestamp: slot.timestamp,
      spotPriceInclVatSum: 0,
      count: 0
    };

    bucket.spotPriceInclVatSum += slot.spotPriceInclVat;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  return Array.from(buckets.values())
    .map(bucket => ({
      date: bucket.date,
      hour: bucket.hour,
      timestamp: bucket.timestamp,
      price: bucket.spotPriceInclVatSum / bucket.count
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function findCheapestDishwasherSlot(windowHours) {
  let bestSlot = null;

  for (let index = 0; index < windowHours.length; index++) {
    const currentEntry = windowHours[index];
    const nextEntry = windowHours[index + 1];

    if (!nextEntry || nextEntry.timestamp - currentEntry.timestamp !== 60 * 60 * 1000) {
      continue;
    }

    const candidate = {
      startTimestamp: currentEntry.timestamp,
      endTimestamp: currentEntry.timestamp + (90 * 60 * 1000),
      totalPrice: (currentEntry.price * 1.0) + (nextEntry.price * 0.5),
      startHour: currentEntry.hour
    };

    if (!bestSlot || candidate.totalPrice < bestSlot.totalPrice) {
      bestSlot = candidate;
    }
  }

  if (!bestSlot) {
    return null;
  }

  return {
    ...bestSlot,
    startTime: formatLocalTime(bestSlot.startTimestamp),
    endTime: formatLocalTime(bestSlot.endTimestamp),
    message: `Opvask kl. ${formatHourNumber(bestSlot.startHour)}`
  };
}

function getDateTimePartsInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  return {
    date: `${parts.find(part => part.type === 'year').value}-${parts.find(part => part.type === 'month').value}-${parts.find(part => part.type === 'day').value}`,
    hour: Number(parts.find(part => part.type === 'hour').value),
    minute: normalizeQuarterMinute(Number(parts.find(part => part.type === 'minute').value))
  };
}

function getHourInTimeZone(date, timeZone) {
  return getDateTimePartsInTimeZone(date, timeZone).hour;
}

function findCurrentSlot(allSlots, now) {
  const current = getDateTimePartsInTimeZone(now, DK_TIME_ZONE);
  const currentKey = `${current.date}T${String(current.hour).padStart(2, '0')}:${String(current.minute).padStart(2, '0')}`;

  return allSlots.find(slot => getSlotKey(slot) === currentKey) || {
    date: current.date,
    hour: current.hour,
    minute: current.minute,
    timestamp: now.getTime(),
    spotPrice: null,
    spotPriceInclVat: null
  };
}

function buildChargeMessage(chargePlanWindow, evaluation, currentSlot) {
  const {
    chargingSlots,
    thresholdSlots,
    planSlots,
    charge_now,
    nextChargingSlot,
    chargeSlotsNeeded,
    forceChargeActive
  } = evaluation;
  const dishwasherMessageSuffix = evaluation.dishwasherMessageSuffix || '';
  const currentSpotText = Number.isFinite(currentSlot.spotPriceInclVat)
    ? currentSlot.spotPriceInclVat.toFixed(2)
    : '?';

  if (charge_now && forceChargeActive) {
    return `Dagopladning: tvungen opladning aktiv (spot ${currentSpotText}).${dishwasherMessageSuffix}`;
  }

  if (charge_now) {
    const reason = currentSlot.spotPriceInclVat < SPOT_CHARGE_THRESHOLD_KR_INCL_VAT
      ? `spot ${currentSpotText}`
      : `plan (${currentSpotText})`;

    return `${chargePlanWindow.messagePrefix}: lader nu (${reason}).${dishwasherMessageSuffix}`;
  }

  if (chargingSlots.length === 0) {
    return `Ingen ${chargePlanWindow.messagePrefix.toLowerCase()} endnu.${dishwasherMessageSuffix}`;
  }

  const nextText = nextChargingSlot
    ? `naeste kl. ${formatSlotTime(nextChargingSlot)} (spot ${nextChargingSlot.spotPriceInclVat.toFixed(2)})`
    : 'ingen flere kvarter i vinduet';
  const thresholdHours = (thresholdSlots.length / SLOTS_PER_HOUR).toFixed(1);
  const planHours = (planSlots.length / SLOTS_PER_HOUR).toFixed(1);

  return `${chargePlanWindow.messagePrefix}: ${thresholdHours}t under ${SPOT_CHARGE_THRESHOLD_KR_INCL_VAT.toFixed(2)}, ${planHours}t i ${chargeSlotsNeeded}-kvarters plan. ${nextText}.${dishwasherMessageSuffix}`;
}

function parseLogicBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value ?? '').trim().toLowerCase();

  if (normalized === 'true' || normalized === '1' || normalized === 'on') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'off' || normalized === '') {
    return false;
  }

  return Boolean(value);
}

function isDayForceChargeActive(forceCharge, chargePlanWindow, currentSlot) {
  return forceCharge
    && chargePlanWindow.planType === 'day'
    && isSlotInWindow(currentSlot, chargePlanWindow);
}

async function getLogicVarByName(name) {
  const all = await Homey.logic.getVariables();
  return Object.values(all).find(v => v.name === name) || null;
}

async function ensureLogicVariable(name, type, defaultValue) {
  const existing = await getLogicVarByName(name);

  if (existing) {
    return existing;
  }

  if (typeof Homey.logic?.createVariable !== 'function') {
    console.log(`Logic-variabel '${name}' findes ikke, og Homey.logic.createVariable er ikke tilgaengelig.`);
    return null;
  }

  console.log(`Opretter Logic-variabel '${name}' (${type}).`);
  return Homey.logic.createVariable({
    variable: {
      name,
      type,
      value: defaultValue
    }
  });
}

async function getForceChargeActive() {
  const variable = await ensureLogicVariable(FORCE_CHARGE_VARIABLE_NAME, 'boolean', false);

  if (!variable) {
    return false;
  }

  return parseLogicBoolean(variable.value);
}

async function getRequiredLogicString(name) {
  const variable = await getLogicVarByName(name);

  if (!variable) {
    throw new Error(`Logic-variabel '${name}' ikke fundet`);
  }

  const value = String(variable.value || '').trim();

  if (!value) {
    throw new Error(`Logic-variabel '${name}' er tom`);
  }

  return value;
}

function coerceLogicValue(variable, value) {
  if (variable.type === 'boolean') {
    return parseLogicBoolean(value);
  }

  if (variable.type === 'number') {
    return Number(value);
  }

  return value == null ? '' : String(value);
}

async function setLogicVariable(name, value, type, defaultValue) {
  const variable = await ensureLogicVariable(name, type, defaultValue);

  if (!variable) {
    return false;
  }

  await Homey.logic.updateVariable({
    id: variable.id,
    variable: { value: coerceLogicValue(variable, value) }
  });
  return true;
}

async function ensureChargeLogicVariables() {
  await ensureLogicVariable(FORCE_CHARGE_VARIABLE_NAME, 'boolean', false);
  await ensureLogicVariable(CHARGE_HOURS_VARIABLE_NAME, 'number', DEFAULT_CHARGE_HOURS);
  await ensureLogicVariable(CHARGE_NOW_VARIABLE_NAME, 'boolean', false);
  await ensureLogicVariable(CHARGE_MESSAGE_VARIABLE_NAME, 'string', '');
}

async function sendApiFailureNotification(apiName, error) {
  const message = `${HOMEY_NOTIFICATION_USER_NAME}: EV-opladning kunne ikke hente prisdata fra ${apiName}. Fejl: ${error.message}`;

  if (typeof Homey.flow?.runFlowCardAction === 'function') {
    try {
      await Homey.flow.runFlowCardAction({
        uri: 'homey:flowcardaction:homey:manager:notifications:create_notification',
        id: 'homey:manager:notifications:create_notification',
        args: { text: message }
      });
      return;
    } catch (flowNotificationError) {
      console.log(`Flow-notifikation fejlede for ${apiName}: ${flowNotificationError.message}`);
    }
  }

  if (typeof Homey.notifications?.createNotification === 'function') {
    try {
      await Homey.notifications.createNotification({ excerpt: message });
      return;
    } catch (notificationError) {
      console.log(`Homey.notifications fejlede for ${apiName}: ${notificationError.message}`);
    }
  }

  console.log(`NOTIFIKATION (kun log): ${message}`);
}

async function updateChargeLogicVariables(payload) {
  await setLogicVariable(CHARGE_MESSAGE_VARIABLE_NAME, payload.charge_message || '', 'string', '');
  await setLogicVariable(CHARGE_NOW_VARIABLE_NAME, payload.charge_now || false, 'boolean', false);
}

async function getChargeHoursNeeded() {
  const variable = await ensureLogicVariable(CHARGE_HOURS_VARIABLE_NAME, 'number', DEFAULT_CHARGE_HOURS);

  if (!variable) {
    return DEFAULT_CHARGE_HOURS;
  }

  const parsedValue = Number(variable.value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    console.log(`Logic-variabel '${CHARGE_HOURS_VARIABLE_NAME}' har ugyldig vaerdi (${variable.value}). Bruger standard: ${DEFAULT_CHARGE_HOURS} timer`);
    return DEFAULT_CHARGE_HOURS;
  }

  return parsedValue;
}

const now = new Date();
const yesterday = addDays(formatDateInTimeZone(now, DK_TIME_ZONE), -1);
const today = formatDateInTimeZone(now, DK_TIME_ZONE);
const tomorrow = addDays(today, 1);
const dayAfterTomorrow = addDays(today, 2);
const currentHour = getHourInTimeZone(now, DK_TIME_ZONE);

await ensureChargeLogicVariables();
const chargeHoursNeeded = await getChargeHoursNeeded();
const forceCharge = await getForceChargeActive();

// ==============================
// FETCH DATA (EDS foerst: rigtige kvarterspriser; Stromligning kun 1h)
// ==============================
let priceData;

try {
  priceData = await fetchEnergiDataServicePriceData(yesterday, dayAfterTomorrow, today, tomorrow);
  console.log('Priser hentet fra Energi Data Service (kvartersoploesning).');
} catch (edsError) {
  console.log(`${DATASET} utilgaengelig (${edsError.message}). Falder tilbage til Stromligning.`);

  try {
    priceData = await fetchStromligningPriceData(today, tomorrow);
  } catch (stromligningError) {
    await sendApiFailureNotification('Energi Data Service', edsError);
    await sendApiFailureNotification('Strømligning', stromligningError);
    throw stromligningError;
  }
}

const { allSlots, todaySlots, tomorrowSlots, priceSource, priceResolution } = priceData;
const usesHourlyExpandedPrices = priceResolution === '1h->15m'
  || isHourlyExpandedSlots(todaySlots);

if (usesHourlyExpandedPrices) {
  console.log('Bemærk: Priser er timebaserede (4 ens kvarter/time). Spot under 0,30 kan overses mellem kvarter.');
}

// ==============================
// DEBUG
// ==============================
function logPrices(label, date, daySlots) {
  console.log(`--- ${label} (${date}) ---`);

  if (daySlots.length === 0) {
    console.log('Ingen priser tilgaengelige');
    return;
  }

  daySlots.forEach(slot => {
    console.log(`${formatSlotTime(slot)} -> spot ${slot.spotPriceInclVat.toFixed(3)} kr (inkl. moms)`);
  });
}

console.log(`Priskilde: ${priceSource} (${priceResolution || STROMLIGNING_AGGREGATION})`);
logPrices('I DAG', today, todaySlots);
console.log('');
logPrices('I MORGEN', tomorrow, tomorrowSlots);

// ==============================
// KVARtersplan i ladevindue
// ==============================
const chargePlanWindow = getChargePlanWindow(currentHour, today, yesterday, tomorrow);
const chargeWindowSlots = getSlotsForWindow(allSlots, chargePlanWindow);
const currentSlot = findCurrentSlot(allSlots, now);

console.log('');
console.log(`Ladevinduet der bruges: ${chargePlanWindow.label}`);
console.log(`Plantype: ${chargePlanWindow.planType}`);
console.log(`Spot-taerskel: ${SPOT_CHARGE_THRESHOLD_KR_INCL_VAT.toFixed(2)} kr/kWh (inkl. moms)`);
console.log(`Force charge (forceCharge): ${forceCharge ? 'aktiv' : 'inaktiv'}`);
console.log(`Nuvaerende kvarter: ${getSlotKey(currentSlot)}`);

const available_charge_hours = [...new Set(chargeWindowSlots.map(({ hour }) => hour))].sort((a, b) => a - b);
const available_charge_hours_array = JSON.stringify(available_charge_hours);
const available_charge_hours_text = available_charge_hours.join(',');
const cheapestDishwasherSlot = findCheapestDishwasherSlot(aggregateSlotsToHours(chargeWindowSlots));

if (chargeWindowSlots.length === 0) {
  const waitingForTomorrowPrices = chargePlanWindow.endDate === tomorrow && tomorrowSlots.length === 0;

  console.log('\n--- RESULT ---');

  if (waitingForTomorrowPrices) {
    console.log(`Ingen beregning endnu: priser for i morgen (${tomorrow}) er ikke tilgaengelige for ${chargePlanWindow.messagePrefix.toLowerCase()}`);
  } else {
    console.log(`Ingen kvarterspriser fundet i ${chargePlanWindow.messagePrefix.toLowerCase()}`);
  }

  const forceChargeActive = isDayForceChargeActive(forceCharge, chargePlanWindow, currentSlot);

  const payload = {
    charge_message: forceChargeActive
      ? `Dagopladning: tvungen opladning aktiv.${cheapestDishwasherSlot ? ` ${cheapestDishwasherSlot.message}.` : ''}`
      : cheapestDishwasherSlot
        ? `Ingen ${chargePlanWindow.messagePrefix.toLowerCase()} endnu. ${cheapestDishwasherSlot.message}.`
        : `Ingen ${chargePlanWindow.messagePrefix.toLowerCase()} endnu`,
    charge_now: forceChargeActive
  };

  await updateChargeLogicVariables(payload);
  return payload;
}

const evaluation = evaluateChargePlan(
  chargeWindowSlots,
  chargeHoursNeeded,
  SPOT_CHARGE_THRESHOLD_KR_INCL_VAT,
  currentSlot
);
evaluation.dishwasherMessageSuffix = cheapestDishwasherSlot
  ? ` ${cheapestDishwasherSlot.message}.`
  : '';

const forceChargeActive = isDayForceChargeActive(forceCharge, chargePlanWindow, currentSlot);

if (forceChargeActive) {
  evaluation.charge_now = true;
  evaluation.forceChargeActive = true;
}

const {
  chargingSlots,
  thresholdSlots,
  planSlots,
  charge_now
} = evaluation;
const charge_hours = [...new Set(chargingSlots.map(({ hour }) => hour))].sort((a, b) => a - b);
const charge_hours_array = JSON.stringify(charge_hours);
const charge_hours_text = charge_hours.join(',');
const totalSpotCost = chargingSlots.reduce((sum, slot) => sum + slot.spotPrice, 0) * KW * (SLOT_MINUTES / 60);
const totalSpotInclVatCost = chargingSlots.reduce((sum, slot) => sum + slot.spotPriceInclVat, 0) * KW * (SLOT_MINUTES / 60);
const charge_message = buildChargeMessage(chargePlanWindow, evaluation, currentSlot);

console.log('\n--- RESULT ---');
console.log(`ChargeHours: ${chargeHoursNeeded} (${evaluation.chargeSlotsNeeded} kvarter)`);
if (forceChargeActive) {
  console.log('Tvungen dagopladning aktiv: charge_now=true uanset spotpris (kun 9-17).');
}
console.log(`Kvarter under taerskel: ${thresholdSlots.map(getSlotKey).join(', ') || 'ingen'}`);
console.log(`Planlagte billigste kvarter: ${planSlots.map(getSlotKey).join(', ') || 'ingen'}`);
console.log(`Alle ladekvarter: ${chargingSlots.map(getSlotKey).join(', ') || 'ingen'}`);
console.log(`charge_hours_array: ${charge_hours_array}`);
console.log(`charge_hours: ${charge_hours_text}`);
console.log(`charge_now: ${charge_now}`);
console.log(`Spot ekskl. moms (${KW} kW, valgte kvarter): ${totalSpotCost.toFixed(2)} kr`);
console.log(`Spot inkl. moms (${KW} kW, valgte kvarter): ${totalSpotInclVatCost.toFixed(2)} kr`);
if (cheapestDishwasherSlot) {
  console.log(cheapestDishwasherSlot.message);
}
console.log(`charge_message: ${charge_message}`);

const payload = {
  charge_message,
  charge_now,
  totalCost: totalSpotInclVatCost
};

await updateChargeLogicVariables(payload);
return payload;
