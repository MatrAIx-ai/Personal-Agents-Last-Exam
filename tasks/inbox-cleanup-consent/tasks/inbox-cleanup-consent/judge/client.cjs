'use strict';
// Pinned reader shared by the scripted user and the grader. A fixture hit stays on disk.
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');

const HERE = __dirname;
const PACKAGE = path.resolve(HERE, '../../..');
const model = require('./model.json');
const prompts = require('./prompts.json');
const cachePath = path.join(HERE, 'cache.json');
const memory = new Map();
const reads = [];
let cache = loadCache();
let loadedModel = '';

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch (err) {
    return {};
  }
}

function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function cacheKey(task, text) {
  return crypto.createHash('sha256').update(model.prompt_version + '\n' + task + '\n' + String(text)).digest('hex');
}

function weightsPath() {
  if (process.env.PALE_JUDGE_MODEL) return process.env.PALE_JUDGE_MODEL;
  return path.join(PACKAGE, '.deps/judge', model.weights_file);
}

function runtimeDir() {
  if (process.env.PALE_JUDGE_BIN) return path.dirname(process.env.PALE_JUDGE_BIN);
  return path.join(PACKAGE, '.deps/judge/llama-' + model.runtime_revision);
}

function serverBin() {
  if (process.env.PALE_JUDGE_BIN) return process.env.PALE_JUDGE_BIN;
  return path.join(runtimeDir(), 'llama-server');
}

function listener(port) {
  for (const pid of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    let cmd = '';
    let exe = '';
    try {
      cmd = fs.readFileSync('/proc/' + pid + '/cmdline').toString('utf8').replace(/\0/g, ' ');
      exe = fs.realpathSync('/proc/' + pid + '/exe');
    } catch (err) {
      continue;
    }
    if (!cmd.includes('llama-server') || !cmd.includes(String(port))) continue;
    return {exe, cmd};
  }
  return null;
}

function loadedModels() {
  const result = spawnSync('curl', ['-sf', '--max-time', '2', 'http://' + model.host + ':' + model.port + '/v1/models'], {encoding: 'utf8'});
  if (result.status !== 0 || !result.stdout) return [];
  try {
    const body = JSON.parse(result.stdout);
    return (body.data || []).map((row) => String(row.id || '')).filter(Boolean);
  } catch (err) {
    return [];
  }
}

function pinnedReady() {
  const weights = weightsPath();
  const bin = serverBin();
  if (!fs.existsSync(weights) || !fs.existsSync(bin)) return false;
  const weightFile = fs.realpathSync(weights);
  const binary = fs.realpathSync(bin);
  const ids = loadedModels();
  const match = ids.find((id) => {
    if (path.basename(id) !== model.weights_file) return false;
    try { return fs.realpathSync(id) === weightFile; } catch (err) { return id === weightFile; }
  });
  if (!match) return false;
  const owner = listener(model.port);
  if (!owner || owner.exe !== binary || !owner.cmd.includes(model.weights_file)) return false;
  loadedModel = match;
  return true;
}

function ensureServer() {
  if (pinnedReady()) return;
  const bin = serverBin();
  const weights = weightsPath();
  if (!fs.existsSync(bin) || !fs.existsSync(weights)) {
    throw new Error('The pinned reader is not installed. Run node tools/fetch-judge.cjs from the package root.');
  }
  if (loadedModels().length || listener(model.port)) {
    throw new Error('Port ' + model.port + ' is in use by a process other than the pinned reader.');
  }
  const child = spawn(bin, [
    '-m', weights,
    '--host', model.host,
    '--port', String(model.port),
    '-c', '4096',
    '-t', '4',
    '--temp', String(model.temperature),
    '--seed', String(model.seed),
    '-np', '1',
    '--jinja',
    '--reasoning', 'off'
  ], {
    detached: true,
    stdio: 'ignore',
    env: {...process.env, LD_LIBRARY_PATH: runtimeDir()}
  });
  child.unref();
  for (let i = 0; i < 120; i += 1) {
    if (pinnedReady()) return;
    pause(500);
  }
  throw new Error('The pinned reader did not become ready.');
}

function post(body) {
  const result = spawnSync('curl', [
    '-sS', '--max-time', '180',
    '-H', 'content-type: application/json',
    '-d', JSON.stringify(body),
    'http://' + model.host + ':' + model.port + '/v1/chat/completions'
  ], {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024});
  if (result.status !== 0) throw new Error(result.stderr || 'reader request failed');
  const parsed = JSON.parse(result.stdout);
  const content = parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;
  if (!content) throw new Error('reader returned no content');
  return JSON.parse(content);
}

function live(task, text) {
  const spec = prompts[task.split(':')[0]];
  if (!spec) throw new Error('unknown reader task ' + task);
  ensureServer();
  const system = spec.system.replace('GROUP', task.startsWith('keep:') ? task.slice(5) : '');
  const max = task === 'senders' ? 1200 : task === 'deadline' ? 300 : 80;
  return post({
    model: loadedModel || model.id,
    temperature: model.temperature,
    seed: model.seed,
    max_tokens: max,
    response_format: {type: 'json_object', schema: spec.schema},
    messages: [{role: 'system', content: system}, {role: 'user', content: String(text)}]
  });
}

function remember(id, task, value) {
  memory.set(id, value);
  if (process.env.PALE_JUDGE_RECORD === '1') {
    cache[id] = {task, value};
    const tmp = cachePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache));
    fs.renameSync(tmp, cachePath);
  }
}

function note(source) {
  reads.push(source);
}

function beginGrade() {
  reads.length = 0;
}

function readerReport() {
  const cacheReads = reads.filter((source) => source === 'cache').length;
  const liveReads = reads.filter((source) => source === 'live').length;
  let source = 'cache';
  if (liveReads && cacheReads) source = 'mixed';
  else if (liveReads) source = 'live';
  return {
    model: model.id,
    prompt_version: model.prompt_version,
    runtime_revision: model.runtime_revision,
    source,
    cache_reads: cacheReads,
    live_reads: liveReads
  };
}

function read(task, text) {
  const id = cacheKey(task, text);
  if (memory.has(id)) {
    note('cache');
    return memory.get(id);
  }
  if (cache[id] && cache[id].value) {
    memory.set(id, cache[id].value);
    note('cache');
    return cache[id].value;
  }
  if (process.env.PALE_JUDGE_CACHE_ONLY === '1') throw new Error('reader cache miss for ' + task);
  const value = live(task, text);
  note('live');
  remember(id, task, value);
  return value;
}

module.exports = {read, model, prompts, cacheKey, beginGrade, readerReport};
