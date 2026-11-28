#!/usr/bin/env node
'use strict';
// Environment dataset coverage report (docs/submission-evidence.md section 3
// and "Reproducible count") over the four delivered seeds, the records that
// env.load_seed loads unchanged (tests/platform-checks.cjs checks the loaded
// state hash equals each seed file's).
//
//   Scope       Environment coverage window 2025-01-01..2026-12-31, inclusive.
//   Time zone   America/New_York, the authority's zone. Every timestamp is
//               normalized to its Eastern calendar date with src/clock.cjs,
//               which computes the US daylight-time rules itself, so the
//               result does not depend on the host time zone.
//   Records     One record per row of the collections below, dated by the
//               field that says when the thing happened or was received.
//               Deadlines and validity limits are not occurrence dates and are
//               excluded: notice due dates and dispute windows, card expiry,
//               temporary-plate possession ends, preview expiry.
//   Excluded    Records dated outside the window (none expected), and rows
//               whose date field is empty or not a valid timestamp; both are
//               counted and listed, never dropped silently.
//   Provenance  All four seeds are synthetic, generated deterministically by
//               scripts/generate-seed.cjs; no record is real or collected.
//
//   node scripts/coverage-report.cjs            writes evidence/coverage.json and evidence/coverage.md
//   node scripts/coverage-report.cjs --check    compares them with a fresh run
//   node scripts/coverage-report.cjs --loading  also loads each seed into real Core over MCP and
//                                                reads tolls.list month by month (needs the runtime;
//                                                writes evidence/coverage-loading.json)
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../src/clock.cjs');

const root = path.resolve(__dirname, '..');
const ZONE = 'America/New_York';
const WINDOW = ['2025-01-01', '2026-12-31'];
const OUT_JSON = 'evidence/coverage.json', OUT_MD = 'evidence/coverage.md', OUT_LOADING = 'evidence/coverage-loading.json';

// Collection, the field that dates each row, and what that date means.
const SOURCES = [
  {collection: 'tolls', field: 'at', meaning: 'plaza read time'},
  {collection: 'ledger', field: 'at', meaning: 'balance movement time (toll debit, top-up, auto-replenish)'},
  {collection: 'statements', field: 'issued_at', meaning: 'statement issue time (12:00 AM on the 1st)'},
  {collection: 'notices', field: 'issued_at', meaning: 'violation notice issue time'},
  {collection: 'disputes', field: 'submitted_at', meaning: 'dispute submission time'},
  {collection: 'dispute_decisions', field: 'at', meaning: 'dispute decision time'},
  {collection: 'disputes', field: 'withdrawn_at', meaning: 'dispute withdrawal time', optional: true, label: 'dispute_withdrawals'},
  {collection: 'receipts', field: 'created_at', meaning: 'receipt time (top-up, replenish, payment, dispute)'},
  {collection: 'vehicles', field: 'added_at', meaning: 'vehicle added to the account'},
];
const EXCLUDED_FIELDS = ['notices.due_date', 'notices.dispute window (issue date + 45 days)', 'cards.exp_month/exp_year', 'vehicles.possession_end',
  'run.previews.expires_at', 'notices.escalated_at and notices.collections_at (deadline effects of a notice already counted at issue)'];

const months = () => {
  const out = [];
  for (let m = WINDOW[0].slice(0, 7); m <= WINDOW[1].slice(0, 7); m = C.nextMonth(m)) out.push(m);
  return out;
};
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');

