// ==============================
// SETTINGS
// ==============================
const DEFAULT_CHARGE_HOURS = 3;
const KW = 11;
const PRICE_AREA = 'DK2';
const DATASET = 'DayAheadPrices';
const NIGHT_CHARGE_WINDOW_START = 21;
const NIGHT_CHARGE_WINDOW_END = 6;
const DAY_CHARGE_WINDOW_START = 8;
const DAY_CHARGE_WINDOW_END = 17;
const DAY_CHARGE_EARLY_START_SPOT_TOLERANCE_KR_PER_KWH = 0.10;
const DAY_PLAN_SWITCH_HOUR = 7;
const NIGHT_PLAN_SWITCH_HOUR = 17;
const VAT_MULTIPLIER = 1.25;
const ENERGIFYN_MARKUP_KR_PER_KWH_INCL_VAT = 0.04;
const REDUCED_ELECTRICITY_TAX_KR_PER_KWH_INCL_VAT = 0;
const IGNORE_ELECTRICITY_TAX = true;
const STROMLIGNING_API_BASE_URL = 'https://stromligning.dk/api';
const STROMLIGNING_API_KEY_VARIABLE_NAME = 'StromligningApiKey';
const STROMLIGNING_SUPPLIER_ID = 'elektrus_c';
const STROMLIGNING_CUSTOMER_GROUP_ID = 'c';
const HOMEY_NOTIFICATION_USER_NAME = 'Jan Hjørdie';
const ELEKTRUS_TARIFF_LOW_KR_PER_KWH_INCL_VAT = 0.0965;
const ELEKTRUS_TARIFF_HIGH_SUMMER_KR_PER_KWH_INCL_VAT = 0.1448;
const ELEKTRUS_TARIFF_HIGH_WINTER_KR_PER_KWH_INCL_VAT = 0.2894;
const ELEKTRUS_TARIFF_PEAK_SUMMER_KR_PER_KWH_INCL_VAT = 0.3763;
const ELEKTRUS_TARIFF_PEAK_WINTER_KR_PER_KWH_INCL_VAT = 0.8683;

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

function parseHourDK(hourDK) {
  const [datePart, timePart] = hourDK.split('T');
  const hour = Number(timePart.slice(0, 2));

  return {
    date: datePart,
    hour
  };
}

function getElektrusTariffInclVat(dateString, hour) {
  const month = Number(dateString.slice(5, 7));
  const isSummer = month >= 4 && month <= 9;

  if (hour < 6) {
    return ELEKTRUS_TARIFF_LOW_KR_PER_KWH_INCL_VAT;
  }

  if (hour >= 17 && hour < 21) {
    return isSummer
      ? ELEKTRUS_TARIFF_PEAK_SUMMER_KR_PER_KWH_INCL_VAT
      : ELEKTRUS_TARIFF_PEAK_WINTER_KR_PER_KWH_INCL_VAT;
  }

  return isSummer
    ? ELEKTRUS_TARIFF_HIGH_SUMMER_KR_PER_KWH_INCL_VAT
    : ELEKTRUS_TARIFF_HIGH_WINTER_KR_PER_KWH_INCL_VAT;
}

function calculateConsumerPrice(dateString, hour, spotPriceExVat) {
  const spotPriceInclVat = spotPriceExVat * VAT_MULTIPLIER;
  const gridTariffInclVat = getElektrusTariffInclVat(dateString, hour);

  return {
    gridTariff: gridTariffInclVat,
    totalPrice: spotPriceInclVat
    + ENERGIFYN_MARKUP_KR_PER_KWH_INCL_VAT
    + REDUCED_ELECTRICITY_TAX_KR_PER_KWH_INCL_VAT
    + gridTariffInclVat
  };
}

