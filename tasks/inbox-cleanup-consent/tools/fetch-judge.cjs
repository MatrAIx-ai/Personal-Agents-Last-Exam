'use strict';
// Downloads the pinned reader weights and the llama.cpp build. Fixture grades do not need this.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const PACKAGE = path.resolve(__dirname, '..');
const model = require(path.join(PACKAGE, 'tasks/inbox-cleanup-consent/judge/model.json'));
const dest = path.join(PACKAGE, '.deps/judge');

function sha256(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1024 * 1024);
  try {
    let n = 0;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function fetchFile(url, file) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const result = spawnSync('curl', ['-L', '--fail', '--retry', '3', '-o', file, url], {stdio: 'inherit'});
  if (result.status !== 0) throw new Error('download failed for ' + url);
}

function main() {
  fs.mkdirSync(dest, {recursive: true});
  const weights = path.join(dest, model.weights_file);
  if (!fs.existsSync(weights) || sha256(weights) !== model.weights_sha256) {
    fetchFile(model.weights_url, weights);
    if (sha256(weights) !== model.weights_sha256) throw new Error('reader weights hash mismatch');
  }
  const runtime = path.join(dest, 'llama-' + model.runtime_revision);
  const bin = path.join(runtime, 'llama-server');
  if (!fs.existsSync(bin)) {
    const archive = path.join(dest, model.runtime_asset);
    if (!fs.existsSync(archive) || sha256(archive) !== model.runtime_sha256) {
      fetchFile(model.runtime_url, archive);
      if (sha256(archive) !== model.runtime_sha256) throw new Error('reader runtime hash mismatch');
    }
    fs.mkdirSync(runtime, {recursive: true});
    const unpacked = spawnSync('tar', ['-xzf', archive, '-C', dest], {stdio: 'inherit'});
    if (unpacked.status !== 0) throw new Error('reader runtime unpack failed');
  }
  console.log(JSON.stringify({ready: fs.existsSync(bin) && fs.existsSync(weights), runtime: model.runtime_revision, model: model.id}));
}

main();
