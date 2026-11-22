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
