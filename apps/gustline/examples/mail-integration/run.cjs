'use strict';
// Gustline → Messaging → Mail through the public runtime. Run from a full checkout:
//   node apps/gustline/examples/mail-integration/run.cjs
// Cases: (1) a triggered rule reaches Mail's inbox with a committed receipt; (2) republishing is a
// duplicate with Mail unchanged; (3) an ungranted recipient is rejected, Mail is unchanged and the
// notification becomes delivery_failed; (4) a quiet-hours hold is published only after env.advance_time.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const pkg = path.resolve(__dirname, '../..');
let root = pkg; while (!fs.existsSync(path.join(root, 'runtime/client.cjs'))) { const up = path.dirname(root); if (up === root) throw Error('Run inside the PALE checkout'); root = up; }
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const publisher = require('../../src/publisher.cjs');
const {issuance} = require('../../tests/helpers.cjs');
const MAIL_REGISTRY = path.join(root, 'examples/registry.mail.json');

// Gustline seed owned by Maya, the owner of the reference Mail account.
function seed() {
  const data = structuredClone(require('../../fixtures/minimal.json'));
  data.account_id = 'gustline-maya'; data.owner_person_id = 'person-maya';
  return data;
}
const binding = {people: [{person_id: 'person-maya', name: 'Maya Chen'}], accounts: [{app_id: 'gustline', account_id: 'gustline-maya', owner_person_id: 'person-maya'}],
  objects: {gustline: ['pl-school', 'pl-home', 'pl-dunes']}};

const step = m => process.env.GUSTLINE_DEBUG && console.error('[step]', m);
async function world(granted) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gustline-mail-')), clients = [];
  // Copy the package so its registry can sit beside it (registry paths must stay inside the registry folder).
  fs.cpSync(pkg, path.join(dir, 'pkg/gustline'), {recursive: true, filter: s => !s.includes('node_modules')});
  const registry = path.join(dir, 'pkg/registry.json');
  fs.writeFileSync(registry, JSON.stringify({schema_version: 1, apps: [{app_id: 'gustline', version: '1.0.0', path: 'gustline'}],
    initial_time: '2027-10-08T09:30:00-07:00'}));
  const config = path.join(dir, 'router.json');
  fs.writeFileSync(config, JSON.stringify({schema_version: 2, registry: 'examples/registry.mail.json', publishers: [{
    app_id: 'gustline', account_id: 'gustline-maya', owner_person_id: 'person-maya', package_root: path.relative(root, pkg),
    contribution_ref: 'contribution/contribution.json',
    allowed_recipients: granted ? [{app_id: 'mail', account_id: 'mail-maya', channel: 'channel.email'}] : []}],
    authentication: {mode: 'trusted-stdio'}}));
  step('copied');
  const run = 'gustline-mail';
  try {
  const gustline = new Client('gustline', 'infra', run, dir, 'gustline-infra', {registry}); clients.push(gustline); await gustline.initialize(); step('gustline up');
  const mail = new Client('mail', 'agent', run, dir, 'mail-reader', {registry: MAIL_REGISTRY}); clients.push(mail); await mail.initialize(); step('mail up');
  const router = new Client(null, null, null, null, 'gustline-router', {commandArgs: [path.join(root, 'runtime/messaging/service.cjs'),
    '--config', config, '--publisher', 'gustline', '--run', run, '--state-dir', dir]}); clients.push(router); await router.initialize(); step('router up');
  const snap = await gustline.call('env.snapshot');
  const loaded = await gustline.call('env.load_seed', {expected_version: snap.version, request_id: 'seed-maya', data: seed(), binding,
    virtual_now: '2027-10-08T09:30:00-07:00'});
  assert.equal(loaded.status, 'ready', JSON.stringify(loaded)); step('seeded');
  const apply = async event => {
    const s = await gustline.call('env.snapshot');
    const r = await gustline.call('env.apply_event', {expected_version: s.version, event});
    assert.equal(r.status, 'committed', JSON.stringify(r));
  };
  const advance = async to => {
    const s = await gustline.call('env.snapshot');
    const r = await gustline.call('env.advance_time', {expected_version: s.version, request_id: 'clock-' + to, virtual_now: to});
    assert.equal(r.status, 'committed', JSON.stringify(r));
  };
  const notifications = async () => (await gustline.call('env.snapshot')).snapshot.data.notifications;
  const inbox = async () => (await mail.call('mail.search', {})).messages;
  return {dir, gustline, mail, router, apply, advance, notifications, inbox,
    close: async () => { await Promise.allSettled(clients.map(c => c.close())); fs.rmSync(dir, {recursive: true, force: true}); }};
  } catch (e) { await Promise.allSettled(clients.map(c => c.close())); fs.rmSync(dir, {recursive: true, force: true}); throw e; }
}

