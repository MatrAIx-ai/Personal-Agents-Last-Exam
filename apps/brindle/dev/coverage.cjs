'use strict';
// Counts the dates of the delivery dataset: the records that the App loads, read from data/evaluation/seed.json.
// It writes data/evaluation/coverage.json and coverage.md. Run `node dev/coverage.cjs`, or with `--check` to compare with the committed files.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const time = require('../src/time.cjs');
const views = require('../src/views.cjs');
const {records} = require('../src/model.cjs');
const {HOLIDAYS} = require('./evaluation-scenarios.cjs');

const DIR = path.resolve(__dirname, '../data/evaluation'), ZONE = 'America/New_York', FIRST = '2025-01-01', LAST = '2026-12-31';
const read = name => fs.readFileSync(path.join(DIR, name), 'utf8');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const MONTHS = [];
for (let year = 2025; year <= 2026; year++) for (let month = 1; month <= 12; month++) MONTHS.push(year + '-' + String(month).padStart(2, '0'));
// A timestamp counts on its calendar day in ZONE after normalizing its offset. A date-only field is already a day in ZONE.
function dayOf(value) {
  if (typeof value !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return time.validDay(value) ? value : null;
  const instant = Date.parse(value);
  return /^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(instant) ? time.localDay(instant, ZONE) : null;
}

// What happened, each family on one date field. Only these count toward coverage.
// A payment counts only for its acts: the request, the posting of money and a return. `rows` gets the state of each payment at the clock.
const REQUESTS = new Set(['payments.schedule', 'autopay.scheduled', 'payments.cancel']);
const ACTUAL = [
  {kind: 'transactions', field: 'transactions[].transaction_at', rows: data => data.transactions.map(x => [x.id, x.transaction_at])},
  {kind: 'statements', field: 'statements[].closing_at', rows: data => data.statements.map(x => [x.id, x.closing_at])},
  {kind: 'payment_requests', field: 'payments[].history[].at (payments.schedule, autopay.scheduled, payments.cancel)',
    rows: data => data.payments.flatMap(x => x.history.filter(h => REQUESTS.has(h.action)).map(h => [x.id + ' ' + h.action, h.at]))},
  {kind: 'payment_postings', field: 'payments[].posts_at (posted or later returned, money moved)',
    rows: (data, state) => data.payments.filter(x => ['posted', 'returned'].includes(state(x))).map(x => [x.id, x.posts_at])},
  {kind: 'payment_returns', field: 'payments[].returned_at', rows: (data, state) => data.payments.filter(x => state(x) === 'returned').map(x => [x.id, x.returned_at])},
  {kind: 'disputes', field: 'disputes[].opened_at', rows: data => data.disputes.map(x => [x.id, x.opened_at])},
  {kind: 'offers', field: 'offers[].issued_at', rows: data => data.offers.map(x => [x.id, x.issued_at])},
  {kind: 'points_entries', field: 'points_entries[].at', rows: data => data.points_entries.map(x => [x.id, x.at])},
  {kind: 'notifications', field: 'notifications[].at', rows: data => data.notifications.map(x => [x.id, x.at])}
];
// Due times and intended days. They are schedules, not acts, so they are listed apart and never counted.
const SCHEDULED = [
  {kind: 'statement_due_times', field: 'statements[].due_at', rows: data => data.statements.map(x => [x.id, x.due_at])},
  {kind: 'payment_intended_days', field: 'payments[].pay_on (cancelled, skipped or still scheduled: no money moved)',
    rows: (data, state) => data.payments.filter(x => !['posted', 'returned'].includes(state(x))).map(x => [x.id, x.pay_on, state(x)])},
  {kind: 'offer_deadlines', field: 'offers[].accept_by', rows: data => data.offers.map(x => [x.id, x.accept_by])}
];
const stateAt = (data, clock) => { const amounts = views.postedAmounts(data), now = Date.parse(clock); return p => views.paymentState(p, amounts, now); };

function count(data, clock) {
  const rows = [], exclusions = [], clockDay = dayOf(clock), state = stateAt(data, clock);
  for (const kind of ACTUAL) for (const [id, value] of kind.rows(data, state)) {
    const day = dayOf(value);
    let reason = day === null ? 'invalid or missing date' : null;
    if (!reason && day < FIRST) reason = 'before ' + FIRST + ': the opening month of the account (opened 2 December 2024)';
    if (!reason && day > clockDay) reason = 'after the clock ' + clock;
    if (!reason && day > LAST) reason = 'after ' + LAST;
    rows.push({kind: kind.kind, id, day, value});
    if (reason) exclusions.push({kind: kind.kind, id, value, reason});
  }
  const excluded = new Set(exclusions.map(x => x.kind + '|' + x.id)), counted = rows.filter(x => !excluded.has(x.kind + '|' + x.id));
  const summary = list => {
    const days = [...new Set(list.map(x => x.day))].sort();
    return {records: list.length, distinct_dates: days.length, earliest: days[0] || null, latest: days[days.length - 1] || null};
  };
  const kinds = ACTUAL.map(kind => {
    const all = rows.filter(x => x.kind === kind.kind), inside = counted.filter(x => x.kind === kind.kind);
    return {kind: kind.kind, date_field: kind.field, rows: all.length, ...summary(inside), excluded: all.length - inside.length};
  });
  const monthly = MONTHS.map(month => {
    const inMonth = counted.filter(x => x.day.slice(0, 7) === month);
    return {month, records: inMonth.length, distinct_dates: new Set(inMonth.map(x => x.day)).size,
      by_kind: Object.fromEntries(ACTUAL.map(k => [k.kind, inMonth.filter(x => x.kind === k.kind).length])),
      dates_by_kind: Object.fromEntries(ACTUAL.map(k => [k.kind, new Set(inMonth.filter(x => x.kind === k.kind).map(x => x.day)).size]))};
  });
  const dates = {};
  for (const x of [...counted].sort((a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : 0)) (dates[x.day] = dates[x.day] || []).push(x.id);
  return {rows, counted, exclusions, kinds, monthly, dates, global: summary(counted)};
}

// Quiet spans: runs of days in the window with no counted record.
function gaps(days) {
  const active = new Set(days), spans = [], holidays = new Set(HOLIDAYS), all = [];
  let start = null;
  for (let day = FIRST; day <= LAST; day = time.addDays(day, 1)) {
    all.push(day);
    if (!active.has(day)) { if (start === null) start = day; continue; }
    if (start !== null) spans.push({from: start, to: time.addDays(day, -1), days: time.dayNumber(day) - time.dayNumber(start)});
    start = null;
  }
  if (start !== null) spans.push({from: start, to: LAST, days: time.dayNumber(LAST) - time.dayNumber(start) + 1});
  const working = day => time.weekday(day) % 6 !== 0 && !holidays.has(day);
  return {months_without_records: MONTHS.filter(month => !days.some(day => day.startsWith(month))),
    days_in_window: all.length, active_days: days.length, inactive_days: all.length - days.length,
    working_days_in_window: all.filter(working).length, active_working_days: days.filter(working).length,
    active_weekend_or_holiday_days: days.filter(day => !working(day)).length,
    longest_quiet_spans: [...spans].sort((a, b) => b.days - a.days || (a.from < b.from ? -1 : 1)).slice(0, 10)};
}

function report() {
  const texts = {'seed.json': read('seed.json'), 'clock.json': read('clock.json'), 'dataset.json': read('dataset.json')}, manifest = JSON.parse(read('manifest.json'));
  const data = JSON.parse(texts['seed.json']), clock = JSON.parse(texts['clock.json']).initial_time, dataset = JSON.parse(texts['dataset.json']);
  const actual = count(data, clock);
  const state = stateAt(data, clock), scheduled = SCHEDULED.map(kind => {
    const rows = kind.rows(data, state).map(([id, value, st]) => ({id, value, day: dayOf(value), ...(st ? {state: st} : {})}));
    const out = {kind: kind.kind, date_field: kind.field, rows: rows.length, after_clock: rows.filter(x => /T/.test(x.value) ? Date.parse(x.value) > Date.parse(clock) : x.day > dayOf(clock)).map(x => ({id: x.id, value: x.value}))};
    return kind.kind === 'payment_intended_days' ? {...out, listed: rows.map(({id, value, state: st}) => ({id, value, state: st}))} : out;
  });
  // Every counted row has the class of its sources: synthetic, real (collected or reused), or mixed.
  const kinds = new Set(dataset.record_source_ids.map(id => (dataset.sources.find(s => s.source_id === id) || {kind: 'unspecified'}).kind));
  const real = [...kinds].every(kind => kind === 'collected' || kind === 'reused'), synthetic = [...kinds].every(kind => kind === 'synthetic');
  const n = actual.counted.length, share = {real: real ? n : 0, mixed: real || synthetic ? 0 : n, synthetic: synthetic ? n : 0};
  const countedDays = [...new Set(actual.counted.map(x => x.day))].sort();
  return {
    schema: 'brindle.evaluation-coverage.v1',
    scope: 'Environment coverage of the delivered evaluation seed data/evaluation/seed.json, read at its clock. Only the acts of nine record families count, each on one date field. A payment counts only for its request, its posting of money and a return, each at its own time. Due times and the intended days of payments that moved no money are listed apart. Activity rows are not counted, because each repeats an act that a counted record already dates.',
    reproduce: 'node apps/brindle/dev/coverage.cjs',
    reproduce_note: 'Run it from the repository root. With --check it compares with the committed report.',
    timezone: ZONE, window: {first: FIRST, last: LAST}, clock, clock_day: dayOf(clock),
    date_rule: 'A timestamp counts on its calendar day in ' + ZONE + ' after normalizing its UTC offset. A date-only field is a day in ' + ZONE + '. A missing or invalid date is excluded and listed.',
    files: Object.fromEntries(Object.entries(texts).map(([name, value]) => ['apps/brindle/data/evaluation/' + name, {bytes: Buffer.byteLength(value), sha256: sha256(value)}])),
    generator: {tool: manifest.generator, version: manifest.generator_version, prng: manifest.prng, prng_seed: manifest.prng_seed, stories: manifest.counts.stories},
    provenance: {dataset_id: dataset.dataset_id, source_ids: dataset.record_source_ids, source_kinds: [...kinds].sort(), ...share,
      note: 'Counts are of the counted rows. Every record is synthetic: Brindle models no real issuer or website, so there is no real source to collect or to anchor.'},
    app_records: {count: records(data).length, kinds: 'statements, transactions, payments, disputes, offers, points_entries', dataset_expected: dataset.expected_counts.records},
    not_counted: {activity: {field: 'activity[].at', rows: data.activity.length, reason: 'Each activity row repeats a write, an event or an effect that a counted record already dates.'}},
    actual: {total_rows: actual.rows.length, counted_rows: n, global: actual.global, kinds: actual.kinds, monthly: actual.monthly, gaps: gaps(countedDays),
      exclusions: actual.exclusions, dates: actual.dates},
    scheduled: {note: 'Not counted. A statement due time and an offer deadline are due times of a schedule. The intended day (pay_on) of a cancelled, skipped or still scheduled payment is a plan, not an act: no money moved on it. Rows after the clock are future rows.', kinds: scheduled}
  };
}

const SHORT = {transactions: 'txn', statements: 'stm', payment_requests: 'preq', payment_postings: 'ppost', payment_returns: 'pret', disputes: 'dsp', offers: 'off', points_entries: 'pts', notifications: 'ntf'};
function markdown(r) {
  const a = r.actual, lines = [];
  const table = (head, rows) => { lines.push('| ' + head.join(' | ') + ' |', '|' + head.map(() => ' --- ').join('|') + '|'); rows.forEach(row => lines.push('| ' + row.join(' | ') + ' |')); lines.push(''); };
  lines.push('# Brindle delivery dataset: date coverage', '', 'Generated by `' + r.reproduce + '`. ' + r.reproduce_note + ' Do not edit by hand.', '');
  lines.push('- Scope: ' + r.scope, '- Time zone: `' + r.timezone + '`. ' + r.date_rule, '- Window: ' + r.window.first + ' to ' + r.window.last + '. Seed clock: `' + r.clock + '`.',
    '- Provenance: ' + r.provenance.synthetic + ' synthetic rows, ' + r.provenance.real + ' real, ' + r.provenance.mixed + ' mixed (dataset `' + r.provenance.dataset_id + '`). ' + r.provenance.note,
    '- App records (the count that `env.load_seed` returns): ' + r.app_records.count + '. Stories in the manifest: ' + r.generator.stories + '.',
    '- Not counted: ' + r.not_counted.activity.rows + ' activity rows. ' + r.not_counted.activity.reason, '');
  lines.push('## Files', '');
  table(['File', 'Bytes', 'SHA-256'], Object.entries(r.files).map(([name, f]) => ['`' + name + '`', f.bytes, '`' + f.sha256 + '`']));
  lines.push('## Counted records', '', 'Global deduplicated count: **' + a.global.distinct_dates + ' distinct dates** from ' + a.counted_rows + ' rows, ' + a.global.earliest + ' to ' + a.global.latest + '.', '');
  table(['Kind', 'Date field', 'Rows', 'Counted', 'Distinct dates', 'Earliest', 'Latest', 'Excluded'],
    a.kinds.map(k => ['`' + k.kind + '`', '`' + k.date_field + '`', k.rows, k.records, k.distinct_dates, k.earliest, k.latest, k.excluded]));
  lines.push('### By month', '', 'Rows per kind, then all rows and distinct dates. Column keys: ' + Object.entries(SHORT).map(([k, v]) => v + ' = `' + k + '`').join(', ') + '.', '');
  table(['Month', ...Object.values(SHORT), 'rows', 'dates'], a.monthly.map(m => [m.month, ...Object.keys(SHORT).map(k => m.by_kind[k]), m.records, m.distinct_dates]));
  lines.push('### Gaps', '', '- Months with no record: ' + (a.gaps.months_without_records.join(', ') || 'none') + '.',
    '- Active days: ' + a.gaps.active_days + ' of ' + a.gaps.days_in_window + '. Active working days: ' + a.gaps.active_working_days + ' of ' + a.gaps.working_days_in_window +
    '. Active weekend or holiday days: ' + a.gaps.active_weekend_or_holiday_days + '.', '- Longest spans with no record:', '');
  table(['From', 'To', 'Days'], a.gaps.longest_quiet_spans.map(g => [g.from, g.to, g.days]));
  lines.push('### Exclusions', '');
  if (a.exclusions.length) table(['Kind', 'ID', 'Value', 'Reason'], a.exclusions.map(x => ['`' + x.kind + '`', '`' + x.id + '`', '`' + x.value + '`', x.reason]));
  else lines.push('None.', '');
  lines.push('## Due times (not counted)', '', r.scheduled.note, '');
  table(['Kind', 'Date field', 'Rows', 'After the clock'], r.scheduled.kinds.map(k => ['`' + k.kind + '`', '`' + k.date_field + '`', k.rows,
    k.after_clock.map(x => '`' + x.id + '` ' + x.value).join(', ') || 'none']));
  for (const k of r.scheduled.kinds.filter(x => x.listed)) {
    lines.push('Intended days of payments that moved no money (`' + k.kind + '`):', '');
    table(['Payment', 'State', '`pay_on`'], k.listed.map(x => ['`' + x.id + '`', x.state, x.value]));
  }
  lines.push('The JSON report also lists the record IDs behind each counted date (`actual.dates`).', '');
  return lines.join('\n');
}

function main() {
  const r = report(), files = {'coverage.json': JSON.stringify(r, null, 2) + '\n', 'coverage.md': markdown(r)}, check = process.argv.includes('--check'), stale = [];
  for (const [name, value] of Object.entries(files)) {
    const target = path.join(DIR, name);
    if (check) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== value) stale.push(name); } else fs.writeFileSync(target, value);
  }
  if (stale.length) { console.error('The coverage report is out of date in data/evaluation: ' + stale.join(', ')); process.exitCode = 1; return; }
  console.log((check ? 'Checked' : 'Wrote') + ' data/evaluation/coverage.json and coverage.md: ' + r.actual.global.distinct_dates + ' distinct dates from ' + r.actual.counted_rows +
    ' counted rows (' + r.actual.global.earliest + ' to ' + r.actual.global.latest + '), ' + r.actual.exclusions.length + ' excluded, ' + r.actual.gaps.months_without_records.length + ' months with no record.');
}
if (require.main === module) main();
module.exports = {report, count, dayOf, ACTUAL, SCHEDULED};
