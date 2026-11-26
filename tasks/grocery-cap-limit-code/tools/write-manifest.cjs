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
      revision: 'c481a2ae10b4bb17725c69f692203f22af793bb9',
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
  files
};
fs.writeFileSync(path.join(packageRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('files', Object.keys(files).length);
