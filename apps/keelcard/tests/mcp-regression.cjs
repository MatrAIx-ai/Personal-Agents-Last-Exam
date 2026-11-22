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
    const denials = requestId => Object.entries(joined.rejected).filter(([key]) => key.endsWith('|' + requestId)).flatMap(([, rows]) => rows);
    assert.equal(denials('renamed').length, 0);
    assert.equal(denials('missing-one').length, 2);
    assert.equal(denials('missing-two').length, 1);
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
    assert.equal(calls, 1);
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
  assert.equal(summary.mail_clock, summary.keelcard_clock);
  assert.equal(summary.rejection, 'rejected');
  assert.equal(summary.rejection_code, 'recipient_not_authorized');
  assert.equal(summary.rejection_ids_unchanged, true);
  assert.equal(summary.lost_ack, 'confirmed');
  assert.equal(summary.lost_status, 'committed');
  assert.equal(summary.second_send, 0);
});

function authEvent(id, key, amount, at) {
  return {
    event_id: id,
    at,
    operation: 'authorization.request',
    payload: {
      authorization_key: key,
      amount_cents: amount,
      currency: 'USD',
      card: { card_id: 'card-4417', number: '9417220000014417', expiry: '2028-09', security_code: '317' },
      merchant: { merchant_id: 'm-freshcart', name: 'FreshCart', category: 'grocery' }
    }
  };
}

test('a same-instant reversal or partial capture keeps the decline', async () => {
  const at = '2026-11-18T09:00:00-08:00';
  async function prepare(run) {
    const session = await keel(run);
    const data = structuredClone(minimal);
    data.cards.find(card => card.card_id === 'card-4417').limits.per_day = 10000;
    const loaded = await load(session.infra, data, householdBinding, at);
    assert.equal(loaded.status, 'ready');
    const held = await session.infra.call('env.apply_event', {
      expected_version: (await session.infra.call('env.snapshot')).version,
      event: authEvent(run + '-hold', 'freshcart:fc-grace:tie:1', 6000, at)
    });
    assert.equal(held.status, 'committed');
    const declined = await session.infra.call('env.apply_event', {
      expected_version: (await session.infra.call('env.snapshot')).version,
      event: authEvent(run + '-decline', 'freshcart:fc-grace:tie:2', 6000, at)
    });
    assert.equal(declined.status, 'committed');
    return session;
  }
  const reversed = await prepare('mcptie-reverse');
  try {
    const version = (await reversed.infra.call('env.snapshot')).version;
    const result = await reversed.infra.call('env.apply_event', {
      expected_version: version,
      event: {
        event_id: 'tie-reverse',
        at,
        operation: 'authorization.reverse',
        payload: { authorization_key: 'freshcart:fc-grace:tie:1', reason: 'same instant' }
      }
    });
    assert.equal(result.status, 'committed');
    const snap = await reversed.infra.call('env.snapshot');
    const decline = snap.snapshot.data.declines.find(row => row.authorization_key === 'freshcart:fc-grace:tie:2');
    assert.equal(decline.decline_code, 'exceeds_daily_limit');
    assert.equal(decline.limits_in_force.spend_in_force_cents, 6000);
    assert.equal(snap.snapshot.data.authorizations.find(row => row.authorization_key === 'freshcart:fc-grace:tie:1').status, 'reversed');
    const follow = await reversed.infra.call('env.apply_event', {
      expected_version: snap.version,
      event: authEvent('tie-dollar-reverse', 'freshcart:fc-grace:tie:3', 100, at)
    });
    assert.equal(follow.status, 'committed');
    const followed = await reversed.infra.call('env.snapshot');
    assert.equal(followed.snapshot.data.authorizations.find(row => row.authorization_key === 'freshcart:fc-grace:tie:3').status, 'pending');
  } finally {
    await reversed.close();
  }
  const captured = await prepare('mcptie-capture');
  try {
    const version = (await captured.infra.call('env.snapshot')).version;
    const result = await captured.infra.call('env.apply_event', {
      expected_version: version,
      event: {
        event_id: 'tie-capture',
        at,
        operation: 'authorization.capture',
        payload: { authorization_key: 'freshcart:fc-grace:tie:1', capture_key: 'tie-cap', amount_cents: 1000 }
      }
    });
    assert.equal(result.status, 'committed');
    const snap = await captured.infra.call('env.snapshot');
    const row = snap.snapshot.data.authorizations.find(item => item.authorization_key === 'freshcart:fc-grace:tie:1');
    assert.equal(row.status, 'captured');
    assert.equal(row.captured_cents, 1000);
    assert.equal(snap.snapshot.data.declines.some(item => item.authorization_key === 'freshcart:fc-grace:tie:2'), true);
    const follow = await captured.infra.call('env.apply_event', {
      expected_version: snap.version,
      event: authEvent('tie-dollar-capture', 'freshcart:fc-grace:tie:3', 100, at)
    });
    assert.equal(follow.status, 'committed');
    const followed = await captured.infra.call('env.snapshot');
    assert.equal(followed.snapshot.data.authorizations.find(row => row.authorization_key === 'freshcart:fc-grace:tie:3').status, 'pending');
    assert.equal(followed.snapshot.data.declines.find(row => row.authorization_key === 'freshcart:fc-grace:tie:2').limits_in_force.spend_in_force.per_day, 6000);
  } finally {
    await captured.close();
  }
});

