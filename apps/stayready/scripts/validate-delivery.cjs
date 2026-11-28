#!/usr/bin/env node
'use strict';
// Reproduce from only this package, the pinned public runtime and the two
// declared optional Apps. Browser tooling is an explicit development dependency.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { inventory, inputDigest } = require('./delivery-input.cjs');

const app = path.resolve(__dirname, '..');
const checkout = path.resolve(app, '../..');
const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Missing value: ' + name);
  return path.resolve(args[index + 1]);
}
const output = option('--output') || fs.mkdtempSync(path.join(os.tmpdir(), 'stayready-evidence-'));
const baseRuntime = option('--base-runtime');
const node18 = option('--node18');
const node22 = process.execPath;
const runtime = path.resolve(process.env.PALE_RUNTIME_ROOT || path.join(checkout, 'runtime'));
assert(baseRuntime && node18, 'Supply --base-runtime (independently pinned runtime) and --node18');
assert(!output.startsWith(app + path.sep), 'Generate outside the App, then copy results to evidence/runs');
assert(!fs.existsSync(output) || fs.readdirSync(output).length === 0, 'Choose an empty output directory');
fs.mkdirSync(output, { recursive: true });
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'stayready-package-only-'));
const isolatedApp = path.join(isolated, 'apps/stayready');
const commands = [];
const files = inventory(app, true);
const digest = inputDigest(app, files);
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const read = file => JSON.parse(fs.readFileSync(file));
function normalize(text) {
  return text.replaceAll(isolated, '$ISOLATED').replaceAll(output, '$OUTPUT').replaceAll(checkout, '$CHECKOUT');
}
function run(name, executable, argv, env = {}, cwd = isolated) {
  const start = Date.now();
  const result = spawnSync(executable, argv, { cwd, env: { ...process.env, PALE_RUNTIME_ROOT: path.join(isolated, 'runtime'),
    STAYREADY_REPORT_DIR: output, STAYREADY_BROWSER_REPORT_DIR: path.join(output, 'browser'),
    NODE_PATH: process.env.NODE_PATH || path.join(checkout, 'node_modules'),
    PATH: path.dirname(executable) + path.delimiter + process.env.PATH, ...env }, encoding: 'utf8', timeout: 240000, maxBuffer: 32 * 1024 * 1024 });
  commands.push({ name, command: [executable, ...argv].map(normalize), environment: Object.fromEntries(Object.entries(env).map(([k, v]) => [k, normalize(v)])),
    cwd: normalize(cwd), exit_code: result.status, duration_ms: Date.now() - start,
    output: normalize(result.stdout || ''), errors: normalize(result.stderr || '') });
  json(path.join(output, 'commands.json'), commands);
  if (result.status !== 0) throw new Error(name + ': ' + (result.error || result.stderr || result.stdout));
  console.log('PASS ' + name);
}
try {
  for (const file of files) {
    const destination = path.join(isolatedApp, file.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(app, file.path), destination);
  }
  fs.cpSync(runtime, path.join(isolated, 'runtime'), { recursive: true });
  for (const name of ['contacts', 'notes']) fs.cpSync(path.join(checkout, 'apps', name), path.join(isolated, 'apps', name), { recursive: true });
  assert(!fs.existsSync(path.join(isolated, 'package.json')));
  assert(!fs.existsSync(path.join(isolated, 'stayready.registry.json')));
  const { digestTree } = require(path.join(runtime, 'verify.cjs'));
  assert.equal(digestTree(isolatedApp), digest);
  for (const [name, node, runtimePath] of [['verify-node18', node18, path.join(isolated, 'runtime')], ['verify-node22', node22, path.join(isolated, 'runtime')], ['verify-base', node22, baseRuntime]]) {
    run(name, node, [path.join(runtimePath, 'cli.cjs'), 'verify', '--app', isolatedApp, '--output', path.join(output, name + '.json')]);
    const report = read(path.join(output, name + '.json'));
    assert.equal(report.passed, true); assert.equal(report.package_sha256, digest);
  }
  run('business', node22, ['--test', path.join(isolatedApp, 'tests/business.test.cjs')]);
  run('dataset-invariants', node22, ['--test', path.join(isolatedApp, 'tests/dataset.test.cjs')]);
  run('example', node22, [path.join(isolatedApp, 'examples/run.cjs')]);
  run('package-start', node22, [path.join(isolatedApp, 'tests/package-start.cjs')]);
  for (const [name, file] of [['fixture-controls', 'tests/fixture-controls.cjs'], ['mcp-flow', 'tests/mcp-flow.cjs'], ['dependencies', 'tests/dependencies.cjs'], ['dataset-check', 'scripts/check-dataset.cjs'], ['dataset-mcp', 'tests/dataset-mcp.cjs'], ['browser', 'tests/browser.test.cjs']]) {
    run(name, node22, [path.join(isolatedApp, file)]);
  }
  run('mcp-base', node22, [path.join(isolatedApp, 'tests/mcp-flow.cjs')], { PALE_RUNTIME_ROOT: baseRuntime, STAYREADY_REPORT_DIR: path.join(output, 'base') });
  // The platform's own suite requires its official examples and contracts. It
  // is a separate regression check, not part of package isolation certification.
  run('platform', node22, [path.join(runtime, 'tests/run.cjs')], { PALE_REPORT_DIR: path.join(output, 'platform') }, checkout);
  run('upstream-mail-reset', node22, [path.join(runtime, 'tests/mail-source-reset.cjs')], {}, checkout);
  assert.deepEqual(inventory(app, true), files, 'Source changed during validation');
  assert.equal(digestTree(isolatedApp), digest, 'Isolated tests mutated the package');
  for (const name of ['mcp-trace.json', 'base/mcp-trace.json', 'dependency-trace.json', ...[1, 2, 3, 4, 5, 6].map(n => 'fixture-f' + n + '.json')]) {
    const file = path.join(output, name);
    fs.writeFileSync(file + '.gz', zlib.gzipSync(fs.readFileSync(file), { level: 9 })); fs.unlinkSync(file);
  }
  const browser = read(path.join(output, 'browser/report.json'));
  const dataset = read(path.join(output, 'dataset-mcp.json'));
  const summary = { schema: 'stayready.delivery-summary.v2', passed: true, recorded_at: new Date().toISOString(),
    isolation: { passed: true, contents: ['apps/stayready (excluding generated evidence/runs)', 'runtime', 'apps/contacts', 'apps/notes'],
      absent: ['repository root package.json', 'root registry', 'other Apps', 'root evidence directory'], browser_tooling: 'Playwright 1.56.1 supplied through NODE_PATH; no runtime App dependency' },
    input_sha256: digest, checks: { business_tests: Number(commands.find(c => c.name === 'business').output.match(/# tests (\d+)/)[1]),
      dataset_invariants: Number(commands.find(c => c.name === 'dataset-invariants').output.match(/# tests (\d+)/)[1]),
      package_start: read(path.join(output, 'package-start.json')).checks.length,
      public_verifiers: ['verify-node18', 'verify-node22', 'verify-base'].map(name => ({ name, checks: read(path.join(output, name + '.json')).checks.length })),
      mcp: read(path.join(output, 'mcp-flow.json')).checks.length, dependencies: read(path.join(output, 'dependencies.json')).checks.length,
      browser: browser.checks.length, screenshots: browser.screenshots.length, dataset_scenarios: dataset.scenarios.length,
      platform_stages: read(path.join(output, 'platform/summary.json')).stages.length } };
  json(path.join(output, 'summary.json'), summary);
  json(path.join(output, 'manifest.json'), { schema: 'stayready.delivery-evidence.v2', recorded_at: summary.recorded_at,
    app: { id: 'stayready', version: require(path.join(app, 'package.json')).version, input_sha256: digest,
      hash_scope: 'All App files except generated evidence/runs/**. This is the public digestTree of the exact isolated verification input, not a digest of the self-containing final Git tree.', files },
    runtime: { version: require(path.join(runtime, 'package.json')).version, sha256: digestTree(runtime), base_sha256: digestTree(baseRuntime),
      base_revision: process.env.STAYREADY_BASE_REVISION || 'See pinned invocation in commands.json' },
    dependencies: Object.fromEntries(['contacts', 'notes'].map(name => [name, { version: '1.0.0', sha256: digestTree(path.join(checkout, 'apps', name)) }])),
    artifacts: inventory(output) });
  console.log(JSON.stringify(summary, null, 2));
} finally {
  fs.rmSync(isolated, { recursive: true, force: true });
}
