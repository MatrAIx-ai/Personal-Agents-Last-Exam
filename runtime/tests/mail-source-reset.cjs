'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Client } = require('../client.cjs');
const publisher = require('../../examples/apps/mail/src/publisher.cjs');

const root = path.resolve(__dirname, '../..');

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-mail-source-reset-'));
  const runId = 'mail-reset-' + randomUUID();
  const clients = [];
  async function connect(role, account) {
    const client = new Client('mail', role, runId, path.join(dir, account), 'mail-reset-test', {
      registry: path.join(root, 'examples/registry.mail.json')
    });
    clients.push(client);
    await client.initialize();
    return client;
  }
  try {
    const source = await connect('infra', 'mail-a');
    const target = await connect('infra', 'mail-b');
    const binding = {
      people: [{ person_id: 'person-maya', name: 'Maya' }, { person_id: 'person-alex', name: 'Alex' }],
      accounts: [
        { app_id: 'mail', account_id: 'mail-a', owner_person_id: 'person-maya' },
        { app_id: 'mail', account_id: 'mail-b', owner_person_id: 'person-alex' }
      ],
      objects: {}
    };
    for (const [client, account, owner] of [
      [source, 'mail-a', 'person-maya'], [target, 'mail-b', 'person-alex']
    ]) {
      const before = await client.call('env.snapshot');
      const dataset = structuredClone(require('../../examples/apps/mail/contribution/dataset.json'));
      dataset.expected_counts = { records: 0, assets: 0 };
      const loaded = await client.call('env.load_seed', {
        expected_version: before.version,
        request_id: 'initialize',
        data: { account_id: account, owner_person_id: owner, address: account + '@pale.example', messages: [] },
        binding,
        policies: {
          scenario: { allow: ['mail.get', 'mail.draft.create', 'mail.send'], constraints: {} },
          sandbox: { allow: ['mail.get'], constraints: {} }
        },
        bundle: {
          dataset,
          catalog: {
            schema_version: 'pale.asset-catalog.v1', catalog_id: 'mail-reset-empty',
            app_id: 'mail', dataset_ref: 'dataset.json', assets: [], extensions: []
          },
          blobs: {}
        }
      });
      assert.equal(loaded.status, 'ready');
    }
    const agent = await connect('agent', 'mail-a');
    const reader = await connect('agent', 'mail-b');
    const configFile = path.join(dir, 'router.json');
    fs.copyFileSync(path.join(root, 'examples/workflows/mail-to-mail/router.json'), configFile);
    const router = new Client(null, null, null, null, 'mail-reset-publisher', {
      commandArgs: [path.join(root, 'runtime/messaging/service.cjs'), '--config', configFile,
        '--publisher', 'mail', '--run', runId, '--state-dir', dir]
    });
    clients.push(router);
    await router.initialize();

    async function sendDraft(body, requestId) {
      const before = await source.call('env.snapshot');
      const created = await agent.call('mail.draft.create', {
        to: ['mail-b@pale.example'], subject: 'Reset regression', body,
        expected_version: before.version, request_id: requestId + '-draft'
      });
      assert.equal(created.status, 'committed');
      const sent = await publisher.send({
        agent, router, messageId: created.id, requestId, sourceAccount: 'mail-a',
        recipient: { account_id: 'mail-b', address: 'mail-b@pale.example' }
      });
      assert.equal(sent.local.status, 'committed');
      assert.equal(sent.result.status, 'committed', JSON.stringify(sent.result));
      return sent;
    }

    const first = await sendDraft('Before source reset', 'first-send');
    const targetBefore = await target.call('env.snapshot');
    const sourceBefore = await source.call('env.snapshot');
    const reset = await source.call('env.reset', { expected_version: sourceBefore.version });
    assert.equal(reset.status, 'ready');
    assert.notEqual(reset.version.epoch, sourceBefore.version.epoch);
    assert.deepEqual((await target.call('env.snapshot')).snapshot, targetBefore.snapshot);

    // Reset reuses draft-1 and the virtual time, but this is a different source lifecycle.
    const second = await sendDraft('After source reset', 'second-send');
    assert.equal(first.source.id, second.source.id);
    assert.equal(first.message.time, second.message.time);
    assert.equal(first.message.source, second.message.source);
    assert.notEqual(first.message.id, second.message.id);
    assert.equal(second.message.data.source_object.object_id, second.source.id);
    assert.notEqual(first.result.event_id, second.result.event_id);
    const targetAfter = await target.call('env.snapshot');
    assert.equal(targetAfter.snapshot.data.messages.length, 2);
    assert.equal(targetAfter.version.epoch, targetBefore.version.epoch);
    assert.deepEqual(targetAfter.snapshot.data.messages[0], targetBefore.snapshot.data.messages[0]);
    assert.equal((await reader.call('mail.get', { id: first.result.event_id })).message.body, 'Before source reset');
    assert.equal((await reader.call('mail.get', { id: second.result.event_id })).message.body, 'After source reset');

    // Transport retries preserve the exact event, even with a different request ID.
    for (const sent of [first, second]) {
      for (const requestId of [sent.request_id, sent.request_id + '-retry']) {
        const duplicate = await router.call('router.publish', { request_id: requestId, message: sent.message });
        assert.equal(duplicate.status, 'committed');
        assert.equal(duplicate.duplicate, true);
        assert.equal(duplicate.event_id, sent.result.event_id);
      }
    }
    const changed = structuredClone(second.message);
    changed.data.content.body.text = 'Changed content under the same identity';
    const conflict = await router.call('router.publish', { request_id: 'conflicting-retry', message: changed });
    assert.equal(conflict.code, 'idempotency_conflict');
    const afterRetries = await target.call('env.snapshot');
    assert.deepEqual(afterRetries.snapshot.data, targetAfter.snapshot.data);
    assert.deepEqual(afterRetries.version, targetAfter.version);
    console.log('PASS: source-only reset delivers a new Mail message; retries deduplicate and conflicting content is rejected.');
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { run };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
