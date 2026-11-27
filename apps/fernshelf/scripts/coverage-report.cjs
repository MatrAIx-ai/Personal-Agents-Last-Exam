#!/usr/bin/env node
'use strict';
// Dataset coverage report for the reference fixture, as the App loads it (app.json names
// fixtures/reference.json as the seed and the package clock is fixtures/clock.json). Node built-ins
// only and deterministic: the same fixture gives the same bytes on every Node version.
//   node scripts/coverage-report.cjs            write evidence/coverage/report.{json,md}
//   node scripts/coverage-report.cjs --check    compare the committed report with the fixture
//   node scripts/coverage-report.cjs --query [--runtime DIR]
//                                               load the fixture in the public runtime and read every
//                                               counted record family back through the App's tools;
//                                               writes evidence/coverage/query.json
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const rel = p => path.relative(root, p).split(path.sep).join('/');
const OUT = path.join(root, 'evidence/coverage');
const WINDOW = {start: '2025-01-01', end: '2026-12-31'};

function months() {
  const out = [];
  for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++) out.push(y + '-' + String(m).padStart(2, '0'));
  return out;
}
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// One record family per row: where its records are, the field that dates what the record
// represents, and the read that returns it.
const FAMILIES = [
  {source: 'items', records: d => d.items, field: 'added_at', id: r => r.id,
    meaning: 'arrival in the library (backup by the phone, or a save from a shared album)'},
  {source: 'item_history', records: d => d.items.flatMap(i => i.history.map((h, n) => ({...h, id: i.id + '#history' + n}))), field: 'at', id: r => r.id,
    meaning: 'one change to one item (added, edited, trashed, restored, purged, cover chosen)'},
  {source: 'stacks', records: d => d.stacks, field: 'created_at', id: r => r.id, meaning: 'arrival of the first version of the shot'},
  {source: 'albums', records: d => d.albums, field: 'created_at', id: r => r.id, meaning: 'album created'},
  {source: 'album_members', records: d => d.albums.flatMap(a => a.members.map(m => ({...m, id: a.id + '/' + m.person_id}))), field: 'invited_at', id: r => r.id,
    meaning: 'invitation sent (later joins, declines and departures are in the member\'s history and in activity)'},
  {source: 'contributions', records: d => d.albums.flatMap(a => a.contributions), field: 'added_at', id: r => r.id, meaning: 'a member added an item to a shared album'},
  {source: 'links', records: d => d.links, field: 'created_at', id: r => r.id, meaning: 'share link created'},
  {source: 'views', records: d => d.views, field: 'at', id: r => r.id, meaning: 'a view (with any saves) through a link or by a joined member'},
  {source: 'removals', records: d => d.removals, field: 'requested_at', id: r => r.id, meaning: 'a removal request arrived'},
  {source: 'notifications', records: d => d.notifications, field: 'at', id: r => r.id, meaning: 'a notice written for what others or the device did'},
  {source: 'activity', records: d => d.activity, field: 'at', id: r => 'seq-' + r.seq, meaning: 'one activity-log row (an event, an effect, or the account holder\'s write)'}
];
// Stored due times: they say when something will happen, so they are not history.
const SCHEDULED = [
  {kind: 'purge_at', what: 'a trashed item is deleted for good', records: d => d.items.filter(i => i.state === 'trashed').map(i => ({id: i.id, at: i.purge_at}))},
  {kind: 'expires_at', what: 'a share link stops working', records: d => d.links.filter(l => l.expires_at && !l.revoked_at).map(l => ({id: l.id, at: l.expires_at}))}
];
// What each family's records are made of, from contribution/dataset.json.
const PROVENANCE = {
  items: ['authored', 'procedural', 'history'], item_history: ['history'], stacks: ['procedural', 'history'], albums: ['authored', 'procedural', 'history'],
  album_members: ['authored', 'history'], contributions: ['authored'], links: ['authored', 'history'], views: ['authored', 'history'],
  removals: ['authored', 'history'], notifications: ['history'], activity: ['history']
};

