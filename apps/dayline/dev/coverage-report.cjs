#!/usr/bin/env node
'use strict';
// Coverage report for the Dayline evaluation dataset (docs/submission-evidence.md, section 3).
// Counts the records in data/evaluation/seed.json, as delivered, by date in one IANA time zone.
// Usage, from the package directory:
//   node dev/coverage-report.cjs            Markdown report
//   node dev/coverage-report.cjs --json     the same numbers as JSON
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const pkg = path.resolve(__dirname, '..');
const dir = path.join(pkg, 'data/evaluation');
const TIME_ZONE = 'America/Los_Angeles';
const WINDOW = ['2025-01-01', '2026-12-31'];

const seedText = fs.readFileSync(path.join(dir, 'seed.json'), 'utf8');
const seed = JSON.parse(seedText);
const dataset = JSON.parse(fs.readFileSync(path.join(dir, 'dataset.json'), 'utf8'));
const clock = JSON.parse(fs.readFileSync(path.join(dir, 'clock.json'), 'utf8')).initial_time;
const fixture = JSON.parse(fs.readFileSync(path.join(pkg, 'fixtures/minimal.json'), 'utf8'));
const sha256 = crypto.createHash('sha256').update(seedText).digest('hex');

const localDate = new Intl.DateTimeFormat('en-CA', {timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'});
const dateOf = iso => {const t = Date.parse(iso); return Number.isNaN(t) ? null : localDate.format(t);};
const authored = new Set(fixture.editions.map(e => e.edition_id));
const outletName = new Map(seed.outlets.map(o => [o.outlet_id, o.name]));

// Each source names its authoritative date field. Story groups carry only a created_at that Dayline
// derives from their first edition, and outlets and front pages carry no dates, so they are not counted.
const records = [];
for (const e of seed.editions) {
  records.push({source: 'edition:' + e.outlet_id, id: e.edition_id, field: 'published_at', value: e.published_at,
    provenance: authored.has(e.edition_id) ? 'synthetic (authored fixture)' : 'synthetic (generated)'});
}
for (const h of seed.reading_history) records.push({source: 'reading_history', id: h.edition_id, field: 'read_at', value: h.read_at,
  provenance: fixture.reading_history.some(x => x.edition_id === h.edition_id && x.read_at === h.read_at) ? 'synthetic (authored fixture)' : 'synthetic (generated)'});
for (const s of seed.reading_list) records.push({source: 'reading_list', id: s.edition_id, field: 'saved_at', value: s.saved_at,
  provenance: fixture.reading_list.some(x => x.edition_id === s.edition_id) ? 'synthetic (authored fixture)' : 'synthetic (generated)'});

const invalid = [], excluded = [], counted = [];
for (const r of records) {
  const date = dateOf(r.value);
  if (!date) invalid.push(r);
  else if (date < WINDOW[0] || date > WINDOW[1]) excluded.push({...r, date, reason: 'outside the coverage window'});
  else counted.push({...r, date});
}

const months = [];
for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++) months.push(`${y}-${String(m).padStart(2, '0')}`);
const sources = [...new Set(counted.map(r => r.source))].sort();
const bySource = sources.map(source => {
  const list = counted.filter(r => r.source === source), dates = [...new Set(list.map(r => r.date))].sort();
  return {source, label: source.startsWith('edition:') ? outletName.get(source.slice(8)) + ' editions' : source,
    field: list[0].field, records: list.length, distinct_dates: dates.length, earliest: dates[0], latest: dates.at(-1)};
});
const allDates = [...new Set(counted.map(r => r.date))].sort();
const clockDate = dateOf(clock), clockMs = Date.parse(clock);
const monthly = months.map(month => {
  const list = counted.filter(r => r.date.startsWith(month));
  const editions = list.filter(r => r.source.startsWith('edition:'));
  return {month, editions: editions.length, reading_history: list.filter(r => r.source === 'reading_history').length,
    reading_list: list.filter(r => r.source === 'reading_list').length,
    distinct_dates: new Set(list.map(r => r.date)).size,
    after_clock: list.filter(r => Date.parse(r.value) > clockMs).length};
});
// Longest stretch of window days with no counted record.
let gap = {days: 0, from: null, to: null}, prev = null;
for (const d of [...allDates, '2027-01-01']) {
  const start = prev ? addDay(prev) : WINDOW[0];
  const span = Math.round((Date.parse(d) - Date.parse(start)) / 86400000);
  if (span > gap.days) gap = {days: span, from: start, to: addDay(d, -1)};
  prev = d;
}
function addDay(d, n = 1) {return new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);}

// Content checks: identical text must be a credited reprint; near-duplicates are measured by word 5-gram overlap.
const textOwners = new Map();
for (const e of seed.editions) textOwners.set(e.text, [...(textOwners.get(e.text) || []), e]);
let uncreditedCopies = 0, creditedReprints = 0;
for (const group of textOwners.values()) {
  if (group.length < 2) continue;
  const [first, ...rest] = [...group].sort((a, b) => Date.parse(a.added_at) - Date.parse(b.added_at));
  for (const e of rest) e.credits.some(c => group.some(g => g.edition_id === c.edition_id)) ? creditedReprints++ : uncreditedCopies++;
}
const shingles = e => {const w = e.text.toLowerCase().split(/[^\p{L}\p{N}%$.]+/u).filter(Boolean), s = new Set();
  for (let i = 0; i + 5 <= w.length; i++) s.add(w.slice(i, i + 5).join(' ')); return s;};
