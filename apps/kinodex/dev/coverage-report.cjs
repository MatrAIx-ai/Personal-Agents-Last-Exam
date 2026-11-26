#!/usr/bin/env node
'use strict';
// Coverage report for the Kinodex evaluation dataset (docs/submission-evidence.md, section 3).
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
const recorded = dataset.sources.find(s => s.source_id === 'generated')?.generation?.parameters?.outputs?.['seed.json'];

const localDate = new Intl.DateTimeFormat('en-CA', {timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'});
const dateOf = value => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value; // date-only fields are dates in the counting zone
  const t = Date.parse(value); return Number.isNaN(t) ? null : localDate.format(t);
};

// Provenance by stable ID: a fixture record kept as is, a fixture record whose text was rewritten, or a generated record.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function provenance(original, record) {
  if (!original) return 'generated';
  return same(original, record) ? 'fixture, verbatim' : 'fixture, text rewritten';
}
const byId = (list, key) => new Map(list.map(x => [x[key], x]));
const fx = {diary: byId(fixture.diary, 'entry_id'), reviews: byId(fixture.public_reviews, 'review_id'), episodes: byId(fixture.episodes, 'episode_id'),
  alerts: byId(fixture.alerts, 'alert_id'), corrections: byId(fixture.corrections, 'correction_id'), notices: byId(fixture.notices, 'notice_id'), lists: byId(fixture.lists, 'list_id'),
  titles: byId(fixture.titles, 'title_id'), guides: byId(fixture.guides, 'title_id')};
const fixtureOffers = new Set(fixture.offers.map(o => JSON.stringify(o)));

// Each source names its authoritative date field and its class: "happened" records exist in Kinodex from that
// time (the clock cutoff hides them until then); "scheduled or descriptive" dates are shown at any clock.
const SOURCES = {
  diary: {label: 'Diary entries (Dana)', field: 'watched_on', kind: 'happened (visible from logged_at)'},
  public_reviews: {label: 'Public reviews', field: 'posted_at', kind: 'happened'},
  episodes: {label: 'Episodes', field: 'air_date', kind: 'scheduled'},
  seasons: {label: 'Seasons added', field: 'titles[].seasons[].added_at', kind: 'happened'},
  guide_versions: {label: 'Guide versions 2+', field: 'guides[].versions[].published_at', kind: 'happened'},
  releases: {label: 'Title releases', field: 'titles[].releases[].date', kind: 'descriptive'},
  offers: {label: 'Offer windows opening', field: 'available_from', kind: 'scheduled'},
  alerts: {label: 'Alert rules (Dana)', field: 'created_at', kind: 'happened'},
  corrections: {label: 'Corrections (Dana)', field: 'submitted_at', kind: 'happened'},
  notices: {label: 'Notices (Dana)', field: 'at', kind: 'happened'},
  lists: {label: 'Lists (Dana)', field: 'created_at', kind: 'happened'},
  account: {label: 'Account settings (Dana)', field: 'account.updated_at', kind: 'state stamp'},
  watchlist: {label: 'Watchlist (Dana)', field: 'watchlist.updated_at', kind: 'state stamp'},
};
const records = [];
const add = (source, id, value, prov) => records.push({source, id, value, provenance: prov});
for (const e of seed.diary) add('diary', e.entry_id, e.watched_on, provenance(fx.diary.get(e.entry_id), e));
for (const r of seed.public_reviews) add('public_reviews', r.review_id, r.posted_at, provenance(fx.reviews.get(r.review_id), r));
for (const e of seed.episodes) add('episodes', e.episode_id, e.air_date, provenance(fx.episodes.get(e.episode_id), e));
for (const t of seed.titles) {
  const original = fx.titles.get(t.title_id);
  for (const s of t.seasons) add('seasons', t.title_id + ':s' + s.season_number, s.added_at, provenance(original?.seasons.find(x => x.season_number === s.season_number), s));
  for (const r of t.releases) add('releases', t.title_id + ':' + r.region, r.date, provenance(original?.releases.find(x => x.region === r.region), r));
}
for (const g of seed.guides) for (const v of g.versions.slice(1)) add('guide_versions', g.title_id + ':v' + v.version, v.published_at, provenance(fx.guides.get(g.title_id)?.versions.find(x => x.version === v.version), v));
for (const o of seed.offers) add('offers', o.offer_id, o.available_from, fixtureOffers.has(JSON.stringify(o)) ? 'fixture, verbatim' : 'generated');
for (const a of seed.alerts) add('alerts', a.alert_id, a.created_at, provenance(fx.alerts.get(a.alert_id), a));
for (const co of seed.corrections) add('corrections', co.correction_id, co.submitted_at, provenance(fx.corrections.get(co.correction_id), co));
for (const n of seed.notices) add('notices', n.notice_id, n.at, provenance(fx.notices.get(n.notice_id), n));
for (const l of seed.lists) add('lists', l.list_id, l.created_at, provenance(fx.lists.get(l.list_id), l));
add('account', 'account', seed.account.updated_at, provenance(fixture.account, seed.account));
add('watchlist', 'watchlist', seed.watchlist.updated_at, provenance(fixture.watchlist, seed.watchlist));

