'use strict';
// Time-zone helpers built on Intl. All business times are instants; rendering uses the place's IANA zone.
const {fail} = require('./domain-utils.cjs');

const formatters = new Map();
function formatter(zone) {
  if (!formatters.has(zone)) {
    formatters.set(zone, new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
    }));
  }
  return formatters.get(zone);
}

function validZone(zone) {
  try { formatter(zone); return true; } catch { return false; }
}

function ms(value) {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) fail('invalid_time', 'Invalid date-time: ' + value);
  return t;
}

const WEEKDAY = {Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7};

// Local wall-clock parts of an instant in a zone.
function parts(instant, zone) {
  const p = Object.fromEntries(formatter(zone).formatToParts(new Date(instant)).map(x => [x.type, x.value]));
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offsetMin = Math.round((local - Math.floor(instant / 1000) * 1000) / 60000);
  return {year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second,
    weekday: WEEKDAY[p.weekday], date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, offsetMin};
}

function offsetText(min) {
  const sign = min < 0 ? '-' : '+', a = Math.abs(min);
  return sign + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0');
}

// RFC 3339 text in the zone's local time with its UTC offset.
function render(value, zone) {
  const instant = typeof value === 'number' ? value : ms(value), p = parts(instant, zone);
  return `${p.date}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}${offsetText(p.offsetMin)}`;
}

// Instant of a local date and HH:MM in a zone. A time skipped by DST moves forward to the next valid
// instant; a repeated time uses its first instance.
function instantOf(date, hhmm, zone) {
  const [y, m, d] = date.split('-').map(Number), [hh, mm] = hhmm.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const candidates = [];
  for (const guess of [wall - 14 * 3600e3, wall, wall + 14 * 3600e3]) {
    const off = parts(guess, zone).offsetMin, t = wall - off * 60e3, p = parts(t, zone);
    if (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) === wall) candidates.push(t);
  }
  if (candidates.length) return Math.min(...candidates);
  // Skipped local time: the first instant whose wall time reaches the requested time (end of the gap).
  const wallAt = t => { const p = parts(t, zone); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute); };
  let lo = (wall - 14 * 3600e3) / 60e3, hi = (wall + 14 * 3600e3) / 60e3;
  if (wallAt(hi * 60e3) < wall) fail('invalid_time', 'Cannot resolve local time.');
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (wallAt(mid * 60e3) >= wall) hi = mid; else lo = mid + 1; }
  return lo * 60e3;
}

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const minutes = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// Is the instant inside a daily local window [start, end)? A window that crosses midnight belongs to
// the date it starts. Returns the local start date of the matching occurrence, or null.
function windowDate(instant, zone, start, end) {
  const p = parts(instant, zone), now = p.hour * 60 + p.minute, s = minutes(start), e = minutes(end);
  if (s < e) return now >= s && now < e ? p.date : null;
  if (now >= s) return p.date;
  if (now < e) return addDays(p.date, -1);
  return null;
}

// End of the quiet period containing the instant, or null when outside quiet hours.
function quietRelease(instant, zone, quiet) {
  if (!quiet) return null;
  const startDate = windowDate(instant, zone, quiet.start, quiet.end);
  if (!startDate) return null;
  const endDate = minutes(quiet.start) < minutes(quiet.end) ? startDate : addDays(startDate, 1);
  return instantOf(endDate, quiet.end, zone);
}

module.exports = {ms, parts, render, instantOf, addDays, minutes, windowDate, quietRelease, validZone, offsetText};
