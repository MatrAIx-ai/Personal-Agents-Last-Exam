#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const usage = 'Usage: node apps/mendwell-pharmacy/dev/confirm.cjs <run> <token> [--state-dir DIR] [--registry FILE] [--by PERSON_ID] [--at ISO_TIME]';
const argv = process.argv.slice(2);
const OPTIONS = ['--state-dir', '--registry', '--by', '--at'];
const options = {}, positional = [];
let problem = null;
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith('--')) { positional.push(arg); continue; }
  if (!OPTIONS.includes(arg)) { problem = problem || 'Unknown option ' + arg + '.'; continue; }
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--') || !value.trim()) { problem = problem || 'Option ' + arg + ' needs a value.'; continue; }
  if (arg in options) { problem = problem || 'Option ' + arg + ' is given twice.'; continue; }
  options[arg] = value;
  i++;
}
if (positional.length > 2) problem = problem || 'Unexpected argument ' + positional[2] + '.';
const [run, token] = positional;
const option = name => options[name];

function runtimeRoot() {
  if (process.env.PALE_RUNTIME_ROOT) return path.resolve(process.env.PALE_RUNTIME_ROOT);
  let dir = __dirname;
  while (!fs.existsSync(path.join(dir, 'runtime/launch.cjs'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw Error('Run this in the public PALE checkout, or set PALE_RUNTIME_ROOT to its runtime directory.');
    dir = parent;
  }
  return path.join(dir, 'runtime');
}

async function main() {
  if (problem) throw Error(problem + ' Nothing was confirmed.\n' + usage);
  if (!run || !token || !/^tok-/.test(token)) throw Error(usage);
  const runtime = runtimeRoot(), root = path.dirname(runtime);
  const { Client } = require(path.join(runtime, 'client.cjs'));
  const stateDir = path.resolve(option('--state-dir') || path.join(root, '.state'));
  const registry = path.resolve(option('--registry') || path.join(root, 'apps.registry.json'));
  if (!fs.existsSync(stateDir)) throw Error('No state directory ' + stateDir + '; pass the --state-dir the Web Host uses.');
  if (!/^[-a-zA-Z0-9_]{1,80}$/.test(run) || !fs.existsSync(path.join(stateDir, run, 'mendwell-pharmacy.json'))) throw Error('No Mendwell run "' + run + '" in ' + stateDir + '; start the Web Host for that run first, or pass its --state-dir. Nothing was confirmed.');
  const infra = new Client('mendwell-pharmacy', 'infra', run, stateDir, 'mendwell-confirm', { registry });
  try {
    await infra.initialize();
    const snap = await infra.call('env.snapshot');
    if (snap.status !== 'ok') throw Error('Snapshot failed: ' + JSON.stringify(snap));
    const by = option('--by') || snap.snapshot.data.owner_person_id;
    const at = option('--at') || snap.snapshot.virtual_now;
    const event = { event_id: 'confirm-' + crypto.randomUUID(), at, operation: 'user.confirmed', payload: { token, confirmed_by: by } };
    const result = await infra.call('env.apply_event', { expected_version: snap.version, event });
    console.log(JSON.stringify({ status: result.status, event_id: event.event_id, token, confirmed_by: by, at, version: result.version, ...(result.message ? { message: result.message } : {}) }, null, 2));
    if (result.status !== 'committed') process.exitCode = 1;
  } finally {
    await infra.close();
  }
}

main().catch(e => { console.error(e.message); process.exitCode = 1; });
