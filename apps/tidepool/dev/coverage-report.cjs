#!/usr/bin/env node
'use strict';
// Coverage report for the Tidepool evaluation dataset (docs/submission-evidence.md, section 3).
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
const recorded = dataset.sources.find(s => s.source_id === 'generated')?.generation?.parameters?.outputs?.['seed.json']?.sha256;

const localDate = new Intl.DateTimeFormat('en-CA', {timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'});
// A date-only value (an album's release day) is that date in the counting zone.
const dateOf = iso => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const t = Date.parse(iso); return Number.isNaN(t) ? null : localDate.format(t);
};
const showTitle = new Map(seed.shows.map(s => [s.show_id, s.title]));
const memberName = new Map(seed.members.map(m => [m.member_id, m.display_name]));

// Each source names its authoritative date field: when the record happened in Tidepool.
const SOURCES = [
  ['episodes', seed.episodes, 'published_at', e => e.episode_id, e => 'episodes: ' + showTitle.get(e.show_id)],
  ['albums', seed.albums, 'released', a => a.album_id, () => 'album releases'],
  ['sessions', seed.sessions, 'started_at', s => s.session_id, s => 'sessions: ' + memberName.get(s.member_id)],
  ['payments', seed.billing.payments, 'at', p => p.invoice_id + '|' + p.outcome + '|' + p.at, () => 'billing payment results'],
  ['plan changes', seed.billing.timeline, 'set_at', t => t.plan_id + '|' + t.from, () => 'billing plan changes'],
  ['downloads', seed.downloads, 'requested_at', d => d.download_id, () => 'downloads'],
  ['library', seed.library, 'saved_at', l => l.member_id + '/' + l.item_id, () => 'library saves'],
  ['follows', seed.follows, 'followed_at', f => f.member_id + '/' + f.show_id, () => 'follows'],
  ['playlists', seed.playlists, 'created_at', p => p.playlist_id, () => 'playlists created'],
  ['playlist entries', seed.playlists.flatMap(p => p.tracks.map(t => ({...t, playlist_id: p.playlist_id}))), 'added_at', t => t.playlist_id + '/' + t.track_id, () => 'playlist tracks added'],
  ['notifications', seed.notifications, 'created_at', n => n.notice_id, () => 'notifications'],
  ['devices', seed.devices, 'registered_at', d => d.device_id, () => 'devices registered'],
  ['check-ins', seed.devices, 'last_checkin_at', d => d.device_id, () => 'device check-ins (latest)'],
  ['up next', seed.upnext, 'updated_at', u => u.member_id, () => 'Up Next lists set'],
  ['members', seed.members, 'joined_at', m => m.member_id, () => 'members joined'],
];
const FIXTURE_LISTS = {episodes: fixture.episodes, albums: fixture.albums, sessions: fixture.sessions, payments: fixture.billing.payments, 'plan changes': fixture.billing.timeline,
  downloads: fixture.downloads, library: fixture.library, follows: fixture.follows, playlists: fixture.playlists,
  'playlist entries': fixture.playlists.flatMap(p => p.tracks.map(t => ({...t, playlist_id: p.playlist_id}))), notifications: fixture.notifications,
  devices: fixture.devices, 'check-ins': fixture.devices, 'up next': fixture.upnext, members: fixture.members};

const records = [];
for (const [kind, list, field, key, label] of SOURCES) {
  const authored = new Map(FIXTURE_LISTS[kind].map(x => [key(x), JSON.stringify(x)]));
  for (const r of list) {
    const k = key(r), provenance = authored.get(k) === JSON.stringify(r) ? 'synthetic (authored fixture)'
      : authored.has(k) ? 'synthetic (fixture record changed for the 2025 story)' : 'synthetic (generated)';
    records.push({kind, source: label(r), id: k, field, value: r[field], provenance});
  }
}
const invalid = [], excluded = [], counted = [];
for (const r of records) {
  const date = dateOf(r.value);
  if (!date) invalid.push(r);
  else if (date < WINDOW[0] || date > WINDOW[1]) {
    excluded.push({...r, date, reason: r.kind === 'albums' ? 'album released 2022-2024, before the coverage window: catalogue back list, kept because the fixture holds it' : 'outside the coverage window'});
  }
  else counted.push({...r, date});
}

const months = [];
for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++) months.push(`${y}-${String(m).padStart(2, '0')}`);
const sources = [...new Set(counted.map(r => r.source))];
const bySource = sources.map(source => {
  const list = counted.filter(r => r.source === source), dates = [...new Set(list.map(r => r.date))].sort();
  return {source, field: list[0].field, records: list.length, distinct_dates: dates.length, earliest: dates[0], latest: dates.at(-1)};
});
const allDates = [...new Set(counted.map(r => r.date))].sort();
const catalogue = new Set(['episodes', 'albums']);
const familyDates = [...new Set(counted.filter(r => !catalogue.has(r.kind)).map(r => r.date))].sort();
const clockDate = dateOf(clock), clockMs = Date.parse(clock);
const monthly = months.map(month => {
  const list = counted.filter(r => r.date.startsWith(month));
  return {month, episodes: list.filter(r => r.kind === 'episodes').length, album_releases: list.filter(r => r.kind === 'albums').length,
    sessions: list.filter(r => r.kind === 'sessions').length, other_family_records: list.filter(r => !catalogue.has(r.kind) && r.kind !== 'sessions').length,
    distinct_dates: new Set(list.map(r => r.date)).size, family_dates: new Set(list.filter(r => !catalogue.has(r.kind)).map(r => r.date)).size,
    after_clock: list.filter(r => Date.parse(r.value) > clockMs).length};
});
function addDay(d, n = 1) {return new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);}
// Longest stretch of window days with no counted record (from the window start to the window end).
function longestGap(dates, end = WINDOW[1]) {
  let gap = {days: 0, from: null, to: null}, prev = null;
  for (const d of [...dates, addDay(end)]) {
    const start = prev ? addDay(prev) : WINDOW[0], span = Math.round((Date.parse(d) - Date.parse(start)) / 86400000);
    if (span > gap.days) gap = {days: span, from: start, to: addDay(d, -1)};
    prev = d;
  }
  return gap;
}
const gap = longestGap(allDates), familyGap = longestGap(familyDates.filter(d => d >= '2025-01-03'), clockDate);

