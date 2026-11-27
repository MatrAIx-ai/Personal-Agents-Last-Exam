#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
let root = __dirname;
let runtime = process.env.PALE_RUNTIME_ROOT;
if (!runtime) {
  while (!fs.existsSync(path.join(root, 'runtime/launch.cjs'))) {
    const parent = path.dirname(root);
    if (parent === root) throw Error('Run this App in the public PALE checkout, or set PALE_RUNTIME_ROOT.');
    root = parent;
  }
  runtime = path.join(root, 'runtime');
}
require(path.join(path.resolve(runtime), 'launch.cjs')).main({
  appDirectory: __dirname,
  fixedApp: 'shelfmark-library',
});
