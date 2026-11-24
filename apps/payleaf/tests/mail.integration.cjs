#!/usr/bin/env node
'use strict';
// One Payleaf to Mail flow with the real router process, the real Mail package and the Mail Agent tools.
// Usage: node tests/mail.integration.cjs --runtime DIR [--report FILE]. PALE_RUNTIME_ROOT can replace --runtime.
const fs = require('node:fs'), path = require('node:path'), util = require('node:util');
const {createSender, dispatchId} = require('../infra/sender.cjs');

const DIR = path.resolve(__dirname, '..'), APP = 'payleaf.';
// Exit code 77 says that the script was skipped: it printed SKIP and ran no check.
const SKIPPED = 77;
const MAILBOX = {account_id: 'mail-kai', owner_person_id: 'person-kai', address: 'kai.moreno@example.com'};
const at = text => '2026-' + text.slice(0, 5) + 'T' + text.slice(6) + ':00-05:00';
const START = at('11-19 14:00');
const read = file => JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const policies = () => ({...read('examples/task-data/policies.json'), scenario: {allow: read('tools.json').map(tool => tool.name), constraints: {}}});
// The example notification of the approved plan, as a full wire message.
const PLAN_EXAMPLE = {specversion: '1.0', id: 'ntf-0074', source: 'urn:pale:app:payleaf:account:payleaf-kai', type: 'org.pale.mail.notification.v1',
  time: '2026-11-23T10:15:00-05:00', datacontenttype: 'application/json', dataschema: 'urn:pale:email-payload:1',
  data: {channel: 'channel.email', recipient: {kind: 'person_ref', id: 'person-kai'},
    source_object: {app_id: 'payleaf', account_id: 'payleaf-kai', object_type: 'pay_date', object_id: 'pd-2026-25'},
    content: {title: 'Your next pay date moved from 4 December to 7 December', body: {format: 'text/plain', text: 'Payroll moved the pay date for the period 16 to 29 November ' +
      'from Friday 4 December to Monday 7 December. Reason given: the bank holiday schedule. Changes to your pay settings for this pay date are still accepted until ' +
      'Tuesday 1 December at 17:00. Open Payleaf to see your pay calendar.'}, asset_ids: []},
    subscription_ref: 'payleaf-kai:pay-calendar', extensions: []}};

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

// The three example events of the plan that come first in time. Each one writes one notification.
const TAXES = [{line_id: 't1', text: 'Federal income tax', amount: 412}, {line_id: 't2', text: 'Social security and Medicare', amount: 228}];
const posted = () => ['payroll.run_posted', at('11-20 06:00'), {entry_id: 'pd-2026-24', statement_id: 'ps-2026-24',
  earnings: [{line_id: 'e1', kind: 'salary', text: 'Regular pay', amount: 3200}], taxes: TAXES}];
const opened = () => ['enrollment.opened', at('11-23 09:00'), {window_id: 'win-2027', plan_year: 2027, opens_at: at('11-30 00:00'), closes_at: '2026-12-11T23:59:59-05:00',
  plan_ids: ['medical', 'dental', 'fsa']}];
const moved = () => ['calendar.changed', at('11-23 10:15'), {entry_id: 'pd-2026-25', pay_date: '2026-12-07', reason: 'The bank holiday schedule.'}];
const oldMail = n => ({id: 'old-' + n, thread_id: 'old-' + n, account_id: MAILBOX.account_id, from: 'news@example.com', to: [MAILBOX.address],
  subject: 'Old message ' + n, body: 'An old message that fills the mailbox.', received_at: '2026-11-01T08:00:00-05:00', folder: 'archive', read: true, attachments: []});

