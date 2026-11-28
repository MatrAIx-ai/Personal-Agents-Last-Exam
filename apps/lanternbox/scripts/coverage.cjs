#!/usr/bin/env node
'use strict';
// Counts the delivered data by record type and by month and writes COVERAGE.md.
// It reads the two delivered files as they are: fixtures/minimal.json (the seed, everything before
// the clock) and fixtures/schedules/late-2026.json (the events after the clock). The records the
// events create are found by applying the events to the seed through the App's own handler.
// Run with --check to recompute in memory and compare with the committed report byte for byte.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const plugin = require('../plugin.cjs');
const binding = require('../fixtures/binding.json');
const CLOCK = require('../fixtures/clock.json').initial_time;
const ZONE = 'America/New_York', FROM = '2025-01', TO = '2026-12';
const FILES = ['fixtures/minimal.json', 'fixtures/schedules/late-2026.json', 'fixtures/clock.json'];
// The date that says when the record came to exist in the App.
const FIELD = {profiles: 'created_at', titles: 'available_from', episodes: 'released_at', history: 'started_at', progress: 'updated_at', watchlist: 'added_at', devices: 'first_seen_at', charges: 'at', notifications: 'at', activity: 'at'};
const KEY = {profiles: r => r.profile_id, titles: r => r.title_id, episodes: r => r.playable_id, history: r => r.history_id, progress: r => r.profile_id + '|' + r.playable_id + '|' + r.updated_at,
  watchlist: r => r.profile_id + '|' + r.title_id, devices: r => r.device_id, charges: r => r.charge_id, notifications: r => r.notification_id, activity: r => r.seq};
// Episodes are stored inside their title; they are counted as records of their own.
const rowsOf = (data, type) => type === 'episodes' ? data.titles.flatMap(t => t.seasons.flatMap(s => s.episodes)) : data[type];
const TYPES = Object.keys(FIELD);

const read = name => fs.readFileSync(path.join(root, name));
const hash = name => crypto.createHash('sha256').update(read(name)).digest('hex');
const local = new Intl.DateTimeFormat('en-CA', {timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit'});
const dateOf = text => local.format(new Date(text));          // calendar date in the counting zone
const months = []; for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++) months.push(y + '-' + String(m).padStart(2, '0'));

const seed = JSON.parse(read(FILES[0])), schedule = JSON.parse(read(FILES[1]));
let after = structuredClone(seed);
for (const e of schedule) after = plugin.applyEvent({app_id: 'lanternbox', role: 'infra', virtual_now: e.at, binding}, after, e);

// One row per dated record: {type, date, month, part}.
//   seed     in the seed and dated before the clock: the history
//   gated    in the seed and dated after the clock: catalog dates the App reads against the clock (an upcoming film, an unreleased episode)
//   schedule not in the seed: exists once its event is applied
const rows = [], invalid = [], before = {}, afterWindow = {};
for (const type of TYPES) {
  const known = new Set(rowsOf(seed, type).map(KEY[type]));
  // Every seed row, then every row that exists after the schedule and is not a seed row.
  for (const [r, inSeed] of [...rowsOf(seed, type).map(r => [r, true]), ...rowsOf(after, type).filter(r => !known.has(KEY[type](r))).map(r => [r, false])]) {
    const value = r[FIELD[type]];
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) { invalid.push(type + ' ' + KEY[type](r)); continue; }
    const date = dateOf(value), month = date.slice(0, 7);
    if (month < FROM) { before[type] = (before[type] || 0) + 1; continue; }
    if (month > TO) { afterWindow[type] = (afterWindow[type] || 0) + 1; continue; }
    const late = Date.parse(value) >= Date.parse(CLOCK);
    if (inSeed && late && !['titles', 'episodes'].includes(type)) throw Error('A seed record that is not a catalog date is dated at or after the clock: ' + type + ' ' + KEY[type](r));
    if (!inSeed && !late) throw Error('A scheduled record is dated before the clock: ' + type + ' ' + KEY[type](r));
    rows.push({type, date, month, part: inSeed ? (late ? 'gated' : 'seed') : 'schedule'});
  }
}
const distinct = list => new Set(list.map(r => r.date)).size;
const span = list => { const d = list.map(r => r.date).sort(); return d.length ? d[0] + ' to ' + d.at(-1) : 'none'; };
const later = r => r.part !== 'seed';
const of = (part, type) => rows.filter(r => (!part || (part === 'later' ? later(r) : r.part === part)) && (!type || r.type === type));
const text = h => ['Date field', 'Seed range', 'After-clock range', 'SHA-256'].includes(h);
const table = (head, body) => ['| ' + head.join(' | ') + ' |', '|' + head.map((h, i) => i && !text(h) ? ' ---: |' : ' --- |').join(''), ...body.map(r => '| ' + r.join(' | ') + ' |')].join('\n');

const out = [];
out.push('# Lanternbox data coverage', '');
out.push('Written by `node scripts/coverage.cjs`; `node scripts/coverage.cjs --check` recomputes it and compares. Do not edit by hand.', '');
out.push('- **Window:** 2025-01-01 to 2026-12-31, inclusive.');
out.push('- **Counting time zone:** `' + ZONE + '`. Every timestamp carries an offset and is converted to this zone before its date is taken. There are no date-only records.');
out.push('- **Clock:** `' + CLOCK + '`. The seed holds the history before it. What comes after it is the schedule, plus a few catalog dates in the seed that the App reads against the clock.');
out.push('- **Provenance:** all synthetic, generated by `scripts/build-fixtures.cjs` from a fixed seed. No real person, title, studio or service, and no generated record is presented as an observed fact.');
out.push('- **Delivered dataset:** `fixtures/minimal.json` with `fixtures/schedules/late-2026.json` is the delivered Environment evaluation dataset. The tests load the same seed; there is no separate, smaller smoke fixture.', '');
out.push('## Files', '', table(['File', 'SHA-256'], FILES.map(f => ['`' + f + '`', '`' + hash(f) + '`'])), '');
out.push('## Record types', '');
out.push(table(['Record type', 'Date field', 'Seed', 'Seed dates', 'Seed range', 'After clock', 'After-clock dates', 'After-clock range'],
  TYPES.map(t => ['`' + t + '`', '`' + FIELD[t] + '`', of('seed', t).length, distinct(of('seed', t)), span(of('seed', t)), of('later', t).length, distinct(of('later', t)), span(of('later', t))])), '');