function build() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const seedFile = path.join(root, manifest.fixtures.seed), clockFile = path.join(root, 'fixtures/clock.json');
  const data = JSON.parse(fs.readFileSync(seedFile, 'utf8')), clock = JSON.parse(fs.readFileSync(clockFile, 'utf8')).initial_time;
  const dataset = JSON.parse(fs.readFileSync(path.join(root, 'contribution/dataset.json'), 'utf8'));
  const zone = data.account.time_zone;
  const fmt = new Intl.DateTimeFormat('en-CA', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'});
  const localDate = iso => {
    if (typeof iso !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(iso) || !Number.isFinite(Date.parse(iso))) return null;
    const parts = Object.fromEntries(fmt.formatToParts(new Date(iso)).map(p => [p.type, p.value]));
    return parts.year + '-' + parts.month + '-' + parts.day;
  };
  const clockDate = localDate(clock), clockMs = Date.parse(clock);
  const inWindow = d => d >= WINDOW.start && d <= WINDOW.end;
  const all = new Map(), sources = [], exclusions = [];
  for (const f of FAMILIES) {
    const recs = f.records(data), byMonth = Object.fromEntries(months().map(m => [m, {records: 0, dates: new Set()}]));
    const dates = new Set();
    let counted = 0, earliest = null, latest = null, afterClock = 0;
    for (const r of recs) {
      const at = r[f.field], d = localDate(at);
      if (!d) { exclusions.push({source: f.source, id: f.id(r), reason: 'missing or invalid ' + f.field}); continue; }
      if (!inWindow(d)) { exclusions.push({source: f.source, id: f.id(r), reason: f.field + ' ' + d + ' is outside ' + WINDOW.start + '..' + WINDOW.end}); continue; }
      if (Date.parse(at) > clockMs) afterClock++;
      counted++; dates.add(d);
      byMonth[d.slice(0, 7)].records++; byMonth[d.slice(0, 7)].dates.add(d);
      if (!all.has(d)) all.set(d, {records: 0, sources: new Set()});
      all.get(d).records++; all.get(d).sources.add(f.source);
      if (!earliest || at < earliest.at) earliest = {at, date: d, id: f.id(r)};
      if (!latest || Date.parse(at) > Date.parse(latest.at)) latest = {at, date: d, id: f.id(r)};
    }
    sources.push({source: f.source, date_field: f.field, represents: f.meaning, records: recs.length, counted, records_after_clock: afterClock,
      distinct_dates: dates.size, earliest: earliest && earliest.date, latest: latest && latest.date,
      provenance: {kind: 'synthetic', generated_by: PROVENANCE[f.source]},
      months: Object.fromEntries(Object.entries(byMonth).map(([m, v]) => [m, {records: v.records, distinct_dates: v.dates.size}]))});
  }
  const dates = [...all.keys()].sort();
  const monthly = Object.fromEntries(months().map(m => {
    const ds = dates.filter(d => d.startsWith(m));
    return [m, {records: ds.reduce((n, d) => n + all.get(d).records, 0), distinct_dates: ds.length}];
  }));
  const scheduled = SCHEDULED.map(s => {
    const recs = s.records(data).filter(r => Date.parse(r.at) > clockMs).map(r => ({id: r.id, at: r.at, date: localDate(r.at)})).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const byMonth = {}; for (const r of recs) byMonth[r.date.slice(0, 7)] = (byMonth[r.date.slice(0, 7)] || 0) + 1;
    return {field: s.kind, meaning: s.what, records: recs.length, by_month: byMonth, dates: recs.map(r => r.date)};
  });
  const takenBefore = data.items.filter(i => localDate(i.taken_at) < WINDOW.start).length;
  const files = ['fixtures/reference.json', 'fixtures/clock.json', 'contribution/dataset.json', 'contribution/assets.catalog.json',
    'scripts/build-reference-fixture.cjs', 'scripts/reference-history.cjs', 'dev/places.cjs', 'dev/draw-images.cjs'];
  const lastHistory = dates.filter(d => d <= clockDate).at(-1);
  const monthsWithout = months().filter(m => monthly[m].records === 0);
  const sourceInfo = dataset.sources.map(s => ({source_id: s.source_id, kind: s.kind, method: s.generation.method, tool: s.generation.tool, seed: s.generation.seed,
    seed_note: s.generation.seed !== null ? null : s.generation.method === 'manual' ? 'written by hand' : 'deterministic; ' + (s.generation.parameters.seed_from || 'no random seed'), description: s.description}));
  return {
    schema: 'fernshelf.coverage.v1',
    scope: 'Environment dataset coverage of the delivered reference fixture (the package seed every run starts from), not a Task history selection.',
    dataset: {dataset_id: dataset.dataset_id, version: dataset.version, seed_file: manifest.fixtures.seed, clock: clock},
    time_zone: zone,
    window: WINDOW,
    method: 'Each record family\'s authoritative date field is read from the seed file, normalised from its UTC offset to a calendar date in ' + zone +
      ' with Intl.DateTimeFormat, and counted if it falls in the window. A date with several records or families counts once in the global count. ' +
      'Due times stored for the future (purge_at, expires_at) are reported separately and never counted as history.',
    files: Object.fromEntries(files.map(f => [f, 'sha256:' + sha256(path.join(root, f))])),
    totals: {records: sources.reduce((n, s) => n + s.records, 0), counted: sources.reduce((n, s) => n + s.counted, 0),
      global_distinct_dates: dates.length, earliest: dates[0], latest: dates.at(-1), months_with_records: 24 - monthsWithout.length, months_without_records: monthsWithout},
    sources,
    monthly,
    dates: Object.fromEntries(dates.map(d => [d, {records: all.get(d).records, sources: [...all.get(d).sources]}])),
    after_clock: {
      clock,
      last_history_date: lastHistory,
      history_records_after_clock: sources.reduce((n, s) => n + s.records_after_clock, 0),
      gap: 'No record of what happened exists after the clock (' + clock + '): from then to ' + WINDOW.end + ' the fixture holds only stored due times. ' +
        'History dates in November 2026 end on ' + lastHistory + '; December 2026 has no history record.',
      before_opening: 'The account was opened on ' + localDate(data.account.opened_at) + ', so ' + WINDOW.start + ' to the day before have no record.',
      scheduled
    },
    exclusions,
    not_counted: [
      {field: 'items[].taken_at', reason: 'capture time of the photo, not when the account received it; ' + takenBefore + ' items were captured before 2025-01-01 and arrived in the phone\'s first sync on 2025-01-04'},
      {field: 'items[].trashed_at, purged_at; members[].joined_at, ended_at; removals[].answers[].at; links[].revoked_at', reason: 'state changes; each also has its own item_history or activity row, which is counted'},
      {field: 'items[].purge_at, links[].expires_at', reason: 'stored due times; past ones are counted through the purge or expiry rows, future ones are listed under after_clock.scheduled'}
    ],
    provenance: {
      real_records: 0,
      statement: 'Every record is synthetic. Fernshelf is one fictional person\'s private photo library; no real account, website or photo was collected. ' +
        'The records were written by hand or generated from fixed seeds by the scripts named below, and the image files were drawn by a script.',
      sources: sourceInfo
    }
  };
}

