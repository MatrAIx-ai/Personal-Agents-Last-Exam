'use strict';
// Curbline → Messaging → Mail through the public runtime, with three Mail instances (booker Maya,
// rider Jon, sharee Ava). Each instance has its own router configuration, receiver_state_namespace and
// channel.email grant, following examples/workflows/mail-to-mail/. Run from a full checkout:
//   node apps/curbline/examples/mail-integration/run.cjs
// Cases: (1) booking_confirmed reaches Maya's inbox and pickup_details reaches Jon's separate inbox,
// each with a committed receipt; (2) republishing returns duplicate: true; (3) an ungranted recipient is
// rejected, that Mail instance is unchanged and the notification becomes delivery_failed; (4) Ava's
// inbox, with share scope status, has no vehicle or ETA text.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const pkg = path.resolve(__dirname, '../..');
let root = pkg; while (!fs.existsSync(path.join(root, 'runtime/client.cjs'))) { const up = path.dirname(root); if (up === root) throw Error('Run inside the PALE checkout'); root = up; }
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const publisher = require('../../src/publisher.cjs');
const {airportRide, assign} = require('../../tests/helpers.cjs');
const MAIL_REGISTRY = path.join(root, 'examples/registry.mail.json');
const RUN = 'curbline-mail', NOW = '2026-12-03T19:00:00-05:00';

const PEOPLE = [['person-maya', 'Maya Chen', 'maya'], ['person-jon', 'Jon Okafor', 'jon'], ['person-ava', 'Ava Chen', 'ava']];
const binding = {people: PEOPLE.map(([person_id, name]) => ({person_id, name})),
  accounts: [{app_id: 'curbline', account_id: 'curbline-maya', owner_person_id: 'person-maya'},
    ...PEOPLE.map(([person_id, , s]) => ({app_id: 'mail', account_id: 'mail-' + s, owner_person_id: person_id}))], objects: {}};
function mailBundle() {
  const dataset = JSON.parse(fs.readFileSync(path.join(root, 'examples/apps/mail/contribution/dataset.json')));
  dataset.dataset_id = 'curbline-mail-recipients'; dataset.description = 'Empty synthetic inboxes for the Curbline integration example';
  dataset.expected_counts = {records: 0, assets: 0};
  return {dataset, catalog: {schema_version: 'pale.asset-catalog.v1', catalog_id: 'curbline-mail-empty', app_id: 'mail', dataset_ref: 'dataset.json', assets: [], extensions: []}, blobs: {}};
}

async function world(ungranted = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curbline-mail-')), clients = [];
  const open = async c => { clients.push(c); await c.initialize(); return c; };
  try {
    fs.cpSync(pkg, path.join(dir, 'pkg/curbline'), {recursive: true});
    const registry = path.join(dir, 'pkg/registry.json');
    fs.writeFileSync(registry, JSON.stringify({schema_version: 1, apps: [{app_id: 'curbline', version: '1.0.0', path: 'curbline'}], initial_time: NOW}));
    const infra = await open(new Client('curbline', 'infra', RUN, dir, 'curbline-infra', {registry}));
    const agent = await open(new Client('curbline', 'agent', RUN, dir, 'curbline-agent', {registry}));
    let s = await infra.call('env.snapshot');
    const loaded = await infra.call('env.load_seed', {expected_version: s.version, request_id: 'seed', virtual_now: NOW, binding,
      data: JSON.parse(fs.readFileSync(path.join(pkg, 'fixtures/minimal.json')))});
    assert.equal(loaded.status, 'ready', JSON.stringify(loaded));
    // One Mail instance per recipient, each under its own namespace, plus one router configuration each.
    const inboxes = {}, routers = {};
    for (const [person, , short] of PEOPLE) {
      const ns = 'mail-' + short, stateDir = path.join(dir, ns);
      const mailInfra = await open(new Client('mail', 'infra', RUN, stateDir, ns + '-infra', {registry: MAIL_REGISTRY}));
      const m = await mailInfra.call('env.snapshot');
      const seeded = await mailInfra.call('env.load_seed', {expected_version: m.version, request_id: 'inbox-' + short, binding, bundle: mailBundle(),
        data: {account_id: ns, owner_person_id: person, address: short + '@pale.example', messages: []}});
      assert.equal(seeded.status, 'ready', JSON.stringify(seeded));
      inboxes[person] = await open(new Client('mail', 'agent', RUN, stateDir, ns + '-reader', {registry: MAIL_REGISTRY}));
      const config = path.join(dir, 'router-' + short + '.json');
      fs.writeFileSync(config, JSON.stringify({schema_version: 2, registry: 'examples/registry.mail.json', receiver_state_namespace: ns,
        publishers: [{app_id: 'curbline', account_id: 'curbline-maya', owner_person_id: 'person-maya', package_root: path.relative(root, pkg),
          contribution_ref: 'contribution/contribution.json',
          allowed_recipients: person === ungranted ? [] : [{app_id: 'mail', account_id: ns, channel: 'channel.email'}]}],
        authentication: {mode: 'trusted-stdio'}}));
      routers[person] = await open(new Client(null, null, null, null, 'curbline-router-' + short, {commandArgs: [path.join(root, 'runtime/messaging/service.cjs'),
        '--config', config, '--publisher', 'curbline', '--run', RUN, '--state-dir', dir]}));
    }
    const write = async (name, args) => {
      const v = (await infra.call('env.snapshot')).version;
      const r = await agent.call(name, {...args, request_id: name + '-' + v.revision, expected_version: v});
      assert.equal(r.status, 'committed', JSON.stringify(r));
      return r;
    };
    const apply = async event => {
      const v = (await infra.call('env.snapshot')).version;
      const r = await infra.call('env.apply_event', {expected_version: v, event});
      assert.equal(r.status, 'committed', JSON.stringify(r));
    };
    const notifications = async () => (await infra.call('env.snapshot')).snapshot.data.notifications;
    const inbox = async person => (await inboxes[person].call('mail.search', {})).messages;
    const message = async (person, id) => (await inboxes[person].call('mail.get', {id})).message;
    return {infra, agent, routers, write, apply, notifications, inbox, message,
      close: async () => { await Promise.allSettled(clients.map(c => c.close())); fs.rmSync(dir, {recursive: true, force: true}); }};
  } catch (e) { await Promise.allSettled(clients.map(c => c.close())); fs.rmSync(dir, {recursive: true, force: true}); throw e; }
}

