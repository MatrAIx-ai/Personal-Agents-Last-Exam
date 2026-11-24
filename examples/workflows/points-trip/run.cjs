'use strict';
// Waypoint → Skyline / Harbor points trip over real MCP processes and Messaging:
// pool points, transfer, ticket an award, sell out the rest, take a free schedule-change
// alternative, transfer to Harbor and book with a certificate, deliver notices to Mail,
// and refund a rejected credit. Every outcome is read back from the receiving App.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Client} = require('../../../runtime/client.cjs');
const {deliverable, settleEvent} = require('../../../apps/waypoint/src/settlement.cjs');
const root = path.resolve(__dirname, '../../..');
const registry = path.join(root, 'registry.points.json');
const copy = value => structuredClone(value);
const T = require('./timeline.json');

async function run() {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-points-trip-'));
  const meiState = path.join(state, 'mei');
  fs.mkdirSync(meiState);
  const clients = [], checks = [];
  let sequence = 0;
  const equal = (label, actual, expected) => { assert.deepEqual(actual, expected, label); checks.push(label); };
  const ok = (label, condition) => { assert.ok(condition, label); checks.push(label); };
  async function open(app, role, run = 'points', directory = state) {
    const client = new Client(app, role, run, directory, 'points-trip-workflow', {registry});
    clients.push(client); await client.initialize(); return client;
  }
  async function version(infra) { return (await infra.call('env.snapshot')).version; }
  async function write(agent, infra, name, args) {
    const result = await agent.call(name, {...args, expected_version:await version(infra), request_id:'write-' + (++sequence)});
    assert.equal(result.status, 'committed', JSON.stringify({name, result})); return result;
  }
  async function event(infra, e) {
    const receipt = await infra.call('env.apply_event', {expected_version:await version(infra), event:e});
    assert.equal(receipt.status, 'committed', JSON.stringify({event:e.event_id, receipt})); return receipt;
  }
  async function sandbox(infra) {
    assert.equal((await infra.call('env.reset', {expected_version:await version(infra), profile:'sandbox'})).status, 'ready');
  }
  // Replace an App's seed; the dataset record count follows the App's own `records` hook.
  const plugins = {waypoint:'apps/waypoint', skyline:'apps/skyline', harbor:'apps/harbor', mail:'examples/apps/mail'};
  async function load(infra, transform, bindingTransform = b => b, {dropAssets = false} = {}) {
    const s = await infra.call('env.snapshot'), data = transform(copy(s.snapshot.data)), bundle = copy(s.snapshot.resources.bundle);
    // Daniel's mailbox starts empty, so the reference Mail fixture's media goes with Maya's messages.
    if (dropAssets) { bundle.catalog.assets = []; bundle.blobs = {}; bundle.dataset.expected_counts.assets = 0; }
    bundle.dataset.expected_counts.records = require(path.join(root, plugins[s.snapshot.app_id], 'plugin.cjs')).records(data).length;
    const result = await infra.call('env.load_seed', {expected_version:s.version, request_id:'load-' + (++sequence),
      data, binding:bindingTransform(copy(s.snapshot.binding)), policies:copy(s.snapshot.policies), bundle});
    assert.equal(result.status, 'ready', JSON.stringify(result));
  }
  async function clock(infras, iso) {
    for (const infra of infras) {
      const result = await infra.call('env.advance_time', {expected_version:await version(infra), virtual_now:iso, request_id:'clock-' + (++sequence)});
      assert.ok(result.status === 'committed' || result.status === 'ok', JSON.stringify(result));
    }
  }
  async function router(config, publisher, run = 'points') {
    const client = new Client(null, null, null, null, 'points-trip-router', {commandArgs:[path.join(root, 'runtime/messaging/service.cjs'),
      '--config', path.join(__dirname, config), '--publisher', publisher, '--run', run, '--state-dir', state]});
    clients.push(client); await client.initialize(); return client;
  }
  // The host's delivery loop for one Waypoint account: publish every due transfer and record the outcome.
  async function deliver(agent, infra, bridge) {
    const s = await infra.call('env.snapshot'), results = [];
    for (const t of deliverable(s.snapshot.data, s.snapshot.virtual_now)) {
      const message = (await agent.call('waypoint.transfer.outbound', {id:t.id})).message;
      const receipt = await bridge.call('router.publish', {request_id:'deliver-' + t.id, message});
      const settle = settleEvent(t, receipt, (await infra.call('env.snapshot')).snapshot.virtual_now);
      if (settle) await event(infra, settle);
      results.push({transfer:t.id, message, receipt, settled:!!settle});
    }
    return results;
  }
  const meiSeed = data => ({account_id:'waypoint-mei', owner_person_id:'person-mei', member_name:'Mei Cho',
    household:[{person_id:'person-daniel', name:'Daniel Cho', waypoint_account_id:'waypoint-daniel'}], balance:200000,
    ledger:[{id:'ledger-1', at:'2026-02-01T09:00:00-06:00', kind:'opening', points:200000, balance_after:200000, description:'Opening balance', ref:null}],
    partners:[], bonuses:[], transfers:[]});
  const mailSeed = () => ({account_id:'mail-daniel', owner_person_id:'person-daniel', address:'daniel.cho@example.com', messages:[]});
  const mailBinding = () => ({people:[{person_id:'person-daniel', name:'Daniel Cho'}],
    accounts:[{app_id:'mail', account_id:'mail-daniel', owner_person_id:'person-daniel'}], objects:{}});

  try {
    const waypoint = await open('waypoint', 'agent'), waypointInfra = await open('waypoint', 'infra');
    const skyline = await open('skyline', 'agent'), skylineInfra = await open('skyline', 'infra');
    const harbor = await open('harbor', 'agent'), harborInfra = await open('harbor', 'infra');
    const mail = await open('mail', 'agent'), mailInfra = await open('mail', 'infra');
    const meiInfra = await open('waypoint', 'infra', 'points', meiState);
    const all = [waypointInfra, skylineInfra, harborInfra, mailInfra, meiInfra];

    // Permissions: the Agent has only Daniel's business tools; Infra and other members stay out of reach.
    const tools = (await waypoint.request('tools/list')).result.tools.map(t => t.name);
    ok('Agent sees no Infra operations', tools.every(n => !n.startsWith('env.')));
    equal('Agent cannot settle a transfer', (await waypoint.call('env.apply_event', {expected_version:await version(waypointInfra),
      event:{event_id:'x', at:T.start, operation:'waypoint.transfer.settle', payload:{transfer_id:'transfer-1', outcome:'credited'}}})).status, 'permission_denied');
    equal('Scenario profile is read-only', (await waypoint.call('waypoint.transfer', {partner_id:'skyline', points:1000,
      expected_version:await version(waypointInfra), request_id:'denied'})).status, 'permission_denied');

    await load(meiInfra, meiSeed);
    await load(mailInfra, mailSeed, mailBinding, {dropAssets:true});
    for (const infra of all) await sandbox(infra);
    const mei = await open('waypoint', 'agent', 'points', meiState);

    // 1. Pool points: only Mei's own connection can send her points.
    const pull = await waypoint.call('waypoint.combine', {to_person_id:'person-daniel', points:1000, from_person_id:'person-mei',
      expected_version:await version(waypointInfra), request_id:'pull'});
    ok('Agent cannot name another member as the source of a combine', pull.status !== 'committed');
    equal('Agent connection sees only Daniel\'s account', (await waypoint.call('waypoint.balance', {})).member_person_id, 'person-daniel');
    const danielBefore = (await waypoint.call('waypoint.balance', {})).balance;
    const combine = await write(mei, meiInfra, 'waypoint.combine', {to_person_id:'person-daniel', points:T.combine_points});
    const meiBridge = await router('mei-config.json', 'waypoint');
    const pooled = await deliver(mei, meiInfra, meiBridge);
    equal('Mei → Daniel combine commits through Messaging', pooled.map(p => p.receipt.status), ['committed']);
    const danielCredit = (await waypoint.call('waypoint.balance', {})).ledger.find(r => r.id === pooled[0].receipt.event_id);
    equal('Daniel\'s ledger shows the combine with its sender and message', [danielCredit.kind, danielCredit.points, danielCredit.ref.account_id, danielCredit.ref.message_id],
      ['combine_in', T.combine_points, 'waypoint-mei', pooled[0].message.id]);
    equal('Mei\'s ledger shows the debit and the combine is completed', [(await mei.call('waypoint.balance', {})).balance,
      (await mei.call('waypoint.transfers.get', {id:combine.id})).item.status], [200000 - T.combine_points, 'completed']);
    equal('Daniel\'s balance grows by exactly the combine', (await waypoint.call('waypoint.balance', {})).balance, danielBefore + T.combine_points);

    // 2. Transfer to Skyline; the receiver credits the member and the receipt settles the sender.
    const danielBridge = await router('daniel-config.json', 'waypoint');
    const spoof = copy(pooled[0].message); spoof.id = 'credit-spoof';
    equal('Daniel\'s publisher cannot send as Mei', (await danielBridge.call('router.publish', {request_id:'spoof', message:spoof})).code, 'source_identity_mismatch');
    const skylineBefore = (await skyline.call('skyline.balance', {})).balance;
    const toSkyline = await write(waypoint, waypointInfra, 'waypoint.transfer', {partner_id:'skyline', points:T.skyline_points});
    const delivered = await deliver(waypoint, waypointInfra, danielBridge);
    equal('Waypoint → Skyline credit commits', delivered.map(d => [d.transfer, d.receipt.status, d.receipt.target]),
      [[toSkyline.id, 'committed', {app_id:'skyline', account_id:'skyline-daniel'}]]);
    const skylineBalance = await skyline.call('skyline.balance', {});
    equal('Skyline credits the member with provenance', [skylineBalance.balance - skylineBefore, skylineBalance.ledger.at(-1).ref.object_id],
      [T.skyline_points, toSkyline.id]);
    const settled = (await waypoint.call('waypoint.transfers.get', {id:toSkyline.id})).item;
    equal('Sender records the receiver receipt', [settled.status, settled.receipt.event_id], ['completed', delivered[0].receipt.event_id]);
    const again = await danielBridge.call('router.publish', {request_id:'deliver-again', message:delivered[0].message});
    ok('A repeated transfer message returns the original receipt', again.duplicate === true && again.event_id === delivered[0].receipt.event_id);
    equal('No second credit at Skyline', (await skyline.call('skyline.balance', {})).balance, skylineBalance.balance);

    // 3–5. Ticket the award, sell out the rest, take the free alternative after a schedule change.
    const skylineSteps = await require('./skyline-steps.cjs').run({skyline, skylineInfra, mail, router, write, event, version, equal, ok,
      sync:iso => clock(all, iso)});

    // 6. Transfer to Harbor (released a day later), then book with the certificate and with points.
    const toHarbor = await write(waypoint, waypointInfra, 'waypoint.transfer', {partner_id:'harbor', points:T.harbor_points});
    equal('A delayed transfer is not delivered early', (await deliver(waypoint, waypointInfra, danielBridge)).length, 0);
    const notYet = await waypoint.call('waypoint.transfer.outbound', {id:toHarbor.id});
    equal('Its message cannot be built before release', notYet.status === 'ok' ? 'ok' : notYet.code || notYet.status, 'not_due');
    await clock(all, toHarbor.available_at);
    const harborBefore = (await harbor.call('harbor.account', {})).balance;
    const harborDelivered = await deliver(waypoint, waypointInfra, danielBridge);
    equal('Waypoint → Harbor credit commits at its release time', harborDelivered.map(d => [d.transfer, d.receipt.status]), [[toHarbor.id, 'committed']]);
    const account = await harbor.call('harbor.account', {});
    equal('Harbor credits the member and counts it as activity', [account.balance - harborBefore, account.last_activity_at], [T.harbor_points, toHarbor.available_at]);
    const harborSteps = await require('./harbor-steps.cjs').run({harbor, harborInfra, mail, mailInfra, router, write, version, equal, ok, clock});

    // 7. A credit the receiver refuses is refunded by the sender in a separate commit.
    const rejected = await require('./rejected-credit.cjs').run({open, load, sandbox, write, event, router, deliver, version, equal, ok, T});

    const final = {
      waypoint:(await waypointInfra.call('env.snapshot')).snapshot.data,
      mei:(await meiInfra.call('env.snapshot')).snapshot.data
    };
    return {passed:true, checks,
      combine:{message_id:pooled[0].message.id, receipt:pooled[0].receipt},
      skyline_transfer:{message_id:delivered[0].message.id, receipt:delivered[0].receipt},
      harbor_transfer:{message_id:harborDelivered[0].message.id, receipt:harborDelivered[0].receipt},
      skyline:skylineSteps, harbor:harborSteps, rejected,
      balances:{daniel:final.waypoint.balance, mei:final.mei.balance}};
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    fs.rmSync(state, {recursive:true, force:true});
  }
}
module.exports = {run};
if (require.main === module) run().then(report => console.log(JSON.stringify(report, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