function buildHourlyPricesFromEnergiDataService(records) {
  const buckets = new Map();

  for (const record of records) {
    const parsed = parseHourDK(record.TimeDK);
    const key = `${parsed.date}T${String(parsed.hour).padStart(2, '0')}`;
    const bucket = buckets.get(key) || {
      date: parsed.date,
      hour: parsed.hour,
      timestamp: new Date(`${record.TimeUTC}Z`).getTime(),
      spotPriceSum: 0,
      totalPriceSum: 0,
      count: 0
    };

    const spotPrice = record.DayAheadPriceDKK / 1000;
    const priceDetails = calculateConsumerPrice(parsed.date, parsed.hour, spotPrice);

    bucket.spotPriceSum += spotPrice;
    bucket.totalPriceSum += priceDetails.totalPrice;
    bucket.gridTariffSum = (bucket.gridTariffSum || 0) + priceDetails.gridTariff;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  return Array.from(buckets.values())
    .map(bucket => ({
      date: bucket.date,
      hour: bucket.hour,
      timestamp: bucket.timestamp,
      spotPrice: bucket.spotPriceSum / bucket.count,
      gridTariff: bucket.gridTariffSum / bucket.count,
      transmissionTariff: 0,
      electricityTax: REDUCED_ELECTRICITY_TAX_KR_PER_KWH_INCL_VAT,
      totalPrice: bucket.totalPriceSum / bucket.count,
      sourceTotalPrice: bucket.totalPriceSum / bucket.count,
      price: bucket.totalPriceSum / bucket.count
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function sumPriceParts(parts) {
  return parts.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

function buildHourlyPricesFromStromligning(prices) {
  return prices
    .map(entry => {
      const parsed = parseHourDK(entry.localDate);
      const electricity = entry.details?.electricity || {};
      const transmission = entry.details?.transmission || {};
      const systemTariff = transmission.systemTariff || {};
      const netTariff = transmission.netTariff || {};
      const distribution = entry.details?.distribution || {};
      const electricityTax = entry.details?.electricityTax || {};
      const electricityTaxTotal = IGNORE_ELECTRICITY_TAX ? 0 : (electricityTax.total || 0);
      const ignoredElectricityTaxTotal = IGNORE_ELECTRICITY_TAX ? (electricityTax.total || 0) : 0;
      const sourceTotalPrice = (entry.price?.total || 0) - ignoredElectricityTaxTotal;

      return {
        date: parsed.date,
        hour: parsed.hour,
        timestamp: new Date(entry.date).getTime(),
        spotPrice: electricity.value || 0,
        gridTariff: distribution.total || 0,
        transmissionTariff: sumPriceParts([systemTariff.total, netTariff.total]),
        electricityTax: electricityTaxTotal,
        totalPrice: sourceTotalPrice + ENERGIFYN_MARKUP_KR_PER_KWH_INCL_VAT,
        sourceTotalPrice,
        price: sourceTotalPrice + ENERGIFYN_MARKUP_KR_PER_KWH_INCL_VAT
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

async function fetchStromligningPriceData(todayDate, tomorrowDate) {
  const apiKey = await getRequiredLogicString(STROMLIGNING_API_KEY_VARIABLE_NAME);
  const params = new URLSearchParams({
    supplierId: STROMLIGNING_SUPPLIER_ID,
    customerGroupId: STROMLIGNING_CUSTOMER_GROUP_ID,
    aggregation: '1h'
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

  const allHours = buildHourlyPricesFromStromligning(json.prices);
  const hours = allHours.filter(entry => entry.date === todayDate || entry.date === tomorrowDate);
  const todayPrices = hours.filter(entry => entry.date === todayDate);
  const tomorrowPrices = hours.filter(entry => entry.date === tomorrowDate);

  if (todayPrices.length === 0) {
    throw new Error(`Ingen Stromligning-priser fundet for i dag (${todayDate})`);
  }

  return {
    allHours,
    todayPrices,
    tomorrowPrices,
    priceSource: 'stromligning'
  };
}

async function fetchEnergiDataServicePriceData(yesterdayDate, dayAfterTomorrowDate, todayDate, tomorrowDate) {
  const params = new URLSearchParams({
    start: `${yesterdayDate}T00:00`,
    end: `${dayAfterTomorrowDate}T00:00`,
    filter: JSON.stringify({ PriceArea: PRICE_AREA }),
    sort: 'TimeDK ASC',
    limit: '500'
  });
  const url = `https://api.energidataservice.dk/dataset/${DATASET}?${params.toString()}`;

  const res = await fetch(url);
  const json = await res.json();

  if (!json.records || json.records.length === 0) {
    throw new Error(`Ingen data fundet i ${DATASET} for ${todayDate} eller ${tomorrowDate}`);
  }

  json.records.sort((a, b) => new Date(`${a.TimeUTC}Z`) - new Date(`${b.TimeUTC}Z`));

  const allHours = buildHourlyPricesFromEnergiDataService(json.records);
  const hours = allHours.filter(entry => entry.date === todayDate || entry.date === tomorrowDate);
  const todayPrices = hours.filter(entry => entry.date === todayDate);
  const tomorrowPrices = hours.filter(entry => entry.date === tomorrowDate);

  if (todayPrices.length === 0) {
    throw new Error(`Ingen priser fundet for i dag (${todayDate})`);
  }

  return {
    allHours,
    todayPrices,
    tomorrowPrices,
    priceSource: 'energidataservice'
  };
}

function formatHour(hour) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function formatHourNumber(hour) {
  return String(hour).padStart(2, '0');
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

function getHoursForWindow(allHours, window) {
  if (window.startDate === window.endDate) {
    return allHours.filter(entry =>
      entry.date === window.startDate &&
      entry.hour >= window.startHour &&
      entry.hour < window.endHour
    );
  }

  return allHours.filter(entry =>
    (entry.date === window.startDate && entry.hour >= window.startHour) ||
    (entry.date === window.endDate && entry.hour < window.endHour)
  );
}

function getNextHourEntry(windowHours, index) {
  if (index >= windowHours.length - 1) {
    return null;
  }

  const currentEntry = windowHours[index];
  const nextEntry = windowHours[index + 1];

  if (nextEntry.timestamp - currentEntry.timestamp !== 60 * 60 * 1000) {
    return null;
  }

  return nextEntry;
}

function getContiguousBlock(windowHours, startIndex, length) {
  if (startIndex + length > windowHours.length) {
    return null;
  }

  const blockHours = [];

  for (let offset = 0; offset < length; offset++) {
    const entry = windowHours[startIndex + offset];

    if (offset > 0) {
      const previousEntry = windowHours[startIndex + offset - 1];

      if (entry.timestamp - previousEntry.timestamp !== 60 * 60 * 1000) {
        return null;
      }
    }

    blockHours.push(entry);
  }

  return blockHours;
}

function buildChargeBlock(blockHours) {
  const startHour = blockHours[0];
  const endTime = new Date(blockHours[blockHours.length - 1].timestamp + 60 * 60 * 1000);
  const endLocal = new Intl.DateTimeFormat('sv-SE', {
    timeZone: DK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).format(endTime).replace(' ', 'T');
  const endParsed = parseHourDK(`${endLocal}:00`);

  return {
    start: startHour,
    end: endParsed,
    sum: blockHours.reduce((sum, hour) => sum + hour.price, 0),
    hours: blockHours
  };
}

function findBestChargeBlock(windowHours, chargeHoursNeeded) {
  let bestBlock = null;

  for (let index = 0; index <= windowHours.length - chargeHoursNeeded; index++) {
    const blockHours = getContiguousBlock(windowHours, index, chargeHoursNeeded);

    if (!blockHours) {
      continue;
    }

    const candidate = buildChargeBlock(blockHours);

    if (!bestBlock || candidate.sum < bestBlock.sum) {
      bestBlock = candidate;
    }
  }

  return bestBlock;
}

function findEarlyStartDayChargeBlock(windowHours, chargeHoursNeeded, spotTolerance) {
  if (windowHours.length < chargeHoursNeeded) {
    return null;
  }

  const cheapestSpotPrice = Math.min(...windowHours.map(entry => entry.spotPrice));
  const maxAcceptedSpotPrice = cheapestSpotPrice + spotTolerance;

  for (let index = 0; index <= windowHours.length - chargeHoursNeeded; index++) {
    const blockHours = getContiguousBlock(windowHours, index, chargeHoursNeeded);

    if (!blockHours) {
      continue;
    }

    const allHoursWithinTolerance = blockHours.every(entry => entry.spotPrice <= maxAcceptedSpotPrice);

    if (allHoursWithinTolerance) {
      return buildChargeBlock(blockHours);
    }
  }

  return null;
}

function findCheapestDishwasherSlot(windowHours) {
  let bestSlot = null;

  for (let index = 0; index < windowHours.length; index++) {
    const currentEntry = windowHours[index];
    const nextEntry = getNextHourEntry(windowHours, index);

    if (!nextEntry) {
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

  const startLocal = new Intl.DateTimeFormat('sv-SE', {
    timeZone: DK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(new Date(bestSlot.startTimestamp));

  const endLocal = new Intl.DateTimeFormat('sv-SE', {
    timeZone: DK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(new Date(bestSlot.endTimestamp));

  return {
    ...bestSlot,
    startLocal,
    endLocal,
    startTime: formatLocalTime(bestSlot.startTimestamp),
    endTime: formatLocalTime(bestSlot.endTimestamp),
    message: `Opvask kl. ${formatHourNumber(bestSlot.startHour)}`
  };
}

function getHourInTimeZone(date, timeZone) {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23'
  }).format(date));
}

async function getLogicVarByName(name) {
  const all = await Homey.logic.getVariables();
  return Object.values(all).find(v => v.name === name) || null;
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
  if (variable.type === 'number') {
    return Number(value);
  }

  if (variable.type === 'boolean') {
    return Boolean(value);
  }

  return value == null ? '' : String(value);
}

async function setLogicVarIfExists(name, value, options = {}) {
  const { suppressMissingLog = false } = options;
  const variable = await getLogicVarByName(name);

  if (!variable) {
    if (!suppressMissingLog) {
      console.log(`Logic-variabel '${name}' ikke fundet. Springer over.`);
    }
    return false;
  }

  const coercedValue = coerceLogicValue(variable, value);
  await Homey.logic.updateVariable({
    id: variable.id,
    variable: { value: coercedValue }
  });
  return true;
}

async function sendApiFailureNotification(apiName, error) {
  const message = `${HOMEY_NOTIFICATION_USER_NAME}: EV-opladning kunne ikke hente prisdata fra ${apiName}. Fejl: ${error.message}`;

  try {
    await Homey.notifications.createNotification({
      excerpt: message
    });
  } catch (notificationError) {
    console.log(`Kunne ikke sende Homey-notifikation for ${apiName}: ${notificationError.message}`);
  }
}

async function updateChargeLogicVariables(payload) {
  await setLogicVarIfExists('charge_message', payload.charge_message || '', { suppressMissingLog: true });
  await setLogicVarIfExists('charge_now', payload.charge_now || false);
}

async function getChargeHoursNeeded() {
  const variable = await getLogicVarByName('ChargeHours');

  if (!variable) {
    console.log(`Logic-variabel 'ChargeHours' ikke fundet. Bruger standard: ${DEFAULT_CHARGE_HOURS} timer`);
    return DEFAULT_CHARGE_HOURS;
  }

  const parsedValue = Number(variable.value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    console.log(`Logic-variabel 'ChargeHours' har ugyldig vaerdi (${variable.value}). Bruger standard: ${DEFAULT_CHARGE_HOURS} timer`);
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
const chargeHoursNeeded = await getChargeHoursNeeded();

// ==============================
// FETCH DATA
// ==============================
let priceData;

try {
  priceData = await fetchStromligningPriceData(today, tomorrow);
} catch (error) {
  await sendApiFailureNotification('Strømligning', error);
  console.log(`Stromligning utilgaengelig (${error.message}). Falder tilbage til ${DATASET}.`);

  try {
    priceData = await fetchEnergiDataServicePriceData(yesterday, dayAfterTomorrow, today, tomorrow);
  } catch (fallbackError) {
    await sendApiFailureNotification('Energi Data Service', fallbackError);
    throw fallbackError;
  }
}

const { allHours, todayPrices, tomorrowPrices, priceSource } = priceData;

// ==============================
// DEBUG
// ==============================
function logPrices(label, date, dayHours) {
  console.log(`--- ${label} (${date}) ---`);

  if (dayHours.length === 0) {
    console.log('Ingen priser tilgaengelige');
    return;
  }

  dayHours.forEach(h => {
    const spotPriceInclVat = h.spotPrice * VAT_MULTIPLIER;
    console.log(`${String(h.hour).padStart(2, '0')}:00 -> ${h.totalPrice.toFixed(3)} kr (spot+moms ${spotPriceInclVat.toFixed(3)}, distribution ${h.gridTariff.toFixed(3)}, transmission ${h.transmissionTariff.toFixed(3)}, EnergiFyn ${ENERGIFYN_MARKUP_KR_PER_KWH_INCL_VAT.toFixed(3)}, elafgift ${h.electricityTax.toFixed(3)})`);
  });
}

console.log(`Priskilde: ${priceSource}`);
logPrices('I DAG', today, todayPrices);
console.log('');
logPrices('I MORGEN', tomorrow, tomorrowPrices);

// ==============================
// FIND BILLIGSTE BLOK I LADEVINDUE
// ==============================
const chargePlanWindow = getChargePlanWindow(currentHour, today, yesterday, tomorrow);
const chargeWindowHours = getHoursForWindow(allHours, chargePlanWindow);

console.log('');
console.log(`Ladevinduet der bruges: ${chargePlanWindow.label}`);
console.log(`Plantype: ${chargePlanWindow.planType}`);

const available_charge_hours = chargeWindowHours.map(({ hour }) => hour);
const available_charge_hours_array = JSON.stringify(available_charge_hours);
const available_charge_hours_text = available_charge_hours.join(',');
const cheapestDishwasherSlot = findCheapestDishwasherSlot(chargeWindowHours);

const earlyStartBest = chargePlanWindow.planType === 'day'
  ? findEarlyStartDayChargeBlock(
      chargeWindowHours,
      chargeHoursNeeded,
      DAY_CHARGE_EARLY_START_SPOT_TOLERANCE_KR_PER_KWH
    )
  : null;
const best = earlyStartBest || findBestChargeBlock(chargeWindowHours, chargeHoursNeeded);

if (!best) {
  const waitingForTomorrowPrices = chargePlanWindow.endDate === tomorrow && tomorrowPrices.length === 0;

  console.log("\n--- RESULT ---");

  if (waitingForTomorrowPrices) {
    console.log(`Ingen beregning endnu: priser for i morgen (${tomorrow}) er ikke tilgaengelige for ${chargePlanWindow.messagePrefix.toLowerCase()}`);
  } else {
    console.log(`Ingen gyldig blok med ${chargeHoursNeeded} sammenhaengende timer fundet i ${chargePlanWindow.messagePrefix.toLowerCase()}`);
  }

  console.log(`charge_hours_array: ${available_charge_hours_array}`);
  console.log(`charge_hours: ${available_charge_hours_text}`);

  const payload = {
    charge_message: cheapestDishwasherSlot
      ? `Ingen ${chargePlanWindow.messagePrefix.toLowerCase()} endnu. ${cheapestDishwasherSlot.message}.`
      : `Ingen ${chargePlanWindow.messagePrefix.toLowerCase()} endnu`,
    charge_now: false
  };

  await updateChargeLogicVariables(payload);
  return payload;
}

// ==============================
// RESULT
// ==============================
const totalCost = best.sum * KW;
const charge_hours = best.hours.map(({ hour }) => hour);
const charge_start = best.start.hour;
const charge_end = best.end.hour;
const charge_hours_array = JSON.stringify(charge_hours);
const charge_hours_text = charge_hours.join(',');
const charge_now = charge_hours.includes(currentHour);
const totalSpotCost = best.hours.reduce((sum, hour) => sum + hour.spotPrice, 0) * KW;
const totalSpotVatCost = totalSpotCost * (VAT_MULTIPLIER - 1);
const totalGridTariffCost = best.hours.reduce((sum, hour) => sum + hour.gridTariff, 0) * KW;
const totalTransmissionTariffCost = best.hours.reduce((sum, hour) => sum + hour.transmissionTariff, 0) * KW;
const totalEnergifynMarkupCost = best.hours.length * KW * ENERGIFYN_MARKUP_KR_PER_KWH_INCL_VAT;
const totalElectricityTaxCost = best.hours.reduce((sum, hour) => sum + hour.electricityTax, 0) * KW;
const dishwasherMessageSuffix = cheapestDishwasherSlot
  ? ` ${cheapestDishwasherSlot.message}.`
  : '';
const planLabelShort = chargePlanWindow.planType === 'night' ? 'Nat' : 'Dag';
const plannedHoursText = `${charge_hours.length} ${charge_hours.length === 1 ? 'time' : 'timer'} planlagt opladning`;
const charge_message = `${plannedHoursText} kl. ${formatHourNumber(charge_start)}-${formatHourNumber(charge_end)}. ${totalCost.toFixed(2)} kr.${dishwasherMessageSuffix}`;

console.log("\n--- RESULT ---");
console.log(`ChargeHours: ${chargeHoursNeeded}`);
console.log(`Timer: ${best.hours.map(h => `${h.date} ${String(h.hour).padStart(2, '0')}:00`).join(', ')}`);
console.log(`Start: ${best.start.date} ${String(charge_start).padStart(2, '0')}:00`);
console.log(`Slut: ${best.end.date} ${String(charge_end).padStart(2, '0')}:00`);
if (earlyStartBest) {
  console.log(`Tidlig dagstart aktiv: alle valgte timer er inden for ${(DAY_CHARGE_EARLY_START_SPOT_TOLERANCE_KR_PER_KWH * 100).toFixed(0)} ore/kWh fra billigste spot-time i dagvinduet.`);
}
console.log(`charge_hours_array: ${charge_hours_array}`);
console.log(`charge_hours: ${charge_hours_text}`);
console.log(`charge_now: ${charge_now}`);
console.log(`Pris inkl. moms/tilaeg (11 kW): ${totalCost.toFixed(2)} kr`);
console.log(`Spot ekskl. moms (11 kW): ${totalSpotCost.toFixed(2)} kr`);
console.log(`Moms paa spot (11 kW): ${totalSpotVatCost.toFixed(2)} kr`);
console.log(`Elektrus distribution (11 kW): ${totalGridTariffCost.toFixed(2)} kr`);
console.log(`Transmission/systemtariffer (11 kW): ${totalTransmissionTariffCost.toFixed(2)} kr`);
console.log(`EnergiFyn tillaeg (11 kW): ${totalEnergifynMarkupCost.toFixed(2)} kr`);
console.log(`Elafgift (11 kW): ${totalElectricityTaxCost.toFixed(2)} kr`);
if (cheapestDishwasherSlot) {
  console.log(cheapestDishwasherSlot.message);
}
console.log(`charge_message: ${charge_message}`);

const payload = {
  charge_message,
  charge_now,
  totalCost
};

await updateChargeLogicVariables(payload);
return payload;