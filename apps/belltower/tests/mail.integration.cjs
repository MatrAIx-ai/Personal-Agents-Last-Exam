#!/usr/bin/env node
'use strict';
// Belltower -> Mail through Messaging on the public reference runtime, with the real Mail
// package as the receiver. It checks the receiver's own record and receipt; a notification
// that is held until Infra moves the clock past its release time (no App event); that a
// superseded notification never reaches Mail; the delayed-dispatch case of the plan (one
// record, the correction, when the sender first runs after the correction; two records in
// order when it also ran before it); an identical retry, changed content, a forged source,
// a delivery without a grant; and that dispatch never changes Belltower's state.
//
//   node tests/mail.integration.cjs --runtime DIR [--report FILE]
//
// DIR is the `runtime` directory of a public PALE checkout, 1.6.0 or later;
// PALE_RUNTIME_ROOT=DIR works too. The public Messaging router resolves a publisher package
// and its receiver registry relative to its own checkout, so this flow needs the package
// inside that checkout (for example at apps/belltower) and the pinned Mail package there
// (examples/apps/mail with examples/registry.mail.json).
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const appDir = path.resolve(__dirname, '..');
const { publishReleased, plan } = require('../infra/sender.cjs');

function fail(message) { console.error(message + '\nUsage: node tests/mail.integration.cjs --runtime DIR [--report FILE]'); process.exit(2); }
const opts = { runtime: process.env.PALE_RUNTIME_ROOT };
for (let i = 2; i < process.argv.length; i += 2) {
  if (!['--runtime', '--report'].includes(process.argv[i]) || !process.argv[i + 1]) fail('Unknown or incomplete option: ' + process.argv[i]);
  opts[process.argv[i].slice(2)] = process.argv[i + 1];
}
const given = opts.runtime;
if (!given) fail('The runtime directory of a public PALE checkout is required.');
const runtime = path.resolve(given), checkout = path.dirname(runtime);
let runtimeVersion;
try { const pkg = JSON.parse(fs.readFileSync(path.join(runtime, 'package.json'), 'utf8')); if (pkg.name !== '@pale/app-runtime') throw Error(); runtimeVersion = pkg.version; } catch { fail('Not a PALE runtime directory: ' + runtime); }
const MAIL_REGISTRY = 'examples/registry.mail.json';
if (!fs.existsSync(path.join(checkout, MAIL_REGISTRY))) fail('The pinned Mail package was not found in that checkout (' + MAIL_REGISTRY + ').');
// Compare real paths: the package may be reached through a symlink.
const packageRoot = path.relative(fs.realpathSync(checkout), fs.realpathSync(appDir)).split(path.sep).join('/');
if (!packageRoot || packageRoot.startsWith('..') || path.isAbsolute(packageRoot)) fail('The Mail flow needs this package inside that checkout, because Messaging resolves a publisher package relative to its own checkout.');
const { prepare } = require(path.join(runtime, 'prepare.cjs')), { Client } = require(path.join(runtime, 'client.cjs'));

const at = (date, hhmm) => date + 'T' + hhmm + (hhmm.length === 5 ? ':00' : '') + '-06:00';
const TUE = '2026-11-17', WED = '2026-11-18';
const LIBRARY = 'it-city-0207';

