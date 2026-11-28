#!/usr/bin/env node
'use strict';
// Host-side publisher: delivers Stoopside's outgoing notices to the user's Mail
// through the public Messaging service, and reads each one back with Mail's
// own mail.get. Run from a full checkout:
//   node apps/stoopside/examples/publish-to-mail.cjs
//
// When it runs: after each committed Stoopside write or env.apply_event that
// creates a notice, and before Infra's next env.advance_time. Stoopside does
// not record delivery, so the publisher keeps its own list of published notice
// IDs for the run: a notice is new when its ID is not on that list. Notice IDs
// are counters in data.notices, which is append-only between resets.
//
// The run below shows three outcomes on real MCP connections:
//   1. rejected: the trusted config has no grant for the user's Mail account;
//      Mail and Stoopside are unchanged;
//   2. committed: with the grant, the waitlist offer and then the claim receipt
//      arrive in Mail and read back with the same text;
//   3. retried: publishing the same CloudEvents id again is deduplicated; Mail
//      still holds one message for it;
//   4. unknown: Mail commits the next notice but the Router cannot record its
//      acknowledgement, so router.publish answers status unknown and stops the
//      run. The publisher stops publishing, does not mark the notice as
//      delivered, and reconciles by reading Mail with mail.get. The fault is
//      staged from outside the runtime: the Router's receipt log in its state
//      directory is replaced by a directory, so its append fails after the
//      receiver commit (runtime/messaging/src/router.cjs, receipt_audit_failed).
//      Nothing under runtime/ is changed.
//
// Requires the repository-level examples/registry.mail.json (Mail 1.3.0 at
// examples/apps/mail): the Router's trusted config names it, and the Mail
// clients use it.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const app = path.resolve(__dirname, '..');
const root = path.resolve(app, '../..');
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const {prepare} = require(path.join(root, 'runtime/prepare.cjs'));
const CONFIG = path.join(__dirname, 'publish-to-mail.config.json');
const MAIL_REGISTRY = path.join(root, 'examples/registry.mail.json');

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const sha = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');

// The user's Mail account, bound to the same person as the Stoopside account.
function mailSeed(clock) {
  const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
  const dataset = read('examples/apps/mail/contribution/dataset.json');
  dataset.dataset_id = 'stoopside-mail-publisher';
  dataset.description = 'Empty synthetic mailbox for the Stoopside publisher example';
  dataset.expected_counts = {records: 0, assets: 0};
  return {
    data: {account_id: 'mail-dana', owner_person_id: 'person-dana-okafor', address: 'dana.okafor@example.net', messages: []},
    binding: {people: [{person_id: 'person-dana-okafor', name: 'Dana Okafor'}],
      accounts: [{app_id: 'mail', account_id: 'mail-dana', owner_person_id: 'person-dana-okafor'}], objects: {}},
    policies: read('examples/apps/mail/fixtures/policies.json'),
    bundle: {dataset, catalog: {schema_version: 'pale.asset-catalog.v1', catalog_id: 'stoopside-mail-empty', app_id: 'mail', dataset_ref: 'dataset.json', assets: [], extensions: []}, blobs: {}},
    virtual_now: clock,
  };
}

