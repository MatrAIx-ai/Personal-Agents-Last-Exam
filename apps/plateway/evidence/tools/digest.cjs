'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const NOT_LOADED = {
  'README.md': 'documentation',
  LICENSE: 'licence text',
  'package.json': 'npm scripts for the tests',
  dataset: 'the delivery dataset, reaching Core only as an env.load_seed selection',
  dev: 'fixture and history generators and checker',
  evidence: 'this evidence',
  examples: 'the standalone event example',
  tests: 'tests'
};

function walk(dir, rel) {
  const full = path.join(dir, rel);
  if (!fs.statSync(full).isDirectory()) return [rel];
  return fs.readdirSync(full, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(e => walk(dir, rel ? rel + '/' + e.name : e.name));
}

function treeDigest(dir, keep = () => true) {
  const hash = crypto.createHash('sha256');
  const list = walk(dir, '').filter(keep).sort((a, b) => a.localeCompare(b));
  for (const rel of list) { hash.update(rel); hash.update('\0'); hash.update(fs.readFileSync(path.join(dir, rel))); }
  return { sha256: hash.digest('hex'), files: list.length };
}

function runtimeDigest(appDir) {
  const top = fs.readdirSync(appDir).sort();
  const included = top.filter(n => !(n in NOT_LOADED));
  const d = treeDigest(appDir, rel => !(rel.split('/')[0] in NOT_LOADED));
  return { sha256: d.sha256, files: d.files, includes: included, excludes: Object.entries(NOT_LOADED).filter(([n]) => top.includes(n)).map(([name, why]) => ({ name, why })), algorithm: 'SHA-256 over each file\'s package-relative path, a NUL byte and its bytes, in path order (the verifier\'s digestTree applied to the included files)' };
}

function hostRevision(root) {
  const file = rel => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');
  return {
    runtime_version: JSON.parse(fs.readFileSync(path.join(root, 'runtime/package.json'), 'utf8')).version,
    runtime_tree_sha256: treeDigest(path.join(root, 'runtime')).sha256,
    files: Object.fromEntries(['runtime/web/server.cjs', 'runtime/web/client.js', 'runtime/web/style.css', 'runtime/messaging/src/router.cjs', 'apps.registry.json'].map(f => [f, file(f)]))
  };
}

module.exports = { runtimeDigest, hostRevision, treeDigest };

if (require.main === module) {
  const appDir = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
  const d = runtimeDigest(appDir);
  console.log(d.sha256 + '  App load digest (' + d.files + ' files: ' + d.includes.join(', ') + '; excluded: ' + d.excludes.map(x => x.name).join(', ') + ')');
  const h = hostRevision(path.resolve(appDir, '..', '..'));
  console.log(h.runtime_tree_sha256 + '  runtime/ tree, runtime ' + h.runtime_version);
}
