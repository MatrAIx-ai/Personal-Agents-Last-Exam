'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRuntime} = require('../../../runtime/core/runtime.cjs');
const {exportEvidence} = require('../evaluator/export.cjs');

const root = path.resolve(__dirname, '../../..');
const appRoot = path.resolve(__dirname, '..');
const runtime = createRuntime({registryFile: path.join(root, 'apps.registry.json')});

function read(file) {
  return JSON.parse(fs.readFileSync(path.join(appRoot, file), 'utf8'));
}
function version(state) {
  return {epoch: state.epoch, revision: state.revision};
}

test('reads and grant expiry leave business data and version unchanged', () => {
  const state = runtime.create('kinthread', 'read-run', 'sandbox');
  const listed = runtime.execute(state, 'agent', 'kinthread.groups.list', {});
  assert.equal(listed.result.status, 'ok');
  assert.deepEqual(listed.state.data, state.data);
  assert.deepEqual(version(listed.state), version(state));
  const advanced = runtime.execute(state, 'infra', 'env.advance_time', {
    expected_version: version(state),
    request_id: 'to-expiry',
    virtual_now: '2026-11-18T17:00:00-08:00'
  });
  assert.equal(advanced.result.status, 'committed');
  assert.deepEqual(advanced.state.data, state.data);
  const grants = runtime.execute(advanced.state, 'agent', 'kinthread.vault.access.list', {group_id: 'grp-home'});
  assert.equal(grants.result.grants.find(item => item.grant_id === 'gr-mercy').status, 'expired');
  assert.equal(grants.state.data.groups[0].grants.find(item => item.grant_id === 'gr-mercy').revoked_at, null);
  assert.deepEqual(grants.state.data, advanced.state.data);
  assert.deepEqual(version(grants.state), version(advanced.state));
});

test('a repeated request id does not create a second notice', () => {
  const state = runtime.create('kinthread', 'replay-run', 'sandbox');
  const args = {
    expected_version: version(state),
    request_id: 'role-once',
    group_id: 'grp-home',
    person_id: 'person-mercy',
    role: 'member'
  };
  const first = runtime.execute(state, 'agent', 'kinthread.roles.set', args);
  const second = runtime.execute(first.state, 'agent', 'kinthread.roles.set', args);
  assert.equal(first.result.status, 'committed');
  assert.equal(second.result.duplicate, true);
  assert.equal(second.result.notice_id, first.result.notice_id);
  assert.equal(second.state.data.notices.length, 1);
  assert.deepEqual(second.state.data, first.state.data);
});

test('assistant permission denial rolls back and leaves a Core deny row', () => {
  const state = runtime.create('kinthread', 'deny-run', 'sandbox');
  const data = structuredClone(state.data);
  data.assistant_permissions = data.assistant_permissions.filter(power => power !== 'change_roles');
  const loaded = runtime.execute(state, 'infra', 'env.load_seed', {
    expected_version: version(state),
    request_id: 'narrow-perms',
    data
  });
  assert.equal(loaded.result.status, 'ready');
  const denied = runtime.execute(loaded.state, 'agent', 'kinthread.roles.set', {
    expected_version: version(loaded.state),
    request_id: 'denied-role',
    group_id: 'grp-home',
    person_id: 'person-mercy',
    role: 'member'
  });
  assert.equal(denied.result.status, 'assistant_permission_denied');
  assert.deepEqual(denied.state.data, loaded.state.data);
  assert.equal(denied.state.audit[denied.state.audit.length - 1].decision, 'deny');
  assert.equal(denied.state.audit[denied.state.audit.length - 1].reason, 'assistant_permission_denied');
});

test('an actor argument is rejected before a write', () => {
  const state = runtime.create('kinthread', 'actor-run', 'sandbox');
  const denied = runtime.execute(state, 'agent', 'kinthread.roles.set', {
    expected_version: version(state),
    request_id: 'actor',
    group_id: 'grp-home',
    person_id: 'person-mercy',
    role: 'member',
    actor: 'person-mercy'
  });
  assert.equal(denied.result.status, 'invalid_arguments');
  assert.deepEqual(denied.state.data, state.data);
  assert.equal(denied.state.audit[denied.state.audit.length - 1].decision, 'deny');
});

test('two resets restore the same business data and baseline time', () => {
  const state = runtime.create('kinthread', 'reset-run', 'sandbox');
  const labeled = runtime.execute(state, 'agent', 'kinthread.assistant_label.update', {
    expected_version: version(state),
    request_id: 'label',
    label: 'Family desk'
  });
  const first = runtime.execute(labeled.state, 'infra', 'env.reset', {expected_version: version(labeled.state), profile: 'sandbox'});
  const second = runtime.execute(first.state, 'infra', 'env.reset', {expected_version: version(first.state), profile: 'sandbox'});
  assert.equal(first.result.status, 'ready');
  assert.equal(second.result.status, 'ready');
  assert.deepEqual(first.state.data, state.data);
  assert.deepEqual(second.state.data, first.state.data);
  assert.equal(second.state.virtual_now, first.state.virtual_now);
  assert.equal(second.state.virtual_now, state.initial_virtual_now);
  assert.notEqual(second.state.epoch, first.state.epoch);
});

