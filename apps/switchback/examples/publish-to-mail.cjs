#!/usr/bin/env node
'use strict';
// Publishes Switchback's stored notices to real Mail through Messaging, then
// reads each one back with Mail's own Agent tool. Run from a full checkout:
//   node apps/switchback/examples/publish-to-mail.cjs [--evidence FILE]
//
// Required public dependencies, all in the public checkout: the pinned runtime
// (runtime/), Mail 1.3.0 (examples/apps/mail) and the repository-level Mail
// registry examples/registry.mail.json, which both this script and the
// Messaging config (examples/messaging/config.json) name.
//
// When it runs: after the write or event that creates notices and before the
// next env.advance_time, because Messaging delivers at the receiver's current
// virtual time.
// Which notices are new: Switchback does not record delivery. The script offers
// every stored notice in creation order with the notice ID as request_id and
// CloudEvents id. Messaging keeps the receipts, so a notice it already
// delivered comes back as a duplicate with its original event_id and Mail is
// not changed again.
// Outcomes: committed (read back from Mail), retried (deduplicated), rejected
// before delivery (missing grant), and unknown: Mail commits but the
// acknowledgement is lost, so Messaging halts the run. The publisher then stops
// offering notices and reconciles from Mail's own records instead of retrying.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const {prepare} = require(path.join(root, 'runtime/prepare.cjs'));
const mailSeed = require('./messaging/mail-seed.json');
const MAIL_REGISTRY = path.join(root, 'examples/registry.mail.json');

async function seedMail(dir, run, clients) {
  const mail = new Client('mail', 'infra', run, dir, 'switchback-mail-seed', {registry: MAIL_REGISTRY});
  clients.push(mail); await mail.initialize();
  const snap = await mail.call('env.snapshot');
  const loaded = await mail.call('env.load_seed', {expected_version: snap.version, request_id: 'mail-dana-seed', data: mailSeed.data, binding: mailSeed.binding, policies: snap.snapshot.policies});
  assert.equal(loaded.status, 'ready', JSON.stringify(loaded));
  return mail;
}

async function mailReader(dir, run, clients) {
  const reader = new Client('mail', 'agent', run, dir, 'mail-reader', {registry: MAIL_REGISTRY});
  clients.push(reader); await reader.initialize();
  return reader;
}

async function router(dir, run, config, clients) {
  const r = new Client(null, null, null, null, 'switchback-publisher', {commandArgs: [path.join(root, 'runtime/messaging/service.cjs'),
    '--config', path.join(__dirname, 'messaging', config), '--publisher', 'switchback', '--run', run, '--state-dir', dir]});
  clients.push(r); await r.initialize();
  return r;
}

// Offers notices in order and stops at the first result that is not committed
// or a duplicate: an unknown or halted result means the run must be reconciled.
async function publishAll(r, notices) {
  const out = [];
  for (const n of notices) {
    const receipt = await r.call('router.publish', {request_id: n.id, message: n.message});
    out.push({notice_id: n.id, receipt});
    if (receipt.stop_run) break;
  }
  return out;
}

const request = n => ({request_id: n.id, cloud_event: {id: n.message.id, type: n.message.type, source: n.message.source, dataschema: n.message.dataschema,
  recipient: n.message.data.recipient, source_object: n.message.data.source_object}});
