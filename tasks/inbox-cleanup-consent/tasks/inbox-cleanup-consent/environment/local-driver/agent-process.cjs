'use strict';
// Starts the evaluated adapter in its own process. The child sees the copied module and a short environment.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');

function bwrapAvailable() {
  const found = spawnSync('bwrap', ['--version'], {encoding: 'utf8'});
  return found.status === 0;
}

function startAgentProcess(modulePath) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-icc-agent-'));
  const target = path.join(sandbox, 'agent.cjs');
  fs.copyFileSync(path.resolve(modulePath), target);
  const env = {PATH: process.env.PATH || '', PALE_AGENT_FILE: target};
  if (process.env.PALE_OBSERVATION_LOG) env.PALE_OBSERVATION_LOG = process.env.PALE_OBSERVATION_LOG;
  const worker = path.join(__dirname, 'agent-worker.cjs');
  let command = process.execPath;
  let args = [worker];
  let boundary = 'subprocess';
  if (bwrapAvailable()) {
    command = 'bwrap';
    args = [
      '--unshare-all',
      '--die-with-parent',
      '--ro-bind', sandbox, sandbox,
      '--ro-bind', worker, worker,
      '--ro-bind', process.execPath, process.execPath,
      '--proc', '/proc',
      '--dev', '/dev',
      process.execPath,
      worker
    ];
    boundary = 'bwrap';
  }
  const child = spawn(command, args, {
    cwd: sandbox,
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let buffer = '';
  const pending = [];
  let closed = null;
  function pushLine(line) {
    if (pending.length) pending.shift().resolve(line);
    else {
      child._lines = child._lines || [];
      child._lines.push(line);
    }
  }
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let cut = buffer.indexOf('\n');
    while (cut >= 0) {
      const line = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 1);
      if (line) pushLine(line);
      cut = buffer.indexOf('\n');
    }
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  child.once('exit', (code) => {
    closed = new Error('agent process exited ' + code + ' ' + stderr.slice(-400));
    while (pending.length) pending.shift().reject(closed);
  });
  function nextLine() {
    if (child._lines && child._lines.length) return Promise.resolve(child._lines.shift());
    if (closed) return Promise.reject(closed);
    return new Promise((resolve, reject) => pending.push({resolve, reject}));
  }
  function writeLine(payload) {
    return new Promise((resolve, reject) => {
      const ok = child.stdin.write(JSON.stringify(payload) + '\n', (err) => { if (err) reject(err); });
      if (ok) resolve();
      else child.stdin.once('drain', resolve);
    });
  }
  const ready = nextLine().then((line) => {
    const message = JSON.parse(line);
    if (!message.ready) throw new Error('agent process was not ready');
    return message.pid;
  });
  return {
    sandbox,
    boundary,
    ready,
    async next(ctx) {
      await writeLine(ctx);
      const line = await nextLine();
      const message = JSON.parse(line);
      if (message.error) throw new Error(message.error);
      return message.step;
    },
    async close() {
      try { await writeLine({bye: true}); } catch (err) { /* already closed */ }
      child.kill();
      fs.rmSync(sandbox, {recursive: true, force: true});
    }
  };
}

function createRemoteAgent(modulePath) {
  const proc = startAgentProcess(modulePath);
  let pid = null;
  return {
    name: path.basename(modulePath, '.cjs'),
    processInfo: null,
    async next(ctx) {
      if (pid == null) {
        pid = await proc.ready;
        this.processInfo = {boundary: proc.boundary, pid};
      }
      return proc.next(ctx);
    },
    async close() {
      await proc.close();
    }
  };
}

module.exports = {createRemoteAgent, startAgentProcess};
