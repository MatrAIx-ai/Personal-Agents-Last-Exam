#!/usr/bin/env node
'use strict';
// Optional Bellnote → Mail notification flow on real processes: Bellnote and Mail MCP servers,
// the Messaging router and the Infra-run sender (src/publisher.cjs). It copies the pinned runtime,
// this package and the pinned Mail package into a disposable root, so the router's registry and
// publisher package live inside that root as the router requires.
//   node scripts/mail-flow.cjs [--runtime DIR] [--mail DIR] [--output FILE] [--transcript DIR]
// --transcript DIR writes mail-delivery.json and mail-delivery.md (the delivery evidence: revisions,
// contract, binding, requests, receipts, Mail's records and every failure case). Wall-clock times
// in receipts are replaced by "<wall-clock>" so the transcript is the same on every run.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const locate = require('./locate.cjs');
const publisher = require('../src/publisher.cjs');

// Messaging and Core stamp arrival and commit with the real clock in UTC (new Date().toISOString());
// virtual (business) times always carry the district's offset and are kept as returned.
const WALL = new Set(['received_at', 'committed_at', 'processed_at']);
const scrub = x => JSON.parse(JSON.stringify(x, (k, v) => WALL.has(k) && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) ? '<wall-clock>' : v));
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function run() {
  const runtime = locate.runtimeDir(), mail = locate.mailDir();
  const mailManifest = JSON.parse(fs.readFileSync(path.join(mail, 'app.json'), 'utf8'));
  const bellManifest = JSON.parse(fs.readFileSync(path.join(locate.packageDir, 'app.json'), 'utf8'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bellnote-mail-flow-')), clients = [], checks = [], cases = [];
  const check = (name, cond, detail) => { assert.ok(cond, name + (detail ? ': ' + JSON.stringify(detail) : '')); checks.push({name, status: 'passed'}); };
  try {
    fs.cpSync(runtime, path.join(root, 'runtime'), {recursive: true});
    fs.cpSync(locate.packageDir, path.join(root, 'apps/bellnote'), {recursive: true});
    fs.cpSync(mail, path.join(root, 'apps/mail'), {recursive: true});
    const regEntries = withMail => [{app_id: 'bellnote', version: '1.0.0', path: 'apps/bellnote'}, ...(withMail ? [{app_id: 'mail', version: mailManifest.version, path: 'apps/mail'}] : [])];
    const writeRegistry = (file, withMail) => fs.writeFileSync(path.join(root, file), JSON.stringify({schema_version: 1, initial_time: '2026-11-17T07:00:00-08:00', apps: regEntries(withMail)}));
    writeRegistry('registry.json', true); writeRegistry('registry-no-mail.json', false);
    const registry = path.join(root, 'registry.json');
    const GRANT = [{app_id: 'mail', account_id: 'mail-maya', channel: 'channel.email'}];
    const config = (grants, reg = 'registry.json', pkg = 'apps/bellnote') => ({schema_version: 2, registry: reg, authentication: {mode: 'trusted-stdio'}, publishers: [{app_id: 'bellnote',
      account_id: 'bellnote-maya', owner_person_id: 'person-maya', package_root: pkg, contribution_ref: 'contribution/contribution.json', allowed_recipients: grants}]});
    fs.writeFileSync(path.join(root, 'router.json'), JSON.stringify(config(GRANT)));
    fs.writeFileSync(path.join(root, 'router-no-grant.json'), JSON.stringify(config([])));
    fs.writeFileSync(path.join(root, 'router-no-mail.json'), JSON.stringify(config(GRANT, 'registry-no-mail.json')));
    // A Bellnote build whose wire schema is a different revision than the one Mail receives: the
    // same package with one changed schema description (a test double of an incompatible release).
    fs.cpSync(path.join(root, 'apps/bellnote'), path.join(root, 'apps/bellnote-other-wire'), {recursive: true});
    const otherSchema = path.join(root, 'apps/bellnote-other-wire/schemas/router-message.schema.json'), other = JSON.parse(fs.readFileSync(otherSchema, 'utf8'));
    other.description = 'Email notification wire message, other revision'; fs.writeFileSync(otherSchema, JSON.stringify(other, null, 2) + '\n');
    fs.writeFileSync(path.join(root, 'router-other-wire.json'), JSON.stringify(config(GRANT, 'registry.json', 'apps/bellnote-other-wire')));
    const {Client} = require(path.join(root, 'runtime/client.cjs'));
    const state = path.join(root, 'state');
    const open = async (app, role, run, name, reg = registry) => { const c = new Client(app, role, run, state, name, {registry: reg}); clients.push(c); await c.initialize(); return c; };
    const router = async (cfg, run) => { const c = new Client(null, null, null, null, 'bellnote-sender', {commandArgs: [path.join(root, 'runtime/messaging/service.cjs'),
      '--config', path.join(root, cfg), '--publisher', 'bellnote', '--run', run, '--state-dir', state]}); clients.push(c); await c.initialize(); return c; };
    check('Mail is the pinned 1.3.0 package', mailManifest.version === '1.3.0', mailManifest.version);
    check('Bellnote publishes the exact wire schema Mail receives',
      fs.readFileSync(path.join(locate.packageDir, 'schemas/router-message.schema.json'), 'utf8') === fs.readFileSync(path.join(mail, 'schemas/router-message.schema.json'), 'utf8'));

    // Produce a Bellnote notification with a stored wire message in a fresh run.
    async function prepare(run, emailOn = true, reg = registry, withMail = true) {
      const infra = await open('bellnote', 'infra', run, 'bellnote-infra', reg), mailInfra = withMail ? await open('mail', 'infra', run, 'mail-infra', reg) : null;
      let snap = await infra.call('env.snapshot');
      assert.equal((await infra.call('env.reset', {expected_version: snap.version, profile: 'sandbox'})).status, 'ready');
      const agent = await open('bellnote', 'agent', run, 'bellnote-agent', reg);
      snap = await infra.call('env.snapshot');
      const pref = await agent.call('bellnote.preferences.update', {expected_version: snap.version, request_id: 'notices-' + run, email_notices: emailOn});
      assert.equal(pref.status, 'committed');
      snap = await infra.call('env.snapshot');
      const event = {event_id: 'ev-bn-160', at: '2026-11-18T13:05:00-08:00', operation: 'bellnote.school.day_changed',
        payload: {school_id: 'school-alder', date: '2026-11-20', kind: 'early_dismissal', dismissal_local: '12:30', reason: 'Staff training'}};
      const applied = await infra.call('env.apply_event', {expected_version: snap.version, event});
      assert.equal(applied.status, 'committed', JSON.stringify(applied));
      // Infra brings Mail's clock to the same session time before any delivery, as it does in a run.
      let mailClock = null;
      if (mailInfra) {
        const ms = await mailInfra.call('env.snapshot');
        mailClock = await mailInfra.call('env.advance_time', {expected_version: ms.version, request_id: 'sync-' + run, virtual_now: event.at});
        assert.ok(['committed', 'ready'].includes(mailClock.status), JSON.stringify(mailClock));
      }
      const after = await infra.call('env.snapshot');
      const local = {mail_clock: mailClock ? {tool: 'env.advance_time', virtual_now: event.at, status: mailClock.status} : null,preferences_update: {tool: 'bellnote.preferences.update', arguments: {request_id: 'notices-' + run, email_notices: emailOn}, status: pref.status, version: pref.version},
        event: {request: event, status: applied.status, version: applied.version}, notification_id: after.snapshot.data.notifications.at(-1).id, bellnote_version: after.version};
      return {infra, mailInfra, notification: after.snapshot.data.notifications.at(-1), local};
    }
    const inbox = async mailInfra => (await mailInfra.call('env.snapshot')).snapshot.data.messages.filter(m => m.folder === 'inbox');
    const mailState = async mailInfra => { const s = await mailInfra.call('env.snapshot'); return {version: s.version, messages: s.snapshot.data.messages.length, inbox: s.snapshot.data.messages.filter(m => m.folder === 'inbox').length}; };
    const bellState = async infra => { const s = await infra.call('env.snapshot'); return {version: s.version, notifications: s.snapshot.data.notifications.length, activity: s.snapshot.data.activity.length}; };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    // 1. Granted delivery.
    const a = await prepare('flow-granted');
    check('Notification stored its wire message while email notices were on', a.notification.wire !== null && a.notification.kind === 'school.day_changed');
    const sender = await router('router.json', 'flow-granted');
    const caps = await sender.call('router.capabilities');
    check('Router lists channel.email from Bellnote\'s publish declaration', caps.channels.some(c => c.channel === 'channel.email' && c.schema_id === 'urn:pale:email-message:2'));
    const inboxBefore = await inbox(a.mailInfra), bellBefore = await a.infra.call('env.snapshot'), mailBeforeA = await mailState(a.mailInfra);
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
    const receiverStatus = await a.mailInfra.call('env.event_status', {event_id: sent.result.event_id});
    check('Mail\'s own receipt for the delivery event is committed', receiverStatus.receipt && receiverStatus.receipt.status === 'committed', receiverStatus);
    const bellAfter = await a.infra.call('env.snapshot');
    check('Bellnote state is identical before and after dispatch', JSON.stringify(bellAfter.snapshot.data) === JSON.stringify(bellBefore.snapshot.data) &&
      JSON.stringify(bellAfter.version) === JSON.stringify(bellBefore.version));
    const mailAfterA = await mailState(a.mailInfra);
    const retry = await publisher.send({infra: a.infra, router: sender, notificationId: a.notification.id});
    check('An identical retry returns the first receipt', retry.result.duplicate === true && retry.result.event_id === sent.result.event_id, retry.result);
    check('The retry leaves one inbox record', (await inbox(a.mailInfra)).length === inboxAfter.length);
    // The same request ID with changed content is refused, not delivered as a second message.
    const changed = structuredClone(a.notification.wire); changed.data.content.title += ' (resent)';
    const conflict = await sender.call('router.publish', {request_id: sent.request_id, message: changed});
    check('The same request ID with changed content is refused as idempotency_conflict', conflict.status === 'rejected' && conflict.code === 'idempotency_conflict', conflict);
    check('The refused retry leaves Mail and Bellnote unchanged', same(await mailState(a.mailInfra), mailAfterA) && same((await a.infra.call('env.snapshot')).snapshot.data, bellBefore.snapshot.data));
    cases.push({case: 'delivered', meaning: 'receiver delivery/commit', run: 'flow-granted', router_config: {grants: GRANT}, local: a.local,
      initial: {bellnote: {version: bellBefore.version, notifications: bellBefore.snapshot.data.notifications.length}, mail: mailBeforeA},
      request: {tool: 'router.publish', request_id: sent.request_id, cloud_event_id: a.notification.wire.id, source: a.notification.wire.source, type: a.notification.wire.type,
        recipient: a.notification.wire.data.recipient, source_object: a.notification.wire.data.source_object, title: a.notification.wire.data.content.title},
      result: scrub(sent.result), receiver_event_status: scrub(receiverStatus.receipt),
      in_mail: {tool: 'mail.get', id: sent.result.event_id, account: 'mail-maya', message: scrub(received.message)},
      after: {bellnote: await bellState(a.infra), mail: mailAfterA},
      retry: {request_id: sent.request_id, result: scrub(retry.result), mail_after: await mailState(a.mailInfra)},
      changed_retry: {request_id: sent.request_id, changed: 'content.title', result: scrub(conflict), mail_after: await mailState(a.mailInfra)}});

    // 2. Email notices off: no wire message, nothing to publish.
    const off = await prepare('flow-off', false);
    check('With email notices off the notification has no wire message', off.notification.wire === null);
    const offSender = await router('router.json', 'flow-off');
    const offMailBefore = await mailState(off.mailInfra);
    const offResult = await publisher.send({infra: off.infra, router: offSender, notificationId: off.notification.id});
    check('The sender publishes nothing and Mail is unchanged', offResult.stage === 'email_notices_off' && (await inbox(off.mailInfra)).length === inboxBefore.length);
    cases.push({case: 'email_notices_off', meaning: 'no local wire message, nothing sent', run: 'flow-off', local: off.local, result: offResult, mail_before: offMailBefore, mail_after: await mailState(off.mailInfra)});

    // 3. No Infra grant for channel.email: rejected before dispatch, no Mail record.
    const b = await prepare('flow-no-grant');
    const denied = await router('router-no-grant.json', 'flow-no-grant');
    const mailBefore = await inbox(b.mailInfra), bellB = await b.infra.call('env.snapshot'), mailStB = await mailState(b.mailInfra);
    const rejected = await publisher.send({infra: b.infra, router: denied, notificationId: b.notification.id});
    check('Delivery without a grant is rejected', rejected.result.status === 'rejected' && rejected.result.code === 'recipient_not_authorized', rejected.result);
    check('Rejected delivery creates no Mail record', (await inbox(b.mailInfra)).length === mailBefore.length);
    check('Rejected delivery leaves Bellnote unchanged', JSON.stringify((await b.infra.call('env.snapshot')).snapshot.data) === JSON.stringify(bellB.snapshot.data));
    cases.push({case: 'denied', meaning: 'refused before dispatch', run: 'flow-no-grant', router_config: {grants: []}, local: b.local, request_id: rejected.request_id, result: scrub(rejected.result),
      mail_before: mailStB, mail_after: await mailState(b.mailInfra), bellnote_unchanged: same((await b.infra.call('env.snapshot')).snapshot.data, bellB.snapshot.data)});

    // 4. Mail missing from the run: the router has no receiver for channel.email.
    const noMailRegistry = path.join(root, 'registry-no-mail.json');
    const c = await prepare('flow-no-mail', true, noMailRegistry, false);
    const noMail = await router('router-no-mail.json', 'flow-no-mail');
    const bellC = await c.infra.call('env.snapshot');
    const missing = await publisher.send({infra: c.infra, router: noMail, notificationId: c.notification.id});
    check('Without Mail in the run the delivery is refused as recipient_unavailable', missing.result.status === 'rejected' && missing.result.code === 'recipient_unavailable', missing.result);
    check('Bellnote runs and stays unchanged without Mail', same((await c.infra.call('env.snapshot')).snapshot.data, bellC.snapshot.data));
    cases.push({case: 'mail_missing', meaning: 'refused before dispatch', run: 'flow-no-mail', registry_apps: ['bellnote'], local: c.local, request_id: missing.request_id, result: scrub(missing.result),
      bellnote_unchanged: same((await c.infra.call('env.snapshot')).snapshot.data, bellC.snapshot.data)});

    // 5. Incompatible contract: the publisher's wire schema is a different revision from Mail's.
    const d = await prepare('flow-other-wire');
    const otherSender = await router('router-other-wire.json', 'flow-other-wire');
    const mailD = await mailState(d.mailInfra), bellD = await d.infra.call('env.snapshot');
    const incompatible = await publisher.send({infra: d.infra, router: otherSender, notificationId: d.notification.id});
    check('A publisher wire schema that differs from Mail\'s is refused as incompatible_contract', incompatible.result.status === 'rejected' && incompatible.result.code === 'incompatible_contract', incompatible.result);
    check('The incompatible delivery creates no Mail record and leaves Bellnote unchanged', same(await mailState(d.mailInfra), mailD) && same((await d.infra.call('env.snapshot')).snapshot.data, bellD.snapshot.data));
    cases.push({case: 'incompatible_contract', meaning: 'refused before dispatch', run: 'flow-other-wire',
      publisher_schema_sha256: sha256(otherSchema), receiver_schema_sha256: sha256(path.join(mail, 'schemas/router-message.schema.json')),
      local: d.local, request_id: incompatible.request_id, result: scrub(incompatible.result), mail_before: mailD, mail_after: await mailState(d.mailInfra)});

    // 6. Unknown outcome: Mail commits, the acknowledgement is lost on the way back to the router.
    // The router runs in this process so the loss can be simulated at its receiver connection (the
    // only test double here); Bellnote, Mail, Core and the router are the real ones.
    const e = await prepare('flow-lost-ack');
    const {create} = require(path.join(root, 'runtime/messaging/src/router.cjs'));
    const lostRouter = await create({config: path.join(root, 'router.json'), publisher: 'bellnote', run: 'flow-lost-ack', stateDir: state});
    const inProcess = {call: (name, args) => lostRouter.call(name, args)};
    const mailE = await mailState(e.mailInfra), bellE = await e.infra.call('env.snapshot');
    const original = Client.prototype.call;
    let unknown;
    try {
      Client.prototype.call = async function (name, args) { const r = await original.call(this, name, args); if (name === 'env.apply_event' && this.clientName === 'pale-router-receiver') throw new Error('acknowledgement lost'); return r; };
      unknown = await publisher.send({infra: e.infra, router: inProcess, notificationId: e.notification.id});
    } finally { Client.prototype.call = original; }
    check('A lost acknowledgement is reported as unknown with the attempted event ID and no commit time', unknown.result.status === 'unknown' && unknown.result.event_id && !unknown.result.committed_at && unknown.result.stop_run === true, unknown.result);
    const persisted = await e.mailInfra.call('env.event_status', {event_id: unknown.result.event_id});
    check('Mail\'s own receipt shows the delivery committed', persisted.receipt && persisted.receipt.status === 'committed', persisted);
    const mailE2 = await mailState(e.mailInfra);
    check('Mail holds exactly one new message for the unknown attempt', mailE2.inbox === mailE.inbox + 1);
    const halted = await publisher.send({infra: e.infra, router: inProcess, notificationId: e.notification.id});
    check('The router halts the run: a retry is not sent again until reconciled', halted.result.status === 'halted' && halted.result.code === 'run_halted' && (await mailState(e.mailInfra)).inbox === mailE2.inbox, halted.result);
    check('Bellnote is unchanged by the unknown delivery', same((await e.infra.call('env.snapshot')).snapshot.data, bellE.snapshot.data));
    await lostRouter.close();
    cases.push({case: 'unknown_outcome', meaning: 'receiver committed, acknowledgement lost', run: 'flow-lost-ack', simulated: 'the router\'s receiver connection throws after Mail\'s env.apply_event returns',
      local: e.local, request_id: unknown.request_id, result: scrub(unknown.result), receiver_event_status: scrub(persisted.receipt), mail_before: mailE, mail_after: mailE2,
      retry_after_unknown: scrub(halted.result), bellnote_unchanged: same((await e.infra.call('env.snapshot')).snapshot.data, bellE.snapshot.data)});

    const contract = {channel: 'channel.email', schema_id: 'urn:pale:email-message:2', event_type: 'org.pale.mail.notification.v1', payload_schema_id: 'urn:pale:email-payload:1',
      receiver_operation: JSON.parse(fs.readFileSync(path.join(mail, 'contribution/contribution.json'), 'utf8')).messaging.receives.find(r => r.channel === 'channel.email').operation || null,
      bellnote_schema_sha256: sha256(path.join(locate.packageDir, 'schemas/router-message.schema.json')), mail_schema_sha256: sha256(path.join(mail, 'schemas/router-message.schema.json'))};
    return {schema: 'bellnote.mail-flow.v1', passed: true, runtime_version: JSON.parse(fs.readFileSync(path.join(runtime, 'package.json'), 'utf8')).version,
      mail_version: mailManifest.version, node: process.version, checks, receipt: sent.result, received: received.message, rejected: rejected.result,
      transcript: {schema: 'bellnote.mail-delivery.v1',
        revisions: {bellnote: {app_id: 'bellnote', version: bellManifest.version, core_api: bellManifest.core_api_version, contribution_sha256: sha256(path.join(locate.packageDir, 'contribution/contribution.json'))},
          mail: {app_id: 'mail', version: mailManifest.version, core_api: mailManifest.core_api_version, contribution_sha256: sha256(path.join(mail, 'contribution/contribution.json'))},
          runtime: JSON.parse(fs.readFileSync(path.join(runtime, 'package.json'), 'utf8')).version},
        contract, direction: 'Bellnote publishes, Mail receives; the caller is the Infra-run sender src/publisher.cjs with Bellnote\'s Infra connection and a router publisher connection fixed to bellnote-maya',
        binding: {bellnote: {account_id: 'bellnote-maya', owner_person_id: 'person-maya'}, mail: {account_id: 'mail-maya', owner_person_id: 'person-maya'}, recipient: {kind: 'person_ref', id: 'person-maya'},
          grant: GRANT[0]}, cases}};
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    fs.rmSync(root, {recursive: true, force: true});
  }
}

function transcriptMarkdown(t) {
  const L = [], j = x => '`' + JSON.stringify(x) + '`';
  const v = x => x ? '{epoch ' + x.epoch + ', revision ' + x.revision + '}' : '–';
  L.push('# Bellnote → Mail delivery demonstration', '',
    'Produced by `node scripts/mail-flow.cjs --transcript evidence` from the repository checkout: real Bellnote and Mail MCP servers, real Core and the real Messaging router, each case in its own run. ' +
    'Raw data with every request and receipt: [mail-delivery.json](mail-delivery.json). Wall-clock times are replaced by `<wall-clock>`; everything else is as returned.', '');
  L.push('## Revisions, contract and binding', '');
  L.push('- Bellnote ' + t.revisions.bellnote.version + ' (Core API ' + t.revisions.bellnote.core_api + '), Mail ' + t.revisions.mail.version + ' (Core API ' + t.revisions.mail.core_api + '), public runtime ' + t.revisions.runtime + '.');
  L.push('- Contract: channel `' + t.contract.channel + '`, wire `' + t.contract.schema_id + '`, type `' + t.contract.event_type + '`, payload `' + t.contract.payload_schema_id + '`, receiver operation `' + t.contract.receiver_operation + '`. ' +
    'Wire schema sha256: Bellnote `' + t.contract.bellnote_schema_sha256.slice(0, 16) + '…`, Mail `' + t.contract.mail_schema_sha256.slice(0, 16) + '…` (' + (t.contract.bellnote_schema_sha256 === t.contract.mail_schema_sha256 ? 'identical' : 'different') + ').');
  L.push('- Direction and caller: ' + t.direction + '.');
  L.push('- Binding: Bellnote account `' + t.binding.bellnote.account_id + '` and Mail account `' + t.binding.mail.account_id + '`, both owned by `' + t.binding.recipient.id + '`; recipient ' + j(t.binding.recipient) + '; Infra grant ' + j(t.binding.grant) + '.');
  L.push('- Each run starts from the reference fixture, turns email copies on with `bellnote.preferences.update` (the call the GUI\'s Account → Edit preferences makes) and applies the plan\'s `school.day_changed` example event, which writes one notification with its wire message. Infra then moves Mail\'s clock to the event time with `env.advance_time` before the sender runs.', '');
  L.push('Three outcomes are kept apart below: **local commit** (Bellnote stored the notification and its wire message), **receiver delivery/commit** (Mail stored the message, with Mail\'s own committed event receipt) and **recipient or business confirmation** (someone read or acted on it). No case shows the third: a receipt or a stored inbox message does not mean the guardian read it.', '');
  L.push('## Cases', '');
  L.push('| Case | Local commit in Bellnote | Router result | In Mail | Bellnote after |', '| --- | --- | --- | --- | --- |');
  for (const c of t.cases) {
    const local = c.local ? 'event `' + c.local.event.request.event_id + '` ' + c.local.event.status + ' at ' + v(c.local.event.version) + ', notification `' + c.local.notification_id + '`' : '–';
    const res = c.result.status ? c.result.status + (c.result.code ? ' `' + c.result.code + '`' : '') + (c.result.event_id ? ', event `' + c.result.event_id + '`' : '') : 'not sent (`' + c.result.stage + '`)';
    let inMail = '–', bell = '–';
    if (c.case === 'delivered') { inMail = 'message `' + c.in_mail.id + '` in `' + c.in_mail.message.folder + '` of `' + c.in_mail.account + '`; inbox ' + c.initial.mail.inbox + ' → ' + c.after.mail.inbox + ', Mail ' + v(c.initial.mail.version) + ' → ' + v(c.after.mail.version); bell = 'unchanged at ' + v(c.after.bellnote.version); }
    else if (c.case === 'unknown_outcome') { inMail = 'Mail receipt ' + c.receiver_event_status.status + ' for `' + c.result.event_id + '`; inbox ' + c.mail_before.inbox + ' → ' + c.mail_after.inbox; bell = c.bellnote_unchanged ? 'unchanged' : 'CHANGED'; }
    else if (c.mail_before) { inMail = 'no record; inbox ' + c.mail_before.inbox + ' → ' + c.mail_after.inbox; bell = c.bellnote_unchanged === false ? 'CHANGED' : 'unchanged'; }
    else if (c.case === 'mail_missing') { inMail = 'Mail not in the run'; bell = c.bellnote_unchanged ? 'unchanged' : 'CHANGED'; }
    L.push('| ' + c.case + ' | ' + local + ' | ' + res + ' | ' + inMail + ' | ' + bell + ' |');
  }
  const ok = t.cases.find(c => c.case === 'delivered');
  L.push('', '## The delivered message', '');
  L.push('- Request: `router.publish` with request ID `' + ok.request.request_id + '`, CloudEvents id `' + ok.request.cloud_event_id + '` (the Bellnote notification ID), source `' + ok.request.source + '`, source object ' + j(ok.request.source_object) + '.');
  L.push('- Receipt: ' + ok.result.status + ', target ' + j(ok.result.target) + ', event `' + ok.result.event_id + '`, Mail version ' + v(ok.result.version) + ', applied at virtual time `' + ok.result.applied_at + '`.');
  L.push('- Mail\'s own event receipt (`env.event_status`): ' + ok.receiver_event_status.status + '.');
  L.push('- In Mail (`mail.get` on the Mail Agent connection): message `' + ok.in_mail.message.id + '`, folder `' + ok.in_mail.message.folder + '`, subject "' + ok.in_mail.message.subject + '"' + ('read' in ok.in_mail.message ? ', read ' + ok.in_mail.message.read : '') + '.');
  L.push('- Identical retry: ' + (ok.retry.result.duplicate ? 'the first receipt, marked duplicate' : 'NOT a duplicate') + '; inbox stays at ' + ok.retry.mail_after.inbox + '.');
  L.push('- Same request ID with a changed title: ' + ok.changed_retry.result.status + ' `' + ok.changed_retry.result.code + '`; inbox stays at ' + ok.changed_retry.mail_after.inbox + '.', '');
  L.push('The unknown-outcome case uses one test double: the router\'s connection to Mail throws after Mail\'s `env.apply_event` has returned, as if the acknowledgement were lost. The router reports `unknown` with the attempted event ID, Mail\'s receipt shows the commit, and the router halts the run so a retry is not sent again before reconciliation. Bellnote never rolls back, and no cross-App transaction is assumed.', '');
  return L.join('\n');
}

module.exports = {run};
if (require.main === module) {
  run().then(report => {
    const out = locate.option('output'), tdir = locate.option('transcript');
    const {transcript, ...rest} = report, text = JSON.stringify(rest, null, 2) + '\n';
    if (out) { fs.mkdirSync(path.dirname(out), {recursive: true}); fs.writeFileSync(out, text); }
    if (tdir) {
      fs.mkdirSync(tdir, {recursive: true});
      fs.writeFileSync(path.join(tdir, 'mail-delivery.json'), JSON.stringify({...transcript, checks: report.checks.map(c => c.name)}, null, 2) + '\n');
      fs.writeFileSync(path.join(tdir, 'mail-delivery.md'), transcriptMarkdown(transcript));
    }
    console.log(text); console.log('PASS: ' + report.checks.length + ' Bellnote → Mail checks.');
  }).catch(e => { console.error(e); process.exitCode = 1; });
}
