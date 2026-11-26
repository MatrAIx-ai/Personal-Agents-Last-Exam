'use strict';
// App-owned domain utilities. No persistence, authentication or platform runtime.
const fail = (code, message) => {const error = new Error(message); error.code = code; throw error;};
const copy = value => structuredClone(value);
const text = (value, max = 10000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
function references(ctx, data, code = 'invalid_seed') {
  const person = ctx.binding.people.some(p => p.person_id === data.owner_person_id);
  const account = ctx.binding.accounts.some(a => a.app_id === ctx.app_id && a.account_id === data.account_id && a.owner_person_id === data.owner_person_id);
  if (!person || !account) fail(code, 'Account and owner must exist in the supplied binding.');
}

// ---- Virtual time. Instants are compared, never strings; derived times keep the offset of their base.
const MINUTE = 60000, DAY = 86400000;
const instant = value => Date.parse(value);
function offsetOf(ts) {
  const m = /([+-])(\d{2}):(\d{2})$/.exec(ts);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}
function format(ms, offsetMin) {
  const local = new Date(ms + offsetMin * MINUTE).toISOString();
  const frac = local.slice(19, 23) === '.000' ? '' : local.slice(19, 23);
  if (offsetMin === 0) return local.slice(0, 19) + frac + 'Z';
  const abs = Math.abs(offsetMin);
  return local.slice(0, 19) + frac + (offsetMin < 0 ? '-' : '+') + String(Math.floor(abs / 60)).padStart(2, '0') + ':' + String(abs % 60).padStart(2, '0');
}
const shift = (ts, ms) => format(instant(ts) + ms, offsetOf(ts));
// The same instant written in another timestamp's offset (for example, the current clock's).
const inOffsetOf = (ts, ref) => format(instant(ts), offsetOf(ref));
// Calendar months in the base timestamp's fixed offset; the day is clamped to the target month.
function addMonths(ts, months) {
  const off = offsetOf(ts), local = new Date(instant(ts) + off * MINUTE);
  const y = local.getUTCFullYear(), m = local.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = Math.min(local.getUTCDate(), last);
  const ms = Date.UTC(y, m, day, local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds(), local.getUTCMilliseconds());
  return format(ms - off * MINUTE, off);
}
const localDate = ts => format(instant(ts), offsetOf(ts)).slice(0, 10);

// Insertion-order tie-break: agent writes in one session share the virtual clock.
const newestFirst = (list, key) => list.map((entry, i) => [entry, i])
  .sort(([a, ia], [b, ib]) => instant(b[key]) - instant(a[key]) || ib - ia).map(([entry]) => entry);
const fold = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const words = value => fold(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
// IDs of stored records that the clock cutoff hides (src/visible.cjs), so IDs the App creates never reuse one.
const HIDDEN = Symbol('tidepool.hidden_ids');
const hiddenIds = data => data[HIDDEN] || new Set();

module.exports = {fail, copy, text, references, MINUTE, DAY, instant, offsetOf, format, shift, inOffsetOf, addMonths, localDate, newestFirst, fold, words, HIDDEN, hiddenIds};
