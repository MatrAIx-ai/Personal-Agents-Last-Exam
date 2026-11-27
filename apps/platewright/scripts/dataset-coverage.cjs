#!/usr/bin/env node
'use strict';
// Dataset coverage report for the delivered evaluation data (docs/submission-evidence.md §3).
// It reads the seed exactly as the App loads it (app.json `fixtures.seed`, loaded at the time in
// fixtures/clock.json, accepted by the App's own validateSeed), counts every dated row by the
// authoritative date field of its record family in the household's IANA time zone, and writes
// evidence/dataset-coverage.json and evidence/dataset-coverage.md. Node built-ins only; no clock,
// no randomness, so the output is byte-identical on every run and Node version.
//   node scripts/dataset-coverage.cjs           write both files
//   node scripts/dataset-coverage.cjs --check   compare the committed files with a fresh computation
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const plugin = require('../plugin.cjs');
const {localDate} = require('../src/common.cjs');
const History = require('./history.cjs');
const {PANTRY, WEEKS_START} = require('./build-fixtures.cjs');

const root = path.resolve(__dirname, '..');
const WINDOW = {start: '2025-01-01', end: '2026-12-31'};
const read = f => fs.readFileSync(path.join(root, f));
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const months = (() => { const out = []; for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++) out.push(`${y}-${String(m).padStart(2, '0')}`); return out; })();

const GENERATED = 'synthetic, generated';
const AUTHORED = 'synthetic, hand-written';
const AUTHORED_DATED = 'synthetic, hand-written content dated by the generator';

// Record families: each dated row with its authoritative date and its provenance.
function families(data, zone) {
  const day = at => localDate(at, zone);
  const generatedEvent = id => typeof id === 'string' && id.startsWith('ev-pw-h');
  const slotDate = new Map(data.plan.map(s => [s.id, s.date]));
  const bySlot = id => slotDate.get(id) <= History.LAST ? GENERATED : AUTHORED;
  const created = new Set(Array.from({length: 60}, (_, i) => History.recipeCreated(i)));
  const generatedConstraint = new Set(History.CONSTRAINTS.map(c => c.constraint.id));
  const handPantry = new Set(PANTRY.map(([id, , , , at]) => id + '@' + at));
  const rows = [];
  const push = (family, record_id, date, provenance) => rows.push({family, record_id, date, provenance});
  for (const s of data.plan) push('plan_slots', s.id, s.date, s.date <= History.LAST ? GENERATED : AUTHORED);
  for (const s of data.plan) for (const h of s.history) push('plan_slot_history', s.id, day(h.at), bySlot(s.id));
  for (const r of data.recipes) for (const h of r.history) {
    const prov = generatedEvent(h.event_id) ? GENERATED
      : h.action === 'created' && !r.variant && !h.event_id && created.has(h.at) ? AUTHORED_DATED : AUTHORED;
    push('recipe_history', r.id, day(h.at), prov);
  }
  for (const m of data.members) for (const c of m.constraints) for (const h of c.history)
    push('constraint_history', c.id, day(h.at), generatedConstraint.has(c.id) || generatedEvent(h.event_id) ? GENERATED : AUTHORED);
  for (const p of data.pantry) for (const h of p.history) {
    let prov;
    if (h.event_id) prov = generatedEvent(h.event_id) ? GENERATED : AUTHORED;
    else if (h.slot_id) prov = bySlot(h.slot_id);
    else prov = Date.parse(h.at) < Date.parse(WEEKS_START) && !handPantry.has(p.ingredient_id + '@' + h.at) ? GENERATED : AUTHORED;
    push('pantry_history', 'pantry:' + p.ingredient_id, day(h.at), prov);
  }
  if (data.shopping) for (const l of data.shopping.lines) for (const h of l.history) push('shopping_line_history', l.id, day(h.at), AUTHORED);
  for (const n of data.notifications) push('notifications', n.id, day(n.at), generatedEvent(n.event_id) ? GENERATED : AUTHORED);
  for (const a of data.activity) push('activity', 'activity#' + a.seq, day(a.at), generatedEvent(a.event_id) ? GENERATED : AUTHORED);
  return rows;
}

