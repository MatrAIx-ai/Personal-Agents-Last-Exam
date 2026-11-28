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
// What it shows, in four parts:
//   1. Dani: a delivery rejected for a missing grant (Mail and Crossway
//      unchanged), committed deliveries read back with Mail's mail.get, and a
//      retry with the same CloudEvents id (deduplicated, still one Mail message).
//   2. Unknown acknowledgement: Mail commits but the acknowledgement is lost.
//      The router returns `unknown` and halts the run; the publisher stops,
//      reconciles from Mail's own evidence (env.event_status, mail.get) and
//      marks the run not scored. Staged in this process by making the router's
//      receiver client throw after Mail's commit, as runtime/messaging's own
//      test does; nothing under runtime/ is changed.
//   3. One publisher run per seed (dani, marisol, theo, priya), each with that
//      holder's Mail seed: the reference actions and the example schedule run
//      in time order, every new notice is delivered and read back, and every
//      Mail message a dispute on the account cites as evidence is read from
//      that holder's Mail, so the evaluator's evidence join works for all four.
//
// Required public dependencies, besides this package and the pinned runtime:
// the repository's Mail package (examples/apps/mail) and its registry
// examples/registry.mail.json, which the Messaging configs in
// examples/messaging/ name. The script checks for both before starting.
// Run from the repository root: node apps/crossway/examples/publish-to-mail.cjs [--evidence]
// (--evidence also writes the report to apps/crossway/evidence/publish-to-mail.json)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');

const MAIL_REGISTRY = path.join(root, 'examples/registry.mail.json');
const MAIL_PACKAGE = path.join(root, 'examples/apps/mail/app.json');
for (const [file, what] of [[MAIL_REGISTRY, 'the Mail registry examples/registry.mail.json'], [MAIL_PACKAGE, 'the Mail 1.3.0 package examples/apps/mail']]) {
  if (!fs.existsSync(file)) {
    console.error(`Missing required public dependency: ${what} (expected at ${path.relative(process.cwd(), file)}). ` +
      'Run this script from a full checkout of the repository, or copy that file into the same place.');
    process.exit(1);
  }
}

const {prepare} = require(path.join(root, 'runtime/prepare.cjs'));
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const {create: createRouter} = require(path.join(root, 'runtime/messaging/src/router.cjs'));
const {loadSeed, session, ACTIONS, SEEDS, seedFiles} = require('../tests/platform-lib.cjs');

const MESSAGING = path.join(__dirname, 'messaging');
const CONFIG = {dani: 'config.json', marisol: 'config.marisol.json', theo: 'config.theo.json', priya: 'config.priya.json'};
const MAIL_SEED = {dani: 'mail-seed.json', marisol: 'mail-seed.marisol.json', theo: 'mail-seed.theo.json', priya: 'mail-seed.priya.json'};
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