const REASON = {
  releases: 'descriptive release date of a title released before 2025 (catalog history, not activity in the window)',
  episodes: 'air date of an episode that aired before 2025 (catalog history of an older series)',
  seasons: 'season added before 2025 (catalog history of an older series)',
  offers: 'scheduled offer window that opens after 2026-12-31',
};
const invalid = [], excluded = [], counted = [];
for (const r of records) {
  const date = dateOf(r.value);
  if (!date) invalid.push(r);
  else if (date < WINDOW[0] || date > WINDOW[1]) excluded.push({...r, date, reason: REASON[r.source] || 'outside the coverage window'});
  else counted.push({...r, date});
}

const months = [];
for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++) months.push(`${y}-${String(m).padStart(2, '0')}`);
const sources = Object.keys(SOURCES).filter(s => counted.some(r => r.source === s));
const bySource = sources.map(source => {
  const list = counted.filter(r => r.source === source), dates = [...new Set(list.map(r => r.date))].sort();
  return {source, label: SOURCES[source].label, field: SOURCES[source].field, class: SOURCES[source].kind, records: list.length,
    excluded: excluded.filter(r => r.source === source).length, distinct_dates: dates.length, earliest: dates[0], latest: dates.at(-1)};
});
const allDates = [...new Set(counted.map(r => r.date))].sort();
const clockDate = dateOf(clock), clockMs = Date.parse(clock);
const ACCOUNT = ['alerts', 'corrections', 'notices', 'lists', 'account', 'watchlist'], CATALOG = ['episodes', 'seasons', 'guide_versions', 'releases'];
const later = r => (/^\d{4}-\d{2}-\d{2}$/.test(r.value) ? r.date > clockDate : Date.parse(r.value) > clockMs);
const monthly = months.map(month => {
  const list = counted.filter(r => r.date.startsWith(month)), n = names => list.filter(r => names.includes(r.source)).length;
  return {month, diary: n(['diary']), public_reviews: n(['public_reviews']), catalog: n(CATALOG), offers: n(['offers']), account: n(ACCOUNT),
    distinct_dates: new Set(list.map(r => r.date)).size, after_clock: list.filter(later).length};
});
// Longest stretch of days from `from` to `to` (inclusive) with none of the given dates.
function longestGap(dates, from = WINDOW[0], to = WINDOW[1]) {
  let gap = {days: 0, from: null, to: null}, prev = null;
  for (const d of [...dates.filter(x => x >= from && x <= to), addDay(to)]) {
    const start = prev ? addDay(prev) : from, span = Math.round((Date.parse(d) - Date.parse(start)) / 86400000);
    if (span > gap.days) gap = {days: span, from: start, to: addDay(d, -1)};
    prev = d;
  }
  return gap;
}
function addDay(d, n = 1) {return new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);}
// Dana's own history (diary and account records) up to the dataset clock.
const history = [...new Set(counted.filter(r => ['diary', ...ACCOUNT].includes(r.source) && !later(r)).map(r => r.date))].sort();
const historyGap = longestGap(history, WINDOW[0], clockDate);
// Dates from happened records only (the classes the clock cutoff hides), without scheduled or descriptive dates.
const happenedDates = [...new Set(counted.filter(r => !['scheduled', 'descriptive'].includes(SOURCES[r.source].kind)).map(r => r.date))].sort();

