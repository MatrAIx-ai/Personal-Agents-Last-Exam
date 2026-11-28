#!/usr/bin/env node
'use strict';
// CLI for the local stand-in runner.
//   node run.cjs --plan <plan.json> --out <run.json> [--hinted] [--run-id ID] [--setting A|B] [--variant NAME]
//   node run.cjs --agent-module <module.cjs> --out <run.json> [--hinted]
// An --agent-module exports {createAgent()} with describe() and runSession(ctx).
// That module is the adapter seam for a later model command. This package does not run one.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {Run} = require('./driver.cjs');
const {PlanAgent} = require('./plan-agent.cjs');

class ModuleAgent {
  constructor(modulePath) {
    this.modulePath = path.resolve(modulePath);
    this.child = null;
    this.sandbox = null;
    this.queue = [];
    this.waiters = [];
    this.buffer = '';
  }
  describe() {
    return {kind: 'module', name: path.basename(this.modulePath)};
  }
  async start() {
    this.sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'rpr-agent-'));
    fs.copyFileSync(this.modulePath, path.join(this.sandbox, 'agent.cjs'));
    fs.copyFileSync(path.join(__dirname, 'module-host.cjs'), path.join(this.sandbox, 'host.cjs'));
    this.child = spawnConfined(this.sandbox, process.execPath, ['host.cjs']);
    this._started = false;
    let stderr = '';
    this.ready = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });
    this.child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    this.child.on('exit', code => {
      if (!this._started && this._rejectReady) {
        this._rejectReady(new Error('module exited before it was ready (' + code + ') ' + stderr.slice(0, 500)));
      }
    });
    this.child.stdout.on('data', chunk => {
      this.buffer += chunk.toString('utf8');
      let index = this.buffer.indexOf('\n');
      while (index >= 0) {
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 1);
        if (line.trim()) {
          const message = JSON.parse(line);
          if (message.type === 'ready') {
            this._started = true;
            if (this._resolveReady) this._resolveReady();
          } else {
            const waiter = this.waiters.shift();
            if (waiter) waiter(message);
            else this.queue.push(message);
          }
        }
        index = this.buffer.indexOf('\n');
      }
    });
    await this.ready;
  }
  nextMessage() {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise(resolve => this.waiters.push(resolve));
  }
  send(message) {
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  async runSession(ctx) {
    if (!this.child) await this.start();
    this.send({type: 'turn', context: ctx.publicContext});
    for (;;) {
      const message = await this.nextMessage();
      if (message.type === 'call') {
        const result = await ctx.call(message.name, message.args || {});
        this.send({type: 'result', id: message.id, result});
      } else if (message.type === 'final') {
        ctx.final(message.text || '');
      } else if (message.type === 'done') {
        return;
      } else if (message.type === 'error') {
        throw new Error(message.message || 'agent process failed');
      }
    }
  }
  async stop() {
    if (this.child) {
      this.child.kill('SIGKILL');
      if (this.child.stdin) this.child.stdin.destroy();
      if (this.child.stdout) this.child.stdout.destroy();
      if (this.child.stderr) this.child.stderr.destroy();
      this.child.unref();
    }
    if (this.sandbox) fs.rmSync(this.sandbox, {recursive: true, force: true});
  }
}

const GUARD_SOURCE = `'use strict';
const fs = require('node:fs');
const readable = [];
for (const file of process.argv.slice(2)) {
  try {
    fs.readFileSync(file);
    readable.push(file);
  } catch (err) {
    if (err.code !== 'ENOENT' && err.code !== 'EACCES' && err.code !== 'EPERM') readable.push(file);
  }
}
if (readable.length) {
  process.stderr.write(JSON.stringify({readable}) + '\\n');
  process.exit(2);
}
`;

function privatePaths() {
  const task = path.resolve(__dirname, '../..');
  return [
    path.join(task, 'tests/rubrics.yaml'),
    path.join(task, 'tests/hints.md'),
    path.join(task, 'context/user/script.json'),
    path.join(task, 'context/user/goals.json'),
    path.join(task, 'context/user/history.json'),
    path.join(task, 'context/timeline.yaml'),
  ];
}

