'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..', '..', '..');
const STEPS = ['gui.cjs', 'mail.cjs', 'index.cjs', 'digest.cjs'];
for (const file of STEPS) {
  const rel = path.relative(root, path.join(__dirname, file));
  console.log('== node ' + rel);
  const r = spawnSync(process.execPath, [rel, ...(['gui.cjs', 'mail.cjs'].includes(file) ? process.argv.slice(2) : [])], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) { console.error('stopped: ' + rel + ' exited with ' + (r.status === null ? r.signal : r.status)); process.exit(r.status || 1); }
}
console.log('evidence regenerated');
