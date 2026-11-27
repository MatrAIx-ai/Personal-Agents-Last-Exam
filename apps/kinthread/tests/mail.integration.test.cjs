'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Client} = require('../../../runtime/client.cjs');
const {publishPendingNotices} = require('../examples/publish-pending.cjs');

const root = path.resolve(__dirname, '../../..');
const registry = path.join(root, 'apps.registry.json');

function mayaSeed() {
  const data = structuredClone(require('../fixtures/minimal.json'));
  const next = JSON.parse(JSON.stringify(data).replaceAll('person-daniel', 'person-maya'));
  next.account_id = 'kt-maya';
  return next;
}
function binding() {
  return {
    people: [
      {person_id: 'person-maya', name: 'Maya Chen'},
      {person_id: 'person-mercy', name: 'Mercy Osei'},
      {person_id: 'person-alex', name: 'Alex Rivera'}
    ],
    accounts: [{app_id: 'kinthread', account_id: 'kt-maya', owner_person_id: 'person-maya'}],
    objects: {kinthread: ['grp-home']}
  };
}
function publisherConfig(file, recipients) {
  fs.writeFileSync(file, JSON.stringify({
    schema_version: 2,
    registry: 'apps.registry.json',
    authentication: {mode: 'trusted-stdio'},
    publishers: [{
      app_id: 'kinthread',
      account_id: 'kt-maya',
      owner_person_id: 'person-maya',
      package_root: 'apps/kinthread',
      contribution_ref: 'contribution/contribution.json',
      allowed_recipients: recipients
    }]
  }, null, 2));
}
function open(app, role, run, dir, name) {
  const options = {registry};
  if (role === 'infra' && app === 'kinthread') options.initialProfile = 'sandbox';
  return new Client(app, role, run, dir, name, options);
}
async function router(config, run, dir, name) {
  const client = new Client(null, null, null, null, name, {commandArgs: [
    path.join(root, 'runtime/messaging/service.cjs'),
    '--config', config,
    '--publisher', 'kinthread',
    '--run', run,
    '--state-dir', dir
  ]});
  await client.initialize();
  return client;
}

