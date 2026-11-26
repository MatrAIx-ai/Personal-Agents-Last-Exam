#!/usr/bin/env node
'use strict';
// Coverage report for the Wirewalk evaluation dataset (docs/submission-evidence.md, section 3).
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
const authoredPosts = new Set(fixture.posts.map(p => p.id)), authoredAccounts = new Set(fixture.accounts.map(a => a.id));
const name = new Map(seed.accounts.map(a => [a.id, a.display_name]));

// Each source names its authoritative date field: a post exists from published_at, an account from
// joined_at and a bookmark from saved_at. Link cards and images carry no dates.
const records = [];
for (const p of seed.posts) records.push({source: 'posts:' + p.author_id, id: p.id, field: 'published_at', value: p.published_at,
  provenance: authoredPosts.has(p.id) ? 'synthetic (authored fixture)' : 'synthetic (generated)'});
for (const a of seed.accounts) records.push({source: 'accounts', id: a.id, field: 'joined_at', value: a.joined_at,
  provenance: authoredAccounts.has(a.id) ? 'synthetic (authored fixture)' : 'synthetic (generated)'});
for (const b of seed.bookmarks) records.push({source: 'bookmarks', id: b.post_id, field: 'saved_at', value: b.saved_at,
  provenance: fixture.bookmarks.some(x => x.post_id === b.post_id && x.saved_at === b.saved_at) ? 'synthetic (authored fixture)' : 'synthetic (generated)'});

const invalid = [], excluded = [], counted = [];
for (const r of records) {
  const date = dateOf(r.value);
  if (!date) invalid.push(r);
  else if (date < WINDOW[0]) excluded.push({...r, date, reason: r.source === 'accounts' ? 'account joined before the coverage window' : 'before the coverage window'});
  else if (date > WINDOW[1]) excluded.push({...r, date, reason: 'after the coverage window'});
  else counted.push({...r, date});
}

const months = [];
for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++) months.push(`${y}-${String(m).padStart(2, '0')}`);
const order = s => s === 'accounts' ? 'zz1' : s === 'bookmarks' ? 'zz2' : s;
const sources = [...new Set(counted.map(r => r.source))].sort((a, b) => order(a) < order(b) ? -1 : 1);
const bySource = sources.map(source => {
  const list = counted.filter(r => r.source === source), dates = [...new Set(list.map(r => r.date))].sort();
  return {source, label: source.startsWith('posts:') ? 'Posts by ' + name.get(source.slice(6)) + ' (@' + source.slice(6) + ')' : source === 'accounts' ? 'Account joins' : 'Bookmarks (reader ww-priya)',
    field: list[0].field, records: list.length, distinct_dates: dates.length, earliest: dates[0], latest: dates.at(-1)};
});
const allDates = [...new Set(counted.map(r => r.date))].sort();
const postDates = new Set(counted.filter(r => r.source.startsWith('posts:')).map(r => r.date));
const clockDate = dateOf(clock), clockMs = Date.parse(clock);
const monthly = months.map(month => {
  const list = counted.filter(r => r.date.startsWith(month));
  return {month, posts: list.filter(r => r.source.startsWith('posts:')).length, bookmarks: list.filter(r => r.source === 'bookmarks').length,
    account_joins: list.filter(r => r.source === 'accounts').length, distinct_dates: new Set(list.map(r => r.date)).size,
    after_clock: list.filter(r => Date.parse(r.value) > clockMs).length};
});
// Longest stretch of window days with no counted record.
function addDay(d, n = 1) {return new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);}
let gap = {days: 0, from: null, to: null}, prev = null;
for (const d of [...allDates, addDay(WINDOW[1])]) {
  const start = prev ? addDay(prev) : WINDOW[0];
  const span = Math.round((Date.parse(d) - Date.parse(start)) / 86400000);
  if (span > gap.days) gap = {days: span, from: start, to: addDay(d, -1)};
  prev = d;
}
const missing = [];
for (let d = WINDOW[0]; d <= WINDOW[1]; d = addDay(d)) if (!allDates.includes(d)) missing.push(d);