function spawnConfined(cwd, executable, args) {
  fs.writeFileSync(path.join(cwd, 'guard.cjs'), GUARD_SOURCE);
  const scriptName = path.basename(args[0]);
  const rest = args.slice(1).map(item => JSON.stringify(item)).join(' ');
  const guardArgs = privatePaths().map(item => JSON.stringify(item)).join(' ');
  const nodeDir = path.dirname(process.execPath);
  const script = `
set -eu
SANDBOX=${JSON.stringify(cwd)}
NODE=$(command -v node)
UMOUNT=$(command -v umount)
JAIL=$(mktemp -d)
mount -t tmpfs -o mode=755 tmpfs "$JAIL"
mkdir -p "$JAIL/bin" "$JAIL/tmp" "$JAIL/work" "$JAIL/oldroot" "$JAIL/proc"
cp "$NODE" "$JAIL/bin/node"
cp "$UMOUNT" "$JAIL/bin/umount"
copy_lib() {
  src="$1"
  [ -f "$src" ] || return 0
  mkdir -p "$JAIL$(dirname "$src")"
  cp "$src" "$JAIL$src"
}
for bin in "$NODE" "$UMOUNT"; do
  ldd "$bin" | while read -r line; do
    src=$(printf '%s\\n' "$line" | awk '{print $3}')
    lib=$(printf '%s\\n' "$line" | awk '{print $1}')
    if [ -n "$src" ] && [ "$src" != "not" ]; then copy_lib "$src"; fi
    case "$lib" in /*) copy_lib "$lib" ;; esac
  done
done
copy_lib /lib64/ld-linux-x86-64.so.2
cp -R "$SANDBOX"/. "$JAIL/work/"
mount -t proc proc "$JAIL/proc"
cd "$JAIL"
pivot_root . oldroot
/bin/umount -l /oldroot
/bin/node /work/guard.cjs ${guardArgs}
exec /bin/node /work/${scriptName} ${rest}
`;
  return spawn('unshare', [
    '--user', '--mount', '--pid', '--fork', '--map-root-user', '--propagation', 'private',
    'bash', '-c', script,
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {PATH: [nodeDir, '/usr/bin', '/bin', '/usr/sbin'].join(':'), HOME: '/tmp'},
  });
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--hinted') out.hinted = true;
    else if (token.startsWith('--')) out[token.slice(2)] = argv[++i];
  }
  return out;
}

module.exports = {ModuleAgent, spawnConfined, privatePaths};

async function main() {
  const options = args(process.argv.slice(2));
  if (!options.out || !(options.plan || options['agent-module'])) {
    console.error('usage: run.cjs (--plan PLAN.json | --agent-module MOD.cjs) --out RUN.json [--hinted] [--run-id ID] [--setting A|B] [--variant NAME]');
    process.exit(2);
  }
  const agent = options.plan
    ? new PlanAgent(path.resolve(options.plan))
    : new ModuleAgent(options['agent-module']);
  const run = new Run({
    agent,
    hinted: !!options.hinted,
    runId: options['run-id'],
    setting: options.setting,
    variant: options.variant,
  });
  let result;
  try {
    result = await run.execute();
  } finally {
    if (agent.stop) await agent.stop();
  }
  fs.mkdirSync(path.dirname(path.resolve(options.out)), {recursive: true});
  fs.writeFileSync(options.out, JSON.stringify(result));
  const delivered = result.events.filter(event => event.status === 'delivered').map(event => event.id);
  console.log(JSON.stringify({
    run_id: result.run_id,
    label: result.label,
    setting: result.setting,
    variant: result.variant,
    hinted: result.hinted,
    out: options.out,
    tool_calls: result.tool_calls.length,
    tool_errors: result.tool_calls.filter(call => call.error || call.status === 'error').length,
    delivered_events: delivered,
  }));
}

if (require.main === module) {
  main().catch(err => { console.error(err.stack || err); process.exit(1); });
}
