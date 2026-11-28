#!/usr/bin/env node
'use strict';
// One Benchline to Mail flow with the real router process, the real Mail package and the Mail Agent tools.
// Usage: node tests/mail.integration.cjs --runtime DIR [--report FILE]. PALE_RUNTIME_ROOT can replace --runtime.
const fs = require('node:fs'), path = require('node:path'), util = require('node:util');
const {createSender, dispatchId} = require('../infra/sender.cjs');

const DIR = path.resolve(__dirname, '..'), APP = 'benchline.', ACCOUNT = 'benchline-nadia';
// Exit code 77 says that the script was skipped: it printed SKIP and ran no check.
const SKIPPED = 77;
const MAILBOX = {account_id: 'mail-nadia', owner_person_id: 'person-nadia', address: 'nadia.ferrante@example.com'};
const at = text => '2026-' + text.slice(0, 5) + 'T' + text.slice(6) + ':00-05:00';
const START = at('12-02 07:00');
const read = file => JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const policies = () => ({...read('examples/task-data/policies.json'), scenario: {allow: read('tools.json').map(tool => tool.name), constraints: {}}});
const PLAN = read('tests/proposal-events.json');

function options(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--runtime', '--report'].includes(argv[i]) || !argv[i + 1]) throw new Error('Usage: node tests/mail.integration.cjs --runtime DIR [--report FILE]');
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}
const checks = [];
function check(name, condition, got, note) {
  checks.push({name, status: condition ? 'passed' : 'failed', ...(note ? {note} : {})});
  if (!condition) throw new Error(name + (got === undefined ? '' : '\n  got: ' + JSON.stringify(got)));
}
function equal(name, actual, expected, note) {
  check(name, util.isDeepStrictEqual(actual, expected), {expected, actual}, note);
}

// Events as [kind, at, payload]. Each one writes one notification. The plan's events keep their own time and payload.
const plan = id => { const e = PLAN.find(x => x.event_id === id); return [e.operation.slice(APP.length), e.at, structuredClone(e.payload)]; };
const allocation = (hours, when, reason = 'The department moved hours to the shared pool.') => ['allocation.changed', when, {allocation_hours: hours, changed_by: 'person-okafor', reason}];
const firstEvent = () => allocation(450, at('12-02 07:30'));
const proposal = () => plan('ev-bl-230');
const other = (n, when) => ['protocol.proposed', when, {protocol_id: 'proto-x' + n + '-v1', line: 'extra-' + n, dataset_version: 'eeg-subjects-2026.2', eval_split: 'test-subjects',
  metrics: [{name: 'accuracy', direction: 'higher'}], seeds: [0], proposed_by: 'person-mei'}];
const bump = (n, when) => allocation(450 + n * 10, when, 'Adjustment ' + n + '.');
const oldMail = n => ({id: 'old-' + n, thread_id: 'old-' + n, account_id: MAILBOX.account_id, from: 'news@example.com', to: [MAILBOX.address],
  subject: 'Old message ' + n, body: 'An old message that fills the mailbox.', received_at: '2026-11-01T08:00:00-05:00', folder: 'archive', read: true, attachments: []});
const SUBMIT = {id: 'cfg-mae-b16-v3', seed: 2, partition_id: 'gpu-h', gpus: 2, time_limit_hours: 12, protocol_id: 'proto-subj-v2'};

