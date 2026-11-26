#!/usr/bin/env node
'use strict';
// Environment dataset coverage report for the delivered reference dataset (fixtures/reference.json,
// the seed app.json names and Infra loads with env.load_seed). Node built-ins only, deterministic:
// no wall clock, no randomness. The counted records are exactly the plugin's records() hook, the
// list Core uses for dataset counts.
//   node scripts/dataset-coverage.cjs            print the Markdown report
//   node scripts/dataset-coverage.cjs --write    write evidence/dataset-coverage.{json,md}
//   node scripts/dataset-coverage.cjs --check    fail if the committed report differs from the fixture
//   node scripts/dataset-coverage.cjs --retrieval [--runtime DIR]
//        load the fixture into real Core and read every counted family back through the Agent tools;
//        writes evidence/dataset-retrieval.{json,md}
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const {records, COLLECTIONS} = require('../src/model.cjs');

const WINDOW = {start: '2025-01-01', end: '2026-12-31'};
const read = rel => fs.readFileSync(path.join(root, rel));
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

// Authoritative represented date of each record family. Instants are converted to the district's
// time zone before the date is taken; date-only fields are already dates in that zone.
const DATE_FIELD = {
  restrictions: {field: 'recorded_at', kind: 'instant', meaning: 'when the office put the restriction on file'},
  pickup_people: {field: 'created_at', kind: 'instant', meaning: 'when the guardian added the person'},
  dismissal_changes: {field: 'created_at', kind: 'instant', meaning: 'when the change was recorded (the day it applies to is `date`)'},
  attendance: {field: 'date', kind: 'date', meaning: 'the school day marked'},
  absence_reports: {field: 'submitted_at', kind: 'instant', meaning: 'when the guardian sent the report (the days it covers are `dates`)'},
  forms: {field: 'published_at', kind: 'instant', meaning: 'when the school published the form'},
  form_responses: {field: 'answered_at', kind: 'instant', meaning: 'when the guardian answered'},
  lunch_transactions: {field: 'at', kind: 'instant', meaning: 'when the cafeteria or the top-up recorded it'},
  menu_days: {field: 'date', kind: 'date', meaning: 'the school day the menu is for'},
  payments: {field: 'paid_at', kind: 'instant', meaning: 'when the payment was made'},
  notifications: {field: 'at', kind: 'instant', meaning: 'when the account was notified'}
};
const UNDATED = {
  schools: 'school record (bell times, term, current calendar); no occurrence date',
  staff: 'staff directory entry; no occurrence date',
  children: 'current child record; no occurrence date',
  guardian_links: 'current rights of a guardian for a child; no occurrence date',
  lunch_accounts: 'current balance and settings; the dated history is in lunch_transactions',
  payment_methods: 'current card record; no occurrence date'
};
// Seconds-precision local date in an IANA zone, built-ins only.
function localDate(iso, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'})
    .formatToParts(new Date(Date.parse(iso))).map(p => [p.type, p.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}
const months = () => { const out = []; for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++) out.push(y + '-' + String(m).padStart(2, '0')); return out; };

function compute() {
  const app = JSON.parse(read('app.json'));
  const seedFile = app.fixtures.seed, data = JSON.parse(read(seedFile));
  const clockIso = JSON.parse(read('fixtures/clock.json')).initial_time, tz = data.district.time_zone;
  const clockMs = Date.parse(clockIso), clockDate = localDate(clockIso, tz);
  const {build} = require('./build-reference-fixture.cjs');
  const authored = build({withHistory: false}), authoredIds = new Set(COLLECTIONS.flatMap(k => authored[k].map(r => k + '/' + r.id)));
  const all = records(data);
  const missing = COLLECTIONS.filter(k => !(k in DATE_FIELD) && !(k in UNDATED));
  if (missing.length) throw new Error('No date rule for ' + missing.join(', '));

  const sources = {}, exclusions = [], future = [], history = [];
  for (const k of COLLECTIONS) sources[k] = {records: 0, authored: 0, generated: 0, date_field: DATE_FIELD[k]?.field || null, date_meaning: DATE_FIELD[k]?.meaning || UNDATED[k],
    in_window_history: 0, distinct_dates: 0, earliest: null, latest: null, scheduled_after_clock: 0, excluded: 0, by_month: {}};
  for (const r of all) {
    const k = r.collection, s = sources[k], gen = !authoredIds.has(k + '/' + r.id);
    s.records++; s[gen ? 'generated' : 'authored']++;
    const rule = DATE_FIELD[k];
    if (!rule) { s.excluded++; continue; }
    const raw = r[rule.field];
    if (typeof raw !== 'string') { s.excluded++; exclusions.push({collection: k, id: r.id, reason: 'missing ' + rule.field}); continue; }
    const date = rule.kind === 'instant' ? localDate(raw, tz) : raw;
    if (rule.kind === 'instant' && Number.isNaN(Date.parse(raw)) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { s.excluded++; exclusions.push({collection: k, id: r.id, reason: 'invalid ' + rule.field}); continue; }
    if (date < WINDOW.start || date > WINDOW.end) { s.excluded++; exclusions.push({collection: k, id: r.id, date, reason: 'outside ' + WINDOW.start + '..' + WINDOW.end}); continue; }
    // History is what happened before the dataset's clock. A date-only record on the clock's own
    // date has no time to order it against 07:00, so it is counted as scheduled, not as history.
    const after = rule.kind === 'instant' ? Date.parse(raw) > clockMs : date >= clockDate;
    if (after) { s.scheduled_after_clock++; future.push({collection: k, id: r.id, date, provenance: gen ? 'generated' : 'authored'}); continue; }
    s.in_window_history++;
    history.push({collection: k, id: r.id, date, provenance: gen ? 'generated' : 'authored'});
  }
  const monthly = Object.fromEntries(months().map(m => [m, {records: 0, distinct_dates: 0, authored: 0, generated: 0, scheduled_after_clock: 0, by_source: {}}]));
  const datesBy = {}, monthDates = {};
  for (const h of history) {
    const m = h.date.slice(0, 7), row = monthly[m];
    row.records++; row[h.provenance]++; row.by_source[h.collection] = (row.by_source[h.collection] || 0) + 1;
    (monthDates[m] ||= new Set()).add(h.date);
    (datesBy[h.collection] ||= new Set()).add(h.date);
    const s = sources[h.collection]; s.by_month[m] = (s.by_month[m] || 0) + 1;
  }
  for (const f of future) monthly[f.date.slice(0, 7)].scheduled_after_clock++;
  for (const [m, set] of Object.entries(monthDates)) monthly[m].distinct_dates = set.size;
  for (const [k, set] of Object.entries(datesBy)) { const d = [...set].sort(); Object.assign(sources[k], {distinct_dates: d.length, earliest: d[0], latest: d.at(-1)}); }
  const globalDates = [...new Set(history.map(h => h.date))].sort();
  // Days the stored records refer to after the clock: scheduled or future-dated, never history.
  const scheduled = [];
  for (const dc of data.dismissal_changes) if (dc.date >= clockDate) scheduled.push({collection: 'dismissal_changes', id: dc.id, field: 'date', date: dc.date, state: dc.status});
  for (const rep of data.absence_reports) for (const d of rep.dates) if (d >= clockDate) scheduled.push({collection: 'absence_reports', id: rep.id, field: 'dates', date: d, state: rep.state});
  for (const f of data.forms) {
    const due = localDate(f.due_at, tz);
    if (Date.parse(f.due_at) > clockMs) scheduled.push({collection: 'forms', id: f.id, field: 'due_at', date: due, state: 'open until due'});
    if (f.event_date && f.event_date >= clockDate) scheduled.push({collection: 'forms', id: f.id, field: 'event_date', date: f.event_date, state: 'event'});
  }
  for (const s of data.schools) for (const day of s.calendar) if (day.date >= clockDate) scheduled.push({collection: 'schools', id: s.id, field: 'calendar[].date', date: day.date, state: day.kind});
  for (const f of future) scheduled.push({collection: f.collection, id: f.id, field: DATE_FIELD[f.collection].field, date: f.date,
    state: f.collection === 'menu_days' ? 'menu published for a coming school day' : 'record dated after the clock'});
  scheduled.sort((a, b) => a.date.localeCompare(b.date) || a.collection.localeCompare(b.collection) || a.id.localeCompare(b.id) || a.field.localeCompare(b.field));
  const scheduledMonths = {};
  for (const x of scheduled) scheduledMonths[x.date.slice(0, 7)] = (scheduledMonths[x.date.slice(0, 7)] || 0) + 1;

  const monthsWithHistory = months().filter(m => monthly[m].records > 0), monthsWithout = months().filter(m => monthly[m].records === 0);
  const hashes = {};
  for (const rel of [seedFile, 'fixtures/clock.json', 'fixtures/binding.json', 'fixtures/minimal.json', 'scripts/history.cjs', 'scripts/build-reference-fixture.cjs']) hashes[rel] = sha256(read(rel));
  const dataset = JSON.parse(read('contribution/dataset.json'));
  const generated = dataset.sources.find(s => s.source_id === 'generated');
  return {
    schema: 'bellnote.dataset-coverage.v1',
    scope: 'Environment dataset coverage of the delivered reference dataset (' + seedFile + '), the seed app.json names; not a Task history report.',
    dataset: {id: dataset.dataset_id, version: dataset.version, seed_file: seedFile, sha256: hashes[seedFile], records: all.length, expected_records: dataset.expected_counts.records},
    time_zone: tz,
    window: WINDOW,
    clock: {initial_time: clockIso, local_date: clockDate,
      rule: 'A record counts as history when its authoritative instant is at or before the clock, or its date-only field is before the clock date. Records dated after the clock are scheduled and reported separately.'},
    provenance: {
      real: 'none: no record is collected from a real school, family, product or website',
      authored: 'synthetic, hand-written: the 2026-27 school year up to the clock (scripts/build-reference-fixture.cjs with withHistory false gives exactly these records)',
      generated: 'synthetic, procedural: the family\'s history from 2025-01-01 to the summer of 2026 by ' + generated.generation.tool + ' (' + generated.generation.parameters.prng + ', seed ' + generated.generation.seed + ', no wall clock, no Math.random)',
      method: 'A record is "authored" when its collection and ID are in build({withHistory: false}), otherwise "generated".'
    },
    totals: {records: all.length, dated_records: all.length - Object.keys(UNDATED).reduce((n, k) => n + sources[k].records, 0),
      undated_records: Object.keys(UNDATED).reduce((n, k) => n + sources[k].records, 0), history_records_in_window: history.length,
      scheduled_records_after_clock: future.length, out_of_window_or_invalid: exclusions.length,
      global_distinct_dates: globalDates.length, earliest: globalDates[0], latest: globalDates.at(-1),
      authored: all.filter(r => authoredIds.has(r.collection + '/' + r.id)).length, generated: all.filter(r => !authoredIds.has(r.collection + '/' + r.id)).length},
    sources,
    undated: UNDATED,
    monthly,
    months_with_history: monthsWithHistory,
    months_without_history: monthsWithout,
    exclusions,
    scheduled_after_clock: scheduled,
    scheduled_by_month: scheduledMonths,
    hashes,
    reproduce: 'cd apps/bellnote && node scripts/dataset-coverage.cjs --check (or --write to regenerate)'
  };
}

function markdown(r) {
  const L = [], row = cells => L.push('| ' + cells.join(' | ') + ' |');
  L.push('# Bellnote dataset coverage', '');
  L.push('Generated by `node scripts/dataset-coverage.cjs --write` from `' + r.dataset.seed_file + '` (sha256 `' + r.dataset.sha256.slice(0, 16) + '…`). ' +
    'Scope: ' + r.scope + ' `npm test` fails if this file or `dataset-coverage.json` no longer matches the fixture.', '');
  L.push('- Counting time zone: `' + r.time_zone + '`. Instants are converted to that zone before the date is taken; date-only fields are dates in that zone.');
  L.push('- Coverage window: ' + r.window.start + ' to ' + r.window.end + ', inclusive.');
  L.push('- Dataset clock: `' + r.clock.initial_time + '` (' + r.clock.local_date + '). ' + r.clock.rule);
  L.push('- Records: ' + r.totals.records + ' (the plugin\'s `records()` list; `contribution/dataset.json` expects ' + r.dataset.expected_records + '). ' +
    r.totals.dated_records + ' have an occurrence date; ' + r.totals.undated_records + ' are current-state records without one (below).');
  L.push('- History in the window: **' + r.totals.history_records_in_window + ' records on ' + r.totals.global_distinct_dates + ' distinct dates** (global, deduplicated across families), earliest ' + r.totals.earliest + ', latest ' + r.totals.latest + '.');
  L.push('- Scheduled after the clock: ' + r.totals.scheduled_records_after_clock + ' records dated on or after the clock date (not history). Out of window or invalid dates: ' + r.totals.out_of_window_or_invalid + '.');
  L.push('- Provenance: real records ' + 0 + '; synthetic hand-written ' + r.totals.authored + '; synthetic generated ' + r.totals.generated + '.', '');
  L.push('## Provenance', '');
  for (const k of ['real', 'authored', 'generated', 'method']) L.push('- **' + k + '**: ' + r.provenance[k]);
  L.push('', 'The workflow references named in the plan (ParentSquare, PowerSchool) informed only the shape of the workflows; no record comes from them.', '');
  L.push('## Per source', '');
  row(['Family', 'Date field', 'Records', 'Hand-written', 'Generated', 'History in window', 'Distinct dates', 'Earliest', 'Latest', 'Scheduled after clock']);
  row(Array(10).fill('---'));
  for (const [k, s] of Object.entries(r.sources)) if (s.date_field) row(['`' + k + '`', '`' + s.date_field + '`', s.records, s.authored, s.generated, s.in_window_history, s.distinct_dates, s.earliest || '–', s.latest || '–', s.scheduled_after_clock]);
  L.push('', 'Date fields: ' + Object.entries(r.sources).filter(([, s]) => s.date_field).map(([k, s]) => '`' + k + '.' + s.date_field + '` is ' + s.date_meaning).join('; ') + '.', '');
  L.push('### Records without an occurrence date (excluded from date counts)', '');
  row(['Family', 'Records', 'Reason']); row(['---', '---', '---']);
  for (const [k, why] of Object.entries(r.undated)) row(['`' + k + '`', r.sources[k].records, why]);
  L.push('', 'Other exclusions (missing, invalid or out-of-window dates): ' + (r.exclusions.length ? r.exclusions.map(e => e.collection + '/' + e.id + ' (' + e.reason + ')').join(', ') : 'none') + '.', '');
  L.push('## By month', '');
  const fams = Object.keys(DATE_FIELD);
  row(['Month', 'History records', 'Distinct dates', 'Hand-written', 'Generated', ...fams.map(f => '`' + f + '`'), 'Scheduled after clock']);
  row(Array(6 + fams.length).fill('---'));
  for (const [m, x] of Object.entries(r.monthly)) row([m, x.records, x.distinct_dates, x.authored, x.generated, ...fams.map(f => x.by_source[f] || 0), (r.scheduled_by_month[m] || 0)]);
  L.push('', 'The last column counts the scheduled items listed below (records dated after the clock and the future days stored records refer to); they are not history and are not in the other columns.', '');
  L.push('## Gaps', '');
  L.push('- Months with history: ' + r.months_with_history.length + ' of 24. Months without any history record: ' + (r.months_without_history.length ? r.months_without_history.join(', ') : 'none') + '.');
  const nov = r.monthly['2026-11'];
  L.push('- November 2026 holds history only up to the clock (' + r.clock.local_date + ' 07:00): ' + nov.records + ' records on ' + nov.distinct_dates + ' dates.');
  L.push('- After the clock the dataset holds no activity, by design: everything after ' + r.clock.local_date + ' 07:00 happens during a run, through Agent writes, `env.apply_event` and `env.advance_time`. ' +
    'December 2026 therefore has no history record; it holds only the scheduled items below. This is a remaining gap against the 2025-01-01..2026-12-31 window; it is not filled with invented activity.');
  const summer = ['2025-07', '2026-07'].filter(m => r.monthly[m].records === 0);
  if (summer.length) L.push('- ' + summer.join(' and ') + (summer.length > 1 ? ' are' : ' is') + ' the summer break: no school days, so no attendance, menus, reports or purchases, and the generated history writes no other account activity there. Those months have no record.');
  L.push('- Earlier school years keep attendance exceptions only (absent, late, left early), not a present mark for every school day; the hand-written 2026-27 year marks every day from 21 September.');
  L.push('');
  L.push('## Scheduled or future-dated (not history)', '');
  row(['Date', 'Family', 'Record', 'Field', 'What it is']); row(['---', '---', '---', '---', '---']);
  for (const x of r.scheduled_after_clock) row([x.date, '`' + x.collection + '`', '`' + x.id + '`', '`' + x.field + '`', x.state]);
  L.push('');
  L.push('## Representative content', '');
  return L;
}
function samples(r, data) {
  const authored = require('./build-reference-fixture.cjs').build({withHistory: false}), authoredIds = new Set(COLLECTIONS.flatMap(k => authored[k].map(x => k + '/' + x.id)));
  // One record per family, the first in history order, with a short plain summary.
  const pick = {
    attendance: x => x.date + ' ' + x.child_id + ' ' + x.status + (x.explanation ? ' (' + x.explanation + (x.office_review ? ', ' + x.office_review : '') + ')' : '') + ', marked by ' + x.marked_by,
    absence_reports: x => x.child_id + ' ' + x.kind + ' ' + x.dates.join(',') + ' "' + x.reason + '" ' + x.state + ' by ' + x.submitted_by,
    forms: x => '"' + x.title + '" ' + x.kind + ', fee ' + x.fee_cents + ' cents, due ' + x.due_at,
    form_responses: x => x.form_id + ' ' + x.child_id + ' ' + x.state + ' by ' + x.by_person_id + ' on version ' + x.form_version,
    lunch_transactions: x => x.child_id + ' ' + x.kind + ' ' + x.amount_cents + ' cents' + (x.item ? ' "' + x.item + '"' : '') + (x.note ? ' (' + x.note + ')' : ''),
    menu_days: x => x.school_id + ' ' + x.date + ': ' + x.items.map(i => i.name + (i.allergens.length ? ' [' + i.allergens.join(', ') + ']' : '')).join('; '),
    payments: x => x.kind + ' ' + x.amount_cents + ' cents ' + x.status + ' with ' + x.payment_method_id,
    notifications: x => '"' + x.title + '"',
    dismissal_changes: x => x.child_id + ' on ' + x.date + ': ' + x.mode + (x.person_id ? ' by ' + x.person_id : '') + ', ' + x.status + ', recorded by ' + x.recorded_by,
    pickup_people: x => x.display_name + ' (' + x.relationship + ') for ' + x.child_id + ', ' + x.status,
    restrictions: x => x.person_id + ' restricted for ' + x.child_id
  };
  const out = [];
  for (const [k, f] of Object.entries(pick)) {
    const field = DATE_FIELD[k].field;
    const recs = data[k].filter(x => typeof x[field] === 'string').sort((a, b) => String(a[field]).localeCompare(String(b[field])) || a.id.localeCompare(b.id));
    const gen = recs.find(x => !authoredIds.has(k + '/' + x.id)), hand = [...recs].reverse().find(x => authoredIds.has(k + '/' + x.id));
    for (const x of [gen, hand].filter(Boolean)) out.push('| `' + k + '` | `' + x.id + '` | ' + f(x).replace(/\|/g, '/') + ' |');
  }
  return out;
}
function render(r) {
  const data = JSON.parse(read(r.dataset.seed_file));
  const L = markdown(r);
  L.push('The earliest generated record and the latest hand-written record of each family (all synthetic):', '', '| Family | Record | Content |', '| --- | --- | --- |', ...samples(r, data), '');
  L.push('## Fixture and generator hashes (sha256)', '');
  for (const [k, v] of Object.entries(r.hashes)) L.push('- `' + k + '` `' + v + '`');
  L.push('', 'Reproduce: `' + r.reproduce + '`. The loading and query demonstration is [dataset-retrieval.md](dataset-retrieval.md).', '');
  return L.join('\n');
}
const outputs = r => ({'evidence/dataset-coverage.json': JSON.stringify(r, null, 2) + '\n', 'evidence/dataset-coverage.md': render(r)});
function check() {
  const problems = [];
  for (const [rel, text] of Object.entries(outputs(compute()))) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) problems.push(rel + ' is missing');
    else if (fs.readFileSync(file, 'utf8') !== text) problems.push(rel + ' does not match the fixture (run node scripts/dataset-coverage.cjs --write)');
  }
  return problems;
}

