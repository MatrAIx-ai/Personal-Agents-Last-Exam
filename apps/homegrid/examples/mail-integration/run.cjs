'use strict';
// Homegrid → Messaging → Mail through the public runtime. Run from a full checkout:
//   node apps/homegrid/examples/mail-integration/run.cjs
// Cases: (1) a boil-water advisory reaches Mail's inbox during quiet hours with a committed receipt;
// (2) republishing is a duplicate with Mail unchanged; (3) an ungranted recipient is rejected, Mail is
// unchanged and the notification becomes delivery_failed; (4) a billing notice held by quiet hours is
// published once, only after env.advance_time.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const pkg = path.resolve(__dirname, '../..');
let root = pkg; while (!fs.existsSync(path.join(root, 'runtime/client.cjs'))) { const up = path.dirname(root); if (up === root) throw Error('Run inside the PALE checkout'); root = up; }
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const publisher = require('../../src/publisher.cjs');
const MAIL_REGISTRY = path.join(root, 'examples/registry.mail.json');

// Homegrid seed owned by Maya, the owner of the reference Mail account (earlier in-app notices dropped,
// since their trigger keys name the fixture's person). Quiet hours run 22:00-09:30.
const START = require('../../fixtures/clock.json').initial_time;
function seed() {
  const data = structuredClone(require('../../fixtures/minimal.json'));
  data.account_id = 'homegrid-maya'; data.owner_person_id = 'person-maya'; data.customer.name = 'Maya Chen';
  data.notifications = []; data.preferences.quiet_hours = {start: '22:00', end: '09:30'};
  return data;
}
const binding = {people: [{person_id: 'person-maya', name: 'Maya Chen'}], accounts: [{app_id: 'homegrid', account_id: 'homegrid-maya', owner_person_id: 'person-maya'}],
  objects: {homegrid: ['pr-maple-22', 'pr-linden-14']}};
const ADVISORY = 'n-adv-bw7-1-maya', BILL = 'n-bl-0131-1-maya';

