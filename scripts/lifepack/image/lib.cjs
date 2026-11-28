'use strict';
// Shared helpers for the scripts that run inside a task container.
// Paths come from the environment so the same scripts also run outside Docker.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const PALE_ROOT = process.env.PALE_ROOT || '/opt/pale';
const TASK_DIR = process.env.PALE_TASK_DIR || '/opt/pale-task';
const STATE_DIR = process.env.PALE_STATE_DIR || '/var/pale/state';
// Only the service account can read this folder: the task's records and the checks for each session's step data.
const PRIVATE_DIR = path.join(TASK_DIR, 'private');
const RUN_ID = 'task';
const REGISTRY = path.join(PALE_ROOT, 'apps.registry.json');
const SESSION_FILE = path.join(STATE_DIR, 'session.json');
const CHAT_FILE = path.join(STATE_DIR, 'chat.json');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
};
const taskConfig = () => readJson(path.join(PRIVATE_DIR, 'task.json'));

// The command line of one App's MCP server on the Infra connection. Only the service account can run it,
// because only that account can read the state directory.
function serverArgs(app, role) {
  return [path.join(PALE_ROOT, 'runtime/mcp-server.cjs'), '--app', app, '--role', role, '--run', RUN_ID,
    '--state-dir', STATE_DIR, '--registry', REGISTRY];
}

// The agent's side has one entrance: `pale-mcp NAME` (an App, or "chat" for the user chat). task.toml declares the
// same command for the evaluated agent, so the reference solution and a model use the same door.
const AGENT_COMMAND = 'pale-mcp';

// The verifier starts management commands as root. The App servers then run as the owner of the state
// directory, so every state file keeps one owner.
function stateOwner() {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return {};
  try {
    const st = fs.statSync(STATE_DIR);
    return st.uid === 0 ? {} : { uid: st.uid, gid: st.gid };
  } catch { return {}; }
}

// A small MCP client over stdio. One connection per server process.
class Conn {
  constructor(app, command, args, clientName = 'pale-task', identity = {}) {
    this.app = app;
    this.seq = 0;
    this.pending = new Map();
    this.stderr = '';
    this.clientName = clientName;
    this.child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], ...identity });
    const fail = (why) => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(`${app} server ${why}: ${this.stderr}`)); }
      this.pending.clear();
    };
    this.child.on('error', (e) => fail(`could not start (${command}: ${e.message})`));
    this.child.stderr.on('data', (b) => { this.stderr += b; });
    readline.createInterface({ input: this.child.stdout }).on('line', (line) => {
      let m;
      try { m = JSON.parse(line); } catch { return; }
      const p = this.pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(m.id);
      p.resolve(m);
    });
    this.child.on('exit', () => fail('exited'));
  }

  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${this.app} ${method} timed out`)); }, 60000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  async initialize() {
    const r = await this.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: this.clientName, version: '0.1.0' } });
    if (r.error) throw new Error(`${this.app} initialize: ${JSON.stringify(r.error)}`);
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
    return this;
  }

  async call(name, args = {}) {
    const r = await this.request('tools/call', { name, arguments: args });
    if (r.error) throw new Error(`${name}: ${JSON.stringify(r.error)}`);
    return r.result.structuredContent;
  }

  async close() {
    if (this.child.exitCode !== null) return;
    const done = new Promise((resolve) => this.child.once('exit', resolve));
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill('SIGTERM'), 2000);
    await done;
    clearTimeout(timer);
  }
}

// Opens connections on demand and closes them all when fn returns.
// role 'agent': what the evaluated agent has. open('chat') is the user chat.
// role 'infra': the management connection of each App, for the service account and the verifier.
async function withConns(role, clientName, fn) {
  const conns = new Map();
  const start = (app) => (role === 'agent'
    ? new Conn(app, AGENT_COMMAND, [app], clientName)
    : new Conn(app, process.execPath, serverArgs(app, role), clientName, stateOwner()));
  const open = async (app) => {
    if (!conns.has(app)) conns.set(app, await start(app).initialize());
    return conns.get(app);
  };
  try {
    return await fn(open);
  } finally {
    await Promise.allSettled([...conns.values()].map((c) => c.close()));
  }
}

module.exports = { PALE_ROOT, TASK_DIR, PRIVATE_DIR, STATE_DIR, RUN_ID, REGISTRY, SESSION_FILE, CHAT_FILE, readJson, writeJson, taskConfig, serverArgs, Conn, withConns };
