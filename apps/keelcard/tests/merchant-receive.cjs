'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('../../../runtime/client.cjs');
const { create } = require('../../../runtime/messaging/src/router.cjs');

const root = path.resolve(__dirname, '../../..');
const registry = path.join(root, 'apps.registry.json');
const receiverSchema = fs.readFileSync(path.join(root, 'apps/keelcard/schemas/card-authorization-message.schema.json'));
const publisherSchema = fs.readFileSync(path.join(root, 'apps/keelcard/examples/test-merchant/schemas/card-authorization-message.schema.json'));

function config(recipients) {
  return {
    schema_version: 2,
    registry: 'apps.registry.json',
    publishers: [{
      app_id: 'freshcart',
      account_id: 'fc-grace',
      owner_person_id: 'person-grace',
      package_root: 'apps/keelcard/examples/test-merchant',
      contribution_ref: 'contribution/contribution.json',
      allowed_recipients: recipients
    }],
    authentication: { mode: 'trusted-stdio' }
  };
}

function message() {
  return {
    specversion: '1.0',
    id: 'fc-auth-1',
    source: 'urn:pale:app:freshcart:account:fc-grace',
    type: 'org.pale.card.authorization.v1',
    datacontenttype: 'application/json',
    dataschema: 'urn:pale:card-authorization-payload:1',
    data: {
      channel: 'channel.card.authorization',
      recipient: { kind: 'app_account_ref', app_id: 'keelcard', id: 'kc-adeyemi' },
      source_object: { app_id: 'freshcart', account_id: 'fc-grace', object_type: 'order', object_id: 'fc-merchant-1' },
      authorization: {
        authorization_key: 'freshcart:fc-grace:fc-merchant-1:1',
        card: { number: '9417220000014417', expiry: '2028-09', security_code: '317' },
        merchant: { merchant_id: 'm-freshcart', name: 'FreshCart', category: 'grocery' },
        amount_cents: 2500,
        currency: 'USD'
      },
      extensions: []
    }
  };
}

async function publish(dir, run, recipients) {
  const file = path.join(dir, 'merchant.json');
  fs.writeFileSync(file, JSON.stringify(config(recipients)));
  const router = await create({ config: file, publisher: 'freshcart', run, stateDir: dir });
  try {
    const before = JSON.parse(fs.readFileSync(path.join(dir, run, 'keelcard.json'), 'utf8'));
    const receipt = await router.call('router.publish', { request_id: 'fc-publish-1', message: message() });
    const after = JSON.parse(fs.readFileSync(path.join(dir, run, 'keelcard.json'), 'utf8'));
    return { receipt, before, after };
  } finally {
    await router.close();
  }
}

test('the merchant wire schema is the same document on both sides', () => {
  assert.equal(publisherSchema.equals(receiverSchema), true);
});

