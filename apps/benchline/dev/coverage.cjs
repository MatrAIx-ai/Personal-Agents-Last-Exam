'use strict';
// Counts the dates of the delivery dataset: the records that the App loads, read from data/evaluation/seed.json at its clock.
// It writes data/evaluation/coverage.json and coverage.md. Run `node dev/coverage.cjs`, or with `--check` to compare with the committed files.
// Only acts that happened count, each on the date it happened. A planned time (a respond_by, a job's planned start or end, a notice not yet
// released or removed before its release) is listed apart and never counted.
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
const ms = Date.parse;
const MONTHS = [];
for (let year = 2025; year <= 2026; year++) for (let month = 1; month <= 12; month++) MONTHS.push(year + '-' + String(month).padStart(2, '0'));
// A timestamp counts on its calendar day in ZONE after normalizing its offset.
function dayOf(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(ms(value))) return null;
  return time.localDay(ms(value), ZONE);
}

// The seven record kinds of the plan, each with one date field of an act that happened. Only these count toward coverage.
const ACTUAL = [
  {kind: 'jobs', field: 'jobs[].submitted_at', note: 'the submission of a job, by the researcher, her script or a labmate. A submission is an act even when the job was held, cancelled or never ran.',
    rows: data => data.jobs.map(x => [x.id, x.submitted_at])},
  {kind: 'protocol_versions', field: 'protocols[].proposed_at', note: 'the proposal of a protocol version.', rows: data => data.protocols.map(x => [x.id, x.proposed_at])},
  {kind: 'signoffs', field: 'protocols[].signoffs[].at', note: 'a signature or a decline.', rows: data => data.protocols.flatMap(p => p.signoffs.map(s => [p.id + ' ' + s.person_id, s.at]))},
  {kind: 'table_versions', field: 'tables[].created_at', note: 'the creation of a results table version.', rows: data => data.tables.map(x => [x.id, x.created_at])},
  {kind: 'allocation_changes', field: 'allocation_changes[].at', note: 'a change of the allocation or of a share.', rows: data => data.allocation_changes.map(x => [x.id, x.at])},
  {kind: 'result_dispositions', field: 'jobs[].review.updated_at', note: 'the last tag, note or disposition of a result.',
    rows: data => data.jobs.filter(j => j.review).map(j => [j.id, j.review.updated_at])},
  {kind: 'notifications', field: 'notifications[].at', note: 'the release of a notification that was released by the clock and not removed.',
    rows: (data, now) => data.notifications.filter(n => n.removed_at === null && ms(n.at) <= now).map(n => [n.id, n.at])}
];
// Planned times. They are schedules, not acts, so they are listed apart and never counted.
const SCHEDULED = [
  {kind: 'respond_by', field: 'protocols[].respond_by', note: 'the deadline for answers of a proposed version.', rows: (data, now) => data.protocols.filter(p => p.stored_state === 'proposed').map(p => [p.id, p.respond_by])},
  {kind: 'planned_runs', field: 'jobs[].run.starts_at and .ends_at', note: 'the planned start and end of a job that has not ended by the clock.',
    rows: (data, now) => data.jobs.filter(j => ['queued', 'running'].includes(views.jobState(j, now)) && j.run).map(j => [j.id, j.run.ends_at])},
  {kind: 'pending_notices', field: 'notifications[].at', note: 'a job.ended notice released after the clock.', rows: (data, now) => data.notifications.filter(n => n.removed_at === null && ms(n.at) > now).map(n => [n.id, n.at])},
  {kind: 'removed_notices', field: 'notifications[].at', note: 'the intended release of a notice that a cancellation, a hold or an interruption removed. It was never released.',
    rows: data => data.notifications.filter(n => n.removed_at !== null).map(n => [n.id, n.at])},
  {kind: 'never_ran', field: 'jobs[].submitted_at', note: 'a job that was held or cancelled before it started. Only its submission counts, as a job.',
    rows: (data, now) => data.jobs.filter(j => ['held', 'cancelled'].includes(views.jobState(j, now)) && !(j.run && ms(j.run.starts_at) <= ms(j.cancelled_at || j.submitted_at))).map(j => [j.id, j.submitted_at])}
];

