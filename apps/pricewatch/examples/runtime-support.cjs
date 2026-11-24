'use strict';
// Integration-driver support. The App implementation never imports the runtime.
// An explicit public runtime path keeps this usable outside a repository clone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {clone} = require('./fixture-data.cjs');

function fingerprint(directory) {
  const files = {};
  function visit(folder) {
    for (const entry of fs.readdirSync(folder, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['.git', '.state', '.artifacts', 'node_modules'].includes(entry.name)) continue;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files[path.relative(directory, file).split(path.sep).join('/')] =
        crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      else throw Error('Integration package contains an unsupported link: ' + file);
    }
  }
  visit(directory);
  const encoded = Object.keys(files).sort().map(file => file + '\0' + files[file] + '\n').join('');
  return {sha256: crypto.createHash('sha256').update(encoded).digest('hex'), files};
}

function driver({notes = false} = {}) {
  if (!process.env.PALE_RUNTIME_ROOT) throw Error('Set PALE_RUNTIME_ROOT to the pinned public runtime directory.');
  const runtimeRoot = fs.realpathSync(process.env.PALE_RUNTIME_ROOT);
  const runtime = require(path.join(runtimeRoot, 'package.json'));
  const {Client} = require(path.join(runtimeRoot, 'client.cjs'));
  const {prepare} = require(path.join(runtimeRoot, 'prepare.cjs'));
  const appDirectory = path.resolve(__dirname, '..');
  let notesDirectory;
  if (notes) {
    if (!process.env.PALE_NOTES_APP) throw Error('Set PALE_NOTES_APP to the real public Notes 1.0.0 package for this optional example.');
    notesDirectory = fs.realpathSync(process.env.PALE_NOTES_APP);
    const manifest = require(path.join(notesDirectory, 'app.json'));
    assert.equal(manifest.app_id, 'notes');
    assert.equal(manifest.version, '1.0.0');
  }
  const prepared = prepare(appDirectory, notes ? [notesDirectory] : []);
  const stateDirectory = path.join(prepared.root, 'state');
  const clients = [], trace = [], checks = [];
  let sequence = 0;
  const eq = (label, actual, expected) => {assert.deepEqual(actual, expected, label); checks.push(label);};
  const ok = (label, actual) => {assert.ok(actual, label); checks.push(label);};
  async function open(app = 'pricewatch', role = 'agent', run = 'runtime-integration', directory = stateDirectory) {
    const client = new Client(app, role, run, directory, 'pricewatch-integration', {registry: prepared.registry});
    client.pricewatchIdentity = {app, role, run, instance: path.relative(prepared.root, directory)};
    clients.push(client); await client.initialize(); return client;
  }
  function evidence(identity, name, value) {
    if (identity.app !== 'notes') return clone(value);
    // Verify real Notes contents in memory, but omit even synthetic diary text
    // from the combined integration report. PriceWatch calls are unredacted.
    return {omitted_notes_content: true, tool: name,
      sha256: crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')};
  }
  async function call(client, name, args = {}) {
    const result = await client.call(name, args);
    trace.push({identity: clone(client.pricewatchIdentity), tool: name,
      arguments: evidence(client.pricewatchIdentity, name, args),
      result: evidence(client.pricewatchIdentity, name, result)});
    return result;
  }
  const snapshot = infra => call(infra, 'env.snapshot');
  async function write(agent, infra, name, args, requestId = 'write-' + (++sequence)) {
    const result = await call(agent, name, {...clone(args), expected_version: (await snapshot(infra)).version, request_id: requestId});
    eq(name + ' committed (' + requestId + ')', result.status, 'committed'); return result;
  }
  async function event(infra, value) {
    const result = await call(infra, 'env.apply_event', {expected_version: (await snapshot(infra)).version, event: clone(value)});
    eq(value.event_id + ' committed', result.status, 'committed'); return result;
  }
  async function load(infra, data, {binding, now, policies} = {}) {
    const before = await snapshot(infra);
    const bundle = clone(before.snapshot.resources.bundle);
    // These examples contain no assets. Supply an explicit synthetic bundle
    // rather than claiming the old fixture record counts still describe it.
    bundle.catalog.assets = []; bundle.blobs = {};
    const app = before.snapshot.app_id;
    const plugin = require(path.join(prepared.root, 'apps', app, 'plugin.cjs'));
    bundle.dataset.expected_counts = {records: plugin.records(data).length, assets: 0};
    const result = await call(infra, 'env.load_seed', {expected_version: before.version,
      request_id: 'load-' + (++sequence), data: clone(data), bundle,
      ...(binding ? {binding: clone(binding)} : {}), ...(policies ? {policies: clone(policies)} : {}),
      ...(now ? {virtual_now: now} : {})});
    eq(app + ' supplied seed accepted', result.status, 'ready');
    const current = await snapshot(infra);
    const ready = await call(infra, 'env.reset', {expected_version: current.version, profile: 'sandbox'});
    eq(app + ' sandbox profile loaded', ready.status, 'ready');
    return snapshot(infra);
  }
  async function close() {
    await Promise.allSettled(clients.map(client => client.close())); prepared.cleanup();
  }
  function report(extra = {}) {return {passed: true, mode: 'Real stdio MCP / public Core',
    app_version: require(path.join(prepared.root, 'apps/pricewatch/app.json')).version, runtime_version: runtime.version,
    core_api_version: runtime.pale.app_core_api, node: process.version,
    validated_app_package: fingerprint(path.join(prepared.root, 'apps/pricewatch')),
    ...(notes ? {validated_notes_package: fingerprint(path.join(prepared.root, 'apps/notes'))} : {}),
    runtime_contract_hashes: Object.fromEntries(['package.json', 'client.cjs', 'prepare.cjs', 'core/runtime.cjs',
      'core/mcp.cjs', 'core/registry.cjs', 'contracts/schema-validator.cjs'].map(file =>
      [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(runtimeRoot, file))).digest('hex')])),
    checks, trace, ...extra};}
  return {open, call, snapshot, write, event, load, close, eq, ok, report,
    appDirectory, notesDirectory, stateDirectory, runtimeRoot, prepared, trace};
}

function output(run) {
  run().then(report => {if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({passed: report.passed, mode: report.mode, app_version: report.app_version,
      runtime_version: report.runtime_version, node: report.node, checks: report.checks,
      trace_entries: report.trace.length}, null, 2));}).catch(error => {console.error(error); process.exitCode = 1;});
}
module.exports = {driver, output};
