#!/usr/bin/env node
'use strict';
// Pegboard -> Mail through Messaging on the public reference runtime, with the real Mail
// package as the receiver. It checks the receiver's own record and receipt, a notification
// that is held until Infra moves the clock past its release time (no App event), an identical
// retry, changed content, a forged source, a delivery without a grant, and that dispatch
// never changes Pegboard's state.
//
//   node tests/mail.integration.cjs --runtime DIR [--report FILE]
//
// DIR is the `runtime` directory of a public PALE checkout, 1.6.0 or later;
// PALE_RUNTIME_ROOT=DIR works too. The public Messaging router resolves a publisher package
// and its receiver registry relative to its own checkout, so this flow needs the package
// inside that checkout (for example at apps/pegboard) and the pinned Mail package there
// (examples/apps/mail with examples/registry.mail.json).
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const appDir = path.resolve(__dirname, '..');
const { publishReleased, pending } = require('../infra/sender.cjs');

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

const at = (date, hhmm) => date + 'T' + hhmm + (hhmm.length === 5 ? ':00' : '') + '-08:00';

async function main() {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-pegboard-mail-')), prepared = prepare(appDir), clients = [], checks = [], started = Date.now();
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
  const pegboard = (role, run) => open(new Client('pegboard', role, run, state, 'pegboard-mail-test', { registry: prepared.registry }));
  const router = (run, config) => open(new Client(null, null, null, null, 'pegboard-mail-test', { commandArgs: [path.join(runtime, 'messaging/service.cjs'), '--config', config, '--publisher', 'pegboard', '--run', run, '--state-dir', state] }));
  const mailClient = (role, run) => open(new Client('mail', role, run, state, 'mail-' + role, { registry: path.join(checkout, MAIL_REGISTRY) }));
  const scenario = JSON.parse(fs.readFileSync(path.join(appDir, 'examples/scenario.json'), 'utf8'));
  const versionOf = s => ({ epoch: s.epoch, revision: s.revision });
  // The run's binding is shared: the account holder is one person with a Pegboard account and a
  // Mail account. The pinned Mail package ships its own example account, so Infra loads the
  // person's (empty) mailbox into the run's Mail instance with that binding, as a task would,
  // before Messaging starts and binds its receivers.
  const binding = JSON.parse(fs.readFileSync(path.join(appDir, 'fixtures/binding.json'), 'utf8')), clock = JSON.parse(fs.readFileSync(path.join(appDir, 'fixtures/clock.json'), 'utf8')).initial_time;
  const mailbox = { account_id: 'mail-noor', owner_person_id: 'person-noor', address: 'noor.haddad@example.com', messages: [] };
  const boundMail = async run => {
    const mailInfra = await mailClient('infra', run), s = (await mailInfra.call('env.snapshot')).snapshot;
    const loaded = await mailInfra.call('env.load_seed', { expected_version: versionOf(s), data: mailbox, binding, virtual_now: clock, request_id: 'bound-mailbox' });
    assert.equal(loaded.status, 'ready', 'Infra loads the bound mailbox: ' + JSON.stringify(loaded).slice(0, 300));
    return mailInfra;
  };
  try {
    const infra = await pegboard('infra', 'flow'), mailInfra = await boundMail('flow'), publisher = await router('flow', writeConfig('flow.config.json')), mail = await mailClient('agent', 'flow');
    const snapshot = async () => (await infra.call('env.snapshot')).snapshot;
    // Infra keeps the receiving App at the same time as the sending App before a delivery.
    const syncMail = async (id, to) => mailInfra.call('env.advance_time', { request_id: id, expected_version: versionOf((await mailInfra.call('env.snapshot')).snapshot), virtual_now: to });
    const capabilities = await publisher.call('router.capabilities');
    equal('Messaging reads a send-only declaration from the Pegboard package', [capabilities.app_messaging.direction, capabilities.channels.map(c => [c.channel, c.schema_id])], ['publish-only', [['channel.email', 'urn:pale:email-message:2']]]);
    const inbox = async query => (await mail.call('mail.search', { query })).messages;
    const start = await snapshot();
    equal('notifications that came with the seed are history and are not dispatched', [start.data.notifications.length, pending(start).length, (await publishReleased({ source: infra, router: publisher })).results.length, (await inbox('Pegboard')).length], [16, 0, 0, 0]);

    // A notification that is released as it is written.
    check('the manager moves Monday\'s open an hour earlier', (await infra.call('env.apply_event', { expected_version: versionOf(start), event: scenario })).status === 'committed');
    const before = await snapshot(), notification = before.data.notifications.at(-1);
    equal('the notification carries its wire message, dated at its release time', [notification.id, notification.kind, notification.release_at, notification.wire.time, notification.wire.data.recipient, pending(before).map(n => n.id)], ['ntf-0017', 'shift.changed', scenario.at, scenario.at, { kind: 'person_ref', id: 'person-noor' }, ['ntf-0017']]);
    check('Infra brings Mail to the same time', (await syncMail('sync-2040', scenario.at)).status === 'committed');
    const sent = {}, first = await publishReleased({ source: infra, router: publisher, sent });
    const receipt = first.results[0].result;
    equal('Messaging commits the delivery to the bound Mail account', [first.stage, first.results.length, receipt.status, receipt.target, receipt.channel, receipt.cloud_event.id, receipt.cloud_event.time], ['delivered', 1, 'committed', { app_id: 'mail', account_id: 'mail-noor' }, 'channel.email', 'ntf-0017', notification.release_at]);
    const received = await mail.call('mail.get', { id: receipt.event_id });
    equal('the Mail Agent reads the notification as a received message', [received.status, received.message.subject, received.message.body, received.message.received_at], ['ok', 'Your Monday shift at Finch Street now starts at 05:00', notification.body, scenario.at]);
    equal('one inbox record', (await inbox('Monday shift')).length, 1);

    equal('the sender does not publish a notification twice', (await publishReleased({ source: infra, router: publisher, sent })).results.length, 0);
    const retry = await publisher.call('router.publish', { request_id: 'pegboard:retry:ntf-0017', message: notification.wire });
    equal('an identical retry returns the first receipt and leaves one inbox record', [retry.duplicate, retry.event_id, (await inbox('Monday shift')).length], [true, receipt.event_id, 1]);
    const changed = structuredClone(notification.wire); changed.data.content.title = 'Changed';
    check('the same notification ID with different content is rejected', (await publisher.call('router.publish', { request_id: 'pegboard:changed:ntf-0017', message: changed })).code === 'idempotency_conflict');
    const forged = structuredClone(notification.wire); forged.id = 'ntf-forged'; forged.source = 'urn:pale:app:pegboard:account:someone-else'; forged.data.source_object.account_id = 'someone-else';
    check('a message for another source account is rejected', (await publisher.call('router.publish', { request_id: 'pegboard:forged', message: forged })).code === 'source_identity_mismatch');
    const otherType = structuredClone(notification.wire); otherType.id = 'ntf-other-type'; otherType.type = 'org.pale.other.v1';
    const wrongType = await publisher.call('router.publish', { request_id: 'pegboard:other-type', message: otherType });
    equal('a message of a type the channel does not carry is rejected, and Mail gets no second record', [wrongType.status, wrongType.code, (await inbox('Monday shift')).length], ['rejected', 'invalid_arguments', 1]);
    const after = await snapshot();
    equal('dispatch does not change Pegboard', [after.data, after.revision], [before.data, before.revision]);

    // A notification written in quiet hours: published only after Infra has moved the clock
    // past its release time. No App event is involved.
    const answer = { event_id: 'ev-night', at: at('2026-11-21', '23:10'), operation: 'pegboard.handoff.answered', payload: { handoff_id: 'ho-0013', answer: 'accept', message: 'I can close on the 28th.' } };
    check('Tomas accepts in quiet hours', (await infra.call('env.apply_event', { expected_version: versionOf(after), event: answer })).status === 'committed');
    const night = await snapshot(), held = night.data.notifications.at(-1);
    equal('its notification is held until 07:00 and already carries the wire message for that time', [held.id, held.kind, held.created_at, held.release_at, held.wire.time, pending(night, sent).length], ['ntf-0018', 'handoff.updated', at('2026-11-21', '23:10'), at('2026-11-22', '07:00'), at('2026-11-22', '07:00'), 0]);
    await syncMail('sync-2310', at('2026-11-21', '23:10'));
    equal('a held notification is not published', [(await publishReleased({ source: infra, router: publisher, sent })).stage, (await inbox('accepted your cover request')).length], ['nothing_pending', 0]);
    const tooEarly = await infra.call('env.advance_time', { request_id: 'night-0659', expected_version: versionOf(night), virtual_now: at('2026-11-22', '06:59:59') });
    equal('one second before the release time it is still held', [tooEarly.status, (await publishReleased({ source: infra, router: publisher, sent })).results.length], ['committed', 0]);
    const morning = await infra.call('env.advance_time', { request_id: 'morning-0700', expected_version: tooEarly.version, virtual_now: at('2026-11-22', '07:00') });
    await syncMail('sync-0700', at('2026-11-22', '07:00'));
    check('Infra moves the clock to 07:00 with env.advance_time', morning.status === 'committed' && morning.advanced === true);
    const day = await snapshot();
    equal('the clock move changed no Pegboard record', day.data, night.data);
    const second = await publishReleased({ source: infra, router: publisher, sent }), receipt2 = second.results[0].result;
    equal('the released notification is published once the clock has passed its release time', [second.stage, second.results.map(r => r.notification_id), receipt2.status, receipt2.cloud_event.id, receipt2.cloud_event.time], ['delivered', ['ntf-0018'], 'committed', 'ntf-0018', at('2026-11-22', '07:00')]);
    const morningMail = await mail.call('mail.get', { id: receipt2.event_id });
    equal('Mail has the notification, received at the synchronized time', [morningMail.status, morningMail.message.subject, morningMail.message.received_at, (await inbox('accepted your cover request')).length], ['ok', held.title, at('2026-11-22', '07:00'), 1]);
    equal('the sender log holds both deliveries and Pegboard is unchanged by them', [Object.keys(sent), (await snapshot()).revision], [['ntf-0017', 'ntf-0018'], day.revision]);

    // Reset is per App instance: Pegboard goes back to its loaded seed and time, and what Mail received stays.
    const reset = await infra.call('env.reset', { expected_version: versionOf(await snapshot()) }), restored = await snapshot();
    equal('resetting Pegboard restores its own baseline and leaves the delivered messages in Mail', [reset.status, restored.data.notifications.length, restored.virtual_now, restored.epoch > day.epoch, (await inbox('Monday shift')).length, (await inbox('accepted your cover request')).length], ['ready', 16, clock, true, 1, 1]);

    // Without a grant the delivery is rejected before dispatch and Mail has no record.
    const infra2 = await pegboard('infra', 'denied');
    await boundMail('denied');
    const denied = await router('denied', writeConfig('denied.config.json', [])), mail2 = await mailClient('agent', 'denied');
    const s2 = (await infra2.call('env.snapshot')).snapshot;
    await infra2.call('env.apply_event', { expected_version: versionOf(s2), event: scenario });
    const refused = await publishReleased({ source: infra2, router: denied });
    equal('no grant: the delivery is rejected', [refused.stage, refused.results.length, refused.results[0].result.status, refused.results[0].result.code, Object.keys(refused.sent).length], ['router_rejected', 1, 'rejected', 'recipient_not_authorized', 0]);
    equal('no grant: Mail has no record', (await mail2.call('mail.search', { query: 'Monday shift' })).messages.length, 0);
    check('no grant: the Pegboard notification is unaffected', (await infra2.call('env.snapshot')).snapshot.data.notifications.at(-1).id === 'ntf-0017');

    // A run in which the person has no Mail account bound (Mail keeps its own example account):
    // the delivery is rejected and that mailbox gets no record.
    const infra4 = await pegboard('infra', 'unbound'), unbound = await router('unbound', writeConfig('unbound.config.json')), mail4 = await mailClient('agent', 'unbound');
    await infra4.call('env.apply_event', { expected_version: versionOf((await infra4.call('env.snapshot')).snapshot), event: scenario });
    const nobody = await publishReleased({ source: infra4, router: unbound });
    equal('no Mail account bound for the person: the delivery is rejected and no mailbox gets a record', [nobody.stage, nobody.results[0].result.status, nobody.results[0].result.code, (await mail4.call('mail.search', { query: 'Monday shift' })).messages.length], ['router_rejected', 'rejected', 'recipient_unavailable', 0]);

    // A task seed with email notices off: the notification has no wire message and the sender has nothing to publish.
    const infra3 = await pegboard('infra', 'no-email');
    await boundMail('no-email');
    const noEmail = await router('no-email', writeConfig('no-email.config.json'));
    const s3 = (await infra3.call('env.snapshot')).snapshot, seed = structuredClone(s3.data);
    seed.preferences.email_notices = false;
    const loaded = await infra3.call('env.load_seed', { expected_version: versionOf(s3), data: seed, virtual_now: s3.virtual_now, request_id: 'no-email-seed' });
    await infra3.call('env.apply_event', { expected_version: loaded.version, event: scenario });
    const s4 = (await infra3.call('env.snapshot')).snapshot, silent = s4.data.notifications.at(-1);
    equal('email notices off: the notification is in the log without a wire message, and nothing is published', [loaded.status, silent.id, silent.kind, silent.wire, (await publishReleased({ source: infra3, router: noEmail })).stage], ['ready', 'ntf-0017', 'shift.changed', undefined, 'nothing_pending']);

    const mailVersion = JSON.parse(fs.readFileSync(path.join(checkout, 'examples/apps/mail/app.json'), 'utf8')).version;
    const report = { schema: 'pegboard.mail-integration.v1', app_version: require('../app.json').version, runtime_version: runtimeVersion, mail_version: mailVersion, node: process.version, checks: checks.length, passed: true, duration_ms: Date.now() - started, names: checks };
    if (opts.report) fs.writeFileSync(path.resolve(opts.report), JSON.stringify(report, null, 2) + '\n');
    console.log('PASS: ' + checks.length + ' Pegboard -> Mail checks through Messaging on runtime ' + runtimeVersion + ' with Mail ' + mailVersion + ' (real Mail receiver, receipts, a held notification released by the platform clock, retry, rejection, no write-back).');
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
    fs.rmSync(state, { recursive: true, force: true });
  }
}
main().catch(e => { console.error('FAIL: ' + e.message); process.exitCode = 1; });