// ---- Loading and query demonstration on real Core (needs the pinned public runtime).
async function retrieval() {
  const locate = require('./locate.cjs'), runtime = locate.runtimeDir();
  const {prepare} = require(path.join(runtime, 'prepare.cjs')), {Client} = require(path.join(runtime, 'client.cjs'));
  const r = compute(), data = JSON.parse(read(r.dataset.seed_file)), clock = r.clock.initial_time;
  const prepared = prepare(root), state = path.join(prepared.root, 'state'), clients = [];
  const open = async role => { const c = new Client('bellnote', role, 'bellnote-coverage', state, 'bellnote-coverage', {registry: prepared.registry}); clients.push(c); await c.initialize(); return c; };
  const calls = [];
  try {
    const infra = await open('infra'), agent = await open('agent');
    let snap = await infra.call('env.snapshot');
    const loaded = await infra.call('env.load_seed', {expected_version: snap.version, request_id: 'coverage-load', data, virtual_now: clock});
    if (loaded.status !== 'ready') throw new Error('env.load_seed: ' + JSON.stringify(loaded));
    snap = await infra.call('env.snapshot');
    const loadedSame = JSON.stringify(snap.snapshot.data) === JSON.stringify(data) && snap.snapshot.virtual_now === clock;
    const call = async (name, args, pickIds) => {
      const res = await agent.call(name, args);
      if (res.status !== 'ok') throw new Error(name + ' ' + JSON.stringify(args) + ': ' + JSON.stringify(res).slice(0, 300));
      const ids = pickIds(res); calls.push({tool: name, arguments: args, returned: ids.length}); return ids;
    };
    // 120-day windows (the tools' maximum) across the coverage window.
    const windows = []; for (let t = Date.parse(r.window.start + 'T00:00:00Z'); t <= Date.parse(r.window.end + 'T00:00:00Z'); t += 120 * 86400000) {
      const s = new Date(t).toISOString().slice(0, 10), e = new Date(Math.min(t + 119 * 86400000, Date.parse(r.window.end + 'T00:00:00Z'))).toISOString().slice(0, 10); windows.push([s, e]);
    }
    const got = Object.fromEntries(COLLECTIONS.map(k => [k, new Set()]));
    const add = (k, ids) => ids.forEach(id => got[k].add(id));
    const children = await call('bellnote.children.list', {}, x => x.children.map(c => c.id)); add('children', children);
    const kids = (await agent.call('bellnote.children.list', {})).children;
    // Each guardian's rights for a child are returned by child and person; the stored link is the one with that pair.
    add('guardian_links', kids.flatMap(c => c.guardians.map(g => data.guardian_links.find(l => l.child_id === c.id && l.person_id === g.person_id)?.id)).filter(Boolean));
    for (const s of data.schools) add('schools', await call('bellnote.schools.get', {id: s.id}, x => [x.school.id]));
    add('payment_methods', await call('bellnote.preferences.get', {}, x => x.payment_methods.map(p => p.id)));
    add('absence_reports', await call('bellnote.absences.list', {}, x => x.reports.map(p => p.id)));
    const forms = await call('bellnote.forms.list', {}, x => x.forms.map(p => p.id)); add('forms', forms);
    for (const id of forms) add('form_responses', await call('bellnote.forms.get', {id}, x => x.form.responses.map(p => p.id)));
    for (const [start, end] of windows) {
      add('attendance', await call('bellnote.attendance.list', {start, end}, x => x.records.map(p => p.id)));
      // A menu day is returned by school and date; the stored record is the one with that school and date.
      add('menu_days', await call('bellnote.menu.list', {start, end}, x => x.days.filter(d => d.menu_published)
        .map(d => data.menu_days.find(m => m.school_id === d.school_id && m.date === d.date)?.id || 'unmatched ' + d.school_id + ' ' + d.date)));
      add('payments', await call('bellnote.payments.list', {start, end}, x => x.payments.map(p => p.id)));
      add('notifications', await call('bellnote.notifications.list', {start, end}, x => x.notifications.map(p => p.id)));
      for (const k of kids) {
        if (k.lunch_account_id) add('lunch_transactions', await call('bellnote.lunch.account_get', {id: k.lunch_account_id, start, end}, x => x.transactions.map(p => p.id)));
        if ('default_dismissal' in k) add('dismissal_changes', await call('bellnote.pickup.get', {id: k.id, start, end}, x => x.dismissal_changes.map(p => p.id)));
      }
    }
    for (const k of kids) {
      if (k.lunch_account_id) add('lunch_accounts', await call('bellnote.lunch.account_get', {id: k.lunch_account_id}, x => [x.account.id]));
      if ('default_dismissal' in k) {
        const res = await agent.call('bellnote.pickup.get', {id: k.id});
        add('pickup_people', res.pickup_people.map(p => p.id)); add('restrictions', (res.restrictions || []).map(p => p.id).filter(Boolean));
        calls.push({tool: 'bellnote.pickup.get', arguments: {id: k.id}, returned: res.pickup_people.length});
      } else {
        const res = await agent.call('bellnote.pickup.get', {id: k.id});
        calls.push({tool: 'bellnote.pickup.get', arguments: {id: k.id}, returned: 0, status: res.status, code: res.code});
      }
    }
    const after = await infra.call('env.snapshot');
    const families = COLLECTIONS.map(k => {
      const stored = data[k].map(x => x.id), missing = stored.filter(id => !got[k].has(id));
      return {family: k, stored: stored.length, retrieved: stored.length - missing.length, not_retrieved: missing};
    });
    return {schema: 'bellnote.dataset-retrieval.v1', dataset_sha256: r.dataset.sha256, clock, loaded_with: 'env.load_seed (Infra) with virtual_now ' + clock,
      loaded_data_equals_fixture: loadedSame, reads_left_data_unchanged: JSON.stringify(after.snapshot.data) === JSON.stringify(snap.snapshot.data),
      windows, calls: calls.length, families, sample_calls: calls.filter((c, i, a) => a.findIndex(x => x.tool === c.tool) === i)};
  } finally { await Promise.allSettled(clients.map(c => c.close())); fs.rmSync(prepared.root, {recursive: true, force: true}); }
}
const WHY_NOT = {
  staff: 'no Agent tool lists the staff directory; staff appear by name in attendance marks, reviews and notices',
  pickup_people: 'the account holder is not custodial for Nico, so pickup.get refuses his list (not_permitted): by the plan\'s rule a non-custodial guardian learns nothing of that pickup list'
};
function retrievalMarkdown(x) {
  const L = ['# Bellnote dataset loading and query demonstration', '',
    'Produced by `node scripts/dataset-coverage.cjs --retrieval` on the pinned public runtime: Infra loads `fixtures/reference.json` with `env.load_seed` at `' + x.clock + '`, then an Agent MCP connection reads every family back through the Bellnote tools, in 120-day windows (the tools\' maximum) across 2025-01-01..2026-12-31.', '',
    '- Loaded data equals the fixture: ' + x.loaded_data_equals_fixture + '. Reads left the data unchanged: ' + x.reads_left_data_unchanged + '. Agent calls: ' + x.calls + '.', '',
    '| Family | Stored | Retrieved through the Agent tools | Not retrieved, and why |', '| --- | --- | --- | --- |'];
  for (const f of x.families) L.push('| `' + f.family + '` | ' + f.stored + ' | ' + f.retrieved + ' | ' + (f.not_retrieved.length ? f.not_retrieved.length + ': ' + (WHY_NOT[f.family] || 'see JSON') : '–') + ' |');
  L.push('', '## One sample call per tool', '', '| Tool | Arguments | Records returned |', '| --- | --- | --- |');
  for (const c of x.sample_calls) L.push('| `' + c.tool + '` | `' + JSON.stringify(c.arguments) + '` | ' + c.returned + (c.code ? ' (' + c.code + ')' : '') + ' |');
  L.push('', 'Full list of not-retrieved IDs: [dataset-retrieval.json](dataset-retrieval.json).', '');
  return L.join('\n');
}