test('a granted merchant authorization is recorded and can be looked up without card details', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keelcard-merchant-'));
  const run = 'keelmerchant1';
  try {
    const result = await publish(dir, run, [{ app_id: 'keelcard', account_id: 'kc-adeyemi', channel: 'channel.card.authorization' }]);
    assert.equal(result.receipt.status, 'committed');
    assert.equal(result.after.data.authorizations.length, result.before.data.authorizations.length + 1);
    const agent = new Client('keelcard', 'agent', run, dir, 'keel-merchant-reader', { registry });
    await agent.initialize();
    try {
      const lookup = await agent.call('keelcard.authorizations.lookup', { authorization_key: 'freshcart:fc-grace:fc-merchant-1:1' });
      assert.equal(lookup.authorization.decision, 'approved');
      assert.equal(JSON.stringify(lookup).includes('9417220000014417'), false);
      assert.equal(JSON.stringify(lookup).includes('317'), false);
    } finally {
      await agent.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('authorization keys follow the 100 character storage limit', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keelcard-merchant-'));
  const run = 'keelmerchant3';
  const file = path.join(dir, 'merchant.json');
  fs.writeFileSync(file, JSON.stringify(config([{ app_id: 'keelcard', account_id: 'kc-adeyemi', channel: 'channel.card.authorization' }])));
  const router = await create({ config: file, publisher: 'freshcart', run, stateDir: dir });
  try {
    const tooLong = message();
    tooLong.id = 'fc-auth-long';
    tooLong.data.authorization.authorization_key = 'k' + 'a'.repeat(100);
    tooLong.data.source_object.object_id = 'fc-long';
    const rejected = await router.call('router.publish', { request_id: 'fc-long', message: tooLong });
    assert.ok(rejected.code === 'incompatible_contract' || rejected.code === 'invalid_arguments');
    assert.equal(rejected.stop_run, undefined);
    const accepted = message();
    accepted.id = 'fc-auth-fit';
    accepted.data.authorization.authorization_key = 'k' + 'a'.repeat(99);
    accepted.data.source_object.object_id = 'fc-fit';
    const receipt = await router.call('router.publish', { request_id: 'fc-fit', message: accepted });
    assert.equal(receipt.status, 'committed');
  } finally {
    await router.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an instance policy can leave only lookup allowed, and Infra authorization.request is the delivered path', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keelcard-merchant-'));
  const run = 'keelmerchant4';
  try {
    const result = await publish(dir, run, [{ app_id: 'keelcard', account_id: 'kc-adeyemi', channel: 'channel.card.authorization' }]);
    assert.equal(result.receipt.status, 'committed');
    const infra = new Client('keelcard', 'infra', run, dir, 'lookup-infra', { registry });
    await infra.initialize();
    const agent = new Client('keelcard', 'agent', run, dir, 'lookup-agent', { registry });
    await agent.initialize();
    try {
      const snap = await infra.call('env.snapshot');
      const policies = structuredClone(snap.snapshot.policies);
      policies.scenario.allow = ['keelcard.authorizations.lookup'];
      const loaded = await infra.call('env.load_seed', {
        expected_version: snap.version,
        request_id: 'lookup-only',
        data: snap.snapshot.data,
        binding: snap.snapshot.binding,
        policies,
        bundle: snap.snapshot.resources.bundle
      });
      assert.equal(loaded.status, 'ready');
      const denied = await agent.call('keelcard.cards.list', {});
      assert.equal(denied.status, 'permission_denied');
      const lookup = await agent.call('keelcard.authorizations.lookup', { authorization_key: 'freshcart:fc-grace:fc-merchant-1:1' });
      assert.equal(lookup.authorization.decision, 'approved');
      assert.equal(JSON.stringify(lookup).includes('9417220000014417'), false);
      const applied = await infra.call('env.apply_event', {
        expected_version: (await infra.call('env.snapshot')).version,
        event: {
          event_id: 'infra-auth-1',
          at: '2026-11-18T14:00:00-05:00',
          operation: 'authorization.request',
          payload: {
            authorization_key: 'freshcart:fc-grace:fc-infra:1',
            amount_cents: 1800,
            currency: 'USD',
            card: { number: '9417220000014417', expiry: '2028-09', security_code: '317' },
            merchant: { merchant_id: 'm-freshcart', name: 'FreshCart', category: 'grocery' }
          }
        }
      });
      assert.equal(applied.status, 'committed');
    } finally {
      await agent.close();
      await infra.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a key with a space is rejected before dispatch and does not halt the run', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keelcard-merchant-'));
  const run = 'keelmerchant-space';
  try {
    const file = path.join(dir, 'merchant.json');
    fs.writeFileSync(file, JSON.stringify(config([{ app_id: 'keelcard', account_id: 'kc-adeyemi', channel: 'channel.card.authorization' }])));
    const router = await create({ config: file, publisher: 'freshcart', run, stateDir: dir });
    try {
      const before = await (async () => {
        const infra = new Client('keelcard', 'infra', run, dir, 'space-before', { registry });
        await infra.initialize();
        const snap = await infra.call('env.snapshot');
        await infra.close();
        return snap.snapshot.data.authorizations.length;
      })();
      const spaced = message();
      spaced.id = 'fc-space';
      spaced.data.authorization.authorization_key = 'order 1';
      spaced.data.source_object.object_id = 'fc-space';
      const rejected = await router.call('router.publish', { request_id: 'fc-space', message: spaced });
      assert.equal(['invalid_arguments', 'incompatible_contract'].includes(rejected.code), true);
      assert.equal(rejected.stop_run, undefined);
      const caps = await router.call('router.capabilities', {});
      assert.equal(caps.halted, false);
      spaced.id = 'fc-space-ok';
      spaced.data.authorization.authorization_key = 'freshcart:fc-grace:fc-space:1';
      spaced.data.source_object.object_id = 'fc-space-ok';
      const accepted = await router.call('router.publish', { request_id: 'fc-space-ok', message: spaced });
      assert.equal(accepted.status, 'committed');
      const infra = new Client('keelcard', 'infra', run, dir, 'space-after', { registry });
      await infra.initialize();
      const after = await infra.call('env.snapshot');
      await infra.close();
      assert.equal(after.snapshot.data.authorizations.length, before + 1);
      assert.equal(after.snapshot.data.authorizations.some(row => row.authorization_key === 'order 1'), false);
    } finally {
      await router.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty card is rejected before dispatch and the route still accepts a complete card', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keelcard-merchant-'));
  const run = 'keelmerchant-empty';
  const file = path.join(dir, 'merchant.json');
  fs.writeFileSync(file, JSON.stringify(config([{ app_id: 'keelcard', account_id: 'kc-adeyemi', channel: 'channel.card.authorization' }])));
  const router = await create({ config: file, publisher: 'freshcart', run, stateDir: dir });
  try {
    const empty = message();
    empty.id = 'fc-empty-card';
    empty.data.authorization.card = {};
    empty.data.authorization.authorization_key = 'freshcart:fc-grace:fc-empty:1';
    empty.data.source_object.object_id = 'fc-empty';
    const rejected = await router.call('router.publish', { request_id: 'fc-empty', message: empty });
    assert.equal(['invalid_arguments', 'incompatible_contract'].includes(rejected.code), true);
    assert.equal(rejected.stop_run, undefined);
    const caps = await router.call('router.capabilities', {});
    assert.equal(caps.halted, false);
    const accepted = message();
    accepted.id = 'fc-empty-ok';
    accepted.data.authorization.authorization_key = 'freshcart:fc-grace:fc-empty:2';
    accepted.data.source_object.object_id = 'fc-empty-ok';
    const receipt = await router.call('router.publish', { request_id: 'fc-empty-ok', message: accepted });
    assert.equal(receipt.status, 'committed');
  } finally {
    await router.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unbound merchant cannot change Keelcard', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keelcard-merchant-'));
  const run = 'keelmerchant2';
  try {
    const result = await publish(dir, run, []);
    assert.equal(result.receipt.code, 'recipient_not_authorized');
    assert.equal(result.after.data.authorizations.length, result.before.data.authorizations.length);
    assert.equal(result.after.revision, result.before.revision);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
