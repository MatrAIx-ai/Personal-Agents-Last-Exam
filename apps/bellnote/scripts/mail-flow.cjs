#!/usr/bin/env node
'use strict';
// Optional Bellnote → Mail notification flow on real processes: Bellnote and Mail MCP servers,
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bellnote-mail-flow-')), clients = [], checks = [];
  const check = (name, cond, detail) => { assert.ok(cond, name + (detail ? ': ' + JSON.stringify(detail) : '')); checks.push({name, status: 'passed'}); };
  try {
    fs.cpSync(runtime, path.join(root, 'runtime'), {recursive: true});
    fs.cpSync(locate.packageDir, path.join(root, 'apps/bellnote'), {recursive: true});
    fs.cpSync(mail, path.join(root, 'apps/mail'), {recursive: true});
    const registry = path.join(root, 'registry.json');
    fs.writeFileSync(registry, JSON.stringify({schema_version: 1, initial_time: '2026-11-17T07:00:00-08:00', apps: [
      {app_id: 'bellnote', version: '1.0.0', path: 'apps/bellnote'}, {app_id: 'mail', version: mailManifest.version, path: 'apps/mail'}]}));
    const config = grants => ({schema_version: 2, registry: 'registry.json', authentication: {mode: 'trusted-stdio'}, publishers: [{app_id: 'bellnote',
      account_id: 'bellnote-maya', owner_person_id: 'person-maya', package_root: 'apps/bellnote', contribution_ref: 'contribution/contribution.json', allowed_recipients: grants}]});
    fs.writeFileSync(path.join(root, 'router.json'), JSON.stringify(config([{app_id: 'mail', account_id: 'mail-maya', channel: 'channel.email'}])));
    fs.writeFileSync(path.join(root, 'router-no-grant.json'), JSON.stringify(config([])));
    const {Client} = require(path.join(root, 'runtime/client.cjs'));
    const state = path.join(root, 'state');
    const open = async (app, role, run, name) => { const c = new Client(app, role, run, state, name, {registry}); clients.push(c); await c.initialize(); return c; };
    const router = async (cfg, run) => { const c = new Client(null, null, null, null, 'bellnote-sender', {commandArgs: [path.join(root, 'runtime/messaging/service.cjs'),
      '--config', path.join(root, cfg), '--publisher', 'bellnote', '--run', run, '--state-dir', state]}); clients.push(c); await c.initialize(); return c; };
    check('Mail is the pinned 1.3.0 package', mailManifest.version === '1.3.0', mailManifest.version);
    check('Bellnote publishes the exact wire schema Mail receives',
      fs.readFileSync(path.join(locate.packageDir, 'schemas/router-message.schema.json'), 'utf8') === fs.readFileSync(path.join(mail, 'schemas/router-message.schema.json'), 'utf8'));

    // Produce a Bellnote notification with a stored wire message in a fresh run.
    async function prepare(run, emailOn = true) {
      const infra = await open('bellnote', 'infra', run, 'bellnote-infra'), mailInfra = await open('mail', 'infra', run, 'mail-infra');
      let snap = await infra.call('env.snapshot');
      assert.equal((await infra.call('env.reset', {expected_version: snap.version, profile: 'sandbox'})).status, 'ready');
      const agent = await open('bellnote', 'agent', run, 'bellnote-agent');
      snap = await infra.call('env.snapshot');
      assert.equal((await agent.call('bellnote.preferences.update', {expected_version: snap.version, request_id: 'notices-' + run, email_notices: emailOn})).status, 'committed');
      snap = await infra.call('env.snapshot');
      const applied = await infra.call('env.apply_event', {expected_version: snap.version, event: {event_id: 'ev-bn-160', at: '2026-11-18T13:05:00-08:00',
        operation: 'bellnote.school.day_changed', payload: {school_id: 'school-alder', date: '2026-11-20', kind: 'early_dismissal', dismissal_local: '12:30', reason: 'Staff training'}}});
      assert.equal(applied.status, 'committed', JSON.stringify(applied));
      const after = (await infra.call('env.snapshot')).snapshot;
      return {infra, mailInfra, notification: after.data.notifications.at(-1)};
    }
    const inbox = async mailInfra => (await mailInfra.call('env.snapshot')).snapshot.data.messages.filter(m => m.folder === 'inbox');

    // 1. Granted delivery.
    const a = await prepare('flow-granted');
    check('Notification stored its wire message while email notices were on', a.notification.wire !== null && a.notification.kind === 'school.day_changed');
    const sender = await router('router.json', 'flow-granted');
    const caps = await sender.call('router.capabilities');
    check('Router lists channel.email from Bellnote\'s publish declaration', caps.channels.some(c => c.channel === 'channel.email' && c.schema_id === 'urn:pale:email-message:2'));
    const inboxBefore = await inbox(a.mailInfra), bellBefore = await a.infra.call('env.snapshot');
    check('Snapshot lists the notification as deliverable', publisher.deliverable(bellBefore.snapshot).some(x => x.notification_id === a.notification.id));
    const sent = await publisher.send({infra: a.infra, router: sender, notificationId: a.notification.id});
    check('Router commits the delivery to Mail', sent.stage === 'delivered' && sent.result.status === 'committed', sent.result);
    check('Receipt names the Mail account', sent.result.target.app_id === 'mail' && sent.result.target.account_id === 'mail-maya');
    const mailAgent = await open('mail', 'agent', 'flow-granted', 'mail-reader');
    const received = await mailAgent.call('mail.get', {id: sent.result.event_id});
    check('Mail holds the notification as a received message', received.status === 'ok' && received.message.folder === 'inbox' &&
      received.message.subject === a.notification.title && received.message.body === a.notification.body, received);
    const inboxAfter = await inbox(a.mailInfra);
    check('Exactly one new inbox record', inboxAfter.length === inboxBefore.length + 1);
    const bellAfter = await a.infra.call('env.snapshot');
    check('Bellnote state is identical before and after dispatch', JSON.stringify(bellAfter.snapshot.data) === JSON.stringify(bellBefore.snapshot.data) &&
      JSON.stringify(bellAfter.version) === JSON.stringify(bellBefore.version));
    const retry = await publisher.send({infra: a.infra, router: sender, notificationId: a.notification.id});
    check('An identical retry returns the first receipt', retry.result.duplicate === true && retry.result.event_id === sent.result.event_id, retry.result);
    check('The retry leaves one inbox record', (await inbox(a.mailInfra)).length === inboxAfter.length);

    // 2. Email notices off: no wire message, nothing to publish.
    const off = await prepare('flow-off', false);
    check('With email notices off the notification has no wire message', off.notification.wire === null);
    const offSender = await router('router.json', 'flow-off');
    const offResult = await publisher.send({infra: off.infra, router: offSender, notificationId: off.notification.id});
    check('The sender publishes nothing and Mail is unchanged', offResult.stage === 'email_notices_off' && (await inbox(off.mailInfra)).length === inboxBefore.length);

    // 3. No Infra grant for channel.email: rejected before dispatch, no Mail record.
    const b = await prepare('flow-no-grant');
    const denied = await router('router-no-grant.json', 'flow-no-grant');
    const mailBefore = await inbox(b.mailInfra), bellB = await b.infra.call('env.snapshot');
    const rejected = await publisher.send({infra: b.infra, router: denied, notificationId: b.notification.id});
    check('Delivery without a grant is rejected', rejected.result.status === 'rejected' && rejected.result.code === 'recipient_not_authorized', rejected.result);
    check('Rejected delivery creates no Mail record', (await inbox(b.mailInfra)).length === mailBefore.length);
    check('Rejected delivery leaves Bellnote unchanged', JSON.stringify((await b.infra.call('env.snapshot')).snapshot.data) === JSON.stringify(bellB.snapshot.data));
    return {schema: 'bellnote.mail-flow.v1', passed: true, runtime_version: JSON.parse(fs.readFileSync(path.join(runtime, 'package.json'), 'utf8')).version,
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
    console.log(text); console.log('PASS: ' + report.checks.length + ' Bellnote → Mail checks.');
  }).catch(e => { console.error(e); process.exitCode = 1; });
}
