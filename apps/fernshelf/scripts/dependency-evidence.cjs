#!/usr/bin/env node
'use strict';
// Demonstrations of the two dependencies the package claims as implemented, against the real pinned
// runtime and (for Mail) the real pinned Mail package, with a transcript of every request and result:
//   1. Mail notices (optional, send-only): Fernshelf notification -> Infra-run sender (src/publisher.cjs)
//      -> Messaging router -> Mail 1.3.0 receive contract (mail.receive_notification).
//   2. Resource access: fernshelf.items.read -> Core ctx.assets.read under the parent item, allowed by
//      runtime/registrations/fernshelf.json ({"item": "fernshelf.items.get"}).
// Each runs in disposable copies (runtime, this package, Mail) and writes
// evidence/dependencies/mail.json and evidence/dependencies/resource-access.json. The transcripts are
// reproducible byte for byte (see stable() below); --check runs both demonstrations twice and fails if
// the two runs differ from each other or from the committed transcripts, and writes nothing.
//   node scripts/dependency-evidence.cjs [--runtime DIR] [--mail DIR] [--out DIR] [--check]
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const locate = require('./locate.cjs');
const publisher = require('../src/publisher.cjs');

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const fileSha = f => sha(fs.readFileSync(f));
const json = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const pkgDir = locate.packageDir;

function recorder() {
  const steps = [], checks = [];
  return {
    steps, checks,
    step(name, entry) { steps.push({n: steps.length + 1, step: name, ...entry}); },
    check(name, cond, detail) { assert.ok(cond, name + (detail !== undefined ? ': ' + JSON.stringify(detail).slice(0, 600) : '')); checks.push(name); }
  };
}
// The only values in a transcript that depend on when and where it is produced are the wall-clock times
// the Messaging router and Mail stamp on receipts and records (received_at, committed_at, processed_at).
// They are ISO times in UTC (toISOString), while every virtual-clock time carries its zone offset, so
// stable() writes such a value under one of those keys as WALL_CLOCK; a virtual-clock time under the
// same key (Mail's record received_at) and a missing time (null, as in the unknown-outcome receipt) stay. The Node version is not recorded. Everything else is exact: virtual-clock times, versions,
// request, event and record IDs, hashes and receipt contents. runDependent() finds any value of the
// kinds a run could leak (a UTC wall-clock time, a temporary or checkout path, a Node version), and
// the script refuses to write a transcript that still has one.
const WALL_CLOCK = '<wall-clock>', WALL_CLOCK_KEYS = new Set(['received_at', 'committed_at', 'processed_at']), UTC_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const REPRODUCIBLE = 'Byte for byte, on Node 18 and 22: the wall-clock times the Messaging router and Mail record (received_at, committed_at, processed_at, in UTC) are written as "' + WALL_CLOCK +
  '" and the Node version is not recorded; everything else (virtual-clock times, versions, request, event and record IDs, hashes, receipt contents) is exact. ' +
  '`node scripts/dependency-evidence.cjs --check` regenerates the transcript twice and compares both runs with this file.';
function stable(value, key) {
  if (Array.isArray(value)) return value.map(v => stable(v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stable(v, k)]));
  return WALL_CLOCK_KEYS.has(key) && typeof value === 'string' && UTC_TIME.test(value) ? WALL_CLOCK : value;
}
function runDependent(text) {
  const leaks = [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/, /"node":/, /\bv\d+\.\d+\.\d+\b/, /fernshelf-(?:deps|res|capture)-\w/];
  for (const dir of [os.tmpdir(), pkgDir].filter(d => d.length > 4)) leaks.push(new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const re of leaks) { const m = re.exec(text); if (m) return text.slice(Math.max(0, m.index - 80), m.index + m[0].length + 20); }
  return null;
}
const transcript = report => { const text = JSON.stringify(stable(report), null, 2) + '\n', leak = runDependent(text); assert.ok(!leak, 'run-dependent value in transcript: ' + leak); return text; };

// The parts of a snapshot that a reader needs to compare states, not the whole state.
const versionOf = s => ({epoch: s.version.epoch, revision: s.version.revision});

