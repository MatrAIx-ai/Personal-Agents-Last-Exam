'use strict';
// Starts the evaluated adapter in an isolated process. The child receives the copied module and a short environment.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');

function isElf(file) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(4);
  const n = fs.readSync(fd, buf, 0, 4, 0);
  fs.closeSync(fd);
  return n === 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46;
}

function resolveNodeBinary(start) {
  let current = fs.realpathSync(start);
  const seen = new Set();
  while (!seen.has(current)) {
    seen.add(current);
    if (isElf(current)) return current;
    const text = fs.readFileSync(current, 'utf8');
    const execLine = text.match(/\bexec\s+(\/\S*node\S*)/);
    if (execLine) {
      current = fs.realpathSync(execLine[1]);
      continue;
    }
    const shebang = text.match(/^#!\s*(\S+)(?:\s+(\S+))?/);
    if (!shebang) break;
    if (path.basename(shebang[1]) === 'env' && shebang[2]) {
      const found = spawnSync('/bin/sh', ['-c', 'command -v ' + shebang[2]], {encoding: 'utf8'});
      if (found.status === 0 && found.stdout.trim()) {
        current = fs.realpathSync(found.stdout.trim());
        continue;
      }
    }
    if (path.basename(shebang[1]) === 'sh' || path.basename(shebang[1]) === 'bash') break;
    current = fs.realpathSync(shebang[1]);
  }
  throw new Error('the node binary could not be resolved');
}

function bwrapPath() {
  const found = spawnSync('/bin/sh', ['-c', 'command -v bwrap'], {encoding: 'utf8'});
  const file = found.status === 0 ? found.stdout.trim() : '';
  if (!file || !fs.existsSync(file)) return null;
  const version = spawnSync(file, ['--version'], {encoding: 'utf8'});
  return version.status === 0 ? file : null;
}

function permissionFlag() {
  for (const flag of ['--permission', '--experimental-permission']) {
    const probe = spawnSync(process.execPath, [flag, '-e', 'process.exit(0)'], {encoding: 'utf8'});
    if (probe.status === 0) return flag;
  }
  return null;
}

function libraryBinds(binary) {
  const listed = spawnSync('ldd', [binary], {encoding: 'utf8'});
  if (listed.status !== 0) throw new Error('shared libraries for node could not be listed');
  const binds = new Map();
  function add(src) {
    if (!src || !src.startsWith('/') || !fs.existsSync(src)) return;
    const resolved = fs.realpathSync(src);
    binds.set(src, resolved);
    binds.set(resolved, resolved);
  }
  for (const line of listed.stdout.split('\n')) {
    const arrow = line.match(/=>\s+(\/\S+)/);
    if (arrow) add(arrow[1]);
    const direct = line.match(/^\s*(\/\S+)/);
    if (direct && line.indexOf('=>') < 0) add(direct[1]);
  }
  if (!binds.size) throw new Error('node has no shared library list');
  return binds;
}

function bwrapArgs(nodeBin, sandbox, worker) {
  const args = ['--unshare-all', '--die-with-parent', '--chdir', '/pale/agent', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp'];
  args.push('--ro-bind', nodeBin, nodeBin);
  args.push('--ro-bind', sandbox, '/pale/agent');
  args.push('--ro-bind', worker, '/pale/worker.cjs');
  for (const [dest, src] of libraryBinds(nodeBin)) args.push('--ro-bind', src, dest);
  args.push(nodeBin, '/pale/worker.cjs');
  return args;
}

function withLogBind(args, logPath) {
  if (!logPath) return args;
  const dir = path.dirname(path.resolve(logPath));
  fs.mkdirSync(dir, {recursive: true});
  return args.slice(0, -2).concat(['--bind', dir, dir], args.slice(-2));
}

function probeBwrap(command, args) {
  const probeArgs = args.slice(0, -1).concat(['-e', 'process.stdout.write("ok\\n")']);
  const probe = spawnSync(command, probeArgs, {encoding: 'utf8', timeout: 15000});
  if (probe.status !== 0 || probe.stdout.indexOf('ok') < 0) {
    throw new Error('isolated node did not start ' + String(probe.stderr || probe.stdout || '').slice(-400));
  }
}

function startAgentProcess(modulePath) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-icc-agent-'));
  const target = path.join(sandbox, 'agent.cjs');
  fs.copyFileSync(path.resolve(modulePath), target);
  const worker = path.join(__dirname, 'agent-worker.cjs');
  const nodeBin = resolveNodeBinary(process.execPath);
  let command = nodeBin;
  let args = [];
  let boundary = '';
  let cwd = sandbox;
  let agentFile = target;
  const bubblewrap = bwrapPath();
  if (bubblewrap) {
    args = withLogBind(bwrapArgs(nodeBin, sandbox, worker), process.env.PALE_OBSERVATION_LOG);
    probeBwrap(bubblewrap, args);
    command = bubblewrap;
    boundary = 'bwrap';
    cwd = sandbox;
    agentFile = '/pale/agent/agent.cjs';
  } else {
    const flag = permissionFlag();
    if (!flag) throw new Error('no isolated node runtime is available');
    args = [flag, '--allow-fs-read=' + sandbox, '--allow-fs-read=' + worker];
    if (process.env.PALE_OBSERVATION_LOG) {
      const dir = path.dirname(path.resolve(process.env.PALE_OBSERVATION_LOG));
      args.push('--allow-fs-read=' + dir, '--allow-fs-write=' + dir);
    }
    args.push(worker);
    boundary = 'permission';
  }
  const env = {PATH: '/bin', HOME: cwd, PALE_AGENT_FILE: agentFile, TMPDIR: '/tmp'};
  if (process.env.PALE_OBSERVATION_LOG) env.PALE_OBSERVATION_LOG = process.env.PALE_OBSERVATION_LOG;
  const child = spawn(command, args, {cwd, env, stdio: ['pipe', 'pipe', 'pipe']});
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

module.exports = {createRemoteAgent, startAgentProcess, resolveNodeBinary};