// Content checks over catalogue text (episode title and notes): identical texts and word 5-gram overlap.
const fixtureEpisodes = new Set(fixture.episodes.map(e => e.episode_id));
const texts = seed.episodes.map(e => ({id: e.episode_id, authored: fixtureEpisodes.has(e.episode_id), text: e.title + '. ' + e.notes}));
const shingles = text => {const w = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean), s = new Set();
  for (let i = 0; i + 5 <= w.length; i++) s.add(w.slice(i, i + 5).join(' ')); return s;};
const sets = texts.map(t => shingles(t.text));
let identical = 0, nearAuthored = 0, nearGenerated = 0, maxSimilarity = 0, maxPair = null;
for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
  if (texts[i].text === texts[j].text) identical++;
  const a = sets[i], b = sets[j];
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  const sim = inter / (a.size + b.size - inter);
  if (sim > maxSimilarity) {maxSimilarity = sim; maxPair = [texts[i].id, texts[j].id];}
  if (sim >= 0.8) texts[i].authored && texts[j].authored ? nearAuthored++ : nearGenerated++;
}

const report = {
  scope: 'Tidepool evaluation dataset as delivered in apps/tidepool/data/evaluation/seed.json (the Raman-Ellis family, loaded for any of its four member accounts)',
  dataset_id: dataset.dataset_id, dataset_version: dataset.version, seed_sha256: sha256,
  seed_sha256_matches_dataset_json: recorded === sha256,
  time_zone: TIME_ZONE, window: WINDOW, dataset_clock: clock,
  method: 'Each record is counted on the calendar date of its authoritative field in America/Los_Angeles. Multiple records on one date count once in the global figure.',
  totals: {records: records.length, counted: counted.length, excluded: excluded.length, invalid: invalid.length,
    global_distinct_dates: allDates.length, earliest: allDates[0], latest: allDates.at(-1),
    distinct_dates_on_or_before_clock: allDates.filter(d => d <= clockDate).length,
    family_distinct_dates: familyDates.length, months_with_records: monthly.filter(m => m.distinct_dates > 0).length,
    months_with_family_records: monthly.filter(m => m.family_dates > 0).length, longest_gap: gap, longest_family_gap_before_clock: familyGap},
  provenance: Object.entries(counted.reduce((acc, r) => ({...acc, [r.provenance]: (acc[r.provenance] || 0) + 1}), {})).map(([kind, n]) => ({kind, records: n})),
  real_records: 0,
  by_source: bySource, monthly,
  content: {episodes: texts.length, identical_episode_texts: identical, near_duplicate_pairs_at_0_8: {authored_fixture: nearAuthored, involving_generated: nearGenerated},
    max_5gram_jaccard: Math.round(maxSimilarity * 1000) / 1000, max_pair: maxPair},
  not_counted: [
    'progress (updated_at, played_at) and plays (last_played_at): derived from the sessions, so their dates are session end times',
    'downloads completes_at and auto_delete_at: scheduled times that Tidepool derives states from',
    'downloads removed_at: the end of a download counted under requested_at',
    'family.created_at and billing.anchor: the account start, the same instant as Priya\'s joined_at and the first plan change',
    'activity: empty in the seed; written by the App during a run',
  ],
  excluded, invalid,
};

