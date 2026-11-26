#!/usr/bin/env node
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function filesUnder(dir) {
  const out = [];
  const walk = (current) => {
    for (const name of fs.readdirSync(current)) {
      if (name === '.git') continue;
      const abs = path.join(current, name);
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) walk(abs);
      else if (stat.isFile()) out.push(abs);
    }
  };
  walk(dir);
  return out.sort();
}

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function main() {
  const packageRoot = path.resolve(__dirname, '..');
  const dest = path.resolve(process.argv[2] || path.join(packageRoot, '.deps/keelcard'));
  const lockPath = path.resolve(process.argv[3] || path.join(packageRoot, 'deps.lock.json'));
  const write = process.argv.includes('--write');
  const found = {};
  for (const file of filesUnder(dest)) {
    found[path.relative(dest, file).split(path.sep).join('/')] = digest(file);
  }
  if (write) {
    const body = {
      app_id: 'keelcard',
      revision: 'e0471686b1e28403649a8971b9435c0dc88db0a7',
      source: 'https://github.com/suraj-ranganath/Personal-Agents-Last-Exam',
      file_count: Object.keys(found).length,
      files: found
    };
    fs.writeFileSync(lockPath, JSON.stringify(body, null, 2) + '\n');
    console.log('wrote ' + Object.keys(found).length + ' hashes');
    return;
  }
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const errors = [];
  for (const [rel, hash] of Object.entries(lock.files)) {
    if (found[rel] !== hash) errors.push('mismatch ' + rel);
  }
  for (const rel of Object.keys(found)) {
    if (!lock.files[rel]) errors.push('extra ' + rel);
  }
  if (errors.length) {
    console.error(errors.slice(0, 20).join('\n'));
    process.exit(1);
  }
  console.log('verified ' + Object.keys(found).length + ' keelcard files');
}

main();