// The pieces every part uses: Crossway and Mail clients in one run, Mail
// loaded with the holder's mailbox at Crossway's clock, the cursor and the
// Infra clock barrier.
async function stage({dir, prepared, run, seed, clients}) {
  const open = async (app, role, registry, name) => {
    const c = new Client(app, role, run, dir, name, {registry});
    clients.push(c); await c.initialize(); return c;
  };
  const cwInfra = await open('crossway', 'infra', prepared.registry, 'crossway-infra');
  const cwAgent = await open('crossway', 'agent', prepared.registry, 'crossway-agent');
  await loadSeed(cwInfra, seed, 'full');
  const cw = await cwInfra.call('env.snapshot');
  const mailInfra = await open('mail', 'infra', MAIL_REGISTRY, 'mail-infra');
  const mailAgent = await open('mail', 'agent', MAIL_REGISTRY, 'mail-agent');
  const mailSeed = readJson(path.join(MESSAGING, MAIL_SEED[seed]));
  const mail = await mailInfra.call('env.snapshot');
  const loaded = await mailInfra.call('env.load_seed', {expected_version: mail.version, request_id: `mail-${seed}-seed`,
    data: mailSeed.data, binding: mailSeed.binding, policies: mail.snapshot.policies, virtual_now: cw.snapshot.virtual_now});
  assert.equal(loaded.status, 'ready', JSON.stringify(loaded));
  const epoch = cw.version.epoch, handled = new Set(cw.snapshot.data.outgoing.map(o => o.id));
  const fresh = async () => {
    const s = await cwInfra.call('env.snapshot');
    if (s.version.epoch !== epoch) throw Error('Crossway was reset or reloaded; start a new Messaging run.');
    return s.snapshot.data.outgoing.filter(o => !handled.has(o.id));
  };
  const syncMail = async () => {
    const t = (await cwInfra.call('env.snapshot')).snapshot.virtual_now, m = await mailInfra.call('env.snapshot');
    const out = await mailInfra.call('env.advance_time', {expected_version: m.version, virtual_now: t, request_id: 'mail-clock-' + t});
    assert.equal(out.status, 'committed');
  };
  const router = async config => {
    const c = new Client(null, null, null, null, 'crossway-publisher', {commandArgs: [path.join(root, 'runtime/messaging/service.cjs'),
      '--config', path.join(MESSAGING, config), '--publisher', 'crossway', '--run', run, '--state-dir', dir]});
    clients.push(c); await c.initialize(); return c;
  };
  return {cwInfra, cwAgent, mailInfra, mailAgent, mailSeed, handled, fresh, syncMail, router};
}

// Publishes one notice, reads it back from Mail with mail.get, and records it.
async function deliver(st, publisher, o, log) {
  const receipt = await publisher.call('router.publish', {request_id: 'publish-' + o.id, message: o.message});
  assert.equal(receipt.status, 'committed', JSON.stringify(receipt));
  const got = await st.mailAgent.call('mail.get', {id: receipt.event_id});
  assert.equal(got.status, 'ok');
  assert.equal(got.message.subject, o.message.data.content.title);
  assert.equal(got.message.body, o.message.data.content.body.text);
  st.handled.add(o.id);
  log.push({notice: o.id, kind: o.kind, time: o.message.time, mail_message_id: receipt.event_id, subject: got.message.subject});
  return receipt;
}

// ---- Part 1: Dani, rejected, committed and duplicate ----------------------------

