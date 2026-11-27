'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const plugin = require('../plugin.cjs');
const { compile } = require('../tests/schema-validator.cjs');
const { ms, toIso, localParts } = require('../src/time.cjs');

const ROOT = path.join(__dirname, '..');
const ZONE = 'America/New_York';
const FIRST = '2025-01-01', LAST = '2026-12-31';
const START = '2025-01-01T00:00:00-05:00', END = '2027-01-01T00:00:00-05:00';
const FILES = { base: 'dataset/base.json', replay: 'dataset/replay.json', full: 'dataset/full.json' };
const SEED_IDS = { base: 'plateway-delivery-base', full: 'plateway-delivery-2025-2026', asOf: 'plateway-delivery-asof-' };
const RUN = 'plateway-delivery';
const HOLDER = 'p-1';
const read = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const BINDING = read('fixtures/binding.json');
const REFERENCE = read('fixtures/clock.json').initial_time;
const seedValid = compile(read('schemas/seed.schema.json'), path.join(ROOT, 'schemas'));

const pad = n => String(n).padStart(2, '0');
const localDate = iso => localParts(ms(iso), ZONE).date;
function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
}
function weekday(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function localIso(date, minutes) {
  const day = addDays(date, Math.floor(minutes / 1440)), rest = ((minutes % 1440) + 1440) % 1440;
  const [y, m, d] = day.split('-').map(Number);
  for (const hours of [4, 5]) {
    const instant = Date.UTC(y, m - 1, d, 0, rest) + hours * 3600000;
    const p = localParts(instant, ZONE);
    if (p.date === day && p.minutes === rest) return toIso(instant, ZONE);
  }
  throw Error('There is no local time ' + day + ' ' + pad(Math.floor(rest / 60)) + ':' + pad(rest % 60) + ' in ' + ZONE + '.');
}
function instant(text) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return localIso(text, 0);
  const t = ms(text);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text) || !Number.isFinite(t) || !/(Z|[+-]\d{2}:\d{2})$/.test(text)) {
    throw Error('Give the instant as a date (2026-01-01, local midnight in ' + ZONE + ') or as a date-time with an offset (2026-01-01T00:00:00-05:00).');
  }
  return toIso(t, ZONE);
}
const months = () => {
  const out = [];
  for (let y = Number(FIRST.slice(0, 4)), m = Number(FIRST.slice(5, 7)); y * 12 + m <= Number(LAST.slice(0, 4)) * 12 + Number(LAST.slice(5, 7)); m === 12 ? (y++, m = 1) : m++) out.push(y + '-' + pad(m));
  return out;
};

function validate(data, at) {
  if (!seedValid(data)) throw Error('The state at ' + at + ' does not match the seed schema.');
  try { plugin.validateSeed({ app_id: 'plateway', virtual_now: at, binding: BINDING }, data); } catch (e) { throw Error('The state at ' + at + ' fails validateSeed: ' + e.message); }
}

const eventId = step => RUN + '-' + step.id;
const envelope = step => ({ event_id: eventId(step), at: step.at, operation: step.operation, payload: structuredClone(step.payload) });
const PREVIEW = { 'plateway.orders.place': 'plateway.checkout.preview', 'plateway.orders.cancel.confirm': 'plateway.orders.cancel.preview' };
function apply(data, step) {
  const ctx = { app_id: 'plateway', run_id: RUN, role: step.by === 'infra' ? 'infra' : 'agent', virtual_now: step.at, binding: BINDING };
  try {
    if (step.by === 'infra') return plugin.applyEvent(ctx, data, envelope(step));
    const args = { request_id: RUN + '-' + step.id, expected_version: { epoch: 1, revision: 0 }, ...structuredClone(step.args) };
    if (PREVIEW[step.tool]) args.token = plugin.handleTool(ctx, data, PREVIEW[step.tool], structuredClone(step.args)).result.token;
    return plugin.handleTool(ctx, data, step.tool, args).data;
  } catch (e) { throw Error('Replay step ' + step.id + ' (' + (step.tool || step.operation) + ' at ' + step.at + ') failed: ' + e.message); }
}
function replay(base, steps, until, { check = false } = {}) {
  const limit = until === undefined ? Infinity : ms(until);
  const data = structuredClone(base);
  let applied = 0;
  for (const step of steps) {
    if (ms(step.at) >= limit) break;
    apply(data, step);
    applied++;
    if (check) validate(data, step.at);
  }
  return { data, applied };
}

const pretty = value => JSON.stringify(value, null, 2) + '\n';
function replayText(log) {
  const { steps, ...head } = log;
  return JSON.stringify(head, null, 2).slice(0, -2) + ',\n  "steps": [\n' + steps.map(s => '    ' + JSON.stringify(s)).join(',\n') + '\n  ]\n}\n';
}
const file = rel => path.join(ROOT, rel);
const load = () => ({ base: read(FILES.base), replay: read(FILES.replay), full: read(FILES.full) });
const sha256 = rel => crypto.createHash('sha256').update(fs.readFileSync(file(rel))).digest('hex');

function dated(seed) {
  const out = [];
  const add = (kind, id, at) => out.push({ kind, id, at });
  for (const o of seed.orders) {
    add('order', o.id, o.placed_at);
    for (const l of o.lines) {
      add('order_line', l.id, o.placed_at);
      if (l.report) add('line_report', l.id + '/report', l.report.at);
    }
    for (const r of o.refunds) add('refund', r.id, r.at);
    if (o.rating) add('rating', o.id + '/rating', o.rating.at);
  }
  for (const n of seed.notices) add('notice', n.id, n.at);
  return out;
}
function summarize(seed) {
  const items = dated(seed), kinds = {};
  for (const item of items) kinds[item.kind] = (kinds[item.kind] || 0) + 1;
  const dates = [...new Set(items.map(i => localDate(i.at)))].sort();
  const monthly = {};
  for (const i of items.filter(x => x.kind === 'order')) { const m = localDate(i.at).slice(0, 7); monthly[m] = (monthly[m] || 0) + 1; }
  return { records: items.length, by_kind: kinds, distinct_dates: dates.length, earliest: dates[0] || null, latest: dates[dates.length - 1] || null, orders_by_month: monthly };
}

module.exports = {
  ROOT, ZONE, FIRST, LAST, START, END, FILES, SEED_IDS, RUN, HOLDER, BINDING, REFERENCE,
  read, file, load, sha256, pad, localDate, addDays, weekday, localIso, instant, months,
  validate, apply, replay, envelope, eventId, pretty, replayText, dated, summarize,
};
