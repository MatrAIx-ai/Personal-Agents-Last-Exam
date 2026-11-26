#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('../../../runtime/client.cjs');

const repo = path.resolve(__dirname, '../../..');
const registryFile = path.join(repo, 'grocery-cap.registry.json');
const seedClock = '2026-11-18T09:00:00-08:00';

function registry() {
  fs.writeFileSync(registryFile, JSON.stringify({
    schema_version: 1,
    initial_time: seedClock,
    apps: [
      { app_id: 'freshcart', version: '1.0.0', path: 'tasks/grocery-cap-limit-code/tasks/grocery-cap-limit-code/environment/apps/freshcart' }
    ]
  }, null, 2));
}

async function main() {
  registry();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gcl-reset-'));
  const infra = new Client('freshcart', 'infra', 'gclreset', dir, 'gcl-reset', { registry: registryFile });
  const agent = new Client('freshcart', 'agent', 'gclreset', dir, 'gcl-reset-agent', { registry: registryFile });
  await infra.initialize();
  await agent.initialize();
  try {
    const opened = await infra.call('env.snapshot');
    const loaded = await infra.call('env.load_seed', {
      expected_version: opened.version,
      request_id: 'reset-seed',
      data: JSON.parse(fs.readFileSync(path.join(__dirname, '../tasks/grocery-cap-limit-code/environment/workspace/freshcart/seed.json'), 'utf8')),
      binding: JSON.parse(fs.readFileSync(path.join(__dirname, '../tasks/grocery-cap-limit-code/environment/workspace/freshcart/binding.json'), 'utf8')),
      policies: JSON.parse(fs.readFileSync(path.join(__dirname, '../tasks/grocery-cap-limit-code/environment/workspace/freshcart/policies.json'), 'utf8')),
      bundle: JSON.parse(fs.readFileSync(path.join(__dirname, '../tasks/grocery-cap-limit-code/environment/workspace/freshcart/bundle.json'), 'utf8')),
      virtual_now: seedClock
    });
    if (loaded.status !== 'ready') throw new Error('seed ' + loaded.status);
    const before = await infra.call('env.snapshot');
    const changed = await agent.call('freshcart.cart.set', {
      lines: [{ item_id: 'item-oats', qty: 1 }],
      expected_version: before.version,
      request_id: 'reset-mutate'
    });
    if (changed.status !== 'committed') throw new Error('mutate ' + changed.status);
    const dirty = await infra.call('env.snapshot');
    if (dirty.snapshot.data.cart.length !== 1) throw new Error('cart did not change');
    const reset = await infra.call('env.reset', { expected_version: dirty.version });
    if (reset.status !== 'ready') throw new Error('reset ' + reset.status);
    const after = await infra.call('env.snapshot');
    const sameCart = JSON.stringify(after.snapshot.data.cart) === JSON.stringify(before.snapshot.data.cart);
    const sameClock = after.snapshot.virtual_now === seedClock;
    if (!sameCart || !sameClock) throw new Error('reset did not restore the seed');
    const report = {
      app_id: 'freshcart',
      seed_clock: seedClock,
      mutated_lines: dirty.snapshot.data.cart.length,
      restored_lines: after.snapshot.data.cart.length,
      restored_clock: after.snapshot.virtual_now,
      list_total_cents: after.snapshot.data.list_total_cents
    };
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } finally {
    await agent.close();
    await infra.close();
    fs.rmSync(registryFile, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(error.stack + '\n');
  process.exit(1);
});
