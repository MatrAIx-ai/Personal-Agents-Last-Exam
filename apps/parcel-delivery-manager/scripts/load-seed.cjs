#!/usr/bin/env node
'use strict';
// Loads one catalog seed into a run through the Infra MCP connection, as a Task runner
// would with env.load_seed. Use it to look at a seed in the Web App or to drive it by MCP.
// Needs the public runtime (repository checkout or PALE_RUNTIME_ROOT).
//
//   node scripts/load-seed.cjs <seed-id> [--actor person-id] [--run NAME] [--state-dir DIR]
//                                        [--registry FILE] [--profile sandbox|scenario]
//
// --actor loads the same ledger for another person listed in the seed index (for example a
// collector). --profile applies only when this call creates the run. Run with no seed to list seeds.
const fs = require('node:fs');
const path = require('node:path');

const appDir = path.resolve(__dirname, '..');
function runtimeRoot() {
  if (process.env.PALE_RUNTIME_ROOT) return path.resolve(process.env.PALE_RUNTIME_ROOT);
  let root = appDir;
  while (!fs.existsSync(path.join(root, 'runtime/launch.cjs'))) {
    const parent = path.dirname(root);
    if (parent === root) throw Error('Run inside the public PALE checkout, or set PALE_RUNTIME_ROOT to its runtime directory.');
    root = parent;
  }
  return path.join(root, 'runtime');
}
const index = require('../fixtures/seeds/index.json');
const binding = require('../fixtures/binding.json');

async function loadSeed({seed, actor, run = 'web-demo', stateDir, registry = path.join(appDir, 'web.registry.json'), profile = 'sandbox'}) {
  const entry = index.seeds.find(s => s.id === seed);
  if (!entry) throw Error('Unknown seed "' + seed + '". Seeds: ' + index.seeds.map(s => s.id).join(', '));
  const person = actor || entry.actors[0].owner_person_id, account = binding.accounts.find(a => a.owner_person_id === person);
  if (!account) throw Error('Unknown person "' + person + '". People: ' + binding.people.map(p => p.person_id).join(', '));
  const runtime = runtimeRoot(), {Client} = require(path.join(runtime, 'client.cjs'));
  const ledger = JSON.parse(fs.readFileSync(path.join(appDir, 'fixtures', entry.seed), 'utf8'));
  const infra = new Client(require('../app.json').app_id, 'infra', run, path.resolve(stateDir || path.join(path.dirname(runtime), '.state')), 'parcel-seed-loader',
    {registry: path.resolve(registry), initialProfile: profile});
  try {
    await infra.initialize();
    const current = await infra.call('env.snapshot');
    // The acting account comes from the trusted binding; records carry no account of their own.
    const result = await infra.call('env.load_seed', {expected_version: current.version, data: {...ledger, account_id: account.account_id, owner_person_id: person},
      binding, virtual_now: entry.virtual_now});
    if (result.status !== 'ready') throw Error('Seed was not loaded: ' + result.status + ' ' + (result.message || ''));
    return {seed: entry.id, run, account_id: account.account_id, owner_person_id: person, virtual_now: entry.virtual_now, loaded: result.loaded, version: result.version};
  } finally {
    await infra.close();
  }
}
module.exports = {loadSeed};

if (require.main === module) {
  const [seed, ...rest] = process.argv.slice(2), options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = {'--actor': 'actor', '--run': 'run', '--state-dir': 'stateDir', '--registry': 'registry', '--profile': 'profile'}[rest[i]];
    if (!key || !rest[i + 1]) { console.error('Usage: load-seed.cjs <seed-id> [--actor PERSON] [--run NAME] [--state-dir DIR] [--registry FILE] [--profile sandbox|scenario]'); process.exit(2); }
    options[key] = rest[i + 1];
  }
  if (!seed) {
    for (const s of index.seeds) console.log(s.id.padEnd(24) + s.virtual_now + '  ' + s.actors.map(a => a.owner_person_id + ' (' + a.role + ')').join(', ') + '\n    ' + s.summary);
  } else {
    loadSeed({seed, ...options}).then(r => console.log('Loaded ' + r.seed + ' (' + r.loaded + ' parcels) as ' + r.owner_person_id + ' into run ' + r.run + ' at ' + r.virtual_now +
      '. Start or refresh the Web App for this run.')).catch(e => { console.error(e.message); process.exitCode = 1; });
  }
}