function seedReport(entry) {
  const data = JSON.parse(fs.readFileSync(path.join(root, entry.seed), 'utf8'));
  const clock = JSON.parse(fs.readFileSync(path.join(root, entry.clock), 'utf8')).initial_time;
  const collections = [], dates = new Set(), byMonth = Object.fromEntries(months().map(m => [m, {records: 0, dates: new Set()}]));
  const excluded = [];
  let earliest = null, latest = null, total = 0;
  for (const s of SOURCES) {
    const rows = data[s.collection].filter(r => !s.optional || r[s.field] !== null);
    const own = new Set();
    let counted = 0;
    for (const r of rows) {
      const value = r[s.field];
      const t = typeof value === 'string' ? Date.parse(value) : NaN;
      if (!Number.isFinite(t) || !/[+-]\d{2}:\d{2}$|Z$/.test(value)) { excluded.push({collection: s.collection, id: r.id, field: s.field, value, reason: 'missing or invalid timestamp'}); continue; }
      const date = C.localDate(C.ms(value));
      if (date < WINDOW[0] || date > WINDOW[1]) { excluded.push({collection: s.collection, id: r.id, field: s.field, value, reason: 'outside the coverage window'}); continue; }
      counted++; own.add(date); dates.add(date);
      byMonth[date.slice(0, 7)].records++; byMonth[date.slice(0, 7)].dates.add(date);
      if (!earliest || date < earliest) earliest = date;
      if (!latest || date > latest) latest = date;
    }
    total += counted;
    collections.push({collection: s.label || s.collection, field: `${s.collection}.${s.field}`, meaning: s.meaning, records: counted, distinct_dates: own.size});
  }
  const opened = data.opened_on, clockDate = C.localDate(C.ms(clock));
  const monthly = months().map(m => ({month: m, records: byMonth[m].records, distinct_dates: byMonth[m].dates.size}));
  const gaps = monthly.filter(m => m.records === 0).map(m => ({month: m.month,
    reason: m.month < opened.slice(0, 7) ? `before the account opened (${opened})` : m.month > clockDate.slice(0, 7) ? `after the seed clock (${clockDate}); later activity is staged by the example schedule, not loaded history` : 'no activity generated in this month'}));
  return {seed_id: entry.seed_id, person: entry.person, account_id: entry.account_id, file: 'apps/crossway/' + entry.seed, sha256: sha256(entry.seed),
    provenance: 'synthetic', real_records: 0, opened_on: opened, clock, records: total, distinct_dates: dates.size, earliest, latest,
    collections, monthly, gaps, excluded, dates: [...dates].sort()};
}

function report() {
  const index = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/seeds/index.json'), 'utf8'));
  const seeds = index.seeds.map(seedReport);
  const all = new Set(seeds.flatMap(s => s.dates));
  const monthly = months().map(m => {
    const per = Object.fromEntries(seeds.map(s => [s.seed_id, s.monthly.find(x => x.month === m)]));
    const ds = new Set(seeds.flatMap(s => s.dates.filter(d => d.startsWith(m))));
    return {month: m, records: seeds.reduce((n, s) => n + per[s.seed_id].records, 0), distinct_dates: ds.size,
      by_seed: Object.fromEntries(seeds.map(s => [s.seed_id, per[s.seed_id].records]))};
  });
  const sorted = [...all].sort();
  return {
    report: 'Crossway environment dataset coverage', scope: 'Environment coverage window, all delivered seeds (fixtures/seeds/index.json)',
    window: {from: WINDOW[0], to: WINDOW[1], inclusive: true}, time_zone: ZONE,
    method: 'node apps/crossway/scripts/coverage-report.cjs: each seed file as committed (the records env.load_seed loads), one record per row of the listed collections, dated by the listed field and normalized to its America/New_York calendar date; distinct dates are deduplicated per seed and across all seeds.',
    date_fields: SOURCES.map(s => ({collection: s.label || s.collection, field: `${s.collection}.${s.field}`, meaning: s.meaning})),
    excluded_fields: EXCLUDED_FIELDS,
    provenance: {kind: 'synthetic', real_records: 0, real_anchor: null, generator: 'apps/crossway/scripts/generate-seed.cjs (deterministic; --check reproduces every seed file byte for byte)',
      note: 'No record is real or collected: plazas, rates, plates, people, cards and notices are fictional. The generator and story text were written with AI coding assistance; the records are its deterministic output. Human read-through: pending.'},
    totals: {records: seeds.reduce((n, s) => n + s.records, 0), distinct_dates_global: all.size, earliest: sorted[0], latest: sorted.at(-1),
      months_in_window: months().length, months_with_records: monthly.filter(m => m.records > 0).length,
      excluded: seeds.reduce((n, s) => n + s.excluded.length, 0)},
    global_gaps: monthly.filter(m => m.records === 0).map(m => m.month),
    seeds: seeds.map(({dates, ...s}) => s),
    monthly,
  };
}

