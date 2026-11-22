'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRuntime} = require('../../../runtime/core/runtime.cjs');
const {Client} = require('../../../runtime/client.cjs');
const {create} = require('../../../runtime/messaging/src/router.cjs');
const {digest} = require('../../../runtime/messaging/src/contracts.cjs');
const {publishPending, reconcile, inspectReceiver, routerEventId, messageFor, resetDelivery} = require('../src/publisher.cjs');

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

async function mailEvidence(mail, eventId) {
  const status = await mail.call('env.event_status', {event_id: eventId});
  const snap = await mail.call('env.snapshot');
  const message = snap.snapshot.data.messages.find(item => item.id === eventId) || null;
  const receipt = status.receipt;
  return {
    ...status,
    receiver_record: message ? {
      app_id: 'mail',
      account_id: message.account_id,
      run_id: receipt && receipt.trace ? receipt.trace.run_id : null,
      epoch: receipt && receipt.version ? receipt.version.epoch : null
    } : null
  };
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
    const mailbox = new Client('mail', 'infra', run, dir, 'mail-commit-status', {registry: mailRegistry});
    clients.push(mailbox);
    await mailbox.initialize();
    const mailboxSnap = await mailbox.call('env.snapshot');
    const receiver = {
      app_id: 'mail',
      account_id: mailboxSnap.snapshot.data.account_id,
      address: mailboxSnap.snapshot.data.address,
      epoch: mailboxSnap.snapshot.epoch
    };
    const sent = await publishPending({
      notices: prepared.state.data.notices, accountId: 'fy-tomasreyes', router, runId: run, receiver,
      inspectReceipt: (eventId) => inspectReceiver(mailbox, eventId)
    });
    assert.equal(sent.attempts.length, 1);
    assert.equal(sent.attempts[0].result.status, 'committed');
    assert.equal(sent.attempts[0].outcome.delivery, 'confirmed');
    assert.equal(sent.attempts[0].outcome.same_run_retry, false);
    const again = await router.call('router.publish', {request_id: sent.attempts[0].request_id, message: sent.attempts[0].message});
    assert.equal(again.duplicate, true);
    assert.equal(again.event_id, sent.attempts[0].result.event_id);
    const duplicateEvidence = await inspectReceiver(mailbox, again.event_id);
    const duplicate = reconcile({
      messaging: again,
      mailReceipt: duplicateEvidence,
      message: sent.attempts[0].message,
      attempted: {
        event_id: again.event_id,
        run_id: run,
        receiver,
        receiver_epoch: receiver.epoch,
        message: sent.attempts[0].message
      }
    });
    assert.equal(duplicate.delivery, 'confirmed');
    assert.equal(duplicate.duplicate_within_run, true);
    const after = await messages(dir, run);
    assert.equal(after.length, before.length + 1);
    assert.equal(after.at(-1).id, sent.attempts[0].result.event_id);
    assert.match(after.at(-1).body, /at 09:05\./);
    const mail = new Client('mail', 'infra', run, dir, 'mail-status', {registry: mailRegistry});
    clients.push(mail);
    await mail.initialize();
    const receipt = await inspectReceiver(mail, sent.attempts[0].result.event_id);
    const joined = reconcile({
      messaging: sent.attempts[0].result,
      mailReceipt: receipt,
      message: sent.attempts[0].message,
      attempted: {
        event_id: sent.attempts[0].result.event_id,
        run_id: run,
        receiver,
        receiver_epoch: receiver.epoch,
        message: sent.attempts[0].message
      }
    });
    assert.equal(joined.delivery, 'confirmed');
    assert.equal(joined.same_run_retry, false);
    const foreign = reconcile({
      messaging: {...sent.attempts[0].result, run_id: 'other-run', target: {app_id: 'mail', account_id: 'mail-other'}},
      message: sent.attempts[0].message,
      attempted: {
        event_id: sent.attempts[0].result.event_id,
        run_id: run,
        receiver: {app_id: 'mail', account_id: 'mail-maya'},
        receiver_epoch: sent.attempts[0].result.version.epoch,
        message: sent.attempts[0].message
      }
    });
    assert.equal(foreign.delivery, 'unresolved');
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
    const rejected = await publishPending({notices: deniedState.state.data.notices, accountId: 'fy-tomasreyes', router: deniedRouter, runId: deniedRun});
    assert.equal(rejected.attempts.length, 1);
    assert.equal(rejected.attempts[0].result.code, 'recipient_not_authorized');
    assert.equal(rejected.attempts[0].outcome.delivery, 'unresolved');
    assert.equal(rejected.attempts[0].outcome.source_committed, true);
    assert.equal(rejected.attempts[0].outcome.same_run_retry, false);
    assert.equal(rejected.stopped, true);
    const suppressed = await publishPending({notices: deniedState.state.data.notices, accountId: 'fy-tomasreyes', router: deniedRouter, runId: deniedRun});
    assert.equal(suppressed.suppressed, true);
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
      const lostMail = new Client('mail', 'infra', lostRun, lostDir, 'mail-lost-inline', {registry: mailRegistry});
      clients.push(lostMail);
      await lostMail.initialize();
      lost = await publishPending({
        notices: lostState.state.data.notices, accountId: 'fy-tomasreyes', router: lostRouter, runId: lostRun,
        inspectReceipt: (eventId) => inspectReceiver(lostMail, eventId),
        receiver: {app_id: 'mail', account_id: 'mail-maya'}
      });
    } finally {
      Client.prototype.call = original;
    }
    assert.equal(lost.attempts.length, 1);
    assert.equal(lost.attempts[0].result.status, 'unknown');
    assert.equal(lost.attempts[0].outcome.delivery, 'confirmed');
    assert.equal(lost.attempts[0].outcome.same_run_retry, false);
    assert.equal(lost.attempts[0].outcome.correlated, true);
    const inspector = new Client('mail', 'infra', lostRun, lostDir, 'mail-lost', {registry: mailRegistry});
    clients.push(inspector);
    await inspector.initialize();
    const persisted = await inspector.call('env.event_status', {event_id: lost.attempts[0].result.event_id});
    assert.equal(persisted.receipt.status, 'committed');
    assert.equal(persisted.receipt.event_id, lost.attempts[0].result.event_id);
    const halted = await lostRouter.call('router.publish', {request_id: 'notice-another', message: lost.attempts[0].message});
    assert.equal(halted.code, 'run_halted');
    const stored = (await inspector.call('env.snapshot')).snapshot.data.messages;
    assert.equal(stored.filter(item => item.thread_id === lost.attempts[0].message.id).length, 1);
    const statusOnly = reconcile({
      messaging: lost.attempts[0].result,
      mailReceipt: persisted,
      message: lost.attempts[0].message,
      attempted: {
        event_id: lost.attempts[0].result.event_id,
        run_id: lostRun,
        receiver: {app_id: 'mail', account_id: 'mail-maya'},
        receiver_epoch: persisted.receipt.version.epoch,
        message: lost.attempts[0].message
      }
    });
    assert.equal(statusOnly.delivery, 'unresolved');
    const rejectDir = path.join(dir, 'rejected');
    fs.mkdirSync(rejectDir);
    const rejectRun = 'fy_mail_rejected';
    const rejectState = prepare(rejectRun);
    const rejectNotice = rejectState.state.data.notices.find(item => item.status === 'pending_delivery');
    const rejectMessage = messageFor(rejectNotice, 'fy-tomasreyes');
    const rejectMail = new Client('mail', 'infra', rejectRun, rejectDir, 'mail-reject-prep', {registry: mailRegistry});
    clients.push(rejectMail);
    await rejectMail.initialize();
    const rejectSnap = await rejectMail.call('env.snapshot');
    const occupied = 'router-' + digest({
      run: rejectRun,
      source: rejectMessage.source,
      id: rejectMessage.id,
      target: 'mail',
      account: 'mail-maya',
      epoch: rejectSnap.snapshot.epoch
    }).slice(0, 32);
    const occupiedEvent = await rejectMail.call('env.apply_event', {
      expected_version: rejectSnap.version,
      event: {
        event_id: occupied,
        at: '2026-11-15T09:05:00-08:00',
        operation: 'mail.deliver',
        payload: {
          id: occupied,
          thread_id: 'occupied',
          account_id: 'mail-maya',
          from: 'alex.rivera@example.com',
          to: ['maya.main@example.com'],
          subject: 'Occupied record',
          body: 'This record id is already stored.',
          received_at: '2026-11-15T09:05:00-08:00',
          folder: 'inbox',
          read: false,
          attachments: []
        }
      }
    });
    assert.equal(occupiedEvent.status, 'committed');
    await rejectMail.close();
    const rejectRouter = new Client(null, null, null, null, 'forkyard-rejected', {
      commandArgs: [path.join(root, 'runtime/messaging/service.cjs'), '--config', allowed, '--publisher', 'forkyard', '--run', rejectRun, '--state-dir', rejectDir]
    });
    clients.push(rejectRouter);
    await rejectRouter.initialize();
    let rejectedLookups = 0;
    const refused = await publishPending({
      notices: rejectState.state.data.notices, accountId: 'fy-tomasreyes', router: rejectRouter, runId: rejectRun,
      inspectReceipt: async (eventId) => {
        rejectedLookups += 1;
        const inspector = new Client('mail', 'infra', rejectRun, rejectDir, 'mail-reject-status', {registry: mailRegistry});
        clients.push(inspector);
        await inspector.initialize();
        return inspectReceiver(inspector, eventId);
      }
    });
    assert.equal(rejectedLookups, 1);
    assert.equal(refused.attempts.length, 1);
    assert.equal(refused.attempts[0].result.code, 'receiver_rejected');
    assert.equal(refused.attempts[0].outcome.delivery, 'unresolved');
    assert.equal(refused.attempts[0].outcome.comparison.observed.message.thread_id, 'occupied');
    assert.notEqual(refused.attempts[0].outcome.comparison.observed.message.thread_id, refused.attempts[0].message.id);
    assert.equal(refused.stopped, true);
    const occupiedMessages = await messages(rejectDir, rejectRun);
    assert.equal(occupiedMessages.filter(item => item.thread_id === rejectMessage.id).length, 0);
    assert.equal(occupiedMessages.filter(item => item.thread_id === 'occupied').length, 1);
    assert.equal(rejectState.state.data.pulls.find(item => item.number === 2318).state, 'closed');

    const missDir = path.join(dir, 'missing');
    fs.mkdirSync(missDir);
    const missRun = 'fy_mail_missing';
    const missState = prepare(missRun);
    const missRouter = await create({config: allowed, publisher: 'forkyard', run: missRun, stateDir: missDir});
    clients.push(missRouter);
    const missMail = new Client('mail', 'infra', missRun, missDir, 'mail-missing', {registry: mailRegistry});
    clients.push(missMail);
    await missMail.initialize();
    const decoy = await missMail.call('env.apply_event', {
      expected_version: (await missMail.call('env.snapshot')).version,
      event: {
        event_id: 'mail-decoy-receipt',
        at: '2026-11-15T09:06:00-08:00',
        operation: 'mail.deliver',
        payload: {
          id: 'decoy-message',
          thread_id: 'decoy',
          account_id: 'mail-maya',
          from: 'alex.rivera@example.com',
          to: ['maya.main@example.com'],
          subject: 'Other receipt',
          body: 'A committed receipt for a different event.',
          received_at: '2026-11-15T09:06:00-08:00',
          folder: 'inbox',
          read: false,
          attachments: []
        }
      }
    });
    assert.equal(decoy.status, 'committed');
    const patched = Client.prototype.call;
    let missing;
    let mismatched;
    try {
      Client.prototype.call = async function(name, args) {
        if (name === 'env.apply_event') throw new Error('dropped before the receiver applied it');
        return patched.call(this, name, args);
      };
      missing = await publishPending({
        notices: missState.state.data.notices, accountId: 'fy-tomasreyes', router: missRouter, runId: missRun,
        inspectReceipt: (eventId) => missMail.call('env.event_status', {event_id: eventId})
      });
      const mismatchRun = 'fy_mail_mismatch';
      const mismatchDir = path.join(dir, 'mismatch');
      fs.mkdirSync(mismatchDir);
      const mismatchState = prepare(mismatchRun);
      const mismatchRouter = await create({config: allowed, publisher: 'forkyard', run: mismatchRun, stateDir: mismatchDir});
      clients.push(mismatchRouter);
      mismatched = await publishPending({
        notices: mismatchState.state.data.notices, accountId: 'fy-tomasreyes', router: mismatchRouter, runId: mismatchRun,
        inspectReceipt: async (eventId) => {
          const absent = await missMail.call('env.event_status', {event_id: eventId});
          assert.equal(absent.receipt, null);
          return missMail.call('env.event_status', {event_id: 'mail-decoy-receipt'});
        }
      });
    } finally {
      Client.prototype.call = patched;
    }
    assert.equal(missing.attempts[0].result.status, 'unknown');
    assert.equal(missing.attempts[0].outcome.delivery, 'unresolved');
    assert.equal(missing.stopped, true);
    const missingReceipt = await missMail.call('env.event_status', {event_id: missing.attempts[0].result.event_id});
    assert.equal(missingReceipt.receipt, null);
    assert.equal(mismatched.attempts[0].result.status, 'unknown');
    assert.equal(mismatched.attempts[0].outcome.delivery, 'unresolved');
    assert.equal(mismatched.attempts[0].outcome.correlated, false);
    assert.equal(missState.state.data.pulls.find(item => item.number === 2318).state, 'closed');

    const transportDir = path.join(dir, 'transport');
    fs.mkdirSync(transportDir);
    const transportRun = 'fy_mail_transport';
    const transportState = prepare(transportRun);
    const transportRouter = new Client(null, null, null, null, 'forkyard-transport', {
      commandArgs: [path.join(root, 'runtime/messaging/service.cjs'), '--config', allowed, '--publisher', 'forkyard', '--run', transportRun, '--state-dir', transportDir]
    });
    clients.push(transportRouter);
    await transportRouter.initialize();
    let transportCalls = 0;
    const flaky = {
      async call(name, args) {
        transportCalls += 1;
        if (transportCalls > 1) throw new Error('socket closed');
        return transportRouter.call(name, args);
      }
    };
    const transportMail = new Client('mail', 'infra', transportRun, transportDir, 'mail-transport', {registry: mailRegistry});
    clients.push(transportMail);
    await transportMail.initialize();
    const transportSnap = await transportMail.call('env.snapshot');
    const transportReceiver = {
      app_id: 'mail',
      account_id: transportSnap.snapshot.data.account_id,
      address: transportSnap.snapshot.data.address,
      epoch: transportSnap.snapshot.epoch
    };
    const firstNotice = transportState.state.data.notices.find(item => item.status === 'pending_delivery');
    const transported = await publishPending({
      notices: [firstNotice, {...firstNotice, notice_id: 'notice-extra', object_id: 'tidewater.tidewater.extra'}],
      accountId: 'fy-tomasreyes', router: flaky, runId: transportRun, receiver: transportReceiver,
      inspectReceipt: (eventId) => inspectReceiver(transportMail, eventId)
    });
    assert.equal(transported.attempts.length, 2);
    assert.equal(transported.attempts[0].result.status, 'committed');
    assert.equal(transported.attempts[0].outcome.delivery, 'confirmed');
    assert.equal(transported.attempts[1].result.code, 'transport_error');
    assert.equal(transported.stopped, true);
    const held = await publishPending({
      notices: [firstNotice], accountId: 'fy-tomasreyes', router: flaky, runId: transportRun
    });
    assert.equal(held.suppressed, true);
    assert.equal(transportCalls, 2);

    const taskDir = path.join(dir, 'task74');
    fs.mkdirSync(taskDir);
    const taskRun = 'fy_mail_task74';
    const taskConfig = path.join(dir, 'task74.json');
    fs.writeFileSync(taskConfig, JSON.stringify({
      schema_version: 2,
      registry: 'examples/registry.mail.json',
      authentication: {mode: 'trusted-stdio'},
      publishers: [{
        app_id: 'forkyard',
        account_id: 'fy-tomasreyes',
        owner_person_id: 'person-tomas',
        package_root: 'apps/forkyard',
        contribution_ref: 'contribution/contribution.json',
        allowed_recipients: [{app_id: 'mail', account_id: 'mail-maya', channel: 'channel.email'}]
      }]
    }));
    const mailSeed = structuredClone(require('../../../examples/apps/mail/fixtures/minimal.json'));
    mailSeed.owner_person_id = 'person-tomas';
    mailSeed.address = 'tomas.reyes@example.com';
    const rewriteTimes = value => {
      if (Array.isArray(value)) return value.map(rewriteTimes);
      if (!value || typeof value !== 'object') return value;
      const copy = {};
      for (const [key, item] of Object.entries(value)) {
        copy[key] = (key === 'at' || key.endsWith('_at')) && typeof item === 'string' ? '2026-02-01T09:00:00-08:00' : rewriteTimes(item);
      }
      return copy;
    };
    const februaryMail = rewriteTimes(mailSeed);
    const mailBinding = structuredClone(require('../../../examples/apps/mail/fixtures/binding.json'));
    mailBinding.people.push({person_id: 'person-tomas', name: 'Tomas Reyes'});
    mailBinding.accounts[0].owner_person_id = 'person-tomas';
    const mailPrep = new Client('mail', 'infra', taskRun, taskDir, 'mail-task-prep', {registry: mailRegistry});
    clients.push(mailPrep);
    await mailPrep.initialize();
    const mailReady = await mailPrep.call('env.load_seed', {
      expected_version: (await mailPrep.call('env.snapshot')).version,
      request_id: 'mail-owner-tomas',
      data: februaryMail,
      binding: mailBinding,
      virtual_now: '2026-02-11T09:00:00-08:00'
    });
    assert.equal(mailReady.status, 'ready');
    const advanced = await mailPrep.call('env.advance_time', {
      expected_version: mailReady.version,
      request_id: 'mail-february-closure',
      virtual_now: '2026-02-11T10:12:00-08:00'
    });
    assert.equal(advanced.status, 'committed');
    await mailPrep.close();
    const taskInfra = new Client('forkyard', 'infra', taskRun, taskDir, 'fy-task-infra', {registry});
    const taskAgent = new Client('forkyard', 'agent', taskRun, taskDir, 'fy-task-agent', {registry});
    clients.push(taskInfra, taskAgent);
    await taskInfra.initialize();
    await taskAgent.initialize();
    const taskSnap = await taskInfra.call('env.snapshot');
    assert.equal(taskSnap.snapshot.profile, 'scenario');
    const taskLoaded = await taskInfra.call('env.load_seed', {
      expected_version: taskSnap.version,
      request_id: 'seed-task74-mcp',
      data: require('../examples/task-data/rejected-pr/seed.json'),
      binding: require('../examples/task-data/rejected-pr/binding.json'),
      policies: require('../examples/task-data/rejected-pr/policies.json'),
      virtual_now: '2026-02-09T20:40:00-08:00'
    });
    assert.equal(taskLoaded.status, 'ready');
    const taskOpened = await taskAgent.call('forkyard.pulls.open', {
      expected_version: taskLoaded.version,
      request_id: 'open-2318-mcp',
      repo: 'tidewater/tidewater',
      head: 'tomasreyes/tidewater:fix/tz-parse',
      base: 'main',
      title: 'Fix timezone parsing for offsets without colons',
      body: 'Handle offsets that omit the colon.'
    });
    assert.equal(taskOpened.status, 'committed');
    assert.equal(taskOpened.number, 2318);
    assert.deepEqual(taskOpened.reviewers, ['acc-ihalvorsen', 'acc-praman', 'acc-msolis']);
    const taskClosed = await taskInfra.call('env.apply_event', {
      expected_version: taskOpened.version,
      event: {
        event_id: 'fy-task-74-mcp',
        at: '2026-02-11T10:12:00-08:00',
        operation: 'pull.closed',
        payload: {
          repo: 'tidewater/tidewater',
          number: 2318,
          actor_account_id: 'acc-ihalvorsen',
          comment: 'Closing: this changes the public parse_tz() signature, and #2290 already addresses this bug.'
        }
      }
    });
    assert.equal(taskClosed.status, 'committed');
    const taskView = await taskInfra.call('env.snapshot');
    const taskPending = taskView.snapshot.data.notices.filter(item => item.status === 'pending_delivery');
    assert.equal(taskPending.length, 1);
    assert.equal(taskPending[0].person_id, 'person-tomas');
    assert.equal(taskView.snapshot.data.pulls.find(item => item.number === 2318).state, 'closed');
    const taskRouter = new Client(null, null, null, null, 'forkyard-task-router', {
      commandArgs: [path.join(root, 'runtime/messaging/service.cjs'), '--config', taskConfig, '--publisher', 'forkyard', '--run', taskRun, '--state-dir', taskDir]
    });
    clients.push(taskRouter);
    await taskRouter.initialize();
    const taskSent = await publishPending({
      notices: taskView.snapshot.data.notices, accountId: 'fy-tomasreyes', router: taskRouter, runId: taskRun
    });
    assert.equal(taskSent.attempts.length, 1);
    assert.equal(taskSent.attempts[0].result.status, 'committed');
    const taskBox = await messages(taskDir, taskRun);
    const delivered = taskBox.find(item => item.thread_id === taskSent.attempts[0].message.id);
    assert.ok(delivered);
    assert.equal(delivered.received_at, '2026-02-11T10:12:00-08:00');
    assert.deepEqual(delivered.to, ['tomas.reyes@example.com']);
    assert.equal(delivered.account_id, 'mail-maya');

    const lookupDir = path.join(dir, 'lookup');
    fs.mkdirSync(lookupDir);
    const lookupRun = 'fy_mail_lookup';
    const lookupState = prepare(lookupRun);
    const lookupRouter = await create({config: allowed, publisher: 'forkyard', run: lookupRun, stateDir: lookupDir});
    clients.push(lookupRouter);
    const lookupOriginal = Client.prototype.call;
    let lookupCalls = 0;
    let routerCalls = 0;
    let lookedUp;
    let releaseLookup;
    const lookupGate = new Promise(resolve => { releaseLookup = resolve; });
    let lookupStarted;
    const lookupReady = new Promise(resolve => { lookupStarted = resolve; });
    try {
      Client.prototype.call = async function(name, args) {
        if (name === 'env.apply_event') throw new Error('dropped before the receiver applied it');
        return lookupOriginal.call(this, name, args);
      };
      const pendingLookup = publishPending({
        notices: lookupState.state.data.notices, accountId: 'fy-tomasreyes', router: {
          async call(name, args) {
            routerCalls += 1;
            return lookupRouter.call(name, args);
          }
        }, runId: lookupRun,
        receiver: {app_id: 'mail', account_id: 'mail-maya'},
        inspectReceipt: async () => {
          lookupCalls += 1;
          lookupStarted();
          await lookupGate;
          throw new Error('lookup down');
        }
      });
      await lookupReady;
      const concurrent = await publishPending({
        notices: lookupState.state.data.notices, accountId: 'fy-tomasreyes', router: {
          async call() {
            routerCalls += 1;
            throw new Error('router should stay idle');
          }
        }, runId: lookupRun
      });
      assert.equal(concurrent.suppressed, true);
      assert.equal(concurrent.attempts.length, 1);
      assert.equal(concurrent.attempts[0].notice_id, lookupState.state.data.notices.find(item => item.status === 'pending_delivery').notice_id);
      releaseLookup();
      lookedUp = await pendingLookup;
    } finally {
      Client.prototype.call = lookupOriginal;
      releaseLookup();
    }
    assert.equal(lookedUp.attempts.length, 1);
    assert.equal(lookedUp.attempts[0].outcome.lookup_error, 'lookup down');
    assert.equal(lookedUp.attempts[0].outcome.delivery, 'unresolved');
    assert.equal(lookedUp.stopped, true);
    const heldLookup = await publishPending({
      notices: lookupState.state.data.notices, accountId: 'fy-tomasreyes', router: {
        async call() {
          routerCalls += 1;
          throw new Error('router should stay idle');
        }
      }, runId: lookupRun
    });
    assert.equal(heldLookup.suppressed, true);
    assert.equal(lookupCalls, 1);
    assert.equal(routerCalls, 1);

    const storedReceipt = await mail.call('env.event_status', {event_id: sent.attempts[0].result.event_id});
    const stripped = structuredClone(storedReceipt);
    delete stripped.receipt.trace;
    delete stripped.receipt.version;
    delete stripped.receipt.run_id;
    delete stripped.receipt.account_id;
    const bare = reconcile({
      messaging: {status: 'unknown', event_id: sent.attempts[0].result.event_id, run_id: run},
      mailReceipt: stripped,
      attempted: {
        event_id: sent.attempts[0].result.event_id,
        run_id: run,
        receiver: {app_id: 'mail', account_id: 'mail-maya'},
        receiver_epoch: storedReceipt.receipt.version.epoch
      }
    });
    assert.equal(bare.delivery, 'unresolved');
    const wrongAccount = reconcile({
      messaging: {status: 'unknown', event_id: sent.attempts[0].result.event_id, run_id: run},
      mailReceipt: {...storedReceipt, receiver_record: {app_id: 'mail', account_id: 'mail-maya'}},
      attempted: {
        event_id: sent.attempts[0].result.event_id,
        run_id: run,
        receiver: {app_id: 'mail', account_id: 'mail-other'},
        receiver_epoch: storedReceipt.receipt.version.epoch
      }
    });
    assert.equal(wrongAccount.delivery, 'unresolved');

    const clashDir = path.join(dir, 'clash');
    fs.mkdirSync(clashDir);
    const clashRun = 'fy_mail_clash';
    const clashState = prepare(clashRun);
    const clashNotice = clashState.state.data.notices.find(item => item.status === 'pending_delivery');
    const clashMessage = messageFor(clashNotice, 'fy-tomasreyes');
    const clashMail = new Client('mail', 'infra', clashRun, clashDir, 'mail-clash', {registry: mailRegistry});
    clients.push(clashMail);
    await clashMail.initialize();
    const clashSnap = await clashMail.call('env.snapshot');
    const clashReceiver = {
      app_id: 'mail',
      account_id: clashSnap.snapshot.data.account_id,
      address: clashSnap.snapshot.data.address,
      epoch: clashSnap.snapshot.epoch
    };
    const clashId = routerEventId(clashRun, clashMessage, clashReceiver, clashReceiver.epoch);
    const planted = await clashMail.call('env.apply_event', {
      expected_version: clashSnap.version,
      event: {
        event_id: clashId,
        at: '2026-11-15T09:07:00-08:00',
        operation: 'mail.deliver',
        payload: {
          id: clashId,
          thread_id: clashMessage.id,
          account_id: 'mail-maya',
          from: 'forkyard@pale.example',
          to: [clashReceiver.address],
          subject: 'Review requested',
          body: 'An earlier review notice occupies this event.',
          received_at: '2026-11-15T09:07:00-08:00',
          folder: 'inbox',
          read: false,
          attachments: []
        }
      }
    });
    assert.equal(planted.status, 'committed');
    const clashRouter = new Client(null, null, null, null, 'forkyard-clash', {
      commandArgs: [path.join(root, 'runtime/messaging/service.cjs'), '--config', allowed, '--publisher', 'forkyard', '--run', clashRun, '--state-dir', clashDir]
    });
    clients.push(clashRouter);
    await clashRouter.initialize();
    let clashPublishes = 0;
    const clashExtra = {...clashNotice, notice_id: 'notice-clash-extra', object_id: 'tidewater.tidewater.extra'};
    const clashed = await publishPending({
      notices: [clashNotice, clashExtra],
      accountId: 'fy-tomasreyes',
      router: {
        async call(name, args) {
          if (name === 'router.publish') clashPublishes += 1;
          return clashRouter.call(name, args);
        }
      },
      runId: clashRun,
      receiver: clashReceiver,
      inspectReceipt: (eventId) => inspectReceiver(clashMail, eventId)
    });
    assert.equal(clashPublishes, 1);
    assert.equal(clashed.attempts.length, 1);
    assert.equal(clashed.attempts[0].result.code, 'receiver_rejected');
    assert.equal(clashed.attempts[0].outcome.delivery, 'unresolved');
    assert.equal(clashed.attempts[0].outcome.comparison.payload, false);
    assert.equal(clashed.stopped, true);
    const clashBox = (await clashMail.call('env.snapshot')).snapshot.data.messages;
    assert.equal(clashBox.filter(item => item.body === clashNotice.text).length, 0);
    const clashAgain = await publishPending({
      notices: [clashNotice, clashExtra],
      accountId: 'fy-tomasreyes',
      router: {async call() { clashPublishes += 1; throw new Error('republish'); }},
      runId: clashRun
    });
    assert.equal(clashAgain.suppressed, true);
    assert.equal(clashPublishes, 1);

    const dropDir = path.join(dir, 'dropped');
    fs.mkdirSync(dropDir);
    const dropRun = 'fy_mail_dropped';
    const dropState = prepare(dropRun);
    const dropRouter = new Client(null, null, null, null, 'forkyard-dropped', {
      commandArgs: [path.join(root, 'runtime/messaging/service.cjs'), '--config', allowed, '--publisher', 'forkyard', '--run', dropRun, '--state-dir', dropDir]
    });
    clients.push(dropRouter);
    await dropRouter.initialize();
    const dropMail = new Client('mail', 'infra', dropRun, dropDir, 'mail-dropped', {registry: mailRegistry});
    clients.push(dropMail);
    await dropMail.initialize();
    const dropSnap = await dropMail.call('env.snapshot');
    const dropReceiver = {
      app_id: 'mail',
      account_id: dropSnap.snapshot.data.account_id,
      address: dropSnap.snapshot.data.address,
      epoch: dropSnap.snapshot.epoch
    };
    let dropInspections = 0;
    let seenDuringPublish = null;
    const dropped = await publishPending({
      notices: dropState.state.data.notices,
      accountId: 'fy-tomasreyes',
      router: {
        async call(name, args) {
          seenDuringPublish = await publishPending({
            notices: dropState.state.data.notices,
            accountId: 'fy-tomasreyes',
            router: {async call() { throw new Error('republish'); }},
            runId: dropRun
          });
          const result = await dropRouter.call(name, args);
          throw new Error('dropped router reply');
          return result;
        }
      },
      runId: dropRun,
      receiver: dropReceiver,
      inspectReceipt: async (eventId) => {
        dropInspections += 1;
        return inspectReceiver(dropMail, eventId);
      }
    });
    assert.equal(seenDuringPublish.suppressed, true);
    assert.equal(seenDuringPublish.attempts[0].event_id, routerEventId(dropRun, seenDuringPublish.attempts[0].message, dropReceiver, dropReceiver.epoch));
    assert.equal(seenDuringPublish.receiver.account_id, 'mail-maya');
    assert.equal(dropInspections, 1);
    assert.equal(dropped.attempts[0].result.code, 'transport_error');
    assert.equal(dropped.attempts[0].outcome.delivery, 'confirmed');
    assert.equal(dropped.attempts[0].outcome.comparison.payload, true);
    const dropBox = (await dropMail.call('env.snapshot')).snapshot.data.messages;
    assert.equal(dropBox.filter(item => item.thread_id === dropped.attempts[0].message.id).length, 1);
    let dropRepublish = 0;
    const dropHeld = await publishPending({
      notices: dropState.state.data.notices,
      accountId: 'fy-tomasreyes',
      router: {async call() { dropRepublish += 1; throw new Error('republish'); }},
      runId: dropRun,
      inspectReceipt: (eventId) => inspectReceiver(dropMail, eventId)
    });
    assert.equal(dropHeld.suppressed, true);
    assert.equal(dropRepublish, 0);
    assert.equal(dropHeld.attempts[0].outcome.delivery, 'confirmed');

    resetDelivery('fy_mail_identity');
    const identityRun = 'fy_mail_identity';
    const identityState = prepare(identityRun);
    const identityNotice = identityState.state.data.notices.find(item => item.status === 'pending_delivery');
    const identityExtra = {...identityNotice, notice_id: 'notice-identity-extra'};
    let identityCalls = 0;
    const identity = await publishPending({
      notices: [identityNotice, identityExtra],
      accountId: 'fy-tomasreyes',
      router: {
        async call() {
          identityCalls += 1;
          return {
            status: 'committed',
            run_id: 'other-run',
            event_id: 'router-other-identity',
            target: {app_id: 'mail', account_id: 'mail-other'},
            version: {epoch: 1, revision: 2},
            cloud_event: {id: 'other', source: 'urn:pale:app:forkyard:account:other'}
          };
        }
      },
      runId: identityRun,
      receiver: {app_id: 'mail', account_id: 'mail-maya', address: 'maya.main@example.com', epoch: 1},
      inspectReceipt: async () => ({
        receipt: {
          status: 'committed',
          event_id: 'router-other-identity',
          app_id: 'mail',
          version: {epoch: 1, revision: 2},
          trace: {run_id: 'other-run', app_id: 'mail'}
        },
        receiver_record: {
          app_id: 'mail',
          account_id: 'mail-other',
          id: 'router-other-identity',
          thread_id: 'other',
          from: 'forkyard@pale.example',
          to: ['other@example.com'],
          subject: identityNotice.title,
          body: identityNotice.text
        }
      })
    });
    assert.equal(identityCalls, 1);
    assert.equal(identity.attempts.length, 1);
    assert.equal(identity.attempts[0].outcome.delivery, 'unresolved');
    assert.equal(identity.attempts[0].outcome.comparison.identity, false);
    assert.equal(identity.stopped, true);

    console.log(JSON.stringify({
      passed: true,
      committed_event_id: sent.attempts[0].result.event_id,
      duplicate: true,
      denied: rejected.attempts[0].result.code,
      unknown_event_id: lost.attempts[0].result.event_id,
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