const step = m => process.env.HOMEGRID_DEBUG && console.error('[step]', m);
async function world(granted) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homegrid-mail-')), clients = [];
  // Copy the package so its registry can sit beside it (registry paths must stay inside the registry folder).
  fs.cpSync(pkg, path.join(dir, 'pkg/homegrid'), {recursive: true, filter: s => !s.includes('node_modules')});
  const registry = path.join(dir, 'pkg/registry.json');
  fs.writeFileSync(registry, JSON.stringify({schema_version: 1, apps: [{app_id: 'homegrid', version: '1.0.0', path: 'homegrid'}],
    initial_time: START}));
  const config = path.join(dir, 'router.json');
  fs.writeFileSync(config, JSON.stringify({schema_version: 2, registry: 'examples/registry.mail.json', publishers: [{
    app_id: 'homegrid', account_id: 'homegrid-maya', owner_person_id: 'person-maya', package_root: path.relative(root, pkg),
    contribution_ref: 'contribution/contribution.json',
    allowed_recipients: granted ? [{app_id: 'mail', account_id: 'mail-maya', channel: 'channel.email'}] : []}],
    authentication: {mode: 'trusted-stdio'}}));
  step('copied');
  const run = 'homegrid-mail';
  try {
  const homegrid = new Client('homegrid', 'infra', run, dir, 'homegrid-infra', {registry}); clients.push(homegrid); await homegrid.initialize(); step('homegrid up');
  const mail = new Client('mail', 'agent', run, dir, 'mail-reader', {registry: MAIL_REGISTRY}); clients.push(mail); await mail.initialize(); step('mail up');
  const router = new Client(null, null, null, null, 'homegrid-router', {commandArgs: [path.join(root, 'runtime/messaging/service.cjs'),
    '--config', config, '--publisher', 'homegrid', '--run', run, '--state-dir', dir]}); clients.push(router); await router.initialize(); step('router up');
  const snap = await homegrid.call('env.snapshot');
  const loaded = await homegrid.call('env.load_seed', {expected_version: snap.version, request_id: 'seed-maya', data: seed(), binding,
    virtual_now: START});
  assert.equal(loaded.status, 'ready', JSON.stringify(loaded)); step('seeded');
  const apply = async event => {
    const s = await homegrid.call('env.snapshot');
    const r = await homegrid.call('env.apply_event', {expected_version: s.version, event});
    assert.equal(r.status, 'committed', JSON.stringify(r));
  };
  const advance = async to => {
    const s = await homegrid.call('env.snapshot');
    const r = await homegrid.call('env.advance_time', {expected_version: s.version, request_id: 'clock-' + to, virtual_now: to});
    assert.equal(r.status, 'committed', JSON.stringify(r));
  };
  const notifications = async () => (await homegrid.call('env.snapshot')).snapshot.data.notifications;
  const inbox = async () => (await mail.call('mail.search', {})).messages;
  return {dir, homegrid, mail, router, apply, advance, notifications, inbox,
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
    await w.apply(require('../scenario.json'));                         // boil-water advisory, Wed 09:00 (quiet hours)
    const first = await publisher.deliver({infra: w.homegrid, router: w.router});
    assert.equal(first.length, 1);
    assert.equal(first[0].receipt.status, 'committed', JSON.stringify(first[0].receipt));
    const n = await note(w, ADVISORY);
    assert.equal(n.status, 'delivered');
    assert.equal(n.outcome.router_event_id, first[0].receipt.event_id);
    const got = await w.mail.call('mail.get', {id: first[0].receipt.event_id});
    assert.equal(got.status, 'ok');
    assert.equal(got.message.subject, 'Boil-water advisory for 22 Maple St, Fairmont');
    assert.equal((await w.inbox()).length, before + 1);
    report.case1_delivered = {notification_id: n.notification_id, mail_message_id: got.message.id, subject: got.message.subject};
    // Case 2: republishing the same notification is a duplicate; Mail is unchanged.
    const again = await w.router.call('router.publish', {request_id: n.notification_id, message: publisher.message({account_id: 'homegrid-maya'}, n)});
    assert.equal(again.duplicate, true);
    assert.equal((await w.inbox()).length, before + 1);
    report.case2_duplicate = {duplicate: again.duplicate, inbox_unchanged: true};
    // Case 4: a bill closing at 23:59 is held by quiet hours and published only after the clock passes 09:30.
    await w.apply({event_id: 'ev-cycle-0131', at: '2027-01-31T23:59:00-05:00', operation: 'billing.cycle_closed', payload: {bill_id: 'bl-0131',
      period: {from: '2027-01-01', to: '2027-01-31'}, usage: {'sv-pr-maple-22-electricity': {kwh: 498}, 'sv-pr-maple-22-water': {gal: 3020}}}});
    assert.equal((await publisher.deliver({infra: w.homegrid, router: w.router})).length, 0);
    const held = await note(w, BILL);
    assert.deepEqual([held.status, held.release_at], ['held_quiet_hours', '2027-02-01T09:30:00-05:00']);
    await w.advance('2027-02-01T09:30:00-05:00');                        // env.advance_time: no App code runs
    const released = await publisher.deliver({infra: w.homegrid, router: w.router});
    assert.equal(released.length, 1);
    assert.equal(released[0].notification_id, BILL);
    assert.equal(released[0].receipt.status, 'committed');
    assert.equal((await publisher.deliver({infra: w.homegrid, router: w.router})).length, 0, 'sent once');
    assert.equal((await w.inbox()).length, before + 2);
    report.case4_quiet_hours = {notification_id: BILL, released_at: held.release_at, receipt: released[0].receipt.status};
  } finally { await w.close(); }
  // Case 3: without a grant the message is rejected, Mail is unchanged and the notification is delivery_failed.
  const u = await world(false);
  try {
    const before = (await u.inbox()).length;
    await u.apply(require('../scenario.json'));
    const out = await publisher.deliver({infra: u.homegrid, router: u.router});
    assert.equal(out[0].receipt.status, 'rejected');
    assert.equal(out[0].receipt.code, 'recipient_not_authorized');
    assert.equal((await u.inbox()).length, before);
    assert.equal((await note(u, ADVISORY)).status, 'delivery_failed');
    report.case3_ungranted = {code: out[0].receipt.code, inbox_unchanged: true, status: 'delivery_failed'};
  } finally { await u.close(); }
  return report;
}

module.exports = {main};
if (require.main === module) main().then(r => { console.log(JSON.stringify(r, null, 2)); console.log('PASS: Homegrid → Messaging → Mail, 4 cases.'); })
  .catch(e => { console.error(e); process.exitCode = 1; });