test('each denial keeps its own target and reason, and identical calls report ambiguity', async () => {
  const session = await keel('mcppair');
  try {
    const policies = require('../examples/task-data/policies.json');
    const opening = await session.infra.call('env.snapshot');
    await session.infra.call('env.load_seed', {
      expected_version: opening.version,
      request_id: 'pair-policy',
      data: opening.snapshot.data,
      binding: opening.snapshot.binding,
      policies,
      bundle: opening.snapshot.resources.bundle
    });
    const version = (await session.infra.call('env.snapshot')).version;
    const firstArgs = { card_id: 'first-card', field: 'per_transaction', amount_cents: 10000, expected_version: version, request_id: 'pair-both' };
    const first = await session.agent.call('keelcard.controls.request_change', firstArgs);
    const stale = { epoch: version.epoch - 1, revision: 0 };
    const secondArgs = { card_id: 'second-card', field: 'per_transaction', amount_cents: 10000, expected_version: stale, request_id: 'pair-both' };
    const second = await session.agent.call('keelcard.controls.request_change', secondArgs);
    const snap = await session.infra.call('env.snapshot');
    const joined = joinEvidence(snap.snapshot, [
      { request_id: 'pair-both', tool: 'keelcard.controls.request_change', run_id: snap.snapshot.run_id, epoch: version.epoch, arguments: firstArgs, result: first },
      { request_id: 'pair-both', tool: 'keelcard.controls.request_change', run_id: snap.snapshot.run_id, epoch: version.epoch, arguments: secondArgs, result: second }
    ]);
    assert.equal(first.status, 'not_found');
    assert.equal(second.status, 'stale_version');
    const pairRows = Object.values(joined.rejected).flat();
    assert.equal(joined.logical_rejections.length, 2);
    assert.equal(pairRows.find(row => row.target === 'first-card').reason, 'not_found');
    assert.equal(pairRows.find(row => row.target === 'second-card').reason, 'stale_version');
    assert.equal(pairRows.find(row => row.target === 'first-card').arguments.card_id, 'first-card');
    assert.equal(pairRows.find(row => row.target === 'second-card').arguments.card_id, 'second-card');
    const ambiguous = joinEvidence({
      run_id: 'pair',
      app_id: 'keelcard',
      data: { account_id: 'kc-adeyemi', authorizations: [], declines: [], change_requests: [], control_changes: [], reveals: [], notices: [], fingerprints: [] },
      audit: [
        { tool: 'keelcard.cards.get', decision: 'deny', reason: 'not_found', input: { request_id: 'amb' } },
        { tool: 'keelcard.cards.get', decision: 'deny', reason: 'not_found', input: { request_id: 'amb' } }
      ]
    }, [
      { request_id: 'amb', tool: 'keelcard.cards.get', arguments: { card_id: 'a' }, result: { status: 'not_found' } },
      { request_id: 'amb', tool: 'keelcard.cards.get', arguments: { card_id: 'b' }, result: { status: 'not_found' } }
    ]);
    assert.equal(ambiguous.ambiguous.length, 2);
    assert.equal(ambiguous.rejected.amb, undefined);
    assert.equal(ambiguous.paired[0].arguments.card_id, 'a');
    assert.equal(ambiguous.paired[1].arguments.card_id, 'b');
  } finally {
    await session.close();
  }
});