async function daniDemo(base) {
  const report = {run: 'crossway-mail', rejected: null, committed: [], duplicate: null};
  const st = await stage({...base, run: 'crossway-mail', seed: 'dani'});
  const MAIL = object_id => ({app_id: 'mail', account_id: 'mail-dani', object_id});
  let cwVersion = (await st.cwInfra.call('env.snapshot')).version, n = 0;
  const write = async (name, args) => {
    const out = await st.cwAgent.call('crossway.' + name, {expected_version: cwVersion, request_id: 'pub-' + (++n), ...args});
    assert.equal(out.status, 'committed', name + ': ' + JSON.stringify(out));
    cwVersion = out.version; return out;
  };

  // 1. A write that creates a notice: Dani disputes n-0017, citing the Mail message about the sale.
  const p = (await write('disputes.preview', {notice_id: 'n-0017', reason: 'sold_or_not_in_possession', transfer_date: '2026-09-28', evidence: [MAIL('m-11133')]})).preview;
  await write('disputes.confirm', {preview_id: p.id});
  const first = await st.fresh();
  assert.deepEqual(first.map(o => o.kind), ['dispute_received']);

  // 2. Rejected: the router's trusted config lacks the Mail grant. Mail and Crossway stay unchanged.
  const mailBefore = await st.mailInfra.call('env.snapshot'), cwBefore = await st.cwInfra.call('env.snapshot');
  const noGrant = await st.router('config.no-grant.json');
  const rejected = await noGrant.call('router.publish', {request_id: 'rejected-' + first[0].id, message: first[0].message});
  assert.deepEqual([rejected.status, rejected.code], ['rejected', 'recipient_not_authorized']);
  const mailAfter = await st.mailInfra.call('env.snapshot'), cwAfter = await st.cwInfra.call('env.snapshot');
  assert.deepEqual(mailAfter.snapshot.data, mailBefore.snapshot.data);
  assert.deepEqual(mailAfter.version, mailBefore.version);
  assert.deepEqual(cwAfter.snapshot.data, cwBefore.snapshot.data);
  await noGrant.close();
  report.rejected = {notice: first[0].id, status: rejected.status, code: rejected.code, mail_messages: mailAfter.snapshot.data.messages.length, crossway_unchanged: true};

  // 3. Committed with the grant, read back through Mail's own tool; then a retry with the same CloudEvents id.
  const publisher = await st.router('config.json');
  const receipt = await deliver(st, publisher, first[0], report.committed);
  const retry = await publisher.call('router.publish', {request_id: 'retry-' + first[0].id, message: first[0].message});
  assert.equal(retry.duplicate, true);
  assert.equal(retry.event_id, receipt.event_id);
  const afterRetry = (await st.mailInfra.call('env.snapshot')).snapshot.data.messages;
  assert.equal(afterRetry.filter(m => m.id === receipt.event_id).length, 1);
  report.duplicate = {notice: first[0].id, duplicate: retry.duplicate, same_mail_message: retry.event_id === receipt.event_id, mail_messages: afterRetry.length};

  // 4. Time: env.advance_time past three deadlines creates nothing by itself...
  let cw = await st.cwInfra.call('env.snapshot');
  await st.cwInfra.call('env.advance_time', {expected_version: cw.version, virtual_now: '2026-11-06T08:00:00-05:00', request_id: 'cw-clock-1'});
  assert.equal((await st.fresh()).length, 0);
  // ...the next event commits them, each dated at its deadline, then its own notice.
  cw = await st.cwInfra.call('env.snapshot');
  const event = {event_id: 'ev-0031', at: '2026-11-06T08:00:00-05:00', operation: 'crossway.toll.posted',
    payload: {toll_id: 't-0931', plaza_id: 'pz-millrace', read: 'plate', plate: 'KLM2210', transponder_id: null, class: 1}};
  assert.equal((await st.cwInfra.call('env.apply_event', {expected_version: cw.version, event})).status, 'committed');
  const batch = await st.fresh();
  assert.deepEqual(batch.map(o => [o.kind, o.object_id]), [['notice_escalated', 'n-0015'], ['notice_collections', 'n-0012'], ['notice_escalated', 'n-0016'], ['notice_issued', 'n-0019']]);
  await st.syncMail();
  for (const o of batch) await deliver(st, publisher, o, report.committed);

  // 5. The dispute decision, granted on the cited Mail message, reaches Mail as well.
  cw = await st.cwInfra.call('env.snapshot');
  const decided = {event_id: 'ev-0032', at: '2026-11-20T10:00:00-05:00', operation: 'crossway.dispute.decided',
    payload: {notice_id: 'n-0017', grant_if: [{reason: 'sold_or_not_in_possession', evidence: [MAIL('m-11133')]}]}};
  assert.equal((await st.cwInfra.call('env.apply_event', {expected_version: cw.version, event: decided})).status, 'committed');
  const decision = (await st.fresh()).filter(o => o.kind === 'dispute_decided');
  await st.syncMail();
  for (const o of await st.fresh()) await deliver(st, publisher, o, report.committed);
  assert.equal(decision.length, 1);
  const evidence = await st.mailAgent.call('mail.get', {id: 'm-11133'});
  assert.equal(evidence.status, 'ok');

  const final = (await st.mailInfra.call('env.snapshot')).snapshot.data.messages;
  assert.equal(final.length, st.mailSeed.data.messages.length + report.committed.length);
  report.mail_messages = final.length;
  report.evidence_join = {crossway_dispute: 'n-0017', mail_message: evidence.message.id, subject: evidence.message.subject};
  return report;
}

