#!/usr/bin/env node
'use strict';
// Fills in the "files" section of a LifePack package manifest: SHA-256 of every file except the manifest itself.
//
//   node scripts/lifepack/manifest.cjs <package-dir>            rewrite manifest.json
//   node scripts/lifepack/manifest.cjs <package-dir> --check    fail when a file is missing, added or changed
//
// The other sections (identity, tasks, dependencies) are written by hand and left as they are.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const [dirArg, flag] = process.argv.slice(2);
if (!dirArg || (flag && flag !== '--check')) {
  console.error('Usage: node scripts/lifepack/manifest.cjs <package-dir> [--check]');
  process.exit(2);
}
const root = path.resolve(dirArg);
const manifestFile = path.join(root, 'manifest.json');
if (!fs.existsSync(manifestFile)) {
  console.error(`${manifestFile} not found. Write the identity, tasks and dependencies sections first.`);
  process.exit(1);
}

function list(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) list(p, out);
    else if (entry.isFile() && p !== manifestFile) out.push(p);
  }
  return out;
}
const files = {};
for (const p of list(root).sort()) {
  files[path.relative(root, p).split(path.sep).join('/')] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
if (flag === '--check') {
  const recorded = manifest.files || {};
  const problems = [];
  for (const [p, hash] of Object.entries(files)) {
    if (!(p in recorded)) problems.push(`not in manifest: ${p}`);
    else if (recorded[p] !== hash) problems.push(`changed: ${p}`);
  }
  for (const p of Object.keys(recorded)) if (!(p in files)) problems.push(`missing: ${p}`);
  if (problems.length) {
    for (const p of problems) console.error(p);
    console.error(`${problems.length} difference(s). Run without --check to refresh the manifest.`);
    process.exit(1);
  }
  console.log(`manifest matches ${Object.keys(files).length} files`);
} else {
  manifest.files = files;
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${Object.keys(files).length} file hashes to ${path.relative(process.cwd(), manifestFile)}`);
}
