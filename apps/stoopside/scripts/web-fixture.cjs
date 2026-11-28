#!/usr/bin/env node
'use strict';
// Starts the shared business Web Host on a fixture at that fixture's own clock.
// The Host creates a new run from the manifest seed (Hillcrest) at the
// registry's initial_time; for Maple St this script then loads the fixture
// through Infra's env.load_seed (scripts/load-fixture.cjs), with its binding
// and its clock, before printing the access link.
//   node apps/stoopside/scripts/web-fixture.cjs hillcrest      (npm run web:hillcrest)
//   node apps/stoopside/scripts/web-fixture.cjs maple-street   (npm run web)
// web.hillcrest.registry.json starts at 2026-11-18 09:00 PST, inside the
// 2025-01-01 to 2026-12-31 coverage window; web.registry.json starts at the
// Maple St clock, 2027-03-01 09:00 EST.
// Run state goes to a temporary directory and is removed on exit.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const app = path.resolve(__dirname, '..');
const root = path.resolve(app, '../..');
const {entryOf, loadFixture} = require('./load-fixture.cjs');
const MANIFEST = 'hillcrest';

async function startFixture({key = 'hillcrest', stateDir, run = 'web-' + key, profile = 'sandbox'} = {}) {
  const {start} = require(path.join(root, 'runtime/web/server.cjs'));
  const {Client} = require(path.join(root, 'runtime/client.cjs'));
  const entry = entryOf(key);
  const registry = {'hillcrest': 'web.hillcrest.registry.json', 'maple-street': 'web.registry.json'}[key];
  if (!registry) throw new Error('A Web Host registry is shipped for hillcrest and maple-street only.');
  const host = await start({app: 'stoopside', registry: path.join(app, registry), stateDir, run, profile});
  if (key === MANIFEST) return {host, entry};
  const infra = new Client('stoopside', 'infra', host.run, stateDir, 'stoopside-web-fixture', {registry: host.registry});
  try {
    await infra.initialize();
    await loadFixture(infra, key);
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