async function main() {
  const report = {};
  // Cases 1, 2 and 4 with the channel granted.
  const w = await world(true);
  try {
    const before = (await w.inbox()).length;
    await w.apply(require('../scenario.json'));                         // AQI 132 at Kids' school, Fri 10:05
    const first = await publisher.deliver({infra: w.gustline, router: w.router});
    assert.equal(first.length, 1);
    assert.equal(first[0].receipt.status, 'committed', JSON.stringify(first[0].receipt));
    const n = (await w.notifications())[0];
    assert.equal(n.status, 'delivered');
    assert.equal(n.outcome.router_event_id, first[0].receipt.event_id);
    const got = await w.mail.call('mail.get', {id: first[0].receipt.event_id});
    assert.equal(got.status, 'ok');
    assert.equal(got.message.subject, "AQI 132 at Kids' school");
    assert.equal((await w.inbox()).length, before + 1);
    report.case1_delivered = {notification_id: n.notification_id, mail_message_id: got.message.id, subject: got.message.subject};
    // Case 2: republishing the same notification is a duplicate; Mail is unchanged.
    const again = await w.router.call('router.publish', {request_id: n.notification_id, message: publisher.message({account_id: 'gustline-maya'}, n)});
    assert.equal(again.duplicate, true);
    assert.equal((await w.inbox()).length, before + 1);
    report.case2_duplicate = {duplicate: again.duplicate, inbox_unchanged: true};
    // Case 4: a forecast issued at 23:10 is held by quiet hours and published only after the clock passes 07:00.
    await w.apply({event_id: 'ev-fc-2310', at: '2027-10-08T23:10:00-07:00', operation: 'weather.forecast_issued',
      payload: issuance({id: 'fc-2310', issued: '2027-10-08T23:00:00-07:00', gust: t => (t === Date.parse('2027-10-09T17:00:00-07:00') ? 62 : 20)})});
    assert.equal((await publisher.deliver({infra: w.gustline, router: w.router})).length, 0);
    const held = (await w.notifications()).find(x => x.rule_id === 'rule-2');
    assert.equal(held.status, 'held_quiet_hours');
    await w.advance('2027-10-09T07:00:00-07:00');                        // env.advance_time: no App code runs
    const released = await publisher.deliver({infra: w.gustline, router: w.router});
    assert.equal(released.length, 1);
    assert.equal(released[0].notification_id, held.notification_id);
    assert.equal(released[0].receipt.status, 'committed');
    assert.equal((await w.inbox()).length, before + 2);
    report.case4_quiet_hours = {notification_id: held.notification_id, released_at: '2027-10-09T07:00:00-07:00', receipt: released[0].receipt.status};
  } finally { await w.close(); }
  // Case 3: without a grant the message is rejected, Mail is unchanged and the notification is delivery_failed.
  const u = await world(false);
  try {
    const before = (await u.inbox()).length;
    await u.apply(require('../scenario.json'));
    const out = await publisher.deliver({infra: u.gustline, router: u.router});
    assert.equal(out[0].receipt.status, 'rejected');
    assert.equal(out[0].receipt.code, 'recipient_not_authorized');
    assert.equal((await u.inbox()).length, before);
    assert.equal((await u.notifications())[0].status, 'delivery_failed');
    report.case3_ungranted = {code: out[0].receipt.code, inbox_unchanged: true, status: 'delivery_failed'};
  } finally { await u.close(); }
  return report;
}

module.exports = {main};
if (require.main === module) main().then(r => { console.log(JSON.stringify(r, null, 2)); console.log('PASS: Gustline → Messaging → Mail, 4 cases.'); })
  .catch(e => { console.error(e); process.exitCode = 1; });
