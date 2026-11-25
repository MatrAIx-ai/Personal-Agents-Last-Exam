'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Client} = require('../../../runtime/client.cjs');
const {createRuntime} = require('../../../runtime/core/runtime.cjs');
const {publishPending, reconcilePending} = require('../src/publisher.cjs');

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
    const published = await publishPending({snapshot: {data: before, run_id: 'bw-mail'}, router});
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
    const inboxBefore = await mail.call('mail.search', {folder: 'inbox'});
    const deniedMail = new Client('mail', 'infra', 'bw-mail-denied', dir, 'bw-mail-denied-reader', {registry: path.join(root, 'examples/registry.mail.json')});
    clients.push(deniedMail);
    await deniedMail.initialize();
    const deniedBefore = await deniedMail.call('env.snapshot');
    const denied = await publishPending({snapshot: {data: before, run_id: 'bw-mail-denied'}, router: deniedRouter});
    assert.equal(denied.stopped, true);
    assert.equal(denied.results[0].receipt.code, 'recipient_not_authorized');
    assert.deepEqual(created.state.data.devices, before.devices);
    const inboxAfter = await mail.call('mail.search', {folder: 'inbox'});
    assert.equal(inboxAfter.messages.length, inboxBefore.messages.length);
    const deniedAfter = await deniedMail.call('env.snapshot');
    assert.deepEqual(deniedAfter.snapshot.data.messages, deniedBefore.snapshot.data.messages);
    let publishes = 0;
    const dropping = {
      async call(name, args) {
        publishes += 1;
        await router.call(name, args);
        throw new Error('acknowledgement dropped');
      }
    };
    const lost = await publishPending({snapshot: {data: before, run_id: 'bw-mail'}, router: dropping});
    assert.equal(lost.delivery, 'unresolved');
    assert.equal(lost.results[0].request_id, 'notice-' + before.notices[0].notice_id);
    assert.equal(lost.results[0].run_id, 'bw-mail');
    assert.equal(publishes, 1);
    const mailInfra = new Client('mail', 'infra', 'bw-mail', dir, 'bw-mail-infra', {registry: path.join(root, 'examples/registry.mail.json')});
    clients.push(mailInfra);
    await mailInfra.initialize();
    const stopped = lost.results[0];
    const reconciled = await reconcilePending({snapshot: {data: before, run_id: 'bw-mail'}, mail: mailInfra, attempt: stopped});
    assert.equal(reconciled.results.length, 1);
    assert.equal(reconciled.results[0].delivery, 'confirmed');
    assert.equal(reconciled.results[0].notice_id, before.notices[0].notice_id);
    assert.equal(reconciled.results[0].message_id, 'brightwire-' + before.account_id + '-' + before.notices[0].notice_id);
    assert.equal(publishes, 1);
    const lookup = {async call() { throw new Error('mail lookup failed'); }};
    const failedLookup = await reconcilePending({snapshot: {data: before}, mail: lookup, attempt: stopped});
    assert.equal(failedLookup.delivery, 'unresolved');
    assert.equal(failedLookup.results[0].request_id, stopped.request_id);
    assert.equal(failedLookup.results[0].message_id, stopped.message_id);
    assert.equal(publishes, 1);
    const missing = {
      data: {
        account_id: before.account_id,
        notices: [{...before.notices[0], notice_id: 'nt-missing', delivery_status: 'pending_delivery'}]
      }
    };
    let silentCalls = 0;
    const silent = {async call() { silentCalls += 1; throw new Error('receiver down'); }};
    const unpublished = await publishPending({snapshot: {...missing, run_id: 'bw-missing'}, router: silent});
    assert.equal(unpublished.results[0].request_id, 'notice-nt-missing');
    assert.equal(silentCalls, 1);
    const unresolved = await reconcilePending({snapshot: missing, mail: mailInfra, attempt: unpublished.results[0]});
    assert.equal(unresolved.delivery, 'unresolved');
    assert.equal(unresolved.results[0].delivery, 'unresolved');
    assert.equal(silentCalls, 1);
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

