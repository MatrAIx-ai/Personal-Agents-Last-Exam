#!/usr/bin/env node
'use strict';
// Environment dataset coverage report (docs/submission-evidence.md, section 3
// and "Reproducible count"). Counts the represented dates of the records each
// delivered fixture loads, for the window 2025-01-01..2026-12-31.
//
//   node scripts/coverage-report.cjs          writes evidence/coverage.json and evidence/coverage.md
//   node scripts/coverage-report.cjs --check  fails if the committed report differs from a fresh run
//
// Pure: it reads only committed package files and needs no runtime. Loading
// and querying the counted records through real Core is checked separately in
// tests/platform-checks.cjs, which reads evidence/coverage.json.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const ZONE = 'America/Phoenix';
const WINDOW = {from: '2025-01-01', to: '2026-12-31'};
const MONTHS = [];
for (const y of [2025, 2026]) for (let m = 1; m <= 12; m++) MONTHS.push(`${y}-${String(m).padStart(2, '0')}`);

const SOURCES = [
  {source_id: 'fixture-minimal', file: 'fixtures/minimal.json', kind: 'reset fixture (manifest seed)'},
  {source_id: 'fixture-high-country', file: 'fixtures/high-country.json', kind: 'reset fixture'},
  {source_id: 'fixture-desert-rivers', file: 'fixtures/desert-rivers.json', kind: 'reset fixture'},
  {source_id: 'mail-seed', file: 'examples/messaging/mail-seed.json', kind: 'Mail seed used by examples/publish-to-mail.cjs'},
];

// The authoritative represented date of each counted collection. Every other
// date-like field is listed under EXCLUDED with its reason.
const FIELDS = [
  {collection: 'reservations', field: 'created_at', meaning: 'booking made (charge receipt time)', rows: s => s.reservations.map(r => [r.id, r.created_at])},
  {collection: 'reservations[].history', field: 'at', meaning: 'lifecycle event after booking: check-in, completion, cancellation, no-show release, change, late-arrival notice (the "confirmed" row repeats created_at and is not counted again)',
    rows: s => s.reservations.flatMap(r => r.history.filter(h => h.action !== 'confirmed').map((h, i) => [`${r.id}#${h.action}${i ? '-' + i : ''}`, h.at]))},
  {collection: 'reservations[].nights', field: 'date (date-only, facility-local)', meaning: 'a night the account holder stayed or is booked to stay (cancelled stays excluded)',
    rows: s => s.reservations.filter(r => !['cancelled', 'closure_cancelled'].includes(r.state)).flatMap(r => r.nights.map(d => [`${r.id}@${d}`, d]))},
  {collection: 'payments', field: 'created_at', meaning: 'charge or refund issued', rows: s => s.payments.map(p => [p.id, p.created_at])},
  {collection: 'alerts', field: 'posted_at', meaning: 'facility alert posted', rows: s => s.alerts.map(a => [a.id, a.posted_at])},
  {collection: 'closures', field: 'ordered_at', meaning: 'closure ordered', rows: s => s.closures.map(c => [c.id, c.ordered_at])},
  {collection: 'claims', field: 'claimed_at', meaning: 'another booker took open nights', rows: s => s.claims.map(c => [c.id, c.claimed_at])},
  {collection: 'claims[].nights', field: 'date (date-only, facility-local)', meaning: 'a night another booker holds', rows: s => s.claims.flatMap(c => c.nights.map(d => [`${c.id}@${d}`, d]))},
  {collection: 'equipment', field: 'updated_at', meaning: 'saved equipment last edited', rows: s => s.equipment.map(e => [e.id, e.updated_at])},
  {collection: 'companions', field: 'updated_at', meaning: 'saved companion last edited', rows: s => s.companions.map(c => [c.id, c.updated_at])},
  {collection: 'messages (Mail)', field: 'received_at', meaning: 'Mail message in the seeded inbox', rows: s => (s.messages || []).map(m => [m.id, m.received_at || m.sent_at])},
];
const EXCLUDED = [
  ['reservations.updated_at', 'repeats the last history row'],
  ['reservations.arrival, departure', 'stay bounds; the nights themselves are counted'],
  ['payments.posts_at', 'derived posting date (refunds post three days after created_at); counted once through created_at'],
  ['alerts.from, to, cancelled_at; alerts.revisions', 'validity window and its end, not an occurrence'],
  ['closures.from, to', 'validity window of the closure, not an occurrence'],
  ['wallet.cards exp_month, exp_year', 'expiry deadline'],
  ['holds.expires_at, previews.expires_at, notices', 'deadlines and run records; empty in every seed'],
  ['facilities, sites, policies', 'catalogue records with no represented date'],
  ['fixtures/schedules/*.json, fixtures/evaluator/*.json', 'scenario events applied during a run, not loaded history; listed separately below and not counted'],
];