// One run with its own router. Mail and Payleaf are loaded first, because the router binds its receivers when it starts.
// `mailbox` is the Mail account of the run. The binding of the run names it with its owner.
async function stage(env, run, {grant = true, messages = [], mailbox = MAILBOX} = {}) {
  const seed = read('examples/task-data/seed.json'), binding = read('examples/task-data/binding.json'), mine = [];
  binding.accounts = binding.accounts.map(account => account.app_id === 'mail' ? {app_id: 'mail', account_id: mailbox.account_id, owner_person_id: mailbox.owner_person_id} : account);
  const open = async (app, role) => {
    const client = new env.Client(app, role, run, env.state, 'payleaf-mail-integration', {registry: app === 'mail' ? env.mailRegistry : env.prepared.registry});
    env.clients.push(client); mine.push(client);
    await client.initialize();
    return client;
  };
  const load = async (client, args) => {
    const result = await client.call('env.load_seed', {expected_version: (await client.call('env.snapshot')).version, request_id: 'task-seed', binding, virtual_now: START, ...args});
    if (result.status !== 'ready') throw new Error('A seed did not load in run ' + run + ': ' + JSON.stringify(result));
  };
  const mailInfra = await open('mail', 'infra'), infra = await open('payleaf', 'infra');
  await load(mailInfra, {data: {...mailbox, messages}});
  await load(infra, {data: seed, policies: policies()});
  const config = read('infra/router.config.example.json'), file = path.join(env.state, 'router.' + run + '.json');
  if (!grant) config.publishers[0].allowed_recipients = [];
  fs.writeFileSync(file, JSON.stringify(config));
  const router = new env.Client(null, null, null, null, 'payleaf-sender', {commandArgs: [path.join(env.runtime, 'messaging/service.cjs'),
    '--config', file, '--publisher', 'payleaf', '--run', run, '--state-dir', env.state]});
  env.clients.push(router); mine.push(router);
  await router.initialize();
  const s = {run, seed, infra, router, mail: await open('mail', 'agent'), agent: await open('payleaf', 'agent'), sender: createSender({infra, router}), seq: 0};
  s.state = async () => (await infra.call('env.snapshot')).snapshot;
  s.mailState = async () => (await mailInfra.call('env.snapshot')).snapshot;
  s.inbox = async () => (await s.mail.call('mail.search', {})).messages;
  s.halted = async () => (await router.call('router.capabilities')).halted;
  // The router keeps one metadata row for each publish attempt. It holds the full receipt, with stop_run.
  s.receipts = () => fs.readFileSync(path.join(env.state, run, 'messaging.receipts.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const committed = (label, result) => { if (result.status !== 'committed') throw new Error(label + ' was not committed: ' + JSON.stringify(result)); };
  // Applies one event to Payleaf and returns the notification that it wrote.
  s.event = async (kind, when, payload) => {
    const args = {expected_version: (await infra.call('env.snapshot')).version, event: {event_id: 'ev-mail-' + (++s.seq), at: when, operation: APP + kind, payload}};
    committed(kind, await infra.call('env.apply_event', args));
    const list = (await s.state()).data.notifications;
    return list[list.length - 1];
  };
  s.write = async (name, args) => committed(name, await s.agent.call(APP + name, {...args, expected_version: (await infra.call('env.snapshot')).version, request_id: 'mail-w' + (++s.seq)}));
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
  equal('dispatchId keeps the notification ID in the first lifecycle and adds the epoch in a later one', [dispatchId('ntf-0072', 2, 2), dispatchId('ntf-0072', 3, 2)], ['ntf-0072', 'ntf-0072.e3']);
  const capabilities = await s.router.call('router.capabilities'), tools = (await s.router.request('tools/list')).result.tools.map(tool => tool.name);
  equal('The real router process reads the publish declaration of the package, and its connection has no env.* operation', [capabilities.publisher, capabilities.channels, tools],
    ['payleaf', [{channel: 'channel.email', schema_id: 'urn:pale:email-message:2', event_type: 'org.pale.mail.notification.v1', payload_schema_id: 'urn:pale:email-payload:1'}],
      ['router.capabilities', 'router.publish']]);

  const first = await s.event(...posted());
  equal('An event writes one notification with its full wire message, addressed to the owner of the account',
    [first.event_id, first.object_id, first.email.id, first.email.data.content, first.email.data.recipient, first.email.data.source_object],
    ['ev-mail-1', 'ps-2026-24', first.id, {title: first.title, body: {format: 'text/plain', text: first.text}, asset_ids: []}, {kind: 'person_ref', id: MAILBOX.owner_person_id},
      {app_id: 'payleaf', account_id: 'payleaf-kai', object_type: 'pay_statement', object_id: 'ps-2026-24'}]);
  await s.mailClock(at('11-20 06:05'));
  const before = await s.state(), out = await s.sender.publishPending(), row = out.results[0];
  equal('sender.publishPending publishes it once under the notification ID, and the receipt is committed',
    [out.epoch, out.lifecycle, out.stopped, out.results.length, row.notification_id, row.request_id, row.status, row.code, row.duplicate],
    [before.epoch, 'first', false, 1, first.id, first.id, 'committed', null, false]);
  check('The sender wrote nothing to Payleaf: its state, version and audit are byte-identical', same(await s.state(), before));
  const got = await s.mail.call('mail.get', {id: row.event_id});
  if (got.status !== 'ok') throw new Error('mail.get did not find the delivered record: ' + JSON.stringify(got));
  equal('The Mail Agent reads the record with mail.get and the event_id of the receipt: in the inbox, unread, with the title and the text of the notification',
    [got.message.folder, got.message.read, got.message.subject, got.message.body, got.message.to, got.message.from],
    ['inbox', false, first.title, first.text, [MAILBOX.address], 'payleaf@pale.example']);
  const receipt = s.receipts().find(entry => entry.request_id === first.id).result;
  equal('The receipt ties the Mail record to the notification ID', [receipt.status, receipt.cloud_event.id, receipt.event_id, receipt.target, got.message.thread_id],
    ['committed', first.id, got.message.id, {app_id: 'mail', account_id: MAILBOX.account_id}, first.id]);
  equal('The times are kept apart: the wire time is the time of the event, and received_at is the virtual time of Mail',
    [first.email.time, receipt.cloud_event.time, got.message.received_at, receipt.applied_at], [at('11-20 06:00'), at('11-20 06:00'), at('11-20 06:05'), at('11-20 06:05')]);
  const inbox = await s.inbox(), history = s.seed.notifications;
  check('Seed history is not sent: the ' + history.length + ' notifications of the loaded seed have a wire message, and Mail holds only the new one',
    history.length > 0 && history.every(n => n.email !== null) && same(inbox.map(m => m.thread_id), [first.id]), inbox);
  return {first, row, firstEpoch: out.firstEpoch};
}

async function noticesOff(s, {first}) {
  await s.write('preferences.update', {email_notices: false});
  const quiet = await s.event(...opened());
  const listed = (await s.agent.call(APP + 'notifications.list', {})).items.find(item => item.id === quiet.id);
  const silent = await s.sender.publishPending();
  equal('With email_notices off the next event writes a notification with no wire message, and nothing is published',
    [quiet.email, listed.email_stored, silent.results, silent.stopped, (await s.inbox()).length], [null, false, [], false, 1]);
  await s.write('preferences.update', {email_notices: true});
  const third = await s.event(...moved());
  await s.mailClock(at('11-23 10:20'));
  const resumed = await s.sender.publishPending(), inbox = await s.inbox();
  equal('With email_notices on again the next notification is sent, and the one written while it was off is never sent',
    [resumed.results.map(r => [r.notification_id, r.status]), inbox.map(m => m.thread_id)], [[[third.id, 'committed']], [first.id, third.id]]);
  equal('The delivered notice of the moved pay date is the example message of the approved plan, field for field', third.email, PLAN_EXAMPLE);
  const record = inbox[inbox.length - 1];
  equal('Mail shows that notice with the title and the text of the plan example', [record.subject, record.body], [PLAN_EXAMPLE.data.content.title, PLAN_EXAMPLE.data.content.body.text]);
}

async function retries(s, {first, row}) {
  const inbox = await s.inbox();
  const retry = await s.router.call('router.publish', {request_id: first.id, message: first.email});
  equal('An identical retry returns the first receipt with duplicate true and the same event_id, and Mail still has one record of it',
    [retry.status, retry.duplicate, retry.event_id, await s.inbox()], ['committed', true, row.event_id, inbox]);
  const changed = structuredClone(first.email);
  changed.data.content.body.text += ' Changed.';
  const conflict = await s.router.call('router.publish', {request_id: first.id, message: changed});
  equal('The same request_id with changed text is rejected with idempotency_conflict, and Mail is unchanged',
    [conflict.status, conflict.code, await s.inbox()], ['rejected', 'idempotency_conflict', inbox]);
  const forged = {...first.email, id: first.id + '-forged', source: first.email.source + '-other'};
  const mismatch = await s.router.call('router.publish', {request_id: forged.id, message: forged});
  equal('A message that names another source account is rejected with source_identity_mismatch, and Mail is unchanged',
    [mismatch.status, mismatch.code, await s.inbox()], ['rejected', 'source_identity_mismatch', inbox]);
  equal('A second publishPending publishes nothing, because a delivery is final', (await s.sender.publishPending()).results, []);
}

// Payleaf is reset and Mail is not. The router and Mail still know the identities of the first lifecycle.
async function sourceReset(s, {first, row: firstRow}) {
  const old = await s.state(), mailEpoch = (await s.mailState()).epoch, inboxBefore = await s.inbox();
  const reset = await s.infra.call('env.reset', {expected_version: {epoch: old.epoch, revision: old.revision}}), fresh = await s.state();
  equal('env.reset on Payleaf only: its epoch advances and its notifications are the seed again, and Mail keeps its epoch and its messages',
    [reset.status, fresh.epoch, fresh.data.notifications, (await s.mailState()).epoch, await s.inbox()], ['ready', old.epoch + 1, s.seed.notifications, mailEpoch, inboxBefore]);
  const renewed = await s.event(...opened());
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
  const notice = await s.event(...moved()), identity = id => id + '.e' + state.epoch, written = await s.state();
  const blind = await createSender({infra: s.infra, router: s.router}).publishPending();
  equal('Control: a second sender object with no firstEpoch reuses the plain notification ID. The router refuses it with idempotency_conflict, the sender stops, and Mail gets nothing',
    [blind.firstEpoch, blind.lifecycle, blind.stopped, blind.results.map(r => [r.request_id, r.status, r.code]), await s.halted(), await s.inbox()],
    [state.epoch, 'first', true, [[renewed.id, 'rejected', 'idempotency_conflict']], false, inbox]);
  check('Control: the refused publish changed nothing in Payleaf', same(await s.state(), written));
  const out = await createSender({infra: s.infra, router: s.router, firstEpoch}).publishPending();
  equal('A second sender object created with firstEpoch publishes as <id>.e<epoch>: the notice that the first sender delivered is a duplicate, and the new notice is delivered',
    [out.firstEpoch, out.lifecycle, out.stopped, out.results.map(r => [r.notification_id, r.request_id, r.status, r.duplicate])],
    [firstEpoch, 'later', false, [[renewed.id, identity(renewed.id), 'committed', true], [notice.id, identity(notice.id), 'committed', false]]]);
  const now = await s.inbox();
  equal('Mail keeps its messages and has exactly one new one, with the title and the text of the new notice',
    [now.slice(0, inbox.length), now.slice(inbox.length).map(m => [m.thread_id, m.subject, m.body])], [inbox, [[identity(notice.id), notice.title, notice.text]]]);
}

// A second seed is loaded in the same run. It holds one more notification with a wire message than the first seed: a copy of an older notice.
// The ID of the copy has no number, so the App numbers the next notice as before. Then the first event of the run is applied again: the new notice has the ID and text of a delivered one.
async function newSeed(s, {first, row}) {
  const old = await s.state(), inbox = await s.inbox(), epoch = old.epoch + 1, older = s.seed.notifications[s.seed.notifications.length - 1];
  const kept = {...older, id: 'ntf-second-seed', event_id: 'ev-history-2', email: {...older.email, id: 'ntf-second-seed'}};
  const loaded = await s.infra.call('env.load_seed', {expected_version: {epoch: old.epoch, revision: old.revision}, request_id: 'second-seed',
    data: {...s.seed, notifications: [...s.seed.notifications, kept]}, virtual_now: START});
  const repeated = await s.event(...posted());
  const plain = await s.router.call('router.publish', {request_id: repeated.id, message: repeated.email});
  equal('Control: under the plain notification ID the router answers with the old receipt, marked duplicate, and the new notice does not reach Mail',
    [loaded.status, same(repeated.email, first.email), plain.duplicate, plain.event_id, await s.inbox()], ['ready', true, true, row.event_id, inbox]);
  const out = await s.sender.publishPending(), now = await s.inbox(), held = (await s.state()).initial_data.notifications;
  equal('A new seed in the same run is a later lifecycle too: publishPending delivers the notice as <id>.e<epoch>, and Mail has one more message',
    [out.lifecycle, out.results.map(r => [r.request_id, r.status, r.duplicate]), now.length], ['later', [[first.id + '.e' + epoch, 'committed', false]], inbox.length + 1]);
  check('The seed history is read from each snapshot: the notification that only the second seed holds has a wire message, and it is not sent under its ID or as <id>.e<epoch>',
    held.some(n => n.id === kept.id && n.email !== null) && !s.seed.notifications.some(n => n.id === kept.id) &&
    !out.results.some(r => r.notification_id === kept.id) && !now.some(m => m.thread_id.startsWith(kept.id)), now.map(m => m.thread_id));
}

// A run with Payleaf alone: no Mail App in the registry, no Mail account in the binding and no router.
async function withoutMail(env) {
  const run = 'payleaf-alone', binding = read('examples/task-data/binding.json'), mine = [];
  binding.accounts = binding.accounts.filter(account => account.app_id !== 'mail');
  const open = async role => {
    const client = new env.Client('payleaf', role, run, env.state, 'payleaf-mail-integration', {registry: env.prepared.registry});
    env.clients.push(client); mine.push(client);
    await client.initialize();
    return client;
  };
  const infra = await open('infra'), agent = await open('agent');
  const version = async () => (await infra.call('env.snapshot')).version;
  const loaded = await infra.call('env.load_seed', {expected_version: await version(), request_id: 'task-seed', data: read('examples/task-data/seed.json'), binding, policies: policies(), virtual_now: START});
  const apps = JSON.parse(fs.readFileSync(env.prepared.registry, 'utf8')).apps.map(app => app.app_id);
  equal('Without Mail: the registry of the run holds Payleaf only, the binding has no Mail account, and the package requires no other App',
    [loaded.status, apps, binding.accounts.map(a => a.app_id), read('app.json').dependencies, read('contribution/contribution.json').dependencies.required_apps],
    ['ready', ['payleaf'], ['payleaf'], [], []]);
  const results = [];
  for (const [kind, when, payload] of [posted(), opened()]) {
    results.push((await infra.call('env.apply_event', {expected_version: await version(), event: {event_id: 'ev-alone-' + results.length, at: when, operation: APP + kind, payload}})).status);
  }
  const listed = (await agent.call(APP + 'notifications.list', {start: '2026-11-20', end: '2026-11-30'})).items;
  equal('Without Mail: both events commit, and each writes one notification with its wire message stored, which the Agent reads',
    [results, listed.map(n => [n.kind, n.email_stored])], [['committed', 'committed'], [['payroll.run_posted', true], ['enrollment.opened', true]]]);
  const write = await agent.call(APP + 'retirement.set', {id: 'payleaf-kai', percent: 6, expected_version: await version(), request_id: 'alone-w1'});
  equal('Without Mail: an Agent write commits as usual', [write.status, write.state], ['committed', 'waiting']);
  await Promise.allSettled(mine.map(client => client.close()));
}

// A run where the router finds no route to a mailbox. The refusal is final for each notification, and Mail gets nothing.
async function noRoute(env, label, run, code, options) {
  const s = await stage(env, run, options);
  const one = await s.event(...posted()), two = await s.event(...opened());
  const before = await s.state(), out = await s.sender.publishPending();
  const refused = id => ({notification_id: id, request_id: id, status: 'rejected', code, event_id: null, duplicate: false});
  equal(label + ': the router rejects each delivery before dispatch with ' + code + ', and the sender goes on to the next notification',
    [out.stopped, out.results], [false, [refused(one.id), refused(two.id)]]);
  const last = s.seed.notifications[s.seed.notifications.length - 1].id;
  equal(label + ': Mail has no record, the run is not halted, and both notifications are still in Payleaf, which the sender did not change',
    [(await s.inbox()).length, await s.halted(), same(await s.state(), before), before.data.notifications.slice(-3).map(n => n.id)], [0, false, true, [last, one.id, two.id]]);
  await s.close();
}
const noGrant = env => noRoute(env, 'No grant', 'payleaf-no-grant', 'recipient_not_authorized', {grant: false});
// The only Mail account of this run belongs to the manager. So no mailbox is bound to the owner of the Payleaf account.
const noMailbox = env => noRoute(env, 'No mailbox for the owner', 'payleaf-no-mailbox', 'recipient_unavailable',
  {mailbox: {account_id: 'mail-okoro', owner_person_id: 'person-okoro', address: 'adaeze.okoro@example.com'}});

// What every halting case shows after the publish: the source commit, the state of Mail, and the halted run.
async function afterHalt(s, label, {notification, before, mailBefore, held, next = opened}) {
  check(label + ': Payleaf keeps its commit. The notification is still in env.snapshot, and nothing was written back to Payleaf: the state is byte-identical',
    same(await s.state(), before) && before.data.notifications.some(n => n.id === notification.id && n.email !== null));
  const found = await s.mail.call('mail.search', {query: notification.title}), count = mailBefore.data.messages.length;
  equal(label + ': what Mail holds at that moment, read by the Mail Agent: ' + held + ', and no record of the notification. Its version is the same',
    [found.status, found.messages.length, (await s.inbox()).length, (await s.mailState()).revision], ['ok', 0, count, mailBefore.revision]);
  await s.event(...next());
  const out = await s.sender.publishPending();
  equal(label + ': the next publish in that run returns halted with run_halted, and the sender publishes nothing more',
    [out.stopped, out.results.map(r => [r.notification_id, r.status, r.code]), await s.halted(), (await s.inbox()).length], [true, [[notification.id, 'halted', 'run_halted']], true, count]);
}

// Mail holds at most 1000 messages (its seed schema). A full mailbox makes Mail refuse the delivery event in a repeatable way.
async function receiverRefusal(env) {
  const s = await stage(env, 'payleaf-refusal', {messages: Array.from({length: 1000}, (_, i) => oldMail(i + 1))});
  const notification = await s.event(...posted()), before = await s.state(), mailBefore = await s.mailState();
  const out = await s.sender.publishPending(), row = out.results[0], logged = s.receipts().pop().result;
  equal('Receiver refusal: Mail refuses the delivery into a full mailbox. The result is rejected with receiver_rejected and stop_run true, and the sender stops',
    [out.stopped, out.results.length, row.status, row.code, row.event_id, logged.stop_run, logged.reason], [true, 1, 'rejected', 'receiver_rejected', logged.event_id, true, 'invalid_event']);
  equal('Receiver refusal: mail.get with the attempted event_id finds nothing', (await s.mail.call('mail.get', {id: row.event_id})).status, 'not_found');
  await afterHalt(s, 'Receiver refusal', {notification, before, mailBefore, held: 'its 1000 old messages'});
  await s.close();
}

// The router binds Mail at its start. A reset of Mail in the run changes that lifecycle, so the router halts.
async function receiverReset(env) {
  const s = await stage(env, 'payleaf-mail-reset');
  await s.event(...posted());
  const delivered = await s.sender.publishPending();
  await s.resetMail();
  const notification = await s.event(...opened()), before = await s.state(), mailBefore = await s.mailState();
  const out = await s.sender.publishPending(), row = out.results[0], logged = s.receipts().pop().result;
  equal('Receiver reset: after env.reset on Mail the router refuses the next delivery. The result is rejected with receiver_lifecycle_changed and stop_run true, and the sender stops',
    [delivered.results.map(r => r.status), out.stopped, out.results.length, row.notification_id, row.status, row.code, logged.stop_run],
    [['committed'], true, 1, notification.id, 'rejected', 'receiver_lifecycle_changed', true]);
  await afterHalt(s, 'Receiver reset', {notification, before, mailBefore, held: 'the empty mailbox of its seed', next: moved});
  await s.close();
}

// Core's lock for one App is the directory <state>/<run>/<app>.lock. While it exists, Mail cannot answer the router.
// This shows a receiver that does not answer. It does not reproduce a commit whose acknowledgement is lost.
async function unknownAnswer(env) {
  const s = await stage(env, 'payleaf-unknown');
  const notification = await s.event(...posted()), before = await s.state(), mailBefore = await s.mailState();
  const lock = path.join(env.state, s.run, 'mail.lock');
  let out;
  fs.mkdirSync(lock);
  try { out = await s.sender.publishPending(); } finally { fs.rmdirSync(lock); }
  const row = out.results[0], logged = s.receipts().pop().result;
  equal('Unknown answer: Mail does not answer the router while its state lock is held. The result is unknown with receiver_unconfirmed and stop_run true, and the sender stops',
    [out.stopped, out.results.length, row.status, row.code, row.event_id, logged.stop_run], [true, 1, 'unknown', 'receiver_unconfirmed', null, true],
    'This shows a receiver that does not answer: the router got no answer to its first call, so no delivery event was sent and the result has no event_id. ' +
    'It does not reproduce a commit in Mail whose acknowledgement is lost.');
  await afterHalt(s, 'Unknown answer', {notification, before, mailBefore, held: 'an empty mailbox (read after the lock is removed, when Mail answers again)'});
  await s.close();
}

async function main() {
  const opts = options(process.argv.slice(2)), root = opts.runtime || process.env.PALE_RUNTIME_ROOT;
  const skip = reason => { console.log('SKIP: ' + reason); process.exitCode = SKIPPED; };
  if (!root) return skip('the Mail flow needs the public runtime. Give --runtime DIR or set PALE_RUNTIME_ROOT.');
  const runtime = path.resolve(root), repo = path.dirname(runtime), mailRegistry = path.join(repo, 'examples/registry.mail.json'), publisher = path.join(repo, 'apps/payleaf');
  if (!fs.existsSync(path.join(runtime, 'prepare.cjs')) || !fs.existsSync(path.join(runtime, 'messaging/service.cjs'))) return skip('no public runtime at ' + runtime + '.');
  // The router reads Mail and the publisher package from the checkout that holds the runtime.
  if (!fs.existsSync(mailRegistry) || !fs.existsSync(publisher) || fs.realpathSync(publisher) !== fs.realpathSync(DIR)) {
    return skip('the Mail flow needs the runtime of the public checkout that holds this package as apps/payleaf, with examples/apps/mail.');
  }
  const prepared = require(path.join(runtime, 'prepare.cjs')).prepare(DIR), clients = [];
  const env = {runtime, prepared, clients, mailRegistry, state: path.join(prepared.root, 'state'), Client: require(path.join(runtime, 'client.cjs')).Client};
  const report = {schema: 'payleaf.mail-integration.v1', runtime_version: require(path.join(runtime, 'package.json')).version, app_version: read('app.json').version,
    mail_version: require(path.join(repo, 'examples/apps/mail/app.json')).version, node: process.version, checks, passed: false};
  try {
    fs.mkdirSync(env.state, {recursive: true});
    const wire = 'schemas/router-message.schema.json';
    check(wire + ' is a byte copy of the wire schema of Mail ' + report.mail_version, fs.readFileSync(path.join(DIR, wire)).equals(fs.readFileSync(path.join(repo, 'examples/apps/mail', wire))));
    const s = await stage(env, 'payleaf-mail'), delivered = await delivery(s);
    for (const part of [noticesOff, retries, sourceReset, secondSender, newSeed]) await part(s, delivered);
    await s.close();
    for (const scene of [withoutMail, noGrant, noMailbox, receiverRefusal, receiverReset, unknownAnswer]) await scene(env);
    report.passed = true;
    console.log('PASS: ' + checks.length + ' of ' + checks.length + ' Payleaf to Mail real MCP checks passed.');
  } catch (error) {
    report.error = error.message;
    console.error('FAIL: ' + error.message);
    console.log('FAIL: ' + checks.filter(c => c.status === 'passed').length + ' of ' + checks.length + ' Payleaf to Mail real MCP checks passed.');
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
