'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {ModuleAgent, spawnConfined, privatePaths} = require('./run.cjs');

const targets = privatePaths();

function runReader() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'rpr-probe-'));
  const reader = `
const fs = require('node:fs');
const paths = process.argv.slice(2);
const readable = [];
for (const file of paths) {
  try {
    fs.readFileSync(file);
    readable.push(file);
  } catch (err) {
    if (err.code !== 'ENOENT' && err.code !== 'EACCES' && err.code !== 'EPERM') readable.push(file);
  }
}
process.stdout.write(JSON.stringify({readable}) + '\\n');
`;
  fs.writeFileSync(path.join(sandbox, 'read.cjs'), reader);
  const child = spawnConfined(sandbox, process.execPath, ['read.cjs', ...targets]);
  let out = '';
  let err = '';
  child.stdout.on('data', chunk => { out += chunk.toString('utf8'); });
  child.stderr.on('data', chunk => { err += chunk.toString('utf8'); });
  return new Promise((resolve, reject) => {
    child.on('close', code => {
      fs.rmSync(sandbox, {recursive: true, force: true});
      if (code !== 0 || !out.trim()) reject(new Error(err || out || ('reader exited ' + code)));
      else resolve(JSON.parse(out));
    });
  });
}

async function runModule() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpr-module-'));
  const modulePath = path.join(dir, 'reader-agent.cjs');
  const source = `'use strict';
const fs = require('node:fs');
exports.createAgent = () => ({
  describe() { return {name: 'reader'}; },
  async runSession(ctx) {
    const paths = ${JSON.stringify(targets)};
    const readable = [];
    for (const file of paths) {
      try {
        fs.readFileSync(file);
        readable.push(file);
      } catch (err) {
        if (err.code !== 'ENOENT' && err.code !== 'EACCES' && err.code !== 'EPERM') readable.push(file);
      }
    }
    ctx.final(JSON.stringify({readable, hint: Object.prototype.hasOwnProperty.call(ctx, 'hint')}));
  },
});
`;
  fs.writeFileSync(modulePath, source);
  const agent = new ModuleAgent(modulePath);
  let text = '';
  try {
    await agent.runSession({
      publicContext: {
        session: 'session-1',
        now: '2026-02-10T10:12:00-08:00',
        system: 'Standing notes live in Notes.',
        userMessage: null,
        systemNotice: null,
        tools: [],
      },
      call: async () => ({status: 'ok'}),
      final: value => { text = value; },
    });
  } finally {
    await agent.stop();
    fs.rmSync(dir, {recursive: true, force: true});
  }
  return JSON.parse(text);
}

async function main() {
  const probe = await runReader();
  const live = await runModule();
  process.stdout.write(JSON.stringify({
    readable: probe.readable || [],
    module_readable: live.readable || [],
    hint: live.hint === true,
  }) + '\n');
  process.exit(0);
}

main().catch(err => {
  process.stderr.write(String(err && err.stack || err) + '\n');
  process.exit(1);
});
