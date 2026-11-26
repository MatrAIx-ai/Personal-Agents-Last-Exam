'use strict';
// Counts the dates of the evaluation seed: the records that the App loads, read from data/evaluation/seed.json.
// It writes data/evaluation/coverage.json and coverage.md. Run `node dev/coverage.cjs`, or with `--check` to compare with the committed files.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const time = require('../src/time.cjs');
const {records} = require('../src/model.cjs');

const DIR = path.resolve(__dirname, '../data/evaluation'), ZONE = 'America/New_York', FIRST = '2025-01-01', LAST = '2026-12-31';
const read = name => fs.readFileSync(path.join(DIR, name), 'utf8');
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const MONTHS = [];
for (let year = 2025; year <= 2026; year++) for (let month = 1; month <= 12; month++) MONTHS.push(year + '-' + String(month).padStart(2, '0'));
// A timestamp counts on its calendar day in ZONE. A date-only field is already a day in ZONE.
function dayOf(value) {
  if (typeof value !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return time.validDay(value) ? value : null;
  const instant = Date.parse(value);
  return /^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(instant) ? time.localDay(instant, ZONE) : null;
}

// Actual dated records: what happened in the history. Each kind has one authoritative date field. Only these count toward coverage.
const statementsOf = data => data.statements;
const ACTUAL = [
  {kind: 'pay_statements', field: 'statements[].posted_at', rows: data => statementsOf(data).map(s => [s.id, s.posted_at])},
  {kind: 'deposit_updates', field: 'statements[].deposits[].history[].at (state returned or reissued)',
    rows: data => statementsOf(data).flatMap(s => s.deposits.flatMap(d => d.history.filter(h => h.state !== 'sent').map(h => [d.id + ':' + h.state, h.at])))},
  {kind: 'setting_changes', field: 'changes[].made_at', rows: data => data.changes.map(x => [x.id, x.made_at])},
  {kind: 'setting_cancellations', field: 'changes[].cancelled_at', rows: data => data.changes.filter(x => x.cancelled_at).map(x => [x.id, x.cancelled_at])},
  {kind: 'pay_inquiries', field: 'inquiries[].opened_at', rows: data => data.inquiries.map(x => [x.id, x.opened_at])},
  {kind: 'inquiry_withdrawals', field: 'inquiries[].withdrawn_at', rows: data => data.inquiries.filter(x => x.withdrawn_at).map(x => [x.id, x.withdrawn_at])},
  {kind: 'inquiry_answers', field: 'inquiries[].answer.answered_at', rows: data => data.inquiries.filter(x => x.answer).map(x => [x.id, x.answer.answered_at])},
  {kind: 'leave_requests', field: 'leave_requests[].requested_at', rows: data => data.leave_requests.map(x => [x.id, x.requested_at])},
  {kind: 'leave_decisions', field: 'leave_requests[].decided_at', rows: data => data.leave_requests.filter(x => x.decided_at).map(x => [x.id, x.decided_at])},
  {kind: 'leave_cancellations', field: 'leave_requests[].cancelled_at', rows: data => data.leave_requests.filter(x => x.cancelled_at).map(x => [x.id, x.cancelled_at])},
  {kind: 'leave_entries', field: 'leave_entries[].at', rows: data => data.leave_entries.map(x => [x.id, x.at])},
  {kind: 'benefit_choices', field: 'windows[].saved[].saved_at', rows: data => data.windows.flatMap(w => w.saved.map((x, i) => [w.id + ':' + x.plan_id + ':' + (i + 1), x.saved_at]))},
  {kind: 'election_sets', field: 'election_sets[].submitted_at', rows: data => data.election_sets.map(x => [x.id, x.submitted_at])},
  {kind: 'notifications', field: 'notifications[].at', rows: data => data.notifications.map(x => [x.id, x.at])},
  {kind: 'activity', field: 'activity[].at', rows: data => data.activity.map(x => ['seq-' + x.seq, x.at])}
];
// Scheduled or future rows: dates that a schedule names, or that come after the clock. They are reported apart and never counted.
const SCHEDULED = [
  {kind: 'pay_calendar', field: 'calendar[].pay_date', rows: data => data.calendar.map(x => [x.id, x.pay_date, x.state])},
  {kind: 'pay_cutoffs', field: 'calendar[].cutoff_at', rows: data => data.calendar.map(x => [x.id, x.cutoff_at, x.state])},
  {kind: 'enrollment_windows', field: 'windows[].opens_at', rows: data => data.windows.map(x => [x.id, x.opens_at, 'closes ' + x.closes_at])},
  {kind: 'leave_days', field: 'leave_requests[].days[]', rows: data => data.leave_requests.flatMap(x => x.days.map(day => [x.id + ':' + day, day]))},
  {kind: 'company_holidays', field: 'employer.holidays[]', rows: data => data.employer.holidays.map(day => ['holiday:' + day, day])}
];

function count(kinds, data, clockDay, actual) {
  const rows = [], exclusions = [];
  for (const kind of kinds) for (const [id, value, note] of kind.rows(data)) {
    const day = dayOf(value);
    let reason = day === null ? 'invalid or missing date' : day < FIRST ? 'before ' + FIRST : day > LAST ? 'after ' + LAST : null;
    if (actual && !reason && Date.parse(value) > Date.parse(data.clock)) reason = 'after the clock ' + data.clock;
    rows.push({kind: kind.kind, id, day, value, note});
    if (reason) exclusions.push({kind: kind.kind, id, value, reason});
  }
  const excluded = new Set(exclusions.map(x => x.kind + '|' + x.id)), counted = rows.filter(x => !excluded.has(x.kind + '|' + x.id));
  const summary = list => {
    const days = [...new Set(list.map(x => x.day))].sort();
    return {records: list.length, distinct_dates: days.length, earliest: days[0] || null, latest: days[days.length - 1] || null};
  };
  const perKind = kinds.map(kind => {
    const all = rows.filter(x => x.kind === kind.kind), inside = counted.filter(x => x.kind === kind.kind);
    const out = {kind: kind.kind, date_field: kind.field, rows: all.length, ...summary(inside), excluded: all.length - inside.length};
    if (!actual) out.after_clock = all.filter(x => x.day !== null && x.day > clockDay).length;
    return out;
  });
  const monthly = MONTHS.map(month => {
    const inMonth = counted.filter(x => x.day.slice(0, 7) === month);
    return {month, records: inMonth.length, distinct_dates: new Set(inMonth.map(x => x.day)).size,
      by_kind: Object.fromEntries(kinds.map(k => [k.kind, inMonth.filter(x => x.kind === k.kind).length]))};
  });
  return {rows, counted, exclusions, perKind, monthly, global: summary(counted)};
}

// Quiet spans: runs of days in the window with no actual record. Weekends and holidays make most of them.
function gaps(days, holidays) {
  const active = new Set(days), spans = [];
  let start = null;
  for (let day = FIRST; day <= LAST; day = time.addDays(day, 1)) {
    if (!active.has(day)) { if (start === null) start = day; continue; }
    if (start !== null) spans.push({from: start, to: time.addDays(day, -1), days: time.dayNumber(day) - time.dayNumber(start)});
    start = null;
  }
  if (start !== null) spans.push({from: start, to: LAST, days: time.dayNumber(LAST) - time.dayNumber(start) + 1});
  const working = day => time.weekday(day) % 6 !== 0 && !holidays.includes(day);
  const all = [];
  for (let day = FIRST; day <= LAST; day = time.addDays(day, 1)) all.push(day);
  return {months_without_actual_records: MONTHS.filter(month => !days.some(day => day.startsWith(month))),
    days_in_window: all.length, active_days: days.length, inactive_days: all.length - days.length,
    working_days_in_window: all.filter(working).length, active_working_days: days.filter(working).length,
    active_weekend_or_holiday_days: days.filter(day => !working(day)).length,
    longest_quiet_spans: [...spans].sort((a, b) => b.days - a.days || (a.from < b.from ? -1 : 1)).slice(0, 10)};
}

function report() {
  const texts = {'seed.json': read('seed.json'), 'clock.json': read('clock.json'), 'dataset.json': read('dataset.json')}, manifest = JSON.parse(read('manifest.json'));
  const data = JSON.parse(texts['seed.json']), clock = JSON.parse(texts['clock.json']).initial_time, dataset = JSON.parse(texts['dataset.json']);
  data.clock = clock;
  const clockDay = dayOf(clock), actual = count(ACTUAL, data, clockDay, true), scheduled = count(SCHEDULED, data, clockDay, false);
  // The seed has one set of record sources, so every counted row has the same class: synthetic, real (collected or reused), or mixed.
  const kinds = new Set(dataset.record_source_ids.map(id => (dataset.sources.find(s => s.source_id === id) || {kind: 'unspecified'}).kind));
  const real = [...kinds].every(kind => kind === 'collected' || kind === 'reused'), synthetic = [...kinds].every(kind => kind === 'synthetic');
  const share = {real: real ? actual.counted.length : 0, mixed: real || synthetic ? 0 : actual.counted.length, synthetic: synthetic ? actual.counted.length : 0};
  const countedDays = [...new Set(actual.counted.map(x => x.day))].sort();
  return {
    schema: 'payleaf.evaluation-coverage.v1',
    scope: 'Environment coverage of the delivered evaluation seed data/evaluation/seed.json, read at its clock. Only actual dated records count. Scheduled or future rows are listed apart.',
    reproduce: 'node apps/payleaf/dev/coverage.cjs',
    reproduce_note: 'Run it from the repository root. With --check it compares with the committed report.',
    timezone: ZONE, window: {first: FIRST, last: LAST}, clock, clock_day: clockDay,
    date_rule: 'A timestamp counts on its calendar day in ' + ZONE + ' after normalizing its UTC offset. A date-only field is a day in ' + ZONE + '. A missing or invalid date is excluded and listed.',
    files: Object.fromEntries(Object.entries(texts).map(([name, text]) => ['apps/payleaf/data/evaluation/' + name, {bytes: Buffer.byteLength(text), sha256: sha256(text)}])),
    generator: {tool: manifest.generator, version: manifest.generator_version, prng: manifest.prng, prng_seed: manifest.prng_seed},
    provenance: {dataset_id: dataset.dataset_id, source_ids: dataset.record_source_ids, source_kinds: [...kinds].sort(), ...share,
      note: 'Counts are of the counted actual rows. Every record is synthetic: the product is fictional, so there is no real source to collect or to anchor.'},
    app_records: {count: records(data).length, kinds: 'calendar, statements, changes, inquiries, leave_requests, windows, election_sets', dataset_expected: dataset.expected_counts.records},
    actual: {total_rows: actual.rows.length, counted_rows: actual.counted.length, global: actual.global, kinds: actual.perKind, monthly: actual.monthly,
      gaps: gaps(countedDays, data.employer.holidays), exclusions: actual.exclusions},
    scheduled: {note: 'Not counted. Pay calendar entries, cut-offs, enrollment windows, leave days and holidays are schedules. Rows after the clock day are future rows.',
      total_rows: scheduled.rows.length, kinds: scheduled.perKind, monthly: scheduled.monthly, outside_window: scheduled.exclusions,
      future_rows: scheduled.rows.filter(x => x.day !== null && x.day > clockDay).map(x => ({kind: x.kind, id: x.id, value: x.value, ...(x.note ? {note: x.note} : {})}))}
  };
}

const SHORT = {pay_statements: 'stmt', deposit_updates: 'dep', setting_changes: 'chg', setting_cancellations: 'chg-x', pay_inquiries: 'inq', inquiry_withdrawals: 'inq-w',
  inquiry_answers: 'inq-a', leave_requests: 'lv', leave_decisions: 'lv-d', leave_cancellations: 'lv-x', leave_entries: 'le', benefit_choices: 'ben', election_sets: 'els',
  notifications: 'ntf', activity: 'act'};
function markdown(r) {
  const a = r.actual, s = r.scheduled, lines = [];
  const table = (head, rows) => { lines.push('| ' + head.join(' | ') + ' |', '|' + head.map(() => ' --- ').join('|') + '|'); rows.forEach(row => lines.push('| ' + row.join(' | ') + ' |')); lines.push(''); };
  lines.push('# Payleaf evaluation data: date coverage', '', 'Generated by `' + r.reproduce + '`. ' + r.reproduce_note + ' Do not edit by hand.', '');
  lines.push('- Scope: ' + r.scope, '- Time zone: `' + r.timezone + '`. ' + r.date_rule, '- Window: ' + r.window.first + ' to ' + r.window.last + '. Seed clock: `' + r.clock + '`.',
    '- Provenance: ' + r.provenance.synthetic + ' synthetic rows, ' + r.provenance.real + ' real, ' + r.provenance.mixed + ' mixed (dataset `' + r.provenance.dataset_id + '`). ' + r.provenance.note,
    '- App records (the count that `env.load_seed` returns): ' + r.app_records.count + '.', '');
  lines.push('## Files', '');
  table(['File', 'Bytes', 'SHA-256'], Object.entries(r.files).map(([name, f]) => ['`' + name + '`', f.bytes, '`' + f.sha256 + '`']));
  lines.push('## Actual dated records (counted)', '', 'Global deduplicated count: **' + a.global.distinct_dates + ' distinct dates** from ' + a.counted_rows + ' rows, ' + a.global.earliest + ' to ' + a.global.latest + '.', '');
  table(['Kind', 'Date field', 'Rows', 'Distinct dates', 'Earliest', 'Latest', 'Excluded'], a.kinds.map(k => ['`' + k.kind + '`', '`' + k.date_field + '`', k.records, k.distinct_dates, k.earliest, k.latest, k.excluded]));
  lines.push('### By month', '', 'Rows per kind, then all rows and distinct dates. Column keys: ' + Object.entries(SHORT).map(([k, v]) => v + ' = `' + k + '`').join(', ') + '.', '');
  table(['Month', ...Object.values(SHORT), 'rows', 'dates'], a.monthly.map(m => [m.month, ...Object.keys(SHORT).map(k => m.by_kind[k]), m.records, m.distinct_dates]));
  lines.push('### Gaps', '', '- Months with no actual record: ' + (a.gaps.months_without_actual_records.join(', ') || 'none') + '.',
    '- Active days: ' + a.gaps.active_days + ' of ' + a.gaps.days_in_window + '. Active working days: ' + a.gaps.active_working_days + ' of ' + a.gaps.working_days_in_window +
    '. Active weekend or holiday days: ' + a.gaps.active_weekend_or_holiday_days + '.', '- Longest spans with no actual record:', '');
  table(['From', 'To', 'Days'], a.gaps.longest_quiet_spans.map(g => [g.from, g.to, g.days]));
  lines.push('### Exclusions', '');
  if (a.exclusions.length) table(['Kind', 'ID', 'Value', 'Reason'], a.exclusions.map(x => ['`' + x.kind + '`', '`' + x.id + '`', '`' + x.value + '`', x.reason]));
  else lines.push('None.', '');
  lines.push('## Scheduled or future rows (not counted)', '', s.note, '');
  table(['Kind', 'Date field', 'Rows', 'In window', 'Distinct dates in window', 'Earliest', 'Latest', 'Outside window', 'After the clock day'],
    s.kinds.map(k => ['`' + k.kind + '`', '`' + k.date_field + '`', k.rows, k.records, k.distinct_dates, k.earliest, k.latest, k.excluded, k.after_clock]));
  lines.push('Future rows (after ' + r.clock_day + '):', '');
  table(['Kind', 'ID', 'Value', 'Note'], s.future_rows.map(x => ['`' + x.kind + '`', '`' + x.id + '`', '`' + x.value + '`', x.note || '']));
  return lines.join('\n');
}

function main() {
  const r = report(), files = {'coverage.json': JSON.stringify(r, null, 2) + '\n', 'coverage.md': markdown(r)}, check = process.argv.includes('--check'), stale = [];
  for (const [name, text] of Object.entries(files)) {
    const target = path.join(DIR, name);
    if (check) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) stale.push(name); } else fs.writeFileSync(target, text);
  }
  if (stale.length) { console.error('Coverage report is out of date in data/evaluation: ' + stale.join(', ')); process.exitCode = 1; return; }
  console.log((check ? 'Checked' : 'Wrote') + ' data/evaluation/coverage.json and coverage.md: ' + r.actual.global.distinct_dates + ' distinct dates from ' + r.actual.counted_rows +
    ' actual rows (' + r.actual.global.earliest + ' to ' + r.actual.global.latest + '), ' + r.actual.exclusions.length + ' excluded, ' + r.scheduled.total_rows + ' scheduled rows apart.');
}
if (require.main === module) main();
module.exports = {report, dayOf, ACTUAL, SCHEDULED};
