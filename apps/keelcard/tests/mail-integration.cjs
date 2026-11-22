'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('../../../runtime/client.cjs');
const { create } = require('../../../runtime/messaging/src/router.cjs');
const { fixture } = require('./harness.cjs');
const { publishPending } = require('../src/publisher.cjs');

const root = path.resolve(__dirname, '../../..');
const registry = path.join(root, 'apps.registry.json');
const shipped = path.join(root, 'apps/keelcard/examples/mail-publisher.json');

function groceryDecline(id) {
  return {
    event_id: id,
    at: '2026-11-20T13:00:00-05:00',
    operation: 'authorization.request',
    payload: {
      authorization_key: 'freshcart:fc-grace:fc-mail-over:1',
      amount_cents: 9000,
      currency: 'USD',
      card: { number: '9417220000014417', expiry: '2028-09', security_code: '317' },
      merchant: { merchant_id: 'm-freshcart', name: 'FreshCart', category: 'grocery' }
    }
  };
}

async function mailbox(dir, run) {
  const mail = new Client('mail', 'infra', run, dir, 'keel-mail-setup', { registry });
  await mail.initialize();
  const snap = await mail.call('env.snapshot');
  const data = structuredClone(snap.snapshot.data);
  data.owner_person_id = 'person-grace';
  const binding = structuredClone(snap.snapshot.binding);
  for (const account of binding.accounts) {
    if (account.app_id === 'mail' && account.account_id === data.account_id) account.owner_person_id = 'person-grace';
  }
  if (!binding.people.some(person => person.person_id === 'person-grace')) {
    binding.people.push({ person_id: 'person-grace', name: 'Grace Adeyemi' });
  }
  const loaded = await mail.call('env.load_seed', {
    expected_version: snap.version,
    request_id: 'grace-mailbox',
    data,
    binding,
    policies: snap.snapshot.policies,
    bundle: snap.snapshot.resources.bundle
  });
  assert.equal(loaded.status, 'ready');
  assert.equal(data.account_id, 'mail-maya');
  return mail;
}

function inspectWith(mail) {
  return async ({ event_id }) => {
    const eventStatus = await mail.call('env.event_status', { event_id });
    const snap = await mail.call('env.snapshot');
    const mailRecord = snap.snapshot.data.messages.find(message => message.id === event_id) || null;
    return { eventStatus, mailRecord };
  };
}

