#!/usr/bin/env node
'use strict';
// Host-side publisher: delivers Crossway's outgoing notices to real Mail 1.3.0
// through the public Messaging router, the way a run's Infra would.
//
// When it runs: right after each Crossway write or event that can create
// notices, and before the next env.advance_time. Crossway commits time effects
// only at the next write or event, so a deadline's notice appears in the
// outgoing records of the first write or event after the deadline.
//
// Which notices are new: Crossway does not record delivery. The publisher keeps
// its own cursor, the outgoing IDs it has already handled in the current
// Crossway epoch. IDs in the loaded snapshot count as history; after each write
// or event it publishes, in array order, every outgoing record whose ID is not
// in the cursor. A Crossway reset or seed load starts a new epoch and restarts
// IDs at cw-notice-0001, so the publisher refuses to continue in the same
// Messaging run (a reused CloudEvents id with new content would be rejected).
//
// It shows three outcomes: a delivery rejected for a missing grant (Mail and
// Crossway unchanged), a committed delivery read back with Mail's mail.get, and
// a retry with the same CloudEvents id (deduplicated, still one Mail message).
// Run from the repository root: node apps/crossway/examples/publish-to-mail.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const {prepare} = require(path.join(root, 'runtime/prepare.cjs'));
const {Client} = require(path.join(root, 'runtime/client.cjs'));

