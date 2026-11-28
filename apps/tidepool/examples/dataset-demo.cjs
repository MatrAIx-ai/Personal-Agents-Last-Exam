#!/usr/bin/env node
'use strict';
// Loads the evaluation dataset (data/evaluation/) through the public runtime over real MCP and
// queries it as Priya at three clocks: early in 2025 (her Individual plan), at the dataset clock and at
// the end of 2026. Shows that the counted records are available through Tidepool's tools, that nothing
// dated after the clock is visible, and that advancing time changes no record. Prints a JSON report.
// Usage, from the repository root: node apps/tidepool/examples/dataset-demo.cjs
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
const plugin = require(path.join(pkg, 'plugin.cjs'));
const dir = path.join(pkg, 'data/evaluation');
const read = file => fs.readFileSync(path.join(dir, file), 'utf8');

async function main() {
  const seedText = read('seed.json'), seed = JSON.parse(seedText), meta = JSON.parse(read('dataset.json'));
  const binding = JSON.parse(read('binding.json')), policies = JSON.parse(read('policies.json')), clock = JSON.parse(read('clock.json')).initial_time;
  const prepared = prepare(pkg);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tidepool-dataset-'));
  const checks = [], stages = [], clients = [], id = 'mem-priya';
  const ok = (label, condition) => {assert.ok(condition, label); checks.push(label);};
  const open = async role => {const c = new Client('tidepool', role, 'dataset', temp, 'tidepool-dataset-demo', {registry: prepared.registry}); clients.push(c); await c.initialize(); return c;};
  try {
    const infra = await open('infra');
    const empty = await infra.call('env.snapshot');
    // The dataset ships its own dataset.json; it replaces the package's in the load bundle.
    const bundle = {...structuredClone(empty.snapshot.resources.bundle), dataset: meta};
    ok('The bundle carries the dataset\'s own dataset.json with the matching record count (' + meta.expected_counts.records + ')',
      meta.expected_counts.records === plugin.records(seed).length);
    ok('dataset.json records the seed\'s sha256', meta.sources.find(x => x.source_id === 'generated').generation.parameters.outputs['seed.json'].sha256 ===
      crypto.createHash('sha256').update(seedText).digest('hex'));
    const request = {expected_version: empty.version, request_id: 'load-evaluation', data: seed, binding, policies, bundle, virtual_now: '2025-03-15T12:00:00-07:00'};
    const requestBytes = Buffer.byteLength(JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'env.load_seed', arguments: request}}));
    const loaded = await infra.call('env.load_seed', request);
    const bundled = (await infra.call('env.snapshot')).snapshot.resources.bundle.dataset;
    ok('env.load_seed accepts the whole dataset in one request (' + requestBytes + ' bytes, under the 2 MiB line limit)', loaded.status === 'ready' && requestBytes < 2 * 1024 * 1024);
    const agent = await open('agent');
    const storedData = (await infra.call('env.snapshot')).snapshot.data, stored = JSON.stringify(storedData);
    ok('Core stores every delivered record', stored === JSON.stringify(seed));
    ok('Core keeps the dataset\'s own dataset.json in the bundle', JSON.stringify(bundled) === JSON.stringify(meta));

    async function look(label, at) {
      const now = Date.parse(at), shown = list => list.filter(x => Date.parse(x) <= now).length;
      const family = await agent.call('tidepool.family.get', {});
      let episodes = 0;
      const byShow = {};
      for (const show of seed.shows) {
        const r = await agent.call('tidepool.shows.get_episodes', {show_id: show.show_id, limit: 1});
        byShow[show.title] = {visible: r.total, newest: r.episodes[0] ? {episode_id: r.episodes[0].episode_id, title: r.episodes[0].title, published_at: r.episodes[0].published_at} : null};
        episodes += r.total;
        ok(label + ': ' + show.title + ' shows only episodes published by ' + at,
          r.total === shown(seed.episodes.filter(e => e.show_id === show.show_id).map(e => e.published_at)) && (!r.episodes[0] || Date.parse(r.episodes[0].published_at) <= now));
      }
      const next = seed.episodes.filter(e => Date.parse(e.published_at) > now).sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at))[0];
      if (next) ok(label + ': the next episode (' + next.episode_id + ') is not_found until its time', (await agent.call('tidepool.catalog.get_item', {item_id: next.episode_id})).status === 'not_found');
      // Albums exist from the start of their release day in the billing anchor's offset (-08:00 here).
      let albums = 0;
      for (const album of seed.albums) {
        const found = (await agent.call('tidepool.catalog.get_item', {item_id: album.album_id})).status !== 'not_found';
        ok(label + ': ' + album.album_id + (found ? ' is visible' : ' is not_found') + ' (released ' + album.released + ')',
          found === Date.parse(album.released + 'T00:00:00-08:00') <= now);
        albums += found ? 1 : 0;
      }
      const history = await agent.call('tidepool.history.list', {id, limit: 1});
      ok(label + ': history counts only sessions recorded by the clock', history.total === shown(seed.sessions.filter(s => s.member_id === id).map(s => s.ended_at)));
      const byYear = {};
      for (const year of ['2025', '2026']) {
        byYear[year] = (await agent.call('tidepool.history.list', {id, since: year + '-01-01T00:00:00-08:00', until: year + '-12-31T23:59:59-08:00', limit: 1})).total;
      }
      const notices = (await agent.call('tidepool.notifications.list', {id, limit: 200})).notifications;
      ok(label + ': notifications are dated at or before the clock', notices.every(n => Date.parse(n.created_at) <= now));
      const devices = (await agent.call('tidepool.devices.list', {id})).devices;
      const sample = byShow['Kettle Theory'].newest && (await agent.call('tidepool.catalog.get_item', {item_id: byShow['Kettle Theory'].newest.episode_id})).item;
      const last = history.sessions[0];
      stages.push({label, clock: at, plan: family.plan.plan_id, members: family.members.map(m => m.display_name), invoice: family.billing.current_invoice,
        visible_episodes: episodes, visible_albums: albums, episodes_by_show: byShow, priya_sessions: history.total, priya_sessions_by_year: byYear, notifications: notices.length,
        devices: devices.map(d => ({device_id: d.device_id, last_checkin_at: d.last_checkin_at})),
        latest_session: last ? {session_id: last.session_id, device: last.device_name, title: last.title, show: last.context_title, started_at: last.started_at, end_reason: last.end_reason} : null,
        sample_episode: sample ? {episode_id: sample.episode_id, title: sample.title, published_at: sample.published_at, notes: sample.notes} : null});
      return {family, episodes};
    }
    async function advance(to) {
      const before = await infra.call('env.snapshot');
      const r = await infra.call('env.advance_time', {expected_version: before.version, virtual_now: to, request_id: 'advance-' + to});
      ok('env.advance_time to ' + to + ' commits', r.status === 'committed');
      ok('Advancing to ' + to + ' changes no record', JSON.stringify((await infra.call('env.snapshot')).snapshot.data) === stored);
    }
    const early = await look('Early 2025', '2025-03-15T12:00:00-07:00');
    ok('In March 2025 Priya is on the Individual plan on her own', early.family.plan.plan_id === 'individual' && early.family.members.length === 1);
    await advance(clock);
    const atClock = await look('Dataset clock', clock);
    ok('At the dataset clock the family is on Family with four members', atClock.family.plan.plan_id === 'family' && atClock.family.members.length === 4);
    const upnext = await agent.call('tidepool.upnext.get', {id});
    const fixture = JSON.parse(fs.readFileSync(path.join(pkg, 'fixtures/minimal.json'), 'utf8'));
    ok('At the dataset clock Priya\'s Up Next is the fixture\'s', JSON.stringify(upnext.entries.map(e => e.episode_id)) === JSON.stringify(fixture.upnext[0].episode_ids));
    await advance('2026-12-31T23:59:00-08:00');
    const end = await look('End of 2026', '2026-12-31T23:59:00-08:00');
    ok('By the end of 2026 every episode is visible', end.episodes === seed.episodes.length);
    ok('No session is recorded after the dataset clock', stages[2].priya_sessions === stages[1].priya_sessions);

    // An Agent write at an earlier clock that drops later family records reports them (README, clock cutoff):
    // the #216 review's repro, through Core with the write-enabled task policy.
    const AT = '2026-04-01T12:00:00-07:00', writes = JSON.parse(fs.readFileSync(path.join(pkg, 'examples/task-data/policies.json'), 'utf8'));
    const version = async () => (await infra.call('env.snapshot')).version;
    await infra.call('env.load_seed', {expected_version: await version(), request_id: 'load-early-write', data: seed, binding, policies: writes, bundle, virtual_now: AT});
    const albums = seed.albums.filter(a => Date.parse(a.released + 'T12:00:00Z') <= Date.parse(AT)).map(a => a.album_id).slice(0, 9);
    const receipts = [];
    let args;
    for (const [i, item_id] of albums.entries()) {
      args = {id, device_id: 'dev-priya-phone', item_type: 'album', item_id, expected_version: await version(), request_id: 'early-download-' + (i + 1)};
      receipts.push(await agent.call('tidepool.downloads.add', args));
    }
    const last = receipts.at(-1), counts = last.later_history_removed || {};
    ok('At 2026-04-01 the first eight album downloads commit and report no later history',
      receipts.slice(0, 8).every(r => r.status === 'committed' && r.later_history_removed === null));
    ok('The ninth (' + albums[8] + ') commits and its receipt counts the later family records it dropped (143 sessions, 4 playlists, 8 payments)',
      last.status === 'committed' && counts.sessions === 143 && counts.playlists === 4 && counts['billing.payments'] === 8);
    const snap = (await infra.call('env.snapshot')).snapshot, row = snap.data.activity.at(-1), kept = row.later_history_removed || {};
    const storedAs = (family, x) => (family.startsWith('billing.') ? seed.billing[family.slice(8)] : seed[family]).some(y => JSON.stringify(y) === JSON.stringify(x));
    ok('Its activity row in env.snapshot holds exactly those records, each as the loaded seed stored it', row.request_id === 'early-download-9'
      && JSON.stringify(Object.fromEntries(Object.entries(kept).map(([k, v]) => [k, v.length]))) === JSON.stringify(counts)
      && Object.entries(kept).every(([family, list]) => list.every(x => storedAs(family, x))));
    const again = await agent.call('tidepool.downloads.add', args);
    ok('An identical retry returns the stored receipt, marked duplicate, with the same counts',
      again.duplicate === true && JSON.stringify(again.later_history_removed) === JSON.stringify(counts));
    stages.push({label: 'Early write', clock: AT, request_id: args.request_id, item_id: albums[8], later_history_removed: counts});
    return {
      app_id: 'tidepool', package_sha256: digestTree(pkg), node: process.version,
      dataset: {path: 'apps/tidepool/data/evaluation/seed.json', version: meta.version, sha256: crypto.createHash('sha256').update(seedText).digest('hex'),
        records: meta.expected_counts.records, episodes: seed.episodes.length, sessions: seed.sessions.length, clock},
      load_request_bytes: requestBytes, stages, checks: {count: checks.length, passed: checks},
    };
  } finally {
    for (const c of clients) await c.close().catch(() => {});
    fs.rmSync(temp, {recursive: true, force: true});
  }
}
main().then(r => process.stdout.write(JSON.stringify(r, null, 2) + '\n'), e => {console.error(e); process.exit(1);});