test('the shipped Mail setup delivers a decline and a code with matching event ids', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keelcard-mail-'));
  const run = 'keelmail1';
  const mail = await mailbox(dir, run);
  const router = await create({ config: shipped, publisher: 'keelcard', run, stateDir: dir });
  try {
    const f = fixture();
    f.event(groceryDecline('mail-decline'));
    f.call('keelcard.controls.request_change', { card_id: 'card-4417', field: 'per_transaction', amount_cents: 10000 });
    const code = f.data.change_requests[0].code;
    const before = await mail.call('env.snapshot');
    const first = await publishPending({ data: f.data, router });
    assert.equal(first.stopped, false);
    assert.equal(first.sent.length, 2);
    assert.equal(first.sent.every(item => item.receipt.status === 'committed'), true);
    const after = await mail.call('env.snapshot');
    assert.equal(after.snapshot.data.messages.length, before.snapshot.data.messages.length + 2);
    for (const item of first.sent) {
      const status = await mail.call('env.event_status', { event_id: item.receipt.event_id });
      assert.equal(status.status, 'ok');
      assert.equal(status.receipt.status, 'committed');
      assert.equal(status.receipt.event_id, item.receipt.event_id);
      const message = after.snapshot.data.messages.find(row => row.id === item.receipt.event_id);
      assert.ok(message);
      assert.equal(message.id, item.receipt.event_id);
    }
    const delivered = after.snapshot.data.messages.find(message => message.body.includes(code));
    assert.ok(delivered);
    const decline = after.snapshot.data.messages.find(message => message.subject.toLowerCase().includes('declin') || message.body.includes('9000') || message.body.includes('$90'));
    assert.ok(decline);
    const second = await publishPending({ data: f.data, router });
    assert.equal(second.sent.every(item => item.receipt.duplicate === true), true);
    const repeat = await mail.call('env.snapshot');
    assert.equal(repeat.snapshot.data.messages.length, after.snapshot.data.messages.length);
  } finally {
    await router.close();
    await mail.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a lost acknowledgement is confirmed from the real Mail receipt and is not sent again', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keelcard-mail-'));
  const run = 'keelmail2';
  const mail = await mailbox(dir, run);
  const router = await create({ config: shipped, publisher: 'keelcard', run, stateDir: dir });
  try {
    const f = fixture();
    f.call('keelcard.controls.request_change', { card_id: 'card-4417', field: 'per_transaction', amount_cents: 11000 });
    const data = f.data;
    const real = await publishPending({ data, router });
    const eventId = real.sent[0].receipt.event_id;
    data.notices[0].status = 'pending_delivery';
    const lost = {
      async call() {
        return { status: 'unknown', code: 'receiver_unconfirmed', stop_run: true, event_id: eventId };
      }
    };
    const reconciled = await publishPending({ data, router: lost, inspect: inspectWith(mail) });
    assert.equal(reconciled.stopped, true);
    assert.equal(reconciled.report.outcome, 'confirmed');
    assert.equal(data.notices[0].status, 'committed');
    assert.equal(data.notices[0].delivery.event_id, eventId);
    const again = await publishPending({ data, router });
    assert.equal(again.sent.length, 0);
  } finally {
    await router.close();
    await mail.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Mail rejects an oversized notice and missing evidence stays unresolved', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keelcard-mail-'));
  const run = 'keelmail3';
  const mail = await mailbox(dir, run);
  const router = await create({ config: shipped, publisher: 'keelcard', run, stateDir: dir });
  try {
    const f = fixture();
    f.call('keelcard.controls.request_change', { card_id: 'card-4417', field: 'per_transaction', amount_cents: 12000 });
    const before = await mail.call('env.snapshot');
    const data = f.data;
    data.notices[0].cloud_event_id = 'n' + 'x'.repeat(120);
    const rejected = await publishPending({ data, router, inspect: inspectWith(mail) });
    assert.equal(rejected.stopped, true);
    assert.equal(rejected.sent[0].receipt.code, 'receiver_rejected');
    assert.equal(rejected.report.outcome, 'unresolved');
    assert.equal(data.notices[0].status, 'pending_delivery');
    assert.equal(data.change_requests[0].status, 'pending_verification');
    const held = await publishPending({ data, router });
    assert.equal(held.sent.length, 0);
    assert.equal(held.stopped, true);
    const after = await mail.call('env.snapshot');
    assert.equal(after.snapshot.data.messages.length, before.snapshot.data.messages.length);
    const quiet = fixture();
    quiet.call('keelcard.controls.request_change', { card_id: 'card-4417', field: 'per_transaction', amount_cents: 13000 });
    const quietData = quiet.data;
    const missingId = 'router-' + 'b'.repeat(32);
    const absent = await publishPending({
      data: quietData,
      router: { async call() { return { status: 'unknown', code: 'receiver_unconfirmed', stop_run: true, event_id: missingId }; } },
      inspect: inspectWith(mail)
    });
    assert.equal(absent.report.outcome, 'unresolved');
    assert.equal(quietData.notices[0].status, 'pending_delivery');
    const status = await mail.call('env.event_status', { event_id: missingId });
    assert.equal(status.receipt, null);
  } finally {
    await router.close();
    await mail.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty grant rejects before dispatch and leaves the request in place', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keelcard-mail-'));
  const run = 'keelmail4';
  const config = JSON.parse(fs.readFileSync(shipped, 'utf8'));
  config.publishers[0].allowed_recipients = [];
  const file = path.join(dir, 'publisher.json');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config));
  const mail = await mailbox(dir, run);
  const router = await create({ config: file, publisher: 'keelcard', run, stateDir: dir });
  try {
    const f = fixture();
    f.call('keelcard.controls.request_change', { card_id: 'card-4417', field: 'per_transaction', amount_cents: 14000 });
    const result = await publishPending({ data: f.data, router });
    assert.equal(result.stopped, false);
    assert.equal(result.report.outcome, 'rejected');
    assert.equal(result.sent[0].receipt.code, 'recipient_not_authorized');
    assert.equal(f.data.change_requests[0].code.length, 6);
  } finally {
    await router.close();
    await mail.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