// Maya books for Jon and shares the ride with Ava (scope status); a driver is assigned.
async function scenario(w) {
  const q = (await w.agent.call('curbline.rides.quote', airportRide({flight: undefined, pickup_buffer_min: undefined}))).quote;
  const booked = await w.write('curbline.bookings.create', {quote_token: q.quote_token, payment_method_id: 'pm-work', rider_person_id: 'person-jon'});
  await w.write('curbline.shares.create', {booking_id: booked.booking_id, person_id: 'person-ava', scope: 'status', until: '2026-12-04T06:00:00-05:00'});
  await w.apply(assign('2026-12-03T22:50:00-05:00', booked.booking_id, '2026-12-03T23:10:00-05:00'));
  return booked.booking_id;
}

async function main() {
  const report = {};
  const w = await world();
  try {
    await scenario(w);
    const sent = await publisher.deliver({infra: w.infra, routers: w.routers});
    assert.ok(sent.length >= 6 && sent.every(r => r.receipt.status === 'committed'), JSON.stringify(sent.map(r => r.receipt)));
    const byId = Object.fromEntries((await w.notifications()).map(n => [n.notification_id, n]));
    // Case 1: the booker's and the rider's separate inboxes.
    const confirmed = byId['n-bk7-confirmed-1-maya'], pickup = byId['n-bk7-pickup-1-jon'];
    assert.deepEqual([confirmed.status, pickup.status], ['delivered', 'delivered']);
    const maya = await w.inbox('person-maya'), jon = await w.inbox('person-jon');
    assert.ok(maya.some(m => m.subject === confirmed.title), 'booking_confirmed in Maya\'s inbox');
    assert.ok(jon.some(m => m.subject === pickup.title), 'pickup_details in Jon\'s inbox');
    assert.ok(!maya.some(m => m.subject === pickup.title) && !jon.some(m => m.subject === confirmed.title), 'each inbox holds only its own messages');
    const got = await w.message('person-maya', confirmed.outcome.router_event_id);
    assert.equal(got.body, confirmed.body);
    report.case1_delivered = {maya: {notification_id: confirmed.notification_id, router_event_id: confirmed.outcome.router_event_id, subject: got.subject},
      jon: {notification_id: pickup.notification_id, router_event_id: pickup.outcome.router_event_id}};
    // Case 2: republishing is a duplicate; Mail is unchanged.
    const again = await w.routers['person-maya'].call('router.publish', {request_id: confirmed.notification_id,
      message: publisher.message({account_id: 'curbline-maya'}, confirmed)});
    assert.equal(again.duplicate, true);
    assert.equal((await w.inbox('person-maya')).length, maya.length);
    report.case2_duplicate = {duplicate: again.duplicate, inbox_unchanged: true};
    // Case 4: the sharee's inbox carries status only.
    const ava = await w.inbox('person-ava');
    const avaIds = Object.values(byId).filter(n => n.recipient_person_id === 'person-ava').map(n => n.kind);
    assert.deepEqual(avaIds, ['share_started', 'share_update']);
    assert.equal(ava.length, 2);
    for (const m of ava) {
      const full = await w.message('person-ava', m.id);
      assert.doesNotMatch(full.subject + ' ' + full.body, /ASH 4417|Hybrid sedan|ETA|\$/, 'no vehicle, ETA or fare for scope status');
    }
    report.case4_sharee_status_only = {messages: ava.map(m => m.subject)};
  } finally { await w.close(); }
  // Case 3: Ava's channel is not granted.
  const u = await world('person-ava');
  try {
    await scenario(u);
    const out = await publisher.deliver({infra: u.infra, routers: u.routers});
    const toAva = out.filter(r => r.recipient_person_id === 'person-ava');
    assert.ok(toAva.length && toAva.every(r => r.receipt.status === 'rejected' && r.receipt.code === 'recipient_not_authorized'), JSON.stringify(toAva));
    assert.equal((await u.inbox('person-ava')).length, 0);
    const n = (await u.notifications()).filter(x => x.recipient_person_id === 'person-ava');
    assert.ok(n.every(x => x.status === 'delivery_failed'));
    assert.ok(out.filter(r => r.recipient_person_id !== 'person-ava').every(r => r.receipt.status === 'committed'), 'other recipients still delivered');
    report.case3_ungranted = {code: toAva[0].receipt.code, inbox_unchanged: true, statuses: n.map(x => x.status)};
  } finally { await u.close(); }
  return report;
}

module.exports = {main};
if (require.main === module) main().then(r => { console.log(JSON.stringify(r, null, 2)); console.log('PASS: Curbline → Messaging → Mail, 4 cases, 3 Mail instances.'); })
  .catch(e => { console.error(e); process.exitCode = 1; });