test('the supported load path uses the seed clock, then the host clock can advance', async () => {
  const session = await keel('mcpclockseed');
  const { assertLoadClock } = require('../src/model.cjs');
  try {
    assert.throws(() => assertLoadClock(delegate, '2026-11-19T08:00:00-05:00'), /initial clock/);
    assert.throws(() => assertLoadClock(minimal, '2026-12-01T00:00:00-05:00'), /initial clock/);
    assertLoadClock(minimal, '2026-11-18T09:00:00-08:00');
    const opened = await load(session.infra, minimal, householdBinding, minimal.initial_clock);
    assert.equal(opened.status, 'ready');
    const advanced = await session.infra.call('env.advance_time', {
      expected_version: (await session.infra.call('env.snapshot')).version,
      request_id: 'seed-clock-live',
      virtual_now: '2026-12-01T00:00:00-05:00'
    });
    assert.equal(advanced.status, 'committed');
    const cards = await session.agent.call('keelcard.cards.list', {});
    assert.equal(cards.cards.length, 2);
    const snap = await session.infra.call('env.snapshot');
    assert.equal(snap.snapshot.data.statements.some(statement => statement.statement_id === 'stmt-2026-11'), false);
  } finally {
    await session.close();
  }
});

test('closing at a deadline records expiry, and a sender reset mints a new publication id', async () => {
  const session = await keel('mcpclose');
  const { create } = require('../../../runtime/messaging/src/router.cjs');
  const shipped = path.join(root, 'apps/keelcard/examples/mail-publisher.json');
  let mail;
  let router;
  try {
    const policies = structuredClone(require('../fixtures/policies.json'));
    policies.scenario.allow = policies.sandbox.allow;
    const loaded = await load(session.infra, delegate, delegateBinding, '2026-11-18T10:00:00-05:00', policies);
    assert.equal(loaded.status, 'ready');
    await session.infra.call('env.advance_time', {
      expected_version: (await session.infra.call('env.snapshot')).version,
      request_id: 'close-deadline',
      virtual_now: '2026-11-19T08:00:00-05:00'
    });
    const closed = await session.agent.call('keelcard.cards.close', {
      card_id: 'card-cole',
      expected_version: (await session.infra.call('env.snapshot')).version,
      request_id: 'close-cole'
    });
    assert.equal(closed.status, 'committed');
    const afterClose = await session.infra.call('env.snapshot');
    assert.equal(afterClose.snapshot.data.change_requests[0].status, 'expired');
    const household = await load(session.infra, minimal, householdBinding, '2026-11-18T09:00:00-08:00', policies);
    assert.equal(household.status, 'ready');
    const opened = await session.agent.call('keelcard.controls.request_change', {
      card_id: 'card-4417', field: 'per_transaction', amount_cents: 10000,
      expected_version: (await session.infra.call('env.snapshot')).version,
      request_id: 'reset-open-1'
    });
    assert.equal(opened.status, 'committed');
    mail = new Client('mail', 'infra', 'mcpclose', session.dir, 'reset-mail', { registry });
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
      expected_version: mailbox.version, request_id: 'reset-mailbox', data, binding,
      policies: mailbox.snapshot.policies, bundle: mailbox.snapshot.resources.bundle
    })).status, 'ready');
    router = await create({ config: shipped, publisher: 'keelcard', run: 'mcpclose', stateDir: session.dir });
    const firstSnap = await session.infra.call('env.snapshot');
    const first = await publishPending({ data: firstSnap.snapshot.data, router, commit: async () => ({ status: 'committed' }) });
    assert.equal(first.sent[0].receipt.status, 'committed');
    const firstId = firstSnap.snapshot.data.notices[0].cloud_event_id;
    const reset = await session.infra.call('env.reset', {
      expected_version: (await session.infra.call('env.snapshot')).version
    });
    assert.equal(reset.status, 'ready');
    const again = await session.agent.call('keelcard.controls.request_change', {
      card_id: 'card-4417', field: 'per_transaction', amount_cents: 11000,
      expected_version: (await session.infra.call('env.snapshot')).version,
      request_id: 'reset-open-2'
    });
    assert.equal(again.status, 'committed');
    const secondSnap = await session.infra.call('env.snapshot');
    const secondId = secondSnap.snapshot.data.notices[0].cloud_event_id;
    assert.notEqual(secondId, firstId);
    const second = await publishPending({ data: secondSnap.snapshot.data, router });
    assert.equal(second.sent[0].receipt.status, 'committed');
    const letters = await mail.call('env.snapshot');
    const ids = letters.snapshot.data.messages.map(message => message.id);
    assert.equal(ids.includes(first.sent[0].receipt.event_id), true);
    assert.equal(ids.includes(second.sent[0].receipt.event_id), true);
  } finally {
    if (router) await router.close();
    if (mail) await mail.close();
    await session.close();
  }
});