if (process.argv.includes('--json')) {process.stdout.write(JSON.stringify(report, null, 2) + '\n'); process.exit(0);}
const row = cells => '| ' + cells.join(' | ') + ' |';
const t = report.totals, out = [];
out.push('# Tidepool evaluation dataset coverage', '',
  `- Scope: ${report.scope}, version ${report.dataset_version}, sha256 \`${sha256}\` (${report.seed_sha256_matches_dataset_json ? 'matches' : 'DOES NOT MATCH'} \`dataset.json\`).`,
  `- Window ${WINDOW[0]} to ${WINDOW[1]}; dates counted in ${TIME_ZONE}; dataset clock ${clock}.`,
  `- ${t.records} dated records; ${t.counted} counted, ${t.excluded} excluded (${[...new Set(excluded.map(r => r.reason))].join('; ')}), ${t.invalid} without a valid date.`,
  `- **${t.global_distinct_dates} distinct dates** (${t.earliest} to ${t.latest}), records in ${t.months_with_records} of 24 months; ${t.distinct_dates_on_or_before_clock} dates fall on or before the dataset clock. Longest stretch with no record: ${gap.days} days (${gap.from} to ${gap.to}).`,
  `- Family records (everything except episodes and album releases) fall on ${t.family_distinct_dates} dates in ${t.months_with_family_records} months; between the account start (2025-01-03) and the dataset clock the longest stretch without one is ${familyGap.days} days (${familyGap.from} to ${familyGap.to}).`,
  `- Provenance: every record is synthetic. ${report.provenance.map(p => `${p.records} ${p.kind}`).join('; ')}. No real-world records.`,
  `- Content: ${texts.length} episodes; ${identical} identical title-and-notes texts; pairs at word 5-gram Jaccard 0.8 or more: ${nearAuthored} among authored fixture episodes, ${nearGenerated} involving generated ones (highest ${report.content.max_5gram_jaccard}, ${maxPair.join(' / ')}).`, '',
  '## By source', '', row(['Source', 'Date field', 'Records', 'Distinct dates', 'Earliest', 'Latest']), row(['---', '---', '---:', '---:', '---', '---']),
  ...bySource.map(s => row([s.source, '`' + s.field + '`', s.records, s.distinct_dates, s.earliest, s.latest])),
  row(['**All sources, deduplicated**', '', t.counted, t.global_distinct_dates, t.earliest, t.latest]), '',
  '## By month', '', row(['Month', 'Episodes', 'Album releases', 'Sessions', 'Other family records', 'Distinct dates', 'Family dates', 'After the dataset clock']),
  row(['---', '---:', '---:', '---:', '---:', '---:', '---:', '---:']),
  ...monthly.map(m => row([m.month, m.episodes, m.album_releases, m.sessions, m.other_family_records, m.distinct_dates, m.family_dates, m.after_clock])), '',
  'Records after the dataset clock are episodes only. Tidepool shows each one once the run clock reaches its `published_at`; they are never part of the family\'s pre-session history.', '',
  '## Excluded', '', row(['Record', 'Date', 'Reason']), row(['---', '---', '---']), ...excluded.map(r => row([r.id, r.date, r.reason])), '',
  '## Not counted', '', ...report.not_counted.map(x => '- ' + x), '');
process.stdout.write(out.join('\n'));
