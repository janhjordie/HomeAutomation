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
const DAY_PLAN_SWITCH_HOUR = 7;
const NIGHT_PLAN_SWITCH_HOUR = 17;
const VAT_MULTIPLIER = 1.25;
const ENERGIFYN_MARKUP_KR_PER_KWH_INCL_VAT = 0.04;
const REDUCED_ELECTRICITY_TAX_KR_PER_KWH_INCL_VAT = 0;
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

function buildHourlyPrices(records) {
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
      totalPrice: bucket.totalPriceSum / bucket.count,
      price: bucket.totalPriceSum / bucket.count
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
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

function coerceLogicValue(variable, value) {
  if (variable.type === 'number') {
    return Number(value);
  }

  if (variable.type === 'boolean') {
    return Boolean(value);
  }

  return value == null ? '' : String(value);
}

async function setLogicVarIfExists(name, value) {
  const variable = await getLogicVarByName(name);

  if (!variable) {
    console.log(`Logic-variabel '${name}' ikke fundet. Springer over.`);
    return false;
  }

  const coercedValue = coerceLogicValue(variable, value);
  await Homey.logic.updateVariable({
    id: variable.id,
    variable: { value: coercedValue }
  });
  return true;
}

async function updateChargeLogicVariables(payload) {
  await setLogicVarIfExists('charge_start', payload.charge_start);
  await setLogicVarIfExists('charge_end', payload.charge_end);
  await setLogicVarIfExists('charge_hours_array', payload.charge_hours_array);
  await setLogicVarIfExists('charge_hours', payload.charge_hours);
  await setLogicVarIfExists('charge_message', payload.charge_message || '');
  await setLogicVarIfExists('charge_now', payload.charge_now || false);
  await setLogicVarIfExists('charge_plan_key', payload.planKey || '');
  await setLogicVarIfExists('charge_plan_type', payload.planType || '');
  await setLogicVarIfExists('charge_plan_label', payload.planLabel || '');
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
const params = new URLSearchParams({
  start: `${yesterday}T00:00`,
  end: `${dayAfterTomorrow}T00:00`,
  filter: JSON.stringify({ PriceArea: PRICE_AREA }),
  sort: 'TimeDK ASC',
  limit: '500'
});
const url = `https://api.energidataservice.dk/dataset/${DATASET}?${params.toString()}`;

const res = await fetch(url);
const json = await res.json();

if (!json.records || json.records.length === 0) {
  throw new Error(`Ingen data fundet i ${DATASET} for ${today} eller ${tomorrow}`);
}

// ==============================
// SORT
// ==============================
json.records.sort((a, b) => new Date(`${a.TimeUTC}Z`) - new Date(`${b.TimeUTC}Z`));

// ==============================
// MAP
// ==============================
const allHours = buildHourlyPrices(json.records);

const hours = allHours
  .filter(entry => entry.date === today || entry.date === tomorrow);

const todayPrices = hours.filter(entry => entry.date === today);
const tomorrowPrices = hours.filter(entry => entry.date === tomorrow);

if (todayPrices.length === 0) {
  throw new Error(`Ingen priser fundet for i dag (${today})`);
}

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
    console.log(`${String(h.hour).padStart(2, '0')}:00 -> ${h.totalPrice.toFixed(3)} kr (spot ${h.spotPrice.toFixed(3)}, tarif ${h.gridTariff.toFixed(3)})`);
  });
}

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

let best = null;

