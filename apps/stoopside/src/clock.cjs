'use strict';
// Group-time helpers. Every group uses one fixed UTC offset (no daylight-saving
// changes), so local dates and times convert to instants without a time-zone
// database. Business time is always ctx.virtual_now or a stored due time.
const {fail} = require('./domain-utils.cjs');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ms(value) {
  const t = Date.parse(value);
  if (typeof value !== 'string' || !Number.isFinite(t)) fail('invalid_time', 'Invalid timestamp.');
  return t;
}

function offsetMinutes(offset) {
  const sign = offset[0] === '-' ? -1 : 1;
  const [h, m] = offset.slice(1).split(':').map(Number);
  return sign * (h * 60 + m);
}

// An instant written in the group's offset, e.g. 2027-03-06T18:20:00-05:00.
function iso(t, offset = 'Z') {
  if (offset === 'Z') return new Date(t).toISOString().replace('.000Z', 'Z');
  const local = new Date(t + offsetMinutes(offset) * MINUTE).toISOString().slice(0, 19);
  return local + offset;
}

// Group-local calendar date (YYYY-MM-DD) of an instant.
function localDate(t, offset) {
  return new Date(t + offsetMinutes(offset) * MINUTE).toISOString().slice(0, 10);
}

// Group-local "YYYY-MM-DD HH:MM LABEL" for notice text.
function label(t, group) {
  const local = new Date(t + offsetMinutes(group.utc_offset) * MINUTE).toISOString();
  return `${local.slice(0, 10)} ${local.slice(11, 16)} ${group.tz_label}`;
}

// Monday 08:00 group time on or after the instant `t` (strictly after when `after` is true).
function nextMonday8(t, offset, after = true) {
  const local = new Date(t + offsetMinutes(offset) * MINUTE);
  const day = local.getUTCDay();  // 0 Sunday .. 6 Saturday
  const base = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 8, 0, 0);
  let candidate = base + ((1 - day + 7) % 7) * DAY - offsetMinutes(offset) * MINUTE;
  while (after ? candidate <= t : candidate < t) candidate += 7 * DAY;
  return candidate;
}

module.exports = {MINUTE, HOUR, DAY, ms, iso, localDate, label, nextMonday8, offsetMinutes};
