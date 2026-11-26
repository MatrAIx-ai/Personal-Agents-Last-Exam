#!/usr/bin/env node
'use strict';
// Plays one reference scenario through the public runtime over MCP and grades the result: Infra loads the bundle
// and applies the setup, the Agent connection runs the chosen call list from scenario.json, and the grader reads
// env.snapshot. Writes the snapshot so it can be inspected or graded again with grade.cjs.
//
//   node apps/second-draft/examples/scenarios/play.cjs SCENARIO_ID base|twin [reference|alternative-N|control-N] [--out DIR]
//
// Run from the public PALE checkout (or set PALE_RUNTIME_ROOT). Exit 0 when the run passes, 1 when it fails.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {grade} = require('./grade.cjs');
const {setupOf} = require('../../scripts/build-scenarios.cjs');

const APP = path.resolve(__dirname, '../..');
function runtimeRoot() {
  if (process.env.PALE_RUNTIME_ROOT) return path.resolve(process.env.PALE_RUNTIME_ROOT);
  for (let dir = APP; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'runtime/launch.cjs'))) return path.join(dir, 'runtime');
    if (path.dirname(dir) === dir) throw new Error('Run inside the public PALE checkout or set PALE_RUNTIME_ROOT.');
  }
}

function pick(spec, variant, which) {
  const runs = spec.runs[variant];
  if (which === 'reference') return {label: 'reference', calls: runs.reference};
  const m = /^(alternative|control)-(\d+)$/.exec(which || '');
  const list = m && (m[1] === 'alternative' ? runs.alternatives : runs.controls);
  const item = list && list[Number(m[2]) - 1];
  if (!item) throw new Error(`No ${which} in ${spec.id}/${variant}`);
  return m[1] === 'alternative' ? {label: which, calls: item} : {label: `${which}: ${item.name}`, calls: item.calls, expected_fails: item.fails};
}

async function play(id, variant, which = 'reference', outDir) {
  const {prepare} = require(path.join(runtimeRoot(), 'prepare.cjs'));
  const {Client} = require(path.join(runtimeRoot(), 'client.cjs'));
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, id, 'scenario.json'), 'utf8'));
  const dir = path.join(__dirname, id, variant), read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const run = pick(spec, variant, which), prepared = prepare(APP), clients = [];
  const open = async (role, profile) => {
    const c = new Client(prepared.app, role, 'play', path.join(prepared.root, 'state'), 'second-draft-play', {registry: prepared.registry, initialProfile: profile});
    clients.push(c); await c.initialize(); return c;
  };
  try {
    // The scenarios use the sandbox profile, so that submitting is possible (and can be wrong).
    const infra = await open('infra', 'sandbox'), agent = await open('agent');
    const steps = [];
    const loaded = await infra.call('env.load_seed', {expected_version: (await infra.call('env.snapshot')).version, request_id: 'load', data: read('seed.json'),
      binding: read('binding.json'), bundle: {dataset: read('dataset.json'), catalog: read('catalog.json'), blobs: {}}, virtual_now: spec.load_at});
    steps.push(['env.load_seed', loaded.status]);
    for (const [i, step] of setupOf(spec, variant).entries()) {
      const expected_version = (await infra.call('env.snapshot')).version;
      const r = step.event ? await infra.call('env.apply_event', {expected_version, event: step.event})
        : await infra.call('env.advance_time', {expected_version, virtual_now: step.advance_to, request_id: 'setup-' + i});
      steps.push([step.event ? `env.apply_event ${step.event.operation}` : `env.advance_time ${step.advance_to}`, r.status]);
    }
    for (const [i, [name, args]] of run.calls.entries()) {
      const expected_version = (await agent.call('second-draft.preferences.get')).version;
      steps.push([name, (await agent.call(name, {...args, expected_version, request_id: 'play-' + i})).status]);
    }
    const snapshot = (await infra.call('env.snapshot')).snapshot;
    const out = outDir || fs.mkdtempSync(path.join(os.tmpdir(), 'second-draft-play-'));
    fs.mkdirSync(out, {recursive: true});
    fs.writeFileSync(path.join(out, 'snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n');
    return {run: run.label, expected_fails: run.expected_fails || [], steps, snapshot_file: path.join(out, 'snapshot.json'), grade: grade(snapshot, spec, variant)};
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}

module.exports = {play};
if (require.main === module) {
  const argv = process.argv.slice(2), o = argv.indexOf('--out'), outDir = o >= 0 ? argv.splice(o, 2)[1] : undefined;
  const [id, variant, which] = argv;
  if (!id || !['base', 'twin'].includes(variant)) { console.error('usage: play.cjs SCENARIO_ID base|twin [reference|alternative-N|control-N] [--out DIR]'); process.exit(2); }
  play(id, variant, which, outDir).then(r => {
    for (const [name, status] of r.steps) console.log(`${status.padEnd(12)} ${name}`);
    for (const c of r.grade.checks) console.log(`${c.pass ? 'pass' : 'FAIL'} ${c.name}${c.pass ? '' : ' ' + JSON.stringify(c.detail)}`);
    console.log(`${r.grade.scenario}/${r.grade.variant} ${r.run}: ${r.grade.pass ? 'PASS' : 'FAIL'}; snapshot ${r.snapshot_file}`);
    process.exit(r.grade.pass ? 0 : 1);
  }).catch(e => { console.error(e.stack || e.message); process.exit(2); });
}
