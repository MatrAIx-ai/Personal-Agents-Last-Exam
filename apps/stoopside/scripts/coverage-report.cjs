#!/usr/bin/env node
'use strict';
// Environment dataset coverage report (docs/submission-evidence.md section 3,
// "Reproducible count"). Reads the delivered fixtures listed in
// fixtures/index.json and their companion Mail seeds, takes one represented
// date per dated record, and counts distinct calendar dates per source and
// globally in one declared IANA time zone over the window 2025-01-01 to
// 2026-12-31.
//
//   node scripts/coverage-report.cjs           writes evidence/coverage.json and evidence/coverage.md
//   node scripts/coverage-report.cjs --check   fails if the committed files differ from a fresh run
//   node scripts/coverage-report.cjs --stdout  prints the JSON report
//
// No wall-clock value is used, so the output depends only on the files read.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const app = path.resolve(__dirname, '..');
const ZONE = 'Etc/GMT+5';   // IANA fixed-offset zone, UTC-05:00 with no daylight-saving change
const WINDOW = {from: '2025-01-01', to: '2026-12-31'};
const MONTHS = [];
for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++) MONTHS.push(`${y}-${String(m).padStart(2, '0')}`);

// One authoritative represented-date field per collection. A record with
// revisions contributes one dated record per revision (each is a change that
// happened on that date).
const FIELDS = [
  ['groups', 'created_at', 'group founded'],
  ['members', 'created_at', 'member account created'],
  ['memberships', 'revisions[].at', 'join, leave, removal or role change'],
  ['events', 'start', 'event occurrence (start time)'],
  ['events', 'revisions[].at', 'event posted, edited or cancelled'],
  ['rsvps', 'revisions[].at', 'RSVP answered or changed'],
  ['posts', 'revisions[].at', 'post, comment or announcement written, edited or deleted'],
  ['swaps', 'proposed_at', 'swap proposed'],
  ['swaps', 'decided_at', 'swap answered (null while pending)'],
  ['deliveries', 'at', 'notification delivered to a member'],
  ['mail.messages', 'received_at', 'Mail message received or sent (companion Mail seed)'],
];
const EXCLUDED = [
  ['events', 'end', 'end of the same occurrence as start'],
  ['events', 'rsvp_open, rsvp_close', 'deadlines, not occurrences'],
  ['rsvps', 'created_at, updated_at', 'equal to the first and last revision'],
  ['rsvps', 'waitlisted_at, offer_expires_at, reconfirm_by', 'queue key and deadlines'],
  ['posts', 'created_at, updated_at', 'equal to the first and last revision'],
  ['memberships', 'created_at', 'equal to the first revision'],
  ['sheets', 'lock_at', 'deadline; a sheet has no date of its own (its event is counted)'],
  ['swaps', 'expires_at', 'deadline'],
  ['groups', 'digest_through', 'bookkeeping time for the Monday digest'],
  ['scenario events', 'at', 'staged events applied by Infra after the fixture clock; reported separately, never counted as history'],
];