async function main() {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-belltower-mail-')), prepared = prepare(appDir), clients = [], checks = [], started = Date.now();
  const check = (name, ok) => { assert.ok(ok, name); checks.push(name); };
  const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push(name); };
  const open = async client => { clients.push(client); await client.initialize(); return client; };
  // The Infra messaging config of the run: this package publishes, the bound Mail account is granted.
  const example = JSON.parse(fs.readFileSync(path.join(appDir, 'infra/router.config.example.json'), 'utf8'));
  const writeConfig = (name, grants) => {
    const config = structuredClone(example);
    config.registry = MAIL_REGISTRY; config.publishers[0].package_root = packageRoot;
    if (grants !== undefined) config.publishers[0].allowed_recipients = grants;
    const file = path.join(state, name); fs.writeFileSync(file, JSON.stringify(config)); return file;
  };
  const belltower = (role, run) => open(new Client('belltower', role, run, state, 'belltower-mail-test', { registry: prepared.registry }));
  const router = (run, config) => open(new Client(null, null, null, null, 'belltower-mail-test', { commandArgs: [path.join(runtime, 'messaging/service.cjs'), '--config', config, '--publisher', 'belltower', '--run', run, '--state-dir', state] }));
  const mailClient = (role, run) => open(new Client('mail', role, run, state, 'mail-' + role, { registry: path.join(checkout, MAIL_REGISTRY) }));
  const versionOf = s => ({ epoch: s.epoch, revision: s.revision });
  // The run's binding is shared: the account holder is one person with a Belltower account and
  // a Mail account. The pinned Mail package ships its own example account, so Infra loads the
  // person's (empty) mailbox into the run's Mail instance with that binding, as a task would,
  // before Messaging starts and binds its receivers.
  const binding = JSON.parse(fs.readFileSync(path.join(appDir, 'fixtures/binding.json'), 'utf8')), clock = JSON.parse(fs.readFileSync(path.join(appDir, 'fixtures/clock.json'), 'utf8')).initial_time;
  const mailbox = { account_id: 'mail-dana', owner_person_id: 'person-dana', address: 'dana.reyes@example.com', messages: [] };
  const boundMail = async run => {
    const mailInfra = await mailClient('infra', run), s = (await mailInfra.call('env.snapshot')).snapshot;
    const loaded = await mailInfra.call('env.load_seed', { expected_version: versionOf(s), data: mailbox, binding, virtual_now: clock, request_id: 'bound-mailbox' });
    assert.equal(loaded.status, 'ready', 'Infra loads the bound mailbox: ' + JSON.stringify(loaded).slice(0, 300));
    return mailInfra;
  };
  // One run of the scenario: a Belltower instance, the person's mailbox, the router and the Mail Agent.
  const setup = async (run, { grants, bound = true } = {}) => {
    const infra = await belltower('infra', run), mailInfra = bound ? await boundMail(run) : null, publisher = await router(run, writeConfig(run + '.config.json', grants)), mail = await mailClient('agent', run);
    const snapshot = async () => (await infra.call('env.snapshot')).snapshot;
    let clockCalls = 0;
    // Infra moves the sending App and keeps the receiving App at the same time before a delivery.
    const moveTo = async to => {
      const moved = await infra.call('env.advance_time', { request_id: run + '-clock-' + (++clockCalls), expected_version: versionOf(await snapshot()), virtual_now: to });
      if (mailInfra) await mailInfra.call('env.advance_time', { request_id: run + '-sync-' + clockCalls, expected_version: versionOf((await mailInfra.call('env.snapshot')).snapshot), virtual_now: to });
      return moved;
    };
    const apply = async event => {
      const applied = await infra.call('env.apply_event', { expected_version: versionOf(await snapshot()), event });
      if (mailInfra && applied.status === 'committed') await mailInfra.call('env.advance_time', { request_id: run + '-sync-' + (++clockCalls), expected_version: versionOf((await mailInfra.call('env.snapshot')).snapshot), virtual_now: event.at });
      return applied;
    };
    // Mail's own inbox records, oldest first: the thread_id of a received notification is the notification ID.
    const inbox = async query => (await mail.call('mail.search', { query })).messages.slice().sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at));
    return { infra, publisher, mail, snapshot, moveTo, apply, inbox };
  };
  const corrected = (id, when, number) => ({ event_id: id, at: when, operation: 'belltower.item.corrected', payload: { item_id: LIBRARY, revision: {
    number, published_at: when, note: 'An earlier correction gave the wrong weekday closing time. The library closes at 20:00.', headline: 'Old Quay Library open until 20:00 on weekdays',
    body: 'From Tuesday 17 November, Old Quay Library is open until 20:00 from Monday to Friday. Weekend hours are unchanged.', topics: ['libraries'], area_ids: ['ar-old-quay'], priority: 'routine', effective: { start: at(TUE, '09:00'), end: null },
  } } });
  const scenario = JSON.parse(fs.readFileSync(path.join(appDir, 'examples/scenario.json'), 'utf8'));
  try {
    const flow = await setup('flow'), sent = {};
    const capabilities = await flow.publisher.call('router.capabilities');
    equal('Messaging reads a send-only declaration from the Belltower package', [capabilities.app_messaging.direction, capabilities.channels.map(c => [c.channel, c.schema_id])], ['publish-only', [['channel.email', 'urn:pale:email-message:2']]]);
    const start = await flow.snapshot();
    const first = await publishReleased({ source: flow.infra, router: flow.publisher, sent });
    equal('notifications that came with the seed are history; the one that is still held is not published yet', [start.data.notifications.length, first.stage, first.dispatched.length, first.skipped, first.left_out.history, (await flow.inbox('belltower')).length],
      [12, 'nothing_pending', 0, [{ notification_id: 'ntf-0011', reason: 'held', release_at: at(TUE, '18:00') }], 11, 0]);

    // A held notification is published only after Infra has moved the clock past its release time. No App event is involved.
    const tooEarly = await flow.moveTo(at(TUE, '17:59:59'));
    equal('one second before the release time it is still held', [tooEarly.status, (await publishReleased({ source: flow.infra, router: flow.publisher, sent })).dispatched.length], ['committed', 0]);
    const evening = await flow.moveTo(at(TUE, '18:00')), before = await flow.snapshot();
    check('Infra moves the clock to 18:00 with env.advance_time', evening.status === 'committed' && evening.advanced === true);
    equal('the clock moves changed no Belltower record', before.data, start.data);
    const digest = before.data.notifications.find(n => n.id === 'ntf-0011');
    const second = await publishReleased({ source: flow.infra, router: flow.publisher, sent }), receipt = second.dispatched[0].result;
    equal('the released notification is published once the clock has reached its release time, and Messaging commits it to the bound Mail account',
      [second.stage, second.dispatched.map(d => d.notification_id), receipt.status, receipt.target, receipt.channel, receipt.cloud_event.id, receipt.cloud_event.time], ['delivered', ['ntf-0011'], 'committed', { app_id: 'mail', account_id: 'mail-dana' }, 'channel.email', 'ntf-0011', at(TUE, '18:00')]);
    const received = await flow.mail.call('mail.get', { id: receipt.event_id });
    equal('the Mail Agent reads the notification as a received message whose thread is the notification', [received.status, received.message.subject, received.message.body, received.message.received_at, received.message.thread_id, received.message.folder],
      ['ok', 'Correction: Old Quay Library open until 19:00 on weekdays', digest.body, at(TUE, '18:00'), 'ntf-0011', 'inbox']);
    equal('the superseded notification of the first announcement never reached Mail', [(await flow.inbox('Old Quay Library')).map(m => m.thread_id), (await flow.inbox('ntf-0010')).length], [['ntf-0011'], 0]);

    equal('the sender does not publish a notification twice', (await publishReleased({ source: flow.infra, router: flow.publisher, sent })).dispatched.length, 0);
    const retry = await flow.publisher.call('router.publish', { request_id: 'belltower:retry:ntf-0011', message: digest.wire });
    equal('an identical retry returns the first receipt and leaves one inbox record', [retry.duplicate, retry.event_id, (await flow.inbox('Old Quay Library')).length], [true, receipt.event_id, 1]);
    const changed = structuredClone(digest.wire); changed.data.content.title = 'Changed';
    check('the same notification ID with different content is rejected', (await flow.publisher.call('router.publish', { request_id: 'belltower:changed:ntf-0011', message: changed })).code === 'idempotency_conflict');
    const forged = structuredClone(digest.wire); forged.id = 'ntf-forged'; forged.source = 'urn:pale:app:belltower:account:someone-else'; forged.data.source_object.account_id = 'someone-else';
    check('a message for another source account is rejected', (await flow.publisher.call('router.publish', { request_id: 'belltower:forged', message: forged })).code === 'source_identity_mismatch');
    const otherType = structuredClone(digest.wire); otherType.id = 'ntf-other-type'; otherType.type = 'org.pale.other.v1';
    const wrongType = await flow.publisher.call('router.publish', { request_id: 'belltower:other-type', message: otherType });
    equal('a message of a type the channel does not carry is rejected, and Mail gets no second record', [wrongType.status, wrongType.code, (await flow.inbox('belltower')).length], ['rejected', 'invalid_arguments', 1]);
    const after = await flow.snapshot();
    equal('dispatch does not change Belltower', [after.data, after.revision], [before.data, before.revision]);

    // The sender ran at 18:00; the library corrects its notice again at 18:05. The account keeps corrections
    // in the digest, so the correction is due on Wednesday at 18:00 and is published then: two records in order.
    check('a second correction of the library notice arrives at 18:05', (await flow.apply(corrected('ev-lib-3', at(TUE, '18:05'), 3))).status === 'committed');
    const night = await flow.snapshot(), next = night.data.notifications.at(-1);
    equal('its notification waits for the next digest and already carries the wire message for that time', [next.id, next.kind, next.delivery, next.release_at, next.wire.time, plan(night, sent).skipped], ['ntf-0013', 'item.corrected', 'digest', at(WED, '18:00'), at(WED, '18:00'), [{ notification_id: 'ntf-0013', reason: 'held', release_at: at(WED, '18:00') }]]);
    equal('nothing is published before then', [(await publishReleased({ source: flow.infra, router: flow.publisher, sent })).stage, (await flow.inbox('20:00')).length], ['nothing_pending', 0]);
    await flow.moveTo(at(WED, '18:00'));
    const third = await publishReleased({ source: flow.infra, router: flow.publisher, sent });
    equal('after the Wednesday digest time Mail holds two records in order, the notification and then its correction', [third.dispatched.map(d => [d.notification_id, d.result.status]), (await flow.inbox('Old Quay Library')).map(m => [m.thread_id, m.received_at, m.subject])],
      [[['ntf-0013', 'committed']], [['ntf-0011', at(TUE, '18:00'), 'Correction: Old Quay Library open until 19:00 on weekdays'], ['ntf-0013', at(WED, '18:00'), 'Correction: Old Quay Library open until 20:00 on weekdays']]]);
    equal('the sender log holds both deliveries, and the log in Belltower holds every notification with its state', [Object.keys(sent), (await flow.snapshot()).data.notifications.filter(n => n.item_id === LIBRARY).map(n => [n.id, n.superseded_by ?? null, n.release_at])],
      [['ntf-0011', 'ntf-0013'], [['ntf-0010', 'ntf-0011', at(TUE, '18:00')], ['ntf-0011', null, at(TUE, '18:00')], ['ntf-0013', null, at(WED, '18:00')]]]);

    // Reset is per App instance: Belltower goes back to its loaded seed and time, and what Mail received stays.
    const lastState = await flow.snapshot(), reset = await flow.infra.call('env.reset', { expected_version: versionOf(lastState) }), restored = await flow.snapshot();
    equal('resetting Belltower restores its own baseline and leaves the delivered messages in Mail', [reset.status, restored.data.notifications.length, restored.virtual_now, restored.epoch > lastState.epoch, (await flow.inbox('Old Quay Library')).length], ['ready', 12, clock, true, 2]);

    // Delayed dispatch, as in the plan: the notification is due at 18:00, its item is corrected at 18:05 and
    // the sender first runs at 18:10. Corrections are delivered at once in this run, so that first run
    // publishes the correction, and Mail holds exactly one record: the correction.
    const delayed = await setup('delayed'), agent = await belltower('agent', 'delayed');
    const prefs = await agent.call('belltower.preferences.update', { patch: { corrections: 'immediate' }, request_id: 'delayed-prefs', expected_version: versionOf(await delayed.snapshot()) });
    check('the Agent asks for corrections at once (a write the scenario policy allows)', prefs.status === 'committed' && prefs.preferences.corrections === 'immediate');
    await delayed.moveTo(at(TUE, '18:00'));
    check('the correction arrives at 18:05, before any run of the sender', (await delayed.apply(corrected('ev-lib-3', at(TUE, '18:05'), 3))).status === 'committed');
    await delayed.moveTo(at(TUE, '18:10'));
    const beforeRun = await delayed.snapshot(), late = await publishReleased({ source: delayed.infra, router: delayed.publisher });
    equal('the first run at 18:10 skips the 18:00 notification as replaced and dispatches the correction', [late.stage, late.dispatched.map(d => [d.notification_id, d.revision, d.result.status]), late.skipped], ['delivered', [['ntf-0013', 3, 'committed']], [{ notification_id: 'ntf-0011', reason: 'replaced', revision: 2, latest_revision: 3 }]]);
    const one = await delayed.inbox('Old Quay Library');
    equal('Mail holds exactly one record, the correction; no copy of the old version went out', [one.map(m => [m.thread_id, m.subject]), (await delayed.inbox('19:00')).length], [[['ntf-0013', 'Correction: Old Quay Library open until 20:00 on weekdays']], 0]);
    const afterRun = await delayed.snapshot();
    equal('in the log the 18:00 notification is released, not superseded, and Belltower is the same before and after the run', [afterRun.data.notifications.slice(-3).map(n => [n.id, n.revision, n.release_at, n.superseded_by ?? null]), afterRun.data, afterRun.revision],
      [[['ntf-0011', 2, at(TUE, '18:00'), null], ['ntf-0012', 2, at(TUE, '16:30'), null], ['ntf-0013', 3, at(TUE, '18:05'), null]], beforeRun.data, beforeRun.revision]);

    // A notification written inside quiet hours (the package example): held until 07:00, then published.
    const quiet = await setup('quiet'), quietLog = {};
    check('the aggregator\'s copy arrives on Wednesday at 06:10', (await quiet.apply(scenario)).status === 'committed');
    const early = await publishReleased({ source: quiet.infra, router: quiet.publisher, sent: quietLog });
    equal('at 06:10 the sender publishes Tuesday\'s digest notification and skips the one held by the quiet hours', [early.dispatched.map(d => d.notification_id), early.skipped], [['ntf-0011'], [{ notification_id: 'ntf-0013', reason: 'held', release_at: at(WED, '07:00') }]]);
    await quiet.moveTo(at(WED, '07:00'));
    const morning = await publishReleased({ source: quiet.infra, router: quiet.publisher, sent: quietLog });
    equal('once the clock is at 07:00 it is published, and Mail has it at the synchronized time', [morning.dispatched.map(d => d.notification_id), (await quiet.inbox('Kestrel Bridge to close Thursday')).map(m => [m.thread_id, m.received_at])], [['ntf-0013'], [['ntf-0013', at(WED, '07:00')]]]);

    // Without a grant the delivery is rejected before dispatch and Mail has no record.
    const denied = await setup('denied', { grants: [] });
    await denied.moveTo(at(TUE, '18:00'));
    const refused = await publishReleased({ source: denied.infra, router: denied.publisher });
    equal('no grant: the delivery is rejected', [refused.stage, refused.dispatched.length, refused.dispatched[0].result.status, refused.dispatched[0].result.code, Object.keys(refused.sent).length], ['router_rejected', 1, 'rejected', 'recipient_not_authorized', 0]);
    equal('no grant: Mail has no record, and the Belltower notification is unaffected', [(await denied.inbox('Old Quay Library')).length, (await denied.snapshot()).data.notifications.length], [0, 12]);

    // A run in which the person has no Mail account bound (Mail keeps its own example account):
    // the delivery is rejected and that mailbox gets no record.
    const unbound = await setup('unbound', { bound: false });
    await unbound.moveTo(at(TUE, '18:00'));
    const nobody = await publishReleased({ source: unbound.infra, router: unbound.publisher });
    equal('no Mail account bound for the person: the delivery is rejected and no mailbox gets a record', [nobody.stage, nobody.dispatched[0].result.status, nobody.dispatched[0].result.code, (await unbound.inbox('Old Quay Library')).length], ['router_rejected', 'rejected', 'recipient_unavailable', 0]);

    // A task seed with email notices off: a new notification has no wire message and the sender has nothing to publish for it.
    const silent = await setup('no-email');
    const s3 = await silent.snapshot(), seed = structuredClone(s3.data);
    seed.preferences.email_notices = false;
    const loaded = await silent.infra.call('env.load_seed', { expected_version: versionOf(s3), data: seed, virtual_now: s3.virtual_now, request_id: 'no-email-seed' });
    await silent.apply(scenario);
    await silent.moveTo(at(WED, '07:00'));
    const s4 = await silent.snapshot(), plain = s4.data.notifications.at(-1), quietRun = await publishReleased({ source: silent.infra, router: silent.publisher });
    equal('email notices off: the notification is in the log without a wire message; only the earlier one, written while they were on, is published', [loaded.status, plain.id, plain.kind, plain.wire, quietRun.dispatched.map(d => d.notification_id), quietRun.left_out.no_email, (await silent.inbox('Kestrel')).length],
      ['ready', 'ntf-0013', 'item.published', undefined, ['ntf-0011'], 1, 0]);

    const mailVersion = JSON.parse(fs.readFileSync(path.join(checkout, 'examples/apps/mail/app.json'), 'utf8')).version;
    const report = { schema: 'belltower.mail-integration.v1', app_version: require('../app.json').version, runtime_version: runtimeVersion, mail_version: mailVersion, node: process.version, checks: checks.length, passed: true, duration_ms: Date.now() - started, names: checks };
    if (opts.report) fs.writeFileSync(path.resolve(opts.report), JSON.stringify(report, null, 2) + '\n');
    console.log('PASS: ' + checks.length + ' Belltower -> Mail checks through Messaging on runtime ' + runtimeVersion + ' with Mail ' + mailVersion + ' (real Mail receiver, receipts, a held notification released by the platform clock, a superseded one never sent, delayed dispatch, retry, rejection, no write-back).');
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
    fs.rmSync(state, { recursive: true, force: true });
  }
}
main().catch(e => { console.error('FAIL: ' + e.message); process.exitCode = 1; });
