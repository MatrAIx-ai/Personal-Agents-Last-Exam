#!/usr/bin/env node
'use strict';
// One Alderbrook to Mail flow with the real router process, the real Mail package and the Mail Agent tools.
// Usage: node tests/mail.integration.cjs --runtime DIR [--report FILE]. PALE_RUNTIME_ROOT can replace --runtime.
const fs = require('node:fs'), path = require('node:path'), util = require('node:util');
const {createSender, dispatchId} = require('../infra/sender.cjs');
const notices = require('../src/notices.cjs');

const DIR = path.resolve(__dirname, '..'), APP = 'alderbrook.';
// Exit code 77 says that the script was skipped: it printed SKIP and ran no check.
const SKIPPED = 77;
const MAILBOX = {account_id: 'mail-jordan', owner_person_id: 'person-jordan', address: 'jordan.ellis@example.com'};
const SHOP = 'Corner Auto Body', ADJUSTER = 'Adjuster R. Imani';
const at = text => '2026-12-' + text.slice(0, 2) + 'T' + text.slice(3) + ':00-05:00';
const START = at('02 09:00');
const read = file => JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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

// The task seed with one older notification. It has a stored wire message, so only the seed rule keeps it from Mail.
function seedWithHistory() {
  const seed = read('examples/task-data/seed.json'), claim = seed.claims.find(k => k.state === 'open' && k.path === 'repair');
  const number = Math.max(0, ...seed.notifications.map(n => Number(n.id.slice(4)) || 0)) + 1;
  const history = {id: 'ntf-' + String(number).padStart(4, '0'), at: at('01 11:00'), kind: 'request.issued', claim_id: claim.id, event_id: 'ev-history-1',
    title: 'Alderbrook Mutual asks for information on claim ' + claim.id, text: 'This notification was in the loaded seed.', email: null};
  history.email = notices.wire(seed, history, history.at);
  seed.notifications.push(history);
  return {seed, claim: claim.id, history};
}
const oldMail = n => ({id: 'old-' + n, thread_id: 'old-' + n, account_id: MAILBOX.account_id, from: 'news@example.com', to: [MAILBOX.address],
  subject: 'Old message ' + n, body: 'An old message that fills the mailbox.', received_at: '2026-11-01T08:00:00-05:00', folder: 'archive', read: true, attachments: []});
const supplement = claim => ['estimate.submitted', at('04 10:00'), {estimate_id: 'est-9101', claim_id: claim, kind: 'supplement', source: 'shop', shop_name: SHOP,
  lines: [{line_id: 'ln-91', text: 'Rear body panel, repair', amount: 1100}, {line_id: 'ln-92', text: 'Trunk floor, straighten', amount: 400}]}];
const decision = claim => ['determination.issued', at('04 15:30'), {determination_id: 'det-9101', claim_id: claim, issued_by: ADJUSTER,
  lines: [{line_id: 'ln-91', status: 'approved', amount: 1100}, {line_id: 'ln-92', status: 'approved', amount: 400}]}];
const payment = claim => ['payment.issued', at('07 12:00'), {payment_id: 'pay-9101', claim_id: claim, kind: 'repair', amount: 500}];