// Content checks over the authored prose: identical texts and word 5-gram Jaccard similarity >= 0.8 between different texts.
const PROSE = [
  ['Public review text', seed.public_reviews.map(r => [r.review_id, r.text])],
  ['Diary review text', seed.diary.filter(e => e.review).map(e => [e.entry_id, e.review.text])],
  ['Episode synopsis', seed.episodes.map(e => [e.episode_id, e.synopsis])],
  ['Title synopsis', seed.titles.map(t => [t.title_id, t.synopsis])],
  ['Correction evidence', seed.corrections.map(co => [co.correction_id, co.evidence])],
  ['Decision note', seed.corrections.flatMap(co => co.decisions.filter(d => d.note).map(d => [co.correction_id + ':' + d.decided_at, d.note]))],
  ['List description', seed.lists.filter(l => l.description).map(l => [l.list_id, l.description])],
  ['Notice text (App template)', seed.notices.map(n => [n.notice_id, n.text])],
];
const words = text => text.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);
const shingles = text => {const w = words(text), s = new Set(); for (let i = 0; i + 5 <= w.length; i++) s.add(w.slice(i, i + 5).join(' ')); return s;};
const all = PROSE.flatMap(([field, list]) => list.map(([id, text]) => ({field, id, text, set: shingles(text)})));
const groups = new Map();
for (const x of all) groups.set(x.text, [...(groups.get(x.text) || []), x]);
const identical = [...groups.values()].filter(g => g.length > 1).map(g => ({text: g[0].text, records: g.map(x => x.id)}));
const unique = [...groups.values()].map(g => g[0]);
let maxSimilarity = 0, maxPair = null;
const nearDuplicates = [];
for (let i = 0; i < unique.length; i++) for (let j = i + 1; j < unique.length; j++) {
  const a = unique[i].set, b = unique[j].set;
  if (!a.size || !b.size) continue;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  const sim = inter / (a.size + b.size - inter);
  if (sim > maxSimilarity) {maxSimilarity = sim; maxPair = [unique[i].id, unique[j].id];}
  if (sim >= 0.8) nearDuplicates.push({records: [unique[i].id, unique[j].id], similarity: Math.round(sim * 1000) / 1000});
}
const byField = PROSE.map(([field, list]) => ({field, texts: list.length, distinct: new Set(list.map(([, t]) => t)).size}));
const items = seed.guides.flatMap(g => g.versions.at(-1) ? Object.values(g.versions.at(-1).categories).flatMap(c => c.items.map(i => i.text)) : []);

const round = x => Math.round(x * 1000) / 1000;
const report = {
  scope: 'Kinodex evaluation dataset as delivered in apps/kinodex/data/evaluation/seed.json (the shared catalog and Dana Marsh\'s account)',
  dataset_id: dataset.dataset_id, dataset_version: dataset.version, seed_sha256: sha256, seed_bytes: Buffer.byteLength(seedText),
  seed_sha256_matches_dataset_json: recorded?.sha256 === sha256,
  time_zone: TIME_ZONE, window: WINDOW, dataset_clock: clock,
  method: 'Each record is counted on the calendar date of its authoritative field in America/Los_Angeles; date-only fields (watched_on, air_date, release dates) are dates in that zone. Multiple records on one date count once in the global figure. Records outside the window are excluded with a reason; unparseable dates are listed as invalid.',
  totals: {records: records.length, counted: counted.length, excluded: excluded.length, invalid: invalid.length,
    global_distinct_dates: allDates.length, earliest: allDates[0], latest: allDates.at(-1),
    distinct_dates_on_or_before_clock: allDates.filter(d => d <= clockDate).length, distinct_dates_after_clock: allDates.filter(d => d > clockDate).length,
    happened_distinct_dates: happenedDates.length, happened_longest_gap: longestGap(happenedDates),
    history_distinct_dates: history.length, months_with_records: monthly.filter(m => m.distinct_dates > 0).length,
    longest_gap: longestGap(allDates), longest_gap_in_history_before_clock: historyGap},
  provenance: Object.entries(counted.reduce((acc, r) => ({...acc, [r.provenance]: (acc[r.provenance] || 0) + 1}), {})).map(([kind, n]) => ({kind, records: n})),
  real_records: 0,
  by_source: bySource, monthly,
  content: {fields: byField, identical_text_groups: identical.length, identical_texts: identical, near_duplicate_pairs_at_0_8: nearDuplicates.length,
    near_duplicates: nearDuplicates, max_5gram_jaccard: round(maxSimilarity), max_pair: maxPair,
    guide_descriptors: {item_texts: items.length, distinct: new Set(items).size, note: 'Parental-guide category summaries and item descriptors come from a fixed vocabulary shared across titles (as on real guide sites, e.g. "Mild language."); they are not checked as prose.'}},
  not_counted: ['people, credits and services (no date fields)', 'guide version 1 published_at (a listing date 30 days before release, shown at any clock; the release itself is counted)',
    'alert trigger and correction decision times (each wrote a notice, counted under notices); correction withdrawal time', 'offer available_until and alert expires_at (scheduled ends)'],
  excluded_by_reason: Object.entries(excluded.reduce((acc, r) => {const k = r.source + ': ' + r.reason; (acc[k] = acc[k] || []).push(r.id); return acc;}, {}))
    .map(([reason, ids]) => ({reason, records: ids.length, examples: ids.slice(0, 3)})),
  invalid,
};

