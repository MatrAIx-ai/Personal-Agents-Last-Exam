#!/usr/bin/env node
'use strict';
// Publishes Switchback's stored notices to real Mail through Messaging, then
// reads each one back with Mail's own Agent tool. Run from a full checkout:
//   node apps/switchback/examples/publish-to-mail.cjs
//
// When it runs: after the write or event that creates notices and before the
// next env.advance_time, because Messaging delivers at the receiver's current
// virtual time.
// Which notices are new: Switchback does not record delivery. The script offers
// every stored notice in creation order with the notice ID as request_id and
// CloudEvents id. Messaging keeps the receipts, so a notice it already
// delivered comes back as a duplicate with its original event_id and Mail is
// not changed again.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const {prepare} = require(path.join(root, 'runtime/prepare.cjs'));
const mailSeed = require('./messaging/mail-seed.json');

async function seedMail(dir, run, clients) {
  const mail = new Client('mail', 'infra', run, dir, 'switchback-mail-seed', {registry: path.join(root, 'examples/registry.mail.json')});
  clients.push(mail); await mail.initialize();
  const snap = await mail.call('env.snapshot');
  const loaded = await mail.call('env.load_seed', {expected_version: snap.version, request_id: 'mail-dana-seed', data: mailSeed.data, binding: mailSeed.binding, policies: snap.snapshot.policies});
  assert.equal(loaded.status, 'ready', JSON.stringify(loaded));
  return mail;
}

async function router(dir, run, config, clients) {
  const r = new Client(null, null, null, null, 'switchback-publisher', {commandArgs: [path.join(root, 'runtime/messaging/service.cjs'),
    '--config', path.join(__dirname, 'messaging', config), '--publisher', 'switchback', '--run', run, '--state-dir', dir]});
  clients.push(r); await r.initialize();
  return r;
}

async function publishAll(r, notices) {
  const out = [];
  for (const n of notices) out.push({notice_id: n.id, receipt: await r.call('router.publish', {request_id: n.id, message: n.message})});
  return out;
}

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchback-to-mail-')), clients = [];
  const prepared = prepare(path.join(root, 'apps/switchback'));
  try {
    // 1. A closure event creates a notice in Switchback through real Core.
    const sb = new Client('switchback', 'infra', 'mail', path.join(prepared.root, 'state'), 'switchback-infra', {registry: prepared.registry});
    clients.push(sb); await sb.initialize();
    const before = await sb.call('env.snapshot');
    const applied = await sb.call('env.apply_event', {expected_version: before.version, event: require('./scenario.json')});
    assert.equal(applied.status, 'committed');
    const notices = (await sb.call('env.snapshot')).snapshot.data.notices;
    assert.equal(notices.length, 1);
    const sbBefore = JSON.stringify((await sb.call('env.snapshot')).snapshot.data);

    // 2. Committed delivery: publish, then read it back as the Mail Agent.
    await seedMail(dir, 'delivered', clients);
    const r = await router(dir, 'delivered', 'config.json', clients);
    const [first] = await publishAll(r, notices);
    assert.equal(first.receipt.status, 'committed', JSON.stringify(first.receipt));
    const reader = new Client('mail', 'agent', 'delivered', dir, 'mail-reader', {registry: path.join(root, 'examples/registry.mail.json')});
    clients.push(reader); await reader.initialize();
    const got = await reader.call('mail.get', {id: first.receipt.event_id});
    assert.equal(got.status, 'ok');
    assert.equal(got.message.subject, notices[0].message.data.content.title);
    assert.equal(got.message.body, notices[0].message.data.content.body.text);

    // 3. Retry: offering the same notices again changes nothing in Mail.
    const [again] = await publishAll(r, notices);
    assert.equal(again.receipt.duplicate, true);
    assert.equal(again.receipt.event_id, first.receipt.event_id);
    const inbox = await reader.call('mail.search', {query: 'res-0001'});
    assert.equal(inbox.status, 'ok');

    // 4. Rejected before delivery: no grant for the recipient. Mail and Switchback are unchanged.
    const denyMail = await seedMail(dir, 'denied', clients);
    const mailBefore = JSON.stringify((await denyMail.call('env.snapshot')).snapshot.data);
    const denied = await router(dir, 'denied', 'config-no-grant.json', clients);
    const [rejected] = await publishAll(denied, notices);
    assert.equal(rejected.receipt.status, 'rejected');
    assert.equal(rejected.receipt.code, 'recipient_not_authorized');
    assert.equal(JSON.stringify((await denyMail.call('env.snapshot')).snapshot.data), mailBefore);
    assert.equal(JSON.stringify((await sb.call('env.snapshot')).snapshot.data), sbBefore);

    return {passed: true, notice: notices[0].id, delivered: {event_id: first.receipt.event_id, subject: got.message.subject},
      retry: {duplicate: again.receipt.duplicate, event_id: again.receipt.event_id}, rejected: rejected.receipt.code};
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

module.exports = {run};
if (require.main === module) {
  run().then(r => { console.log(JSON.stringify(r, null, 2)); console.log('PASS: committed, retried and rejected deliveries to real Mail.'); })
    .catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
}