// One run with its own router. Mail and Alderbrook are loaded first, because the router binds its receivers when it starts.
// `mailbox` is the Mail account of the run. The binding of the run names it with its owner.
async function stage(env, run, {grant = true, messages = [], mailbox = MAILBOX} = {}) {
  const {seed, claim, history} = seedWithHistory(), binding = read('fixtures/binding.json'), mine = [];
  binding.accounts = binding.accounts.map(account => account.app_id === 'mail' ? {app_id: 'mail', account_id: mailbox.account_id, owner_person_id: mailbox.owner_person_id} : account);
  const open = async (app, role) => {
    const client = new env.Client(app, role, run, env.state, 'alderbrook-mail-integration', {registry: app === 'mail' ? env.mailRegistry : env.prepared.registry});
    env.clients.push(client); mine.push(client);
    await client.initialize();
    return client;
  };
  const load = async (client, args) => {
    const result = await client.call('env.load_seed', {expected_version: (await client.call('env.snapshot')).version, request_id: 'task-seed', binding, virtual_now: START, ...args});
    if (result.status !== 'ready') throw new Error('A seed did not load in run ' + run + ': ' + JSON.stringify(result));
  };
  const mailInfra = await open('mail', 'infra'), infra = await open('alderbrook', 'infra');
  await load(mailInfra, {data: {...mailbox, messages}});
  await load(infra, {data: seed, policies: {...read('fixtures/policies.json'), scenario: {allow: read('tools.json').map(tool => tool.name), constraints: {}}}});
  const config = read('infra/router.config.example.json'), file = path.join(env.state, 'router.' + run + '.json');
  if (!grant) config.publishers[0].allowed_recipients = [];
  fs.writeFileSync(file, JSON.stringify(config));
  const router = new env.Client(null, null, null, null, 'alderbrook-sender', {commandArgs: [path.join(env.runtime, 'messaging/service.cjs'),
    '--config', file, '--publisher', 'alderbrook', '--run', run, '--state-dir', env.state]});
  env.clients.push(router); mine.push(router);
  await router.initialize();
  const s = {run, seed, claim, history, infra, router, mail: await open('mail', 'agent'), agent: await open('alderbrook', 'agent'), sender: createSender({infra, router}), seq: 0};
  s.state = async () => (await infra.call('env.snapshot')).snapshot;
  s.mailState = async () => (await mailInfra.call('env.snapshot')).snapshot;
  s.inbox = async () => (await s.mail.call('mail.search', {})).messages;
  s.halted = async () => (await router.call('router.capabilities')).halted;
  // The router keeps one metadata row for each publish attempt. It holds the full receipt, with stop_run.
  s.receipts = () => fs.readFileSync(path.join(env.state, run, 'messaging.receipts.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const committed = (label, result) => { if (result.status !== 'committed') throw new Error(label + ' was not committed: ' + JSON.stringify(result)); };
  // Applies one event to Alderbrook and returns the notification that it wrote.
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
  equal('dispatchId keeps the notification ID in the first lifecycle and adds the epoch in a later one', [dispatchId('ntf-0002', 2, 2), dispatchId('ntf-0002', 3, 2)], ['ntf-0002', 'ntf-0002.e3']);
  const capabilities = await s.router.call('router.capabilities'), tools = (await s.router.request('tools/list')).result.tools.map(tool => tool.name);
  equal('The real router process reads the publish declaration of the package, and its connection has no env.* operation', [capabilities.publisher, capabilities.channels, tools],
    ['alderbrook', [{channel: 'channel.email', schema_id: 'urn:pale:email-message:2', event_type: 'org.pale.mail.notification.v1', payload_schema_id: 'urn:pale:email-payload:1'}],
      ['router.capabilities', 'router.publish']]);

  const first = await s.event(...supplement(s.claim));
  equal('An event on a claim writes one notification with its full wire message',
    [first.event_id, first.claim_id, first.email.id, first.email.data.content, first.email.data.recipient],
    ['ev-mail-1', s.claim, first.id, {title: first.title, body: {format: 'text/plain', text: first.text}, asset_ids: []}, {kind: 'person_ref', id: MAILBOX.owner_person_id}]);
  await s.mailClock(at('04 10:05'));
  const before = await s.state(), out = await s.sender.publishPending(), row = out.results[0];
  equal('sender.publishPending publishes it once under the notification ID, and the receipt is committed',
    [out.epoch, out.lifecycle, out.stopped, out.results.length, row.notification_id, row.request_id, row.status, row.code, row.duplicate],
    [before.epoch, 'first', false, 1, first.id, first.id, 'committed', null, false]);
  check('The sender wrote nothing to Alderbrook: its state, version and audit are byte-identical', same(await s.state(), before));
  const got = await s.mail.call('mail.get', {id: row.event_id});
  if (got.status !== 'ok') throw new Error('mail.get did not find the delivered record: ' + JSON.stringify(got));
  equal('The Mail Agent reads the record with mail.get and the event_id of the receipt: in the inbox, unread, with the title and the text of the notification',
    [got.message.folder, got.message.read, got.message.subject, got.message.body, got.message.to, got.message.from],
    ['inbox', false, first.title, first.text, [MAILBOX.address], 'alderbrook@pale.example']);
  const receipt = s.receipts().find(entry => entry.request_id === first.id).result;
  equal('The receipt ties the Mail record to the notification ID', [receipt.status, receipt.cloud_event.id, receipt.event_id, receipt.target, got.message.thread_id],
    ['committed', first.id, got.message.id, {app_id: 'mail', account_id: MAILBOX.account_id}, first.id]);
  equal('The times are kept apart: the wire time is the time of the event, and received_at is the virtual time of Mail',
    [first.email.time, receipt.cloud_event.time, got.message.received_at, receipt.applied_at], [at('04 10:00'), at('04 10:00'), at('04 10:05'), at('04 10:05')]);
  const inbox = await s.inbox();
  check('Seed history is not sent: the notification of the loaded seed has a wire message, and Mail holds only the new one',
    before.data.notifications.some(n => n.id === s.history.id && n.email !== null) && same(inbox.map(m => m.thread_id), [first.id]), inbox);
  return {first, row, firstEpoch: out.firstEpoch};
}

async function noticesOff(s, {first}) {
  await s.write('preferences.update', {email_notices: false});
  const quiet = await s.event(...decision(s.claim));
  const listed = (await s.agent.call(APP + 'notifications.list', {})).items.find(item => item.id === quiet.id);
  const silent = await s.sender.publishPending();
  equal('With email_notices off the next event writes a notification with no wire message, and nothing is published',
    [quiet.email, listed.emailed, silent.results, silent.stopped, (await s.inbox()).length], [null, false, [], false, 1]);
  await s.write('preferences.update', {email_notices: true});
  const third = await s.event(...payment(s.claim));
  await s.mailClock(at('07 12:05'));
  const resumed = await s.sender.publishPending();
  equal('With email_notices on again the next notification is sent, and the one written while it was off is never sent',
    [resumed.results.map(r => [r.notification_id, r.status]), (await s.inbox()).map(m => m.thread_id)], [[[third.id, 'committed']], [first.id, third.id]]);
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

// Alderbrook is reset and Mail is not. The router and Mail still know the identities of the first lifecycle.
async function sourceReset(s, {first, row: firstRow}) {
  const old = await s.state(), mailEpoch = (await s.mailState()).epoch, inboxBefore = await s.inbox();
  const reset = await s.infra.call('env.reset', {expected_version: {epoch: old.epoch, revision: old.revision}}), fresh = await s.state();
  equal('env.reset on Alderbrook only: its epoch advances and its notifications are the seed again, and Mail keeps its epoch and its messages',
    [reset.status, fresh.epoch, fresh.data.notifications, (await s.mailState()).epoch, await s.inbox()], ['ready', old.epoch + 1, s.seed.notifications, mailEpoch, inboxBefore]);
  const renewed = await s.event('request.issued', at('03 11:00'), {info_request_id: 'req-9101', claim_id: s.claim, issued_by: ADJUSTER,
    asks: [{key: 'photos', text: 'Photos of the damage from four sides.'}]});
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
  check('The seeded history is still not sent', !inbox.some(m => m.thread_id === s.history.id || m.thread_id === s.history.id + '.e' + fresh.epoch), inbox.map(m => m.thread_id));
  const again = await s.sender.publishPending(), retry = await s.router.call('router.publish', {request_id: identity, message: {...renewed.email, id: identity}});
  equal('A second publishPending and a direct identical router.publish add no record',
    [again.results, retry.status, retry.duplicate, retry.event_id, (await s.inbox()).length], [[], 'committed', true, row.event_id, inbox.length]);
}

// Infra keeps one sender for the run. A second sender object, made after a reset, needs the first epoch of the run.
async function secondSender(s, {firstEpoch}) {
  const state = await s.state(), inbox = await s.inbox(), renewed = state.data.notifications[state.data.notifications.length - 1];
  const notice = await s.event(...payment(s.claim)), identity = id => id + '.e' + state.epoch, written = await s.state();
  const blind = await createSender({infra: s.infra, router: s.router}).publishPending();
  equal('Control: a second sender object with no firstEpoch reuses the plain notification ID. The router refuses it with idempotency_conflict, the sender stops, and Mail gets nothing',
    [blind.firstEpoch, blind.lifecycle, blind.stopped, blind.results.map(r => [r.request_id, r.status, r.code]), await s.halted(), await s.inbox()],
    [state.epoch, 'first', true, [[renewed.id, 'rejected', 'idempotency_conflict']], false, inbox]);
  check('Control: the refused publish changed nothing in Alderbrook', same(await s.state(), written));
  const out = await createSender({infra: s.infra, router: s.router, firstEpoch}).publishPending();
  equal('A second sender object created with firstEpoch publishes as <id>.e<epoch>: the notice that the first sender delivered is a duplicate, and the new notice is delivered',
    [out.firstEpoch, out.lifecycle, out.stopped, out.results.map(r => [r.notification_id, r.request_id, r.status, r.duplicate])],
    [firstEpoch, 'later', false, [[renewed.id, identity(renewed.id), 'committed', true], [notice.id, identity(notice.id), 'committed', false]]]);
  const now = await s.inbox();
  equal('Mail keeps its messages and has exactly one new one, with the title and the text of the new notice',
    [now.slice(0, inbox.length), now.slice(inbox.length).map(m => [m.thread_id, m.subject, m.body])], [inbox, [[identity(notice.id), notice.title, notice.text]]]);
}

// A second seed is loaded in the same run. It holds one more notification with a wire message than the first seed: a copy of the first delivered notice.
// The ID of the copy has no number, so the App numbers the next notice as before. Then the first event of the run is applied again: the new notice has the ID and the text of a delivered one.
async function newSeed(s, {first, row}) {
  const old = await s.state(), inbox = await s.inbox(), epoch = old.epoch + 1, kept = {...first, id: 'ntf-second-seed', email: {...first.email, id: 'ntf-second-seed'}};
  const loaded = await s.infra.call('env.load_seed', {expected_version: {epoch: old.epoch, revision: old.revision}, request_id: 'second-seed',
    data: {...s.seed, notifications: [...s.seed.notifications, kept]}, virtual_now: START});
  const repeated = await s.event(...supplement(s.claim));
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

// A run where the router finds no route to a mailbox. The refusal is final for each notification, and Mail gets nothing.
async function noRoute(env, label, run, code, options) {
  const s = await stage(env, run, options);
  const one = await s.event(...supplement(s.claim)), two = await s.event(...decision(s.claim));
  const before = await s.state(), out = await s.sender.publishPending();
  const refused = id => ({notification_id: id, request_id: id, status: 'rejected', code, event_id: null, duplicate: false});
  equal(label + ': the router rejects each delivery before dispatch with ' + code + ', and the sender goes on to the next notification',
    [out.stopped, out.results], [false, [refused(one.id), refused(two.id)]]);
  equal(label + ': Mail has no record, the run is not halted, and both notifications are still in Alderbrook, which the sender did not change',
    [(await s.inbox()).length, await s.halted(), same(await s.state(), before), before.data.notifications.slice(-3).map(n => n.id)], [0, false, true, [s.history.id, one.id, two.id]]);
  await s.close();
}
const noGrant = env => noRoute(env, 'No grant', 'alderbrook-no-grant', 'recipient_not_authorized', {grant: false});
// The only Mail account of this run belongs to another person. So no mailbox is bound to the owner of the Alderbrook account.
const noMailbox = env => noRoute(env, 'No mailbox for the owner', 'alderbrook-no-mailbox', 'recipient_unavailable',
  {mailbox: {account_id: 'mail-priya', owner_person_id: 'person-priya', address: 'priya.ellis@example.com'}});

// What every halting case shows after the publish: the source commit, the state of Mail, and the halted run.
async function afterHalt(s, label, {notification, before, mailBefore, held, next = decision}) {
  check(label + ': Alderbrook keeps its commit. The notification is still in env.snapshot and the state is byte-identical',
    same(await s.state(), before) && before.data.notifications.some(n => n.id === notification.id && n.email !== null));
  const found = await s.mail.call('mail.search', {query: notification.title}), count = mailBefore.data.messages.length;
  equal(label + ': what Mail holds at that moment, read by the Mail Agent: ' + held + ', and no record of the notification. Its version is the same',
    [found.status, found.messages.length, (await s.inbox()).length, (await s.mailState()).revision], ['ok', 0, count, mailBefore.revision]);
  await s.event(...next(s.claim));
  const out = await s.sender.publishPending();
  equal(label + ': the next publish in that run returns halted with run_halted, and the sender publishes nothing more',
    [out.stopped, out.results.map(r => [r.notification_id, r.status, r.code]), await s.halted(), (await s.inbox()).length], [true, [[notification.id, 'halted', 'run_halted']], true, count]);
}

// Mail holds at most 1000 messages (its seed schema). A full mailbox makes Mail refuse the delivery event in a repeatable way.
async function receiverRefusal(env) {
  const s = await stage(env, 'alderbrook-refusal', {messages: Array.from({length: 1000}, (_, i) => oldMail(i + 1))});
  const notification = await s.event(...supplement(s.claim)), before = await s.state(), mailBefore = await s.mailState();
  const out = await s.sender.publishPending(), row = out.results[0], logged = s.receipts().pop().result;
  equal('Receiver refusal: Mail refuses the delivery into a full mailbox. The result is rejected with receiver_rejected and stop_run true, and the sender stops',
    [out.stopped, out.results.length, row.status, row.code, row.event_id, logged.stop_run, logged.reason], [true, 1, 'rejected', 'receiver_rejected', logged.event_id, true, 'invalid_event']);
  equal('Receiver refusal: mail.get with the attempted event_id finds nothing', (await s.mail.call('mail.get', {id: row.event_id})).status, 'not_found');
  await afterHalt(s, 'Receiver refusal', {notification, before, mailBefore, held: 'its 1000 old messages'});
  await s.close();
}

// The router binds Mail at its start. A reset of Mail in the run changes that lifecycle, so the router halts.
async function receiverReset(env) {
  const s = await stage(env, 'alderbrook-mail-reset');
  await s.event(...supplement(s.claim));
  const delivered = await s.sender.publishPending();
  await s.resetMail();
  const notification = await s.event(...decision(s.claim)), before = await s.state(), mailBefore = await s.mailState();
  const out = await s.sender.publishPending(), row = out.results[0], logged = s.receipts().pop().result;
  equal('Receiver reset: after env.reset on Mail the router refuses the next delivery. The result is rejected with receiver_lifecycle_changed and stop_run true, and the sender stops',
    [delivered.results.map(r => r.status), out.stopped, out.results.length, row.notification_id, row.status, row.code, logged.stop_run],
    [['committed'], true, 1, notification.id, 'rejected', 'receiver_lifecycle_changed', true]);
  await afterHalt(s, 'Receiver reset', {notification, before, mailBefore, held: 'the empty mailbox of its seed', next: payment});
  await s.close();
}

// Core's lock for one App is the directory <state>/<run>/<app>.lock. While it exists, Mail cannot answer the router.
// This shows a receiver that does not answer. It does not reproduce a commit whose acknowledgement is lost.
async function unknownAnswer(env) {
  const s = await stage(env, 'alderbrook-unknown');
  const notification = await s.event(...supplement(s.claim)), before = await s.state(), mailBefore = await s.mailState();
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
  const runtime = path.resolve(root), repo = path.dirname(runtime), mailRegistry = path.join(repo, 'examples/registry.mail.json'), publisher = path.join(repo, 'apps/alderbrook');
  // The router reads Mail and the publisher package from the checkout that holds the runtime.
  if (!fs.existsSync(mailRegistry) || !fs.existsSync(publisher) || fs.realpathSync(publisher) !== fs.realpathSync(DIR)) {
    return skip('the Mail flow needs the runtime of the public checkout that holds this package as apps/alderbrook, with examples/apps/mail.');
  }
  const prepared = require(path.join(runtime, 'prepare.cjs')).prepare(DIR), clients = [];
  const env = {runtime, prepared, clients, mailRegistry, state: path.join(prepared.root, 'state'), Client: require(path.join(runtime, 'client.cjs')).Client};
  const report = {schema: 'alderbrook.mail-integration.v1', runtime_version: require(path.join(runtime, 'package.json')).version, app_version: read('app.json').version,
    mail_version: require(path.join(repo, 'examples/apps/mail/app.json')).version, node: process.version, checks, passed: false};
  try {
    fs.mkdirSync(env.state, {recursive: true});
    const wire = 'schemas/router-message.schema.json';
    check(wire + ' is a byte copy of the wire schema of Mail ' + report.mail_version, fs.readFileSync(path.join(DIR, wire)).equals(fs.readFileSync(path.join(repo, 'examples/apps/mail', wire))));
    const s = await stage(env, 'alderbrook-mail'), delivered = await delivery(s);
    for (const part of [noticesOff, retries, sourceReset, secondSender, newSeed]) await part(s, delivered);
    await s.close();
    for (const scene of [noGrant, noMailbox, receiverRefusal, receiverReset, unknownAnswer]) await scene(env);
    report.passed = true;
    console.log('PASS: ' + checks.length + ' Alderbrook to Mail real MCP checks.');
  } catch (error) {
    report.error = error.message;
    console.error('FAIL: ' + error.message);
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