// ---- Part 2: unknown acknowledgement ----------------------------------------------

async function unknownAck(base) {
  const run = 'crossway-mail-unknown';
  const st = await stage({...base, run, seed: 'dani'});
  let v = (await st.cwInfra.call('env.snapshot')).version;
  const pv = await st.cwAgent.call('crossway.account.topup.preview', {expected_version: v, request_id: 'unknown-topup-preview', amount_cents: 2500, card_id: 'card-dani-visa'});
  const confirmed = await st.cwAgent.call('crossway.account.topup.confirm', {expected_version: pv.version, request_id: 'unknown-topup-confirm', preview_id: pv.preview.id});
  assert.equal(confirmed.status, 'committed');
  const [notice] = await st.fresh();
  assert.equal(notice.kind, 'receipt');
  await st.syncMail();

  // The router, in this process, over the same run and state directory.
  const router = await createRouter({config: path.join(MESSAGING, 'config.json'), publisher: 'crossway', run, stateDir: base.dir});
  const cwBefore = (await st.cwInfra.call('env.snapshot')).snapshot.data;
  const mailBefore = (await st.mailInfra.call('env.snapshot')).snapshot.data.messages.length;
  const originalCall = Client.prototype.call;
  let lost;
  try {
    // Mail's env.apply_event commits; then the acknowledgement is lost on the way back.
    Client.prototype.call = async function (name, args) {
      const result = await originalCall.call(this, name, args);
      if (name === 'env.apply_event') throw Error('Simulated lost acknowledgement');
      return result;
    };
    lost = await router.call('router.publish', {request_id: 'publish-' + notice.id, message: notice.message});
  } finally {
    Client.prototype.call = originalCall;
  }
  assert.equal(lost.status, 'unknown');
  assert.equal(lost.code, 'receiver_unconfirmed');
  assert.equal(lost.stop_run, true);
  assert.ok(lost.event_id && !lost.committed_at, 'the unknown result keeps the attempted event ID and claims no commit time');

  // The publisher stops: it does not mark the notice handled, does not retry,
  // and the router refuses anything further in this run.
  const after = await router.call('router.publish', {request_id: 'after-stop-' + notice.id, message: notice.message});
  assert.deepEqual([after.status, after.code], ['halted', 'run_halted']);
  assert.ok(!st.handled.has(notice.id));
  await router.close();

  // Reconciliation from the receiver's own evidence: Mail did commit the message.
  const status = await st.mailInfra.call('env.event_status', {event_id: lost.event_id});
  assert.equal(status.receipt.status, 'committed');
  const got = await st.mailAgent.call('mail.get', {id: lost.event_id});
  assert.equal(got.status, 'ok');
  assert.equal(got.message.subject, notice.message.data.content.title);
  const mailAfter = (await st.mailInfra.call('env.snapshot')).snapshot.data.messages.length;
  assert.equal(mailAfter, mailBefore + 1, 'exactly one Mail message, no duplicate');
  assert.deepEqual((await st.cwInfra.call('env.snapshot')).snapshot.data, cwBefore, 'Crossway is unchanged by the publish attempt');
  return {run, notice: notice.id, kind: notice.kind, router_status: lost.status, code: lost.code, stop_run: lost.stop_run, event_id: lost.event_id,
    committed_at: lost.committed_at ?? null, next_publish: `${after.status} (${after.code})`, publisher: 'stopped; notice left unhandled; run not scored',
    reconciliation: {mail_event_status: status.receipt.status, mail_message_id: got.message.id, subject: got.message.subject, mail_messages_before: mailBefore, mail_messages_after: mailAfter},
    crossway_unchanged: true};
}

// ---- Part 3: one publisher run per seed -------------------------------------------

