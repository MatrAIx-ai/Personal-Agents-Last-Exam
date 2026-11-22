'use strict';
// Task 75 session through the public Infra and Agent MCP servers.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('../../../runtime/client.cjs');
const { create } = require('../../../runtime/messaging/src/router.cjs');
const { publishPending } = require('../src/publisher.cjs');

const root = path.resolve(__dirname, '../../..');
const registry = path.join(root, 'apps.registry.json');
const shipped = path.join(root, 'apps/keelcard/examples/mail-publisher.json');
const policies = require('./task-data/policies.json');

function declineEvent() {
  return {
    event_id: 'task-decline-8812',
    at: '2026-11-20T06:14:00-05:00',
    operation: 'authorization.request',
    payload: {
      authorization_key: 'freshcart:fc-grace:fc-order-8812:1',
      amount_cents: 12438,
      currency: 'USD',
      card: { card_id: 'card-4417', number: '9417220000014417', expiry: '2028-09', security_code: '317' },
      merchant: { merchant_id: 'm-freshcart', name: 'FreshCart', category: 'grocery' },
      merchant_ref: { app_id: 'freshcart', account_id: 'fc-grace', object_type: 'order', object_id: 'fc-order-8812' }
    }
  };
}

async function mailbox(dir, run) {
  const mail = new Client('mail', 'infra', run, dir, 'task-mail', { registry });
  await mail.initialize();
  const snap = await mail.call('env.snapshot');
  const data = structuredClone(snap.snapshot.data);
  data.owner_person_id = 'person-grace';
  const binding = structuredClone(snap.snapshot.binding);
  for (const account of binding.accounts) {
    if (account.app_id === 'mail' && account.account_id === data.account_id) account.owner_person_id = 'person-grace';
  }
  if (!binding.people.some(person => person.person_id === 'person-grace')) {
    binding.people.push({ person_id: 'person-grace', name: 'Grace Adeyemi' });
  }
  const loaded = await mail.call('env.load_seed', {
    expected_version: snap.version,
    request_id: 'task-mailbox',
    data,
    binding,
    policies: snap.snapshot.policies,
    bundle: snap.snapshot.resources.bundle
  });
  if (loaded.status !== 'ready') throw new Error('Mail seed did not load');
  return mail;
}

function inspectWith(mail) {
  return async ({ event_id }) => {
    const eventStatus = await mail.call('env.event_status', { event_id });
    const snap = await mail.call('env.snapshot');
    const mailRecord = snap.snapshot.data.messages.find(message => message.id === event_id) || null;
    return { eventStatus, mailRecord };
  };
}

async function syncMail(mail, virtualNow, requestId) {
  const snap = await mail.call('env.snapshot');
  if (Date.parse(snap.snapshot.virtual_now) === Date.parse(virtualNow)) return snap;
  const moved = await mail.call('env.advance_time', {
    expected_version: snap.version,
    request_id: requestId,
    virtual_now: virtualNow
  });
  if (moved.status && !['ok', 'ready', 'committed'].includes(moved.status)) throw new Error('Mail clock did not move');
  return mail.call('env.snapshot');
}

function codeFromMessage(message) {
  const match = message && message.body && message.body.match(/Code (\d{6})/);
  if (!match) throw new Error('The Mail message did not contain a confirmation code');
  return match[1];
}

async function applyReports(infra, reports) {
  for (const item of reports) {
    const snap = await infra.call('env.snapshot');
    const payload = {
      notice_id: item.notice_id,
      publish_request_id: item.publish_request_id,
      status: item.status
    };
    if (item.receipt_event_id) payload.event_id = item.receipt_event_id;
    if (item.code) payload.code = item.code;
    const applied = await infra.call('env.apply_event', {
      expected_version: snap.version,
      event: {
        event_id: 'delivery-' + item.notice_id,
        at: snap.snapshot.virtual_now,
        operation: 'notice.delivery_result',
        payload
      }
    });
    if (applied.status !== 'committed') throw new Error('Delivery evidence was not recorded');
  }
}

