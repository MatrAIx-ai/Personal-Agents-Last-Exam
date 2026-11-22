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

async function applyReports(infra, reports) {
  for (const item of reports) {
    const snap = await infra.call('env.snapshot');
    const payload = {
      notice_id: item.notice_id,
      publish_request_id: item.publish_request_id,
      status: item.status
    };
    if (item.event_id) payload.event_id = item.event_id;
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
  const infra = new Client('keelcard', 'infra', run, dir, 'task-infra', { registry });
  const agent = new Client('keelcard', 'agent', run, dir, 'task-agent', { registry });
  await infra.initialize();
  await agent.initialize();
  const mail = await mailbox(dir, run);
  const router = await create({ config: shipped, publisher: 'keelcard', run, stateDir: dir });
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
    const published = await publishPending({
      data: pending.snapshot.data,
      router,
      inspect: inspectWith(mail),
      commit: item => applyReports(infra, [item])
    });
    const recorded = await infra.call('env.snapshot');
    const mailboxSnap = await mail.call('env.snapshot');
    const matched = published.sent.every(item => {
      const message = mailboxSnap.snapshot.data.messages.find(row => row.id === item.receipt.event_id);
      return item.receipt.status === 'committed' && message && message.id === item.receipt.event_id;
    });
    const confirmed = await agent.call('keelcard.controls.confirm_change', {
      change_request_id: request.change_request_id,
      code: request.code,
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
    const pendingNotices = secondSnap.snapshot.data.notices.filter(notice => notice.status === 'pending_delivery');
    const haltedId = pendingNotices[0].notice_id;
    const heldBack = pendingNotices[1].notice_id;
    const haltedData = secondSnap.snapshot.data;
    haltedData.notices.find(notice => notice.notice_id === haltedId).cloud_event_id = 'n' + 'x'.repeat(120);
    const lost = await publishPending({
      data: haltedData,
      router,
      inspect: inspectWith(mail),
      commit: item => applyReports(infra, [item])
    });
    const afterLost = await infra.call('env.snapshot');
    const quiet = await publishPending({
      data: afterLost.snapshot.data,
      router,
      inspect: inspectWith(mail),
      commit: item => applyReports(infra, [item])
    });
    const lostNotice = afterLost.snapshot.data.notices.find(notice => notice.notice_id === haltedId);
    const heldNotice = afterLost.snapshot.data.notices.find(notice => notice.notice_id === heldBack);
    if (lost.sent.length !== 1 || lost.sent[0].notice_id !== haltedId) throw new Error('A halted run published more than the first notice');
    if (!heldNotice || heldNotice.status !== 'pending_delivery') throw new Error('The unsent notice was changed');
    return {
      card_limit: card.card.limits.per_transaction,
      reveal_status: hidden.status,
      decline_code: lookup.authorization.decline_code,
      hold_cents: lookup.authorization.hold_cents,
      opened: opened.status,
      mail_ids_match: matched,
      notices_committed: recorded.snapshot.data.notices.every(notice => notice.status === 'committed'),
      confirmed: confirmed.outcome,
      second_opened: second.status,
      lost_ack: lost.report && lost.report.outcome,
      lost_status: lostNotice && lostNotice.status,
      second_send: quiet.sent.length
    };
  } finally {
    await router.close();
    await mail.close();
    await agent.close();
    await infra.close();
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
