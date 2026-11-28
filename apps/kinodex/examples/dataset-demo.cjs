#!/usr/bin/env node
'use strict';
// Loads the evaluation dataset (data/evaluation/) through the public runtime over real MCP, with its own
// dataset.json as the bundle dataset, and queries it at three clocks: March 2025, the dataset clock and
// the end of 2026. Shows that the counted records are available through Kinodex's tools, that nothing
// dated after the clock is visible, and that advancing time changes no record. Prints a JSON report.
// Usage, from the repository root: node apps/kinodex/examples/dataset-demo.cjs
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
  const binding = JSON.parse(read('binding.json')), policies = JSON.parse(read('policies.json')), dataset = JSON.parse(read('dataset.json'));
  const clock = JSON.parse(read('clock.json')).initial_time;
  const prepared = prepare(pkg);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kinodex-dataset-'));
  const checks = [], stages = [], clients = [];
  const ok = (label, condition) => {assert.ok(condition, label); checks.push(label);};
  const open = async role => {const c = new Client('kinodex', role, 'dataset', temp, 'kinodex-dataset-demo', {registry: prepared.registry}); clients.push(c); await c.initialize(); return c;};
  try {
    const infra = await open('infra');
    const empty = await infra.call('env.snapshot');
    const bundle = structuredClone(empty.snapshot.resources.bundle);
    bundle.dataset = dataset;
    ok('The bundle dataset is data/evaluation/dataset.json; its record count is the seed\'s titles (' + seed.titles.length + ')', bundle.dataset.expected_counts.records === seed.titles.length);
    const request = {expected_version: empty.version, request_id: 'load-evaluation', data: seed, binding, policies, bundle, virtual_now: EARLY};
    const requestBytes = Buffer.byteLength(JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'env.load_seed', arguments: request}}));
    const loaded = await infra.call('env.load_seed', request);
    ok('env.load_seed accepts the whole dataset in one request (' + requestBytes + ' bytes, under the 2 MiB line limit)', loaded.status === 'ready' && requestBytes < 2 * 1024 * 1024);
    const agent = await open('agent');
    const stored = JSON.stringify((await infra.call('env.snapshot')).snapshot.data), data = JSON.parse(stored);
    ok('Core stores every delivered record', ['diary', 'public_reviews', 'episodes', 'alerts', 'corrections', 'notices', 'lists', 'offers'].every(k => data[k].length === seed[k].length)
      && data.guides.reduce((n, g) => n + g.versions.length, 0) === seed.guides.reduce((n, g) => n + g.versions.length, 0));

    const seasons = seed.titles.flatMap(t => t.seasons.map(s => ({title_id: t.title_id, title_name: t.name, ...s})));
    const versions = seed.guides.flatMap(g => g.versions.slice(1).map(v => ({title_id: g.title_id, version: v.version, published_at: v.published_at})));
    const firstAfter = (list, field, now) => list.filter(x => Date.parse(x[field]) > now).sort((a, b) => Date.parse(a[field]) - Date.parse(b[field]))[0];
    async function look(label, at) {
      const now = Date.parse(at), shown = (list, field) => list.filter(x => Date.parse(x[field]) <= now);
      const diary = await agent.call('kinodex.diary.list', {limit: 500});
      ok(label + ': diary.list shows the ' + shown(seed.diary, 'logged_at').length + ' entries logged by the clock', diary.total === shown(seed.diary, 'logged_at').length && diary.entries.every(e => Date.parse(e.logged_at) <= now));
      const reviews = (await agent.call('kinodex.reviews.list', {source: 'public', limit: 200})).reviews;
      ok(label + ': reviews.list shows only public reviews posted by the clock', reviews.length === Math.min(200, shown(seed.public_reviews, 'posted_at').length) && reviews.every(r => Date.parse(r.posted_at) <= now));
      const notices = (await agent.call('kinodex.notices.list', {limit: 500})).notices;
      ok(label + ': notices.list shows the ' + shown(seed.notices, 'at').length + ' notices written by the clock', notices.length === shown(seed.notices, 'at').length);
      const alerts = (await agent.call('kinodex.alerts.list')).alerts, corrections = (await agent.call('kinodex.corrections.list')).corrections;
      ok(label + ': rules and corrections exist from their creation and show only the triggers and decisions dated by the clock',
        alerts.length === shown(seed.alerts, 'created_at').length && alerts.every(a => a.trigger === null || Date.parse(a.trigger.at) <= now)
        && corrections.length === shown(seed.corrections, 'submitted_at').length && corrections.every(x => x.decisions.every(d => Date.parse(d.decided_at) <= now)));
      const list = firstAfter(seed.lists, 'created_at', now), version = firstAfter(versions, 'published_at', now), season = firstAfter(seasons, 'added_at', now);
      if (list) ok(label + ': list ' + list.list_id + ' (created ' + list.created_at + ') is not_found until then', (await agent.call('kinodex.lists.get', {list_id: list.list_id})).status === 'not_found');
      if (version) ok(label + ': guide version ' + version.version + ' of ' + version.title_id + ' (published ' + version.published_at + ') is not_found until then',
        (await agent.call('kinodex.guide.get', {title_id: version.title_id, version: version.version})).status === 'not_found');
      if (season) ok(label + ': season ' + season.season_number + ' of ' + season.title_name + ' (added ' + season.added_at + ') is not_found until then',
        (await agent.call('kinodex.episodes.list', {title_id: season.title_id, season_number: season.season_number})).status === 'not_found');
      const byYear = {};
      for (const year of ['2025', '2026']) {
        const r = await agent.call('kinodex.diary.list', {from: year + '-01-01', to: year + '-12-31', limit: 3});
        byYear[year] = {total: r.total, latest: r.entries.map(e => ({entry_id: e.entry_id, title: e.title_name, watched_on: e.watched_on, rating: e.rating}))};
      }
      const sallowstead = (await agent.call('kinodex.titles.get', {title_id: 'tt-sallowstead-general'})).title;
      const count = (list, key) => list.reduce((acc, x) => ({...acc, [x[key]]: (acc[x[key]] || 0) + 1}), {});
      stages.push({label, clock: at, diary_entries: diary.total, diary_by_year: byYear, public_reviews_visible: shown(seed.public_reviews, 'posted_at').length,
        notices: notices.length, alerts_by_status: count(alerts, 'status'), corrections_by_status: count(corrections, 'status'),
        sallowstead_general_seasons: sallowstead.seasons.map(s => s.season_number),
        latest_public_review: reviews[0] ? {review_id: reviews[0].review_id, title: reviews[0].title_name, posted_at: reviews[0].posted_at, rating: reviews[0].rating, text: reviews[0].text_withheld ? null : reviews[0].text} : null,
        latest_notice: notices[0] ? {notice_id: notices[0].notice_id, at: notices[0].at, text: notices[0].text} : null});
    }
    async function advance(to) {
      const before = await infra.call('env.snapshot');
      const r = await infra.call('env.advance_time', {expected_version: before.version, virtual_now: to, request_id: 'advance-' + to});
      ok('env.advance_time to ' + to + ' commits', r.status === 'committed');
      ok('Advancing to ' + to + ' changes no record', JSON.stringify((await infra.call('env.snapshot')).snapshot.data) === stored);
    }
    await look('March 2025', EARLY);
    await advance(clock);
    await look('Dataset clock', clock);
    const leaving = (await agent.call('kinodex.offers.search', {title_ids: (await agent.call('kinodex.watchlist.get')).items.map(i => i.title_id), on_my_services: true}))
      .results.filter(x => x.my_subscriptions.status === 'leaving_soon').map(x => x.name);
    ok('At the dataset clock the watchlist titles leaving Dana\'s services are the fixture\'s (Fieldglass stays on Northcast): ' + leaving.join(', '),
      JSON.stringify(leaving.sort()) === JSON.stringify(['Copper Sky', 'Quiet Harbour']));
    await advance(END);
    await look('End of 2026', END);
    ok('By the end of 2026 every diary entry, public review and notice is visible', stages[2].diary_entries === seed.diary.length && stages[2].public_reviews_visible === seed.public_reviews.length && stages[2].notices === seed.notices.length);

    // A write or event at an earlier clock that replaces later history reports it (README, clock cutoff): two of
    // the #226 review's cases, through Core with the write-enabled task policy.
    const AT = '2026-09-01T12:00:00-07:00', writes = JSON.parse(fs.readFileSync(path.join(pkg, 'examples/task-data/policies.json'), 'utf8'));
    const version = async () => (await infra.call('env.snapshot')).version;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b), seeded = (list, key, id) => seed[list].find(x => x[key] === id);
    await infra.call('env.load_seed', {expected_version: await version(), request_id: 'load-early-write', data: seed, binding, policies: writes, bundle, virtual_now: AT});
    const args = {id: 'al-13', expected_version: await version(), request_id: 'early-delete-al-13'};
    const deleted = await agent.call('kinodex.alerts.delete', args);
    ok('At 2026-09-01, alerts.delete al-13 commits and its receipt counts the later trigger and notice it replaced',
      deleted.status === 'committed' && same(deleted.later_history_removed, {alerts: 1, notices: 1}));
    const row = (await infra.call('env.snapshot')).snapshot.data.activity.at(-1);
    ok('Its activity row in env.snapshot holds al-13 (triggered on Oct. 6) and nt-21 exactly as the seed stored them', row.request_id === args.request_id
      && same(row.later_history_removed, {alerts: [seeded('alerts', 'alert_id', 'al-13')], notices: [seeded('notices', 'notice_id', 'nt-21')]}));
    const again = await agent.call('kinodex.alerts.delete', args);
    ok('An identical retry returns the stored receipt, marked duplicate, with the same counts', again.duplicate === true && same(again.later_history_removed, deleted.later_history_removed));
    await infra.call('env.load_seed', {expected_version: await version(), request_id: 'load-early-event', data: seed, binding, policies: writes, bundle, virtual_now: AT});
    const event = {event_id: 'sallowmere-brightreel-early', at: '2026-09-02T10:00:00-07:00', operation: 'offer.publish', payload: {offer_id: 'of-early-sallowmere',
      title_id: 'tt-sallowmere', edition_id: null, service_id: 'brightreel', region: 'US', type: 'subscription', price: null, currency: null, quality: 'HD',
      available_from: '2026-09-02T00:00:00-07:00', available_until: null}};
    const applied = await infra.call('env.apply_event', {expected_version: await version(), event});
    const eventRow = (await infra.call('env.snapshot')).snapshot.data.activity.at(-1);
    ok('An offer.publish on Sept. 2 that fires al-13 early commits, and its activity row holds the Oct. 6 trigger and nt-21 as stored',
      applied.status === 'committed' && eventRow.event_id === event.event_id
      && same(eventRow.later_history_removed, {alerts: [seeded('alerts', 'alert_id', 'al-13')], notices: [seeded('notices', 'notice_id', 'nt-21')]}));
    stages.push({label: 'Early write and event', clock: AT, write: {request_id: args.request_id, later_history_removed: deleted.later_history_removed},
      event: {event_id: event.event_id, later_history_removed: Object.fromEntries(Object.entries(eventRow.later_history_removed).map(([k, v]) => [k, v.map(x => x[{alerts: 'alert_id', corrections: 'correction_id', notices: 'notice_id', diary: 'entry_id'}[k]])]))}});
    return {
      app_id: 'kinodex', package_sha256: digestTree(pkg), node: process.version,
      dataset: {path: 'apps/kinodex/data/evaluation/seed.json', dataset_id: dataset.dataset_id, version: dataset.version, sha256: crypto.createHash('sha256').update(seedText).digest('hex'),
        titles: seed.titles.length, diary: seed.diary.length, public_reviews: seed.public_reviews.length, notices: seed.notices.length, clock},
      load_request_bytes: requestBytes, stages, checks: {count: checks.length, passed: checks},
    };
  } finally {
    for (const c of clients) await c.close().catch(() => {});
    prepared.cleanup();
    fs.rmSync(temp, {recursive: true, force: true});
  }
}
main().then(r => process.stdout.write(JSON.stringify(r, null, 2) + '\n'), e => {console.error(e); process.exit(1);});