test('a stale evidence write can be repeated, and a lost response is recovered from the receipt log', async () => {
  const session = await keel('mcprecover');
  const { create } = require('../../../runtime/messaging/src/router.cjs');
  const shipped = path.join(root, 'apps/keelcard/examples/mail-publisher.json');
  let mail;
  let router;
  try {
    const policies = require('../examples/task-data/policies.json');
    const opening = await session.infra.call('env.snapshot');
    await session.infra.call('env.load_seed', {
      expected_version: opening.version,
      request_id: 'recover-policy',
      data: opening.snapshot.data,
      binding: opening.snapshot.binding,
      policies,
      bundle: opening.snapshot.resources.bundle
    });
    await session.infra.call('env.advance_time', {
      expected_version: (await session.infra.call('env.snapshot')).version,
      request_id: 'recover-clock',
      virtual_now: '2026-11-20T06:14:00-05:00'
    });
    await session.agent.call('keelcard.controls.request_change', {
      card_id: 'card-4417', field: 'per_transaction', amount_cents: 10000,
      expected_version: (await session.infra.call('env.snapshot')).version,
      request_id: 'recover-open'
    });
    await session.infra.call('env.apply_event', {
      expected_version: (await session.infra.call('env.snapshot')).version,
      event: authEvent('recover-decline', 'freshcart:fc-grace:fc-recover:1', 12438, '2026-11-20T06:14:00-05:00')
    });
    mail = new Client('mail', 'infra', 'mcprecover', session.dir, 'recover-mail', { registry });
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
      expected_version: mailbox.version, request_id: 'recover-mailbox', data, binding,
      policies: mailbox.snapshot.policies, bundle: mailbox.snapshot.resources.bundle
    })).status, 'ready');
    await mail.call('env.advance_time', {
      expected_version: (await mail.call('env.snapshot')).version,
      request_id: 'recover-mail-clock',
      virtual_now: '2026-11-20T06:14:00-05:00'
    });
    router = await create({ config: shipped, publisher: 'keelcard', run: 'mcprecover', stateDir: session.dir });
    const receiptLog = path.join(session.dir, 'mcprecover', 'messaging.receipts.jsonl');
    const inspect = async ({ event_id }) => {
      const eventStatus = await mail.call('env.event_status', { event_id });
      const snap = await mail.call('env.snapshot');
      return { eventStatus, mailRecord: snap.snapshot.data.messages.find(message => message.id === event_id) || null };
    };
    let writes = 0;
    let publishCalls = 0;
    let halted = false;
    const dropping = {
      async call(name, args) {
        if (name === 'router.capabilities') {
          const caps = await router.call(name, args);
          return halted ? { ...caps, halted: true } : caps;
        }
        publishCalls += 1;
        const result = await router.call(name, args);
        halted = true;
        return { status: 'unknown', code: 'receiver_unconfirmed', stop_run: true, event_id: result.event_id };
      }
    };
    const commit = async item => {
      writes += 1;
      if (writes === 1) return { status: 'stale_version' };
      const current = await session.infra.call('env.snapshot');
      const payload = { notice_id: item.notice_id, publish_request_id: item.publish_request_id, status: item.status };
      if (item.code) payload.code = item.code;
      if (item.receipt_event_id) payload.event_id = item.receipt_event_id;
      const applied = await session.infra.call('env.apply_event', {
        expected_version: current.version,
        event: { event_id: item.event_id, at: current.snapshot.virtual_now, operation: 'notice.delivery_result', payload }
      });
      assert.equal(applied.status, 'committed');
      return applied;
    };
    const snap = await session.infra.call('env.snapshot');
    const firstNotice = snap.snapshot.data.notices.find(notice => notice.status === 'pending_delivery');
    const first = await publishPending({ data: snap.snapshot.data, router: dropping, inspect, commit, receiptLog });
    assert.equal(first.report.outcome, 'confirmed');
    assert.equal(first.report.publish_request_id, firstNotice.publish_request_id);
    assert.equal(first.report.cloud_event_id, firstNotice.cloud_event_id);
    assert.ok(first.report.event_id);
    assert.equal(publishCalls, 1);
    const pending = await session.infra.call('env.snapshot');
    assert.equal(pending.snapshot.data.notices.find(notice => notice.notice_id === firstNotice.notice_id).status, 'pending_delivery');
    const fresh = pending.snapshot.data;
    const second = await publishPending({ data: fresh, router: dropping, inspect, commit, receiptLog });
    assert.equal(second.sent.some(item => item.notice_id === firstNotice.notice_id && item.recovered), true);
    assert.equal(second.sent.some(item => item.notice_id === firstNotice.notice_id && !item.recovered), false);
    const saved = await session.infra.call('env.snapshot');
    assert.equal(saved.snapshot.data.notices.find(notice => notice.notice_id === firstNotice.notice_id).status, 'committed');
    assert.equal(saved.snapshot.data.notices.find(notice => notice.notice_id === firstNotice.notice_id).delivery.event_id, first.report.event_id);
    const quiet = await publishPending({ data: saved.snapshot.data, router: dropping, inspect, commit, receiptLog });
    assert.equal(quiet.sent.filter(item => !item.recovered && item.notice_id === firstNotice.notice_id).length, 0);
    const afterQuiet = await session.infra.call('env.snapshot');
    const extra = await session.infra.call('env.apply_event', {
      expected_version: afterQuiet.version,
      event: authEvent('recover-decline-2', 'freshcart:fc-grace:fc-recover:2', 13000, afterQuiet.snapshot.virtual_now)
    });
    assert.equal(extra.status, 'committed');
    const lossSnap = await session.infra.call('env.snapshot');
    const lossData = lossSnap.snapshot.data;
    const lossNotice = lossData.notices.find(notice => notice.status === 'pending_delivery');
    const savedCloudId = lossNotice.cloud_event_id;
    lossNotice.cloud_event_id = 'n' + 'x'.repeat(120);
    let thrown = 0;
    const losing = {
      async call(name, args) {
        if (name === 'router.capabilities') return router.call(name, args);
        thrown += 1;
        await router.call(name, args);
        throw new Error('response lost');
      }
    };
    const lost = await publishPending({
      data: lossData,
      router: losing,
      inspect,
      commit: async () => ({ status: 'stale_version' }),
      receiptLog
    });
    assert.equal(thrown, 1);
    assert.equal(lost.sent.length, 1);
    assert.equal(lost.report.outcome, 'unresolved');
    assert.equal(lost.report.halted, true);
    assert.ok(lost.report.event_id);
    assert.equal(lost.report.publish_request_id, lossNotice.publish_request_id);
    assert.equal(lost.report.cloud_event_id, lossNotice.cloud_event_id);
    const untouched = await session.infra.call('env.snapshot');
    const stored = untouched.snapshot.data.notices.find(notice => notice.notice_id === lossNotice.notice_id);
    assert.equal(stored.cloud_event_id, savedCloudId);
    assert.equal(stored.status, 'pending_delivery');
    const follow = await publishPending({
      data: untouched.snapshot.data,
      router,
      inspect,
      commit: async () => ({ status: 'stale_version' }),
      receiptLog
    });
    assert.equal(follow.sent.length, 0);
    assert.equal(follow.stopped, true);
  } finally {
    if (router) await router.close();
    if (mail) await mail.close();
    await session.close();
  }
});