// Content checks over the text-bearing posts (reposts carry no text): identical texts and word 5-gram overlap.
const texts = seed.posts.filter(p => p.text !== undefined);
const owners = new Map();
for (const p of texts) owners.set(p.text, [...(owners.get(p.text) || []), p.id]);
const identical = [...owners.values()].filter(list => list.length > 1);
const shingles = text => {const w = text.toLowerCase().split(/[^\p{L}\p{N}%$.]+/u).filter(Boolean), s = new Set();
  for (let i = 0; i + 5 <= w.length; i++) s.add(w.slice(i, i + 5).join(' ')); return s;};
const sets = [...owners.keys()].map(shingles), index = new Map();
sets.forEach((s, i) => {for (const g of s) {if (!index.has(g)) index.set(g, []); index.get(g).push(i);}});
let maxSimilarity = 0, nearDuplicates = 0, pairsAbove06 = 0;
sets.forEach((a, i) => {
  const hits = new Map();
  for (const g of a) for (const j of index.get(g)) if (j > i) hits.set(j, (hits.get(j) || 0) + 1);
  for (const [j, inter] of hits) {
    const sim = inter / (a.size + sets[j].size - inter);
    if (sim > maxSimilarity) maxSimilarity = sim;
    if (sim >= 0.8) nearDuplicates++;
    if (sim >= 0.6) pairsAbove06++;
  }
});
const kinds = {};
for (const p of seed.posts) kinds[p.kind] = (kinds[p.kind] || 0) + 1;

const report = {
  scope: 'Wirewalk evaluation dataset as delivered in apps/wirewalk/data/evaluation/seed.json (one reader instance, ww-priya)',
  dataset_id: dataset.dataset_id, dataset_version: dataset.version, seed_sha256: sha256,
  seed_sha256_matches_dataset_json: dataset.sources.find(s => s.source_id === 'generated')?.generation?.parameters?.outputs?.['seed.json']?.sha256 === sha256,
  expected_count_matches: dataset.expected_counts?.records === seed.posts.length,
  time_zone: TIME_ZONE, window: WINDOW, dataset_clock: clock,
  method: 'Each record is counted on the calendar date of its authoritative field (posts: published_at, accounts: joined_at, bookmarks: saved_at) in America/Los_Angeles. Multiple records on one date count once in the global figure.',
  totals: {records: records.length, counted: counted.length, excluded: excluded.length, invalid: invalid.length,
    global_distinct_dates: allDates.length, post_distinct_dates: postDates.size, earliest: allDates[0], latest: allDates.at(-1),
    distinct_dates_on_or_before_clock: allDates.filter(d => d <= clockDate).length,
    months_with_records: monthly.filter(m => m.distinct_dates > 0).length, window_days_without_records: missing.length, longest_gap: gap},
  provenance: Object.entries(counted.reduce((acc, r) => ({...acc, [r.provenance]: (acc[r.provenance] || 0) + 1}), {})).map(([kind, n]) => ({kind, records: n})),
  real_records: 0,
  fixture_records: {total: records.filter(r => r.provenance.includes('authored')).length,
    counted: counted.filter(r => r.provenance.includes('authored')).length,
    excluded: excluded.filter(r => r.provenance.includes('authored')).length},
  by_source: bySource, monthly, days_without_records: missing,
  content: {posts: seed.posts.length, by_kind: kinds, accounts: seed.accounts.length, bookmarks: seed.bookmarks.length, text_posts: texts.length,
    identical_texts: identical.length, near_duplicate_pairs_at_0_8: nearDuplicates, pairs_at_0_6_or_more: pairsAbove06,
    max_5gram_jaccard: Math.round(maxSimilarity * 1000) / 1000},
  not_in_seed: 'The seven event posts in examples/scenario.json and examples/wildfire-events.json (p19, p22-p27, Oct. 10-11, 2026) are applied as post.publish events and are not counted here.',
  excluded, invalid,
};

