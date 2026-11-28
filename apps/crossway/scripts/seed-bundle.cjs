#!/usr/bin/env node
'use strict';
// Builds the env.load_seed arguments for one of the four seeds: its data,
// binding, clock and a provenance bundle. The bundle's dataset is
// contribution/dataset.json narrowed to that seed's source, with
// expected_counts for that seed, so Core's quality check sees the seed's own
// provenance instead of an unreviewed record import. Crossway has no assets,
// so the catalog is the package's empty one.
//   node scripts/seed-bundle.cjs marisol   prints {data, binding, virtual_now, bundle}
//   node scripts/seed-bundle.cjs marisol --load --run web-demo [--profile sandbox] [--state-dir DIR]
//     loads it through Infra MCP into that run of the Web Host's registry
//     (web-registry.json; state directory .state at the repository root by
//     default), then resets into the profile
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');

const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

function loadArgs(id) {
  const entry = read('fixtures/seeds/index.json').seeds.find(s => s.seed_id === id);
  if (!entry) throw Error(`Unknown seed ${id}; choose ${read('fixtures/seeds/index.json').seeds.map(s => s.seed_id).join(', ')}.`);
  const data = read(entry.seed), dataset = read('contribution/dataset.json');
  const source = dataset.sources.find(s => s.generation?.parameters?.seed_id === id);
  dataset.record_source_ids = [source.source_id];
  dataset.expected_counts = {records: plugin.records(data).length, assets: 0};
  return {data, binding: read(entry.binding), virtual_now: read(entry.clock).initial_time,
    bundle: {dataset, catalog: read('contribution/assets.catalog.json'), blobs: {}}};
}

module.exports = {loadArgs};

async function load(id, {run, profile = 'sandbox', stateDir}) {
  const repo = path.resolve(root, '../..');
  const {Client} = require(path.join(repo, 'runtime/client.cjs'));
  const infra = new Client('crossway', 'infra', run, path.resolve(stateDir || path.join(repo, '.state')), 'crossway-seed-loader', {registry: path.join(root, 'web-registry.json')});
  try {
    await infra.initialize();
    let snap = await infra.call('env.snapshot');
    const loaded = await infra.call('env.load_seed', {expected_version: snap.version, ...loadArgs(id), request_id: `load-${id}-${Date.now()}`});
    if (loaded.status !== 'ready') throw Error(JSON.stringify(loaded));
    snap = await infra.call('env.snapshot');
    const reset = await infra.call('env.reset', {expected_version: snap.version, profile});
    if (reset.status !== 'ready') throw Error(JSON.stringify(reset));
    console.log(`Loaded seed ${id} into run ${run} (profile ${profile}); refresh the page.`);
  } finally {
    await infra.close();
  }
}

if (require.main === module) {
  const [id = 'dani', ...rest] = process.argv.slice(2), flag = name => rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined;
  if (rest.includes('--load')) {
    if (!flag('--run')) throw Error('--load needs --run RUN');
    load(id, {run: flag('--run'), profile: flag('--profile'), stateDir: flag('--state-dir')}).catch(e => { console.error(e.message); process.exitCode = 1; });
  } else process.stdout.write(JSON.stringify(loadArgs(id), null, 2) + '\n');
}