test('one role change yields one Mail message, a repeat is a duplicate, and a missing grant does not send', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kinthread-mail-'));
  const run = 'kinthread-mail';
  const deniedConfig = path.join(dir, 'denied.json');
  const grantedConfig = path.join(dir, 'granted.json');
  publisherConfig(deniedConfig, []);
  publisherConfig(grantedConfig, [{app_id: 'mail', account_id: 'mail-maya', channel: 'channel.email'}]);
  const clients = [];
  try {
    const infra = open('kinthread', 'infra', run, dir, 'kinthread-infra');
    const agent = open('kinthread', 'agent', run, dir, 'kinthread-agent');
    clients.push(infra, agent);
    await infra.initialize();
    await agent.initialize();
    const boot = await infra.call('env.snapshot');
    const loaded = await infra.call('env.load_seed', {
      expected_version: boot.version,
      request_id: 'maya-seed',
      data: mayaSeed(),
      binding: binding(),
      policies: require('../fixtures/policies.json'),
      virtual_now: boot.snapshot.virtual_now
    });
    assert.equal(loaded.status, 'ready');
    const mail = open('mail', 'agent', run, dir, 'mail-reader');
    const mailInfra = open('mail', 'infra', run, dir, 'mail-infra');
    clients.push(mail, mailInfra);
    await mail.initialize();
    await mailInfra.initialize();
    const beforeMail = await mailInfra.call('env.snapshot');
    const beforeCount = beforeMail.snapshot.data.messages.length;
    const ready = await infra.call('env.snapshot');
    const changed = await agent.call('kinthread.roles.set', {
      expected_version: ready.version,
      request_id: 'role-mercy',
      group_id: 'grp-home',
      person_id: 'person-mercy',
      role: 'member'
    });
    assert.equal(changed.status, 'committed');
    const pending = await infra.call('env.snapshot');
    const notice = pending.snapshot.data.notices.find(item => item.notice_id === changed.notice_id);
    assert.equal(notice.status, 'pending_delivery');
    assert.equal(pending.snapshot.data.groups[0].members.find(item => item.person_id === 'person-mercy').role, 'member');
    assert.equal((await mailInfra.call('env.snapshot')).snapshot.data.messages.length, beforeCount);
    const deniedRouter = await router(deniedConfig, run, dir, 'router-denied');
    clients.push(deniedRouter);
    const denied = await publishPendingNotices({infra, router: deniedRouter});
    assert.equal(denied.stopped, false);
    assert.equal(denied.results.length, 1);
    assert.equal(denied.results[0].result.status, 'rejected');
    assert.equal(denied.results[0].result.code, 'recipient_not_authorized');
    const still = await infra.call('env.snapshot');
    assert.equal(still.snapshot.data.notices[0].status, 'pending_delivery');
    assert.equal(still.snapshot.data.groups[0].members.find(item => item.person_id === 'person-mercy').role, 'member');
    assert.equal((await mailInfra.call('env.snapshot')).snapshot.data.messages.length, beforeCount);
    await deniedRouter.close();
    const grantedRouter = await router(grantedConfig, run, dir, 'router-granted');
    clients.push(grantedRouter);
    const sent = await publishPendingNotices({infra, router: grantedRouter});
    assert.equal(sent.stopped, false);
    assert.equal(sent.results[0].result.status, 'committed');
    assert.equal(sent.results[0].result.duplicate, undefined);
    const receipt = sent.results[0].result;
    const got = await mail.call('mail.get', {id: receipt.event_id});
    assert.equal(got.status, 'ok');
    assert.equal(got.message.subject, notice.title);
    assert.equal(got.message.body, notice.body);
    assert.equal(got.message.from, 'kinthread@pale.example');
    assert.equal(got.message.folder, 'inbox');
    const after = await mailInfra.call('env.snapshot');
    assert.equal(after.snapshot.data.messages.length, beforeCount + 1);
    const replay = await agent.call('kinthread.roles.set', {
      expected_version: ready.version,
      request_id: 'role-mercy',
      group_id: 'grp-home',
      person_id: 'person-mercy',
      role: 'member'
    });
    assert.equal(replay.duplicate, true);
    assert.equal(replay.notice_id, changed.notice_id);
    const again = await publishPendingNotices({infra, router: grantedRouter});
    assert.equal(again.results[0].result.duplicate, true);
    assert.equal(again.results[0].result.event_id, receipt.event_id);
    assert.equal((await mailInfra.call('env.snapshot')).snapshot.data.messages.length, beforeCount + 1);
    const traced = await mailInfra.call('env.event_status', {event_id: receipt.event_id});
    assert.equal(traced.receipt.status, 'committed');
    const current = await infra.call('env.snapshot');
    const recorded = await infra.call('env.apply_event', {
      expected_version: current.version,
      event: {
        event_id: 'deliver-role',
        at: current.snapshot.virtual_now,
        operation: 'notice.delivery_result',
        payload: {
          notice_id: notice.notice_id,
          publish_request_id: 'notice-' + notice.notice_id,
          status: 'committed',
          messaging_event_id: receipt.event_id
        }
      }
    });
    assert.equal(recorded.status, 'committed');
    const done = await infra.call('env.snapshot');
    assert.equal(done.snapshot.data.notices[0].status, 'recorded');
    assert.equal(done.snapshot.data.notices[0].delivery.status, 'committed');
    assert.equal(done.snapshot.data.notices[0].delivery.messaging_event_id, receipt.event_id);
    assert.equal(done.snapshot.data.groups[0].members.find(item => item.person_id === 'person-mercy').role, 'member');
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('an unknown receiver acknowledgement halts the router and leaves the next notice pending', async () => {
  const {messageFor} = require('../src/publisher.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kinthread-halt-'));
  const run = 'kinthread-halt';
  const config = path.join(dir, 'granted.json');
  publisherConfig(config, [{app_id: 'mail', account_id: 'mail-maya', channel: 'channel.email'}]);
  const previousOptions = process.env.NODE_OPTIONS;
  const previousDrop = process.env.KINTHREAD_DROP_MAIL_REPLY;
  process.env.KINTHREAD_DROP_MAIL_REPLY = '1';
  process.env.NODE_OPTIONS = '--require ' + path.join(root, 'apps/kinthread/tests/drop-mail-reply.cjs');
  const clients = [];
  try {
    const infra = open('kinthread', 'infra', run, dir, 'halt-infra');
    const agent = open('kinthread', 'agent', run, dir, 'halt-agent');
    clients.push(infra, agent);
    await infra.initialize();
    await agent.initialize();
    const boot = await infra.call('env.snapshot');
    const loaded = await infra.call('env.load_seed', {
      expected_version: boot.version,
      request_id: 'halt-seed',
      data: mayaSeed(),
      binding: binding(),
      policies: require('../fixtures/policies.json'),
      virtual_now: boot.snapshot.virtual_now
    });
    assert.equal(loaded.status, 'ready');
    let snap = await infra.call('env.snapshot');
    const role = await agent.call('kinthread.roles.set', {
      expected_version: snap.version,
      request_id: 'halt-role',
      group_id: 'grp-home',
      person_id: 'person-mercy',
      role: 'member'
    });
    snap = await infra.call('env.snapshot');
    const added = await agent.call('kinthread.members.add', {
      expected_version: snap.version,
      request_id: 'halt-add',
      group_id: 'grp-home',
      person_id: 'person-alex',
      handle: 'alex-rivera',
      display_name: 'Alex Rivera',
      role: 'member'
    });
    const pending = await infra.call('env.snapshot');
    assert.equal(role.status, 'committed', JSON.stringify(role));
    assert.equal(added.status, 'committed', JSON.stringify(added));
    assert.equal(pending.snapshot.data.notices.length, 2, JSON.stringify(pending.snapshot.data.notices));
    const mail = open('mail', 'agent', run, dir, 'halt-mail');
    const mailInfra = open('mail', 'infra', run, dir, 'halt-mail-infra');
    clients.push(mail, mailInfra);
    await mail.initialize();
    await mailInfra.initialize();
    const beforeCount = (await mailInfra.call('env.snapshot')).snapshot.data.messages.length;
    const grantedRouter = await router(config, run, dir, 'halt-router');
    clients.push(grantedRouter);
    const sent = await publishPendingNotices({infra, router: grantedRouter});
    assert.equal(sent.stopped, true);
    assert.equal(sent.results[0].result.status, 'unknown');
    assert.equal(sent.results[0].result.code, 'receiver_unconfirmed');
    assert.equal(sent.results[0].result.stop_run, true);
    assert.equal(fs.existsSync(path.join(dir, run, 'router.halted.json')), true);
    const second = pending.snapshot.data.notices.find(item => item.notice_id === added.notice_id);
    const blocked = await grantedRouter.call('router.publish', {
      request_id: 'notice-' + second.notice_id,
      message: messageFor(pending.snapshot.data.account_id, second)
    });
    assert.equal(blocked.status, 'halted');
    assert.equal(blocked.code, 'run_halted');
    const mailSnap = await mailInfra.call('env.snapshot');
    assert.equal(mailSnap.snapshot.data.messages.length, beforeCount + 1);
    const eventId = sent.results[0].result.event_id;
    const got = await mail.call('mail.get', {id: eventId});
    assert.equal(got.status, 'ok');
    const traced = await mailInfra.call('env.event_status', {event_id: eventId});
    assert.equal(traced.receipt.status, 'committed');
    const current = await infra.call('env.snapshot');
    const recorded = await infra.call('env.apply_event', {
      expected_version: current.version,
      event: {
        event_id: 'halt-deliver',
        at: current.snapshot.virtual_now,
        operation: 'notice.delivery_result',
        payload: {
          notice_id: role.notice_id,
          publish_request_id: 'notice-' + role.notice_id,
          status: 'committed',
          messaging_event_id: eventId
        }
      }
    });
    assert.equal(recorded.status, 'committed');
    const done = await infra.call('env.snapshot');
    const first = done.snapshot.data.notices.find(item => item.notice_id === role.notice_id);
    const next = done.snapshot.data.notices.find(item => item.notice_id === added.notice_id);
    assert.equal(first.delivery.status, 'committed');
    assert.equal(first.delivery.messaging_event_id, eventId);
    assert.equal(next.status, 'pending_delivery');
  } finally {
    if (previousOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousOptions;
    if (previousDrop === undefined) delete process.env.KINTHREAD_DROP_MAIL_REPLY;
    else process.env.KINTHREAD_DROP_MAIL_REPLY = previousDrop;
    await Promise.allSettled(clients.map(client => client.close()));
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
