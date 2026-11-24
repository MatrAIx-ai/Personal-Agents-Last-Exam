#!/usr/bin/env node
'use strict';
// Starts Switchback's pages on the public business Web Host with a fixture at
// its own task clock. Run from a full checkout:
//
//   node apps/switchback/examples/web-demo.cjs [--fixture minimal|high-country|desert-rivers]
//        [--run web-demo] [--state-dir .state] [--port 8780] [--until ISO-TIME] [--reload]
//
// Core starts a new instance at the registry's initial_time. The shared
// apps.registry.json uses 2026-11-18 for every App, before the minimal
// fixture's clock (2027-05-20), when its June 2027 nights are still
// unreleased. So, as a trusted Infra caller, this script loads the chosen
// fixture with env.load_seed at the fixture's clock, which also makes that
// clock the reset point. It does this only when the run is not already at that
// fixture's baseline (or with --reload), so restarting keeps earlier changes.
// --until applies the fixture's default schedule up to that instant and then
// advances the clock to it. When the shared registry has no Switchback entry,
// the script uses a disposable registry whose initial_time is fixtures/clock.json.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const {start} = require(path.join(root, 'runtime/web/server.cjs'));
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const {prepare} = require(path.join(root, 'runtime/prepare.cjs'));

const FIXTURES = ['minimal', 'high-country', 'desert-rivers'];
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const sha = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');

function options(argv) {
  const out = {fixture: 'minimal', run: 'web-demo', stateDir: path.join(root, '.state'), port: 0, until: null, reload: false};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--reload') { out.reload = true; continue; }
    const v = argv[++i];
    if (!v) throw Error('Missing value for ' + k);
    if (k === '--fixture' && FIXTURES.includes(v)) out.fixture = v;
    else if (k === '--run' && /^[-a-zA-Z0-9_]{1,80}$/.test(v)) out.run = v;
    else if (k === '--state-dir') out.stateDir = path.resolve(v);
    else if (k === '--port') out.port = Number(v);
    else if (k === '--until' && Number.isFinite(Date.parse(v))) out.until = v;
    else throw Error('Usage: web-demo.cjs [--fixture ' + FIXTURES.join('|') + '] [--run RUN] [--state-dir DIR] [--port PORT] [--until ISO-TIME] [--reload]');
  }
  return out;
}

// Loads the fixture at its clock unless the run already started from it.
async function prepareRun({registry, run, stateDir, fixture, until, reload}) {
  const seed = JSON.parse(fs.readFileSync(path.join(root, `apps/switchback/fixtures/${fixture}.json`), 'utf8'));
  const schedule = JSON.parse(fs.readFileSync(path.join(root, `apps/switchback/fixtures/schedules/${fixture}.json`), 'utf8'));
  const infra = new Client('switchback', 'infra', run, stateDir, 'switchback-web-demo', {registry});
  await infra.initialize();
  try {
    let {snapshot: snap, version} = await infra.call('env.snapshot');
    const atBaseline = sha(snap.initial_data) === sha(seed) && Date.parse(snap.initial_virtual_now) === Date.parse(schedule.initial_time);
    if (reload || !atBaseline) {
      const out = await infra.call('env.load_seed', {expected_version: version, data: seed,
        virtual_now: schedule.initial_time, request_id: `web-demo-${fixture}-${Date.now()}`});
      if (out.status !== 'ready') throw Error('env.load_seed: ' + JSON.stringify(out).slice(0, 300));
      console.log(`Loaded fixtures/${fixture}.json at ${schedule.initial_time}.`);
    }
    if (until) {
      ({snapshot: snap, version} = await infra.call('env.snapshot'));
      let applied = 0;
      for (const e of schedule.events) {
        if (Date.parse(e.at) > Date.parse(until) || Date.parse(e.at) < Date.parse(snap.virtual_now)) continue;
        const out = await infra.call('env.apply_event', {expected_version: version, event: e});
        if (out.status !== 'committed' && !out.duplicate) throw Error(`${e.event_id}: ${JSON.stringify(out).slice(0, 300)}`);
        version = (await infra.call('env.snapshot')).version; applied++;
      }
      const out = await infra.call('env.advance_time', {expected_version: version, request_id: 'web-demo-until-' + until, virtual_now: until});
      if (out.status !== 'committed') throw Error('env.advance_time: ' + JSON.stringify(out).slice(0, 300));
      console.log(`Applied ${applied} scheduled events and moved the clock to ${until}.`);
    }
    return (await infra.call('env.snapshot')).snapshot.virtual_now;
  } finally {
    await infra.close();
  }
}

async function main() {
  const o = options(process.argv.slice(2));
  const shared = path.join(root, 'apps.registry.json');
  const listed = JSON.parse(fs.readFileSync(shared, 'utf8')).apps.some(a => a.app_id === 'switchback');
  const temp = listed ? null : prepare(path.join(root, 'apps/switchback'));
  const registry = listed ? shared : temp.registry;
  const host = await start({app: 'switchback', registry, run: o.run, stateDir: o.stateDir, profile: 'sandbox', port: o.port});
  const clock = await prepareRun({registry, ...o});
  console.log(`Switchback, run ${o.run}, fixture ${o.fixture}; facility clock now ${clock}.`);
  console.log('Open ' + host.accessUrl);
  console.log('Business pages only. Events, clock moves and resets stay on the separate Infra MCP interface.');
  const stop = () => host.close().then(() => { temp?.cleanup(); process.exit(0); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
}

if (require.main === module) main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
module.exports = {prepareRun};
