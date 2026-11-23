'use strict';
// Household clock math. Schedules use the fixture offset, so results do not
// depend on the machine's time zone database.

function offsetMinutes(offset) {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset || '');
  if (!match) return null;
  const sign = match[1] === '+' ? 1 : -1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function parts(offset, ms) {
  const shift = offsetMinutes(offset);
  const local = new Date(ms + shift * 60000);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds()
  };
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatInstant(offset, ms) {
  const value = parts(offset, ms);
  return value.year + '-' + pad(value.month) + '-' + pad(value.day) + 'T' +
    pad(value.hour) + ':' + pad(value.minute) + ':' + pad(value.second) + offset;
}

function instant(offset, year, month, day, hour, minute, second = 0) {
  const shift = offsetMinutes(offset);
  return Date.UTC(year, month - 1, day, hour, minute, second) - shift * 60000;
}

function dateKey(value) {
  return value.year * 10000 + value.month * 100 + value.day;
}

function dateText(value) {
  return value.year + '-' + pad(value.month) + '-' + pad(value.day);
}

function addDays(value, count) {
  const next = new Date(Date.UTC(value.year, value.month - 1, value.day + count));
  return {year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), hour: 0, minute: 0, second: 0};
}

// Dates whose local day can contain an instant strictly after `fromMs` and at or before `nowMs`.
function datesTouched(offset, fromMs, nowMs) {
  const dates = [];
  let cursor = parts(offset, fromMs + 1);
  const end = dateKey(parts(offset, nowMs));
  let guard = 0;
  while (guard < 800) {
    guard += 1;
    const day = {year: cursor.year, month: cursor.month, day: cursor.day};
    dates.push(day);
    if (dateKey(day) >= end) break;
    cursor = addDays(day, 1);
  }
  return dates;
}

function clockMinutes(text) {
  const match = /^(\d{2}):(\d{2})$/.exec(text || '');
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function inSpan(minute, startText, endText) {
  const start = clockMinutes(startText);
  const end = clockMinutes(endText);
  if (start === null || end === null || start === end) return false;
  if (start < end) return minute >= start && minute < end;
  return minute >= start || minute < end;
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function weekday(offset, ms) {
  return WEEKDAYS[parts(offset, ms).day ? new Date(ms + offsetMinutes(offset) * 60000).getUTCDay() : 0];
}

module.exports = {offsetMinutes, parts, formatInstant, instant, datesTouched, clockMinutes, inSpan, weekday, dateText, WEEKDAYS};
