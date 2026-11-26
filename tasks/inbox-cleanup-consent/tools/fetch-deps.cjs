#!/usr/bin/env node
'use strict';
// Confirms Mail, Notes and the runtime are the versions on this checkout.
// This task has no unmerged App, so there is nothing to fetch into .deps/.
const fs = require('node:fs');
const path = require('node:path');

const PACKAGE = path.resolve(__dirname, '..');

function repoRoot(start) {
  let dir = start;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'apps.registry.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('PALE checkout not found');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const root = repoRoot(PACKAGE);
const registry = readJson(path.join(root, 'apps.registry.json'));
const apps = Object.fromEntries(registry.apps.map((app) => [app.app_id, app]));
const expected = [
  {id: 'mail', version: '1.3.0', path: 'examples/apps/mail'},
  {id: 'notes', version: '1.0.0', path: 'apps/notes'}
];
const problems = [];
for (const row of expected) {
  const listed = apps[row.id];
  const manifest = readJson(path.join(root, row.path, 'app.json'));
  if (!listed || listed.version !== row.version || listed.path !== row.path) problems.push(row.id + ' registry mismatch');
  if (manifest.version !== row.version) problems.push(row.id + ' manifest ' + manifest.version);
}
const runtime = readJson(path.join(root, 'runtime/package.json')).version;
if (runtime !== '1.6.0') problems.push('runtime ' + runtime);
const report = {
  schema: 'pale.inbox-cleanup.deps.v1',
  fetched: [],
  reason: 'Mail 1.3.0, Notes 1.0.0 and runtime 1.6.0 are already on this checkout. The runner uses apps.registry.json at the repo root because a package-local registry cannot point outside its own directory.',
  resolved: [
    {id: 'mail', version: '1.3.0', source: 'examples/apps/mail'},
    {id: 'notes', version: '1.0.0', source: 'apps/notes'},
    {id: 'runtime', version: runtime, source: 'runtime'}
  ],
  problems
};
fs.writeFileSync(path.join(PACKAGE, 'demo/inbox-cleanup-consent/evidence/dependencies.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ok: problems.length === 0, runtime, problems}));
if (problems.length) process.exit(1);