const sha = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(app, file))).digest('hex');
const read = file => JSON.parse(fs.readFileSync(path.join(app, file), 'utf8'));
const dayIn = zone => {
  const f = new Intl.DateTimeFormat('en-CA', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'});
  return iso => f.format(new Date(iso));
};
const day = dayIn(ZONE);
const offsetZone = offset => {   // "-06:00" -> "Etc/GMT+6" (IANA signs are inverted)
  const m = /^([+-])(\d\d):00$/.exec(offset);
  if (!m) throw new Error('Unsupported offset ' + offset);
  const h = Number(m[2]);
  return h === 0 ? 'Etc/GMT' : `Etc/GMT${m[1] === '-' ? '+' : '-'}${h}`;
};

function datedRecords(seed, mail) {
  const out = [];
  const add = (collection, field, id, at) => { if (at) out.push({collection, field, id, at}); };
  for (const g of seed.groups) add('groups', 'created_at', g.id, g.created_at);
  for (const m of seed.members) add('members', 'created_at', m.id, m.created_at);
  for (const m of seed.memberships) for (const v of m.revisions) add('memberships', 'revisions[].at', `${m.id}#${v.seq}`, v.at);
  for (const e of seed.events) {
    add('events', 'start', e.id, e.start);
    for (const v of e.revisions) add('events', 'revisions[].at', `${e.id}#${v.seq}`, v.at);
  }
  for (const r of seed.rsvps) for (const v of r.revisions) add('rsvps', 'revisions[].at', `${r.id}#${v.seq}`, v.at);
  for (const p of seed.posts) for (const v of p.revisions) add('posts', 'revisions[].at', `${p.id}#${v.seq}`, v.at);
  for (const w of seed.swaps) { add('swaps', 'proposed_at', w.id, w.proposed_at); add('swaps', 'decided_at', w.id, w.decided_at); }
  for (const d of seed.deliveries) add('deliveries', 'at', d.id, d.at);
  for (const m of mail.messages) add('mail.messages', 'received_at', m.id, m.received_at);
  return out;
}

function monthTable(dates) {
  const row = {};
  for (const m of MONTHS) row[m] = 0;
  for (const d of dates) if (row[d.slice(0, 7)] !== undefined) row[d.slice(0, 7)]++;
  return row;
}

function build() {
  const index = read('fixtures/index.json');
  const sources = [], global = new Set(), invalid = [];
  for (const f of index.fixtures) {
    const seed = read(f.seed), mail = read(f.mail_seed), scenario = read(f.scenario);
    const clock = f.clock, clockMs = Date.parse(clock);
    const records = datedRecords(seed, mail);
    for (const r of records) if (!Number.isFinite(Date.parse(r.at))) invalid.push({source: f.key, ...r});
    const valid = records.filter(r => Number.isFinite(Date.parse(r.at)));
    const inWindow = r => { const d = day(r.at); return d >= WINDOW.from && d <= WINDOW.to; };
    const history = valid.filter(r => Date.parse(r.at) <= clockMs);
    const scheduled = valid.filter(r => Date.parse(r.at) > clockMs);   // upcoming event starts after the clock
    const histIn = history.filter(inWindow), schedIn = scheduled.filter(inWindow);
    const dates = [...new Set(histIn.map(r => day(r.at)))].sort();
    const schedDates = [...new Set(schedIn.map(r => day(r.at)))].sort();
    for (const d of dates) global.add(d);
    const ownZone = offsetZone(seed.groups[0].utc_offset);
    if (seed.groups.some(g => g.utc_offset !== seed.groups[0].utc_offset)) throw new Error(f.key + ': groups use different offsets');
    const ownDay = dayIn(ownZone);
    const ownDates = new Set(histIn.map(r => ownDay(r.at)).filter(d => d >= WINDOW.from && d <= WINDOW.to));
    const byCollection = {};
    for (const [collection, field] of FIELDS) {
      const rs = histIn.filter(r => r.collection === collection && r.field === field);
      byCollection[`${collection}.${field}`] = {records: rs.length, distinct_dates: new Set(rs.map(r => day(r.at))).size};
    }
    const scenarioIn = scenario.filter(e => { const d = day(e.at); return d >= WINDOW.from && d <= WINDOW.to; });
    const months = monthTable(dates);
    sources.push({
      source_id: f.key, kind: 'synthetic',
      files: {seed: f.seed, seed_sha256: sha(f.seed), binding: f.binding, binding_sha256: sha(f.binding),
        mail_seed: f.mail_seed, mail_seed_sha256: sha(f.mail_seed), scenario: f.scenario, scenario_sha256: sha(f.scenario)},
      group_offset: seed.groups[0].utc_offset, clock,
      dated_records_total: valid.length,
      history_records_in_window: histIn.length,
      history_records_out_of_window: history.length - histIn.length,
      distinct_dates: dates.length,
      earliest: dates[0] || null, latest: dates.at(-1) || null,
      distinct_dates_in_group_offset: {zone: ownZone, count: ownDates.size},
      by_collection: byCollection,
      months,
      empty_months: MONTHS.filter(m => months[m] === 0),
      scheduled_after_clock: {records: schedIn.length, distinct_dates: schedDates.length, months: monthTable(schedDates)},
      scenario_events: {count: scenario.length, in_window: scenarioIn.length,
        first: scenario[0]?.at || null, last: scenario.at(-1)?.at || null},
    });
  }
  const all = [...global].sort();
  return {
    report: 'Stoopside environment dataset coverage',
    scope: 'Every delivered fixture in fixtures/index.json and its companion Mail seed (the records loaded with env.load_seed and Mail 1.3.0 seeding). Environment coverage window, not a Task history count.',
    generated_by: 'apps/stoopside/scripts/coverage-report.cjs',
    reproduce: 'cd apps/stoopside && node scripts/coverage-report.cjs --check',
    time_zone: ZONE,
    time_zone_note: 'Etc/GMT+5 is the IANA fixed-offset zone for UTC-05:00 with no daylight-saving change, the Maple St groups\' offset. Riverside (UTC-06:00) and Hillcrest (UTC-08:00) timestamps are converted to it before counting, so one global deduplicated count is possible. Each source\'s count in its own group offset is also given.',
    window: WINDOW,
    provenance: 'All records in every source are synthetic (0 real, 0 mixed). No real group, person, post or message is used, nothing was crawled, and there is no real-data anchor. The fixtures come from deterministic scripts in apps/stoopside/scripts/ (a fixed-seed generator plus hand-written specs); those scripts and their text were written with AI assistance, and no language model runs at generation time. The human read-through of every member and event row is pending. See contribution/dataset.json, generation.parameters.provenance.',
    authoritative_fields: FIELDS.map(([collection, field, meaning]) => ({collection, field, meaning})),
    excluded_fields: EXCLUDED.map(([collection, field, reason]) => ({collection, field, reason})),
    counting_rules: [
      'A timestamp counts as history when it is at or before the fixture clock. Upcoming event starts after the clock are reported as scheduled_after_clock and are not counted as history.',
      'Dates are taken in the counting zone and kept only when they fall in the window; records outside it are counted as out of window.',
      'A timestamp that does not parse is listed under invalid and not counted.',
    ],
    invalid,
    sources,
    global: {distinct_dates: all.length, earliest: all[0] || null, latest: all.at(-1) || null, months: monthTable(all),
      empty_months: MONTHS.filter(m => !all.some(d => d.startsWith(m)))},
  };
}

function markdown(r) {
  const L = [];
  const short = h => h.slice(0, 12);
  L.push('# Stoopside dataset coverage', '');
  L.push(`Generated by [\`scripts/coverage-report.cjs\`](../scripts/coverage-report.cjs) from the committed fixtures; do not edit by hand. Reproduce with \`${r.reproduce}\` (fails if this file or \`coverage.json\` differs from a fresh run). The full numbers, including per-collection counts, are in [\`coverage.json\`](coverage.json).`, '');
  L.push(`- **Scope:** ${r.scope}`);
  L.push(`- **Window:** ${r.window.from} to ${r.window.to}, inclusive.`);
  L.push(`- **Counting time zone:** \`${r.time_zone}\`. ${r.time_zone_note}`);
  L.push(`- **Provenance:** ${r.provenance}`);
  L.push(`- **Invalid or missing dates:** ${r.invalid.length ? r.invalid.length + ' (listed in coverage.json)' : 'none'}.`, '');
  L.push('## Which source covers the window', '');
  L.push('Maple St is the full-window source: its history runs from January 2025 to its clock (2027-03-01), so every month of 2025 and 2026 has records. Riverside and Hillcrest are bounded by their clocks by design: each fixture is a snapshot taken at its clock (Riverside 2026-04-20, Hillcrest 2026-11-18), and a fixture has no history after its own clock. Their months after the clock hold only upcoming events (scheduled, not history) or nothing. Together the three sources cover every month of the window; the global row below is the deduplicated union.', '');
  L.push('## Totals', '');
  L.push('| Source | Kind | Clock | Dated records | History in window | Distinct dates | Earliest | Latest | Distinct dates in own offset | Empty months |');
  L.push('| :--- | :--- | :--- | ---: | ---: | ---: | :--- | :--- | ---: | :--- |');
  for (const s of r.sources) {
    L.push(`| ${s.source_id} | ${s.kind} | ${s.clock} | ${s.dated_records_total} | ${s.history_records_in_window} | ${s.distinct_dates} | ${s.earliest} | ${s.latest} | ${s.distinct_dates_in_group_offset.count} (\`${s.distinct_dates_in_group_offset.zone}\`) | ${s.empty_months.length ? s.empty_months.join(', ') : 'none'} |`);
  }
  L.push(`| **global (deduplicated)** | synthetic | | | | **${r.global.distinct_dates}** | ${r.global.earliest} | ${r.global.latest} | | ${r.global.empty_months.length ? r.global.empty_months.join(', ') : 'none'} |`, '');
  L.push('## Distinct history dates by month', '');
  L.push('Scheduled event starts after a fixture\'s clock are shown in brackets and are not part of the history count.', '');
  L.push(`| Month | ${r.sources.map(s => s.source_id).join(' | ')} | global |`);
  L.push(`| :--- | ${r.sources.map(() => '---:').join(' | ')} | ---: |`);
  for (const m of MONTHS) {
    const cells = r.sources.map(s => `${s.months[m]}${s.scheduled_after_clock.months[m] ? ` [${s.scheduled_after_clock.months[m]}]` : ''}`);
    L.push(`| ${m} | ${cells.join(' | ')} | ${r.global.months[m]} |`);
  }
  L.push('');
  L.push('## Gaps and reasons', '');
  for (const s of r.sources) {
    const span = s.empty_months.length === 1 ? s.empty_months[0] : `${s.empty_months[0]} to ${s.empty_months.at(-1)} (${s.empty_months.length} months)`;
    const gap = s.empty_months.length ? `no history in ${span}, because the fixture's clock is ${s.clock.slice(0, 10)} and a fixture has no history after its clock` : 'no empty month';
    const thin = Object.entries(s.months).filter(([m, n]) => n > 0 && n < 8).map(([m, n]) => `${m} (${n})`);
    L.push(`- **${s.source_id}:** ${gap}.${thin.length ? ` Months with fewer than 8 distinct dates: ${thin.join(', ')}.` : ''} Scheduled after the clock: ${s.scheduled_after_clock.records} event starts on ${s.scheduled_after_clock.distinct_dates} dates in the window. Scenario: ${s.scenario_events.count} staged events (${s.scenario_events.in_window} in the window, ${s.scenario_events.first} to ${s.scenario_events.last}), applied by Infra and not counted.`);
  }
  L.push('');
  L.push('## Authoritative date fields', '');
  L.push('| Collection | Field | Represents |', '| :--- | :--- | :--- |');
  for (const f of r.authoritative_fields) L.push(`| ${f.collection} | \`${f.field}\` | ${f.meaning} |`);
  L.push('', '**Excluded fields**', '', '| Collection | Field | Reason |', '| :--- | :--- | :--- |');
  for (const f of r.excluded_fields) L.push(`| ${f.collection} | \`${f.field}\` | ${f.reason} |`);
  L.push('', '**Counting rules**', '');
  for (const x of r.counting_rules) L.push(`- ${x}`);
  L.push('', '## Source files', '');
  L.push('| Source | Seed | Binding | Mail seed | Scenario |', '| :--- | :--- | :--- | :--- | :--- |');
  for (const s of r.sources) {
    const f = s.files;
    L.push(`| ${s.source_id} | \`${f.seed}\` \`${short(f.seed_sha256)}\` | \`${f.binding}\` \`${short(f.binding_sha256)}\` | \`${f.mail_seed}\` \`${short(f.mail_seed_sha256)}\` | \`${f.scenario}\` \`${short(f.scenario_sha256)}\` |`);
  }
  L.push('', 'Full SHA-256 values are in `coverage.json` and `contribution/dataset.json`.', '');
  L.push('## Representative content and loading', '');
  L.push('- Loading: `tests/replay-checks.cjs` loads each fixture through Infra `env.load_seed` under real Core and each companion Mail seed into Mail 1.3.0, then reads them back with `mail.get`. `tests/fixtures.test.cjs` reads every reachable object of every fixture through the Agent tools.');
  L.push('- Representative records: Maple St `r-0125` (Dana\'s RSVP to the Pi Day bake sale, 2026-03-07, guests 1, children 2) and `p-0305`; Riverside soccer families RSVP of 2025-05-08; Hillcrest library friends RSVP of 2025-11-28. See the App README, section Data.');
  L.push('');
  return L.join('\n');
}

function main() {
  const r = build();
  const json = JSON.stringify(r, null, 2) + '\n', md = markdown(r);
  const dir = path.join(app, 'evidence');
  if (process.argv.includes('--stdout')) { process.stdout.write(json); return; }
  if (process.argv.includes('--check')) {
    const same = f => fs.existsSync(path.join(dir, f)) && fs.readFileSync(path.join(dir, f), 'utf8') === (f.endsWith('.json') ? json : md);
    const stale = ['coverage.json', 'coverage.md'].filter(f => !same(f));
    if (stale.length) { console.error('Out of date: ' + stale.map(f => 'evidence/' + f).join(', ') + '. Run node scripts/coverage-report.cjs.'); process.exitCode = 1; return; }
    console.log(`coverage report up to date: global ${r.global.distinct_dates} distinct dates; ` + r.sources.map(s => `${s.source_id} ${s.distinct_dates}`).join(', '));
    return;
  }
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'coverage.json'), json);
  fs.writeFileSync(path.join(dir, 'coverage.md'), md);
  console.log(`wrote evidence/coverage.json and evidence/coverage.md: global ${r.global.distinct_dates} distinct dates; ` + r.sources.map(s => `${s.source_id} ${s.distinct_dates}`).join(', '));
}

if (require.main === module) main();
module.exports = {build, markdown, ZONE, WINDOW};
