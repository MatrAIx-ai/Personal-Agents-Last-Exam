'use strict';
// Locate the pinned public runtime (and, for the Mail flow, the pinned Mail package) for the
// real-MCP scripts. Explicit options win: --runtime DIR, --mail DIR, or PALE_RUNTIME_ROOT.
// Otherwise the scripts look upwards from this package for a public checkout.
const fs = require('node:fs'), path = require('node:path');
function option(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : null;
}
function checkoutRoot() {
  let dir = path.resolve(__dirname, '..');
  while (!fs.existsSync(path.join(dir, 'runtime/launch.cjs'))) {
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return dir;
}
function runtimeDir() {
  const dir = option('runtime') || (process.env.PALE_RUNTIME_ROOT && path.resolve(process.env.PALE_RUNTIME_ROOT)) || (checkoutRoot() && path.join(checkoutRoot(), 'runtime'));
  if (!dir || !fs.existsSync(path.join(dir, 'launch.cjs'))) throw new Error('Pass --runtime DIR (the public runtime/ directory) or set PALE_RUNTIME_ROOT.');
  return dir;
}
function mailDir() {
  const dir = option('mail') || (checkoutRoot() && path.join(checkoutRoot(), 'examples/apps/mail'));
  if (!dir || !fs.existsSync(path.join(dir, 'app.json'))) throw new Error('Pass --mail DIR (the pinned Mail package).');
  return dir;
}
module.exports = {option, runtimeDir, mailDir, packageDir: path.resolve(__dirname, '..')};
