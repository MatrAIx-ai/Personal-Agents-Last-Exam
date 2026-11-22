'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('../../../runtime/client.cjs');
const { joinEvidence } = require('../examples/join-evidence.cjs');
const { runTaskSession } = require('../examples/task-session.cjs');
const { publishPending } = require('../src/publisher.cjs');

const root = path.resolve(__dirname, '../../..');
const registry = path.join(root, 'apps.registry.json');
const delegate = require('../fixtures/delegate.json');
const delegateBinding = require('../fixtures/delegate-binding.json');
const minimal = require('../fixtures/minimal.json');
const householdBinding = require('../fixtures/binding.json');

async function keel(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keelcard-mcp-'));
  const infra = new Client('keelcard', 'infra', run, dir, 'mcp-infra', { registry });
  const agent = new Client('keelcard', 'agent', run, dir, 'mcp-agent', { registry });
  await infra.initialize();
  await agent.initialize();
  return {
    dir, infra, agent,
    async close() { await agent.close(); await infra.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  };
}

let loadSeq = 0;
async function load(infra, data, binding, virtualNow, policies) {
  const snap = await infra.call('env.snapshot');
  loadSeq += 1;
  return infra.call('env.load_seed', {
    expected_version: snap.version,
    request_id: 'load-' + loadSeq + '-' + data.account_id,
    data,
    binding,
    policies: policies || snap.snapshot.policies,
    virtual_now: virtualNow
  });
}

test('a committed clock advance still serves reads, settlement and reset', async () => {
  const session = await keel('mcpclock');
  try {
    const advanced = await session.infra.call('env.advance_time', {
      expected_version: (await session.infra.call('env.snapshot')).version,
      request_id: 'december',
      virtual_now: '2026-12-01T00:00:00-05:00'
    });
    assert.equal(advanced.status, 'committed');
    const snap = await session.infra.call('env.snapshot');
    assert.equal(snap.snapshot.virtual_now, '2026-12-01T00:00:00-05:00');
    const cards = await session.agent.call('keelcard.cards.list', {});
    assert.equal(cards.cards.length, 2);
    const settled = await session.infra.call('env.apply_event', {
      expected_version: snap.version,
      event: { event_id: 'settle-november', at: '2026-12-01T00:00:00-05:00', operation: 'ledger.settle_due', payload: {} }
    });
    assert.equal(settled.status, 'committed');
    const after = await session.infra.call('env.snapshot');
    assert.ok(after.snapshot.data.statements.some(statement => statement.statement_id === 'stmt-2026-11'));
    const reset = await session.infra.call('env.reset', { expected_version: after.version });
    assert.equal(reset.status, 'ready');
    const restored = await session.infra.call('env.snapshot');
    assert.equal(restored.snapshot.data.statements.length, minimal.statements.length);
  } finally {
    await session.close();
  }
});

test('fixture (c) stays readable at the owner deadline and a due seed is rejected', async () => {
  const session = await keel('mcpdelegate');
  try {
    const loaded = await load(session.infra, delegate, delegateBinding, '2026-11-18T10:00:00-05:00');
    assert.equal(loaded.status, 'ready');
    await session.infra.call('env.advance_time', {
      expected_version: (await session.infra.call('env.snapshot')).version,
      request_id: 'owner-deadline',
      virtual_now: '2026-11-19T08:00:00-05:00'
    });
    const snap = await session.infra.call('env.snapshot');
    assert.equal(snap.snapshot.data.change_requests[0].status, 'pending_owner');
    const listed = await session.agent.call('keelcard.controls.requests.list', {});
    assert.equal(listed.requests[0].effective_status, 'expired');
    const settled = await session.infra.call('env.apply_event', {
      expected_version: snap.version,
      event: { event_id: 'settle-owner', at: '2026-11-19T08:00:00-05:00', operation: 'ledger.settle_due', payload: {} }
    });
    assert.equal(settled.status, 'committed');
    const due = structuredClone(delegate);
    due.change_requests[0].change_request_id = 'cr-0001';
    due.change_requests[0].expires_at = '2026-11-18T09:00:00-05:00';
    const rejected = await load(session.infra, due, delegateBinding, '2026-11-18T10:00:00-05:00');
    assert.equal(rejected.status, 'invalid_seed');
    assert.equal(rejected.applied, false);
    const early = structuredClone(minimal);
    early.authorizations[0].captured_at = '2025-09-01T12:00:00-05:00';
    const reversed = await load(session.infra, early, householdBinding, '2026-11-18T09:00:00-08:00');
    assert.equal(reversed.status, 'invalid_seed');
    const tiny = structuredClone(minimal);
    tiny.declines[0].decline_code = 'exceeds_daily_limit';
    tiny.declines[0].amount_cents = 1;
    tiny.declines[0].decided_at = '2026-10-18T11:05:00-05:00';
    const impossible = await load(session.infra, tiny, householdBinding, '2026-11-18T09:00:00-08:00');
    assert.equal(impossible.status, 'invalid_seed');
    const still = await session.infra.call('env.snapshot');
    assert.equal(still.snapshot.data.account_id, 'kc-cole');
  } finally {
    await session.close();
  }
});

test('the evidence join follows request ids from the MCP audit', async () => {
  const session = await keel('mcpjoin');
  try {
    const policies = require('../examples/task-data/policies.json');
    const opening = await session.infra.call('env.snapshot');
    const loaded = await session.infra.call('env.load_seed', {
      expected_version: opening.version,
      request_id: 'join-policy',
      data: opening.snapshot.data,
      binding: opening.snapshot.binding,
      policies,
      bundle: opening.snapshot.resources.bundle
    });
    assert.equal(loaded.status, 'ready');
    const version = (await session.infra.call('env.snapshot')).version;
    const args = { card_id: 'card-4417', field: 'per_transaction', amount_cents: 10000, expected_version: version, request_id: 'renamed' };
    const success = await session.agent.call('keelcard.controls.request_change', args);
    const replay = await session.agent.call('keelcard.controls.request_change', args);
    const stale = { ...args, request_id: 'missing-one', amount_cents: 11000 };
    const denyOne = await session.agent.call('keelcard.controls.request_change', stale);
    const denyTwo = await session.agent.call('keelcard.controls.request_change', stale);
    const current = (await session.infra.call('env.snapshot')).version;
    const denyOther = await session.agent.call('keelcard.controls.request_change', {
      card_id: 'card-missing', field: 'per_transaction', amount_cents: 10000, expected_version: current, request_id: 'missing-two'
    });
    const snap = await session.infra.call('env.snapshot');
    const joined = joinEvidence(snap.snapshot, [
      { request_id: 'renamed', tool: 'keelcard.controls.request_change', result: success },
      { request_id: 'renamed', tool: 'keelcard.controls.request_change', result: replay },
      { request_id: 'missing-one', tool: 'keelcard.controls.request_change', result: denyOne },
      { request_id: 'missing-one', tool: 'keelcard.controls.request_change', result: denyTwo },
      { request_id: 'missing-two', tool: 'keelcard.controls.request_change', result: denyOther }
    ]);
    assert.equal(replay.duplicate, true);
    assert.equal(joined.rejected.renamed, undefined);
    assert.equal(joined.rejected['missing-one'].length, 2);
    assert.equal(joined.rejected['missing-two'].length, 1);
    assert.equal(joined.ambiguous.length, 0);
    assert.equal(joined.authorizations[0].limits_in_force.per_transaction, 7500);
    assert.ok(joined.requests.some(request => request.attempts.length === 0));
    const code = snap.snapshot.data.change_requests.at(-1).code;
    const confirmed = await session.agent.call('keelcard.controls.confirm_change', {
      change_request_id: snap.snapshot.data.change_requests.at(-1).change_request_id,
      code,
      expected_version: snap.version,
      request_id: 'join-confirm'
    });
    assert.equal(confirmed.outcome, 'applied');
    const done = await session.infra.call('env.snapshot');
    const after = joinEvidence(done.snapshot, []);
    const change = after.control_changes.at(-1);
    assert.equal(change.verification, 'email_code');
    assert.equal(change.applied_request_id, 'join-confirm');
    assert.notEqual(change.applied_request_id, change.request_id);
  } finally {
    await session.close();
  }
});

test('malformed owner and delivery events leave the clock and the account unchanged', async () => {
  const session = await keel('mcpguard');
  try {
    const policies = require('../examples/task-data/policies.json');
    const opening = await session.infra.call('env.snapshot');
    await session.infra.call('env.load_seed', {
      expected_version: opening.version,
      request_id: 'guard-policy',
      data: opening.snapshot.data,
      binding: opening.snapshot.binding,
      policies,
      bundle: opening.snapshot.resources.bundle
    });
    const version = (await session.infra.call('env.snapshot')).version;
    await session.agent.call('keelcard.controls.request_change', {
      card_id: 'card-4417', field: 'per_transaction', amount_cents: 10000, expected_version: version, request_id: 'guard-open'
    });
    const before = await session.infra.call('env.snapshot');
    const deadline = before.snapshot.data.change_requests[0].expires_at;
    const owner = await session.infra.call('env.apply_event', {
      expected_version: before.version,
      event: {
        event_id: 'owner-bad',
        at: deadline,
        operation: 'change_request.owner_decision',
        payload: { change_request_id: before.snapshot.data.change_requests[0].change_request_id, decision: 'approve' }
      }
    });
    assert.equal(owner.status, 'invalid_event');
    const afterOwner = await session.infra.call('env.snapshot');
    assert.equal(afterOwner.snapshot.virtual_now, before.snapshot.virtual_now);
    assert.equal(afterOwner.snapshot.data.change_requests[0].status, 'pending_verification');
    assert.equal(afterOwner.snapshot.audit.at(-1).decision, 'deny');
    const delivery = await session.infra.call('env.apply_event', {
      expected_version: afterOwner.version,
      event: {
        event_id: 'delivery-bad',
        at: afterOwner.snapshot.virtual_now,
        operation: 'notice.delivery_result',
        payload: { notice_id: afterOwner.snapshot.data.notices[0].notice_id, status: 'rejected' }
      }
    });
    assert.equal(delivery.status, 'invalid_event');
    const afterDelivery = await session.infra.call('env.snapshot');
    assert.equal(JSON.stringify(afterDelivery.snapshot.data), JSON.stringify(afterOwner.snapshot.data));
    assert.equal(afterDelivery.snapshot.virtual_now, afterOwner.snapshot.virtual_now);
    assert.equal(afterDelivery.snapshot.audit.at(-1).decision, 'deny');
  } finally {
    await session.close();
  }
});

test('alert mail names the alert and a code alert cannot be removed', async () => {
  const session = await keel('mcpalert');
  const { create } = require('../../../runtime/messaging/src/router.cjs');
  const shipped = path.join(root, 'apps/keelcard/examples/mail-publisher.json');
  let mail;
  let router;
  try {
    const policies = structuredClone(require('../fixtures/policies.json'));
    policies.scenario.allow = policies.sandbox.allow;
    const opening = await session.infra.call('env.snapshot');
    await session.infra.call('env.load_seed', {
      expected_version: opening.version,
      request_id: 'alert-policy',
      data: opening.snapshot.data,
      binding: opening.snapshot.binding,
      policies,
      bundle: opening.snapshot.resources.bundle
    });
    const blocked = await session.agent.call('keelcard.alerts.preferences.update', {
      alert: 'codes', enabled: false,
      expected_version: (await session.infra.call('env.snapshot')).version,
      request_id: 'alert-codes'
    });
    assert.equal(blocked.status, 'invalid_arguments');
    const opened = await session.agent.call('keelcard.alerts.preferences.update', {
      alert: 'declines', enabled: false,
      expected_version: (await session.infra.call('env.snapshot')).version,
      request_id: 'alert-off'
    });
    assert.equal(opened.status, 'committed');
    const snap = await session.infra.call('env.snapshot');
    assert.equal(snap.snapshot.data.change_requests.some(request => request.alert === 'codes'), false);
    const request = snap.snapshot.data.change_requests.at(-1);
    mail = new Client('mail', 'infra', 'mcpalert', session.dir, 'alert-mail', { registry });
    await mail.initialize();
    const mailbox = await mail.call('env.snapshot');
    const data = structuredClone(mailbox.snapshot.data);
    data.owner_person_id = 'person-grace';
    const binding = structuredClone(mailbox.snapshot.binding);
    for (const account of binding.accounts) {
      if (account.app_id === 'mail' && account.account_id === data.account_id) account.owner_person_id = 'person-grace';
    }
    if (!binding.people.some(person => person.person_id === 'person-grace')) binding.people.push({ person_id: 'person-grace', name: 'Grace Adeyemi' });
    assert.equal((await mail.call('env.load_seed', {
      expected_version: mailbox.version, request_id: 'alert-mailbox', data, binding,
      policies: mailbox.snapshot.policies, bundle: mailbox.snapshot.resources.bundle
    })).status, 'ready');
    router = await create({ config: shipped, publisher: 'keelcard', run: 'mcpalert', stateDir: session.dir });
    const sent = await publishPending({ data: snap.snapshot.data, router });
    const letter = await mail.call('env.snapshot');
    const message = letter.snapshot.data.messages.find(row => row.id === sent.sent[0].receipt.event_id);
    assert.equal(message.id, sent.sent[0].receipt.event_id);
    assert.match(message.body, /turning off declines alerts/);
    assert.equal(message.body.includes('undefined'), false);
    const applied = await session.agent.call('keelcard.controls.confirm_change', {
      change_request_id: request.change_request_id,
      code: request.code,
      expected_version: (await session.infra.call('env.snapshot')).version,
      request_id: 'alert-confirm'
    });
    assert.equal(applied.outcome, 'applied');
    assert.equal((await session.infra.call('env.snapshot')).snapshot.data.alerts.declines, false);
  } finally {
    if (router) await router.close();
    if (mail) await mail.close();
    await session.close();
  }
});

test('an inspection failure is unresolved and is recorded through Infra', async () => {
  const session = await keel('mcpinspect');
  try {
    const policies = require('../examples/task-data/policies.json');
    const opening = await session.infra.call('env.snapshot');
    await session.infra.call('env.load_seed', {
      expected_version: opening.version,
      request_id: 'inspect-policy',
      data: opening.snapshot.data,
      binding: opening.snapshot.binding,
      policies,
      bundle: opening.snapshot.resources.bundle
    });
    await session.agent.call('keelcard.controls.request_change', {
      card_id: 'card-4417', field: 'per_transaction', amount_cents: 12000,
      expected_version: (await session.infra.call('env.snapshot')).version,
      request_id: 'inspect-open'
    });
    await session.infra.call('env.apply_event', {
      expected_version: (await session.infra.call('env.snapshot')).version,
      event: {
        event_id: 'inspect-decline',
        at: '2026-11-20T13:00:00-05:00',
        operation: 'authorization.request',
        payload: {
          authorization_key: 'freshcart:fc-grace:fc-inspect:1',
          amount_cents: 9000,
          currency: 'USD',
          card: { number: '9417220000014417', expiry: '2028-09', security_code: '317' },
          merchant: { merchant_id: 'm-freshcart', name: 'FreshCart', category: 'grocery' }
        }
      }
    });
    const snap = await session.infra.call('env.snapshot');
    let calls = 0;
    const report = await publishPending({
      data: snap.snapshot.data,
      router: { async call() { calls += 1; return { status: 'unknown', code: 'receiver_unconfirmed', stop_run: true, event_id: 'router-' + 'c'.repeat(32) }; } },
      inspect: async () => { throw new Error('inspection is down'); },
      commit: async item => {
        const current = await session.infra.call('env.snapshot');
        const payload = { notice_id: item.notice_id, publish_request_id: item.publish_request_id, status: item.status };
        if (item.code) payload.code = item.code;
        const applied = await session.infra.call('env.apply_event', {
          expected_version: current.version,
          event: { event_id: 'delivery-' + item.notice_id, at: current.snapshot.virtual_now, operation: 'notice.delivery_result', payload }
        });
        assert.equal(applied.status, 'committed');
      }
    });
    assert.equal(report.report.outcome, 'unresolved');
    assert.equal(report.sent.length, 1);
    assert.equal(calls, 2);
    const fresh = await session.infra.call('env.snapshot');
    assert.equal(fresh.snapshot.data.notices[0].status, 'unknown');
    assert.equal(fresh.snapshot.data.notices[1].status, 'pending_delivery');
  } finally {
    await session.close();
  }
});

test('the task session uses Infra, the Agent, Mail and reconciliation', async () => {
  const summary = await runTaskSession();
  assert.equal(summary.card_limit, 7500);
  assert.equal(summary.reveal_status, 'permission_denied');
  assert.equal(summary.decline_code, 'exceeds_transaction_limit');
  assert.equal(summary.hold_cents, 0);
  assert.equal(summary.mail_ids_match, true);
  assert.equal(summary.notices_committed, true);
  assert.equal(summary.confirmed, 'applied');
  assert.equal(summary.lost_ack, 'unresolved');
  assert.equal(summary.lost_status, 'unknown');
  assert.equal(summary.second_send, 0);
});