async function run() {
  const runId = 'stoopside-mail-' + crypto.randomUUID().slice(0, 8);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-stoopside-mail-')), clients = [];
  const prepared = prepare(app);
  const open = async (appId, role, stateDir, registry) => {
    const c = new Client(appId, role, runId, stateDir, 'stoopside-publisher-' + appId + '-' + role, {registry});
    clients.push(c); await c.initialize(); return c;
  };
  const router = async (config, name) => {
    const c = new Client(null, null, null, null, 'stoopside-publisher-' + name,
      {commandArgs: [path.join(root, 'runtime/messaging/service.cjs'), '--config', config, '--publisher', 'stoopside', '--run', runId, '--state-dir', dir]});
    clients.push(c); await c.initialize(); return c;
  };
  try {
    // Stoopside (Core) and the user's Mail (Core), one run, separate state.
    const stoopInfra = await open('stoopside', 'infra', path.join(dir, 'stoopside'), prepared.registry);
    const stoopAgent = await open('stoopside', 'agent', path.join(dir, 'stoopside'), prepared.registry);
    let s = await stoopInfra.call('env.snapshot');
    assert.equal((await stoopInfra.call('env.reset', {expected_version: s.version, profile: 'full'})).status, 'ready');
    const mailInfra = await open('mail', 'infra', dir, MAIL_REGISTRY), mailAgent = await open('mail', 'agent', dir, MAIL_REGISTRY);
    const m0 = await mailInfra.call('env.snapshot');
    const loaded = await mailInfra.call('env.load_seed', {expected_version: m0.version, request_id: 'stoopside-mailbox', ...mailSeed((await stoopInfra.call('env.snapshot')).snapshot.virtual_now)});
    assert.equal(loaded.status, 'ready', JSON.stringify(loaded));

    const published = new Set();   // the publisher's own delivery list
    const newNotices = snapshot => snapshot.data.notices.filter(n => !published.has(n.id));
    // Infra keeps Mail's clock in step with Stoopside's before delivering.
    const syncMail = async clock => {
      const m = await mailInfra.call('env.snapshot');
      if (Date.parse(clock) <= Date.parse(m.snapshot.virtual_now)) return;
      const moved = await mailInfra.call('env.advance_time', {expected_version: m.version, request_id: 'sync-' + clock, virtual_now: clock});
      assert.equal(moved.status, 'committed');
    };
    const publish = async (via, notice, requestId) => via.call('router.publish', {request_id: requestId, message: notice.message});

    // An event creates a notice: m-009 drops out of the full potluck and the user is offered a place.
    s = await stoopInfra.call('env.snapshot');
    const applied = await stoopInfra.call('env.apply_event', {expected_version: s.version, event: require('./scenario.json')});
    assert.equal(applied.status, 'committed');
    let stoop = (await stoopInfra.call('env.snapshot')).snapshot;
    const [offer] = newNotices(stoop);
    assert.equal(offer.kind, 'waitlist_offer');
    await syncMail(stoop.virtual_now);

    // 1. Rejected: the same run, staged with no grant for mail-dana.
    const noGrant = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    noGrant.publishers[0].allowed_recipients = [];
    const noGrantFile = path.join(dir, 'no-grant.json');
    fs.writeFileSync(noGrantFile, JSON.stringify(noGrant));
    const mailBefore = await mailInfra.call('env.snapshot'), stoopBefore = await stoopInfra.call('env.snapshot');
    const denied = await publish(await router(noGrantFile, 'no-grant'), offer, 'offer-no-grant');
    const mailAfter = await mailInfra.call('env.snapshot'), stoopAfter = await stoopInfra.call('env.snapshot');
    assert.equal(denied.status, 'rejected');
    assert.equal(denied.code, 'recipient_not_authorized');
    assert.deepEqual(mailAfter.snapshot.data, mailBefore.snapshot.data);
    assert.deepEqual(mailAfter.version, mailBefore.version);
    assert.equal(sha(stoopAfter.snapshot.data), sha(stoopBefore.snapshot.data));
    assert.ok(!published.has(offer.id));

    // 2. Committed: the granted config delivers the offer; read it back through Mail.
    const granted = await router(CONFIG, 'granted');
    const offerReceipt = await publish(granted, offer, 'offer-1');
    assert.equal(offerReceipt.status, 'committed', JSON.stringify(offerReceipt));
    published.add(offer.id);
    const offerMail = (await mailAgent.call('mail.get', {id: offerReceipt.event_id})).message;
    assert.equal(offerMail.subject, offer.message.data.content.title);
    assert.equal(offerMail.body, offer.message.data.content.body.text);
    assert.equal(offerMail.thread_id, offer.id);

    // The Agent reads the offer from Mail, then claims one place in Stoopside the next morning.
    s = await stoopInfra.call('env.snapshot');
    const moved = await stoopInfra.call('env.advance_time', {expected_version: s.version, request_id: 'morning', virtual_now: '2027-03-06T09:00:00-05:00'});
    assert.equal(moved.status, 'committed');
    const rsvpId = /RSVP: (r-\d+)/.exec(offerMail.body)[1], claimBy = /Claim by: (.+)/.exec(offerMail.body)[1];
    const preview = await stoopAgent.call('stoopside.rsvps.preview', {expected_version: moved.version, request_id: 'claim-preview',
      event_id: 'e-0117', answer: 'yes', guests: 0, children: 0});
    assert.equal(preview.preview.outcome, 'claim');
    const claim = await stoopAgent.call('stoopside.rsvps.confirm', {expected_version: preview.version, request_id: 'claim-confirm', preview_id: preview.preview.id});
    assert.equal(claim.status, 'committed');
    assert.equal(claim.rsvp.id, rsvpId);
    stoop = (await stoopInfra.call('env.snapshot')).snapshot;
    const fresh = newNotices(stoop);
    assert.deepEqual(fresh.map(n => n.kind), ['rsvp_receipt']);
    await syncMail(stoop.virtual_now);
    const receipt = await publish(granted, fresh[0], 'receipt-1');
    assert.equal(receipt.status, 'committed');
    published.add(fresh[0].id);
    const receiptMail = (await mailAgent.call('mail.get', {id: receipt.event_id})).message;
    const rsvp = stoop.data.rsvps.find(r => r.id === rsvpId);
    assert.match(receiptMail.body, new RegExp(`RSVP: ${rsvp.id}`));
    assert.match(receiptMail.body, new RegExp(`Guests: ${rsvp.guests}\\nChildren: ${rsvp.children}\\nPlaces: 1`));
    assert.match(receiptMail.body, /Start: 2027-03-13T12:00:00-05:00/);
    assert.equal(receiptMail.received_at, stoop.virtual_now);

    // 3. Retried: the same CloudEvents id under a new request ID is deduplicated.
    const retry = await publish(granted, fresh[0], 'receipt-retry');
    assert.equal(retry.duplicate, true);
    assert.equal(retry.event_id, receipt.event_id);
    const mailbox = (await mailInfra.call('env.snapshot')).snapshot.data.messages;
    assert.equal(mailbox.filter(m => m.thread_id === fresh[0].id).length, 1);
    assert.equal(mailbox.length, 2);
    assert.equal(newNotices(stoop).length, 0);

    // 4. Unknown acknowledgement: the user RSVPs to the spring fling (explicit counts), which creates a receipt notice.
    s = await stoopInfra.call('env.snapshot');
    const fling = await stoopAgent.call('stoopside.rsvps.preview', {expected_version: s.version, request_id: 'fling-preview',
      event_id: 'e-0121', answer: 'yes', guests: 0, children: 0});
    assert.equal(fling.status, 'committed', JSON.stringify(fling));
    const flingConfirm = await stoopAgent.call('stoopside.rsvps.confirm', {expected_version: fling.version, request_id: 'fling-confirm', preview_id: fling.preview.id});
    assert.equal(flingConfirm.status, 'committed');
    stoop = (await stoopInfra.call('env.snapshot')).snapshot;
    const [flingNotice] = newNotices(stoop);
    assert.equal(flingNotice.kind, 'rsvp_receipt');
    await syncMail(stoop.virtual_now);
    const log = path.join(dir, runId, 'messaging.receipts.jsonl');
    fs.renameSync(log, log + '.saved');
    fs.mkdirSync(log);   // staged fault: the Router's acknowledgement cannot be recorded
    const mailBeforeUnknown = (await mailInfra.call('env.snapshot')).snapshot.data.messages.length;
    const unknown = await publish(granted, flingNotice, 'fling-receipt-1');
    assert.equal(unknown.status, 'unknown', JSON.stringify(unknown));
    assert.equal(unknown.code, 'receipt_audit_failed');
    assert.equal(unknown.stop_run, true);
    assert.ok(unknown.event_id, 'the unknown result names the attempted receiver event');
    fs.rmdirSync(log);
    fs.renameSync(log + '.saved', log);   // the fault is over; the run stays stopped
    // The run stops: the publisher does not mark the notice delivered, and the Router refuses any further publish in this run.
    assert.ok(!published.has(flingNotice.id));
    const afterStop = await publish(granted, flingNotice, 'fling-receipt-2');
    assert.deepEqual([afterStop.status, afterStop.code], ['halted', 'run_halted']);
    // Reconciliation: inspect the receiver. Mail did commit the message once; Stoopside keeps its business result and notice.
    const reconciled = await mailAgent.call('mail.get', {id: unknown.event_id});
    assert.equal(reconciled.status, 'ok');
    assert.equal(reconciled.message.thread_id, flingNotice.id);
    const mailAfterUnknown = (await mailInfra.call('env.snapshot')).snapshot.data.messages;
    assert.equal(mailAfterUnknown.length, mailBeforeUnknown + 1);
    assert.equal(mailAfterUnknown.filter(m => m.thread_id === flingNotice.id).length, 1);
    const flingRsvp = (await stoopInfra.call('env.snapshot')).snapshot.data.rsvps.find(r => r.event_id === 'e-0121' && r.member_id === 'm-001');
    assert.equal(flingRsvp.answer, 'yes');

    return {
      passed: true, run_id: runId,
      rejected: {status: denied.status, code: denied.code, mail_unchanged: true, stoopside_unchanged: true},
      committed: [
        {notice_id: offer.id, kind: offer.kind, event_id: offerReceipt.event_id, mail_subject: offerMail.subject, claim_by: claimBy},
        {notice_id: fresh[0].id, kind: fresh[0].kind, event_id: receipt.event_id, mail_subject: receiptMail.subject, rsvp: {id: rsvp.id, answer: rsvp.answer, places: 1}},
      ],
      retried: {duplicate: retry.duplicate, event_id: retry.event_id, mail_messages_for_notice: 1},
      unknown: {notice_id: flingNotice.id, kind: flingNotice.kind, status: unknown.status, code: unknown.code, stop_run: unknown.stop_run,
        event_id: unknown.event_id, next_publish: afterStop.status + '/' + afterStop.code,
        reconciliation: {mail_get: reconciled.status, mail_message_id: reconciled.message.id, mail_messages_for_notice: 1,
          stoopside_rsvp: flingRsvp.id + ' ' + flingRsvp.answer, marked_delivered_by_publisher: false, run_scored: false}},
      mailbox_messages: mailAfterUnknown.length,
    };
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

module.exports = {run};
if (require.main === module) {
  run().then(report => {
    console.log(JSON.stringify(report, null, 2));
    console.log('PASS: rejected without a grant, committed and read back through Mail, retry deduplicated, unknown acknowledgement stopped the run and was reconciled through mail.get.');
  }).catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
}