const receiptView = x => ({status: x.status, code: x.code, duplicate: x.duplicate, event_id: x.event_id, version: x.version, target: x.target,
  applied_at: x.applied_at, stop_run: x.stop_run, committed_at: x.committed_at ? 'present (wall time)' : undefined});

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
    const sbSnap = (await sb.call('env.snapshot')).snapshot, notices = sbSnap.data.notices;
    assert.equal(notices.length, 1);
    const sbBefore = JSON.stringify(sbSnap.data);
    const closed = sbSnap.data.reservations.find(r => r.id === notices[0].message.data.source_object.object_id);

    // 2. Committed delivery: publish, then read it back as the Mail Agent.
    await seedMail(dir, 'delivered', clients);
    const r = await router(dir, 'delivered', 'config.json', clients);
    const [first] = await publishAll(r, notices);
    assert.equal(first.receipt.status, 'committed', JSON.stringify(first.receipt));
    const reader = await mailReader(dir, 'delivered', clients);
    const got = await reader.call('mail.get', {id: first.receipt.event_id});
    assert.equal(got.status, 'ok');
    assert.equal(got.message.id, first.receipt.event_id);
    assert.equal(got.message.subject, notices[0].message.data.content.title);
    assert.equal(got.message.body, notices[0].message.data.content.body.text);

    // 3. Retry: offering the same notices again changes nothing in Mail.
    const mailInfra = new Client('mail', 'infra', 'delivered', dir, 'mail-inspector', {registry: MAIL_REGISTRY});
    clients.push(mailInfra); await mailInfra.initialize();
    const countBefore = (await mailInfra.call('env.snapshot')).snapshot.data.messages.length;
    const [again] = await publishAll(r, notices);
    assert.equal(again.receipt.duplicate, true);
    assert.equal(again.receipt.event_id, first.receipt.event_id);
    const countAfter = (await mailInfra.call('env.snapshot')).snapshot.data.messages.length;
    assert.equal(countAfter, countBefore);
    const inbox = await reader.call('mail.search', {query: closed.id});
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

    // 5. Unknown acknowledgement: Mail commits, but the reply to Messaging is
    // lost. Staged the way runtime/messaging/tests/test_time_trace.cjs stages it,
    // without changing runtime/: an in-process reference router whose receiver
    // call throws after Mail's env.apply_event returns. Messaging answers
    // `unknown` with stop_run and halts the run; the next publish is refused
    // with run_halted, so nothing is retried blindly.
    const lostMail = await seedMail(dir, 'lost-ack', clients);
    const lostBefore = (await lostMail.call('env.snapshot')).snapshot.data.messages.length;
    const {create} = require(path.join(root, 'runtime/messaging/src/router.cjs'));
    const uncertain = await create({config: path.join(__dirname, 'messaging/config.json'), publisher: 'switchback', run: 'lost-ack', stateDir: dir});
    clients.push(uncertain);
    const originalCall = Client.prototype.call;
    let lost;
    try {
      Client.prototype.call = async function (name, args) {
        const result = await originalCall.call(this, name, args);
        if (name === 'env.apply_event') throw new Error('Simulated lost acknowledgement');
        return result;
      };
      [lost] = await publishAll(uncertain, notices);
    } finally { Client.prototype.call = originalCall; }
    assert.equal(lost.receipt.status, 'unknown', JSON.stringify(lost.receipt));
    assert.equal(lost.receipt.code, 'receiver_unconfirmed');
    assert.equal(lost.receipt.stop_run, true);
    assert.ok(lost.receipt.event_id && !lost.receipt.committed_at);
    const retryAfterUnknown = await uncertain.call('router.publish', {request_id: notices[0].id, message: notices[0].message});
    assert.equal(retryAfterUnknown.status, 'halted');
    assert.equal(retryAfterUnknown.code, 'run_halted');
    // Reconciliation reads Mail's own records: the event committed once, and the
    // message is there; Switchback still holds its notice and business result.
    const status = await lostMail.call('env.event_status', {event_id: lost.receipt.event_id});
    assert.equal(status.receipt.status, 'committed');
    assert.equal(status.receipt.trace.event_id, lost.receipt.event_id);
    const lostReader = await mailReader(dir, 'lost-ack', clients);
    const lostGot = await lostReader.call('mail.get', {id: lost.receipt.event_id});
    assert.equal(lostGot.status, 'ok');
    assert.equal(lostGot.message.subject, notices[0].message.data.content.title);
    assert.equal((await lostMail.call('env.snapshot')).snapshot.data.messages.length, lostBefore + 1);
    assert.equal(JSON.stringify((await sb.call('env.snapshot')).snapshot.data), sbBefore);

    return {
      passed: true,
      versions: {switchback: require('../app.json').version, mail: require(path.join(root, 'examples/apps/mail/app.json')).version,
        runtime: require(path.join(root, 'runtime/package.json')).version},
      switchback: {event: require('./scenario.json').event_id, reservation: closed.id, state: closed.state, notice: notices[0].id,
        refund: sbSnap.data.payments.filter(p => p.reservation_id === closed.id && p.kind === 'refund').map(p => ({id: p.id, amount_cents: p.amount_cents, posts_at: p.posts_at}))},
      request: request(notices[0]),
      committed: {receipt: receiptView(first.receipt), mail_get: {id: got.message.id, account_id: got.message.account_id, to: got.message.to, folder: got.message.folder,
        subject: got.message.subject, received_at: got.message.received_at}},
      retried: {receipt: receiptView(again.receipt), mail_messages_before: countBefore, mail_messages_after: countAfter},
      rejected: {receipt: receiptView(rejected.receipt), mail_unchanged: true, switchback_unchanged: true},
      unknown: {receipt: receiptView(lost.receipt), next_publish: receiptView(retryAfterUnknown),
        reconciliation: {mail_event_status: status.receipt.status, mail_get: {id: lostGot.message.id, subject: lostGot.message.subject}, switchback_unchanged: true}},
      business_confirmation: 'not applicable: notices go to the account holder\'s own Mail account (mail-dana, person-dana); no recipient or business party confirms them',
    };
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

module.exports = {run};
if (require.main === module) {
  const at = process.argv.indexOf('--evidence'), file = at > 0 ? process.argv[at + 1] : null;
  run().then(r => {
    const text = JSON.stringify(r, null, 2);
    console.log(text);
    if (file) fs.writeFileSync(path.resolve(file), text + '\n');
    console.log('PASS: committed, retried, rejected and unknown deliveries to real Mail.');
  }).catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
}
