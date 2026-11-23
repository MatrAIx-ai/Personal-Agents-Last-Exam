'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const argv = process.argv.slice(2);
const option = (name, fallback) => { const i = argv.lastIndexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const appDir = path.resolve(__dirname, '..');
const runtimeSource = path.resolve(option('--runtime', process.env.PALE_RUNTIME_ROOT || path.join(appDir, '..', '..', 'runtime')));
const mailSource = path.resolve(option('--with', path.join(path.dirname(runtimeSource), 'examples', 'apps', 'mail')));
const reportFile = option('--report', null);
const sender = require('../infra/sender.cjs');
const { compile } = require('./schema-validator.cjs');

const checks = [];
const check = (name, ok) => { assert.ok(ok, name); checks.push({ name, status: 'passed' }); };
const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push({ name, status: 'passed' }); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const CHECKOUT = { address_id: 'a-1', card_id: 'c-1', when: { mode: 'asap' }, tip_cents: 300 };
const MAIL_ACCOUNT = { app_id: 'mail', account_id: 'mail-p-1', owner_person_id: 'p-1' };

function stage(root) {
  fs.cpSync(runtimeSource, path.join(root, 'runtime'), { recursive: true });
  fs.cpSync(appDir, path.join(root, 'apps', 'plateway'), { recursive: true });
  fs.cpSync(mailSource, path.join(root, 'apps', 'mail'), { recursive: true });
  const mail = read(path.join(mailSource, 'app.json'));
  fs.writeFileSync(path.join(root, 'registry.mail.json'), JSON.stringify({ schema_version: 1, apps: [{ app_id: 'mail', version: mail.version, path: 'apps/mail' }], initial_time: read(path.join(mailSource, 'fixtures/clock.json')).initial_time }));
}

async function main(root, opened) {
  const runtimeDir = path.join(root, 'runtime');
  const { prepare } = require(path.join(runtimeDir, 'prepare.cjs'));
  const { Client } = require(path.join(runtimeDir, 'client.cjs'));
  const { create: createRouter } = require(path.join(runtimeDir, 'messaging', 'src', 'router.cjs'));
  equal('Mail 1.3.0 is the receiver', read(path.join(mailSource, 'app.json')).version, '1.3.0');
  equal('The package wire schema is byte-identical to the runtime contract', fs.readFileSync(path.join(appDir, 'schemas/router-message.schema.json')), fs.readFileSync(path.join(runtimeSource, 'contracts/schemas/router-message.schema.json')));
  equal('The package wire schema is byte-identical to Mail\'s receive schema', fs.readFileSync(path.join(appDir, 'schemas/router-message.schema.json')), fs.readFileSync(path.join(mailSource, 'schemas/router-message.schema.json')));
  const payloadValid = compile(read(path.join(mailSource, 'schemas/email-payload.schema.json')), path.join(mailSource, 'schemas'));

  const prepared = prepare(path.join(root, 'apps', 'plateway'));
  opened.prepared = prepared;
  const state = path.join(root, 'state');
  const clients = opened.clients;
  const track = async c => { clients.push(c); await c.initialize(); return c; };
  const plateway = (role, run) => track(new Client(prepared.app, role, run, path.join(prepared.root, 'state'), 'plateway-mail-check', { registry: prepared.registry }));
  const mail = (role, run) => track(new Client('mail', role, run, path.join(state, run), 'plateway-mail-' + role, { registry: path.join(root, 'registry.mail.json') }));
  const config = (mutate = c => c) => {
    const c = read(path.join(appDir, 'infra/router.config.example.json'));
    c.registry = 'registry.mail.json';
    return mutate(c);
  };
  const configFile = (run, c) => { const file = path.join(root, run + '-router.json'); fs.writeFileSync(file, JSON.stringify(c)); return file; };
  const routerService = async (run, c = config()) => track(new Client(null, null, null, null, 'plateway-router', { commandArgs: [path.join(runtimeDir, 'messaging/service.cjs'), '--config', configFile(run, c), '--publisher', 'plateway', '--run', run, '--state-dir', path.join(state, run)] }));
  const grants = c => c.publishers[0].allowed_recipients;

  const loadMail = async run => {
    const infra = await mail('infra', run);
    const dataset = read(path.join(mailSource, 'contribution/dataset.json'));
    dataset.dataset_id = 'plateway-mail-fixture';
    dataset.expected_counts = { records: 0, assets: 0 };
    const bundle = { dataset, catalog: { schema_version: 'pale.asset-catalog.v1', catalog_id: 'plateway-mail-empty', app_id: 'mail', dataset_ref: 'dataset.json', assets: [], extensions: [] }, blobs: {} };
    const before = await infra.call('env.snapshot');
    const loaded = await infra.call('env.load_seed', {
      expected_version: before.version, request_id: 'plateway-mail', bundle,
      data: { account_id: MAIL_ACCOUNT.account_id, owner_person_id: MAIL_ACCOUNT.owner_person_id, address: MAIL_ACCOUNT.account_id + '@pale.example', messages: [] },
      binding: { people: [{ person_id: 'p-1', name: 'Jordan Lee' }], accounts: [MAIL_ACCOUNT], objects: {} },
      policies: read(path.join(mailSource, 'fixtures/policies.json')),
    });
    assert.equal(loaded.status, 'ready', JSON.stringify(loaded));
    const agent = await mail('agent', run);
    let n = 0;
    const sync = async at => infra.call('env.advance_time', { expected_version: (await infra.call('env.snapshot')).version, virtual_now: at, request_id: run + '-clock-' + (++n) });
    return { infra, agent, sync, records: async () => (await infra.call('env.snapshot')).snapshot.data.messages };
  };

  const loadPlateway = async (run, withMail) => {
    const infra = await plateway('infra', run), agent = await plateway('agent', run);
    let n = 0;
    const version = async () => (await infra.call('env.snapshot')).version;
    if (withMail) {
      const s = await infra.call('env.snapshot');
      const binding = structuredClone(s.snapshot.binding);
      binding.accounts.push(MAIL_ACCOUNT);
      assert.equal((await infra.call('env.load_seed', { expected_version: s.version, data: s.snapshot.data, binding, request_id: run + '-bind' })).status, 'ready');
    }
    const write = async (name, args) => agent.call(name, { ...args, request_id: run + '-' + (++n), expected_version: await version() });
    const event = async (operation, at, payload) => infra.call('env.apply_event', { expected_version: await version(), event: { event_id: run + '-e' + (++n), at, operation, payload } });
    const order = async () => {
      await write('plateway.cart.add_item', { item_id: 'mi-1', option_ids: ['op-2'], quantity: 1 });
      const preview = await agent.call('plateway.checkout.preview', CHECKOUT);
      return write('plateway.orders.place', { ...CHECKOUT, token: preview.token });
    };
    const snapshot = async () => (await infra.call('env.snapshot')).snapshot;
    const advance = async at => infra.call('env.advance_time', { expected_version: await version(), virtual_now: at, request_id: run + '-clock-' + (++n) });
    return { infra, agent, version, write, event, order, snapshot, advance, now: async () => (await snapshot()).virtual_now };
  };

  {
    const run = 'mail-ok';
    const inbox = await loadMail(run);
    const p = await loadPlateway(run, true);
    const placed = await p.order();
    await p.event('order.accepted', '2026-12-04T11:34:00-05:00', { order_id: placed.order_id });
    await p.event('order.picked_up', '2026-12-04T11:52:00-05:00', { order_id: placed.order_id });
    await p.event('order.delivered', '2026-12-04T12:08:00-05:00', { order_id: placed.order_id });
    const snapshot = await p.snapshot();
    const notices = sender.pending(snapshot);
    equal('Only the run notices are pending, not seeded history', notices.map(n => n.kind), ['notice.order_placed', 'notice.order_accepted', 'notice.order_delivered']);
    for (const notice of notices) check('Payload for ' + notice.kind + ' matches the Mail payload schema', payloadValid(sender.message({ epoch: snapshot.epoch, data: snapshot.data }, notice).data));
    await inbox.sync(snapshot.virtual_now);
    const c = config();
    const router = await routerService(run, c);
    const before = await p.version();
    const out = await sender.send({ plateway: p.infra, router, grants: grants(c) });
    equal('Every notice is published with a committed receipt', [out.status, out.receipts.map(r => r.receipt.status)], ['published', ['committed', 'committed', 'committed']]);
    equal('Message and request IDs come from the epoch and the notice', out.receipts.map(r => r.message_id), notices.map(n => 'e' + snapshot.epoch + '-' + n.id));
    const records = await inbox.records();
    equal('One inbox record per notice, received at the synchronized time', records.map(r => [r.id, r.folder, r.subject, r.received_at]), out.receipts.map((r, i) => [r.receipt.event_id, 'inbox', notices[i].title, snapshot.virtual_now]));
    const delivered = await inbox.agent.call('mail.get', { id: out.receipts[2].receipt.event_id });
    equal('The delivered notice reads back in Mail', [delivered.status, delivered.message.body, delivered.message.from.split('@')[0]], ['ok', notices[2].body, snapshot.data.account_id.split('-')[0]]);
    equal('The receipt keeps the notice time as the CloudEvents time', out.receipts.map(r => r.receipt.cloud_event.time), notices.map(n => n.at));
    equal('Publishing leaves Plateway unchanged', await p.version(), before);
    const retry = await sender.send({ plateway: p.infra, router, grants: grants(c) });
    equal('An identical retry in the same Router session returns the first receipts marked duplicate', retry.receipts.map(r => [r.receipt.duplicate, r.receipt.event_id]), out.receipts.map(r => [true, r.receipt.event_id]));
    equal('A retry creates no second record', (await inbox.records()).length, 3);
    assert.equal((await p.infra.call('env.reset', { expected_version: await p.version() })).status, 'ready');
    equal('A Plateway reset leaves Mail records unchanged', (await inbox.records()).length, 3);
    const mailNow = (await inbox.infra.call('env.snapshot')).snapshot.virtual_now;
    await p.advance(mailNow);
    await p.order();
    equal('Both clocks agree before the next delivery', Date.parse(await p.now()), Date.parse((await inbox.infra.call('env.snapshot')).snapshot.virtual_now));
    const after = await sender.send({ plateway: p.infra, router, grants: grants(c) });
    const epoch = (await p.snapshot()).epoch;
    equal('A notice written after a reset is a new message', [after.status, after.receipts.map(r => r.message_id), (await inbox.records()).length], ['published', ['e' + epoch + '-n-4'], 4]);
  }
  {
    const run = 'mail-ungranted';
    const inbox = await loadMail(run);
    const p = await loadPlateway(run, true);
    await p.order();
    await inbox.sync(await p.now());
    const denied = config(c => { c.publishers[0].allowed_recipients = []; return c; });
    const router = await routerService(run, denied);
    const skipped = await sender.send({ plateway: p.infra, router, grants: grants(denied) });
    equal('Without an Infra grant the sender publishes nothing', [skipped.status, skipped.reason, skipped.pending], ['skipped', 'no_email_grant', ['n-4']]);
    const forced = await sender.send({ plateway: p.infra, router, grants: grants(config()) });
    equal('An ungranted publish is refused by the Router before dispatch, without halting', [forced.status, forced.receipts[0].receipt.code, forced.receipts[0].receipt.stop_run], ['rejected', 'recipient_not_authorized', undefined]);
    equal('A refused publish creates no Mail record', (await inbox.records()).length, 0);
    equal('The Router stays available after a pre-dispatch refusal', (await router.call('router.capabilities', {})).halted, false);
  }
  {
    const run = 'mail-incompatible';
    const inbox = await loadMail(run);
    const copy = path.join(root, 'apps', 'plateway-incompatible');
    fs.cpSync(path.join(root, 'apps', 'plateway'), copy, { recursive: true });
    const schemaFile = path.join(copy, 'schemas/router-message.schema.json');
    fs.writeFileSync(schemaFile, JSON.stringify({ ...read(schemaFile), description: 'A changed copy whose content no longer matches the receiver.' }, null, 2));
    const router = await routerService(run, config(c => { c.publishers[0].package_root = 'apps/plateway-incompatible'; return c; }));
    const p = await loadPlateway(run, true);
    await p.order();
    const s = await p.snapshot();
    const wire = sender.message(s, sender.pending(s)[0]);
    const receipt = await router.call('router.publish', { request_id: wire.id, message: wire });
    equal('An incompatible contract is rejected before dispatch', [receipt.status, receipt.code, receipt.stop_run], ['rejected', 'incompatible_contract', undefined]);
    equal('An incompatible contract creates no Mail record', (await inbox.records()).length, 0);
  }
  {
    const run = 'mail-reject';
    const inbox = await loadMail(run);
    const p = await loadPlateway(run, true);
    await p.order();
    const s = await p.snapshot();
    await inbox.sync(s.virtual_now);
    const before = await p.infra.call('env.snapshot');
    const router = await routerService(run);
    const wire = sender.message(s, sender.pending(s)[0]);
    wire.id = 'e' + s.epoch + '-' + 'x'.repeat(98);
    const rejected = await router.call('router.publish', { request_id: 'reject-1', message: wire });
    equal('A receiver rejection halts the Router', [rejected.status, rejected.code, rejected.stop_run], ['rejected', 'receiver_rejected', true]);
    equal('A receiver rejection creates no Mail record', (await inbox.records()).length, 0);
    const after = await p.infra.call('env.snapshot');
    equal('A receiver rejection leaves Plateway committed state', [after.snapshot.data, after.version], [before.snapshot.data, before.version]);
    equal('Later deliveries wait for reconciliation', (await sender.send({ plateway: p.infra, router, grants: grants(config()) })).status, 'halted');
  }
  {
    const run = 'mail-receiver-reset';
    const inbox = await loadMail(run);
    const p = await loadPlateway(run, true);
    await p.order();
    await inbox.sync(await p.now());
    const router = await routerService(run);
    assert.equal((await inbox.infra.call('env.reset', { expected_version: (await inbox.infra.call('env.snapshot')).version })).status, 'ready');
    const out = await sender.send({ plateway: p.infra, router, grants: grants(config()) });
    equal('A receiver reset after Router setup invalidates the route', [out.status, out.receipts[0].receipt.code, out.receipts[0].receipt.stop_run], ['rejected', 'receiver_lifecycle_changed', true]);
    equal('No Mail record is created after the receiver reset', (await inbox.records()).length, 0);
  }
  const lostAcknowledgement = async (run, afterLoss) => {
    const inbox = await loadMail(run);
    const p = await loadPlateway(run, true);
    await p.order();
    const s = await p.snapshot();
    await inbox.sync(s.virtual_now);
    const router = await createRouter({ config: configFile(run, config()), publisher: 'plateway', run, stateDir: path.join(state, run) });
    opened.routers.push(router);
    const setup = await sender.receiverSetup(inbox.infra);
    const before = await p.infra.call('env.snapshot');
    const original = Client.prototype.call;
    let drop = true;
    Client.prototype.call = async function (name, args) {
      const result = await original.call(this, name, args);
      if (drop && name === 'env.apply_event' && this.clientName === 'pale-router-receiver') { drop = false; throw new Error('acknowledgement lost'); }
      return result;
    };
    let lost;
    try {
      lost = await sender.send({ plateway: p.infra, router, grants: grants(config()) });
    } finally { Client.prototype.call = original; }
    await afterLoss(inbox);
    const reconciled = await sender.reconcile({ mail: inbox.infra, setup, outcome: lost });
    const after = await p.infra.call('env.snapshot');
    const halted = (await sender.send({ plateway: p.infra, router, grants: grants(config()) })).status;
    return { lost, reconciled, records: await inbox.records(), plateway: [before, after], halted };
  };
  {
    const r = await lostAcknowledgement('mail-lost', async () => {});
    const receipt = r.lost.receipts[0].receipt;
    equal('A lost acknowledgement is unknown and halts the Router', [r.lost.status, receipt.code, receipt.stop_run, r.lost.event_id], ['unknown', 'receiver_unconfirmed', true, receipt.event_id]);
    equal('Reconciliation in the same Mail epoch finds the committed event and exactly one record', [r.reconciled, r.records.map(m => m.id)], [{ status: 'committed', event_id: r.lost.event_id, record_id: r.lost.event_id }, [r.lost.event_id]]);
    equal('Plateway stays committed after an unknown acknowledgement', [r.plateway[1].snapshot.data, r.plateway[1].version], [r.plateway[0].snapshot.data, r.plateway[0].version]);
    equal('The halted Router accepts no further delivery', r.halted, 'halted');
  }
  {
    const r = await lostAcknowledgement('mail-lost-reset', async inbox => {
      assert.equal((await inbox.infra.call('env.reset', { expected_version: (await inbox.infra.call('env.snapshot')).version })).status, 'ready');
    });
    equal('After a receiver reset the unknown outcome is recorded as indeterminate', [r.lost.status, r.reconciled.status, r.reconciled.reason], ['unknown', 'indeterminate', 'receiver_changed']);
  }
  {
    const run = 'mail-none';
    const inbox = await loadMail(run);
    const p = await loadPlateway(run, false);
    await p.order();
    const router = await routerService(run);
    const out = await sender.send({ plateway: p.infra, router, grants: grants(config()) });
    equal('Without a bound Mail account nothing is published', [out.status, out.reason, out.pending], ['skipped', 'no_mail_account', ['n-4']]);
    equal('No Mail record is created', (await inbox.records()).length, 0);
    equal('The notice stays in the Plateway log', (await p.snapshot()).data.notices.map(n => n.id).at(-1), 'n-4');
  }
}

const write = report => { if (reportFile) { fs.mkdirSync(path.dirname(path.resolve(reportFile)), { recursive: true }); fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n'); } };
(async () => {
  let root = null;
  const opened = { clients: [], routers: [], prepared: null };
  try {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'plateway-mail-'));
    stage(root);
    await main(root, opened);
    write({ schema: 'plateway.mail-integration.v1', receiver: 'mail ' + read(path.join(mailSource, 'app.json')).version, node: process.version, checks, passed: true });
    console.log('mail integration passed ' + checks.length + ' checks');
  } catch (error) {
    write({ schema: 'plateway.mail-integration.v1', checks, passed: false, error: error.message });
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([...opened.clients.map(c => c.close()), ...opened.routers.map(r => r.close())]);
    if (opened.prepared) opened.prepared.cleanup();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
})();