if (process.argv.includes('--json')) {process.stdout.write(JSON.stringify({...report, excluded}, null, 2) + '\n'); process.exit(0);}
const row = cells => '| ' + cells.join(' | ') + ' |';
const T = report.totals, C = report.content;
const out = [];
out.push('# Kinodex evaluation dataset coverage', '',
  `- Scope: ${report.scope}, version ${report.dataset_version}, ${report.seed_bytes} bytes, sha256 \`${sha256}\` (${report.seed_sha256_matches_dataset_json ? 'matches' : 'DOES NOT MATCH'} \`dataset.json\`).`,
  `- Window ${WINDOW[0]} to ${WINDOW[1]}; dates counted in ${TIME_ZONE}; dataset clock ${clock}.`,
  `- ${T.records} dated records; ${T.counted} counted, ${T.excluded} outside the window (reasons below), ${T.invalid} without a valid date.`,
  `- **${T.global_distinct_dates} distinct dates** (${T.earliest} to ${T.latest}) in ${T.months_with_records} of 24 months; ${T.distinct_dates_on_or_before_clock} on or before the dataset clock and ${T.distinct_dates_after_clock} after it. Longest stretch with no record: ${T.longest_gap.days} days (${T.longest_gap.from} to ${T.longest_gap.to}).`,
  `- Without the scheduled and descriptive sources (offer windows, episode air dates, release dates): ${T.happened_distinct_dates} distinct dates; longest stretch with no record: ${T.happened_longest_gap.days} days (${T.happened_longest_gap.from} to ${T.happened_longest_gap.to}).`,
  `- Dana's own history (diary and account records, ${WINDOW[0]} to the clock): ${T.history_distinct_dates} distinct dates; longest stretch without an entry: ${T.longest_gap_in_history_before_clock.days} days (${T.longest_gap_in_history_before_clock.from} to ${T.longest_gap_in_history_before_clock.to}).`,
  `- Provenance: every record is synthetic; none is real. ${report.provenance.map(p => `${p.records} ${p.kind}`).join('; ')}.`,
  `- Content: ${C.identical_text_groups} identical texts across ${all.length} prose texts; ${C.near_duplicate_pairs_at_0_8} pairs of different texts at word 5-gram Jaccard 0.8 or more (highest ${C.max_5gram_jaccard}). Guide descriptors are a fixed vocabulary (${C.guide_descriptors.distinct} distinct among ${C.guide_descriptors.item_texts} current items) and are not checked as prose.`, '',
  '## By source', '', row(['Source', 'Date field', 'Class', 'Counted', 'Excluded', 'Distinct dates', 'Earliest', 'Latest']), row(['---', '---', '---', '---:', '---:', '---:', '---', '---']),
  ...bySource.map(s => row([s.label, '`' + s.field + '`', s.class, s.records, s.excluded, s.distinct_dates, s.earliest, s.latest])),
  row(['**All sources, deduplicated**', '', '', T.counted, T.excluded, T.global_distinct_dates, T.earliest, T.latest]), '',
  '## By month', '', row(['Month', 'Diary', 'Public reviews', 'Catalog', 'Offers', 'Account', 'Distinct dates', 'After the clock']), row(['---', '---:', '---:', '---:', '---:', '---:', '---:', '---:']),
  ...monthly.map(m => row([m.month, m.diary, m.public_reviews, m.catalog, m.offers, m.account, m.distinct_dates, m.after_clock])), '',
  'Catalog is episodes, seasons, guide versions 2+ and releases; Account is alerts, corrections, notices, lists and the account and watchlist stamps. Records after the dataset clock are catalog records only (public reviews, guide versions, a season and its episodes, offer windows). Kinodex shows a happened record once the run clock reaches its time; scheduled and descriptive dates are shown at any clock. None of them is pre-session history.', '',
  '## Excluded and not counted', '', ...report.excluded_by_reason.map(e => `- ${e.reason}: ${e.records} records (e.g. ${e.examples.join(', ')}).`),
  ...report.not_counted.map(x => `- Not counted: ${x}.`), '',
  '## Text checks', '', row(['Field', 'Texts', 'Distinct']), row(['---', '---:', '---:']), ...byField.map(f => row([f.field, f.texts, f.distinct])), '',
  `Highest similarity between two different texts: ${C.max_5gram_jaccard} (${(C.max_pair || []).join(', ')}).`, '');
process.stdout.write(out.join('\n'));
