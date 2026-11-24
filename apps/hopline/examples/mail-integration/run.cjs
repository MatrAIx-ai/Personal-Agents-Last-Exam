'use strict';
// Hopline → Messaging → Mail through the public runtime. Run from a full checkout:
//   node apps/hopline/examples/mail-integration/run.cjs
// Cases: (1) the EL-12 outage notice for a step-free commute reaches Mail's inbox with a committed receipt;
// (2) republishing is a duplicate with Mail unchanged; (3) an ungranted recipient is rejected, Mail is
// unchanged and the notification becomes delivery_failed; (4) a declined-tap card notice held by quiet hours
// is published once, only after env.advance_time.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const pkg = path.resolve(__dirname, '../..');
let root = pkg; while (!fs.existsSync(path.join(root, 'runtime/client.cjs'))) { const up = path.dirname(root); if (up === root) throw Error('Run inside the PALE checkout'); root = up; }
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const publisher = require('../../src/publisher.cjs');
const MAIL_REGISTRY = path.join(root, 'examples/registry.mail.json');

// Hopline seed owned by Maya, the owner of the reference Mail account.
const START = require('../../fixtures/clock.json').initial_time;
function seed() {
  const data = structuredClone(require('../../fixtures/minimal.json'));
  data.account_id = 'hopline-maya'; data.owner_person_id = 'person-maya'; data.rider.name = 'Maya Chen';
  return data;
}
const binding = {people: [{person_id: 'person-maya', name: 'Maya Chen'}], accounts: [{app_id: 'hopline', account_id: 'hopline-maya', owner_person_id: 'person-maya'}],
  objects: {hopline: ['st-central', 'fac-el12']}};
const OUTAGE = 'n-sub3-fac-el12-1-maya';

const step = m => process.env.HOPLINE_DEBUG && console.error('[step]', m);
async function world(granted) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hopline-mail-')), clients = [];
  // Copy the package so its registry can sit beside it (registry paths must stay inside the registry folder).
  fs.cpSync(pkg, path.join(dir, 'pkg/hopline'), {recursive: true, filter: s => !s.includes('node_modules')});
  const registry = path.join(dir, 'pkg/registry.json');
  fs.writeFileSync(registry, JSON.stringify({schema_version: 1, apps: [{app_id: 'hopline', version: '1.0.0', path: 'hopline'}],
    initial_time: START}));
  const config = path.join(dir, 'router.json');
  fs.writeFileSync(config, JSON.stringify({schema_version: 2, registry: 'examples/registry.mail.json', publishers: [{
    app_id: 'hopline', account_id: 'hopline-maya', owner_person_id: 'person-maya', package_root: path.relative(root, pkg),
    contribution_ref: 'contribution/contribution.json',
    allowed_recipients: granted ? [{app_id: 'mail', account_id: 'mail-maya', channel: 'channel.email'}] : []}],
    authentication: {mode: 'trusted-stdio'}}));
  step('copied');
  const run = 'hopline-mail';
  try {
  const hopline = new Client('hopline', 'infra', run, dir, 'hopline-infra', {registry}); clients.push(hopline); await hopline.initialize(); step('hopline up');
  const mail = new Client('mail', 'agent', run, dir, 'mail-reader', {registry: MAIL_REGISTRY}); clients.push(mail); await mail.initialize(); step('mail up');
  const router = new Client(null, null, null, null, 'hopline-router', {commandArgs: [path.join(root, 'runtime/messaging/service.cjs'),
    '--config', config, '--publisher', 'hopline', '--run', run, '--state-dir', dir]}); clients.push(router); await router.initialize(); step('router up');
  const snap = await hopline.call('env.snapshot');
  const loaded = await hopline.call('env.load_seed', {expected_version: snap.version, request_id: 'seed-maya', data: seed(), binding,
    virtual_now: START});
  assert.equal(loaded.status, 'ready', JSON.stringify(loaded)); step('seeded');
  const apply = async event => {
    const s = await hopline.call('env.snapshot');
    const r = await hopline.call('env.apply_event', {expected_version: s.version, event});
    assert.equal(r.status, 'committed', JSON.stringify(r));
  };
  const advance = async to => {
    const s = await hopline.call('env.snapshot');
    const r = await hopline.call('env.advance_time', {expected_version: s.version, request_id: 'clock-' + to, virtual_now: to});
    assert.equal(r.status, 'committed', JSON.stringify(r));
  };
  const notifications = async () => (await hopline.call('env.snapshot')).snapshot.data.notifications;
  const inbox = async () => (await mail.call('mail.search', {})).messages;
  return {dir, hopline, mail, router, apply, advance, notifications, inbox,
    close: async () => { await Promise.allSettled(clients.map(c => c.close())); fs.rmSync(dir, {recursive: true, force: true}); }};
  } catch (e) { await Promise.allSettled(clients.map(c => c.close())); fs.rmSync(dir, {recursive: true, force: true}); throw e; }
}