async function perSeed(base, id) {
  const run = 'crossway-mail-' + id;
  const st = await stage({...base, run, seed: id});
  const publisher = await st.router(CONFIG[id]);
  const s = session(st.cwAgent, st.cwInfra, run);
  const {schedule, now: clock} = seedFiles(id);
  const items = [...ACTIONS[id].map(a => ({at: a.at, action: a})), ...schedule.events.map(e => ({at: e.at, event: e}))]
    .sort((x, y) => Date.parse(x.at) - Date.parse(y.at) || (x.action ? -1 : 1));
  const committed = [];
  let now = clock;
  for (const item of items) {
    if (item.action) {
      if (Date.parse(item.at) > Date.parse(now)) await s.advance(item.at);
      await item.action.run(s);
    } else await s.event(item.event);
    now = item.at;
    const batch = await st.fresh();
    if (!batch.length) continue;
    await st.syncMail();
    for (const o of batch) await deliver(st, publisher, o, committed);
  }
  assert.equal((await st.fresh()).length, 0, 'every notice delivered');
  // The evidence join: each Mail message a dispute on this account cites exists in the holder's Mail.
  const data = (await st.cwInfra.call('env.snapshot')).snapshot.data, account = st.mailSeed.data.account_id;
  const joins = [];
  for (const d of data.disputes) {
    for (const e of d.evidence.filter(x => x.app_id === 'mail')) {
      assert.equal(e.account_id, account, `${id} ${d.id} cites the holder's mailbox`);
      const got = await st.mailAgent.call('mail.get', {id: e.object_id});
      assert.equal(got.status, 'ok', `${id}: ${d.id} cites ${e.object_id}, which must exist in ${account}`);
      joins.push({dispute: d.id, notice: d.notice_id, state: d.state, mail_message: e.object_id, subject: got.message.subject});
    }
  }
  assert.ok(joins.length > 0, id + ': at least one dispute cites a Mail message');
  const mail = (await st.mailInfra.call('env.snapshot')).snapshot.data.messages.length;
  assert.equal(mail, st.mailSeed.data.messages.length + committed.length);
  await publisher.close();
  return {run, seed: id, mail_account: account, actions: ACTIONS[id].length, events: schedule.events.length, notices_delivered: committed.length,
    kinds: [...new Set(committed.map(c => c.kind))].sort(), mail_messages: mail, evidence_join: joins};
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-crossway-mail-'));
  const prepared = prepare(path.join(root, 'apps/crossway'));
  const clients = [];
  const base = {dir, prepared, clients};
  try {
    const report = {passed: false, ...await daniDemo(base)};
    report.unknown = await unknownAck(base);
    report.per_seed = [];
    for (const {seed_id: id} of SEEDS) report.per_seed.push(await perSeed(base, id));
    report.passed = true;
    console.log(JSON.stringify(report, null, 2));
    if (process.argv.includes('--evidence')) {
      // The dependency evidence the README's index links: wall-clock fields vary per run; IDs and contents do not.
      const versions = {crossway: require('../app.json').version, mail: readJson(MAIL_PACKAGE).version, runtime: readJson(path.join(root, 'runtime/package.json')).version};
      fs.writeFileSync(path.join(__dirname, '../evidence/publish-to-mail.json'), JSON.stringify({by: 'node apps/crossway/examples/publish-to-mail.cjs --evidence', versions, ...report}, null, 2) + '\n');
    }
    const delivered = report.per_seed.reduce((n, r) => n + r.notices_delivered, 0);
    const joins = report.per_seed.reduce((n, r) => n + r.evidence_join.length, 0);
    console.log(`PASS: 1 rejected (missing grant), ${report.committed.length} committed and read back with mail.get, 1 deduplicated retry; ` +
      `1 unknown acknowledgement stopped the run and was reconciled from Mail; ${report.per_seed.length} per-seed runs delivered ${delivered} notices ` +
      `and found all ${joins} cited Mail messages.`);
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
    fs.rmSync(dir, {recursive: true, force: true});
  }
}
main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