if (process.argv.includes('--json')) {process.stdout.write(JSON.stringify(report, null, 2) + '\n'); process.exit(0);}
const row = cells => '| ' + cells.join(' | ') + ' |';
const t = report.totals, c = report.content;
const out = [];
out.push('# Wirewalk evaluation dataset coverage', '',
  `- Scope: ${report.scope}, version ${report.dataset_version}, sha256 \`${sha256}\` (${report.seed_sha256_matches_dataset_json ? 'matches' : 'DOES NOT MATCH'} \`dataset.json\`; post count ${report.expected_count_matches ? 'matches' : 'DOES NOT MATCH'} \`expected_counts.records\`).`,
  `- Window ${WINDOW[0]} to ${WINDOW[1]}; dates counted in ${TIME_ZONE}; dataset clock ${clock}.`,
  `- ${t.records} records; ${t.counted} counted, ${t.excluded} outside the window, ${t.invalid} without a valid date.`,
  `- **${t.global_distinct_dates} distinct dates** (${t.earliest} to ${t.latest}; posts alone: ${t.post_distinct_dates}), records in ${t.months_with_records} of 24 months; ${t.distinct_dates_on_or_before_clock} dates fall on or before the dataset clock. ${t.window_days_without_records} window days have no record; the longest stretch without one is ${gap.days} days (${gap.from} to ${gap.to}).`,
  `- Provenance: every record is synthetic. Of the ${t.counted} counted records: ${report.provenance.map(p => `${p.records} ${p.kind}`).join('; ')}. The authored fixture contributes ${report.fixture_records.total} records in all; ${report.fixture_records.excluded} of them (its accounts, which joined before 2025) are among the exclusions. No real-world records.`,
  `- Content: ${c.posts} posts (${Object.entries(c.by_kind).map(([k, n]) => `${n} ${k}`).join(', ')}), ${c.accounts} accounts, ${c.bookmarks} bookmarks. Among ${c.text_posts} posts with text: ${c.identical_texts} identical texts, ${c.near_duplicate_pairs_at_0_8} pairs at word 5-gram Jaccard 0.8 or more (highest ${c.max_5gram_jaccard}).`,
  `- ${report.not_in_seed}`, '',
  '## By source', '', row(['Source', 'Date field', 'Records', 'Distinct dates', 'Earliest', 'Latest']), row(['---', '---', '---:', '---:', '---', '---']),
  ...bySource.map(s => row([s.label, '`' + s.field + '`', s.records, s.distinct_dates, s.earliest, s.latest])),
  row(['**All sources, deduplicated**', '', t.counted, t.global_distinct_dates, t.earliest, t.latest]), '',
  '## By month', '', row(['Month', 'Posts', 'Bookmarks', 'Account joins', 'Distinct dates', 'After the dataset clock']), row(['---', '---:', '---:', '---:', '---:', '---:']),
  ...monthly.map(m => row([m.month, m.posts, m.bookmarks, m.account_joins, m.distinct_dates, m.after_clock])), '',
  'Records after the dataset clock are public posts and one account join. Wirewalk shows each once the run clock reaches its date; they are never part of the reader\'s pre-session history. The reader\'s bookmarks all fall before the clock.', '',
  '## Gaps', '', missing.length ? `Window days without any record: ${missing.join(', ')}.` : 'Every window day has at least one record.', '',
  '## Exclusions', '', row(['Record', 'Date field', 'Value', 'Reason']), row(['---', '---', '---', '---']),
  ...excluded.map(r => row([r.source + ' `' + r.id + '`', '`' + r.field + '`', r.value, r.reason])), '',
  invalid.length ? `Records without a valid date: ${invalid.map(r => r.id).join(', ')}.` : 'No record lacks a valid date.', '');
process.stdout.write(out.join('\n'));