async function mailDemo() {
  const runtime = locate.runtimeDir(), mail = locate.mailDir(), mailManifest = json(path.join(mail, 'app.json'));
  const fsManifest = json(path.join(pkgDir, 'app.json'));
  const T = recorder(), clients = [], roots = [];
  // A disposable repository root: runtime, Fernshelf and (optionally) Mail, a registry and router configs.
  function makeRoot({withMail = true, mutateMailSchema = false} = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fernshelf-deps-')); roots.push(root);
    fs.cpSync(runtime, path.join(root, 'runtime'), {recursive: true});
    fs.cpSync(pkgDir, path.join(root, 'apps/fernshelf'), {recursive: true});
    const apps = [{app_id: 'fernshelf', version: fsManifest.version, path: 'apps/fernshelf'}];
    if (withMail) {
      fs.cpSync(mail, path.join(root, 'apps/mail'), {recursive: true});
      apps.push({app_id: 'mail', version: mailManifest.version, path: 'apps/mail'});
      if (mutateMailSchema) {
        const f = path.join(root, 'apps/mail/schemas/router-message.schema.json'), s = json(f);
        s.properties.data.properties.content.properties.title.maxLength = 120; // a different receive contract than the one Fernshelf publishes to
        fs.writeFileSync(f, JSON.stringify(s, null, 2) + '\n');
      }
    }
    fs.writeFileSync(path.join(root, 'registry.json'), JSON.stringify({schema_version: 1, initial_time: '2026-11-20T09:00:00-08:00', apps}));
    const config = grants => ({schema_version: 2, registry: 'registry.json', authentication: {mode: 'trusted-stdio'}, publishers: [{app_id: 'fernshelf',
      account_id: 'fernshelf-maya', owner_person_id: 'person-maya', package_root: 'apps/fernshelf', contribution_ref: 'contribution/contribution.json', allowed_recipients: grants}]});
    fs.writeFileSync(path.join(root, 'router.json'), JSON.stringify(config([{app_id: 'mail', account_id: 'mail-maya', channel: 'channel.email'}])));
    fs.writeFileSync(path.join(root, 'router-no-grant.json'), JSON.stringify(config([])));
    const {Client} = require(path.join(root, 'runtime/client.cjs')), state = path.join(root, 'state'), registry = path.join(root, 'registry.json');
    const open = async (app, role, run, name) => { const c = new Client(app, role, run, state, name, {registry}); clients.push(c); await c.initialize(); return c; };
    const router = async (cfg, run) => { const c = new Client(null, null, null, null, 'fernshelf-sender', {commandArgs: [path.join(root, 'runtime/messaging/service.cjs'),
      '--config', path.join(root, cfg), '--publisher', 'fernshelf', '--run', run, '--state-dir', state]}); clients.push(c); await c.initialize(); return c; };
    return {root, open, router, state, Client};
  }
  const scenario = json(path.join(pkgDir, 'examples/scenario.json'));
  // Fresh Fernshelf run in the sandbox profile with Dana's removal request applied: one new notification.
  async function source(env, run) {
    const infra = await env.open('fernshelf', 'infra', run, 'fernshelf-infra');
    let s = await infra.call('env.snapshot');
    await infra.call('env.reset', {expected_version: s.version, profile: 'sandbox'});
    s = await infra.call('env.snapshot');
    const applied = await infra.call('env.apply_event', {expected_version: s.version, event: scenario});
    assert.equal(applied.status, 'committed', JSON.stringify(applied));
    const after = (await infra.call('env.snapshot')).snapshot;
    return {infra, applied, notification: after.data.notifications.at(-1), before: s};
  }
  const mailState = async mi => { const s = await mi.call('env.snapshot'); return {version: versionOf(s), inbox: s.snapshot.data.messages.filter(m => m.folder === 'inbox').map(m => m.id)}; };
  const fsState = async fi => { const s = await fi.call('env.snapshot'); return {version: versionOf(s), data_sha256: sha(JSON.stringify(s.snapshot.data)), notifications: s.snapshot.data.notifications.length}; };
  try {
    const env = makeRoot();
    const contract = {
      channel: 'channel.email', wire_schema: 'urn:pale:email-message:2', payload_schema: 'urn:pale:email-payload:1', event_type: 'org.pale.mail.notification.v1',
      receiver_operation: 'mail.receive_notification (through Core env.apply_event on the Mail instance)',
      fernshelf_declaration: 'contribution/contribution.json messaging.publishes[0]', mail_declaration: 'examples/apps/mail/contribution/contribution.json messaging.receives[0]',
      fernshelf_wire_schema_sha256: fileSha(path.join(pkgDir, 'schemas/router-message.schema.json')), mail_wire_schema_sha256: fileSha(path.join(mail, 'schemas/router-message.schema.json'))
    };
    T.check('Fernshelf publishes the exact wire schema Mail 1.3.0 receives', contract.fernshelf_wire_schema_sha256 === contract.mail_wire_schema_sha256);
    const run = 'deps-mail';
    const a = await source(env, run);
    const mailInfra = await env.open('mail', 'infra', run, 'mail-infra');
    const mailSnap = (await mailInfra.call('env.snapshot')).snapshot;
    const fsBefore = await fsState(a.infra), mailBefore = await mailState(mailInfra);
    T.step('Initial states and account binding', {caller: 'Infra', direction: 'none',
      fernshelf: {app_version: fsManifest.version, account_id: 'fernshelf-maya', owner_person_id: 'person-maya', email_notices: true, version_before_event: versionOf(a.before), state_after_event: fsBefore},
      mail: {app_version: mailManifest.version, account_id: mailSnap.data.account_id, owner_person_id: mailSnap.data.owner_person_id, address: mailSnap.data.address, state: mailBefore},
      router_grant: {app_id: 'mail', account_id: 'mail-maya', channel: 'channel.email'},
      note: 'Each App starts from its own package fixture in the same run; the recipient is addressed as person_ref person-maya, which the router resolves to the Mail account bound to that person.'});
    T.step('Local commit in Fernshelf: an event writes the notification and its wire message', {caller: 'Infra -> Fernshelf (env.apply_event)', direction: 'into Fernshelf',
      request: {tool: 'env.apply_event', event_id: scenario.event_id, operation: scenario.operation}, result: {status: a.applied.status, version: a.applied.version},
      notification: {id: a.notification.id, kind: a.notification.kind, object_id: a.notification.object_id, title: a.notification.title}, wire_message: a.notification.wire});
    T.check('The notification stored its wire message (email notices on)', a.notification.wire && a.notification.kind === 'removal.requested');
    const sender = await env.router('router.json', run);
    const caps = await sender.call('router.capabilities');
    T.step('Router capabilities for the fixed Fernshelf source', {caller: 'Infra-run sender', request: {tool: 'router.capabilities'}, result: {status: caps.status, publisher: caps.publisher, channels: caps.channels, authentication: caps.authentication}});
    const sent = await publisher.send({infra: a.infra, router: sender, notificationId: a.notification.id});
    T.step('Receiver delivery and commit: router.publish', {caller: 'Infra-run sender (src/publisher.cjs)', direction: 'Fernshelf -> Messaging -> Mail',
      request: {tool: 'router.publish', request_id: sent.request_id, message_id: sent.message.id, source: sent.message.source, recipient: sent.message.data.recipient}, result: sent.result});
    T.check('Router commits the delivery to the Mail account mail-maya', sent.result.status === 'committed' && sent.result.target.account_id === 'mail-maya');
    const mailAgent = await env.open('mail', 'agent', run, 'mail-reader');
    const got = await mailAgent.call('mail.get', {id: sent.result.event_id});
    const status = await mailInfra.call('env.event_status', {event_id: sent.result.event_id});
    const mailAfter = await mailState(mailInfra), fsAfter = await fsState(a.infra);
    T.step('Result inside Mail', {caller: 'Mail Agent connection (mail.get) and Mail Infra (env.event_status)',
      request: [{tool: 'mail.get', id: sent.result.event_id}, {tool: 'env.event_status', event_id: sent.result.event_id}],
      result: {message: got.message, receipt: status.receipt}, mail_state: mailAfter, fernshelf_state: fsAfter});
    T.check('Mail holds one new inbox record whose ID is the delivery event ID', got.status === 'ok' && got.message.id === sent.result.event_id && got.message.folder === 'inbox' &&
      mailAfter.inbox.length === mailBefore.inbox.length + 1 && mailAfter.inbox.includes(sent.result.event_id));
    T.check('The Mail record carries the notification title and body, unread', got.message.subject === a.notification.title && got.message.body === a.notification.body && got.message.read === false);
    T.check('Mail\'s committed receipt names the same event', status.receipt.status === 'committed' && status.receipt.event_id === sent.result.event_id);
    T.check('Fernshelf is unchanged by the dispatch', JSON.stringify(fsAfter) === JSON.stringify(fsBefore));
    T.step('Recipient or business confirmation', {caller: 'none', result: 'not established: the Mail record is stored with read: false and nothing in this flow reads, answers or acknowledges it. A delivery receipt proves only that Mail stored the message.'});
    // Retry and duplicate.
    const retry = await publisher.send({infra: a.infra, router: sender, notificationId: a.notification.id});
    const rerun = await publisher.send({infra: a.infra, router: sender, notificationId: a.notification.id, requestId: 'fernshelf-rerun-1'});
    const mailRetry = await mailState(mailInfra);
    T.step('Retry and duplicate', {caller: 'Infra-run sender', request: [{tool: 'router.publish', request_id: retry.request_id, note: 'identical retry'}, {tool: 'router.publish', request_id: 'fernshelf-rerun-1', note: 'same message under a new request ID'}],
      result: [retry.result, rerun.result], mail_state: mailRetry});
    T.check('An identical retry returns the first receipt marked duplicate', retry.result.duplicate === true && retry.result.event_id === sent.result.event_id);
    T.check('A new request ID for the same message reaches the same Mail event; still one inbox record', rerun.result.event_id === sent.result.event_id && mailRetry.inbox.length === mailAfter.inbox.length);
    // Unknown outcome: the receiver commits but the router never sees the acknowledgement.
    {
      const run2 = 'deps-mail-unknown';
      const b = await source(env, run2);
      const mi = await env.open('mail', 'infra', run2, 'mail-infra-2');
      const mBefore = await mailState(mi), fBefore = await fsState(b.infra);
      const {create} = require(path.join(env.root, 'runtime/messaging/src/router.cjs'));
      const inproc = await create({config: path.join(env.root, 'router.json'), publisher: 'fernshelf', run: run2, stateDir: env.state}); clients.push(inproc);
      const original = env.Client.prototype.call; let lost;
      try {
        // Fault injection (a test double for the transport only): the router's call to Mail's env.apply_event
        // runs for real, then its answer is dropped as if the connection failed.
        env.Client.prototype.call = async function (name, args) { const r = await original.call(this, name, args); if (name === 'env.apply_event') throw new Error('acknowledgement lost (injected)'); return r; };
        lost = await publisher.send({infra: b.infra, router: inproc, notificationId: b.notification.id});
      } finally { env.Client.prototype.call = original; }
      const persisted = await mi.call('env.event_status', {event_id: lost.result.event_id});
      const after = await publisher.send({infra: b.infra, router: inproc, notificationId: b.notification.id});
      const mAfter = await mailState(mi), fAfter = await fsState(b.infra);
      T.step('Unknown outcome (injected lost acknowledgement)', {caller: 'Infra-run sender with an in-process router; the drop is injected', direction: 'Fernshelf -> Messaging -> Mail',
        request: {tool: 'router.publish', request_id: lost.request_id}, result: lost.result, mail_receipt: persisted.receipt, next_publish: after.result,
        mail_state: {before: mBefore, after: mAfter}, fernshelf_state: {before: fBefore, after: fAfter}});
      T.check('A lost acknowledgement is reported as unknown with the event ID and no commit time, and stops the run', lost.result.status === 'unknown' && lost.result.code === 'receiver_unconfirmed' &&
        !!lost.result.event_id && !lost.result.committed_at && lost.result.stop_run === true);
      T.check('Mail\'s own receipt shows the message was committed', persisted.receipt.status === 'committed' && mAfter.inbox.length === mBefore.inbox.length + 1);
      T.check('The halted run refuses further publishing until it is reconciled', after.result.status === 'halted' && after.result.code === 'run_halted');
      T.check('Fernshelf is unchanged', JSON.stringify(fAfter) === JSON.stringify(fBefore));
    }
    // Denied: no Infra grant for channel.email.
    {
      const run3 = 'deps-mail-denied';
      const c = await source(env, run3);
      const mi = await env.open('mail', 'infra', run3, 'mail-infra-3');
      const mBefore = await mailState(mi), fBefore = await fsState(c.infra);
      const denied = await env.router('router-no-grant.json', run3);
      const r = await publisher.send({infra: c.infra, router: denied, notificationId: c.notification.id});
      const mAfter = await mailState(mi), fAfter = await fsState(c.infra);
      T.step('Denied: no Infra grant for channel.email', {caller: 'Infra-run sender', request: {tool: 'router.publish', request_id: r.request_id}, result: r.result,
        mail_state: {before: mBefore, after: mAfter}, fernshelf_state: {before: fBefore, after: fAfter}});
      T.check('Rejected with recipient_not_authorized; Mail and Fernshelf unchanged', r.result.status === 'rejected' && r.result.code === 'recipient_not_authorized' &&
        JSON.stringify(mAfter) === JSON.stringify(mBefore) && JSON.stringify(fAfter) === JSON.stringify(fBefore));
    }
    // Email notices off: nothing to send.
    {
      const run4 = 'deps-mail-off', infra = await env.open('fernshelf', 'infra', run4, 'fernshelf-infra-4');
      let s = await infra.call('env.snapshot');
      await infra.call('env.reset', {expected_version: s.version, profile: 'sandbox'});
      s = await infra.call('env.snapshot');
      const data = structuredClone(s.snapshot.data); data.account.email_notices = false; for (const n of data.notifications) n.wire = null;
      await infra.call('env.load_seed', {expected_version: s.version, request_id: 'seed-off', data, bundle: s.snapshot.resources.bundle});
      s = await infra.call('env.snapshot');
      await infra.call('env.apply_event', {expected_version: s.version, event: scenario});
      const n = (await infra.call('env.snapshot')).snapshot.data.notifications.at(-1);
      const off = await env.router('router.json', run4);
      const r = await publisher.send({infra, router: off, notificationId: n.id});
      T.step('Email notices off', {caller: 'Infra-run sender', request: {notification_id: n.id}, result: {stage: r.stage}, notification: {id: n.id, wire: n.wire}});
      T.check('With email notices off the notification has no wire message and nothing is published', n.wire === null && r.stage === 'email_notices_off');
    }
    // Missing dependency: a run whose registry has no Mail.
    {
      const env2 = makeRoot({withMail: false}), run5 = 'deps-mail-missing';
      const d = await source(env2, run5);
      const fBefore = await fsState(d.infra);
      const r5 = await env2.router('router.json', run5);
      const r = await publisher.send({infra: d.infra, router: r5, notificationId: d.notification.id});
      const fAfter = await fsState(d.infra);
      const agent = await env2.open('fernshelf', 'agent', run5, 'fernshelf-agent');
      const read = await agent.call('fernshelf.removals.list', {state: 'pending'});
      T.step('Missing dependency: no Mail App in the run', {caller: 'Infra-run sender', request: {tool: 'router.publish', request_id: r.request_id}, result: r.result,
        fernshelf_state: {before: fBefore, after: fAfter}, fernshelf_still_works: {tool: 'fernshelf.removals.list', pending: read.removals.map(x => x.id)}});
      T.check('Without Mail the delivery is rejected as recipient_unavailable and Fernshelf is unchanged and usable', r.result.status === 'rejected' && r.result.code === 'recipient_unavailable' &&
        JSON.stringify(fAfter) === JSON.stringify(fBefore) && read.removals.some(x => x.id === scenario.payload.removal_id));
    }
    // Incompatible contract: a Mail package whose receive schema differs from the one Fernshelf publishes to.
    {
      const env3 = makeRoot({mutateMailSchema: true}), run6 = 'deps-mail-incompatible';
      const e = await source(env3, run6);
      const mi = await env3.open('mail', 'infra', run6, 'mail-infra-6');
      const mBefore = await mailState(mi), fBefore = await fsState(e.infra);
      const r6 = await env3.router('router.json', run6);
      const r = await publisher.send({infra: e.infra, router: r6, notificationId: e.notification.id});
      const mAfter = await mailState(mi), fAfter = await fsState(e.infra);
      T.step('Incompatible contract: Mail copy with a changed receive schema', {caller: 'Infra-run sender', change: 'title maxLength 200 -> 120 in the Mail copy\'s schemas/router-message.schema.json',
        request: {tool: 'router.publish', request_id: r.request_id}, result: r.result, mail_state: {before: mBefore, after: mAfter}, fernshelf_state: {before: fBefore, after: fAfter}});
      T.check('A receiver with a different contract is refused as incompatible_contract; neither App changes', r.result.status === 'rejected' && r.result.code === 'incompatible_contract' &&
        JSON.stringify(mAfter) === JSON.stringify(mBefore) && JSON.stringify(fAfter) === JSON.stringify(fBefore));
    }
    return {schema: 'fernshelf.dependency.mail.v1', dependency: 'Mail notices (optional, send-only)', reproducible: REPRODUCIBLE,
      revisions: {fernshelf: fsManifest.version, mail: mailManifest.version, runtime: json(path.join(runtime, 'package.json')).version, messaging_router: '1.2.0'},
      contract, meanings: {
        local_commit: 'Fernshelf committed the notification and its wire message in its own state when the event was applied.',
        receiver_commit: 'The router returned committed only after Mail\'s env.apply_event committed; Mail\'s env.event_status and mail.get show the record.',
        recipient_confirmation: 'Not established by this flow: the Mail record is unread and nobody acts on it.'},
      passed: true, checks: T.checks, transcript: T.steps};
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    for (const r of roots) fs.rmSync(r, {recursive: true, force: true});
  }
}