async function runTaskSession(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keelcard-task-'))) {
  const run = 'task75';
  let infra = new Client('keelcard', 'infra', run, dir, 'task-infra', { registry });
  let agent = new Client('keelcard', 'agent', run, dir, 'task-agent', { registry });
  await infra.initialize();
  await agent.initialize();
  let mail = await mailbox(dir, run);
  let router = await create({ config: shipped, publisher: 'keelcard', run, stateDir: dir });
  try {
    const opening = await infra.call('env.snapshot');
    const loaded = await infra.call('env.load_seed', {
      expected_version: opening.version,
      request_id: 'task-policy',
      data: opening.snapshot.data,
      binding: opening.snapshot.binding,
      policies,
      bundle: opening.snapshot.resources.bundle
    });
    if (loaded.status !== 'ready') throw new Error('Task policy did not load');
    const clock = await infra.call('env.snapshot');
    await infra.call('env.advance_time', {
      expected_version: clock.version,
      request_id: 'task-clock',
      virtual_now: '2026-11-20T06:10:00-05:00'
    });
    const card = await agent.call('keelcard.cards.get', { card_id: 'card-4417' });
    const hidden = await agent.call('keelcard.cards.reveal', { card_id: 'card-4417' });
    const declined = await infra.call('env.apply_event', {
      expected_version: (await infra.call('env.snapshot')).version,
      event: declineEvent()
    });
    if (declined.status !== 'committed') throw new Error('Decline did not commit');
    const lookup = await agent.call('keelcard.authorizations.lookup', { authorization_key: 'freshcart:fc-grace:fc-order-8812:1' });
    const beforeChange = await infra.call('env.snapshot');
    const opened = await agent.call('keelcard.controls.request_change', {
      card_id: 'card-4417',
      field: 'per_transaction',
      amount_cents: 10000,
      expected_version: beforeChange.version,
      request_id: 'task-open'
    });
    const pending = await infra.call('env.snapshot');
    const request = pending.snapshot.data.change_requests.at(-1);
    const mailClock = await syncMail(mail, pending.snapshot.virtual_now, 'mail-clock-open');
    const receiptLog = path.join(dir, run, 'messaging.receipts.jsonl');
    const published = await publishPending({
      data: pending.snapshot.data,
      router,
      inspect: inspectWith(mail),
      commit: item => applyReports(infra, [item]),
      receiptLog
    });
    const recorded = await infra.call('env.snapshot');
    const mailboxSnap = await mail.call('env.snapshot');
    const codeSend = published.sent.find(item => {
      const message = mailboxSnap.snapshot.data.messages.find(row => row.id === item.receipt.event_id);
      return message && message.body && message.body.includes('Code ');
    });
    const codeMessage = codeSend && mailboxSnap.snapshot.data.messages.find(row => row.id === codeSend.receipt.event_id);
    const matched = published.sent.every(item => {
      const message = mailboxSnap.snapshot.data.messages.find(row => row.id === item.receipt.event_id);
      return item.receipt.status === 'committed' && message && message.id === item.receipt.event_id;
    });
    const confirmed = await agent.call('keelcard.controls.confirm_change', {
      change_request_id: request.change_request_id,
      code: codeFromMessage(codeMessage),
      expected_version: recorded.version,
      request_id: 'task-confirm'
    });
    const again = await infra.call('env.snapshot');
    const second = await agent.call('keelcard.controls.request_change', {
      card_id: 'card-4417',
      field: 'per_transaction',
      amount_cents: 11000,
      expected_version: again.version,
      request_id: 'task-open-2'
    });
    const secondSnap = await infra.call('env.snapshot');
    const extra = await infra.call('env.apply_event', {
      expected_version: secondSnap.version,
      event: {
        event_id: 'task-decline-extra',
        at: secondSnap.snapshot.virtual_now,
        operation: 'authorization.request',
        payload: {
          authorization_key: 'freshcart:fc-grace:fc-order-8813:1',
          amount_cents: 15000,
          currency: 'USD',
          card: { card_id: 'card-4417', number: '9417220000014417', expiry: '2028-09', security_code: '317' },
          merchant: { merchant_id: 'm-freshcart', name: 'FreshCart', category: 'grocery' }
        }
      }
    });
    if (extra.status !== 'committed') throw new Error('The extra decline did not commit');
    await router.close();
    await mail.close();
    await agent.close();
    await infra.close();
    router = null;
    mail = null;
    agent = null;
    infra = null;
    const reopenedKeel = new Client('keelcard', 'infra', run, dir, 'task-reopen-keel', { registry });
    const reopenedMail = new Client('mail', 'infra', run, dir, 'task-reopen-mail', { registry });
    await reopenedKeel.initialize();
    await reopenedMail.initialize();
    const reopened = await reopenedKeel.call('env.snapshot');
    for (const notice of reopened.snapshot.data.notices.filter(item => item.status === 'committed')) {
      const status = await reopenedMail.call('env.event_status', { event_id: notice.delivery.event_id });
      if (!status.receipt || status.receipt.status !== 'committed' || status.receipt.event_id !== notice.delivery.event_id) {
        throw new Error('Reopened Mail did not confirm the saved event id');
      }
    }
    await reopenedKeel.close();
    await reopenedMail.close();
    const rejection = await emptyGrantRoute();
    const lost = await ackLossRoute();
    return {
      card_limit: card.card.limits.per_transaction,
      reveal_status: hidden.status,
      decline_code: lookup.authorization.decline_code,
      hold_cents: lookup.authorization.hold_cents,
      opened: opened.status,
      mail_ids_match: matched,
      mail_clock: mailClock.snapshot.virtual_now,
      keelcard_clock: pending.snapshot.virtual_now,
      notices_committed: recorded.snapshot.data.notices.every(notice => notice.status === 'committed'),
      confirmed: confirmed.outcome,
      second_opened: second.status,
      rejection: rejection.outcome,
      rejection_code: rejection.code,
      rejection_cloud_id: rejection.cloud_event_id,
      rejection_publish_id: rejection.publish_request_id,
      rejection_ids_unchanged: rejection.ids_unchanged,
      lost_ack: lost.outcome,
      lost_status: lost.status,
      second_send: lost.second_send
    };
  } finally {
    if (router) await router.close();
    if (mail) await mail.close();
    if (agent) await agent.close();
    if (infra) await infra.close();
  }
}

