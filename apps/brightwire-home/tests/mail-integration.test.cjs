'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Client} = require('../../../runtime/client.cjs');
const {createRuntime} = require('../../../runtime/core/runtime.cjs');
const {publishPending} = require('../src/publisher.cjs');

const root = path.resolve(__dirname, '../../..');

function config(file, recipients) {
  fs.writeFileSync(file, JSON.stringify({
    schema_version: 2,
    registry: 'examples/registry.mail.json',
    publishers: [{
      app_id: 'brightwire-home',
      account_id: 'bw-household-morales',
      owner_person_id: 'person-maya',
      package_root: 'apps/brightwire-home',
      contribution_ref: 'contribution/contribution.json',
      allowed_recipients: recipients
    }],
    authentication: {mode: 'trusted-stdio'}
  }));
}

test('a committed Brightwire notice is delivered to Mail once, and a missing grant stops', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-mail-'));
  const clients = [];
  try {
    const model = createRuntime({registryFile: path.join(root, 'apps.registry.json')});
    let state = model.create('brightwire-home', 'bw-mail', 'sandbox');
    const data = structuredClone(state.data);
    data.owner_person_id = 'person-maya';
    data.members.find(member => member.role === 'owner').person_id = 'person-maya';
    data.members.find(member => member.person_id === 'person-maya').name = 'Maya Chen';
    data.scopes.camera = 'operate';
    const binding = structuredClone(state.binding);
    binding.people.push({person_id: 'person-maya', name: 'Maya Chen'});
    binding.accounts = [{app_id: 'brightwire-home', account_id: data.account_id, owner_person_id: 'person-maya'}];
    const seeded = model.execute(state, 'infra', 'env.load_seed', {
      expected_version: model.version(state),
      request_id: 'maya-seed',
      virtual_now: '2026-11-17T12:00:00-06:00',
      data, binding, policies: state.policies, bundle: state.resources.bundle
    });
    assert.equal(seeded.result.status, 'ready', JSON.stringify(seeded.result));
    state = seeded.state;
    const opened = model.execute(state, 'agent', 'brightwire-home.devices.command', {
      expected_version: model.version(state),
      request_id: 'maya-privacy',
      device_id: 'camera-nursery',
      command: 'set_privacy',
      args: {privacy: 'privacy_off'}
    });
    assert.equal(opened.result.status, 'committed', JSON.stringify(opened.result));
    state = opened.state;
    const asked = model.execute(state, 'agent', 'brightwire-home.devices.command', {
      expected_version: model.version(state),
      request_id: 'maya-unlock',
      device_id: 'lock-front',
      command: 'unlock'
    });
    assert.equal(asked.result.status, 'committed', JSON.stringify(asked.result));
    assert.equal(asked.result.outcome, 'confirmation_required');
    const shared = model.execute(asked.state, 'agent', 'brightwire-home.camera.share.start', {
      expected_version: model.version(asked.state),
      request_id: 'maya-share',
      device_id: 'camera-nursery',
      recipient: 'sitter@example.com',
      duration_minutes: 15
    });
    assert.equal(shared.result.status, 'committed', JSON.stringify(shared.result));
    const created = shared;
    const before = structuredClone(created.state.data);
    assert.equal(before.devices.find(device => device.device_id === 'lock-front').lock, 'locked');
    const notice = before.notices.at(-1);
    assert.equal(notice.recipient_person_id, 'person-maya');
    const granted = path.join(dir, 'granted.json');
    config(granted, [{app_id: 'mail', account_id: 'mail-maya', channel: 'channel.email'}]);
    const router = new Client(null, null, null, null, 'bw-mail-router', {commandArgs: [
      path.join(root, 'runtime/messaging/service.cjs'), '--config', granted, '--publisher', 'brightwire-home', '--run', 'bw-mail', '--state-dir', dir
    ]});
    clients.push(router);
    await router.initialize();
    const published = await publishPending({snapshot: {data: before}, router});
    assert.equal(published.delivery, 'confirmed', JSON.stringify(published));
    assert.equal(published.results.length, before.notices.filter(item => item.delivery_status === 'pending_delivery').length);
    const duplicate = await router.call('router.publish', {
      request_id: published.results[0].request_id,
      message: messageOf(before, before.notices.find(item => item.notice_id === published.results[0].notice_id))
    });
    assert.equal(duplicate.duplicate, true);
    const mail = new Client('mail', 'agent', 'bw-mail', dir, 'bw-mail-reader', {registry: path.join(root, 'examples/registry.mail.json')});
    clients.push(mail);
    await mail.initialize();
    const kinds = new Set(before.notices.map(item => item.kind));
    assert.equal(kinds.has('confirmation_requested'), true);
    assert.equal(kinds.has('camera_shared'), true);
    for (const item of published.results) {
      const stored = await mail.call('mail.get', {id: item.receipt.event_id});
      assert.equal(stored.status, 'ok');
      assert.match(stored.message.subject, /Brightwire/);
    }
    assert.deepEqual(created.state.data, before);
    const deniedFile = path.join(dir, 'denied.json');
    config(deniedFile, []);
    const deniedRouter = new Client(null, null, null, null, 'bw-mail-denied', {commandArgs: [
      path.join(root, 'runtime/messaging/service.cjs'), '--config', deniedFile, '--publisher', 'brightwire-home', '--run', 'bw-mail-denied', '--state-dir', dir
    ]});
    clients.push(deniedRouter);
    await deniedRouter.initialize();
    const denied = await publishPending({snapshot: {data: before}, router: deniedRouter});
    assert.equal(denied.stopped, true);
    assert.equal(denied.results[0].receipt.code, 'recipient_not_authorized');
    assert.deepEqual(created.state.data.devices, before.devices);
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

function messageOf(data, notice) {
  return require('../src/publisher.cjs').messageFor(data, notice);
}