async function resourceDemo() {
  const runtime = locate.runtimeDir();
  const T = recorder(), clients = [], roots = [];
  const fsManifest = json(path.join(pkgDir, 'app.json')), catalog = json(path.join(pkgDir, 'contribution/assets.catalog.json'));
  const registrationFile = path.join(runtime, 'registrations/fernshelf.json');
  function makeRuntime(registration) {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'fernshelf-res-')); roots.push(copy);
    fs.cpSync(runtime, path.join(copy, 'runtime'), {recursive: true});
    const reg = path.join(copy, 'runtime/registrations/fernshelf.json');
    if (registration === null) fs.rmSync(reg, {force: true}); else if (registration) fs.writeFileSync(reg, JSON.stringify(registration, null, 2) + '\n');
    const prepared = require(path.join(copy, 'runtime/prepare.cjs')).prepare(pkgDir); roots.push(prepared.root);
    const {Client} = require(path.join(copy, 'runtime/client.cjs'));
    const open = async (role, run) => { const c = new Client('fernshelf', role, run, path.join(prepared.root, 'state'), 'fernshelf-resource-demo', {registry: prepared.registry}); clients.push(c); await c.initialize(); return c; };
    return {open};
  }
  const itemId = 'it-2611-0931', entry = catalog.assets.find(a => a.asset_id === 'img-' + itemId);
  const onDisk = fs.readFileSync(path.join(pkgDir, entry.storage.path));
  try {
    const env = makeRuntime(undefined), run = 'deps-resource';
    const infra = await env.open('infra', run);
    let s = await infra.call('env.snapshot');
    await infra.call('env.reset', {expected_version: s.version, profile: 'sandbox'});
    s = await infra.call('env.snapshot');
    const agent = await env.open('agent', run);
    T.step('Revisions, registration and initial state', {caller: 'Infra',
      revisions: {fernshelf: fsManifest.version, runtime: json(path.join(runtime, 'package.json')).version, core_api: fsManifest.core_api_version},
      registration: {file: 'runtime/registrations/fernshelf.json', content: json(registrationFile), sha256: fileSha(registrationFile)},
      state: {version: versionOf(s), virtual_now: s.snapshot.virtual_now, assets_in_bundle: s.snapshot.resources.bundle.catalog.assets.length},
      source_file: {item_id: itemId, asset_id: entry.asset_id, mime_type: entry.mime_type, catalog_sha256: entry.integrity.sha256, bytes_on_disk: onDisk.length, sha256_on_disk: sha(onDisk)}});
    T.check('The catalogue hash is the hash of the package file', entry.integrity.sha256 === sha(onDisk));
    const read = await agent.call('fernshelf.items.read', {id: itemId});
    const bytes = Buffer.from(read.file.base64, 'base64');
    const after = await infra.call('env.snapshot');
    T.step('Read the bytes through the parent item', {caller: 'Agent', direction: 'Agent -> Fernshelf items.read -> Core ctx.assets.read (registration: item -> fernshelf.items.get)',
      request: {tool: 'fernshelf.items.read', id: itemId}, result: {status: read.status, version: read.version, file: {filename: read.file.filename, mime_type: read.file.mime_type, sha256: read.file.sha256, media: read.file.media, base64_length: read.file.base64.length}},
      received: {bytes: bytes.length, sha256: sha(bytes)}, state_after: {version: versionOf(after), audit_rows_added: after.snapshot.audit.length - s.snapshot.audit.length}});
    T.check('The received bytes are the immutable source file (same SHA-256 as the catalogue and the package file)', read.status === 'ok' && sha(bytes) === entry.integrity.sha256 && bytes.equals(onDisk));
    T.check('The read changes no business data or version', JSON.stringify(after.snapshot.data) === JSON.stringify(s.snapshot.data) && JSON.stringify(after.version) === JSON.stringify(s.version));
    const again = await agent.call('fernshelf.items.read', {id: itemId});
    T.step('Repeat the read', {caller: 'Agent', request: {tool: 'fernshelf.items.read', id: itemId}, result: {status: again.status, sha256: again.file.sha256}});
    T.check('A repeated read returns the same bytes', again.file.base64 === read.file.base64);
    const res = await agent.request('resources/read', {uri: 'pale://' + run + '/fernshelf/assets/' + entry.asset_id});
    T.step('Accessibility through Core resources/read', {caller: 'Agent', request: {method: 'resources/read', uri: 'pale://' + run + '/fernshelf/assets/' + entry.asset_id},
      result: res.error ? {error: res.error} : {mimeType: res.result.contents[0].mimeType, sha256: sha(Buffer.from(res.result.contents[0].blob, 'base64'))}});
    T.check('Core resources/read serves the same bytes for an active item', !res.error && sha(Buffer.from(res.result.contents[0].blob, 'base64')) === entry.integrity.sha256);
    const wrong = await agent.call('fernshelf.items.read', {id: itemId, asset_id: 'img-it-2611-0934'});
    const trashed = s.snapshot.data.items.find(i => i.file && i.state === 'trashed');
    const inTrash = await agent.call('fernshelf.items.read', {id: trashed.id});
    const trashedRes = await agent.request('resources/read', {uri: 'pale://' + run + '/fernshelf/assets/' + trashed.file});
    const video = s.snapshot.data.items.find(i => i.kind === 'video' && i.state === 'active');
    const noFile = await agent.call('fernshelf.items.read', {id: video.id});
    T.step('Refusals by the App and by Core', {caller: 'Agent', request: [{tool: 'fernshelf.items.read', id: itemId, asset_id: 'img-it-2611-0934'}, {tool: 'fernshelf.items.read', id: trashed.id},
      {method: 'resources/read', asset: trashed.file}, {tool: 'fernshelf.items.read', id: video.id}],
      result: [{status: wrong.status}, {status: inTrash.status}, {error: trashedRes.error ? trashedRes.error.message : null}, {status: noFile.status}]});
    T.check('Another item\'s asset under this parent is not_found; a trashed item is in_trash and refused by resources/read; a video is no_file',
      wrong.status === 'not_found' && inTrash.status === 'in_trash' && !!trashedRes.error && noFile.status === 'no_file');
    // Denied by a task policy: items.get limited to another item.
    const pinfra = await env.open('infra', 'deps-resource-policy'), pagent = await env.open('agent', 'deps-resource-policy');
    const policies = json(path.join(pkgDir, 'fixtures/policies.json'));
    policies.sandbox.constraints = {'fernshelf.items.get': {ids: ['it-2611-0934']}};
    let ps = await pinfra.call('env.snapshot');
    await pinfra.call('env.reset', {expected_version: ps.version, profile: 'sandbox'});
    ps = await pinfra.call('env.snapshot');
    await pinfra.call('env.load_seed', {expected_version: ps.version, request_id: 'seed-policy', data: ps.snapshot.data, bundle: ps.snapshot.resources.bundle, policies, binding: ps.snapshot.binding});
    const allowed = await pagent.call('fernshelf.items.read', {id: 'it-2611-0934'}), deniedRead = await pagent.call('fernshelf.items.read', {id: itemId});
    T.step('Denied: a task policy limits fernshelf.items.get to one item', {caller: 'Agent', policy: policies.sandbox.constraints,
      request: [{tool: 'fernshelf.items.read', id: 'it-2611-0934'}, {tool: 'fernshelf.items.read', id: itemId}], result: [{status: allowed.status, sha256: allowed.file && allowed.file.sha256}, {status: deniedRead.status}]});
    T.check('The allowed parent returns its bytes; another parent is refused by Core (not_available)', allowed.status === 'ok' && deniedRead.status === 'not_available');
    // Missing registration (the fallback) and a registration of another object type.
    for (const [label, registration] of [['Missing dependency: no registration', null], ['Incompatible registration: it maps another object type', {app_id: 'fernshelf', resource_access: {photo: 'fernshelf.items.get'}}]]) {
      const alt = makeRuntime(registration), ri = await alt.open('infra', 'deps-resource-alt');
      let rs = await ri.call('env.snapshot');
      await ri.call('env.reset', {expected_version: rs.version, profile: 'sandbox'});
      rs = await ri.call('env.snapshot');
      const ra = await alt.open('agent', 'deps-resource-alt');
      const r = await ra.call('fernshelf.items.read', {id: itemId}), other = await ra.call('fernshelf.exposure.get', {id: itemId});
      const rafter = await ri.call('env.snapshot');
      T.step(label, {caller: 'Agent', registration, request: [{tool: 'fernshelf.items.read', id: itemId}, {tool: 'fernshelf.exposure.get', id: itemId}],
        result: [{status: r.status}, {status: other.status}], state: {before: versionOf(rs), after: versionOf(rafter)}});
      T.check(label + ': items.read is not_available, other reads work, nothing changes', r.status === 'not_available' && other.status === 'ok' &&
        JSON.stringify(rafter.snapshot.data) === JSON.stringify(rs.snapshot.data));
    }
    return {schema: 'fernshelf.dependency.resource-access.v1', dependency: 'Resource access registration for items.read (platform)', reproducible: REPRODUCIBLE,
      contract: 'fernshelf.items.read returns the file object (filename, mime_type, base64, sha256, media) read by Core ctx.assets.read under the parent item; Core allows it only through runtime/registrations/fernshelf.json, which maps object type item to the read tool fernshelf.items.get, and applies the task policy on that tool.',
      not_applicable: {retry_duplicate: 'reads change nothing, so a repeat is shown to return the same bytes', unknown_outcome: 'no write and no other App is involved'},
      passed: true, checks: T.checks, transcript: T.steps};
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    for (const r of roots) fs.rmSync(r, {recursive: true, force: true});
  }
}

