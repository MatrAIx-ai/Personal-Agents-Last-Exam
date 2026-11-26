'use strict';
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');

function demonstrate() {
  const f = fixture({dir: 'examples/task-data/family-care'});
  const before = f.data;
  const result = f.call('kinthread.roles.set', {
    group_id: 'grp-osei-care',
    person_id: 'person-mercy',
    role: 'member'
  });
  const notice = f.data.notices.find(item => item.notice_id === result.notice_id);
  assert.equal(notice.status, 'pending_delivery');
  assert.equal(notice.notice_type, 'role_change');
  assert.equal(notice.recipient_person_id, 'person-daniel');
  assert.equal(f.data.groups[0].members.find(member => member.person_id === 'person-mercy').role, 'member');
  assert.equal(before.notices.length, 0);
  return {
    group_id: 'grp-osei-care',
    person_id: 'person-mercy',
    from: 'admin',
    to: 'member',
    notice_id: notice.notice_id,
    status: notice.status,
    title: notice.title,
    body: notice.body
  };
}

async function publishAndRead() {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const {Client} = require('../../../runtime/client.cjs');
  const {publishPendingNotices} = require('./publish-pending.cjs');
  const root = path.resolve(__dirname, '../../..');
  const registry = path.join(root, 'apps.registry.json');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kinthread-role-'));
  const run = 'kinthread-role-example';
  const data = JSON.parse(JSON.stringify(require('../fixtures/minimal.json')).replaceAll('person-daniel', 'person-maya'));
  data.account_id = 'kt-maya';
  const binding = {
    people: [{person_id: 'person-maya', name: 'Maya Chen'}, {person_id: 'person-mercy', name: 'Mercy Osei'}],
    accounts: [{app_id: 'kinthread', account_id: 'kt-maya', owner_person_id: 'person-maya'}],
    objects: {kinthread: ['grp-home']}
  };
  fs.writeFileSync(path.join(dir, 'router.json'), JSON.stringify({
    schema_version: 2,
    registry: 'apps.registry.json',
    authentication: {mode: 'trusted-stdio'},
    publishers: [{
      app_id: 'kinthread',
      account_id: 'kt-maya',
      owner_person_id: 'person-maya',
      package_root: 'apps/kinthread',
      contribution_ref: 'contribution/contribution.json',
      allowed_recipients: [{app_id: 'mail', account_id: 'mail-maya', channel: 'channel.email'}]
    }]
  }, null, 2));
  const clients = [];
  const open = (app, role, name) => {
    const options = {registry};
    if (role === 'infra' && app === 'kinthread') options.initialProfile = 'sandbox';
    const client = new Client(app, role, run, dir, name, options);
    clients.push(client);
    return client;
  };
  try {
    const infra = open('kinthread', 'infra', 'role-infra');
    const agent = open('kinthread', 'agent', 'role-agent');
    await infra.initialize();
    await agent.initialize();
    const boot = await infra.call('env.snapshot');
    const loaded = await infra.call('env.load_seed', {
      expected_version: boot.version,
      request_id: 'role-seed',
      data,
      binding,
      policies: require('../fixtures/policies.json'),
      virtual_now: boot.snapshot.virtual_now
    });
    assert.equal(loaded.status, 'ready');
    const ready = await infra.call('env.snapshot');
    const args = {expected_version: ready.version, request_id: 'role-mercy', group_id: 'grp-home', person_id: 'person-mercy', role: 'member'};
    const changed = await agent.call('kinthread.roles.set', args);
    const replay = await agent.call('kinthread.roles.set', args);
    assert.equal(replay.duplicate, true);
    assert.equal(replay.notice_id, changed.notice_id);
    const router = new Client(null, null, null, null, 'role-router', {commandArgs: [
      path.join(root, 'runtime/messaging/service.cjs'),
      '--config', path.join(dir, 'router.json'),
      '--publisher', 'kinthread',
      '--run', run,
      '--state-dir', dir
    ]});
    clients.push(router);
    await router.initialize();
    const pendingSnap = await infra.call('env.snapshot');
    const notice = pendingSnap.snapshot.data.notices.find(item => item.notice_id === changed.notice_id);
    const sent = await publishPendingNotices({infra, router});
    const again = await publishPendingNotices({infra, router});
    const mail = open('mail', 'agent', 'role-mail');
    await mail.initialize();
    const got = await mail.call('mail.get', {id: sent.results[0].result.event_id});
    return {
      pending: {
        notice_id: notice.notice_id,
        status: notice.status,
        title: notice.title,
        body: notice.body
      },
      publish: {
        status: sent.results[0].result.status,
        event_id: sent.results[0].result.event_id,
        duplicate: again.results[0].result.duplicate === true
      },
      mail: {
        id: got.message.id,
        subject: got.message.subject,
        body: got.message.body,
        from: got.message.from,
        folder: got.message.folder
      }
    };
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

module.exports = {demonstrate, publishAndRead};
if (require.main === module) {
  publishAndRead().then(result => {
    console.log(JSON.stringify(result, null, 2));
  }).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
