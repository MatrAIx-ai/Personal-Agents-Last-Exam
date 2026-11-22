'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRuntime} = require('../../../runtime/core/runtime.cjs');
const {Client} = require('../../../runtime/client.cjs');
const {create} = require('../../../runtime/messaging/src/router.cjs');
const {publishPending, reconcile} = require('../src/publisher.cjs');

const root = path.resolve(__dirname, '../../..');
const registry = path.join(root, 'apps.registry.json');
const mailRegistry = path.join(root, 'examples/registry.mail.json');

function mayaSeed() {
  const data = structuredClone(require('../fixtures/minimal.json'));
  data.owner_person_id = 'person-maya';
  data.accounts.find(item => item.account_id === 'fy-tomasreyes').person_id = 'person-maya';
  for (const notice of data.notices) {
    if (notice.account_id === 'fy-tomasreyes') notice.person_id = 'person-maya';
  }
  const seeded = data.notices.find(item => item.notice_id === 'notice-seed');
  if (seeded) seeded.status = 'committed';
  return data;
}

function mayaBinding() {
  const binding = structuredClone(require('../fixtures/binding.json'));
  binding.people.push({person_id: 'person-maya', name: 'Maya Chen'});
  binding.accounts[0].owner_person_id = 'person-maya';
  return binding;
}

function prepare(run) {
  const model = createRuntime({registryFile: registry});
  let state = model.create('forkyard', run, 'sandbox');
  const loaded = model.execute(state, 'infra', 'env.load_seed', {
    expected_version: model.version(state),
    request_id: 'seed-' + run,
    data: mayaSeed(),
    binding: mayaBinding(),
    policies: require('../fixtures/policies.json'),
    virtual_now: '2026-11-18T09:00:00-08:00'
  });
  assert.equal(loaded.result.status, 'ready');
  state = loaded.state;
  const event = require('../examples/scenario.json');
  const applied = model.execute(state, 'infra', 'env.apply_event', {expected_version: model.version(state), event});
  assert.equal(applied.result.status, 'committed');
  const pull = applied.state.data.pulls.find(item => item.number === 2318);
  assert.equal(pull.state, 'closed');
  const notice = applied.state.data.notices.find(item => item.object_id === 'tidewater.tidewater.2318' && item.status === 'pending_delivery');
  assert.equal(notice.person_id, 'person-maya');
  return {model, state: applied.state, notice};
}

function config(file, recipients) {
  fs.writeFileSync(file, JSON.stringify({
    schema_version: 2,
    registry: 'examples/registry.mail.json',
    authentication: {mode: 'trusted-stdio'},
    publishers: [{
      app_id: 'forkyard',
      account_id: 'fy-tomasreyes',
      owner_person_id: 'person-maya',
      package_root: 'apps/forkyard',
      contribution_ref: 'contribution/contribution.json',
      allowed_recipients: recipients
    }]
  }));
}