const unique = [...textOwners.keys()].map(text => ({text, set: shingles({text})}));
let maxSimilarity = 0, nearDuplicates = 0;
for (let i = 0; i < unique.length; i++) for (let j = i + 1; j < unique.length; j++) {
  const a = unique[i].set, b = unique[j].set; if (!a.size || !b.size) continue;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  const sim = inter / (a.size + b.size - inter);
  if (sim > maxSimilarity) maxSimilarity = sim;
  if (sim >= 0.8) nearDuplicates++;
}

const report = {
  scope: 'Dayline evaluation dataset as delivered in apps/dayline/data/evaluation/seed.json',
  dataset_id: dataset.dataset_id, dataset_version: dataset.version, seed_sha256: sha256,
  seed_sha256_matches_dataset_json: dataset.sha256?.['seed.json'] === sha256,
  time_zone: TIME_ZONE, window: WINDOW, dataset_clock: clock,
  method: 'Each record is counted on the calendar date of its authoritative field in America/Los_Angeles. Multiple records on one date count once in the global figure.',
  totals: {records: records.length, counted: counted.length, excluded: excluded.length, invalid: invalid.length,
    global_distinct_dates: allDates.length, earliest: allDates[0], latest: allDates.at(-1),
    distinct_dates_on_or_before_clock: allDates.filter(d => d <= clockDate).length,
    months_with_records: monthly.filter(m => m.distinct_dates > 0).length, longest_gap: gap},
  provenance: Object.entries(counted.reduce((acc, r) => ({...acc, [r.provenance]: (acc[r.provenance] || 0) + 1}), {})).map(([kind, n]) => ({kind, records: n})),
  real_records: 0,
  by_source: bySource, monthly,
  content: {editions: seed.editions.length, stories: seed.stories.length, credited_reprints: creditedReprints,
    uncredited_identical_text: uncreditedCopies, near_duplicate_pairs_at_0_8: nearDuplicates, max_5gram_jaccard: Math.round(maxSimilarity * 1000) / 1000},
  not_counted: ['stories (created_at is derived from their first edition)', 'outlets and front pages (no date fields)'],
  excluded, invalid,
};

if (process.argv.includes('--json')) {process.stdout.write(JSON.stringify(report, null, 2) + '\n'); process.exit(0);}
const row = cells => '| ' + cells.join(' | ') + ' |';
const out = [];
out.push(`# Dayline evaluation dataset coverage`, '',
  `- Scope: ${report.scope}, version ${report.dataset_version}, sha256 \`${sha256}\` (${report.seed_sha256_matches_dataset_json ? 'matches' : 'DOES NOT MATCH'} \`dataset.json\`).`,
  `- Window ${WINDOW[0]} to ${WINDOW[1]}; dates counted in ${TIME_ZONE}; dataset clock ${clock}.`,
  `- ${report.totals.records} records; ${report.totals.counted} counted, ${report.totals.excluded} outside the window, ${report.totals.invalid} without a valid date.`,
  `- **${report.totals.global_distinct_dates} distinct dates** (${report.totals.earliest} to ${report.totals.latest}), records in ${report.totals.months_with_records} of 24 months; ${report.totals.distinct_dates_on_or_before_clock} dates fall on or before the dataset clock. Longest stretch with no record: ${gap.days} days (${gap.from} to ${gap.to}).`,
  `- Provenance: every record is synthetic. ${report.provenance.map(p => `${p.records} ${p.kind}`).join('; ')}. No real-world records.`,
  `- Content: ${report.content.editions} editions in ${report.content.stories} story groups; ${creditedReprints} credited word-for-word reprints, ${uncreditedCopies} uncredited copies, ${nearDuplicates} other pairs at 5-gram Jaccard 0.8 or more (highest ${report.content.max_5gram_jaccard}).`, '',
  '## By source', '', row(['Source', 'Date field', 'Records', 'Distinct dates', 'Earliest', 'Latest']), row(['---', '---', '---:', '---:', '---', '---']),
  ...bySource.map(s => row([s.label, '`' + s.field + '`', s.records, s.distinct_dates, s.earliest, s.latest])),
  row(['**All sources, deduplicated**', '', report.totals.counted, report.totals.global_distinct_dates, report.totals.earliest, report.totals.latest]), '',
  '## By month', '', row(['Month', 'Editions', 'Reads', 'Saves', 'Distinct dates', 'After the dataset clock']), row(['---', '---:', '---:', '---:', '---:', '---:']),
  ...monthly.map(m => row([m.month, m.editions, m.reading_history, m.reading_list, m.distinct_dates, m.after_clock])), '',
  'Records after the dataset clock are catalog editions only. Dayline shows each one once the run clock reaches its `added_at`; they are never part of the reader\'s pre-session history.', '');
process.stdout.write(out.join('\n'));