function markdown(r) {
  const L = [];
  const p = s => L.push(s);
  p('# Fernshelf dataset coverage');
  p('');
  p('Generated by `node scripts/coverage-report.cjs` from `' + r.dataset.seed_file + '` (the package seed) and `fixtures/clock.json`. ' + r.scope);
  p('');
  p('- Time zone: `' + r.time_zone + '` (the account\'s). Window: ' + r.window.start + ' to ' + r.window.end + ', inclusive. Clock: `' + r.dataset.clock + '`.');
  p('- Method: ' + r.method);
  p('- Records: ' + r.totals.records + ' in ' + r.sources.length + ' families, ' + r.totals.counted + ' counted. Global distinct dates: **' + r.totals.global_distinct_dates +
    '**, from ' + r.totals.earliest + ' to ' + r.totals.latest + '. Months with records: ' + r.totals.months_with_records + ' of 24' +
    (r.totals.months_without_records.length ? ' (none in ' + r.totals.months_without_records.join(', ') + ')' : '') + '.');
  p('- Provenance: ' + r.provenance.statement + ' Real records: ' + r.provenance.real_records + '.');
  p('- Exclusions: ' + (r.exclusions.length ? r.exclusions.length + ' (listed in report.json)' : 'none; every authoritative date is present, valid and inside the window') + '.');
  p('');
  p('## Sources');
  p('');
  p('| Source | Date field | What the date is | Records | Distinct dates | Earliest | Latest | Generated by |');
  p('| --- | --- | --- | ---: | ---: | --- | --- | --- |');
  for (const s of r.sources) p('| `' + s.source + '` | `' + s.date_field + '` | ' + s.represents + ' | ' + s.counted + ' | ' + s.distinct_dates + ' | ' + s.earliest + ' | ' + s.latest + ' | ' + s.provenance.generated_by.join(', ') + ' |');
  p('');
  p('## By month');
  p('');
  p('Records per source and month (distinct dates in the last two columns, over all sources).');
  p('');
  const short = {items: 'items', item_history: 'hist', stacks: 'stk', albums: 'alb', album_members: 'mem', contributions: 'ctb', links: 'lnk', views: 'view', removals: 'rr', notifications: 'ntf', activity: 'act'};
  p('| Month | ' + r.sources.map(s => short[s.source]).join(' | ') + ' | Records | Distinct dates |');
  p('| --- | ' + r.sources.map(() => '---:').join(' | ') + ' | ---: | ---: |');
  for (const [m, v] of Object.entries(r.monthly)) p('| ' + m + ' | ' + r.sources.map(s => s.months[m].records).join(' | ') + ' | ' + v.records + ' | ' + v.distinct_dates + ' |');
  p('');
  p('Columns: ' + r.sources.map(s => short[s.source] + ' = `' + s.source + '`').join(', ') + '.');
  p('');
  p('## Gaps and scheduled dates');
  p('');
  p(r.after_clock.gap + ' History records dated after the clock: ' + r.after_clock.history_records_after_clock + '. ' + r.after_clock.before_opening);
  p('');
  p('Stored due times after the clock. They are scheduled, not history, and are not counted above:');
  p('');
  p('| Field | Meaning | Count | By month | Dates |');
  p('| --- | --- | ---: | --- | --- |');
  for (const s of r.after_clock.scheduled) p('| `' + s.field + '` | ' + s.meaning + ' | ' + s.records + ' | ' + Object.entries(s.by_month).map(([m, n]) => m + ': ' + n).join(', ') + ' | ' + s.dates.join(', ') + ' |');
  p('');
  p('## Not counted');
  p('');
  for (const n of r.not_counted) p('- `' + n.field + '`: ' + n.reason + '.');
  p('');
  p('## Provenance');
  p('');
  p('| Source ID | Kind | Method | Tool | Seed |');
  p('| --- | --- | --- | --- | --- |');
  for (const s of r.provenance.sources) p('| `' + s.source_id + '` | ' + s.kind + ' | ' + s.method + ' | `' + s.tool + '` | ' + (s.seed === null ? 'none (' + s.seed_note + ')' : s.seed) + ' |');
  p('');
  p('What each source wrote is described in `contribution/dataset.json`. The fixture does not store a per-record source tag; the "Generated by" column above lists the sources that wrote records of each family.');
  p('');
  p('## Files');
  p('');
  p('| File | SHA-256 |');
  p('| --- | --- |');
  for (const [f, h] of Object.entries(r.files)) p('| `' + f + '` | `' + h.slice(7) + '` |');
  p('');
  p('Every date and its record count and sources are in `report.json` (`dates`). `node scripts/coverage-report.cjs --check` compares this report with the fixture; `--query` loads the fixture in the public runtime and reads the families back through the App\'s tools (`query.json`).');
  return L.join('\n') + '\n';
}