// One run with its own router. Mail and Benchline are loaded first, because the router binds its receivers when it starts.
// `mailbox` is the Mail account of the run. The binding of the run names it with its owner.
async function stage(env, run, {grant = true, messages = [], mailbox = MAILBOX} = {}) {
  const seed = read('examples/task-data/seed.json'), binding = read('examples/task-data/binding.json'), mine = [];
  binding.accounts = binding.accounts.map(account => account.app_id === 'mail' ? {app_id: 'mail', account_id: mailbox.account_id, owner_person_id: mailbox.owner_person_id} : account);
  const open = async (app, role) => {
    const client = new env.Client(app, role, run, env.state, 'benchline-mail-integration', {registry: app === 'mail' ? env.mailRegistry : env.prepared.registry});
    env.clients.push(client); mine.push(client);
    await client.initialize();
    return client;
  };
  const load = async (client, args) => {
    const result = await client.call('env.load_seed', {expected_version: (await client.call('env.snapshot')).version, request_id: 'task-seed', binding, virtual_now: START, ...args});
    if (result.status !== 'ready') throw new Error('A seed did not load in run ' + run + ': ' + JSON.stringify(result));
  };
  const mailInfra = await open('mail', 'infra'), infra = await open('benchline', 'infra');
  await load(mailInfra, {data: {...mailbox, messages}});
  await load(infra, {data: seed, policies: policies()});
  const config = read('infra/router.config.example.json'), file = path.join(env.state, 'router.' + run + '.json');
  if (!grant) config.publishers[0].allowed_recipients = [];
  fs.writeFileSync(file, JSON.stringify(config));
  const router = new env.Client(null, null, null, null, 'benchline-sender', {commandArgs: [path.join(env.runtime, 'messaging/service.cjs'),
    '--config', file, '--publisher', 'benchline', '--run', run, '--state-dir', env.state]});
  env.clients.push(router); mine.push(router);
  await router.initialize();
  const s = {run, seed, infra, router, mail: await open('mail', 'agent'), agent: await open('benchline', 'agent'), sender: createSender({infra, router}), seq: 0};
  s.state = async () => (await infra.call('env.snapshot')).snapshot;
  s.mailState = async () => (await mailInfra.call('env.snapshot')).snapshot;
  s.inbox = async () => (await s.mail.call('mail.search', {})).messages;
  s.halted = async () => (await router.call('router.capabilities')).halted;
  // The router keeps one metadata row for each publish attempt. It holds the full receipt, with stop_run.
  s.receipts = () => fs.readFileSync(path.join(env.state, run, 'messaging.receipts.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const committed = (label, result) => { if (result.status !== 'committed') throw new Error(label + ' was not committed: ' + JSON.stringify(result)); };
  const version = async () => (await infra.call('env.snapshot')).version;
  // Applies one event to Benchline and returns the notification that it wrote.
  s.event = async (kind, when, payload) => {
    committed(kind, await infra.call('env.apply_event', {expected_version: await version(), event: {event_id: 'ev-mail-' + (++s.seq), at: when, operation: APP + kind, payload}}));
    const list = (await s.state()).data.notifications;
    return list[list.length - 1];
  };
  s.write = async (name, args) => { const result = await s.agent.call(APP + name, {...args, expected_version: await version(), request_id: 'mail-w' + (++s.seq)}); committed(name, result); return result; };
  s.clock = async when => committed('env.advance_time on Benchline', await infra.call('env.advance_time', {expected_version: await version(), virtual_now: when, request_id: 'clock-' + (++s.seq)}));
  // Infra moves the clock of Mail before a delivery. Mail records the message at this time.
  s.mailClock = async when => committed('env.advance_time on Mail', await mailInfra.call('env.advance_time',
    {expected_version: (await mailInfra.call('env.snapshot')).version, virtual_now: when, request_id: 'mail-clock-' + (++s.seq)}));
  s.resetMail = async () => {
    const result = await mailInfra.call('env.reset', {expected_version: (await mailInfra.call('env.snapshot')).version});
    if (result.status !== 'ready') throw new Error('env.reset on Mail failed: ' + JSON.stringify(result));
  };
  s.close = () => Promise.allSettled(mine.map(client => client.close()));
  return s;
}

async function delivery(s) {
  equal('dispatchId keeps the notification ID in the first lifecycle and adds the epoch in a later one', [dispatchId('ntf-0016', 2, 2), dispatchId('ntf-0016', 3, 2)], ['ntf-0016', 'ntf-0016.e3']);
  const capabilities = await s.router.call('router.capabilities'), tools = (await s.router.request('tools/list')).result.tools.map(tool => tool.name);
  equal('The real router process reads the publish declaration of the package, and its connection has no env.* operation', [capabilities.publisher, capabilities.channels, tools],
    ['benchline', [{channel: 'channel.email', schema_id: 'urn:pale:email-message:2', event_type: 'org.pale.mail.notification.v1', payload_schema_id: 'urn:pale:email-payload:1'}],
      ['router.capabilities', 'router.publish']]);

  const one = await s.event(...firstEvent());
  equal('allocation.changed writes ntf-0016 with its full wire message, addressed to the owner of the account',
    [one.id, one.object_id, one.email.id, one.email.data.content, one.email.data.recipient, one.email.data.source_object],
    ['ntf-0016', 'alloc-2026-12', one.id, {title: one.title, body: {format: 'text/plain', text: one.text}, asset_ids: []}, {kind: 'person_ref', id: MAILBOX.owner_person_id},
      {app_id: 'benchline', account_id: ACCOUNT, object_type: 'allocation', object_id: 'alloc-2026-12'}]);
  await s.mailClock(at('12-02 07:35'));
  const out = await s.sender.publishPending();
  equal('sender.publishPending publishes ntf-0016 once under its notification ID, and the receipt is committed',
    [out.lifecycle, out.stopped, out.results.map(r => [r.notification_id, r.request_id, r.status, r.duplicate])], ['first', false, [[one.id, one.id, 'committed', false]]]);

  // job.ended is written at the submission and released at the end of the job. The sender waits for the clock.
  await s.clock(at('12-02 08:00'));
  const submitted = await s.write('jobs.submit', SUBMIT), ended = (await s.state()).data.notifications.slice(-1)[0];
  equal('jobs.submit at 08:00 writes the job.ended notice ntf-0017 now, released at the end of the job at 18:30', [ended.id, ended.kind, ended.object_id, ended.at, ended.email.time],
    ['ntf-0017', 'job.ended', submitted.id, at('12-02 18:30'), at('12-02 18:30')]);
  const early = await s.sender.publishPending();
  equal('Before its release time the sender publishes nothing and counts the notice as waiting, and Mail has no record of it', [early.results, early.waiting, (await s.inbox()).length], [[], 1, 1]);
  await s.clock(at('12-02 18:30'));
  await s.mailClock(at('12-02 18:31'));
  const before = await s.state(), sent = await s.sender.publishPending(), row = sent.results[0];
  equal('Once the clock has reached 18:30 the sender publishes ntf-0017 once under its notification ID, and the receipt is committed',
    [sent.epoch, sent.lifecycle, sent.stopped, sent.results.length, row.notification_id, row.request_id, row.status, row.code, row.duplicate, sent.waiting],
    [before.epoch, 'first', false, 1, 'ntf-0017', 'ntf-0017', 'committed', null, false, 0]);
  check('The sender wrote nothing to Benchline: its state, version and audit are byte-identical', same(await s.state(), before));
  const got = await s.mail.call('mail.get', {id: row.event_id});
  if (got.status !== 'ok') throw new Error('mail.get did not find the delivered record: ' + JSON.stringify(got));
  equal('The Mail Agent reads the record with mail.get and the event_id of the receipt: in the inbox of mail-nadia, unread, with the title and the text of the notice',
    [got.message.account_id, got.message.folder, got.message.read, got.message.subject, got.message.body, got.message.to, got.message.from],
    [MAILBOX.account_id, 'inbox', false, ended.title, ended.text, [MAILBOX.address], 'benchline@pale.example']);
  const receipt = s.receipts().find(entry => entry.request_id === ended.id).result;
  equal('The receipt ties the Mail record to the notification ID', [receipt.status, receipt.cloud_event.id, receipt.event_id, receipt.target, got.message.thread_id],
    ['committed', ended.id, got.message.id, {app_id: 'mail', account_id: MAILBOX.account_id}, ended.id]);
  equal('The times are kept apart: the wire time is the release time of the notice, and received_at is the virtual time of Mail',
    [ended.email.time, receipt.cloud_event.time, got.message.received_at, receipt.applied_at], [at('12-02 18:30'), at('12-02 18:30'), at('12-02 18:31'), at('12-02 18:31')]);
  // A cancelled job's notice is removed before its release time, so it is never sent.
  await s.clock(at('12-02 18:40'));
  const second = await s.write('jobs.submit', {id: 'cfg-vit-s16-v2', seed: 0, partition_id: 'gpu-a', gpus: 1, time_limit_hours: 12, protocol_id: 'proto-subj-v2'});
  await s.write('jobs.cancel', {id: second.id});
  const removed = (await s.state()).data.notifications.find(n => n.object_id === second.id);
  await s.clock(at('12-03 09:00'));
  const quiet = await s.sender.publishPending();
  equal('A notice removed by jobs.cancel before its release time is never sent, even after that time', [removed.removed_at, quiet.results, quiet.waiting, (await s.inbox()).length],
    [at('12-02 18:40'), [], 0, 2]);
  const notice = await s.event(...proposal());
  await s.mailClock(at('12-03 11:05'));
  const third = await s.sender.publishPending();
  equal('ev-bl-230 writes the protocol.proposed notice ntf-0019, and the sender delivers it', [notice.id, notice.kind, third.results.map(r => [r.notification_id, r.status])],
    ['ntf-0019', 'protocol.proposed', [['ntf-0019', 'committed']]]);
  const inbox = await s.inbox(), history = s.seed.notifications;
  check('Seed history is not sent: the ' + history.length + ' notifications of the loaded seed have a wire message, and Mail holds only the three new ones',
    history.length > 0 && history.every(n => n.email !== null) && same(inbox.map(m => m.thread_id), [one.id, ended.id, notice.id]), inbox);
  return {first: one, notice: ended, row, firstEpoch: sent.firstEpoch};
}

async function noticesOff(s) {
  await s.write('preferences.update', {email_notices: false});
  const quiet = await s.event(...other(1, at('12-03 12:00')));
  const listed = (await s.agent.call(APP + 'notifications.list', {})).items.find(item => item.id === quiet.id);
  const silent = await s.sender.publishPending();
  equal('With email_notices off the next event writes a notification with no wire message, and nothing is published',
    [quiet.email, listed.email_stored, silent.results, silent.stopped, (await s.inbox()).length], [null, false, [], false, 3]);
  await s.write('preferences.update', {email_notices: true});
  const next = await s.event(...other(2, at('12-03 12:10')));
  await s.mailClock(at('12-03 12:15'));
  const resumed = await s.sender.publishPending(), inbox = await s.inbox();
  equal('With email_notices on again the next notification is sent, and the one written while it was off is never sent',
    [resumed.results.map(r => [r.notification_id, r.status]), inbox.map(m => m.thread_id)], [[[next.id, 'committed']], ['ntf-0016', 'ntf-0017', 'ntf-0019', next.id]]);
}

async function retries(s, {notice, row}) {
  const inbox = await s.inbox();
  const retry = await s.router.call('router.publish', {request_id: notice.id, message: notice.email});
  equal('An identical retry of ntf-0017 returns the first receipt with duplicate true and the same event_id, and Mail still has one record of it',
    [retry.status, retry.duplicate, retry.event_id, await s.inbox(), (await s.inbox()).filter(m => m.thread_id === notice.id).length], ['committed', true, row.event_id, inbox, 1]);
  const changed = structuredClone(notice.email);
  changed.data.content.body.text += ' Changed.';
  const conflict = await s.router.call('router.publish', {request_id: notice.id, message: changed});
  equal('The same request_id with changed text is rejected with idempotency_conflict, and Mail is unchanged',
    [conflict.status, conflict.code, await s.inbox()], ['rejected', 'idempotency_conflict', inbox]);
  const forged = {...notice.email, id: notice.id + '-forged', source: notice.email.source + '-other'};
  const mismatch = await s.router.call('router.publish', {request_id: forged.id, message: forged});
  equal('A message that names another source account is rejected with source_identity_mismatch, and Mail is unchanged',
    [mismatch.status, mismatch.code, await s.inbox()], ['rejected', 'source_identity_mismatch', inbox]);
  equal('A second publishPending publishes nothing, because a delivery is final', (await s.sender.publishPending()).results, []);
}

// Benchline is reset and Mail is not. The router and Mail still know the identities of the first lifecycle.
async function sourceReset(s, {first, row: firstRow}) {
  const old = await s.state(), mailEpoch = (await s.mailState()).epoch, inboxBefore = await s.inbox();
  const reset = await s.infra.call('env.reset', {expected_version: {epoch: old.epoch, revision: old.revision}}), fresh = await s.state();
  equal('env.reset on Benchline only: its epoch advances and its notifications are the seed again, and Mail keeps its epoch and its messages',
    [reset.status, fresh.epoch, fresh.data.notifications, (await s.mailState()).epoch, await s.inbox()], ['ready', old.epoch + 1, s.seed.notifications, mailEpoch, inboxBefore]);
  const renewed = await s.event(...bump(1, at('12-02 07:30')));
  check('After the reset a new notification gets the ID of a notification that was already delivered, with other content',
    renewed.id === first.id && renewed.title !== first.title && renewed.email.id === first.id, renewed);
  const plain = await s.router.call('router.publish', {request_id: renewed.id, message: renewed.email});
  equal('Control: under the plain notification ID the router refuses the new notice, because the router already knows that identity', [plain.status, plain.code], ['rejected', 'idempotency_conflict']);
  const identity = renewed.id + '.e' + fresh.epoch, out = await s.sender.publishPending(), row = out.results[0];
  equal('publishPending delivers the new notice as <id>.e<epoch>: committed, not a duplicate and not a conflict',
    [out.epoch, out.lifecycle, out.stopped, out.results.length, row.notification_id, row.request_id, row.status, row.code, row.duplicate, row.event_id === firstRow.event_id],
    [fresh.epoch, 'later', false, 1, renewed.id, identity, 'committed', null, false, false]);
  const inbox = await s.inbox();
  equal('Mail keeps the old messages and has exactly one new one, with the new title and text',
    [inbox.slice(0, inboxBefore.length), inbox.slice(inboxBefore.length).map(m => [m.id, m.thread_id, m.subject, m.body])], [inboxBefore, [[row.event_id, identity, renewed.title, renewed.text]]]);
  check('The seeded history is still not sent, under its own IDs or as <id>.e<epoch>',
    !inbox.some(m => s.seed.notifications.some(n => m.thread_id === n.id || m.thread_id === n.id + '.e' + fresh.epoch)), inbox.map(m => m.thread_id));
  const again = await s.sender.publishPending(), retry = await s.router.call('router.publish', {request_id: identity, message: {...renewed.email, id: identity}});
  equal('A second publishPending and a direct identical router.publish keep the identity and add no record',
    [again.results, retry.status, retry.duplicate, retry.event_id, (await s.inbox()).length], [[], 'committed', true, row.event_id, inbox.length]);
}

// Infra keeps one sender for the run. A second sender object, made after a reset, needs the first epoch of the run.
async function secondSender(s, {firstEpoch}) {
  const state = await s.state(), inbox = await s.inbox(), renewed = state.data.notifications[state.data.notifications.length - 1];
  const notice = await s.event(...bump(2, at('12-02 08:00'))), identity = id => id + '.e' + state.epoch, written = await s.state();
  const blind = await createSender({infra: s.infra, router: s.router}).publishPending();
  equal('Control: a second sender object with no firstEpoch reuses the plain notification ID. The router refuses it with idempotency_conflict, the sender stops, and Mail gets nothing',
    [blind.firstEpoch, blind.lifecycle, blind.stopped, blind.results.map(r => [r.request_id, r.status, r.code]), await s.halted(), await s.inbox()],
    [state.epoch, 'first', true, [[renewed.id, 'rejected', 'idempotency_conflict']], false, inbox]);
  check('Control: the refused publish changed nothing in Benchline', same(await s.state(), written));
  const out = await createSender({infra: s.infra, router: s.router, firstEpoch}).publishPending();
  equal('A second sender object created with firstEpoch publishes as <id>.e<epoch>: the notice that the first sender delivered is a duplicate, and the new notice is delivered',
    [out.firstEpoch, out.lifecycle, out.stopped, out.results.map(r => [r.notification_id, r.request_id, r.status, r.duplicate])],
    [firstEpoch, 'later', false, [[renewed.id, identity(renewed.id), 'committed', true], [notice.id, identity(notice.id), 'committed', false]]]);
  const now = await s.inbox();
  equal('Mail keeps its messages and has exactly one new one, with the title and the text of the new notice',
    [now.slice(0, inbox.length), now.slice(inbox.length).map(m => [m.thread_id, m.subject, m.body])], [inbox, [[identity(notice.id), notice.title, notice.text]]]);
}

// A second seed is loaded in the same run. It holds one more notification with a wire message than the first seed: a copy of an older notice.
// The ID of the copy has no number, so the App numbers the next notice as before. Then the first event is applied again: the new notice has the ID and text of a delivered one.
async function newSeed(s, {first, row}) {
  const old = await s.state(), inbox = await s.inbox(), epoch = old.epoch + 1, older = s.seed.notifications[s.seed.notifications.length - 1];
  const kept = {...older, id: 'ntf-second-seed', event_id: 'ev-history-2', email: {...older.email, id: 'ntf-second-seed'}};
  const loaded = await s.infra.call('env.load_seed', {expected_version: {epoch: old.epoch, revision: old.revision}, request_id: 'second-seed',
    data: {...s.seed, notifications: [...s.seed.notifications, kept]}, virtual_now: START});
  const repeated = await s.event(...firstEvent());
  const firstRow = s.receipts().find(entry => entry.request_id === first.id).result;
  const plain = await s.router.call('router.publish', {request_id: repeated.id, message: repeated.email});
  equal('Control: under the plain notification ID the router answers with the old receipt, marked duplicate, and the new notice does not reach Mail',
    [loaded.status, same(repeated.email, first.email), plain.duplicate, plain.event_id, await s.inbox()], ['ready', true, true, firstRow.event_id, inbox]);
  const out = await s.sender.publishPending(), now = await s.inbox(), held = (await s.state()).initial_data.notifications;
  equal('A new seed in the same run is a later lifecycle too: publishPending delivers the notice as <id>.e<epoch>, and Mail has one more message',
    [out.lifecycle, out.results.map(r => [r.request_id, r.status, r.duplicate]), now.length], ['later', [[first.id + '.e' + epoch, 'committed', false]], inbox.length + 1]);
  check('The seed history is read from each snapshot: the notification that only the second seed holds has a wire message, and it is not sent under its ID or as <id>.e<epoch>',
    held.some(n => n.id === kept.id && n.email !== null) && !s.seed.notifications.some(n => n.id === kept.id) &&
    !out.results.some(r => r.notification_id === kept.id) && !now.some(m => m.thread_id.startsWith(kept.id)), now.map(m => m.thread_id));
  check('No message in Mail came from the loaded seeds: every thread is a notification of a run, under its plain ID or as <id>.e<epoch>',
    now.every(m => !s.seed.notifications.some(n => m.thread_id.split('.e')[0] === n.id)), now.map(m => m.thread_id));
  equal('The delivered job.ended notice ntf-0017 is still one record in Mail', now.filter(m => m.id === row.event_id).length, 1);
}

// A run with Benchline alone: no Mail App in the registry, no Mail account in the binding and no router.
async function withoutMail(env) {
  const run = 'benchline-alone', binding = read('examples/task-data/binding.json'), mine = [];
  binding.accounts = binding.accounts.filter(account => account.app_id !== 'mail');
  const open = async role => {
    const client = new env.Client('benchline', role, run, env.state, 'benchline-mail-integration', {registry: env.prepared.registry});
    env.clients.push(client); mine.push(client);
    await client.initialize();
    return client;
  };
  const infra = await open('infra'), agent = await open('agent');
  const version = async () => (await infra.call('env.snapshot')).version;
  const loaded = await infra.call('env.load_seed', {expected_version: await version(), request_id: 'task-seed', data: read('examples/task-data/seed.json'), binding, policies: policies(), virtual_now: START});
  const apps = JSON.parse(fs.readFileSync(env.prepared.registry, 'utf8')).apps.map(app => app.app_id);
  equal('Without Mail: the registry of the run holds Benchline only, the binding has no Mail account, and the package requires no other App',
    [loaded.status, apps, binding.accounts.map(a => a.app_id), read('app.json').dependencies, read('contribution/contribution.json').dependencies.required_apps],
    ['ready', ['benchline'], ['benchline'], [], []]);
  const [kind, when, payload] = firstEvent();
  const applied = await infra.call('env.apply_event', {expected_version: await version(), event: {event_id: 'ev-alone-1', at: when, operation: APP + kind, payload}});
  const write = await agent.call(APP + 'jobs.submit', {...SUBMIT, expected_version: await version(), request_id: 'alone-w1'});
  await infra.call('env.advance_time', {expected_version: await version(), virtual_now: at('12-02 19:00'), request_id: 'alone-clock'});
  const listed = (await agent.call(APP + 'notifications.list', {start: '2026-12-02', end: '2026-12-02'})).items.filter(n => !n.id.startsWith('ntf-00') || n.id >= 'ntf-0016');
  equal('Without Mail: the event and the Agent write commit, the job runs, and both notices are stored with their wire message, which the Agent reads',
    [applied.status, write.status, listed.map(n => [n.id, n.kind, n.email_stored])], ['committed', 'committed', [['ntf-0016', 'allocation.changed', true], ['ntf-0017', 'job.ended', true]]]);
  const done = await agent.call(APP + 'jobs.get', {id: write.id});
  equal('Without Mail: the job reads completed with its result', [done.job.state, done.result.metrics], ['completed', {accuracy: 0.716}]);
  await Promise.allSettled(mine.map(client => client.close()));
}

// A run where the router finds no route to a mailbox. The refusal is final for each notification, and Mail gets nothing.
async function noRoute(env, label, run, code, options) {
  const s = await stage(env, run, options);
  const one = await s.event(...firstEvent()), two = await s.event(...bump(3, at('12-02 07:40')));
  const before = await s.state(), out = await s.sender.publishPending();
  const refused = id => ({notification_id: id, request_id: id, status: 'rejected', code, event_id: null, duplicate: false});
  equal(label + ': the router rejects each delivery before dispatch with ' + code + ', and the sender goes on to the next notification',
    [out.stopped, out.results], [false, [refused(one.id), refused(two.id)]]);
  const last = s.seed.notifications[s.seed.notifications.length - 1].id;
  equal(label + ': Mail has no record, the run is not halted, and both notifications are still in Benchline, which the sender did not change',
    [(await s.inbox()).length, (await s.mailState()).data.messages.length, await s.halted(), same(await s.state(), before), before.data.notifications.slice(-3).map(n => n.id)],
    [0, 0, false, true, [last, one.id, two.id]]);
  await s.close();
}
const noGrant = env => noRoute(env, 'No grant for channel.email', 'benchline-no-grant', 'recipient_not_authorized', {grant: false});
// The only Mail account of this run belongs to another person. So no mailbox is bound to the owner of the Benchline account.
const noMailbox = env => noRoute(env, 'No mailbox for the owner', 'benchline-no-mailbox', 'recipient_unavailable',
  {mailbox: {account_id: 'mail-okafor', owner_person_id: 'person-okafor', address: 'adaeze.okafor@example.com'}});

// What every halting case shows after the publish: the source commit, the state of Mail, and the halted run.
async function afterHalt(s, label, {notification, before, mailBefore, held, next}) {
  check(label + ': Benchline keeps its commit. The notification is still in env.snapshot, and nothing was written back to Benchline: the state is byte-identical',
    same(await s.state(), before) && before.data.notifications.some(n => n.id === notification.id && n.email !== null));
  const found = await s.mail.call('mail.search', {query: notification.title}), count = mailBefore.data.messages.length;
  equal(label + ': what Mail holds at that moment, read by the Mail Agent: ' + held + ', and no record of the notification. Its version is the same',
    [found.status, found.messages.length, (await s.inbox()).length, (await s.mailState()).revision], ['ok', 0, count, mailBefore.revision]);
  await s.event(...next);
  const out = await s.sender.publishPending();
  equal(label + ': the next publish in that run returns halted with run_halted, and the sender publishes nothing more',
    [out.stopped, out.results.map(r => [r.notification_id, r.status, r.code]), await s.halted(), (await s.inbox()).length], [true, [[notification.id, 'halted', 'run_halted']], true, count]);
}

// Mail holds at most 1000 messages (its seed schema). A full mailbox makes Mail refuse the delivery event in a repeatable way.
async function receiverRefusal(env) {
  const s = await stage(env, 'benchline-refusal', {messages: Array.from({length: 1000}, (_, i) => oldMail(i + 1))});
  const notification = await s.event(...firstEvent()), before = await s.state(), mailBefore = await s.mailState();
  const out = await s.sender.publishPending(), row = out.results[0], logged = s.receipts().pop().result;
  equal('Receiver refusal: Mail refuses the delivery into a full mailbox. The result is rejected with receiver_rejected and stop_run true, and the sender stops',
    [out.stopped, out.results.length, row.status, row.code, row.event_id, logged.stop_run, logged.reason], [true, 1, 'rejected', 'receiver_rejected', logged.event_id, true, 'invalid_event']);
  equal('Receiver refusal: mail.get with the attempted event_id finds nothing', (await s.mail.call('mail.get', {id: row.event_id})).status, 'not_found');
  await afterHalt(s, 'Receiver refusal', {notification, before, mailBefore, held: 'its 1000 old messages', next: bump(4, at('12-02 07:50'))});
  await s.close();
}

// The router binds Mail at its start. A reset of Mail in the run changes that lifecycle, so the router halts.
async function receiverReset(env) {
  const s = await stage(env, 'benchline-mail-reset');
  await s.event(...firstEvent());
  const delivered = await s.sender.publishPending();
  await s.resetMail();
  const notification = await s.event(...bump(5, at('12-02 07:40'))), before = await s.state(), mailBefore = await s.mailState();
  const out = await s.sender.publishPending(), row = out.results[0], logged = s.receipts().pop().result;
  equal('Receiver reset: after env.reset on Mail the router refuses the next delivery. The result is rejected with receiver_lifecycle_changed and stop_run true, and the sender stops',
    [delivered.results.map(r => r.status), out.stopped, out.results.length, row.notification_id, row.status, row.code, logged.stop_run],
    [['committed'], true, 1, notification.id, 'rejected', 'receiver_lifecycle_changed', true]);
  await afterHalt(s, 'Receiver reset', {notification, before, mailBefore, held: 'the empty mailbox of its seed', next: bump(6, at('12-02 08:00'))});
  await s.close();
}

// Core's lock for one App is the directory <state>/<run>/<app>.lock. While it exists, Mail cannot answer the router.
// This shows a receiver that does not answer. It does not reproduce a commit whose acknowledgement is lost.
async function unknownAnswer(env) {
  const s = await stage(env, 'benchline-unknown');
  const notification = await s.event(...firstEvent()), before = await s.state(), mailBefore = await s.mailState();
  const lock = path.join(env.state, s.run, 'mail.lock');
  let out;
  fs.mkdirSync(lock);
  try { out = await s.sender.publishPending(); } finally { fs.rmdirSync(lock); }
  const row = out.results[0], logged = s.receipts().pop().result;
  equal('Unknown answer: Mail does not answer the router while its state lock is held. The result is unknown with receiver_unconfirmed and stop_run true, and the sender stops',
    [out.stopped, out.results.length, row.status, row.code, row.event_id, logged.stop_run], [true, 1, 'unknown', 'receiver_unconfirmed', null, true],
    'This shows a receiver that does not answer: the router got no answer to its first call, so no delivery event was sent and the result has no event_id. ' +
    'It does not reproduce a commit in Mail whose acknowledgement is lost.');
  await afterHalt(s, 'Unknown answer', {notification, before, mailBefore, held: 'an empty mailbox (read after the lock is removed, when Mail answers again)',
    next: bump(7, at('12-02 07:50'))});
  await s.close();
}

async function main() {
  const opts = options(process.argv.slice(2)), root = opts.runtime || process.env.PALE_RUNTIME_ROOT;
  const skip = reason => { console.log('SKIP: ' + reason); process.exitCode = SKIPPED; };
  if (!root) return skip('the Mail flow needs the public runtime. Give --runtime DIR or set PALE_RUNTIME_ROOT.');
  const runtime = path.resolve(root), repo = path.dirname(runtime), mailRegistry = path.join(repo, 'examples/registry.mail.json'), publisher = path.join(repo, 'apps/benchline');
  if (!fs.existsSync(path.join(runtime, 'prepare.cjs')) || !fs.existsSync(path.join(runtime, 'messaging/service.cjs'))) return skip('no public runtime at ' + runtime + '.');
  // The router reads Mail and the publisher package from the checkout that holds the runtime.
  if (!fs.existsSync(mailRegistry) || !fs.existsSync(publisher) || fs.realpathSync(publisher) !== fs.realpathSync(DIR)) {
    return skip('the Mail flow needs the runtime of the public checkout that holds this package as apps/benchline, with examples/apps/mail.');
  }
  const prepared = require(path.join(runtime, 'prepare.cjs')).prepare(DIR), clients = [];
  const env = {runtime, prepared, clients, mailRegistry, state: path.join(prepared.root, 'state'), Client: require(path.join(runtime, 'client.cjs')).Client};
  const report = {schema: 'benchline.mail-integration.v1', runtime_version: require(path.join(runtime, 'package.json')).version, app_version: read('app.json').version,
    mail_version: require(path.join(repo, 'examples/apps/mail/app.json')).version, node: process.version, checks, passed: false};
  try {
    fs.mkdirSync(env.state, {recursive: true});
    const wire = 'schemas/router-message.schema.json';
    check(wire + ' is a byte copy of the wire schema of Mail ' + report.mail_version, fs.readFileSync(path.join(DIR, wire)).equals(fs.readFileSync(path.join(repo, 'examples/apps/mail', wire))));
    const s = await stage(env, 'benchline-mail'), delivered = await delivery(s);
    for (const part of [noticesOff, retries, sourceReset, secondSender, newSeed]) await part(s, delivered);
    await s.close();
    for (const scene of [withoutMail, noGrant, noMailbox, receiverRefusal, receiverReset, unknownAnswer]) await scene(env);
    report.passed = true;
    console.log('PASS: ' + checks.length + ' of ' + checks.length + ' Benchline to Mail real MCP checks passed.');
  } catch (error) {
    report.error = error.message;
    console.error('FAIL: ' + error.message);
    console.log('FAIL: ' + checks.filter(c => c.status === 'passed').length + ' of ' + checks.length + ' Benchline to Mail real MCP checks passed.');
    process.exitCode = 1;
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    prepared.cleanup();
  }
  if (opts.report) {
    fs.mkdirSync(path.dirname(path.resolve(opts.report)), {recursive: true});
    fs.writeFileSync(path.resolve(opts.report), JSON.stringify(report, null, 2) + '\n');
  }
}
main().catch(error => { console.error('FAIL: ' + error.message); process.exitCode = 1; });
