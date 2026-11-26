#!/usr/bin/env node
'use strict';
// Starts the public business Web Host for this package, on a fresh copy of its fixture, or
// on the full-window evaluation dataset (datasets/full-window, loaded by Infra with
// env.load_seed at the dataset clock before the page opens).
//
//   node examples/web.cjs --runtime DIR [--profile sandbox|scenario] [--port N] [--dataset full-window]
//
// DIR is the `runtime` directory of a public PALE checkout (1.6.0 or later, with runtime/web);
// PALE_RUNTIME_ROOT=DIR works too. The package is copied into a temporary registry (the
// runtime's prepare.cjs), so nothing in the checkout or this folder is written. Open the
// access link it prints. Seeding, events and the clock stay on the separate Infra MCP
// interface: the page has no such controls. Ctrl+C stops the Host and removes the copy.
const fs = require('node:fs'), path = require('node:path');
const appDir = path.resolve(__dirname, '..');

function options() {
  const out = { runtime: process.env.PALE_RUNTIME_ROOT, profile: 'sandbox' };
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i], value = process.argv[i + 1];
    if (!['--runtime', '--profile', '--port', '--dataset'].includes(key) || !value) return null;
    out[key.slice(2)] = key === '--port' ? Number(value) : value;
  }
  return out.runtime && ['sandbox', 'scenario'].includes(out.profile) && [undefined, 'full-window'].includes(out.dataset) ? out : null;
}
const opts = options();
const root = opts && path.resolve(opts.runtime);
if (!opts || !fs.existsSync(path.join(root, 'web', 'server.cjs')) || !fs.existsSync(path.join(root, 'prepare.cjs'))) {
  console.error('Usage: node examples/web.cjs --runtime DIR [--profile sandbox|scenario] [--port N] [--dataset full-window]\nDIR must be the runtime directory of a public PALE checkout with runtime/web.');
  process.exit(2);
}
const { prepare } = require(path.join(root, 'prepare.cjs')), { start } = require(path.join(root, 'web', 'server.cjs')), { Client } = require(path.join(root, 'client.cjs'));

(async () => {
  const prepared = prepare(appDir);
  let host;
  const stop = async () => { await host?.close(); prepared.cleanup(); process.exit(0); };
  try {
    host = await start({ app: prepared.app, registry: prepared.registry, stateDir: path.join(prepared.root, 'state'), run: 'web-demo', profile: opts.profile, port: opts.port || 0 });
  } catch (e) { prepared.cleanup(); throw e; }
  let clock = JSON.parse(fs.readFileSync(path.join(appDir, 'fixtures/clock.json'), 'utf8')).initial_time, what = 'fixture';
  if (opts.dataset) {
    // Infra loads the dataset into the page's run, at the dataset's own clock.
    const dir = path.join(appDir, 'datasets', opts.dataset), infra = new Client(prepared.app, 'infra', 'web-demo', path.join(prepared.root, 'state'), 'belltower-web-dataset', { registry: prepared.registry });
    clock = JSON.parse(fs.readFileSync(path.join(dir, 'clock.json'), 'utf8')).initial_time; what = opts.dataset + ' dataset';
    try {
      await infra.initialize();
      const loaded = await infra.call('env.load_seed', { expected_version: (await infra.call('env.snapshot')).version, data: JSON.parse(fs.readFileSync(path.join(dir, 'seed.json'), 'utf8')), virtual_now: clock, request_id: 'web-' + opts.dataset });
      if (loaded.status !== 'ready') throw new Error('env.load_seed: ' + JSON.stringify(loaded));
    } finally { await infra.close(); }
  }
  console.log('Belltower (' + opts.profile + ' profile, ' + what + ', clock ' + clock + ')');
  console.log('Open ' + host.accessUrl);
  console.log('Business pages only. Seeds, events and the clock stay on the Infra MCP interface.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stop().catch(() => process.exit(1)); });
})().catch(e => { console.error(e); process.exitCode = 1; });
