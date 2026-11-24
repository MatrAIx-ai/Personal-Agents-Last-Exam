#!/usr/bin/env node
'use strict';
// Starts the public business Web Host for this package, on a fresh copy of its fixture.
//
//   node examples/web.cjs --runtime DIR [--profile sandbox|scenario] [--port N]
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
    if (!['--runtime', '--profile', '--port'].includes(key) || !value) return null;
    out[key.slice(2)] = key === '--port' ? Number(value) : value;
  }
  return out.runtime && ['sandbox', 'scenario'].includes(out.profile) ? out : null;
}
const opts = options();
const root = opts && path.resolve(opts.runtime);
if (!opts || !fs.existsSync(path.join(root, 'web', 'server.cjs')) || !fs.existsSync(path.join(root, 'prepare.cjs'))) {
  console.error('Usage: node examples/web.cjs --runtime DIR [--profile sandbox|scenario] [--port N]\nDIR must be the runtime directory of a public PALE checkout with runtime/web.');
  process.exit(2);
}
const { prepare } = require(path.join(root, 'prepare.cjs')), { start } = require(path.join(root, 'web', 'server.cjs'));

(async () => {
  const prepared = prepare(appDir);
  let host;
  const stop = async () => { await host?.close(); prepared.cleanup(); process.exit(0); };
  try {
    host = await start({ app: prepared.app, registry: prepared.registry, stateDir: path.join(prepared.root, 'state'), run: 'web-demo', profile: opts.profile, port: opts.port || 0 });
  } catch (e) { prepared.cleanup(); throw e; }
  console.log('Rainshadow (' + opts.profile + ' profile, fixture clock ' + JSON.parse(fs.readFileSync(path.join(appDir, 'fixtures/clock.json'), 'utf8')).initial_time + ')');
  console.log('Open ' + host.accessUrl);
  console.log('Business pages only. Seeds, events and the clock stay on the Infra MCP interface.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stop().catch(() => process.exit(1)); });
})().catch(e => { console.error(e); process.exitCode = 1; });