const FAMILY_INFO = {
  plan_slots: {label: 'plan slots (`plan`)', date_field: '`date` (the meal\'s date, date-only)', tool: 'platewright.plan.get (windows of up to 42 days)'},
  plan_slot_history: {label: 'rows of each slot\'s `history`', date_field: '`history[].at` (when the meal was planned, changed, cleared, cooked or skipped)', tool: 'platewright.plan.get (each slot carries its history)'},
  recipe_history: {label: 'rows of each recipe\'s `history`', date_field: '`history[].at` (created, revised, archived, restored)', tool: 'platewright.recipes.get (history and revisions); platewright.recipes.search lists the recipes'},
  constraint_history: {label: 'rows of each member constraint\'s `history`', date_field: '`history[].at` (when the need was recorded, changed or ended)', tool: 'platewright.household.get (members with constraints and their history)'},
  pantry_history: {label: 'rows of each pantry item\'s `history`', date_field: '`history[].at` (stocking, shops, cooking deductions)', tool: 'platewright.pantry.list (include_out: true)'},
  shopping_line_history: {label: 'rows of each current shopping line\'s `history`', date_field: '`history[].at`', tool: 'platewright.shopping.get'},
  notifications: {label: 'notifications', date_field: '`at` (the event\'s time)', tool: 'platewright.notifications.list'},
  activity: {label: 'activity rows', date_field: '`at`', tool: 'none for the Agent: evaluator record, read through Infra `env.snapshot`'}
};

function compute() {
  const app = JSON.parse(read('app.json'));
  const seedFile = app.fixtures.seed, clockFile = 'fixtures/clock.json';
  const data = JSON.parse(read(seedFile)), clock = JSON.parse(read(clockFile)).initial_time;
  const binding = JSON.parse(read(app.fixtures.binding));
  // Loaded as the App loads it: the App's own seed validation at the loaded time must accept it.
  plugin.validateSeed({app_id: app.app_id, run_id: 'coverage', role: 'infra', binding, virtual_now: clock}, data);
  const zone = data.household.time_zone, today = localDate(clock, zone);
  const rows = families(data, zone);
  const invalid = rows.filter(r => !/^\d{4}-\d{2}-\d{2}$/.test(r.date));
  if (invalid.length) throw new Error('Rows without a valid date: ' + JSON.stringify(invalid.slice(0, 3)));
  const inWindow = r => r.date >= WINDOW.start && r.date <= WINDOW.end;
  // History: occurred before the loaded time. A plan slot is dated by its meal; a slot dated on or
  // after the loaded date is a scheduled meal, not history (every timestamped row is at or before
  // the loaded time; validateSeed refuses later ones).
  const scheduled = r => r.family === 'plan_slots' && r.date >= today;
  const history = rows.filter(r => inWindow(r) && !scheduled(r));
  const future = rows.filter(r => inWindow(r) && scheduled(r));
  const excluded = rows.filter(r => !inWindow(r));
  const distinct = list => [...new Set(list.map(r => r.date))].sort();
  const per = (list, key) => { const o = {}; for (const r of list) o[key(r)] = (o[key(r)] || 0) + 1; return o; };
  const familyNames = Object.keys(FAMILY_INFO);
  const sources = familyNames.map(f => {
    const all = rows.filter(r => r.family === f), h = history.filter(r => r.family === f), d = distinct(h);
    const byMonth = {};
    for (const m of months) { const x = h.filter(r => r.date.startsWith(m)); byMonth[m] = {rows: x.length, distinct_dates: distinct(x).length}; }
    return {family: f, ...FAMILY_INFO[f], records: new Set(all.map(r => r.record_id)).size, dated_rows: all.length, history_rows: h.length,
      scheduled_rows: future.filter(r => r.family === f).length, distinct_dates: d.length, earliest: d[0] || null, latest: d.at(-1) || null,
      provenance: per(h, r => r.provenance), months: byMonth};
  });
  const globalDates = distinct(history);
  const monthly = months.map(m => {
    const h = history.filter(r => r.date.startsWith(m)), f = future.filter(r => r.date.startsWith(m));
    return {month: m, history_rows: h.length, distinct_dates: distinct(h).length, scheduled_rows: f.length, scheduled_dates: distinct(f).length,
      provenance: per(h, r => r.provenance)};
  });
  const undated = [
    {records: 'ingredients', count: data.ingredients.length, reason: 'reference table (allergens, units, nutrition); no occurrence date'},
    {records: 'substitution_rules', count: data.substitution_rules.length, reason: 'reference table; no occurrence date'},
    {records: 'members', count: data.members.length, reason: 'people of the household; their constraints are counted by their history rows'}
  ];
  const fixtureFiles = fs.readdirSync(path.join(root, 'fixtures')).sort();
  const lastHistory = globalDates.at(-1);
  const futureDates = distinct(future);
  return {
    schema: 'platewright.dataset-coverage.v1',
    scope: 'Environment dataset coverage of the delivered reference seed (not a Task history selection)',
    seed: seedFile, loaded_time: clock, time_zone: zone, loaded_date: today, window: WINDOW,
    method: 'Timestamps are converted to calendar dates in the household time zone with Intl (src/common.cjs localDate); date-only fields are taken as dates in that zone. A row counts as history when its date is in the window and it is not a plan slot dated on or after the loaded date; such slots are scheduled meals and are reported separately. Each distinct calendar date counts once per family and once globally.',
    files: Object.fromEntries([...fixtureFiles.map(f => 'fixtures/' + f), 'scripts/history.cjs', 'scripts/build-fixtures.cjs', 'scripts/fixture-data.cjs']
      .map(f => [f, {bytes: read(f).length, sha256: sha256(read(f))}])),
    totals: {records_core_counts: plugin.records(data).length, dated_rows: rows.length, history_rows: history.length, scheduled_rows: future.length,
      excluded_rows: excluded.length, global_distinct_history_dates: globalDates.length, earliest_date: globalDates[0], latest_history_date: lastHistory,
      scheduled_dates: futureDates.length, scheduled_from: futureDates[0] || null, scheduled_to: futureDates.at(-1) || null,
      months_with_history: monthly.filter(m => m.history_rows).length, months_without_history: monthly.filter(m => !m.history_rows).map(m => m.month)},
    provenance: {
      history_rows: per(history, r => r.provenance),
      real_records: 0,
      generator: {script: 'scripts/history.cjs', seed: History.SEED, prng: 'mulberry32', from: History.START, to: History.LAST},
      rules: [
        'plan slots and their history rows: generated when the meal is dated on or before ' + History.LAST + ', hand-written from 2026-10-12',
        'notifications, activity rows and rows written by events: generated when the event ID starts with ev-pw-h, otherwise hand-written',
        'constraint history: generated for the five constraints of scripts/history.cjs (CONSTRAINTS), otherwise hand-written',
        'recipe history: the creation rows of 58 of the 60 written recipes are dated by the generator\'s schedule (24 on 2025-01-01, then one every ten days through 2025); the other two were added by members\' events in the hand-written weeks; revisions, archiving and variants are hand-written',
        'pantry rows: rows of a cooked meal follow the meal; other rows by the account before ' + WEEKS_START + ' are generated unless they are the item\'s hand-written row (scripts/build-fixtures.cjs PANTRY)',
        'shopping line rows: hand-written (the current list of 7 November 2026)'
      ]
    },
    sources, monthly, undated,
    excluded: excluded.length ? per(excluded, r => r.family) : {},
    gaps: {
      after_loaded_time: `History ends on ${lastHistory} (the loaded time is ${clock}). ${futureDates.length ? `Scheduled meals are dated ${futureDates[0]} to ${futureDates.at(-1)} (${future.length} plan slots); they are planned, not history.` : ''} No record of any kind is dated ${nextDay(futureDates.at(-1) || lastHistory)} to ${WINDOW.end}.`,
      empty_months: monthly.filter(m => !m.history_rows && !m.scheduled_rows).map(m => m.month),
      months_with_only_scheduled_records: monthly.filter(m => !m.history_rows && m.scheduled_rows).map(m => m.month),
      partial_months: monthly.filter(m => m.history_rows && m.month === today.slice(0, 7)).map(m => m.month)
    }
  };
}
function nextDay(date) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }

