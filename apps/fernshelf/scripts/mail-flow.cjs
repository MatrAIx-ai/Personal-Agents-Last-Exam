#!/usr/bin/env node
'use strict';
// Optional Fernshelf → Mail notification flow on real processes: Fernshelf and Mail MCP servers,
// the Messaging router and the Infra-run sender (src/publisher.cjs). It copies the pinned runtime,
// this package and the pinned Mail package into a disposable root, so the router's registry and
// publisher package live inside that root as the router requires.
//   node scripts/mail-flow.cjs [--runtime DIR] [--mail DIR] [--output FILE]
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const locate = require('./locate.cjs');
const publisher = require('../src/publisher.cjs');

async function run() {
  const runtime = locate.runtimeDir(), mail = locate.mailDir();
  const mailManifest = JSON.parse(fs.readFileSync(path.join(mail, 'app.json'), 'utf8'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fernshelf-mail-flow-')), clients = [], checks = [];
  const check = (name, cond, detail) => { assert.ok(cond, name + (detail ? ': ' + JSON.stringify(detail) : '')); checks.push({name, status: 'passed'}); };
  try {
    fs.cpSync(runtime, path.join(root, 'runtime'), {recursive: true});
    fs.cpSync(locate.packageDir, path.join(root, 'apps/fernshelf'), {recursive: true});
    fs.cpSync(mail, path.join(root, 'apps/mail'), {recursive: true});
    const registry = path.join(root, 'registry.json');
    fs.writeFileSync(registry, JSON.stringify({schema_version: 1, initial_time: '2026-11-20T09:00:00-08:00', apps: [
      {app_id: 'fernshelf', version: '1.0.0', path: 'apps/fernshelf'}, {app_id: 'mail', version: mailManifest.version, path: 'apps/mail'}]}));
    const config = grants => ({schema_version: 2, registry: 'registry.json', authentication: {mode: 'trusted-stdio'}, publishers: [{app_id: 'fernshelf',
      account_id: 'fernshelf-maya', owner_person_id: 'person-maya', package_root: 'apps/fernshelf', contribution_ref: 'contribution/contribution.json', allowed_recipients: grants}]});
    fs.writeFileSync(path.join(root, 'router.json'), JSON.stringify(config([{app_id: 'mail', account_id: 'mail-maya', channel: 'channel.email'}])));
    fs.writeFileSync(path.join(root, 'router-no-grant.json'), JSON.stringify(config([])));
    const {Client} = require(path.join(root, 'runtime/client.cjs'));
    const state = path.join(root, 'state');
    const open = async (app, role, run, name) => { const c = new Client(app, role, run, state, name, {registry}); clients.push(c); await c.initialize(); return c; };
    const router = async (cfg, run) => { const c = new Client(null, null, null, null, 'fernshelf-sender', {commandArgs: [path.join(root, 'runtime/messaging/service.cjs'),
      '--config', path.join(root, cfg), '--publisher', 'fernshelf', '--run', run, '--state-dir', state]}); clients.push(c); await c.initialize(); return c; };
    check('Mail is the pinned 1.3.0 package', mailManifest.version === '1.3.0', mailManifest.version);
    check('Fernshelf publishes the exact wire schema Mail receives',
      fs.readFileSync(path.join(locate.packageDir, 'schemas/router-message.schema.json'), 'utf8') === fs.readFileSync(path.join(mail, 'schemas/router-message.schema.json'), 'utf8'));

    // Produce a Fernshelf notification with a stored wire message in a fresh run: Dana's removal request.
    async function prepare(run, emailOn = true) {
      const infra = await open('fernshelf', 'infra', run, 'fernshelf-infra'), mailInfra = await open('mail', 'infra', run, 'mail-infra');
      let snap = await infra.call('env.snapshot');
      assert.equal((await infra.call('env.reset', {expected_version: snap.version, profile: 'sandbox'})).status, 'ready');
      if (!emailOn) {
        // Email notices are an account preference the Agent cannot change: Infra loads a task seed with them off.
        snap = await infra.call('env.snapshot');
        const data = structuredClone(snap.snapshot.data); data.account.email_notices = false;
        for (const n of data.notifications) n.wire = null;
        assert.equal((await infra.call('env.load_seed', {expected_version: snap.version, request_id: 'seed-off', data, bundle: snap.snapshot.resources.bundle})).status, 'ready');
      }
      snap = await infra.call('env.snapshot');
      const applied = await infra.call('env.apply_event', {expected_version: snap.version, event: JSON.parse(fs.readFileSync(path.join(locate.packageDir, 'examples/scenario.json'), 'utf8'))});
      assert.equal(applied.status, 'committed', JSON.stringify(applied));
      const after = (await infra.call('env.snapshot')).snapshot;
      return {infra, mailInfra, notification: after.data.notifications.at(-1)};
    }
    const inbox = async mailInfra => (await mailInfra.call('env.snapshot')).snapshot.data.messages.filter(m => m.folder === 'inbox');

    // 1. Granted delivery.
    const a = await prepare('flow-granted');
    check('Notification stored its wire message while email notices were on', a.notification.wire !== null && a.notification.kind === 'removal.requested' && a.notification.object_id === 'rr-0007');
    const sender = await router('router.json', 'flow-granted');
    const caps = await sender.call('router.capabilities');
    check('Router lists channel.email from Fernshelf\'s publish declaration', caps.channels.some(c => c.channel === 'channel.email' && c.schema_id === 'urn:pale:email-message:2'));
    const inboxBefore = await inbox(a.mailInfra), fsBefore = await a.infra.call('env.snapshot');
    check('Snapshot lists the notification as deliverable', publisher.deliverable(fsBefore.snapshot).some(x => x.notification_id === a.notification.id));
    const sent = await publisher.send({infra: a.infra, router: sender, notificationId: a.notification.id});
    check('Router commits the delivery to Mail', sent.stage === 'delivered' && sent.result.status === 'committed', sent.result);
    check('Receipt names the Mail account', sent.result.target.app_id === 'mail' && sent.result.target.account_id === 'mail-maya');
    const mailAgent = await open('mail', 'agent', 'flow-granted', 'mail-reader');
    const received = await mailAgent.call('mail.get', {id: sent.result.event_id});
    check('Mail holds the notification as a received message', received.status === 'ok' && received.message.folder === 'inbox' &&
      received.message.subject === a.notification.title && received.message.body === a.notification.body, received);
    const inboxAfter = await inbox(a.mailInfra);
    check('Exactly one new inbox record', inboxAfter.length === inboxBefore.length + 1);
    const fsAfter = await a.infra.call('env.snapshot');
    check('Fernshelf state is identical before and after dispatch', JSON.stringify(fsAfter.snapshot.data) === JSON.stringify(fsBefore.snapshot.data) &&
      JSON.stringify(fsAfter.version) === JSON.stringify(fsBefore.version));
    const retry = await publisher.send({infra: a.infra, router: sender, notificationId: a.notification.id});
    check('An identical retry returns the first receipt', retry.result.duplicate === true && retry.result.event_id === sent.result.event_id, retry.result);
    check('The retry leaves one inbox record', (await inbox(a.mailInfra)).length === inboxAfter.length);
    // Re-running the sender for the same notification sends no second email: even under a new request ID
    // the router derives the receiver event ID from the run, the wire message's source and ID and the
    // target account, so Mail answers from its stored receipt.
    const rerun = await publisher.send({infra: a.infra, router: sender, notificationId: a.notification.id, requestId: 'fernshelf-rerun-1'});
    check('A re-run under a new request ID reaches the same Mail event and is deduplicated', rerun.stage === 'delivered' && rerun.result.event_id === sent.result.event_id, rerun.result);
    check('The re-run leaves one inbox record', (await inbox(a.mailInfra)).length === inboxAfter.length);
    // A second sender process cannot reconnect to the run (the router refuses the source session), so it sends nothing.
    let reconnect = 'connected';
    try { await router('router.json', 'flow-granted'); } catch (e) { reconnect = /EEXIST/.test(e.message) ? 'refused' : e.message; }
    check('A second sender process for the same run is refused before any dispatch', reconnect === 'refused', reconnect);
    check('Mail still holds one record for the notification', (await inbox(a.mailInfra)).length === inboxAfter.length);

    // A Fernshelf-only reset restarts notification IDs at the seed's last one, so the next notification
    // reuses the delivered ntf ID. Its wire message ID also depends on the notification's content and
    // cause, so a different notification is a new Mail message, while the same notification produced
    // again by the same event is still one Mail message.
    const resetOnce = async () => { const v = (await a.infra.call('env.snapshot')).version; assert.equal((await a.infra.call('env.reset', {expected_version: v})).status, 'ready'); };
    await resetOnce();
    let snapR = await a.infra.call('env.snapshot');
    const other = await a.infra.call('env.apply_event', {expected_version: snapR.version, event: {event_id: 'ev-fs-445', at: '2026-11-20T19:20:00-08:00',
      operation: 'fernshelf.removal.withdrawn', payload: {removal_id: 'rr-0005', message: 'Leave it, it is fine.'}}});
    assert.equal(other.status, 'committed', JSON.stringify(other));
    const reused = (await a.infra.call('env.snapshot')).snapshot.data.notifications.at(-1);
    check('After a Fernshelf-only reset the next notification reuses the delivered notification ID', reused.id === a.notification.id && reused.title !== a.notification.title);
    const different = await publisher.send({infra: a.infra, router: sender, notificationId: reused.id});
    check('The different notification is delivered as a new Mail message', different.stage === 'delivered' && different.result.event_id !== sent.result.event_id &&
      (await inbox(a.mailInfra)).length === inboxAfter.length + 1, different.result);
    await resetOnce();
    snapR = await a.infra.call('env.snapshot');
    assert.equal((await a.infra.call('env.apply_event', {expected_version: snapR.version, event: JSON.parse(fs.readFileSync(path.join(locate.packageDir, 'examples/scenario.json'), 'utf8'))})).status, 'committed');
    const again = (await a.infra.call('env.snapshot')).snapshot.data.notifications.at(-1);
    check('The same event after a reset rebuilds the identical wire message', JSON.stringify(again.wire) === JSON.stringify(a.notification.wire));
    const resent = await publisher.send({infra: a.infra, router: sender, notificationId: again.id});
    check('...which Mail answers from its first receipt: no second email', resent.stage === 'delivered' && resent.result.event_id === sent.result.event_id &&
      (await inbox(a.mailInfra)).length === inboxAfter.length + 1, resent.result);

    // 2. Email notices off: no wire message, nothing to publish.
    const off = await prepare('flow-off', false);
    check('With email notices off the notification has no wire message', off.notification.wire === null);
    const offSender = await router('router.json', 'flow-off');
    const offResult = await publisher.send({infra: off.infra, router: offSender, notificationId: off.notification.id});
    check('The sender publishes nothing and Mail is unchanged', offResult.stage === 'email_notices_off' && (await inbox(off.mailInfra)).length === inboxBefore.length);

    // 3. No Infra grant for channel.email: rejected before dispatch, no Mail record.
    const b = await prepare('flow-no-grant');
    const denied = await router('router-no-grant.json', 'flow-no-grant');
    const mailBefore = await inbox(b.mailInfra), fsB = await b.infra.call('env.snapshot');
    const rejected = await publisher.send({infra: b.infra, router: denied, notificationId: b.notification.id});
    check('Delivery without a grant is rejected', rejected.result.status === 'rejected' && rejected.result.code === 'recipient_not_authorized', rejected.result);
    check('Rejected delivery creates no Mail record', (await inbox(b.mailInfra)).length === mailBefore.length);
    check('Rejected delivery leaves Fernshelf unchanged', JSON.stringify((await b.infra.call('env.snapshot')).snapshot.data) === JSON.stringify(fsB.snapshot.data));
    return {schema: 'fernshelf.mail-flow.v1', passed: true, runtime_version: JSON.parse(fs.readFileSync(path.join(runtime, 'package.json'), 'utf8')).version,
      mail_version: mailManifest.version, node: process.version, checks, receipt: sent.result, received: received.message, rejected: rejected.result};
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    fs.rmSync(root, {recursive: true, force: true});
  }
}
module.exports = {run};
if (require.main === module) {
  run().then(report => {
    const text = JSON.stringify(report, null, 2) + '\n', out = locate.option('output');
    if (out) { fs.mkdirSync(path.dirname(out), {recursive: true}); fs.writeFileSync(out, text); }
    console.log(text); console.log('PASS: ' + report.checks.length + ' Fernshelf → Mail checks.');
  }).catch(e => { console.error(e); process.exitCode = 1; });
}
