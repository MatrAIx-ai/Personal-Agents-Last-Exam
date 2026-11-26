#!/usr/bin/env node
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const packageRoot = path.resolve(__dirname, '..');
const skip = new Set(['manifest.json']);

function filesUnder(dir, prefix) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (name === '.deps' || name === 'node_modules') continue;
    const abs = path.join(dir, name);
    const rel = prefix ? prefix + '/' + name : name;
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) out.push(...filesUnder(abs, rel));
    else if (!skip.has(rel)) out.push(rel);
  }
  return out;
}

const files = {};
for (const rel of filesUnder(packageRoot, '').sort()) {
  const body = fs.readFileSync(path.join(packageRoot, rel));
  files[rel] = crypto.createHash('sha256').update(body).digest('hex');
}
function fileHash(rel) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(packageRoot, rel))).digest('hex');
}
const components = {
  harbor_dockerfile: fileHash('tasks/grocery-cap-limit-code/environment/Dockerfile'),
  harbor_task_toml: fileHash('tasks/grocery-cap-limit-code/task.toml'),
  harbor_test_sh: fileHash('tasks/grocery-cap-limit-code/tests/test.sh'),
  harbor_image: 'node:22-bookworm@sha256:7c400d78797d8cbe3f6bb21d2227b86af4cd24b0014cc9f62ff989cc16de988e',
  harbor_version: '1.0.0',
  harbor_status: 'written and unbuilt until infrastructure 135',
  fingerprint_helper: {
    path: 'tasks/grocery-cap-limit-code/tests/vendor/fingerprints.cjs',
    sha256: fileHash('tasks/grocery-cap-limit-code/tests/vendor/fingerprints.cjs'),
    keelcard_pin: 'e0471686b1e28403649a8971b9435c0dc88db0a7',
    mount: 'PALE_FINGERPRINT_HELPER'
  },
  local_driver: [
    'tasks/grocery-cap-limit-code/local-driver/driver.cjs',
    'tasks/grocery-cap-limit-code/local-driver/plan-agent.cjs',
    'tasks/grocery-cap-limit-code/local-driver/world.cjs',
    'tasks/grocery-cap-limit-code/local-driver/registry.cjs',
    'tasks/grocery-cap-limit-code/local-driver/run.cjs'
  ].map(rel => ({ path: rel, sha256: fileHash(rel) }))
};
const manifest = {
  format: 'lifepack',
  format_version: '1.0',
  package_id: 'grocery-cap-limit-code',
  package_version: '1.0.0',
  tasks: [
    {
      id: 'grocery-cap-limit-code',
      path: 'tasks/grocery-cap-limit-code',
      proposal_url: 'https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/7d993d35a6901bd5be03ff904545957cea34fff7/proposals/task/grocery-cap-limit-code.md',
      proposal_blob: '87f75800a3a8c8b9ed56720fa8b68566e4205603',
      primary_domain: 'Shopping & groceries',
      secondary_domains: ['Money & insurance'],
      dependency_ids: ['keelcard', 'mail', 'runtime', 'freshcart-subset', 'webstub']
    }
  ],
  dependencies: [
    {
      id: 'keelcard',
      kind: 'app',
      version: '1.0.0',
      revision: 'e0471686b1e28403649a8971b9435c0dc88db0a7',
      source: 'https://github.com/suraj-ranganath/Personal-Agents-Last-Exam'
    },
    {
      id: 'mail',
      kind: 'app',
      version: '1.3.0',
      revision: '6933c430942c64f94874083815829e4a4b20920a',
      source: 'examples/apps/mail'
    },
    {
      id: 'runtime',
      kind: 'runtime',
      version: '1.6.0',
      revision: '6933c430942c64f94874083815829e4a4b20920a',
      source: 'runtime/'
    },
    {
      id: 'freshcart-subset',
      kind: 'app',
      version: '1.0.0',
      revision: 'task-local',
      source: 'tasks/grocery-cap-limit-code/environment/apps/freshcart'
    },
    {
      id: 'webstub',
      kind: 'app',
      version: '1.0.0',
      revision: 'task-local',
      source: 'tasks/grocery-cap-limit-code/environment/apps/webstub'
    }
  ],
  components,
  files
};
fs.writeFileSync(path.join(packageRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('files', Object.keys(files).length);