const dateIn = (() => {
  const fmt = new Intl.DateTimeFormat('en-CA', {timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit'});
  return value => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;  // date-only: already a local calendar date
    const t = Date.parse(value);
    if (!Number.isFinite(t)) return null;
    return fmt.format(new Date(t));
  };
})();
const localDate = value => /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] ?? null;  // the record's own facility-local date
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const inWindow = d => d >= WINDOW.from && d <= WINDOW.to;
const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// A few representative records per fixture, as plain sentences, so a reader can
// check realism without opening the JSON.
function samples(seed) {
  if (!Array.isArray(seed.reservations)) return [];
  const name = id => seed.facilities.find(f => f.id === id)?.name || id;
  const dollars = c => '$' + (c / 100).toFixed(2);
  const byCreated = [...seed.reservations].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const pickR = [byCreated[0], byCreated[Math.floor(byCreated.length / 2)], byCreated.find(r => r.state === 'cancelled'), byCreated.find(r => r.state === 'no_show')].filter(Boolean);
  const out = [...new Set(pickR)].map(r => ({id: r.id, text: `${r.id}: ${name(r.facility_id)} site ${r.site_id.split('-').pop()}, ${r.arrival} to ${r.departure}, ${r.state.replace(/_/g, ' ')}, ${dollars(r.total_cents)} on ${r.card_id}, booked ${r.created_at}; history ${r.history.map(h => h.action.replace(/_/g, ' ') + ' ' + h.at.slice(0, 16)).join(', ')}.`}));
  for (const a of seed.alerts.slice(0, 1)) out.push({id: a.id, text: `${a.id}: ${a.kind.replace(/_/g, ' ')} at ${name(a.facility_id)}, posted ${a.posted_at}: "${a.text}"`});
  for (const c of seed.claims.slice(0, 1)) out.push({id: c.id, text: `${c.id}: another booker took site ${c.site_id} for ${c.nights.join(', ')} at ${c.claimed_at}.`});
  return out;
}