function messageOf(data, notice) {
  return require('../src/publisher.cjs').messageFor(data, notice);
}

test('a Mail receiver rejection after dispatch stays unresolved and is not published again', async () => {
  const crypto = require('node:crypto');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-mail-reject-'));
  const clients = [];
  function canonical(value) {
    return JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
      : item);
  }
  try {
    const model = createRuntime({registryFile: path.join(root, 'apps.registry.json')});
    let state = model.create('brightwire-home', 'bw-reject', 'sandbox');
    const data = structuredClone(state.data);
    data.owner_person_id = 'person-maya';
    data.members.find(member => member.role === 'owner').person_id = 'person-maya';
    data.members.find(member => member.person_id === 'person-maya').name = 'Maya Chen';
    data.notices = [{
      notice_id: 'nt-reject',
      kind: 'leak',
      created_at: '2026-11-17T12:01:00-06:00',
      recipient_person_id: 'person-maya',
      object_type: 'alert',
      object_id: 'al-1',
      title: 'Brightwire: water leak',
      body: 'Kitchen leak sensor reports water.',
      delivery_status: 'pending_delivery',
      publish_request_id: null,
      messaging_event_id: null
    }];
    const binding = structuredClone(state.binding);
    binding.people.push({person_id: 'person-maya', name: 'Maya Chen'});
    binding.accounts = [{app_id: 'brightwire-home', account_id: data.account_id, owner_person_id: 'person-maya'}];
    const seeded = model.execute(state, 'infra', 'env.load_seed', {
      expected_version: model.version(state),
      request_id: 'reject-seed',
      virtual_now: '2026-11-17T12:00:00-06:00',
      data, binding, policies: state.policies, bundle: state.resources.bundle
    });
    assert.equal(seeded.result.status, 'ready', JSON.stringify(seeded.result));
    const granted = path.join(dir, 'granted.json');
    config(granted, [{app_id: 'mail', account_id: 'mail-maya', channel: 'channel.email'}]);
    const router = new Client(null, null, null, null, 'bw-reject-router', {commandArgs: [
      path.join(root, 'runtime/messaging/service.cjs'), '--config', granted, '--publisher', 'brightwire-home', '--run', 'bw-reject', '--state-dir', dir
    ]});
    clients.push(router);
    await router.initialize();
    const mailInfra = new Client('mail', 'infra', 'bw-reject', dir, 'bw-reject-infra', {registry: path.join(root, 'examples/registry.mail.json')});
    clients.push(mailInfra);
    await mailInfra.initialize();
    const snap = await mailInfra.call('env.snapshot');
    const message = messageOf(data, data.notices[0]);
    const eventId = 'router-' + crypto.createHash('sha256').update(canonical({
      run: 'bw-reject',
      source: message.source,
      id: message.id,
      target: 'mail',
      account: snap.snapshot.data.account_id,
      epoch: snap.snapshot.epoch
    })).digest('hex').slice(0, 32);
    const mailFile = path.join(dir, 'bw-reject', 'mail.json');
    const stored = JSON.parse(fs.readFileSync(mailFile, 'utf8'));
    const sample = stored.data.messages[0];
    stored.data.messages.push({
      id: eventId,
      thread_id: message.id,
      account_id: sample.account_id,
      from: 'brightwire-home@pale.example',
      to: sample.to,
      subject: 'Already stored',
      body: 'A previous attempt left this record.',
      received_at: sample.received_at,
      folder: 'inbox',
      read: false,
      attachments: []
    });
    fs.writeFileSync(mailFile, JSON.stringify(stored));
    let publishes = 0;
    const counting = {async call(name, args) { publishes += 1; return router.call(name, args); }};
    const rejected = await publishPending({snapshot: {data}, router: counting, run_id: 'bw-reject'});
    assert.equal(publishes, 1);
    assert.equal(rejected.stopped, true);
    assert.equal(rejected.results[0].receipt.code, 'receiver_rejected');
    const after = await mailInfra.call('env.snapshot');
    assert.equal(after.snapshot.data.messages.length, stored.data.messages.length);
    const reconciled = await reconcilePending({snapshot: {data}, mail: mailInfra, attempt: rejected.results[0]});
    assert.equal(reconciled.results.length, 1);
    assert.equal(reconciled.delivery, 'unresolved');
    assert.equal(reconciled.results[0].request_id, 'notice-nt-reject');
    assert.equal(publishes, 1);
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('a real snapshot supplies the run id and a lost acknowledgement still confirms', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-mail-snapshot-'));
  const clients = [];
  try {
    const infra = new Client('brightwire-home', 'infra', 'lost-ack', dir, 'bw-infra', {registry: path.join(root, 'apps.registry.json'), initialProfile: 'sandbox'});
    const agent = new Client('brightwire-home', 'agent', 'lost-ack', dir, 'bw-agent', {registry: path.join(root, 'apps.registry.json')});
    clients.push(infra, agent);
    await infra.initialize();
    await agent.initialize();
    const opened = await infra.call('env.snapshot');
    const data = structuredClone(opened.snapshot.data);
    data.owner_person_id = 'person-maya';
    data.members.find(member => member.role === 'owner').person_id = 'person-maya';
    data.members.find(member => member.person_id === 'person-maya').name = 'Maya Chen';
    for (const notice of data.notices) notice.delivery_status = 'committed';
    const binding = structuredClone(opened.snapshot.binding);
    binding.people.push({person_id: 'person-maya', name: 'Maya Chen'});
    binding.accounts = [{app_id: 'brightwire-home', account_id: data.account_id, owner_person_id: 'person-maya'}];
    const seeded = await infra.call('env.load_seed', {
      expected_version: opened.version,
      request_id: 'lost-ack-seed',
      virtual_now: opened.snapshot.data.committed_through,
      data,
      binding,
      policies: opened.snapshot.policies,
      bundle: opened.snapshot.resources.bundle
    });
    assert.equal(seeded.status, 'ready', JSON.stringify(seeded));
    const asked = await agent.call('brightwire-home.devices.command', {
      expected_version: seeded.version,
      request_id: 'lost-ack-unlock',
      device_id: 'lock-front',
      command: 'unlock'
    });
    assert.equal(asked.status, 'committed', JSON.stringify(asked));
    assert.equal(asked.outcome, 'confirmation_required');
    const snap = await infra.call('env.snapshot');
    assert.equal(snap.snapshot.run_id, 'lost-ack');
    assert.equal(snap.snapshot.data.notices.filter(notice => notice.delivery_status === 'pending_delivery').length, 1);
    const granted = path.join(dir, 'granted.json');
    config(granted, [{app_id: 'mail', account_id: 'mail-maya', channel: 'channel.email'}]);
    const router = new Client(null, null, null, null, 'lost-ack-router', {commandArgs: [
      path.join(root, 'runtime/messaging/service.cjs'), '--config', granted, '--publisher', 'brightwire-home', '--run', 'lost-ack', '--state-dir', dir
    ]});
    clients.push(router);
    await router.initialize();
    let publishes = 0;
    const dropping = {
      async call(name, args) {
        publishes += 1;
        const receipt = await router.call(name, args);
        assert.equal(receipt.status, 'committed', JSON.stringify(receipt));
        throw new Error('acknowledgement dropped');
      }
    };
    const lost = await publishPending({snapshot: snap, router: dropping});
    assert.equal(publishes, 1);
    assert.equal(lost.results.length, 1);
    assert.equal(lost.delivery, 'unresolved');
    assert.equal(lost.results[0].run_id, 'lost-ack');
    const mail = new Client('mail', 'infra', 'lost-ack', dir, 'lost-ack-mail', {registry: path.join(root, 'examples/registry.mail.json')});
    clients.push(mail);
    await mail.initialize();
    const reconciled = await reconcilePending({snapshot: snap, mail, attempt: lost.results[0]});
    assert.equal(reconciled.results.length, 1);
    assert.equal(reconciled.delivery, 'confirmed');
    assert.equal(reconciled.results[0].run_id, 'lost-ack');
    assert.equal(publishes, 1);
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
