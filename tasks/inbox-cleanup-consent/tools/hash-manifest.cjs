#!/usr/bin/env node
'use strict';
// Writes manifest.json. The manifest itself is not in the file hash map.
const fs = require('node:fs');
const crypto = require('node:crypto');
const nodePath = require('node:path');

const PACKAGE = nodePath.resolve(__dirname, '..');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.name === '.git' || entry.name === '.deps' || entry.name === '.state') continue;
    const full = nodePath.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) {
      const rel = nodePath.relative(PACKAGE, full).split(nodePath.sep).join('/');
      if (rel === 'manifest.json') continue;
      out[rel] = sha256(full);
    }
  }
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

const upstream = arg('--upstream');
if (!upstream) {
  console.error('usage: hash-manifest.cjs --upstream <upstream-main-sha>');
  process.exit(2);
}

const files = {};
walk(PACKAGE, files);
const manifest = {
  format: 'lifepack',
  format_version: '1.0',
  package_id: 'inbox-cleanup-consent',
  package_version: '1.0.0',
  tasks: [
    {
      id: 'inbox-cleanup-consent',
      path: 'tasks/inbox-cleanup-consent',
      proposal_url: 'https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/71',
      proposal_path: 'proposals/task/inbox-cleanup-consent.md',
      primary_domain: 'Work & business',
      secondary_domains: ['Home & utilities'],
      dependencies: ['runtime', 'mail', 'notes']
    }
  ],
  dependencies: [
    {
      id: 'runtime',
      kind: 'core',
      version: '1.6.0',
      source: 'https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam',
      path: 'runtime',
      revision: upstream
    },
    {
      id: 'mail',
      kind: 'app',
      version: '1.3.0',
      source: 'https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam',
      path: 'examples/apps/mail',
      revision: upstream
    },
    {
      id: 'notes',
      kind: 'app',
      version: '1.0.0',
      source: 'https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam',
      path: 'apps/notes',
      revision: upstream
    }
  ],
  files,
  notes: [
    'PR_UPDATE.md is included in the file hashes.',
    'The runner is a package-local stand-in. Harbor task.toml, the Dockerfile and tests/test.sh are written, not run.',
    'Official model rollouts are pending the infrastructure roster.'
  ]
};
fs.writeFileSync(nodePath.join(PACKAGE, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({files: Object.keys(files).length, upstream}));
