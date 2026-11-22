'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRuntime } = require('../../../runtime/core/runtime.cjs');
const { create } = require('../../../runtime/messaging/src/router.cjs');
const { fixture } = require('./harness.cjs');
const { publishPending } = require('../src/publisher.cjs');

const root = path.resolve(__dirname, '../../..');
const registry = path.join(root, 'apps.registry.json');

function graceState(model, run) {
  const state = model.create('mail', run, 'sandbox');
  state.data.owner_person_id = 'person-grace';
  state.initial_data.owner_person_id = 'person-grace';
  for (const account of state.binding.accounts) {
    if (account.app_id === 'mail' && account.account_id === state.data.account_id) account.owner_person_id = 'person-grace';
  }
  state.binding.people.push({ person_id: 'person-grace', name: 'Grace Adeyemi' });
  return model.normalize(state);
}

function writeMail(dir, run, state) {
  const folder = path.join(dir, run);
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(folder, 'mail.json'), JSON.stringify(state), { mode: 0o600 });
}

function publisherConfig(file, recipients) {
  fs.writeFileSync(file, JSON.stringify({
    schema_version: 2,
    registry: 'apps.registry.json',
    publishers: [{
      app_id: 'keelcard',
      account_id: 'kc-adeyemi',
      owner_person_id: 'person-grace',
      package_root: 'apps/keelcard',
      contribution_ref: 'contribution/contribution.json',
      allowed_recipients: recipients
    }],
    authentication: { mode: 'trusted-stdio' }
  }, null, 2));
}

function openRequest() {
  const f = fixture();
  f.call('keelcard.controls.request_change', { card_id: 'card-4417', field: 'per_transaction', amount_cents: 10000 });
  return f;
}

test('a committed code email is delivered once and a repeat is a duplicate', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keelcard-mail-'));
  const run = 'keelmail1';
  const model = createRuntime({ registryFile: registry });
  const mailbox = graceState(model, run);
  writeMail(dir, run, mailbox);
  const config = path.join(dir, 'publisher.json');
  publisherConfig(config, [{ app_id: 'mail', account_id: mailbox.data.account_id, channel: 'channel.email' }]);
  const router = await create({ config, publisher: 'keelcard', run, stateDir: dir });
  try {
    const f = openRequest();
    const code = f.data.change_requests[0].code;
    const first = await publishPending({ data: f.data, router });
    assert.equal(first.stopped, false);
    assert.equal(first.sent.length, 1);
    assert.equal(first.sent[0].receipt.status, 'committed');
    const stored = JSON.parse(fs.readFileSync(path.join(dir, run, 'mail.json'), 'utf8'));
    assert.equal(stored.data.messages.length, mailbox.data.messages.length + 1);
    const delivered = stored.data.messages.find(message => message.id === first.sent[0].receipt.event_id);
    assert.equal(delivered.body.includes(code), true);
    const second = await publishPending({ data: f.data, router });
    assert.equal(second.sent[0].receipt.duplicate, true);
    assert.equal(second.sent[0].receipt.event_id, first.sent[0].receipt.event_id);
    const after = JSON.parse(fs.readFileSync(path.join(dir, run, 'mail.json'), 'utf8'));
    assert.equal(after.data.messages.length, stored.data.messages.length);
    assert.equal(f.data.change_requests[0].code, code);
  } finally {
    await router.close();
  }
});

test('a missing grant rejects before dispatch and leaves the code in place', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keelcard-mail-'));
  const run = 'keelmail2';
  const model = createRuntime({ registryFile: registry });
  const mailbox = graceState(model, run);
  writeMail(dir, run, mailbox);
  const config = path.join(dir, 'publisher.json');
  publisherConfig(config, []);
  const router = await create({ config, publisher: 'keelcard', run, stateDir: dir });
  try {
    const f = openRequest();
    const code = f.data.change_requests[0].code;
    const report = await publishPending({ data: f.data, router });
    assert.equal(report.stopped, false);
    assert.equal(report.report.outcome, 'rejected');
    assert.equal(report.sent[0].receipt.code, 'recipient_not_authorized');
    assert.equal(report.sent[0].receipt.stop_run, undefined);
    const stored = JSON.parse(fs.readFileSync(path.join(dir, run, 'mail.json'), 'utf8'));
    assert.equal(stored.data.messages.length, mailbox.data.messages.length);
    assert.equal(f.data.change_requests[0].code, code);
    assert.equal(f.data.change_requests[0].status, 'pending_verification');
  } finally {
    await router.close();
  }
});

test('a halted acknowledgement stops the publisher without a second send', async () => {
  const f = openRequest();
  const data = f.data;
  data.notices.push({ ...data.notices[0], notice_id: 'notice-extra', publish_request_id: 'notice-extra', cloud_event_id: 'keelcard-kc-adeyemi-notice-extra' });
  let calls = 0;
  const router = {
    async call() {
      calls += 1;
      return { status: 'unknown', code: 'receiver_unconfirmed', stop_run: true, event_id: 'router-halted1' };
    }
  };
  const report = await publishPending({ data, router });
  assert.equal(calls, 1);
  assert.equal(report.stopped, true);
  assert.equal(report.report.outcome, 'unresolved');
  assert.equal(f.data.change_requests[0].status, 'pending_verification');
});
