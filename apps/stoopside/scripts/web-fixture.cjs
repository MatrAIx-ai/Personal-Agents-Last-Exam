#!/usr/bin/env node
'use strict';
// Starts the shared business Web Host on another fixture at that fixture's own
// clock. The Host always creates a new run from the manifest seed (Maple St),
// so this script then loads the chosen fixture through Infra's env.load_seed,
// with its binding and its clock, before printing the access link.
//   node apps/stoopside/scripts/web-fixture.cjs     (or npm run web:hillcrest)
// Hillcrest's registry, web.hillcrest.registry.json, starts the run at the
// fixture clock, 2026-11-18 09:00 PST, which lies inside the 2025-01-01 to
// 2026-12-31 coverage window. Other fixtures load the same way through Infra.
// Run state goes to a temporary directory and is removed on exit.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const app = path.resolve(__dirname, '..');
const root = path.resolve(app, '../..');
const read = file => JSON.parse(fs.readFileSync(path.join(app, file), 'utf8'));

async function startFixture({key = 'hillcrest', stateDir, run = 'web-' + key, profile = 'sandbox'} = {}) {
  const {start} = require(path.join(root, 'runtime/web/server.cjs'));
  const {Client} = require(path.join(root, 'runtime/client.cjs'));
  const entry = read('fixtures/index.json').fixtures.find(f => f.key === key);
  if (!entry) throw new Error('Unknown fixture ' + key);
  // The registry clock must not be later than the fixture clock (time only moves forward).
  const registry = {'hillcrest': 'web.hillcrest.registry.json', 'maple-street': 'web.registry.json'}[key];
  if (!registry) throw new Error('A Web Host registry is shipped for hillcrest and maple-street only.');
  const host = await start({app: 'stoopside', registry: path.join(app, registry), stateDir, run, profile});
  if (key === 'maple-street') return {host, entry};
  const infra = new Client('stoopside', 'infra', host.run, stateDir, 'stoopside-web-fixture', {registry: host.registry});
  try {
    await infra.initialize();
    const data = read(entry.seed);
    const dataset = read('contribution/dataset.json');
    dataset.record_source_ids = [key];
    dataset.expected_counts = {records: data.events.length, assets: 0};
    const s = await infra.call('env.snapshot');
    const loaded = await infra.call('env.load_seed', {expected_version: s.version, request_id: 'web-load-' + key, data, binding: read(entry.binding),
      policies: read('fixtures/policies.json'), bundle: {dataset, catalog: read('contribution/assets.catalog.json'), blobs: {}}, virtual_now: entry.clock});
    if (loaded.status !== 'ready') throw new Error('env.load_seed: ' + JSON.stringify(loaded));
  } finally { await infra.close(); }
  return {host, entry};
}

module.exports = {startFixture};
if (require.main === module) {
  const key = process.argv[2] || 'hillcrest';
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stoopside-web-' + key + '-'));
  startFixture({key, stateDir}).then(({host, entry}) => {
    console.log(`Open ${host.accessUrl}`);
    console.log(`Fixture ${key} (${entry.seed}) at its clock ${entry.clock}; run ${host.run}. Business interface only; management remains separate MCP.`);
    const stop = () => host.close().finally(() => { fs.rmSync(stateDir, {recursive: true, force: true}); process.exit(0); });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
  }).catch(e => { console.error(e.stack || e.message); fs.rmSync(stateDir, {recursive: true, force: true}); process.exitCode = 1; });
}