module.exports = {compute, render, check, outputs};
if (require.main === module) {
  const arg = process.argv.slice(2);
  if (arg.includes('--retrieval')) {
    retrieval().then(x => {
      fs.mkdirSync(path.join(root, 'evidence'), {recursive: true});
      fs.writeFileSync(path.join(root, 'evidence/dataset-retrieval.json'), JSON.stringify(x, null, 2) + '\n');
      fs.writeFileSync(path.join(root, 'evidence/dataset-retrieval.md'), retrievalMarkdown(x));
      for (const f of x.families) console.log(f.family + ': ' + f.retrieved + '/' + f.stored);
      const unexplained = x.families.filter(f => f.not_retrieved.length && !WHY_NOT[f.family]);
      if (!x.loaded_data_equals_fixture || !x.reads_left_data_unchanged || unexplained.length) { console.error('Unexpected retrieval result', unexplained); process.exitCode = 1; }
    }).catch(e => { console.error(e); process.exitCode = 1; });
  } else if (arg.includes('--check')) {
    const p = check(); if (p.length) { console.error(p.join('\n')); process.exitCode = 1; } else console.log('evidence/dataset-coverage.{json,md} match the fixture.');
  } else if (arg.includes('--write')) {
    fs.mkdirSync(path.join(root, 'evidence'), {recursive: true});
    for (const [rel, text] of Object.entries(outputs(compute()))) fs.writeFileSync(path.join(root, rel), text);
    console.log('Wrote evidence/dataset-coverage.json and evidence/dataset-coverage.md.');
  } else process.stdout.write(render(compute()));
}
