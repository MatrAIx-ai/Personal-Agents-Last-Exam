#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('../../../runtime/client.cjs');
const { prepareRun } = require('../tasks/grocery-cap-limit-code/local-driver/registry.cjs');
const { loadSeed } = require('../.deps/keelcard/src/load-seed.cjs');

const taskRoot = path.resolve(__dirname, '../tasks/grocery-cap-limit-code');
const workspace = path.join(taskRoot, 'environment/workspace');
const seedClock = '2026-11-18T09:00:00-08:00';
const evidence = path.resolve(__dirname, '../demo/grocery-cap-limit-code/evidence/reset.json');

function read(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
  const prepared = prepareRun('reset');
  const registryFile = prepared.registryFile;
  const dir = prepared.stateDir;
  const infra = {};
  const agent = {};
  try {
    for (const id of ['keelcard', 'mail', 'freshcart', 'webstub']) {
      infra[id] = new Client(id, 'infra', 'gclreset', dir, 'gcl-reset', { registry: registryFile });
      agent[id] = new Client(id, 'agent', 'gclreset', dir, 'gcl-reset-agent', { registry: registryFile });
      await infra[id].initialize();
      await agent[id].initialize();
    }
    const keelSnap = await infra.keelcard.call('env.snapshot');
    const keelLoaded = await loadSeed(infra.keelcard, {
      expected_version: keelSnap.version,
      request_id: 'reset-seed',
      data: keelSnap.snapshot.data,
      binding: read(path.join(workspace, 'keelcard/binding.json')),
      policies: read(path.join(workspace, 'keelcard/policies.json')),
      bundle: keelSnap.snapshot.resources.bundle,
      virtual_now: seedClock
    });
    if (keelLoaded.status !== 'ready') throw new Error('keelcard ' + keelLoaded.status);
    for (const id of ['mail', 'freshcart', 'webstub']) {
      const snap = await infra[id].call('env.snapshot');
      const loaded = await infra[id].call('env.load_seed', {
        expected_version: snap.version,
        request_id: 'reset-seed',
        data: read(path.join(workspace, id, 'seed.json')),
        binding: read(path.join(workspace, id, 'binding.json')),
        policies: read(path.join(workspace, id, 'policies.json')),
        bundle: read(path.join(workspace, id, 'bundle.json')),
        virtual_now: seedClock
      });
      if (loaded.status !== 'ready') throw new Error(id + ' ' + loaded.status + ' ' + (loaded.message || ''));
    }
    const before = await infra.freshcart.call('env.snapshot');
    const changed = await agent.freshcart.call('freshcart.cart.set', {
      lines: [{ item_id: 'item-oats', qty: 1 }],
      expected_version: before.version,
      request_id: 'reset-mutate'
    });
    if (changed.status !== 'committed') throw new Error('mutate ' + changed.status);
    const dirty = await infra.freshcart.call('env.snapshot');
    const mailBefore = await infra.mail.call('env.snapshot');
    const delivered = await infra.mail.call('env.apply_event', {
      expected_version: mailBefore.version,
      event: {
        event_id: 'reset-probe-mail',
        at: seedClock,
        operation: 'mail.deliver',
        payload: {
          id: 'msg-reset-probe',
          account_id: 'mail-grace',
          thread_id: 'thread-reset-probe',
          from: 'Probe <probe@mailbox.example>',
          to: ['grace.adeyemi@mailbox.example'],
          subject: 'Reset probe',
          body: 'This message is removed by env.reset.',
          sent_at: seedClock,
          received_at: seedClock,
          folder: 'inbox',
          read: false,
          attachments: []
        }
      }
    });
    if (delivered.status !== 'committed') throw new Error('mail probe ' + delivered.status + ' ' + (delivered.message || ''));
    for (const id of ['keelcard', 'mail', 'freshcart', 'webstub']) {
      const snap = await infra[id].call('env.snapshot');
      const reset = await infra[id].call('env.reset', { expected_version: snap.version });
      if (reset.status !== 'ready') throw new Error(id + ' reset ' + reset.status);
    }
    const fresh = (await infra.freshcart.call('env.snapshot')).snapshot;
    const keel = (await infra.keelcard.call('env.snapshot')).snapshot;
    const mail = (await infra.mail.call('env.snapshot')).snapshot;
    const card = keel.data.cards.find(row => row.card_id === 'card-4417');
    const rollout = fresh.data.orders.filter(row => !row.historical);
    const probe = mail.data.messages.find(row => row.id === 'msg-reset-probe');
    if (fresh.data.cart.length !== before.snapshot.data.cart.length) throw new Error('cart was not restored');
    if (fresh.virtual_now !== seedClock || keel.virtual_now !== seedClock) throw new Error('clock was not restored');
    if (card.limits.per_transaction !== 7500) throw new Error('card limit ' + card.limits.per_transaction);
    if (probe) throw new Error('probe mail survived reset');
    if (rollout.length) throw new Error('rollout orders survived reset');
    const report = {
      seed_clock: seedClock,
      mutated_cart_lines: dirty.snapshot.data.cart.length,
      restored_cart_lines: fresh.data.cart.length,
      restored_clock: fresh.virtual_now,
      keelcard_clock: keel.virtual_now,
      card_limit_cents: card.limits.per_transaction,
      inbox_messages: mail.data.messages.length,
      probe_message_present: Boolean(probe),
      prior_orders: fresh.data.orders.filter(row => row.historical).length,
      rollout_orders: rollout.map(row => row.id),
      list_total_cents: fresh.data.list_total_cents,
      command: 'node tasks/grocery-cap-limit-code/tools/reset-check.cjs'
    };
    fs.mkdirSync(path.dirname(evidence), { recursive: true });
    fs.writeFileSync(evidence, JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } finally {
    for (const id of Object.keys(agent)) await agent[id].close().catch(() => {});
    for (const id of Object.keys(infra)) await infra[id].close().catch(() => {});
    fs.rmSync(prepared.runRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(error.stack + '\n');
  process.exit(1);
});