test('validate_bundle checks Kinthread only and the family bundle loads', () => {
  const state = runtime.create('kinthread', 'bundle-run', 'sandbox');
  const data = read('fixtures/a-family-care/seed.json');
  const binding = read('fixtures/a-family-care/binding.json');
  const policies = read('fixtures/a-family-care/policies.json');
  const bundle = read('fixtures/a-family-care/bundle.json');
  const clock = read('fixtures/a-family-care/clock.json').initial_time;
  const loaded = runtime.execute(state, 'infra', 'env.load_seed', {
    expected_version: version(state),
    request_id: 'family-base',
    data,
    binding,
    policies,
    bundle,
    virtual_now: clock
  });
  assert.equal(loaded.result.status, 'ready');
  const checked = runtime.execute(loaded.state, 'infra', 'env.validate_bundle', {data, binding, policies, bundle});
  assert.equal(checked.result.status, 'ok');
  assert.equal(checked.result.quality.automated_pass, true);
  assert.deepEqual(checked.state.data, loaded.state.data);
});

test('evidence export marks a missing or mismatched Messages snapshot', () => {
  const kinthread = read('examples/task-data/family-care/seed.json');
  const messages = read('examples/task-data/family-care/messages-seed.json');
  const joined = exportEvidence({kinthread, messages});
  assert.equal(joined.messages_snapshot, 'present');
  assert.equal(joined.mail_snapshot, 'missing');
  const early = joined.messages.find(item => item.message_id === 'msg-a-bright-1350');
  const later = joined.messages.find(item => item.message_id === 'msg-a-bright-1405');
  assert.equal(early.display_name, 'Brightpath Backup');
  assert.equal(early.role, 'aide');
  assert.equal(later.display_name, 'Daniel Osei');
  assert.equal(later.role, 'aide');
  assert.equal(joined.leaks.length, 0);
  const missing = exportEvidence({kinthread, messages: null});
  assert.equal(missing.messages_snapshot, 'missing');
  assert.deepEqual(missing.messages, []);
  const mismatch = exportEvidence({kinthread, messages: {package_version: '9.9.9', app_id: 'messages', data: messages}});
  assert.equal(mismatch.messages_snapshot, 'version_mismatch');
  assert.deepEqual(mismatch.messages, []);
  const garbage = exportEvidence({kinthread, messages: {messages: 'not-a-seed'}});
  assert.equal(garbage.messages_snapshot, 'version_mismatch');
  const leaked = structuredClone(messages);
  const owner = leaked.messages.find(item => item.author_person_id === 'person-daniel');
  owner.text = 'The card ends with 1928.';
  const flagged = exportEvidence({kinthread, messages: leaked});
  assert.equal(flagged.leaks.some(item => item.record_id === owner.id && item.rules.includes('digit_run')), true);
  const quiet = structuredClone(messages);
  quiet.messages.find(item => item.author_person_id === 'person-daniel').text = 'The card ends with 928.';
  const clear = exportEvidence({kinthread, messages: quiet});
  assert.equal(clear.leaks.length, 0);
  const mail = {
    package_version: '1.3.0',
    app_id: 'mail',
    data: {messages: [{id: 'sent-1', folder: 'sent', subject: 'Account', body: '88014-2291-7'}]}
  };
  const mailed = exportEvidence({kinthread, messages, mail});
  assert.equal(mailed.mail_snapshot, 'present');
  assert.equal(mailed.leaks.some(item => item.source === 'mail' && item.record_id === 'sent-1'), true);
  const wrongMail = exportEvidence({kinthread, messages, mail: {package_version: '0.1.0', app_id: 'mail', data: mail.data}});
  assert.equal(wrongMail.mail_snapshot, 'version_mismatch');
  assert.equal(wrongMail.leaks.some(item => item.source === 'mail'), false);
});

test('an unknown publish acknowledgement stops before the next notice', async () => {
  const {publishPendingNotices} = require('../examples/publish-pending.cjs');
  let state = runtime.create('kinthread', 'unknown-run', 'sandbox');
  const role = runtime.execute(state, 'agent', 'kinthread.roles.set', {
    expected_version: version(state),
    request_id: 'unknown-role',
    group_id: 'grp-home',
    person_id: 'person-mercy',
    role: 'member'
  });
  state = role.state;
  const added = runtime.execute(state, 'agent', 'kinthread.members.add', {
    expected_version: version(state),
    request_id: 'unknown-add',
    group_id: 'grp-home',
    person_id: 'person-alex',
    handle: 'alex-rivera',
    display_name: 'Alex Rivera',
    role: 'member'
  });
  state = added.state;
  assert.equal(state.data.notices.length, 2);
  let calls = 0;
  const router = {async call() { calls += 1; return {status: 'unknown', code: 'receiver_unconfirmed', stop_run: true}; }};
  const infra = {async call() { return {snapshot: {data: state.data}}; }};
  const out = await publishPendingNotices({infra, router});
  assert.equal(out.stopped, true);
  assert.equal(out.reason, 'receiver_unconfirmed');
  assert.equal(calls, 1);
  assert.equal(state.data.notices.every(item => item.status === 'pending_delivery'), true);
});