if (require.main === module) {
  (async () => {
    const out = locate.option('out') || path.join(pkgDir, 'evidence/dependencies'), check = process.argv.includes('--check');
    if (!check) fs.mkdirSync(out, {recursive: true});
    let differs = 0;
    for (const [name, demo] of [['mail', mailDemo], ['resource-access', resourceDemo]]) {
      const file = path.join(out, name + '.json'), report = await demo(), text = transcript(report);
      for (const c of report.checks) console.log('ok - ' + name + ': ' + c);
      console.log('PASS: ' + report.checks.length + ' ' + name + ' checks');
      if (!check) { fs.writeFileSync(file, text); console.log('wrote ' + file); continue; }
      const again = transcript(await demo()), committed = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      const same = text === again, current = text === committed;
      console.log((same ? 'ok - ' : 'FAIL - ') + name + ': two runs give the same transcript');
      console.log((current ? 'ok - ' : 'FAIL - ') + name + ': the transcript equals ' + path.relative(process.cwd(), file));
      if (!same || !current) differs++;
    }
    if (check) {
      if (differs) { console.error('Transcripts differ; run node scripts/dependency-evidence.cjs and review the change.'); process.exitCode = 1; }
      else console.log('PASS: both transcripts are reproducible and equal the committed files');
    }
  })().catch(e => { console.error(e); process.exitCode = 1; });
}
module.exports = {mailDemo, resourceDemo, stable, runDependent, WALL_CLOCK};