function markdown(r) {
  const n = x => x.toLocaleString('en-US');
  const L = [];
  L.push('# Platewright dataset coverage', '');
  L.push(`Generated by \`node scripts/dataset-coverage.cjs\` from \`${r.seed}\` as the App loads it (accepted by the App's \`validateSeed\` at the loaded time). \`npm test\` fails if this file or \`dataset-coverage.json\` no longer matches the fixture. Scope: ${r.scope}.`, '');
  L.push(`- Time zone: \`${r.time_zone}\` (the household's). Loaded time: \`${r.loaded_time}\` (loaded date ${r.loaded_date}).`);
  L.push(`- Window: ${r.window.start} to ${r.window.end}, inclusive.`);
  L.push(`- Method: ${r.method}`);
  L.push(`- Records (Core's count, \`plugin.records\`): ${n(r.totals.records_core_counts)}. Dated rows: ${n(r.totals.dated_rows)}; history rows in the window: ${n(r.totals.history_rows)}; scheduled rows: ${n(r.totals.scheduled_rows)}; excluded (outside the window): ${n(r.totals.excluded_rows)}.`);
  L.push(`- **Global deduplicated distinct dates with history: ${n(r.totals.global_distinct_history_dates)}**, from ${r.totals.earliest_date} to ${r.totals.latest_history_date}. Months with history: ${r.totals.months_with_history} of 24.`);
  L.push(`- Provenance: every record is synthetic; none is real or collected. ${Object.entries(r.provenance.history_rows).map(([k, v]) => `${k}: ${n(v)} rows`).join('; ')}. Generator: \`${r.provenance.generator.script}\`, seed ${r.provenance.generator.seed} (${r.provenance.generator.prng}), ${r.provenance.generator.from} to ${r.provenance.generator.to}.`, '');
  L.push('## Gaps', '');
  L.push(`- ${r.gaps.after_loaded_time}`);
  L.push(`- Months with no record at all: ${r.gaps.empty_months.join(', ') || 'none'}.`);
  L.push(`- Months with only scheduled records: ${r.gaps.months_with_only_scheduled_records.join(', ') || 'none'}.`);
  L.push(`- Partial month: ${r.gaps.partial_months.join(', ') || 'none'} (history up to the loaded date; the rest of the month holds scheduled meals or nothing).`);
  L.push(`- The fixture describes the household up to its loaded time and the meals planned for the following week. Nothing after the loaded time is presented as history, and no activity is invented for the rest of November and December 2026: that part of the window is a gap. A Task that needs it adds records through its own events or seed.`, '');
  L.push('## Sources (record families)', '');
  L.push('| Family | Records | Authoritative date | Dated rows | History rows | Scheduled rows | Distinct dates | Earliest | Latest | Provenance (history rows) | Read through |');
  L.push('| --- | ---: | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |');
  for (const s of r.sources) L.push(`| ${s.label} | ${s.family === 'activity' ? '—' : n(s.records)} | ${s.date_field} | ${n(s.dated_rows)} | ${n(s.history_rows)} | ${n(s.scheduled_rows)} | ${n(s.distinct_dates)} | ${s.earliest} | ${s.latest} | ${Object.entries(s.provenance).map(([k, v]) => `${k} ${n(v)}`).join('; ')} | ${s.tool} |`);
  L.push('', 'Not dated, so not counted: ' + r.undated.map(u => `${u.records} (${u.count}: ${u.reason})`).join('; ') + '. Excluded rows outside the window: ' + (Object.keys(r.excluded).length ? JSON.stringify(r.excluded) : 'none') + '.', '');
  L.push('## By month', '');
  L.push('| Month | History rows | Distinct dates | Scheduled rows | Scheduled dates | ' + r.sources.map(s => s.family).join(' | ') + ' |');
  L.push('| --- | ---: | ---: | ---: | ---: | ' + r.sources.map(() => '---:').join(' | ') + ' |');
  for (const m of r.monthly) L.push(`| ${m.month} | ${n(m.history_rows)} | ${m.distinct_dates} | ${m.scheduled_rows} | ${m.scheduled_dates} | ` + r.sources.map(s => `${s.months[m.month].rows}/${s.months[m.month].distinct_dates}`).join(' | ') + ' |');
  L.push('', 'Per family: history rows / distinct dates in the month.', '');
  L.push('## Provenance rules', '');
  for (const x of r.provenance.rules) L.push('- ' + x);
  L.push('', 'Recipes, steps, the ingredient table, substitution rules and the people are written for this package; nothing was taken from a real household, a recipe site or a product. See `contribution/dataset.json`.', '');
  L.push('## Files', '');
  L.push('| File | Bytes | SHA-256 |', '| --- | ---: | --- |');
  for (const [f, x] of Object.entries(r.files)) L.push(`| \`${f}\` | ${n(x.bytes)} | \`${x.sha256}\` |`);
  L.push('');
  return L.join('\n');
}

function outputs() {
  const report = compute();
  return {'evidence/dataset-coverage.json': JSON.stringify(report, null, 2) + '\n', 'evidence/dataset-coverage.md': markdown(report)};
}
module.exports = {compute, outputs};
if (require.main === module) {
  const files = outputs(), check = process.argv.includes('--check'), drift = [];
  for (const [f, text] of Object.entries(files)) {
    const target = path.join(root, f);
    if (check) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) drift.push(f); }
    else { fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, text); }
  }
  if (drift.length) { console.error('Coverage report drift: ' + drift.join(', ') + ' (run node scripts/dataset-coverage.cjs)'); process.exitCode = 1; }
  else console.log(check ? 'Coverage report matches the fixture.' : 'Coverage report written.');
}