out.push('"After clock" has two parts. ' + of('schedule').length + ' records exist only once the ' + schedule.length + ' events of `fixtures/schedules/late-2026.json` (' + dateOf(schedule[0].at) + ' to ' + dateOf(schedule.at(-1).at) +
  ') have been applied: they are in no seed, and a read at the clock returns none of them. ' + of('gated').length + ' are catalog dates stored in the seed (' + of('gated', 'titles').length + ' films not yet available, ' + of('gated', 'episodes').length +
  ' episodes not yet released): the App shows such a film as `upcoming` and such an episode as not released, and refuses to play or mark either, until the clock reaches the date. Neither part is history before the clock.', '');
out.push('| Scope | Records | Distinct dates | Range |', '| --- | ---: | ---: | --- |',
  ...[['Seed, dated before the clock (history)', 'seed'], ['Seed, catalog dates after the clock', 'gated'], ['Schedule (after the clock)', 'schedule'], ['All', null]].map(([label, part]) => '| ' + [label, of(part).length, distinct(of(part)), span(of(part))].join(' | ') + ' |'), '');
out.push('## By month', '', 'Counts are seed records dated before the clock, except the last three columns. "Dates" is the number of distinct calendar dates in the month.', '');
out.push(table(['Month', ...TYPES, 'Seed total', 'Seed dates', 'After-clock records', 'After-clock dates', 'All dates'], months.map(m => {
  const s = rows.filter(r => r.month === m && r.part === 'seed'), l = rows.filter(r => r.month === m && later(r));
  return [m, ...TYPES.map(t => s.filter(r => r.type === t).length), s.length, distinct(s), l.length, distinct(l), distinct([...s, ...l])]; })), '');
out.push('## Gaps', '');
const all = [...new Set(rows.map(r => r.date))].sort(), gaps = [];
const dayNo = d => Date.parse(d + 'T00:00:00Z') / 86400000;
const edges = ['2024-12-31', ...all, '2027-01-01'];
for (let i = 1; i < edges.length; i++) { const n = dayNo(edges[i]) - dayNo(edges[i - 1]) - 1; if (n >= 7) gaps.push([edges[i - 1], edges[i], n]); }
const empty = months.filter(m => !rows.some(r => r.month === m));
out.push('- Months with no record: ' + (empty.length ? empty.join(', ') : 'none') + '.');
for (const t of TYPES) { const none = months.filter(m => !rows.some(r => r.month === m && r.type === t)); out.push('- Months with no `' + t + '` record: ' + (!none.length ? 'none' : none.length > 6 ? none.length + ' of 24' : none.join(', ')) + '.'); }
out.push('- Runs of 7 or more days with no record of any type (window edges included): ' + (gaps.length ? '' : 'none.'));
for (const [a, b, n] of gaps) out.push('  - ' + n + ' days between ' + a + ' and ' + b);
out.push('- Longest run: ' + Math.max(0, ...gaps.map(g => g[2])) + ' days.', '');
out.push('The window opens on 2025-01-01 and the account opens on ' + all[0] + '. `profiles` and `devices` are few by nature (' + seed.profiles.length + ' and ' + seed.devices.length + '), and there is one charge a month.', '');
out.push('## Left out', '');
out.push('- Catalog dates before 2025-01-01 are outside the window and not counted: ' + (before.titles || 0) + ' of ' + seed.titles.length + ' titles (`available_from`) and ' + (before.episodes || 0) + ' of ' + rowsOf(seed, 'episodes').length +
  ' episodes (`released_at`). The titles themselves stay in the catalog; only their dates are left out of the counts.');
out.push('- Other records dated before the window: ' + (Object.entries(before).filter(([t]) => !['titles', 'episodes'].includes(t)).map(([t, n]) => n + ' ' + t).join(', ') || 'none') + '. Records dated after the window: ' + (Object.entries(afterWindow).map(([t, n]) => n + ' ' + t).join(', ') || 'none') + '.');
out.push('- `plans` and the account record have no date field and are not counted (' + seed.plans.length + ' plans).');
out.push('- Secondary and planned dates are not counted: `available_until`, `paid_through`, charge `period_start` and `period_end`, history `recorded_at`, device `last_used_at`.');
out.push('- A progress row is counted at its latest `updated_at`; a row the schedule updates is counted again at the new date.');
out.push('- Records with a missing or invalid date: ' + invalid.length + (invalid.length ? ' (' + invalid.join(', ') + ')' : '') + '.', '');
const body = out.join('\n');

const file = path.join(root, 'COVERAGE.md');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== body) { console.error('COVERAGE.md is out of date. Run node scripts/coverage.cjs.'); process.exitCode = 1; }
  else console.log('COVERAGE.md matches the delivered files.');
} else { fs.writeFileSync(file, body); console.log(JSON.stringify({seed_records: of('seed').length, seed_dates: distinct(of('seed')), after_clock_records: of('later').length, all_dates: all.length, empty_months: empty}, null, 1)); }
