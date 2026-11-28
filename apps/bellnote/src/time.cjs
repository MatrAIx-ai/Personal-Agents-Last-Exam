'use strict';
// Calendar arithmetic in an IANA time zone with Node's built-in Intl only.
// Business "now" is always ctx.virtual_now; nothing here reads the wall clock.
const formatters = new Map();
function formatter(tz) {
  if (!formatters.has(tz)) {
    formatters.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }));
  }
  return formatters.get(tz);
}
function validZone(tz) {
  try { formatter(tz); return true; } catch { return false; }
}
const pad = (n, w = 2) => String(n).padStart(w, '0');
// Wall-clock fields of an instant (ms since epoch) in a zone.
function fields(ms, tz) {
  const parts = Object.fromEntries(formatter(tz).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return {year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour % 24, minute: +parts.minute, second: +parts.second};
}
// Offset (ms) of the zone at an instant: local wall time minus UTC.
function offsetAt(ms, tz) {
  const f = fields(ms, tz);
  return Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second) - Math.floor(ms / 1000) * 1000;
}
function parseDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return {y, mo, d, t};
}
const validDate = date => parseDate(date) !== null;
function parseLocal(time) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time || '');
  return m ? {h: +m[1], mi: +m[2]} : null;
}
const minutesOf = time => { const t = parseLocal(time); return t.h * 60 + t.mi; };
function formatOffset(off) {
  const sign = off < 0 ? '-' : '+', abs = Math.abs(off) / 60000;
  return sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
}
// ISO string with the zone's offset for an instant, e.g. 2026-11-17T08:30:00-08:00.
function isoInZone(ms, tz) {
  const off = offsetAt(ms, tz), f = fields(ms, tz);
  return f.year + '-' + pad(f.month) + '-' + pad(f.day) + 'T' + pad(f.hour) + ':' + pad(f.minute) + ':' + pad(f.second) + formatOffset(off);
}
// The instant at which a local date and HH:MM occur in a zone. A wall time skipped by a
// daylight-saving jump resolves to the first valid instant after the gap; a repeated wall
// time resolves to its first (earlier) occurrence.
function zonedInstant(date, time, tz) {
  const d = parseDate(date), t = parseLocal(time);
  if (!d || !t) throw new Error('Invalid local date/time');
  const guess = Date.UTC(d.y, d.mo - 1, d.d, t.h, t.mi);
  const candidates = [...new Set([offsetAt(guess - 864e5 / 2, tz), offsetAt(guess, tz), offsetAt(guess + 864e5 / 2, tz)])]
    .map(off => guess - off)
    .filter(ms => { const f = fields(ms, tz); return f.year === d.y && f.month === d.mo && f.day === d.d && f.hour === t.h && f.minute === t.mi; })
    .sort((a, b) => a - b);
  if (candidates.length) return candidates[0];
  // In a gap: move forward minute by minute (at most a few hours) to the first valid wall time.
  for (let step = 1; step <= 240; step++) {
    const total = t.h * 60 + t.mi + step;
    if (total >= 24 * 60) break;
    const later = pad(Math.floor(total / 60)) + ':' + pad(total % 60);
    const g = Date.UTC(d.y, d.mo - 1, d.d, Math.floor(total / 60), total % 60);
    for (const off of new Set([offsetAt(g - 864e5 / 2, tz), offsetAt(g + 864e5 / 2, tz)])) {
      const ms = g - off, f = fields(ms, tz);
      if (f.year === d.y && f.month === d.mo && f.day === d.d && pad(f.hour) + ':' + pad(f.minute) === later) return ms;
    }
  }
  throw new Error('Unresolvable local time');
}
const zonedIso = (date, time, tz) => isoInZone(zonedInstant(date, time, tz), tz);
function localDate(iso, tz) {
  const f = fields(Date.parse(iso), tz);
  return f.year + '-' + pad(f.month) + '-' + pad(f.day);
}
function localTime(iso, tz) {
  const f = fields(Date.parse(iso), tz);
  return pad(f.hour) + ':' + pad(f.minute);
}
function addDays(date, n) {
  const d = parseDate(date), t = new Date(d.t + n * 864e5);
  return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
}
const weekday = date => new Date(parseDate(date).t).getUTCDay(); // 0 Sunday .. 6 Saturday
const daysBetween = (a, b) => Math.round((parseDate(b).t - parseDate(a).t) / 864e5);
function eachDate(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
// A card is valid through the last moment of its expiry month in the district's zone.
function monthEnd(month, tz) {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? (y + 1) + '-01-01' : y + '-' + pad(m + 1) + '-01';
  return zonedInstant(next, '00:00', tz);
}
// Human-readable forms used in messages and notification text: "Tuesday, November 17" and
// "Tuesday, November 17 at 08:30" (the instant's wall time in the zone).
function longDate(date) {
  const d = parseDate(date);
  return new Date(d.t).toLocaleDateString('en-US', {weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC'});
}
const longDateTime = (iso, tz) => longDate(localDate(iso, tz)) + ' at ' + localTime(iso, tz);
const hasOffset = iso => typeof iso === 'string' && /(Z|[+-]\d{2}:\d{2})$/.test(iso) && Number.isFinite(Date.parse(iso));
module.exports = {validZone, validDate, parseLocal, minutesOf, zonedInstant, zonedIso, isoInZone, localDate, localTime,
  addDays, weekday, daysBetween, eachDate, monthEnd, hasOffset, longDate, longDateTime};