test('a lost reply is stored before another notice can publish', async () => {
  const data = structuredClone(minimal);
  data.notices = [
    { notice_id: 'notice-0001-aaaa', kind: 'verification_code', status: 'pending_delivery', cloud_event_id: 'keelcard-kc-adeyemi-notice-0001-aaaa', publish_request_id: 'notice-notice-0001-aaaa', title: 'Code', body: 'Code 111111', created_at: data.initial_clock, source_object: { app_id: 'keelcard', object_type: 'change_request', object_id: 'cr-1' }, related_id: 'cr-1', delivery: null },
    { notice_id: 'notice-0002-bbbb', kind: 'authorization_declined', status: 'pending_delivery', cloud_event_id: 'keelcard-kc-adeyemi-notice-0002-bbbb', publish_request_id: 'notice-notice-0002-bbbb', title: 'Declined', body: 'Declined', created_at: data.initial_clock, source_object: { app_id: 'keelcard', object_type: 'authorization', object_id: 'auth-1' }, related_id: 'auth-1', delivery: null }
  ];
  let published = 0;
  const router = { async call() { published += 1; throw new Error('response lost'); } };
  const missingLog = path.join(os.tmpdir(), 'keelcard-missing-log-' + process.pid + '.jsonl');
  const first = await publishPending({ data, router, receiptLog: missingLog });
  assert.equal(published, 1);
  assert.equal(first.stopped, true);
  assert.equal(first.report.outcome, 'unresolved');
  assert.equal(first.report.event_id, null);
  assert.equal(first.persist[0].notice_id, 'notice-0001-aaaa');
  assert.equal(first.persist[0].publish_request_id, 'notice-notice-0001-aaaa');
  assert.equal(first.persist[0].cloud_event_id, 'keelcard-kc-adeyemi-notice-0001-aaaa');
  assert.equal(first.persist[0].receipt_event_id, null);
  assert.equal(data.notices[0].status, 'unknown');
  assert.equal(data.notices[1].status, 'pending_delivery');
  const again = await publishPending({ data: structuredClone(data), router, receiptLog: missingLog });
  assert.equal(published, 1);
  assert.equal(again.sent.length, 0);
  assert.equal(again.stopped, true);
});

