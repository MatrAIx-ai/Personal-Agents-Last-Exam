'use strict';
// App-owned helpers. No persistence, authentication or platform runtime.
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const copy = value => structuredClone(value);
const ms = value => Date.parse(value);
const DAY_MS = 86400000;
const HOLD_DAYS = 14;
const FLOOR = '2025-01-01T00:00:00Z';
const OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
// Names are compared after trimming and case-folding.
const fold = value => String(value).trim().toLocaleLowerCase('en-US');
// Computed times keep the UTC offset of the clock they were computed from.
function shift(iso, days) {
  const match = OFFSET.exec(iso);
  if (!match) fail('invalid_time', 'Timestamps need a UTC offset.');
  const offset = match[1] === 'Z' ? '+00:00' : match[1];
  const minutes = (offset[0] === '-' ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  const local = new Date(ms(iso) + days * DAY_MS + minutes * 60000).toISOString().slice(0, 19);
  return local + (match[1] === 'Z' ? 'Z' : offset);
}
function log(ctx, step, details = {}) { try { if (typeof ctx?.log === 'function') ctx.log(step, details); } catch { /* diagnostics never decide a result */ } }
module.exports = {fail, copy, ms, fold, shift, log, DAY_MS, HOLD_DAYS, FLOOR, OFFSET};