const note = async (w, id) => (await w.notifications()).find(n => n.notification_id === id);

async function main() {
  const report = {};
  // Cases 1, 2 and 4 with the channel granted.
  const w = await world(true);
  try {
    const before = (await w.inbox()).length;
    await w.apply(require('../scenario.json'));                         // EL-12 out at Central, Mon 06:40
    const first = await publisher.deliver({infra: w.hopline, router: w.router});
    assert.equal(first.length, 1);
    assert.equal(first[0].receipt.status, 'committed', JSON.stringify(first[0].receipt));
    const n = await note(w, OUTAGE);
    assert.equal(n.status, 'delivered');
    assert.equal(n.outcome.router_event_id, first[0].receipt.event_id);
    const got = await w.mail.call('mail.get', {id: first[0].receipt.event_id});
    assert.equal(got.status, 'ok');
    assert.equal(got.message.subject, 'Elevator out at Central: your step-free commute is affected');
    assert.equal((await w.inbox()).length, before + 1);
    report.case1_delivered = {notification_id: n.notification_id, mail_message_id: got.message.id, subject: got.message.subject};
    // Case 2: republishing the same notification is a duplicate; Mail is unchanged.
    const again = await w.router.call('router.publish', {request_id: n.notification_id, message: publisher.message({account_id: 'hopline-maya'}, n)});
    assert.equal(again.duplicate, true);
    assert.equal((await w.inbox()).length, before + 1);
    report.case2_duplicate = {duplicate: again.duplicate, inbox_unchanged: true};
    // Case 4: late taps take Lee's card below zero, then one is declined at 00:20 (beyond the transfer window); the notice is held until
    // 06:30 and published once after env.advance_time.
    await w.apply({event_id: 'ev-tap-lee-1', at: '2026-12-07T22:15:00-05:00', operation: 'fare.tap_recorded',
      payload: {tap_id: 'tp-lee-first', card_id: 'cd-lee', stop_id: 'st-harbor-sq', route_id: 'rt-blue', mode: 'rail'}});
    await w.apply({event_id: 'ev-tap-lee-2', at: '2026-12-08T00:20:00-05:00', operation: 'fare.tap_recorded',
      payload: {tap_id: 'tp-lee-late', card_id: 'cd-lee', stop_id: 'st-mill', route_id: 'rt-blue', mode: 'rail'}});
    assert.equal((await publisher.deliver({infra: w.hopline, router: w.router})).length, 0);
    const held = (await w.notifications()).find(x => x.source.id === 'tp-lee-late');
    assert.deepEqual([held.status, held.release_at], ['held_quiet_hours', '2026-12-08T06:30:00-05:00']);
    await w.advance('2026-12-08T06:30:00-05:00');                        // env.advance_time: no App code runs
    const released = await publisher.deliver({infra: w.hopline, router: w.router});
    assert.equal(released.length, 1);
    assert.equal(released[0].notification_id, held.notification_id);
    assert.equal(released[0].receipt.status, 'committed');
    assert.equal((await publisher.deliver({infra: w.hopline, router: w.router})).length, 0, 'sent once');
    assert.equal((await w.inbox()).length, before + 2);
    report.case4_quiet_hours = {notification_id: held.notification_id, released_at: held.release_at, receipt: released[0].receipt.status};
  } finally { await w.close(); }
  // Case 3: without a grant the message is rejected, Mail is unchanged and the notification is delivery_failed.
  const u = await world(false);
  try {
    const before = (await u.inbox()).length;
    await u.apply(require('../scenario.json'));
    const out = await publisher.deliver({infra: u.hopline, router: u.router});
    assert.equal(out[0].receipt.status, 'rejected');
    assert.equal(out[0].receipt.code, 'recipient_not_authorized');
    assert.equal((await u.inbox()).length, before);
    assert.equal((await note(u, OUTAGE)).status, 'delivery_failed');
    report.case3_ungranted = {code: out[0].receipt.code, inbox_unchanged: true, status: 'delivery_failed'};
  } finally { await u.close(); }
  return report;
}

module.exports = {main};
if (require.main === module) main().then(r => { console.log(JSON.stringify(r, null, 2)); console.log('PASS: Hopline → Messaging → Mail, 4 cases.'); })
  .catch(e => { console.error(e); process.exitCode = 1; });