function markdown(r) {
  const L = [];
  const row = cells => L.push('| ' + cells.join(' | ') + ' |');
  L.push('# Crossway dataset coverage', '');
  L.push(`Generated by \`node apps/crossway/scripts/coverage-report.cjs\` from the committed seed files; \`--check\` compares this file with a fresh run and \`tests/coverage.test.cjs\` runs that comparison in \`npm test\`.`, '');
  L.push(`- **Scope:** ${r.scope}.`);
  L.push(`- **Window:** ${r.window.from} to ${r.window.to}, inclusive.`);
  L.push(`- **Time zone:** ${r.time_zone}. Every timestamp is normalized to its Eastern calendar date before counting.`);
  L.push(`- **Provenance:** all records are synthetic (${r.provenance.real_records} real records, no real anchor). ${r.provenance.note}`);
  L.push(`- **Totals:** ${r.totals.records} records on ${r.totals.distinct_dates_global} distinct dates (global, deduplicated across seeds), from ${r.totals.earliest} to ${r.totals.latest}. ` +
    `${r.totals.months_with_records} of ${r.totals.months_in_window} months have records; months with none across all seeds: ${r.global_gaps.length ? r.global_gaps.join(', ') : 'none'}. Excluded rows: ${r.totals.excluded}.`, '');
  L.push('## Date fields', '');
  row(['Collection', 'Field', 'What the date is']); row(['---', '---', '---']);
  for (const f of r.date_fields) row([f.collection, '`' + f.field + '`', f.meaning]);
  L.push('', `Not counted (deadlines and validity limits, not occurrences): ${r.excluded_fields.join('; ')}.`, '');
  L.push('## Seeds', '');
  row(['Seed', 'File', 'SHA-256', 'Opened', 'Clock', 'Records', 'Distinct dates', 'Earliest', 'Latest']); row(['---', '---', '---', '---', '---', '---:', '---:', '---', '---']);
  for (const s of r.seeds) row([s.seed_id, '`' + s.file + '`', '`' + s.sha256 + '`', s.opened_on, s.clock, String(s.records), String(s.distinct_dates), s.earliest, s.latest]);
  L.push('');
  for (const s of r.seeds) {
    L.push(`### ${s.seed_id} (${s.person}, ${s.account_id})`, '');
    row(['Collection', 'Field', 'Records', 'Distinct dates']); row(['---', '---', '---:', '---:']);
    for (const c of s.collections) row([c.collection, '`' + c.field + '`', String(c.records), String(c.distinct_dates)]);
    L.push('', `Gaps: ${s.gaps.length ? s.gaps.map(g => `${g.month} (${g.reason})`).join('; ') : 'none'}. Excluded rows: ${s.excluded.length ? s.excluded.map(e => `${e.collection} ${e.id} (${e.reason})`).join('; ') : 'none'}.`, '');
  }
  L.push('## Month by month', '', 'Records per month by seed, the total, and the distinct dates in that month across all seeds.', '');
  const ids = r.seeds.map(s => s.seed_id);
  row(['Month', ...ids, 'Total records', 'Distinct dates']); row(['---', ...ids.map(() => '---:'), '---:', '---:']);
  for (const m of r.monthly) row([m.month, ...ids.map(id => String(m.by_seed[id])), String(m.records), String(m.distinct_dates)]);
  L.push('', '## Loading and retrieval', '');
  L.push('`tests/platform-checks.cjs` loads every seed with `env.load_seed` through real Core and checks that the loaded state hash equals the seed file\'s canonical hash, so these counts are over the records the App actually holds. `node apps/crossway/scripts/coverage-report.cjs --loading` also reads `crossway.tolls.list` month by month for every seed through the Agent MCP connection and checks each month\'s total against the toll counts here; its output is `evidence/coverage-loading.json`.', '');
  return L.join('\n') + '\n';
}