test('an unrelated committed receipt does not confirm the attempt', async () => {
  const data = structuredClone(minimal);
  data.notices = [
    { notice_id: 'notice-0001-cccc', kind: 'verification_code', status: 'pending_delivery', cloud_event_id: 'keelcard-kc-adeyemi-notice-0001-cccc', publish_request_id: 'notice-notice-0001-cccc', title: 'Code', body: 'Code 111111', created_at: data.initial_clock, source_object: { app_id: 'keelcard', object_type: 'change_request', object_id: 'cr-1' }, related_id: 'cr-1', delivery: null },
    { notice_id: 'notice-0002-dddd', kind: 'authorization_declined', status: 'pending_delivery', cloud_event_id: 'keelcard-kc-adeyemi-notice-0002-dddd', publish_request_id: 'notice-notice-0002-dddd', title: 'Declined', body: 'Declined', created_at: data.initial_clock, source_object: { app_id: 'keelcard', object_type: 'authorization', object_id: 'auth-1' }, related_id: 'auth-1', delivery: null }
  ];
  let published = 0;
  const router = {
    async call() {
      published += 1;
      return { status: 'committed', event_id: 'router-attempt', stop_run: false };
    }
  };
  const inspect = async () => ({ eventStatus: { status: 'ok', receipt: { status: 'committed', event_id: 'router-other' } }, mailRecord: null });
  const first = await publishPending({ data, router, inspect });
  assert.equal(published, 1);
  assert.equal(first.report.outcome, 'unresolved');
  assert.equal(first.stopped, true);
  assert.equal(data.notices[0].status, 'unknown');
  assert.equal(data.notices[1].status, 'pending_delivery');
  assert.equal(first.persist[0].cloud_event_id, 'keelcard-kc-adeyemi-notice-0001-cccc');
  const again = await publishPending({ data, router, inspect });
  assert.equal(published, 1);
  assert.equal(again.sent.length, 0);
});

