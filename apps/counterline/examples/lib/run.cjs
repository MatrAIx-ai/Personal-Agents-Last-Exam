'use strict';
// Shared by the scripts that run Counterline through the public runtime: find the PALE checkout, open
// separate Infra and Agent MCP connections on a fresh run, and close them cleanly.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const pkg = path.resolve(__dirname, '../..');
let root = pkg;
while (!fs.existsSync(path.join(root, 'runtime/client.cjs'))) { const up = path.dirname(root); if (up === root) throw Error('Run inside the PALE checkout'); root = up; }
const {Client} = require(path.join(root, 'runtime/client.cjs'));

async function openRun(run, {registry = path.join(pkg, 'registry.json')} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `counterline-${run}-`)), clients = [];
  const close = async () => { await Promise.allSettled(clients.map(c => c.close())); fs.rmSync(dir, {recursive: true, force: true}); };
  try {
    const infra = new Client('counterline', 'infra', run, dir, run + '-infra', {registry}); clients.push(infra); await infra.initialize();
    const agent = new Client('counterline', 'agent', run, dir, run + '-agent', {registry}); clients.push(agent); await agent.initialize();
    const snap = () => infra.call('env.snapshot');
    return {
      infra, agent, snap, close,
      data: async () => (await snap()).snapshot.data,
      async load(data, binding, virtual_now) {
        const s = await snap();
        const r = await infra.call('env.load_seed', {expected_version: s.version, request_id: 'load-' + run, data, binding, virtual_now});
        if (r.status !== 'ready') throw Error(JSON.stringify(r).slice(0, 400));
        return r;
      },
      async apply(event) {
        const s = await snap();
        const r = await infra.call('env.apply_event', {expected_version: s.version, event});
        assert.equal(r.status, 'committed', JSON.stringify(r));
        return r;
      }
    };
  } catch (e) { await close(); throw e; }
}
module.exports = {pkg, root, Client, openRun};
