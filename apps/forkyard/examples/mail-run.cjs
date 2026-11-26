'use strict';
// One real Mail run for the closure notice on tidewater/tidewater#2318.
// Prints the sender result, the Mail receiver record and the replay, and writes contribution/mail-run.json.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appRoot = path.join(__dirname, '..');
const repoRoot = path.resolve(appRoot, '../..');
const {createRuntime} = require(path.join(repoRoot, 'runtime/core/runtime.cjs'));
const {Client} = require(path.join(repoRoot, 'runtime/client.cjs'));
const {publishPending, reconcile, inspectReceiver} = require(path.join(appRoot, 'src/publisher.cjs'));
const registry = path.join(repoRoot, 'apps.registry.json');
const mailRegistry = path.join(repoRoot, 'examples/registry.mail.json');

function seed() {
  const data = structuredClone(require(path.join(appRoot, 'fixtures/minimal.json')));
  data.owner_person_id = 'person-maya';
  data.accounts.find(item => item.account_id === 'fy-tomasreyes').person_id = 'person-maya';
  return data;
}

function binding() {
  const value = structuredClone(require(path.join(appRoot, 'fixtures/binding.json')));
  value.people.push({person_id: 'person-maya', name: 'Maya Chen'});
  value.accounts[0].owner_person_id = 'person-maya';
  return value;
}

async function snapMessages(dir, run) {
  const client = new Client('mail', 'infra', run, dir, 'mail-inspector', {registry: mailRegistry});
  await client.initialize();
  try {
    return (await client.call('env.snapshot')).snapshot.data.messages;
  } finally {
    await client.close();
  }
}

function pick(source, keys) {
  return Object.fromEntries(keys.filter(key => source && Object.prototype.hasOwnProperty.call(source, key)).map(key => [key, source[key]]));
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forkyard-mail-record-'));
  const run = 'fy-mail-record';
  const clients = [];
  try {
    const config = path.join(dir, 'allowed.json');
    fs.writeFileSync(config, JSON.stringify({
      schema_version: 2,
      registry: 'examples/registry.mail.json',
      authentication: {mode: 'trusted-stdio'},
      publishers: [{
        app_id: 'forkyard',
        account_id: 'fy-tomasreyes',
        owner_person_id: 'person-maya',
        package_root: 'apps/forkyard',
        contribution_ref: 'contribution/contribution.json',
        allowed_recipients: [{app_id: 'mail', account_id: 'mail-maya', channel: 'channel.email'}]
      }]
    }));
    const model = createRuntime({registryFile: registry});
    let state = model.create('forkyard', run, 'sandbox');
    const loaded = model.execute(state, 'infra', 'env.load_seed', {
      expected_version: model.version(state),
      request_id: 'seed-' + run,
      data: seed(),
      binding: binding(),
      policies: require(path.join(appRoot, 'fixtures/policies.json')),
      virtual_now: '2026-11-18T09:00:00-08:00'
    });
    assert.equal(loaded.result.status, 'ready');
    state = loaded.state;
    const scenario = require(path.join(appRoot, 'examples/scenario.json'));
    const applied = model.execute(state, 'infra', 'env.apply_event', {
      expected_version: model.version(state),
      event: scenario
    });
    assert.equal(applied.result.status, 'committed');
    assert.equal(applied.result.event_id, scenario.event_id);
    assert.equal(applied.result.trace && applied.result.trace.applied_at, scenario.at);
    assert.equal(scenario.event_id, 'fy-021');
    assert.equal(scenario.at, '2026-11-18T09:05:00-08:00');
    assert.equal(scenario.operation, 'pull.closed');
    assert.equal(scenario.payload.repo, 'tidewater/tidewater');
    assert.equal(scenario.payload.number, 2318);
    const before = await snapMessages(dir, run);
    const router = new Client(null, null, null, null, 'forkyard-publisher', {
      commandArgs: [path.join(repoRoot, 'runtime/messaging/service.cjs'), '--config', config, '--publisher', 'forkyard', '--run', run, '--state-dir', dir]
    });
    clients.push(router);
    await router.initialize();
    const mailbox = new Client('mail', 'infra', run, dir, 'mail-commit-status', {registry: mailRegistry});
    clients.push(mailbox);
    await mailbox.initialize();
    let mail = await mailbox.call('env.snapshot');
    const advanced = await mailbox.call('env.advance_time', {
      expected_version: mail.version,
      request_id: 'mail-clock-to-closure',
      virtual_now: scenario.at
    });
    assert.equal(advanced.status, 'committed', JSON.stringify(advanced));
    mail = await mailbox.call('env.snapshot');
    const receiver = {
      app_id: 'mail',
      account_id: mail.snapshot.data.account_id,
      address: mail.snapshot.data.address,
      epoch: mail.snapshot.epoch
    };
    const sent = await publishPending({
      notices: applied.state.data.notices,
      accountId: 'fy-tomasreyes',
      router,
      runId: run,
      receiver,
      inspectReceipt: id => inspectReceiver(mailbox, id)
    });
    const attempt = sent.attempts[0];
    const status = await mailbox.call('env.event_status', {event_id: attempt.result.event_id});
    const afterFirst = await snapMessages(dir, run);
    const again = await router.call('router.publish', {request_id: attempt.request_id, message: attempt.message});
    const afterReplay = await snapMessages(dir, run);
    const replay = reconcile({
      messaging: again,
      mailReceipt: await inspectReceiver(mailbox, again.event_id),
      message: attempt.message,
      attempted: {event_id: again.event_id, run_id: run, receiver, receiver_epoch: receiver.epoch, message: attempt.message}
    });
    const message = afterFirst.find(item => item.id === attempt.result.event_id);
    const outcome = pick(attempt.outcome, ['delivery', 'correlated', 'duplicate_within_run', 'same_run_retry', 'event_id', 'reason']);
    const record = {
      run_id: run,
      forkyard_event: {
        event_id: applied.result.event_id,
        operation: scenario.operation,
        repo: scenario.payload.repo,
        number: scenario.payload.number,
        at: applied.result.trace.applied_at
      },
      pull_state_after: applied.state.data.pulls.find(item => item.number === 2318).state,
      sender: {
        request_id: attempt.request_id,
        router_status: attempt.result.status,
        event_id: attempt.result.event_id,
        outcome
      },
      receiver_record: {
        mail_account: receiver.account_id,
        address: receiver.address,
        epoch: receiver.epoch,
        event_status: pick(status, ['status', 'event_id']),
        receipt_version: status.receipt && status.receipt.version,
        receipt_run: status.receipt && status.receipt.trace && status.receipt.trace.run_id,
        message: pick(message, ['id', 'thread_id', 'from', 'to', 'subject', 'received_at'])
      },
      mail_messages: {before: before.length, after_first: afterFirst.length, after_replay: afterReplay.length},
      replay: {
        duplicate: again.duplicate,
        same_event_id: again.event_id === attempt.result.event_id,
        event_id: again.event_id,
        reconcile_delivery: replay.delivery,
        duplicate_within_run: replay.duplicate_within_run
      }
    };
    fs.writeFileSync(path.join(appRoot, 'contribution/mail-run.json'), JSON.stringify(record, null, 2) + '\n');
    console.log(JSON.stringify(record, null, 2));
  } finally {
    for (const client of clients.reverse()) {
      try { await client.close(); } catch (error) { /* the temp directory is removed next */ }
    }
    fs.rmSync(dir, {recursive: true, force: true});
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