function count(data, clock) {
  const rows = [], exclusions = [], now = ms(clock), clockDay = dayOf(clock);
  for (const kind of ACTUAL) for (const [id, value] of kind.rows(data, now)) {
    const day = dayOf(value);
    let reason = day === null ? 'invalid or missing date' : null;
    if (!reason && day < FIRST) reason = 'before ' + FIRST + ': the setup of the lab, before the window';
    if (!reason && (day > clockDay || ms(value) > now)) reason = 'after the clock ' + clock;
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
    return {kind: kind.kind, date_field: kind.field, counts: kind.note, rows: all.length, ...summary(inside), excluded: all.length - inside.length};
  });
  const monthly = MONTHS.map(month => {
    const inMonth = counted.filter(x => x.day.slice(0, 7) === month);
    return {month, records: inMonth.length, distinct_dates: new Set(inMonth.map(x => x.day)).size,
      by_kind: Object.fromEntries(ACTUAL.map(k => [k.kind, inMonth.filter(x => x.kind === k.kind).length]))};
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
  const data = JSON.parse(texts['seed.json']), clock = JSON.parse(texts['clock.json']).initial_time, dataset = JSON.parse(texts['dataset.json']), now = ms(clock);
  const actual = count(data, clock);
  const scheduled = SCHEDULED.map(kind => {
    const listed = kind.rows(data, now).map(([id, value]) => ({id, value}));
    return {kind: kind.kind, date_field: kind.field, note: kind.note, rows: listed.length, listed};
  });
  const kinds = new Set(dataset.record_source_ids.map(id => (dataset.sources.find(s => s.source_id === id) || {kind: 'unspecified'}).kind));
  const real = [...kinds].every(kind => kind === 'collected' || kind === 'reused'), synthetic = [...kinds].every(kind => kind === 'synthetic');
  const n = actual.counted.length, share = {real: real ? n : 0, mixed: real || synthetic ? 0 : n, synthetic: synthetic ? n : 0};
  const countedDays = [...new Set(actual.counted.map(x => x.day))].sort();
  return {
    schema: 'benchline.evaluation-coverage.v1',
    scope: 'Environment coverage of the delivered evaluation seed data/evaluation/seed.json, read at its clock. Only the seven record kinds of the plan count, each on the date field of an act that happened. Planned times are listed apart. Activity rows are not counted, because each repeats an act that a counted record already dates.',
    reproduce: 'node apps/benchline/dev/coverage.cjs',
    reproduce_note: 'Run it from the repository root. With --check it compares with the committed report.',
    timezone: ZONE, window: {first: FIRST, last: LAST}, clock, clock_day: dayOf(clock),
    date_rule: 'A timestamp counts on its calendar day in ' + ZONE + ' after normalizing its UTC offset. A missing or invalid date is excluded and listed.',
    files: Object.fromEntries(Object.entries(texts).map(([name, value]) => ['apps/benchline/data/evaluation/' + name, {bytes: Buffer.byteLength(value), sha256: sha256(value)}])),
    generator: {tool: manifest.generator, version: manifest.version, prng_seed: manifest.prng_seed, stories: manifest.counts.stories},
    provenance: {dataset_id: dataset.dataset_id, source_ids: dataset.record_source_ids, source_kinds: [...kinds].sort(), ...share,
      note: 'Counts are of the counted rows. Every record is synthetic: Benchline models no real cluster or website, so there is no real source to collect or to anchor.'},
    app_records: {count: records(data).length, kinds: 'configs, protocols, run_plans, jobs, tables, allocation_changes', dataset_expected: dataset.expected_counts.records},
    not_counted: {activity: {field: 'activity[].at', rows: data.activity.length, reason: 'Each activity row repeats a write, an event or an effect that a counted record already dates.'},
      run_plans: {field: 'run_plans[].set_at', rows: data.run_plans.length, reason: 'A run plan is world data that the cluster gives, and the App never shows it.'}},
    actual: {total_rows: actual.rows.length, counted_rows: n, global: actual.global, kinds: actual.kinds, monthly: actual.monthly, gaps: gaps(countedDays),
      exclusions: actual.exclusions, dates: actual.dates},
    scheduled: {note: 'Not counted. These are planned times, or acts that did not happen at the time they name.', kinds: scheduled},
    samples: samples(data, now)
  };
}

// A fixed sample of records with a short plain description of each.
function samples(data, now) {
  const out = [], job = j => {
    const st = views.jobState(j, now), m = st === 'completed' ? ' ' + Object.entries(j.run.metrics).map(([k, v]) => k + ' ' + v).join(', ') + '.' : '.';
    return {kind: 'job', id: j.id, at: j.submitted_at, text: j.owner_person_id + ' runs ' + j.config_id + ' seed ' + j.seed + ' on ' + j.gpus + ' x ' + j.partition_id + ' under ' + (j.protocol_id || 'no protocol') +
      ' (' + j.submitted_by + '): ' + st + m};
  };
  for (const owner of [...new Set(data.jobs.map(j => j.owner_person_id))]) out.push(job(data.jobs.find(j => j.owner_person_id === owner)));
  for (const state of ['failed', 'timed_out', 'interrupted', 'cancelled']) { const j = data.jobs.find(x => views.jobState(x, now) === state && !out.some(o => o.id === x.id)); if (j) out.push(job(j)); }
  const p = data.protocols.find(x => x.signoffs.length && x.proposed_at >= '2025');
  out.push({kind: 'protocol version', id: p.id, at: p.proposed_at, text: p.proposed_by + ' proposes: ' + p.rationale + ' State: ' + p.stored_state + '.'});
  const t = data.tables.find(x => x.manifest);
  out.push({kind: 'table version', id: t.id, at: t.created_at, text: t.title + ', ' + t.rows.length + ' rows, ' + t.stored_state + '.'});
  const c = data.allocation_changes[0];
  out.push({kind: 'allocation change', id: c.id, at: c.at, text: c.from_hours + ' to ' + c.to_hours + ' GPU-hours: ' + c.reason});
  const cfg = data.configs[data.configs.length - 1];
  out.push({kind: 'config', id: cfg.id, at: cfg.registered_at, text: cfg.family + ' on ' + cfg.dataset_version + ' / ' + cfg.eval_split + ', ' + JSON.stringify(cfg.params)});
  return out;
}
const SHORT = {jobs: 'job', protocol_versions: 'ver', signoffs: 'sign', table_versions: 'tbl', allocation_changes: 'alc', result_dispositions: 'res', notifications: 'ntf'};
function markdown(r) {
  const a = r.actual, lines = [];
  const table = (head, rows) => { lines.push('| ' + head.join(' | ') + ' |', '|' + head.map(() => ' --- ').join('|') + '|'); rows.forEach(row => lines.push('| ' + row.join(' | ') + ' |')); lines.push(''); };
  lines.push('# Benchline delivery dataset: date coverage', '', 'Generated by `' + r.reproduce + '`. ' + r.reproduce_note + ' Do not edit by hand.', '');
  lines.push('- Scope: ' + r.scope, '- Time zone: `' + r.timezone + '`. ' + r.date_rule, '- Window: ' + r.window.first + ' to ' + r.window.last + '. Seed clock: `' + r.clock + '`.',
    '- Provenance: ' + r.provenance.synthetic + ' synthetic rows, ' + r.provenance.real + ' real, ' + r.provenance.mixed + ' mixed (dataset `' + r.provenance.dataset_id + '`). ' + r.provenance.note,
    '- App records (the count that `env.load_seed` returns): ' + r.app_records.count + '. Stories in the manifest: ' + r.generator.stories + '.',
    '- Not counted: ' + r.not_counted.activity.rows + ' activity rows (' + r.not_counted.activity.reason + ') and ' + r.not_counted.run_plans.rows + ' run plans (' + r.not_counted.run_plans.reason + ')', '');
  lines.push('## Files', '');
  table(['File', 'Bytes', 'SHA-256'], Object.entries(r.files).map(([name, f]) => ['`' + name + '`', f.bytes, '`' + f.sha256 + '`']));
  lines.push('## Counted records', '', 'Global deduplicated count: **' + a.global.distinct_dates + ' distinct dates** from ' + a.counted_rows + ' rows, ' + a.global.earliest + ' to ' + a.global.latest + '.', '');
  table(['Kind', 'Date field', 'What counts', 'Rows', 'Counted', 'Distinct dates', 'Earliest', 'Latest', 'Excluded'],
    a.kinds.map(k => ['`' + k.kind + '`', '`' + k.date_field + '`', k.counts, k.rows, k.records, k.distinct_dates, k.earliest, k.latest, k.excluded]));
  lines.push('### By month', '', 'Rows per kind, then all rows and distinct dates. Column keys: ' + Object.entries(SHORT).map(([k, v]) => v + ' = `' + k + '`').join(', ') + '.', '');
  table(['Month', ...Object.values(SHORT), 'rows', 'dates'], a.monthly.map(m => [m.month, ...Object.keys(SHORT).map(k => m.by_kind[k]), m.records, m.distinct_dates]));
  lines.push('### Gaps', '', '- Months with no record: ' + (a.gaps.months_without_records.join(', ') || 'none') + '.',
    '- Active days: ' + a.gaps.active_days + ' of ' + a.gaps.days_in_window + '. Active working days: ' + a.gaps.active_working_days + ' of ' + a.gaps.working_days_in_window +
    '. Active weekend or holiday days: ' + a.gaps.active_weekend_or_holiday_days + '.', '- Longest spans with no record:', '');
  table(['From', 'To', 'Days'], a.gaps.longest_quiet_spans.map(g => [g.from, g.to, g.days]));
  lines.push('### Exclusions', '');
  const byReason = {};
  for (const x of a.exclusions) byReason[x.kind + '|' + x.reason] = (byReason[x.kind + '|' + x.reason] || 0) + 1;
  if (a.exclusions.length) table(['Kind', 'Reason', 'Rows'], Object.entries(byReason).map(([k, n]) => ['`' + k.split('|')[0] + '`', k.split('|')[1], n]));
  else lines.push('None.', '');
  lines.push('The JSON report lists each excluded row with its ID and date.', '');
  lines.push('## Planned times and acts that did not happen (not counted)', '', r.scheduled.note, '');
  table(['Kind', 'Date field', 'What it is', 'Rows', 'Listed'], r.scheduled.kinds.map(k => ['`' + k.kind + '`', '`' + k.date_field + '`', k.note, k.rows,
    k.listed.slice(0, 6).map(x => '`' + x.id + '` ' + x.value).join(', ') + (k.listed.length > 6 ? ', and ' + (k.listed.length - 6) + ' more' : '') || 'none']));
  lines.push('The JSON report also lists the record IDs behind each counted date (`actual.dates`).', '');
  lines.push('## Sample records', '', 'A fixed sample, so a reader can see what the counted records hold without opening the one-line seed: the first job of each owner, one of each end kind, and one record of each other kind.', '');
  table(['Kind', 'ID', 'Date', 'What it is'], r.samples.map(x => ['`' + x.kind + '`', '`' + x.id + '`', x.at, x.text]));
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