function processIds() {
  return require('node:child_process').execSync('ps -ww -eo pid,args', { encoding: 'utf8' });
}

function mailChild(dir, run) {
  const line = processIds().split('\n').find(row => row.includes('--app mail') && row.includes('--run ' + run) && row.includes(dir));
  return line ? Number(line.trim().split(/\s+/)[0]) : null;
}

async function emptyGrantRoute() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keelcard-task-reject-'));
  const run = 'task75reject';
  const binding = JSON.parse(fs.readFileSync(shipped, 'utf8'));
  binding.publishers[0].allowed_recipients = [];
  const bindingFile = path.join(dir, 'empty-grant.json');
  fs.writeFileSync(bindingFile, JSON.stringify(binding));
  const infra = new Client('keelcard', 'infra', run, dir, 'task-reject-infra', { registry });
  const agent = new Client('keelcard', 'agent', run, dir, 'task-reject-agent', { registry });
  await infra.initialize();
  await agent.initialize();
  const bound = await mailbox(dir, run);
  const beforeCount = (await bound.call('env.snapshot')).snapshot.data.messages.length;
  await bound.close();
  const router = await create({ config: bindingFile, publisher: 'keelcard', run, stateDir: dir });
  try {
    const minimal = require('../fixtures/minimal.json');
    const householdBinding = require('../fixtures/binding.json');
    const opening = await infra.call('env.snapshot');
    const opened = await infra.call('env.load_seed', {
      expected_version: opening.version,
      request_id: 'reject-seed',
      data: minimal,
      binding: householdBinding,
      policies: require('./task-data/policies.json'),
      virtual_now: minimal.initial_clock
    });
    if (opened.status !== 'ready') throw new Error('The empty-grant seed did not load: ' + opened.status + ' ' + (opened.message || ''));
    const requested = await agent.call('keelcard.controls.request_change', {
      card_id: 'card-4417',
      field: 'per_transaction',
      amount_cents: 10000,
      expected_version: opened.version,
      request_id: 'reject-open'
    });
    if (requested.status !== 'committed') throw new Error('The empty-grant request did not open: ' + requested.status + ' ' + (requested.message || ''));
    const snap = await infra.call('env.snapshot');
    const published = await publishPending({
      data: snap.snapshot.data,
      router,
      commit: item => applyReports(infra, [item])
    });
    const after = await infra.call('env.snapshot');
    const attemptedId = published.sent[0] && published.sent[0].notice_id;
    const saved = after.snapshot.data.notices.find(item => item.notice_id === attemptedId);
    const original = snap.snapshot.data.notices.find(item => item.notice_id === attemptedId);
    const mail = new Client('mail', 'infra', run, dir, 'task-reject-mail', { registry });
    await mail.initialize();
    const afterMail = await mail.call('env.snapshot');
    await mail.close();
    if (afterMail.snapshot.data.messages.length !== beforeCount) throw new Error('An empty grant stored a Mail message');
    if (published.sent.length !== 1) throw new Error('An empty grant published more than the rejected notice');
    return {
      outcome: published.report && published.report.outcome,
      code: published.report && published.report.code,
      cloud_event_id: saved.cloud_event_id,
      publish_request_id: saved.publish_request_id,
      ids_unchanged: saved.cloud_event_id === original.cloud_event_id && saved.publish_request_id === original.publish_request_id
    };
  } finally {
    await router.close();
    await agent.close();
    await infra.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function ackLossRoute() {
  let last = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const trial = await oneAckLoss(attempt);
    last = trial;
    if (trial && trial.receipt_status === 'unknown' && trial.message_present) return trial;
  }
  throw new Error('Receiver acknowledgement was not lost after Mail committed. Last status: ' + (last && last.receipt_status) + ' ' + (last && last.receipt_code));
}