async function messages(stateDir, run) {
  const mail = new Client('mail', 'infra', run, stateDir, 'mail-inspector', {registry: mailRegistry});
  await mail.initialize();
  try {
    const snap = await mail.call('env.snapshot');
    return snap.snapshot.data.messages;
  } finally {
    await mail.close();
  }
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forkyard-mail-'));
  const clients = [];
  try {
    const allowed = path.join(dir, 'allowed.json');
    config(allowed, [{app_id: 'mail', account_id: 'mail-maya', channel: 'channel.email'}]);
    const run = 'fy-mail-ok';
    const prepared = prepare(run);
    const before = await messages(dir, run);
    const router = new Client(null, null, null, null, 'forkyard-publisher', {
      commandArgs: [path.join(root, 'runtime/messaging/service.cjs'), '--config', allowed, '--publisher', 'forkyard', '--run', run, '--state-dir', dir]
    });
    clients.push(router);
    await router.initialize();
    const sent = await publishPending({notices: prepared.state.data.notices, accountId: 'fy-tomasreyes', router});
    assert.equal(sent.length, 1);
    assert.equal(sent[0].result.status, 'committed');
    assert.equal(sent[0].outcome.delivery, 'confirmed');
    assert.equal(sent[0].outcome.same_run_retry, false);
    const again = await router.call('router.publish', {request_id: sent[0].request_id, message: sent[0].message});
    assert.equal(again.duplicate, true);
    assert.equal(again.event_id, sent[0].result.event_id);
    const after = await messages(dir, run);
    assert.equal(after.length, before.length + 1);
    assert.equal(after.at(-1).id, sent[0].result.event_id);
    assert.match(after.at(-1).body, /at 09:05\./);
    const mail = new Client('mail', 'infra', run, dir, 'mail-status', {registry: mailRegistry});
    clients.push(mail);
    await mail.initialize();
    const receipt = await mail.call('env.event_status', {event_id: sent[0].result.event_id});
    const joined = reconcile({messaging: sent[0].result, mailReceipt: receipt});
    assert.equal(joined.delivery, 'confirmed');
    assert.equal(joined.same_run_retry, false);
    await router.close();

    const deniedDir = path.join(dir, 'denied');
    fs.mkdirSync(deniedDir);
    const deniedConfig = path.join(dir, 'denied.json');
    config(deniedConfig, []);
    const deniedRun = 'fy-mail-denied';
    const deniedState = prepare(deniedRun);
    const deniedBefore = await messages(deniedDir, deniedRun);
    const deniedRouter = new Client(null, null, null, null, 'forkyard-denied', {
      commandArgs: [path.join(root, 'runtime/messaging/service.cjs'), '--config', deniedConfig, '--publisher', 'forkyard', '--run', deniedRun, '--state-dir', deniedDir]
    });
    clients.push(deniedRouter);
    await deniedRouter.initialize();
    const rejected = await publishPending({notices: deniedState.state.data.notices, accountId: 'fy-tomasreyes', router: deniedRouter});
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].result.code, 'recipient_not_authorized');
    assert.equal(rejected[0].outcome.delivery, 'unresolved');
    assert.equal(rejected[0].outcome.source_committed, true);
    assert.equal(rejected[0].outcome.same_run_retry, false);
    assert.equal(deniedState.state.data.pulls.find(item => item.number === 2318).state, 'closed');
    assert.equal((await messages(deniedDir, deniedRun)).length, deniedBefore.length);

    const lostDir = path.join(dir, 'lost');
    fs.mkdirSync(lostDir);
    const lostRun = 'fy-mail-lost';
    const lostState = prepare(lostRun);
    const lostRouter = await create({config: allowed, publisher: 'forkyard', run: lostRun, stateDir: lostDir});
    clients.push(lostRouter);
    const original = Client.prototype.call;
    let lost;
    try {
      Client.prototype.call = async function(name, args) {
        const result = await original.call(this, name, args);
        if (name === 'env.apply_event') throw new Error('Simulated lost acknowledgement');
        return result;
      };
      lost = await publishPending({notices: lostState.state.data.notices, accountId: 'fy-tomasreyes', router: lostRouter});
    } finally {
      Client.prototype.call = original;
    }
    assert.equal(lost.length, 1);
    assert.equal(lost[0].result.status, 'unknown');
    assert.equal(lost[0].outcome.delivery, 'unresolved');
    assert.equal(lost[0].outcome.same_run_retry, false);
    const inspector = new Client('mail', 'infra', lostRun, lostDir, 'mail-lost', {registry: mailRegistry});
    clients.push(inspector);
    await inspector.initialize();
    const persisted = await inspector.call('env.event_status', {event_id: lost[0].result.event_id});
    const traced = reconcile({messaging: lost[0].result, mailReceipt: persisted});
    assert.equal(persisted.receipt.status, 'committed');
    assert.equal(traced.delivery, 'confirmed');
    assert.equal(traced.same_run_retry, false);
    const halted = await lostRouter.call('router.publish', {request_id: 'notice-another', message: lost[0].message});
    assert.equal(halted.code, 'run_halted');
    const stored = (await inspector.call('env.snapshot')).snapshot.data.messages;
    assert.equal(stored.filter(item => item.thread_id === lost[0].message.id).length, 1);
    console.log(JSON.stringify({
      passed: true,
      committed_event_id: sent[0].result.event_id,
      duplicate: true,
      denied: rejected[0].result.code,
      unknown_event_id: lost[0].result.event_id,
      halted: halted.code,
      mail_messages_added: 1
    }, null, 2));
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
