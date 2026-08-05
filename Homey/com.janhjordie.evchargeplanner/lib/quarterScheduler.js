'use strict';

const { DK_TIME_ZONE, SLOT_MINUTES } = require('./constants');
const { getDateTimePartsInTimeZone } = require('./timezone');

const QUARTER_MS = SLOT_MINUTES * 60 * 1000;

function getClockPartsInTimeZone(date = new Date(), timeZone = DK_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hourCycle: 'h23'
  }).formatToParts(date);

  return {
    hour: Number(parts.find((part) => part.type === 'hour').value),
    minute: Number(parts.find((part) => part.type === 'minute').value),
    second: Number(parts.find((part) => part.type === 'second').value),
    millisecond: Number(parts.find((part) => part.type === 'fractionalSecond')?.value || 0)
  };
}

function getMsUntilNextQuarterBoundary(date = new Date(), timeZone = DK_TIME_ZONE) {
  const clock = getClockPartsInTimeZone(date, timeZone);
  const minuteInQuarter = clock.minute % SLOT_MINUTES;
  const elapsedMs = ((minuteInQuarter * 60) + clock.second) * 1000 + clock.millisecond;

  if (elapsedMs === 0) {
    return QUARTER_MS;
  }

  return QUARTER_MS - elapsedMs;
}

function isQuarterBoundary(date = new Date(), timeZone = DK_TIME_ZONE) {
  const clock = getClockPartsInTimeZone(date, timeZone);
  return clock.minute % SLOT_MINUTES === 0 && clock.second === 0 && clock.millisecond === 0;
}

module.exports = {
  QUARTER_MS,
  getClockPartsInTimeZone,
  getMsUntilNextQuarterBoundary,
  isQuarterBoundary
};