async function oneAckLoss() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keelcard-task-loss-'));
  const run = 'task75loss';
  fs.mkdirSync(path.join(dir, run), { recursive: true });
  const infra = new Client('keelcard', 'infra', run, dir, 'task-loss-infra', { registry });
  const agent = new Client('keelcard', 'agent', run, dir, 'task-loss-agent', { registry });
  await infra.initialize();
  await agent.initialize();
  const bound = await mailbox(dir, run);
  const mailFile = path.join(dir, run, 'mail.json');
  let router = null;
  let watcher = null;
  try {
    const minimal = require('../fixtures/minimal.json');
    const householdBinding = require('../fixtures/binding.json');
    const opening = await infra.call('env.snapshot');
    const opened = await infra.call('env.load_seed', {
      expected_version: opening.version,
      request_id: 'loss-seed',
      data: minimal,
      binding: householdBinding,
      policies: require('./task-data/policies.json'),
      virtual_now: minimal.initial_clock
    });
    if (opened.status !== 'ready') throw new Error('The acknowledgement-loss seed did not load: ' + opened.status + ' ' + (opened.message || ''));
    const first = await agent.call('keelcard.controls.request_change', {
      card_id: 'card-4417',
      field: 'per_transaction',
      amount_cents: 10000,
      expected_version: opened.version,
      request_id: 'loss-open'
    });
    if (first.status !== 'committed') throw new Error('The first notice was not created');
    const mid = await infra.call('env.snapshot');
    const second = await infra.call('env.apply_event', {
      expected_version: mid.version,
      event: {
        event_id: 'loss-decline',
        at: mid.snapshot.virtual_now,
        operation: 'authorization.request',
        payload: {
          authorization_key: 'freshcart:fc-grace:loss:1',
          amount_cents: 9000,
          currency: 'USD',
          card: { card_id: 'card-4417', number: '9417220000014417', expiry: '2028-09', security_code: '317' },
          merchant: { merchant_id: 'm-freshcart', name: 'FreshCart', category: 'grocery' }
        }
      }
    });
    if (second.status !== 'committed') throw new Error('The second notice was not created');
    const snap = await infra.call('env.snapshot');
    await syncMail(bound, snap.snapshot.virtual_now, 'loss-mail-clock');
    await bound.close();
    router = await create({ config: shipped, publisher: 'keelcard', run, stateDir: dir });
    const child = mailChild(dir, run);
    if (!child) throw new Error('The Mail receiver process was not found');
    const pending = snap.snapshot.data.notices.filter(item => item.status === 'pending_delivery');
    const target = pending[0];
    const held = pending[1];
    const lock = path.join(dir, run, 'mail.lock');
    watcher = require('node:child_process').spawn(process.execPath, ['-e', `
      const fs = require('fs');
      const file = process.argv[1];
      const pid = Number(process.argv[2]);
      const lockDir = process.argv[3];
      const before = fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        let changed = false;
        try { changed = fs.statSync(file).mtimeMs !== before; } catch (error) { changed = false; }
        if (changed) {
          try { process.kill(pid, 'SIGKILL'); } catch (error) {}
          try { fs.rmdirSync(lockDir); } catch (error) {}
          process.exit(0);
        }
      }
      process.exit(1);
    `, mailFile, String(child), lock], { stdio: 'ignore' });
    const published = await publishPending({
      data: snap.snapshot.data,
      router,
      receiptLog: path.join(dir, run, 'messaging.receipts.jsonl')
    });
    if (watcher) watcher.kill('SIGTERM');
    watcher = null;
    const receipt = published.sent[0] && published.sent[0].receipt;
    const mail = new Client('mail', 'infra', run, dir, 'task-loss-mail', { registry });
    await mail.initialize();
    let message = null;
    try {
      const box = await mail.call('env.snapshot');
      message = box.snapshot.data.messages.find(item => item.id === (receipt && receipt.event_id));
    } catch {
      message = null;
    }
    if (!receipt || receipt.status !== 'unknown' || !message) {
      await mail.close();
      return { receipt_status: receipt && receipt.status, receipt_code: receipt && receipt.code, message_present: Boolean(message) };
    }
    const inspected = await publishPending({
      data: (await infra.call('env.snapshot')).snapshot.data,
      router,
      inspect: inspectWith(mail),
      commit: item => applyReports(infra, [item]),
      receiptLog: path.join(dir, run, 'messaging.receipts.jsonl')
    });
    const after = await infra.call('env.snapshot');
    const saved = after.snapshot.data.notices.find(item => item.notice_id === target.notice_id);
    const quiet = await publishPending({
      data: after.snapshot.data,
      router,
      inspect: inspectWith(mail),
      receiptLog: path.join(dir, run, 'messaging.receipts.jsonl')
    });
    await infra.close();
    await agent.close();
    await mail.close();
    const reopenedKeel = new Client('keelcard', 'infra', run, dir, 'task-loss-reopen-keel', { registry });
    const reopenedMail = new Client('mail', 'infra', run, dir, 'task-loss-reopen-mail', { registry });
    await reopenedKeel.initialize();
    await reopenedMail.initialize();
    const again = await reopenedKeel.call('env.snapshot');
    const reopenedNotice = again.snapshot.data.notices.find(item => item.notice_id === target.notice_id);
    const status = await reopenedMail.call('env.event_status', { event_id: reopenedNotice.delivery.event_id });
    await reopenedKeel.close();
    await reopenedMail.close();
    if (!status.receipt || status.receipt.event_id !== reopenedNotice.delivery.event_id) {
      throw new Error('The persisted event id does not match Mail');
    }
    const heldRow = again.snapshot.data.notices.find(item => item.notice_id === held.notice_id);
    if (!heldRow || heldRow.status !== 'pending_delivery') throw new Error('The unsent notice was changed');
    if (saved.cloud_event_id !== target.cloud_event_id) throw new Error('Acknowledgement loss changed the publication id');
    return {
      receipt_status: 'unknown',
      message_present: true,
      outcome: inspected.report && inspected.report.outcome,
      status: reopenedNotice.status,
      second_send: quiet.sent.filter(item => !item.recovered).length
    };
  } finally {
    if (watcher) watcher.kill('SIGTERM');
    if (router) await router.close().catch(() => {});
    await bound.close().catch(() => {});
    await agent.close().catch(() => {});
    await infra.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { runTaskSession };

if (require.main === module) {
  runTaskSession().then(summary => {
    process.stdout.write(JSON.stringify(summary) + '\n');
  }).catch(error => {
    process.stderr.write(String(error && error.stack || error) + '\n');
    process.exit(1);
  });
}
