'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { options } = require('./options.cjs');

const root = path.resolve(__dirname, '..', '..', '..', '..');
let opts;
try { opts = options(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
const dated = opts.date ? ['--date', opts.date] : [];
const STEPS = [['gui.cjs', dated], ['mail.cjs', dated], ['index.cjs', []], ['digest.cjs', []]];
for (const [file, args] of STEPS) {
  const rel = path.relative(root, path.join(__dirname, file));
  console.log('== node ' + [rel, ...args].join(' '));
  const r = spawnSync(process.execPath, [rel, ...args], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) { console.error('stopped: ' + rel + ' exited with ' + (r.status === null ? r.signal : r.status)); process.exit(r.status || 1); }
}
console.log('evidence regenerated');