const RUN = 'crossway-mail';
const MAIL_REGISTRY = path.join(root, 'examples/registry.mail.json');
const MAIL = object_id => ({app_id: 'mail', account_id: 'mail-dani', object_id});

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-crossway-mail-'));
  const prepared = prepare(path.join(root, 'apps/crossway'));
  const clients = [];
  const open = async (app, role, registry, name) => {
    const c = new Client(app, role, RUN, dir, name, {registry});
    clients.push(c); await c.initialize(); return c;
  };
  const router = async config => {
    const c = new Client(null, null, null, null, 'crossway-publisher', {commandArgs: [path.join(root, 'runtime/messaging/service.cjs'),
      '--config', path.join(__dirname, 'messaging', config), '--publisher', 'crossway', '--run', RUN, '--state-dir', dir]});
    clients.push(c); await c.initialize(); return c;
  };
  const report = {passed: false, run: RUN, rejected: null, committed: [], duplicate: null};
  try {
    // Crossway: reset into the full profile. Mail: load Dani's mailbox at Crossway's clock.
    const cwInfra = await open('crossway', 'infra', prepared.registry, 'crossway-infra');
    const cwAgent = await open('crossway', 'agent', prepared.registry, 'crossway-agent');
    let cw = await cwInfra.call('env.snapshot');
    await cwInfra.call('env.reset', {expected_version: cw.version, profile: 'full'});
    cw = await cwInfra.call('env.snapshot');
    const mailInfra = await open('mail', 'infra', MAIL_REGISTRY, 'mail-infra');
    const mailAgent = await open('mail', 'agent', MAIL_REGISTRY, 'mail-agent');
    const mailSeed = JSON.parse(fs.readFileSync(path.join(__dirname, 'messaging/mail-seed.json'), 'utf8'));
    let mail = await mailInfra.call('env.snapshot');
    const loaded = await mailInfra.call('env.load_seed', {expected_version: mail.version, request_id: 'mail-dani-seed',
      data: mailSeed.data, binding: mailSeed.binding, policies: mail.snapshot.policies, virtual_now: cw.snapshot.virtual_now});
    assert.equal(loaded.status, 'ready', JSON.stringify(loaded));

    // The publisher's cursor: outgoing IDs already handled in this Crossway epoch.
    const epoch = cw.version.epoch, handled = new Set(cw.snapshot.data.outgoing.map(o => o.id));
    const fresh = async () => {
      const s = await cwInfra.call('env.snapshot');
      if (s.version.epoch !== epoch) throw Error('Crossway was reset or reloaded; start a new Messaging run.');
      return s.snapshot.data.outgoing.filter(o => !handled.has(o.id));
    };
    // Infra barrier: Mail's clock follows Crossway's before delivery.
    const syncMail = async () => {
      const t = (await cwInfra.call('env.snapshot')).snapshot.virtual_now, m = await mailInfra.call('env.snapshot');
      const out = await mailInfra.call('env.advance_time', {expected_version: m.version, virtual_now: t, request_id: 'mail-clock-' + t});
      assert.equal(out.status, 'committed');
    };
    let cwVersion = cw.version, n = 0;
    const write = async (name, args) => {
      const out = await cwAgent.call('crossway.' + name, {expected_version: cwVersion, request_id: 'pub-' + (++n), ...args});
      assert.equal(out.status, 'committed', name + ': ' + JSON.stringify(out));
      cwVersion = out.version; return out;
    };

    // 1. A write that creates a notice: Dani disputes n-0017, citing the Mail message about the sale.
    const p = (await write('disputes.preview', {notice_id: 'n-0017', reason: 'sold_or_not_in_possession', transfer_date: '2026-09-28', evidence: [MAIL('m-11133')]})).preview;
    await write('disputes.confirm', {preview_id: p.id});
    const first = await fresh();
    assert.deepEqual(first.map(o => o.kind), ['dispute_received']);

    // 2. Rejected: the router's trusted config lacks the Mail grant. Mail and Crossway stay unchanged.
    const mailBefore = await mailInfra.call('env.snapshot'), cwBefore = await cwInfra.call('env.snapshot');
    const noGrant = await router('config.no-grant.json');
    const rejected = await noGrant.call('router.publish', {request_id: 'rejected-' + first[0].id, message: first[0].message});
    assert.deepEqual([rejected.status, rejected.code], ['rejected', 'recipient_not_authorized']);
    const mailAfter = await mailInfra.call('env.snapshot'), cwAfter = await cwInfra.call('env.snapshot');
    assert.deepEqual(mailAfter.snapshot.data, mailBefore.snapshot.data);
    assert.deepEqual(mailAfter.version, mailBefore.version);
    assert.deepEqual(cwAfter.snapshot.data, cwBefore.snapshot.data);
    await noGrant.close();
    report.rejected = {notice: first[0].id, status: rejected.status, code: rejected.code, mail_messages: mailAfter.snapshot.data.messages.length, crossway_unchanged: true};

    // 3. Committed with the grant, read back through Mail's own tool; then a retry with the same CloudEvents id.
    const publisher = await router('config.json');
    const deliver = async o => {
      const receipt = await publisher.call('router.publish', {request_id: 'publish-' + o.id, message: o.message});
      assert.equal(receipt.status, 'committed', JSON.stringify(receipt));
      const got = await mailAgent.call('mail.get', {id: receipt.event_id});
      assert.equal(got.status, 'ok');
      assert.equal(got.message.subject, o.message.data.content.title);
      assert.equal(got.message.body, o.message.data.content.body.text);
      handled.add(o.id);
      report.committed.push({notice: o.id, kind: o.kind, time: o.message.time, mail_message_id: receipt.event_id, subject: got.message.subject});
      return receipt;
    };
    const receipt = await deliver(first[0]);
    const retry = await publisher.call('router.publish', {request_id: 'retry-' + first[0].id, message: first[0].message});
    assert.equal(retry.duplicate, true);
    assert.equal(retry.event_id, receipt.event_id);
    const afterRetry = (await mailInfra.call('env.snapshot')).snapshot.data.messages;
    assert.equal(afterRetry.filter(m => m.id === receipt.event_id).length, 1);
    report.duplicate = {notice: first[0].id, duplicate: retry.duplicate, same_mail_message: retry.event_id === receipt.event_id, mail_messages: afterRetry.length};

    // 4. Time: env.advance_time past three deadlines creates nothing by itself...
    cw = await cwInfra.call('env.snapshot');
    await cwInfra.call('env.advance_time', {expected_version: cw.version, virtual_now: '2026-11-06T08:00:00-05:00', request_id: 'cw-clock-1'});
    assert.equal((await fresh()).length, 0);
    // ...the next event commits them, each dated at its deadline, then its own notice.
    cw = await cwInfra.call('env.snapshot');
    const event = {event_id: 'ev-0031', at: '2026-11-06T08:00:00-05:00', operation: 'crossway.toll.posted',
      payload: {toll_id: 't-0931', plaza_id: 'pz-millrace', read: 'plate', plate: 'KLM2210', transponder_id: null, class: 1}};
    assert.equal((await cwInfra.call('env.apply_event', {expected_version: cw.version, event})).status, 'committed');
    const batch = await fresh();
    assert.deepEqual(batch.map(o => [o.kind, o.object_id]), [['notice_escalated', 'n-0015'], ['notice_collections', 'n-0012'], ['notice_escalated', 'n-0016'], ['notice_issued', 'n-0019']]);
    await syncMail();
    for (const o of batch) await deliver(o);

    // 5. The dispute decision, granted on the cited Mail message, reaches Mail as well.
    cw = await cwInfra.call('env.snapshot');
    const decided = {event_id: 'ev-0032', at: '2026-11-20T10:00:00-05:00', operation: 'crossway.dispute.decided',
      payload: {notice_id: 'n-0017', grant_if: [{reason: 'sold_or_not_in_possession', evidence: [MAIL('m-11133')]}]}};
    assert.equal((await cwInfra.call('env.apply_event', {expected_version: cw.version, event: decided})).status, 'committed');
    const decision = (await fresh()).filter(o => o.kind === 'dispute_decided');
    await syncMail();
    for (const o of await fresh()) await deliver(o);
    assert.equal(decision.length, 1);
    const evidence = await mailAgent.call('mail.get', {id: 'm-11133'});
    assert.equal(evidence.status, 'ok');

    const final = (await mailInfra.call('env.snapshot')).snapshot.data.messages;
    assert.equal(final.length, mailSeed.data.messages.length + report.committed.length);
    report.mail_messages = final.length;
    report.evidence_join = {crossway_dispute: 'n-0017', mail_message: evidence.message.id, subject: evidence.message.subject};
    report.passed = true;
    console.log(JSON.stringify(report, null, 2));
    console.log(`PASS: 1 rejected (missing grant), ${report.committed.length} committed and read back with mail.get, 1 deduplicated retry.`);
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
    fs.rmSync(dir, {recursive: true, force: true});
  }
}
main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