test('two stale calls keep their own versions and a second run does not consume them', async () => {
  const session = await keel('mcpversions');
  try {
    const policies = require('../examples/task-data/policies.json');
    const opened = await load(session.infra, minimal, householdBinding, minimal.initial_clock, policies);
    assert.equal(opened.status, 'ready');
    const before = await session.infra.call('env.snapshot');
    const moved = await session.infra.call('env.advance_time', {
      expected_version: before.version,
      request_id: 'version-clock',
      virtual_now: '2026-11-18T13:00:00-05:00'
    });
    assert.equal(moved.status, 'committed');
    const older = { epoch: before.version.epoch, revision: 0 };
    const otherEpoch = { epoch: before.version.epoch - 1, revision: 0 };
    const first = await session.agent.call('keelcard.controls.request_change', {
      card_id: 'card-4417',
      field: 'per_transaction',
      amount_cents: 10000,
      expected_version: older,
      request_id: 'stale-17'
    });
    const second = await session.agent.call('keelcard.controls.request_change', {
      card_id: 'card-4417',
      field: 'per_transaction',
      amount_cents: 10000,
      expected_version: otherEpoch,
      request_id: 'stale-23'
    });
    assert.equal(first.status, 'stale_version');
    assert.equal(second.status, 'stale_version');
    const snap = await session.infra.call('env.snapshot');
    const joined = joinEvidence(snap, [
      { request_id: 'stale-17', tool: 'keelcard.controls.request_change', run_id: 'other-run', arguments: { card_id: 'card-4417', expected_version: older }, result: { status: 'stale_version' } },
      { request_id: 'stale-17', tool: 'keelcard.controls.request_change', run_id: snap.snapshot.run_id, arguments: { card_id: 'card-4417', expected_version: older }, result: { status: 'stale_version' } },
      { request_id: 'stale-23', tool: 'keelcard.controls.request_change', run_id: snap.snapshot.run_id, arguments: { card_id: 'card-4417', expected_version: otherEpoch }, result: { status: 'stale_version' } }
    ]);
    assert.equal(joined.paired[0].match, 'other_run');
    assert.equal(joined.paired[0].audit, null);
    assert.equal(joined.paired[1].audit.input.expected_version.revision, 0);
    assert.equal(joined.paired[1].audit.input.expected_version.epoch, older.epoch);
    assert.equal(joined.paired[2].audit.input.expected_version.epoch, otherEpoch.epoch);
    assert.equal(joined.logical_rejections.length, 2);
    assert.equal(joined.paired[1].audit.input.request_id, 'stale-17');
    assert.equal(joined.paired[2].audit.input.request_id, 'stale-23');
  } finally {
    await session.close();
  }
});