for (let i = 0; i <= chargeWindowHours.length - chargeHoursNeeded; i++) {
  let sum = 0;
  let valid = true;

  for (let j = 0; j < chargeHoursNeeded; j++) {
    if (j > 0 && chargeWindowHours[i + j].timestamp - chargeWindowHours[i + j - 1].timestamp !== 60 * 60 * 1000) {
      valid = false;
      break;
    }
    sum += chargeWindowHours[i + j].price;
  }

  if (!valid) continue;

  if (!best || sum < best.sum) {
    const blockHours = chargeWindowHours.slice(i, i + chargeHoursNeeded);
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

    best = {
      start: startHour,
      end: endParsed,
      sum,
      hours: blockHours
    };
  }
}

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
    charge_start: -1,
    charge_end: -1,
    charge_hours_array: available_charge_hours_array,
    charge_hours: available_charge_hours_text,
    charge_message: cheapestDishwasherSlot
      ? `Ingen ${chargePlanWindow.messagePrefix.toLowerCase()} endnu. ${cheapestDishwasherSlot.message}.`
      : `Ingen ${chargePlanWindow.messagePrefix.toLowerCase()} endnu`,
    charge_now: false,
    charge_hours_list: available_charge_hours,
    hours: available_charge_hours,
    start: -1,
    end: -1,
    startDate: '',
    endDate: '',
    totalCost: 0,
    totalSpotCost: 0,
    totalGridTariffCost: 0,
    totalEnergifynMarkupCost: 0,
    totalElectricityTaxCost: 0,
    prices: {
      today: todayPrices.map(({ hour, spotPrice, gridTariff, totalPrice }) => ({ hour, spotPrice, gridTariff, totalPrice })),
      tomorrow: tomorrowPrices.map(({ hour, spotPrice, gridTariff, totalPrice }) => ({ hour, spotPrice, gridTariff, totalPrice }))
    },
    bestWindow: null,
    waitingForTomorrowPrices,
    planKey: chargePlanWindow.planKey,
    planType: chargePlanWindow.planType,
    planLabel: chargePlanWindow.label
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
const totalGridTariffCost = best.hours.reduce((sum, hour) => sum + hour.gridTariff, 0) * KW;
const totalEnergifynMarkupCost = best.hours.length * KW * ENERGIFYN_MARKUP_KR_PER_KWH_INCL_VAT;
const totalElectricityTaxCost = best.hours.length * KW * REDUCED_ELECTRICITY_TAX_KR_PER_KWH_INCL_VAT;
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
console.log(`charge_hours_array: ${charge_hours_array}`);
console.log(`charge_hours: ${charge_hours_text}`);
console.log(`charge_now: ${charge_now}`);
console.log(`Pris inkl. moms/tilaeg (11 kW): ${totalCost.toFixed(2)} kr`);
console.log(`Ren spotpris (11 kW): ${totalSpotCost.toFixed(2)} kr`);
console.log(`Elektrus nettarif (11 kW): ${totalGridTariffCost.toFixed(2)} kr`);
console.log(`EnergiFyn tillaeg (11 kW): ${totalEnergifynMarkupCost.toFixed(2)} kr`);
console.log(`Elafgift (11 kW): ${totalElectricityTaxCost.toFixed(2)} kr`);
if (cheapestDishwasherSlot) {
  console.log(cheapestDishwasherSlot.message);
}
console.log(`charge_message: ${charge_message}`);

const payload = {
  charge_start,
  charge_end,
  charge_hours_array,
  charge_hours: charge_hours_text,
  charge_message,
  charge_now,
  charge_hours_list: charge_hours,
  hours: charge_hours,
  start: charge_start,
  end: charge_end,
  startDate: best.start.date,
  endDate: best.end.date,
  totalCost,
  totalSpotCost,
  totalGridTariffCost,
  totalEnergifynMarkupCost,
  totalElectricityTaxCost,
  prices: {
    today: todayPrices.map(({ hour, spotPrice, gridTariff, totalPrice }) => ({ hour, spotPrice, gridTariff, totalPrice })),
    tomorrow: tomorrowPrices.map(({ hour, spotPrice, gridTariff, totalPrice }) => ({ hour, spotPrice, gridTariff, totalPrice }))
  },
  planKey: chargePlanWindow.planKey,
  planType: chargePlanWindow.planType,
  planLabel: chargePlanWindow.label,
  bestWindow: {
    hours: best.hours.map(({ date, hour, spotPrice, gridTariff, totalPrice }) => ({ date, hour, spotPrice, gridTariff, totalPrice })),
    start: best.start,
    end: best.end,
    totalCost
  }
};

await updateChargeLogicVariables(payload);
return payload;