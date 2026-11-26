'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnConfined} = require('./run.cjs');

const task = path.resolve(__dirname, '../..');
const targets = [
  path.join(task, 'tests/rubrics.yaml'),
  path.join(task, 'tests/hints.md'),
  path.join(task, 'context/user/script.json'),
  path.join(task, 'context/user/goals.json'),
  path.join(task, 'context/user/history.json'),
  path.join(task, 'context/timeline.yaml'),
];
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'rpr-probe-'));
const reader = `
const fs = require('node:fs');
const paths = process.argv.slice(2);
const readable = [];
for (const file of paths) {
  try {
    fs.readFileSync(file);
    readable.push(file);
  } catch (err) {
    if (err.code !== 'ENOENT' && err.code !== 'EACCES' && err.code !== 'EPERM') readable.push(file);
  }
}
process.stdout.write(JSON.stringify({readable}) + '\\n');
`;
fs.writeFileSync(path.join(sandbox, 'read.cjs'), reader);
const child = spawnConfined(sandbox, process.execPath, ['read.cjs', ...targets]);
let out = '';
child.stdout.on('data', chunk => { out += chunk.toString('utf8'); });
child.on('close', code => {
  fs.rmSync(sandbox, {recursive: true, force: true});
  if (code !== 0 || !out.trim()) {
    console.error(out);
    process.exit(1);
  }
  process.stdout.write(out.trim() + '\n');
});