function report() {
  const sources = [], globalDates = new Set(), {filled} = require('../fixtures/generate.cjs').templates();
  for (const src of SOURCES) {
    const bytes = fs.readFileSync(path.join(ROOT, src.file));
    const raw = JSON.parse(bytes);
    const seed = raw.data && raw.binding ? raw.data : raw;  // the Mail seed wraps data and binding
    const clockFile = src.file.startsWith('fixtures/') ? `fixtures/schedules/${path.basename(src.file)}` : null;
    const clock = clockFile ? JSON.parse(fs.readFileSync(path.join(ROOT, clockFile), 'utf8')).initial_time : null;
    const clockDate = clock ? dateIn(clock) : null;
    const collections = [], dates = new Set(), months = Object.fromEntries(MONTHS.map(m => [m, {records: 0, dates: new Set()}]));
    let total = 0, invalid = 0, outside = 0, shifted = 0, earliest = null, latest = null;
    for (const f of FIELDS) {
      const has = f.collection.startsWith('messages') ? Array.isArray(seed.messages) : seed[f.collection.split(/[[.]/)[0]] !== undefined;
      if (!has) continue;
      const rows = f.rows(seed);
      const c = {collection: f.collection, field: f.field, meaning: f.meaning, records: rows.length, in_window: 0, outside_window: 0, invalid: 0, distinct_dates: 0, earliest: null, latest: null};
      const own = new Set();
      for (const [, value] of rows) {
        total++;
        const d = typeof value === 'string' ? dateIn(value) : null;
        if (!d) { c.invalid++; invalid++; continue; }
        if (localDate(value) !== d) shifted++;
        if (!inWindow(d)) { c.outside_window++; outside++; continue; }
        c.in_window++; own.add(d); dates.add(d); globalDates.add(d);
        months[d.slice(0, 7)].records++; months[d.slice(0, 7)].dates.add(d);
        if (!earliest || d < earliest) earliest = d;
        if (!latest || d > latest) latest = d;
      }
      const sorted = [...own].sort();
      Object.assign(c, {distinct_dates: own.size, earliest: sorted[0] || null, latest: sorted.at(-1) || null});
      if (rows.length) collections.push(c);
    }
    const monthRows = MONTHS.map(m => ({month: m, records: months[m].records, distinct_dates: months[m].dates.size,
      after_clock: clockDate ? m > clockDate.slice(0, 7) : null}));
    sources.push({source_id: src.source_id, file: src.file, kind: src.kind, provenance: 'synthetic', sha256: sha256(bytes),
      clock, records_counted: total, in_window: total - invalid - outside, outside_window: outside, invalid,
      date_shift_vs_facility_offset: shifted, distinct_dates: dates.size, earliest, latest,
      quiet_month_records: filled[path.basename(src.file, '.json')] || [],
      samples: samples(seed),
      thin_months: monthRows.filter(r => r.distinct_dates === 1).map(r => r.month),
      empty_months: monthRows.filter(r => r.records === 0).map(r => r.month), collections, months: monthRows});
  }
  const schedules = ['minimal', 'high-country', 'desert-rivers'].map(name => {
    const file = `fixtures/schedules/${name}.json`, bytes = fs.readFileSync(path.join(ROOT, file)), s = JSON.parse(bytes);
    const ds = s.events.map(e => dateIn(e.at)).sort();
    return {file, sha256: sha256(bytes), events: s.events.length, first: ds[0], last: ds.at(-1)};
  });
  const g = [...globalDates].sort();
  const globalMonths = MONTHS.map(m => ({month: m, distinct_dates: g.filter(d => d.startsWith(m)).length}));
  return {
    schema: 'switchback.coverage.v1',
    scope: 'Environment dataset coverage of the records each delivered Switchback fixture loads with env.load_seed (and the Mail seed used by the publisher), counted over represented occurrence dates.',
    window: WINDOW, time_zone: ZONE,
    time_zone_note: 'Facilities keep fixed UTC offsets (-06:00, -07:00 or -08:00, no daylight saving). Timestamps are normalized to America/Phoenix (UTC-07:00 all year) before taking the date; date-only fields (stay and claim nights) are facility-local calendar dates and are taken as they are. date_shift_vs_facility_offset counts records whose America/Phoenix date differs from the date in their own offset.',
    provenance: 'All records are synthetic: written by fixtures/generate.cjs from fixed seeds (claim instants drawn once from OS entropy into fixtures/evaluator/). No real facility, person, payment or Recreation.gov record is included, and none of these records is an observed fact.',
    fields: FIELDS.map(f => ({collection: f.collection, field: f.field, meaning: f.meaning})),
    excluded: EXCLUDED.map(([field, reason]) => ({field, reason})),
    invalid_dates: 'A value that does not parse as a date is counted under invalid and shown; there are none when invalid is 0.',
    sources,
    global: {distinct_dates: g.length, earliest: g[0] || null, latest: g.at(-1) || null, empty_months: globalMonths.filter(m => !m.distinct_dates).map(m => m.month), months: globalMonths},
    not_counted: {scenario_schedules: schedules},
  };
}

function markdown(r) {
  const L = [];
  const by = Object.fromEntries(r.sources.map(s => [s.source_id, s]));
  const fx = r.sources.filter(s => s.source_id.startsWith('fixture-'));
  L.push('# Switchback dataset coverage', '');
  L.push('Generated by `node scripts/coverage-report.cjs` from the committed package files; `npm test` fails if this file or `coverage.json` differs from a fresh run. Do not edit by hand.', '');
  L.push(`- **Scope:** ${r.scope}`);
  L.push(`- **Window:** ${r.window.from} to ${r.window.to}, inclusive.`);
  L.push(`- **Counting time zone:** \`${r.time_zone}\`. ${r.time_zone_note}`);
  L.push(`- **Provenance:** ${r.provenance}`);
  L.push(`- **Global deduplicated distinct dates in the window:** ${r.global.distinct_dates} (${r.global.earliest} to ${r.global.latest}); months with no date in any source: ${r.global.empty_months.length ? r.global.empty_months.join(', ') : 'none'}.`);
  L.push('', '## Sources', '');
  L.push('| Source | File | Provenance | SHA-256 | Clock | Records counted | In window | Outside window | Invalid | Distinct dates | Earliest | Latest | Empty months |');
  L.push('| :--- | :--- | :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: | :--- | :--- | :--- |');
  for (const s of r.sources) L.push(`| ${s.source_id} | \`${s.file}\` | ${s.provenance} | \`${s.sha256}\` | ${s.clock || 'none'} | ${s.records_counted} | ${s.in_window} | ${s.outside_window} | ${s.invalid} | ${s.distinct_dates} | ${s.earliest || 'none'} | ${s.latest || 'none'} | ${s.empty_months.length === 24 ? 'all (no dated records)' : s.empty_months.join(', ') || 'none'} |`);
  L.push('', '## Authoritative date field per collection', '');
  L.push('| Collection | Field | Represents |', '| :--- | :--- | :--- |');
  for (const f of r.fields) L.push(`| \`${f.collection}\` | \`${f.field}\` | ${f.meaning} |`);
  L.push('', 'Excluded date fields:', '');
  for (const e of r.excluded) L.push(`- \`${e.field}\`: ${e.reason}.`);
  L.push('', '## Per collection', '');
  L.push('| Source | Collection | Records | In window | Outside | Distinct dates | Earliest | Latest |', '| :--- | :--- | ---: | ---: | ---: | ---: | :--- | :--- |');
  for (const s of r.sources) for (const c of s.collections) L.push(`| ${s.source_id} | \`${c.collection}\` | ${c.records} | ${c.in_window} | ${c.outside_window} | ${c.distinct_dates} | ${c.earliest || 'none'} | ${c.latest || 'none'} |`);
  L.push('', '## Month by month, 2025-01 to 2026-12', '');
  L.push('Each cell is records / distinct dates. A month marked * lies after that fixture\'s task clock: its dates are stays and other bookers\' nights already booked for the future, not past activity.', '');
  L.push('| Month | ' + fx.map(s => s.source_id.replace('fixture-', '')).join(' | ') + ' | All sources (distinct dates) |');
  L.push('| :--- | ' + fx.map(() => '---:').join(' | ') + ' | ---: |');
  r.global.months.forEach((g, i) => {
    L.push(`| ${g.month} | ` + fx.map(s => { const m = s.months[i]; return `${m.records} / ${m.distinct_dates}${m.after_clock ? ' *' : ''}`; }).join(' | ') + ` | ${g.distinct_dates} |`);
  });
  L.push('', `The Mail seed (\`${by['mail-seed'].file}\`) holds an empty inbox: notices reach Mail only when examples/publish-to-mail.cjs delivers them during a run, so it adds no dated records.`);
  L.push('', '## Gaps and how each fixture covers the window', '');
  for (const s of fx) {
    const before = s.months.filter(m => !m.after_clock), after = s.months.filter(m => m.after_clock);
    const emptyBefore = before.filter(m => !m.records).map(m => m.month), emptyAfter = after.filter(m => !m.records).map(m => m.month);
    const parts = [`**${s.source_id}** (clock ${s.clock}): ${s.distinct_dates} distinct dates, ${s.earliest} to ${s.latest}.`];
    parts.push(emptyBefore.length ? `Empty months up to the clock: ${emptyBefore.join(', ')}.` : `Every month from 2025-01 ${after.length ? 'up to the clock' : 'to 2026-12'} has dated records.`);
    if (s.thin_months.length) parts.push(`Months with a single distinct date: ${s.thin_months.join(', ')}.`);
    if (s.quiet_month_records.length) parts.push(`${s.quiet_month_records.length} of its stays (${s.quiet_month_records.join(', ')}) come from the generator's quiet-month pass (fillQuietMonths in fixtures/generate.cjs), which adds one stay or advance booking for each month that the main history loop left without any dated record; every other record is unchanged from the earlier generator.`);
    if (after.length) {
      const horizon = addDays(s.clock.slice(0, 10), 179);
      parts.push(`After the clock (${after[0].month} on) the fixture holds only bookings for the future: its upcoming stays and other bookers' claimed nights in the 180-day released window, which ends ${horizon}. ` +
        (emptyAfter.length ? `${emptyAfter.join(', ')} ${emptyAfter.length === 1 ? 'has' : 'have'} no dates.` : '') +
        (s.latest < '2026-12-31' ? ` Nights after ${s.latest} are not released yet at this clock, so by rule nothing can be booked there; this end is by design, not missing data.` : ''));
    } else parts.push('Its clock lies after the window, so the whole window is past activity.');
    L.push('- ' + parts.join(' ').replace(/\s+/g, ' ').trim());
  }
  L.push('', 'minimal is the full-window source: its clock (2027-05-20) lies after the window, so all 24 months are past activity. high-country and desert-rivers are task fixtures whose clocks lie inside the window (evidence/README.md has a demo run at the desert-rivers clock); their history runs from January 2025 to the clock, and after it they hold only bookings for the future.');
  L.push('', '## Representative records', '');
  for (const s of fx) { L.push(`${s.source_id}:`, ''); for (const x of s.samples) L.push(`- ${x.text}`); L.push(''); }
  L.push('## Not counted: scenario schedules', '');
  L.push('Scenario events are applied by Infra during a run and are not loaded history.', '');
  L.push('| File | SHA-256 | Events | First | Last |', '| :--- | :--- | ---: | :--- | :--- |');
  for (const s of r.not_counted.scenario_schedules) L.push(`| \`${s.file}\` | \`${s.sha256}\` | ${s.events} | ${s.first} | ${s.last} |`);
  L.push('', '## Reproduce', '', '```sh', 'cd apps/switchback', 'node scripts/coverage-report.cjs --check   # compares with a fresh run', 'node scripts/coverage-report.cjs           # rewrites evidence/coverage.json and evidence/coverage.md', 'node fixtures/generate.cjs --check         # the fixtures themselves match the generator', '```', '');
  L.push('Loading: `node tests/platform-checks.cjs` (from the repository root: `node apps/switchback/tests/platform-checks.cjs`) loads each fixture with `env.load_seed` through real Core and checks that every counted reservation, payment, alert and closure ID, with its counted date, is returned by the Agent tools `switchback.reservations.list`, `switchback.reservations.get` and `switchback.alerts.list`.', '');
  return L.join('\n');
}

function files() {
  const r = report();
  return {'evidence/coverage.json': JSON.stringify(r, null, 2) + '\n', 'evidence/coverage.md': markdown(r)};
}

module.exports = {report, files, ZONE, WINDOW, dateIn};

if (require.main === module) {
  const check = process.argv.includes('--check');
  let drift = 0;
  for (const [rel, content] of Object.entries(files())) {
    const file = path.join(ROOT, rel);
    if (check) { if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) { console.error('Differs: ' + rel); drift++; } }
    else { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, content); }
  }
  if (drift) process.exitCode = 1;
  else console.log(check ? 'Coverage report matches a fresh run.' : 'Wrote evidence/coverage.json and evidence/coverage.md');
}
