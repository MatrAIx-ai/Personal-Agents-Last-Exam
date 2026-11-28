#!/usr/bin/env node
'use strict';
// Loads the evaluation dataset (data/evaluation/) through the public runtime over real MCP and
// queries it at three clocks: early in 2025, at the dataset clock and at the end of 2026. Shows
// that the counted records are available through Dayline's tools, that nothing dated after the
// clock is visible, and that advancing time changes no record. Prints a JSON report.
// Usage, from the repository root: node apps/dayline/examples/dataset-demo.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');

function runtimeRoot() {
  if (process.env.PALE_RUNTIME_ROOT) return path.resolve(process.env.PALE_RUNTIME_ROOT);
  let dir = __dirname;
  while (!fs.existsSync(path.join(dir, 'runtime/launch.cjs'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw Error('Run inside the public PALE checkout, or set PALE_RUNTIME_ROOT to its runtime directory.');
    dir = parent;
  }
  return path.join(dir, 'runtime');
}
const runtime = runtimeRoot();
const {prepare} = require(path.join(runtime, 'prepare.cjs'));
const {Client} = require(path.join(runtime, 'client.cjs'));
const {digestTree} = require(path.join(runtime, 'verify.cjs'));
const pkg = path.resolve(__dirname, '..');
const dir = path.join(pkg, 'data/evaluation');
const read = file => fs.readFileSync(path.join(dir, file), 'utf8');

async function main() {
  const seedText = read('seed.json'), seed = JSON.parse(seedText);
  const binding = JSON.parse(read('binding.json')), clock = JSON.parse(read('clock.json')).initial_time;
  const policies = JSON.parse(fs.readFileSync(path.join(pkg, 'examples/task-data/policies.json'), 'utf8'));
  const prepared = prepare(pkg);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dayline-dataset-'));
  const checks = [], stages = [], clients = [];
  const ok = (label, condition) => {assert.ok(condition, label); checks.push(label);};
  const open = async role => {const c = new Client('dayline', role, 'dataset', temp, 'dayline-dataset-demo', {registry: prepared.registry}); clients.push(c); await c.initialize(); return c;};
  try {
    const infra = await open('infra');
    const empty = await infra.call('env.snapshot');
    // The dataset ships its own dataset.json; it replaces the package's in the load bundle.
    const bundle = {...structuredClone(empty.snapshot.resources.bundle), dataset: JSON.parse(read('dataset.json'))};
    ok('The bundle carries the dataset\'s own dataset.json with the matching record count', bundle.dataset.expected_counts.records === seed.editions.length);
    const request = {expected_version: empty.version, request_id: 'load-evaluation', data: seed, binding, policies, bundle, virtual_now: '2025-03-15T12:00:00-07:00'};
    const requestBytes = Buffer.byteLength(JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'env.load_seed', arguments: request}}));
    const loaded = await infra.call('env.load_seed', request);
    ok('env.load_seed accepts the whole dataset in one request (' + requestBytes + ' bytes, under the 2 MiB line limit)', loaded.status === 'ready' && requestBytes < 2 * 1024 * 1024);
    const agent = await open('agent');
    const stored = JSON.stringify((await infra.call('env.snapshot')).snapshot.data);
    ok('Core stores every delivered record', JSON.parse(stored).editions.length === seed.editions.length && JSON.parse(stored).reading_history.length === seed.reading_history.length);

    async function look(label, at) {
      const now = Date.parse(at);
      const all = await agent.call('dayline.search', {limit: 50});
      const visible = seed.editions.filter(e => Date.parse(e.added_at) <= now);
      ok(label + ': search total equals the editions added by ' + at, all.total === visible.length);
      const newest = all.editions[0] && (await agent.call('dayline.edition.get', {edition_id: all.editions[0].edition_id})).edition;
      ok(label + ': the newest visible edition was added before the clock', !newest || Date.parse(newest.added_at) <= now);
      const next = seed.editions.filter(e => Date.parse(e.added_at) > now).sort((a, b) => Date.parse(a.added_at) - Date.parse(b.added_at))[0];
      if (next) ok(label + ': the next edition (' + next.edition_id + ') is not_found until its time', (await agent.call('dayline.edition.get', {edition_id: next.edition_id})).status === 'not_found');
      const history = (await agent.call('dayline.history.list', {limit: 200})).entries;
      ok(label + ': history shows only reads at or before the clock', history.every(h => Date.parse(h.read_at) <= now));
      const byYear = {};
      for (const year of ['2025', '2026']) {
        const r = await agent.call('dayline.search', {published_after: year + '-01-01T00:00:00-08:00', published_before: year + '-12-31T23:59:59-08:00', limit: 3});
        byYear[year] = {total: r.total, newest: r.editions.map(e => ({edition_id: e.edition_id, outlet: e.outlet_name, published_at: e.published_at, headline: e.headline}))};
      }
      const local = (await agent.call('dayline.front_page.get', {front_page_id: 'local'})).entries.map(e => e.edition_id);
      stages.push({label, clock: at, visible_editions: all.total, history_entries: history.length,
        latest_read: history[0] ? {edition_id: history[0].edition.edition_id, read_at: history[0].read_at} : null,
        local_front_page: local, search_by_year: byYear,
        sample: newest ? {edition_id: newest.edition_id, outlet: newest.outlet_name, published_at: newest.published_at, headline: newest.headline, text: newest.text} : null});
    }
    async function advance(to) {
      const before = await infra.call('env.snapshot');
      const r = await infra.call('env.advance_time', {expected_version: before.version, virtual_now: to, request_id: 'advance-' + to});
      ok('env.advance_time to ' + to + ' commits', r.status === 'committed');
      const after = await infra.call('env.snapshot');
      ok('Advancing to ' + to + ' changes no record', JSON.stringify(after.snapshot.data) === stored);
    }
    await look('Early 2025', '2025-03-15T12:00:00-07:00');
    await advance(clock);
    await look('Dataset clock', clock);
    ok('At the dataset clock the local front page is the fixture\'s', JSON.stringify(stages[1].local_front_page) === JSON.stringify(seed.front_pages[0].entries));
    await advance('2026-12-31T23:59:00-08:00');
    await look('End of 2026', '2026-12-31T23:59:00-08:00');
    ok('By the end of 2026 every edition is visible', stages[2].visible_editions === seed.editions.length);

    // An Agent write at an earlier clock that replaces a seeded later read reports it (README, clock cutoff),
    // through Core with the task policy, which allows mark_read.
    const AT = '2025-02-05T12:00:00-08:00', version = async () => (await infra.call('env.snapshot')).version;
    await infra.call('env.load_seed', {expected_version: await version(), request_id: 'load-early-write', data: seed, binding, policies, bundle, virtual_now: AT});
    const args = {edition_id: 'biz-20250205', expected_version: await version(), request_id: 'early-mark-read'};
    const marked = await agent.call('dayline.history.mark_read', args);
    ok('At noon on Feb. 5, 2025, marking the business brief read commits and its receipt counts the seeded 22:58 read it replaced',
      marked.status === 'committed' && JSON.stringify(marked.later_history_removed) === JSON.stringify({reading_history: 1}));
    const snap = (await infra.call('env.snapshot')).snapshot, mine = h => h.edition_id === 'biz-20250205';
    ok('The stored read is now dated noon, and the replaced 22:58 read is still in the loaded seed (initial_data)',
      JSON.stringify(snap.data.reading_history.filter(mine)) === JSON.stringify([{edition_id: 'biz-20250205', read_at: AT}])
      && snap.initial_data.reading_history.filter(mine).map(h => h.read_at).join() === '2025-02-05T22:58:00-08:00');
    const again = await agent.call('dayline.history.mark_read', args);
    ok('An identical retry returns the stored receipt, marked duplicate, with the same count',
      again.duplicate === true && JSON.stringify(again.later_history_removed) === JSON.stringify(marked.later_history_removed));
    stages.push({label: 'Early write', clock: AT, request_id: args.request_id, edition_id: args.edition_id, later_history_removed: marked.later_history_removed});
    return {
      app_id: 'dayline', package_sha256: digestTree(pkg), node: process.version,
      dataset: {path: 'apps/dayline/data/evaluation/seed.json', sha256: crypto.createHash('sha256').update(seedText).digest('hex'),
        editions: seed.editions.length, reading_history: seed.reading_history.length, reading_list: seed.reading_list.length, clock},
      load_request_bytes: requestBytes, stages, checks: {count: checks.length, passed: checks},
    };
  } finally {
    for (const c of clients) await c.close().catch(() => {});
    fs.rmSync(temp, {recursive: true, force: true});
  }
}
main().then(r => process.stdout.write(JSON.stringify(r, null, 2) + '\n'), e => {console.error(e); process.exit(1);});
