#!/usr/bin/env node
'use strict';
// Loads the evaluation dataset (data/evaluation/) through the public runtime over real MCP and
// queries it at three clocks: early in 2025, at the dataset clock and at the end of 2026. Shows that
// the counted records are available through Wirewalk's tools, that nothing dated after the clock is
// visible, and that advancing time changes no record. Prints a JSON report.
// Usage, from the repository root: node apps/wirewalk/examples/dataset-demo.cjs
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
const EARLY = '2025-03-15T12:00:00-07:00', END = '2026-12-31T23:59:00-08:00';

async function main() {
  const seedText = read('seed.json'), seed = JSON.parse(seedText);
  const binding = JSON.parse(read('binding.json')), clock = JSON.parse(read('clock.json')).initial_time;
  const dataset = JSON.parse(read('dataset.json')); // passed unchanged as the bundle's dataset
  const catalog = JSON.parse(read('assets.catalog.json'));
  const policies = JSON.parse(fs.readFileSync(path.join(pkg, 'examples/task-data/policies.json'), 'utf8'));
  const prepared = prepare(pkg);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wirewalk-dataset-'));
  const checks = [], stages = [], clients = [];
  const ok = (label, condition) => {assert.ok(condition, label); checks.push(label);};
  const open = async role => {const c = new Client('wirewalk', role, 'dataset', temp, 'wirewalk-dataset-demo', {registry: prepared.registry}); clients.push(c); await c.initialize(); return c;};
  try {
    const infra = await open('infra');
    const empty = await infra.call('env.snapshot');
    // The dataset's own provenance and catalog; the image bytes come from the package bundle.
    const bundle = {dataset, catalog, blobs: empty.snapshot.resources.bundle.blobs};
    const request = {expected_version: empty.version, request_id: 'load-evaluation', data: seed, binding, policies, bundle, virtual_now: EARLY};
    const requestBytes = Buffer.byteLength(JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'env.load_seed', arguments: request}}));
    const loaded = await infra.call('env.load_seed', request);
    ok('env.load_seed accepts the whole dataset in one request (' + requestBytes + ' bytes, under the 2 MiB line limit)', loaded.status === 'ready' && requestBytes < 2 * 1024 * 1024);
    ok('The bundle declares as many records as the seed has posts (' + seed.posts.length + ')', dataset.expected_counts.records === seed.posts.length);
    const agent = await open('agent');
    const stored = JSON.stringify((await infra.call('env.snapshot')).snapshot.data);
    const data = JSON.parse(stored);
    ok('Core stores every delivered record', data.posts.length === seed.posts.length && data.accounts.length === seed.accounts.length && data.bookmarks.length === seed.bookmarks.length);

    async function look(label, at) {
      const now = Date.parse(at);
      const feed = await agent.call('wirewalk.feed.list', {limit: 5});
      const visible = seed.posts.filter(p => Date.parse(p.published_at) <= now);
      ok(label + ': the feed total equals the posts published by ' + at, feed.total === visible.length);
      ok(label + ': the newest visible post was published before the clock', feed.posts.every(p => Date.parse(p.published_at) <= now));
      const next = seed.posts.filter(p => Date.parse(p.published_at) > now).sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at))[0];
      if (next) ok(label + ': the next post (' + next.id + ') is not_found until its time', (await agent.call('wirewalk.post.get', {id: next.id})).status === 'not_found');
      const marks = (await agent.call('wirewalk.bookmarks.list')).bookmarks;
      ok(label + ': bookmarks show only those saved at or before the clock',
        marks.length === seed.bookmarks.filter(b => Date.parse(b.saved_at) <= now).length && marks.every(b => Date.parse(b.saved_at) <= now));
      const recovery = await agent.call('wirewalk.account.get', {id: 'cinder-fork-recovery'});
      ok(label + ': the recovery center account (joined Oct. 14, 2026) is ' + (now >= Date.parse('2026-10-14T08:00:00-07:00') ? 'visible' : 'not_found'),
        now >= Date.parse('2026-10-14T08:00:00-07:00') ? recovery.account?.id === 'cinder-fork-recovery' : recovery.status === 'not_found');
      const byYear = {};
      for (const year of ['2025', '2026']) {
        const r = await agent.call('wirewalk.search', {query: 'Green Line', since: year + '-01-01T00:00:00-08:00', until: year + '-12-31T23:59:59-08:00', limit: 2});
        byYear[year] = {total: r.total, newest: r.posts.map(p => ({id: p.id, author: p.author.id, published_at: p.published_at, text: p.text}))};
      }
      stages.push({label, clock: at, visible_posts: feed.total, bookmarks: marks.length,
        latest_bookmark: marks[0] ? {post_id: marks[0].post.id, saved_at: marks[0].saved_at} : null,
        feed_top: feed.posts.map(p => ({id: p.id, author: p.author.id, kind: p.kind, published_at: p.published_at, text: p.text})), search_green_line_by_year: byYear});
    }
    async function advance(to) {
      const before = await infra.call('env.snapshot');
      const r = await infra.call('env.advance_time', {expected_version: before.version, virtual_now: to, request_id: 'advance-' + to});
      ok('env.advance_time to ' + to + ' commits', r.status === 'committed');
      const after = await infra.call('env.snapshot');
      ok('Advancing to ' + to + ' changes no record', JSON.stringify(after.snapshot.data) === stored);
    }
    await look('Early 2025', EARLY);
    await advance(clock);
    await look('Dataset clock', clock);
    ok('At the dataset clock the feed opens on the fixture\'s Saturday evening (p18 first)', stages[1].feed_top[0].id === 'p18');
    ok('At the dataset clock the latest bookmark is the fixture\'s p01', stages[1].latest_bookmark?.post_id === 'p01');
    await advance(END);
    await look('End of 2026', END);
    ok('By the end of 2026 every post is visible', stages[2].visible_posts === seed.posts.length);

    // An Agent bookmark at an earlier clock that replaces a seeded later one reports it (README, clock cutoff),
    // through Core with the task policy, which allows bookmarks.add.
    const AT = '2026-02-09T12:00:00-08:00', version = async () => (await infra.call('env.snapshot')).version;
    await infra.call('env.load_seed', {expected_version: await version(), request_id: 'load-early-write', data: seed, binding, policies, bundle, virtual_now: AT});
    const args = {id: 'w260209-4', expected_version: await version(), request_id: 'early-bookmark'};
    const added = await agent.call('wirewalk.bookmarks.add', args);
    ok('At noon on Feb. 9, 2026, bookmarking w260209-4 commits and its receipt counts the seeded 16:47 bookmark it replaced',
      added.status === 'committed' && JSON.stringify(added.later_history_removed) === JSON.stringify({bookmarks: 1}));
    const snap = (await infra.call('env.snapshot')).snapshot, mine = b => b.post_id === 'w260209-4';
    ok('The stored bookmark is now dated noon, and the replaced 16:47 bookmark is still in the loaded seed (initial_data)',
      JSON.stringify(snap.data.bookmarks.filter(mine)) === JSON.stringify([{post_id: 'w260209-4', saved_at: AT}])
      && snap.initial_data.bookmarks.filter(mine).map(b => b.saved_at).join() === '2026-02-09T16:47:00-08:00');
    const again = await agent.call('wirewalk.bookmarks.add', args);
    ok('An identical retry returns the stored receipt, marked duplicate, with the same count',
      again.duplicate === true && JSON.stringify(again.later_history_removed) === JSON.stringify(added.later_history_removed));
    stages.push({label: 'Early write', clock: AT, request_id: args.request_id, post_id: args.id, later_history_removed: added.later_history_removed});
    return {
      app_id: 'wirewalk', package_sha256: digestTree(pkg), node: process.version,
      dataset: {path: 'apps/wirewalk/data/evaluation/seed.json', sha256: crypto.createHash('sha256').update(seedText).digest('hex'), version: dataset.version,
        accounts: seed.accounts.length, posts: seed.posts.length, bookmarks: seed.bookmarks.length, clock},
      load_request_bytes: requestBytes, stages, checks: {count: checks.length, passed: checks},
    };
  } finally {
    for (const c of clients) await c.close().catch(() => {});
    fs.rmSync(temp, {recursive: true, force: true});
  }
}
main().then(r => process.stdout.write(JSON.stringify(r, null, 2) + '\n'), e => {console.error(e); process.exit(1);});