// Loading and retrieval: a fresh run of the public runtime loads the package seed; every counted family
// is read back through the Agent's tools (activity, which has no Agent read, through Infra env.snapshot).
async function query() {
  const locate = require('./locate.cjs');
  const runtime = locate.runtimeDir();
  const {prepare} = require(path.join(runtime, 'prepare.cjs')), {Client} = require(path.join(runtime, 'client.cjs'));
  const prepared = prepare(root), clients = [];
  const open = async role => { const c = new Client('fernshelf', role, 'coverage', path.join(prepared.root, 'state'), 'fernshelf-coverage', {registry: prepared.registry}); clients.push(c); await c.initialize(); return c; };
  const data = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/reference.json'), 'utf8'));
  try {
    const infra = await open('infra');
    let s = await infra.call('env.snapshot');
    await infra.call('env.reset', {expected_version: s.version, profile: 'scenario'});
    s = await infra.call('env.snapshot');
    const loaded = JSON.stringify(s.snapshot.data) === JSON.stringify(data);
    const agent = await open('agent');
    const rows = [];
    const add = (source, tool, call, got, expected) => rows.push({source, tool, sample_call: call, returned: got, fixture: expected, match: got === expected});
    // items: every state, stacks expanded, all pages.
    let items = 0;
    for (const state of ['active', 'trashed', 'purged']) {
      let cursor;
      do { const r = await agent.call('fernshelf.items.search', {state, collapse_stacks: false, limit: 200, ...(cursor ? {cursor} : {})}); items += r.rows.length; cursor = r.next_cursor; } while (cursor);
    }
    add('items', 'fernshelf.items.search', {state: 'active|trashed|purged', collapse_stacks: false, limit: 200}, items, data.items.length);
    let history = 0, stacks = new Set();
    for (const i of data.items) { const r = await agent.call('fernshelf.items.get', {id: i.id}); history += r.item.history.length; if (r.item.stack) stacks.add(r.item.stack.id); }
    add('item_history', 'fernshelf.items.get', {id: data.items[0].id}, history, data.items.reduce((n, i) => n + i.history.length, 0));
    add('stacks', 'fernshelf.items.get (stack)', {id: data.stacks[0].cover_id}, stacks.size, data.stacks.length);
    const list = await agent.call('fernshelf.albums.list', {include_deleted: true});
    add('albums', 'fernshelf.albums.list', {include_deleted: true}, list.albums.length, data.albums.length);
    let members = 0, contributions = 0, links = 0; const views = new Set();
    for (const a of list.albums) {
      const g = (await agent.call('fernshelf.albums.get', {id: a.id})).album;
      members += g.members.length; contributions += g.contributions.length; links += g.links.length;
      for (const l of g.links) for (const v of l.views) views.add(v.view_id);
      for (const v of g.member_views || []) views.add(v.view_id);
    }
    add('album_members', 'fernshelf.albums.get', {id: 'al-reunion-2026'}, members, data.albums.reduce((n, a) => n + a.members.length, 0));
    add('contributions', 'fernshelf.albums.get', {id: 'al-reunion-2026'}, contributions, data.albums.reduce((n, a) => n + a.contributions.length, 0));
    add('links', 'fernshelf.albums.get', {id: 'al-reunion-2026'}, links, data.links.length);
    add('views', 'fernshelf.albums.get (links[].views, member_views)', {id: 'al-reunion-2026'}, views.size, data.views.length);
    add('removals', 'fernshelf.removals.list', {}, (await agent.call('fernshelf.removals.list', {})).removals.length, data.removals.length);
    add('notifications', 'fernshelf.notifications.list', {}, (await agent.call('fernshelf.notifications.list', {})).notifications.length, data.notifications.length);
    const window = await agent.call('fernshelf.notifications.list', {start: '2025-06-01', end: '2025-06-30'});
    add('activity', 'env.snapshot (Infra; the activity log has no Agent read)', {}, (await infra.call('env.snapshot')).snapshot.data.activity.length, data.activity.length);
    return {schema: 'fernshelf.coverage-query.v1', runtime_version: JSON.parse(fs.readFileSync(path.join(runtime, 'package.json'), 'utf8')).version,
      run: 'coverage', profile: 'scenario (the ten reads)', seed_loaded_unchanged: loaded, virtual_now: s.snapshot.virtual_now, version: s.version,
      families: rows, sample_window: {call: {tool: 'fernshelf.notifications.list', start: '2025-06-01', end: '2025-06-30'}, returned: window.notifications.map(n => ({at: n.at, kind: n.kind, title: n.title}))},
      passed: loaded && rows.every(r => r.match)};
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}

module.exports = {build, markdown};
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--query')) {
    query().then(r => {
      fs.mkdirSync(OUT, {recursive: true});
      fs.writeFileSync(path.join(OUT, 'query.json'), JSON.stringify(r, null, 2) + '\n');
      for (const f of r.families) console.log((f.match ? 'ok   ' : 'FAIL ') + f.source + ': ' + f.tool + ' returned ' + f.returned + ' of ' + f.fixture);
      console.log((r.passed ? 'PASS' : 'FAIL') + ': every counted family is retrievable; wrote ' + rel(path.join(OUT, 'query.json')));
      if (!r.passed) process.exitCode = 1;
    }).catch(e => { console.error(e); process.exitCode = 1; });
  } else {
    const r = build(), json = JSON.stringify(r, null, 2) + '\n', md = markdown(r);
    const files = [[path.join(OUT, 'report.json'), json], [path.join(OUT, 'report.md'), md]];
    if (args.includes('--check')) {
      const drift = files.filter(([f, text]) => !fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== text).map(([f]) => rel(f));
      if (drift.length) { console.error('Coverage report differs from the fixture: ' + drift.join(', ') + '. Run node scripts/coverage-report.cjs'); process.exitCode = 1; }
      else console.log('Coverage report matches the fixture: ' + r.totals.counted + ' records, ' + r.totals.global_distinct_dates + ' distinct dates.');
    } else {
      fs.mkdirSync(OUT, {recursive: true});
      for (const [f, text] of files) fs.writeFileSync(f, text);
      console.log('Wrote ' + files.map(([f]) => rel(f)).join(', ') + ': ' + r.totals.counted + ' records, ' + r.totals.global_distinct_dates + ' distinct dates, ' +
        r.totals.months_with_records + ' of 24 months.');
    }
  }
}
