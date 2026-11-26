'use strict';
// Pure helpers: errors, instants and IANA time zones through Node's built-in Intl.
// No persistence, no clock of its own: "now" always comes from the host context.

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
const ms = value => Date.parse(value);
const pad = (n, width = 2) => String(n).padStart(width, '0');

const formatters = new Map();
function formatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

function validTimeZone(tz) {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try { formatter(tz); return true; } catch { return false; }
}

// Minutes east of UTC that `tz` observes at instant `t`. Cached per quarter hour.
const offsets = new Map();
function offsetMinutes(t, tz) {
  const key = tz + '|' + Math.floor(t / 900000);
  let off = offsets.get(key);
  if (off === undefined) {
    const p = {};
    for (const part of formatter(tz).formatToParts(new Date(t))) p[part.type] = part.value;
    const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    off = Math.round((wall - Math.floor(t / 1000) * 1000) / 60000);
    if (offsets.size > 50000) offsets.clear();
    offsets.set(key, off);
  }
  return off;
}

// Offset written in an ISO 8601 timestamp, in minutes east of UTC; null when it has none.
function writtenOffset(text) {
  const m = /(Z|[+-]\d{2}:\d{2})$/.exec(text);
  if (!m) return null;
  if (m[1] === 'Z') return 0;
  return (m[1][0] === '-' ? -1 : 1) * (+m[1].slice(1, 3) * 60 + +m[1].slice(4, 6));
}

// Instant -> 'YYYY-MM-DDTHH:MM:SS+HH:MM' as local time of `tz`.
function isoAt(t, tz) {
  const off = offsetMinutes(t, tz), d = new Date(t + off * 60000), a = Math.abs(off);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds())
    + (off < 0 ? '-' : '+') + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
}
const localDate = (t, tz) => isoAt(t, tz).slice(0, 10);
const localMinutes = (t, tz) => { const d = new Date(t + offsetMinutes(t, tz) * 60000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

// Wall time in `tz` -> instant. A wall time skipped by a clock change maps to the instant after the gap.
function localToInstant(date, hhmm, tz) {
  const [y, mo, d] = date.split('-').map(Number), [h, mi] = hhmm.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const first = wall - offsetMinutes(wall, tz) * 60000;
  return wall - offsetMinutes(first, tz) * 60000;
}
function addDays(date, n) {
  const [y, mo, d] = date.split('-').map(Number), t = new Date(Date.UTC(y, mo - 1, d + n));
  return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
}
const minutesOf = hhmm => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Instant -> '16 November', as a calendar day of `tz`.
function dayMonth(t, tz) {
  const date = localDate(t, tz);
  return Number(date.slice(8, 10)) + ' ' + MONTHS[Number(date.slice(5, 7)) - 1];
}
// A text as one sentence: it ends with a full stop unless it already ends a sentence.
const sentence = text => { const s = String(text).trim(); return /[.!?]$/.test(s) ? s : s + '.'; };

function unique(values) { return new Set(values).size === values.length; }
function byId(list) { return new Map(list.map(x => [x.id, x])); }
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));

// Next generated ID: prefix + (largest numeric suffix in use + 1), zero padded. `used` holds
// every ID that must not come back, removed records included.
function nextId(used, prefix) {
  let max = 0;
  const taken = new Set(used);
  for (const idValue of taken) {
    if (idValue.startsWith(prefix)) { const n = Number(idValue.slice(prefix.length)); if (Number.isInteger(n) && n > max) max = n; }
  }
  let n = max + 1, candidate = prefix + pad(n, 4);
  while (taken.has(candidate)) candidate = prefix + pad(++n, 4);
  return candidate;
}

// Pagination shared by the list reads: `cursor` is the offset of the next page.
function page(args, all, defaultLimit = 20) {
  if (args.cursor !== undefined && !/^\d{1,6}$/.test(args.cursor)) fail('invalid_arguments', 'cursor must be a next_cursor value from an earlier page.');
  const offset = args.cursor === undefined ? 0 : Number(args.cursor), limit = args.limit ?? defaultLimit;
  return { items: all.slice(offset, offset + limit), next_cursor: offset + limit < all.length ? String(offset + limit) : null };
}

module.exports = {
  fail, ms, pad, validTimeZone, offsetMinutes, writtenOffset, isoAt, localDate, localMinutes, localToInstant, addDays, minutesOf,
  dayMonth, sentence, unique, byId, sameSet, nextId, page,
};
