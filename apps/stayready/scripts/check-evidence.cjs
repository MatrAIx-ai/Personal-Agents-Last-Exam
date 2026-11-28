#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { inventory, inputDigest } = require('./delivery-input.cjs');
const app = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || path.join(app, 'evidence/runs'));
const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json')));
const files = inventory(app, true);
assert.deepEqual(files, manifest.app.files, 'Verification input files changed; regenerate delivery evidence');
assert.equal(inputDigest(app, files), manifest.app.input_sha256);
assert.deepEqual(inventory(output).filter(f => f.path !== 'manifest.json'), manifest.artifacts, 'Retained evidence bytes or inventory changed');
console.log(JSON.stringify({ passed: true, input_sha256: manifest.app.input_sha256, input_files: files.length, artifacts: manifest.artifacts.length }, null, 2));
