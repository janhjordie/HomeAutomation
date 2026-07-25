'use strict';

// BacklogTrace: EVC-003
const { SLOT_MINUTES, DK_TIME_ZONE } = require('./constants');

function normalizeQuarterMinute(minute) {
  return Math.floor(minute / SLOT_MINUTES) * SLOT_MINUTES;
}

function formatDateInTimeZone(date, timeZone = DK_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year').value;
  const month = parts.find((part) => part.type === 'month').value;
  const day = parts.find((part) => part.type === 'day').value;

  return `${year}-${month}-${day}`;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateInTimeZone(date, 'UTC');
}

function getDateTimePartsInTimeZone(date, timeZone = DK_TIME_ZONE) {
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
    date: `${parts.find((part) => part.type === 'year').value}-${parts.find((part) => part.type === 'month').value}-${parts.find((part) => part.type === 'day').value}`,
    hour: Number(parts.find((part) => part.type === 'hour').value),
    minute: normalizeQuarterMinute(Number(parts.find((part) => part.type === 'minute').value))
  };
}

function getHourInTimeZone(date, timeZone = DK_TIME_ZONE) {
  return getDateTimePartsInTimeZone(date, timeZone).hour;
}

function formatLocalTime(timestamp, timeZone = DK_TIME_ZONE) {
  return new Intl.DateTimeFormat('da-DK', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(new Date(timestamp));
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

module.exports = {
  normalizeQuarterMinute,
  formatDateInTimeZone,
  addDays,
  getDateTimePartsInTimeZone,
  getHourInTimeZone,
  formatLocalTime,
  formatHour,
  formatHourNumber,
  formatSlotTime
};