module.exports = {report, markdown, ZONE, WINDOW};

// Loads each seed into real Core and reads its tolls month by month through MCP.
async function loading(r) {
  const repo = path.resolve(root, '../..');
  const {platform, loadSeed} = require('../tests/platform-lib.cjs');
  const p = await platform(), out = {method: 'env.load_seed through Infra MCP, then crossway.tolls.list {from, to, limit: 500} for each month through Agent MCP', runtime: require(path.join(repo, 'runtime/package.json')).version, seeds: []};
  try {
    for (const s of r.seeds) {
      const infra = await p.open('infra', 'coverage-' + s.seed_id), agent = await p.open('agent', 'coverage-' + s.seed_id);
      await loadSeed(infra, s.seed_id, 'scenario');
      const tollsByMonth = {}, mismatches = [];
      const data = JSON.parse(fs.readFileSync(path.join(root, s.file.replace('apps/crossway/', '')), 'utf8'));
      for (const m of months()) {
        const last = C.addDays(`${C.nextMonth(m)}-01`, -1);
        const got = await agent.call('crossway.tolls.list', {from: `${m}-01`, to: last, limit: 500});
        if (got.status !== 'ok') throw Error(JSON.stringify(got));
        tollsByMonth[m] = got.total;
        const expected = data.tolls.filter(t => C.localDate(C.ms(t.at)).startsWith(m)).length;
        if (got.total !== expected) mismatches.push({month: m, mcp: got.total, seed: expected});
      }
      const notices = await agent.call('crossway.notices.list', {}), statements = await agent.call('crossway.account.statements', {});
      out.seeds.push({seed_id: s.seed_id, tolls_by_month_via_mcp: tollsByMonth, tolls_total_via_mcp: Object.values(tollsByMonth).reduce((a, b) => a + b, 0),
        tolls_in_seed: data.tolls.length, notices_via_mcp: notices.notices.length, notices_in_seed: data.notices.length,
        statements_via_mcp: statements.statements.length, statements_in_seed: data.statements.length, mismatches});
      if (mismatches.length) throw Error(`${s.seed_id}: tolls.list disagrees with the seed in ${mismatches.map(x => x.month).join(', ')}`);
      await infra.close(); await agent.close();
    }
  } finally {
    await p.close();
  }
  return out;
}

if (require.main === module) {
  (async () => {
    const r = report(), json = JSON.stringify(r, null, 2) + '\n', md = markdown(r);
    if (process.argv.includes('--check')) {
      for (const [file, text] of [[OUT_JSON, json], [OUT_MD, md]]) {
        if (!fs.existsSync(path.join(root, file)) || fs.readFileSync(path.join(root, file), 'utf8') !== text) throw Error(`${file} differs from a fresh run; run node scripts/coverage-report.cjs`);
        console.log(`${file} matches a fresh run.`);
      }
    } else {
      fs.mkdirSync(path.join(root, 'evidence'), {recursive: true});
      fs.writeFileSync(path.join(root, OUT_JSON), json);
      fs.writeFileSync(path.join(root, OUT_MD), md);
      console.log(`Wrote ${OUT_JSON} and ${OUT_MD}: ${r.totals.records} records, ${r.totals.distinct_dates_global} distinct dates, ${r.totals.earliest} to ${r.totals.latest}, ${r.totals.months_with_records}/${r.totals.months_in_window} months.`);
    }
    if (process.argv.includes('--loading')) {
      const l = await loading(r);
      fs.writeFileSync(path.join(root, OUT_LOADING), JSON.stringify(l, null, 2) + '\n');
      console.log(`Wrote ${OUT_LOADING}: tolls.list agrees with the seed in every month for ${l.seeds.length} seeds.`);
    }
  })().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
}
