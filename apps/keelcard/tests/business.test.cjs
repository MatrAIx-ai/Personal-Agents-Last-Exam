'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fixture } = require('./harness.cjs');
const { compile } = require('./schema-validator.cjs');
const { addMinutes, parts } = require('../src/domain-utils.cjs');
const { scan } = require('../src/fingerprints.cjs');
const { wireFor } = require('../src/publisher.cjs');
const { classifyDelivery, publishPending, receiptForNotice } = require('../src/publisher.cjs');

const GROCERY = '9417220000014417';
const CARD = 'card-4417';
const CLOCK = '2026-11-18T09:00:00-08:00';
const SESSION = '2026-11-20T06:10:00-05:00';

function boom(fn) {
  try { fn(); return null; } catch (error) { return error; }
}

function weekday(iso) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date(iso));
}

function groceryEvent(id, key, amount, at, patch = {}) {
  return {
    event_id: id,
    at,
    operation: 'authorization.request',
    payload: {
      authorization_key: key,
      amount_cents: amount,
      currency: 'USD',
      card: { number: GROCERY, expiry: '2028-09', security_code: '317' },
      merchant: { merchant_id: 'm-freshcart', name: 'FreshCart', category: 'grocery' },
      merchant_ref: { app_id: 'freshcart', account_id: 'fc-grace', object_type: 'order', object_id: key.split(':')[2] },
      ...patch
    }
  };
}

function underCeiling() {
  return { per_transaction: 20000, per_day: 20000, per_month: 20000, lifetime: 20000 };
}

test('fixture (a) matches the household grocery task', () => {
  const f = fixture();
  const data = f.data;
  assert.equal(data.account_id, 'kc-adeyemi');
  assert.equal(data.owner_person_id, 'person-grace');
  assert.equal(data.verification.mode, 'email_code');
  assert.equal(data.verification.owner_window_hours, 24);
  assert.equal(data.cards.length, 2);
  const grocery = data.cards[0];
  assert.equal(grocery.card_id, CARD);
  assert.equal(grocery.last_four, '4417');
  assert.equal(grocery.number, GROCERY);
  assert.equal(grocery.limits.per_transaction, 7500);
  assert.equal(grocery.merchant_lock, 'm-freshcart');
  assert.equal(data.cards[1].last_four, '8821');
  assert.equal(data.cards[1].number, '9417000000088821');
  const weeks = data.authorizations.filter(row => row.card_id === CARD);
  assert.equal(weeks.length, 61);
  for (const row of weeks) {
    const local = parts(row.decided_at, 'America/New_York');
    assert.equal(weekday(row.decided_at), 'Sat');
    assert.equal(local.hour, 8);
    assert.equal(local.minute, 12);
    assert.ok(row.amount_cents < 7500);
    assert.equal(row.status, 'captured');
  }
  assert.equal(weeks.at(-1).decided_at.startsWith('2026-11-14'), true);
  const snack = data.authorizations.find(row => row.authorization_id === 'auth-snack');
  assert.equal(snack.amount_cents, 21240);
  assert.equal(snack.card_id, 'card-8821');
  const decline = data.declines[0];
  assert.equal(decline.authorization_key, 'freshcart:fc-grace:fc-over-1:1');
  assert.equal(decline.amount_cents, 9000);
  assert.equal(decline.decline_code, 'exceeds_transaction_limit');
  assert.equal(data.statements.at(-1).statement_id, 'stmt-2026-10');
  assert.equal(data.change_requests.length, 0);
  assert.equal(data.notices.length, 0);
  assert.equal(data.authorizations.some(row => row.status === 'pending'), false);
  assert.equal(data.funding.balance_cents, 441170);
  const april = data.ledger.find(entry => entry.authorization_id === 'auth-snack');
  assert.equal(april.balance_after_cents, 613905);
});

test('reads hide card numbers, security codes and verification codes', () => {
  const f = fixture();
  const listed = f.call('keelcard.cards.list');
  const card = f.call('keelcard.cards.get', { card_id: CARD });
  const controls = f.call('keelcard.controls.get');
  const declines = f.call('keelcard.declines.list');
  const summary = f.call('keelcard.spend.summary', { card_id: CARD });
  const lookup = f.call('keelcard.authorizations.lookup', { authorization_key: 'freshcart:fc-grace:fc-over-1:1' });
  const missing = f.call('keelcard.authorizations.lookup', { authorization_key: 'freshcart:fc-grace:missing:1' });
  const statements = f.call('keelcard.statements.list');
  const text = JSON.stringify({ listed, card, controls, declines, summary, lookup, missing, statements });
  assert.equal(text.includes(GROCERY), false);
  assert.equal(text.includes('"security_code"'), false);
  assert.equal(listed.cards.length, 2);
  assert.equal(card.card.limits.per_transaction, 7500);
  assert.equal(lookup.authorization.decline_code, 'exceeds_transaction_limit');
  assert.equal(lookup.authorization.amount_cents, 9000);
  assert.equal(missing.authorization, null);
  assert.equal(summary.summary.funding_balance_cents, 441170);
  assert.equal(statements.statements.length, 14);
  assert.equal(declines.declines[0].hold_cents, 0);
  const closed = f.call('keelcard.cards.close', { card_id: 'card-8821' });
  assert.equal(closed.card_status, 'closed');
  assert.equal(f.call('keelcard.cards.list').cards.some(item => item.card_id === 'card-8821'), false);
  assert.equal(f.call('keelcard.cards.list', { include_closed: true }).cards.some(item => item.card_id === 'card-8821'), true);
});

test('delegate card writes stay inside the owner ceiling', () => {
  const f = fixture();
  const over = boom(() => f.call('keelcard.cards.create', {
    type: 'general', nickname: 'Too high', limits: { per_transaction: 20001, per_day: 20000, per_month: 20000, lifetime: 20000 }
  }));
  assert.equal(over.code, 'delegate_card_limit_exceeded');
  assert.equal(f.data.cards.length, 2);
  const created = f.call('keelcard.cards.create', { type: 'general', nickname: 'Trip', limits: underCeiling() });
  assert.equal(created.card_status, 'active');
  assert.equal(JSON.stringify(created).includes(f.data.cards.at(-1).number), false);
  assert.equal(f.data.fingerprints.length, 3);
  const renamed = f.call('keelcard.cards.update', { card_id: created.card_id, nickname: 'Weekend' });
  assert.equal(renamed.nickname, 'Weekend');
  assert.equal(f.call('keelcard.cards.pause', { card_id: created.card_id }).card_status, 'paused');
  assert.equal(f.call('keelcard.cards.unpause', { card_id: created.card_id }).card_status, 'active');
  const revealed = f.call('keelcard.cards.reveal', { card_id: created.card_id });
  assert.equal(revealed.number, f.data.cards.find(card => card.card_id === created.card_id).number);
  assert.equal(f.data.reveals.length, 1);
  f.mutate(data => { data.delegate.may_reveal = false; });
  assert.equal(boom(() => f.call('keelcard.cards.reveal', { card_id: CARD })).code, 'reveal_not_permitted');
  assert.equal(f.data.reveals.length, 1);
});

test('owner pause needs a change request and delegate pause does not', () => {
  const f = fixture();
  f.mutate(data => {
    const card = data.cards.find(item => item.card_id === 'card-8821');
    card.status = 'paused';
    card.paused_by = 'owner';
  });
  assert.equal(boom(() => f.call('keelcard.cards.unpause', { card_id: 'card-8821' })).code, 'permission_denied');
  const opened = f.call('keelcard.controls.request_change', { card_id: 'card-8821', field: 'unpause' });
  const stored = f.data.change_requests[0];
  assert.equal(opened.request_status, 'pending_verification');
  assert.equal(JSON.stringify(opened).includes(stored.code), false);
  const applied = f.call('keelcard.controls.confirm_change', { change_request_id: stored.change_request_id, code: stored.code });
  assert.equal(applied.outcome, 'applied');
  assert.equal(f.data.cards.find(card => card.card_id === 'card-8821').status, 'active');
});

test('email codes commit rejections, expiry and a successful raise', () => {
  const f = fixture();
  const opened = f.call('keelcard.controls.request_change', {
    card_id: CARD, field: 'per_transaction', amount_cents: 10000
  });
  const stored = f.data.change_requests[0];
  assert.equal(opened.limit_cents, 10000);
  assert.equal(stored.code.length, 6);
  assert.equal(JSON.stringify(opened).includes('Code ' + stored.code), false);
  assert.equal(f.call('keelcard.controls.requests.list').requests[0].code, undefined);
  const notice = f.data.notices[0];
  assert.match(notice.body, new RegExp('Code ' + stored.code + ' confirms raising the per-transaction limit on card 4417 from \\$75\\.00 to \\$100\\.00\\.'));
  assert.match(notice.body, /It expires at \d{1,2}:\d{2} (AM|PM)\./);
  const wrong = stored.code === '000000' ? '000001' : '000000';
  assert.equal(f.call('keelcard.controls.confirm_change', { change_request_id: stored.change_request_id, code: wrong }).outcome, 'code_rejected');
  assert.equal(f.data.cards[0].limits.per_transaction, 7500);
  assert.equal(f.data.change_requests[0].attempts_used, 1);
  assert.equal(boom(() => f.call('keelcard.controls.request_change', { card_id: CARD, field: 'per_transaction', amount_cents: 15000 })).code, 'request_already_open');
  const second = fixture();
  second.call('keelcard.controls.request_change', { card_id: CARD, field: 'per_transaction', amount_cents: 12000 });
  const request = second.data.change_requests[0];
  const wrongCode = request.code === '111111' ? '111112' : '111111';
  for (let n = 0; n < 2; n += 1) {
    assert.equal(second.call('keelcard.controls.confirm_change', { change_request_id: request.change_request_id, code: wrongCode }).outcome, 'code_rejected');
  }
  const exhausted = second.call('keelcard.controls.confirm_change', { change_request_id: request.change_request_id, code: wrongCode });
  assert.equal(exhausted.outcome, 'attempts_exhausted');
  assert.equal(second.data.cards[0].limits.per_transaction, 7500);
  assert.equal(boom(() => second.call('keelcard.controls.confirm_change', { change_request_id: request.change_request_id, code: request.code })).code, 'no_pending_request');
  const applied = f.call('keelcard.controls.confirm_change', { change_request_id: stored.change_request_id, code: stored.code });
  assert.equal(applied.outcome, 'applied');
  assert.equal(applied.limit_cents, 10000);
  assert.equal(f.data.cards[0].limits.per_transaction, 10000);
  assert.equal(f.data.control_changes.at(-1).request_id, stored.request_id);
  assert.notEqual(f.data.control_changes.at(-1).applied_request_id, stored.request_id);
  const change = f.data.control_changes.at(-1);
  assert.equal(change.changed_by, 'delegate');
  assert.equal(change.verification, 'email_code');
});

test('a code is expired at its deadline and a wrong code still counts before that', () => {
  const early = fixture();
  early.call('keelcard.controls.request_change', { card_id: CARD, field: 'per_transaction', amount_cents: 11000 });
  const earlyRequest = early.data.change_requests[0];
  early.advance(addMinutes(earlyRequest.expires_at, -1));
  const earlyWrong = earlyRequest.code === '222222' ? '222223' : '222222';
  assert.equal(early.call('keelcard.controls.confirm_change', { change_request_id: earlyRequest.change_request_id, code: earlyWrong }).outcome, 'code_rejected');
  assert.equal(early.data.change_requests[0].attempts_used, 1);
  const f = fixture();
  f.call('keelcard.controls.request_change', { card_id: CARD, field: 'per_transaction', amount_cents: 12000 });
  const request = f.data.change_requests[0];
  f.advance(request.expires_at);
  const expired = f.call('keelcard.controls.confirm_change', { change_request_id: request.change_request_id, code: request.code });
  assert.equal(expired.outcome, 'code_expired');
  assert.equal(f.data.change_requests[0].attempts_used, 0);
  assert.equal(f.data.cards[0].limits.per_transaction, 7500);
  const cancelled = fixture();
  cancelled.call('keelcard.controls.request_change', { card_id: CARD, field: 'per_transaction', amount_cents: 13000 });
  const open = cancelled.data.change_requests[0];
  assert.equal(cancelled.call('keelcard.controls.cancel_request', { change_request_id: open.change_request_id }).request_status, 'cancelled');
  assert.equal(boom(() => cancelled.call('keelcard.controls.confirm_change', { change_request_id: open.change_request_id, code: '123456' })).code, 'no_pending_request');
});

test('owner approval applies, denies and expires without an email code', () => {
  const f = fixture();
  f.mutate(data => { data.verification.mode = 'owner_approval'; });
  const opened = f.call('keelcard.controls.request_change', { card_id: CARD, field: 'per_transaction', amount_cents: 15000 });
  assert.equal(opened.request_status, 'pending_owner');
  assert.equal(f.data.change_requests[0].code, null);
  assert.equal(f.data.notices.length, 0);
  assert.equal(boom(() => f.call('keelcard.controls.confirm_change', { change_request_id: opened.change_request_id, code: '123456' })).code, 'owner_approval_required');
  assert.equal(f.data.change_requests[0].attempts_used, 0);
  f.event({
    event_id: 'owner-approve-1',
    at: addMinutes(f.ctx.virtual_now, 30),
    operation: 'change_request.owner_decision',
    payload: { change_request_id: opened.change_request_id, decision: 'approved' }
  });
  assert.equal(f.data.cards[0].limits.per_transaction, 15000);
  assert.equal(f.data.control_changes.at(-1).verification, 'owner_approval');
  assert.equal(f.data.control_changes.at(-1).changed_by, 'owner');
  assert.equal(f.data.control_changes.at(-1).applied_request_id, 'owner-approve-1');
  const denied = fixture();
  denied.mutate(data => { data.verification.mode = 'owner_approval'; });
  const denyId = denied.call('keelcard.controls.request_change', { card_id: CARD, field: 'per_transaction', amount_cents: 16000 }).change_request_id;
  denied.event({
    event_id: 'owner-deny-1',
    at: addMinutes(denied.ctx.virtual_now, 5),
    operation: 'change_request.owner_decision',
    payload: { change_request_id: denyId, decision: 'denied' }
  });
  assert.equal(denied.data.change_requests[0].status, 'denied');
  assert.equal(denied.data.cards[0].limits.per_transaction, 7500);
  const expired = fixture();
  expired.mutate(data => { data.verification.mode = 'owner_approval'; });
  const expireId = expired.call('keelcard.controls.request_change', { card_id: CARD, field: 'per_transaction', amount_cents: 17000 }).change_request_id;
  const deadline = expired.data.change_requests[0].expires_at;
  expired.advance(deadline);
  expired.event({
    event_id: 'owner-expire-1',
    at: deadline,
    operation: 'change_request.owner_decision',
    payload: { change_request_id: expireId, decision: 'approved' }
  });
  assert.equal(expired.data.change_requests[0].status, 'expired');
  assert.equal(expired.data.cards[0].limits.per_transaction, 7500);
  const email = fixture();
  const emailId = email.call('keelcard.controls.request_change', { card_id: CARD, field: 'per_transaction', amount_cents: 11000 }).change_request_id;
  const rejected = boom(() => email.event({
    event_id: 'owner-on-email',
    at: addMinutes(email.ctx.virtual_now, 1),
    operation: 'change_request.owner_decision',
    payload: { change_request_id: emailId, decision: 'approved' }
  }));
  assert.equal(rejected.code, 'invalid_event');
  assert.equal(email.data.cards[0].limits.per_transaction, 7500);
});

test('direct lowers and blocks commit, and duplicate controls are rejected', () => {
  const f = fixture();
  assert.equal(f.call('keelcard.controls.lower', { card_id: CARD, field: 'per_transaction', amount_cents: 5000 }).limit_cents, 5000);
  assert.equal(boom(() => f.call('keelcard.controls.lower', { card_id: CARD, field: 'per_transaction', amount_cents: 5000 })).code, 'invalid_arguments');
  assert.equal(f.call('keelcard.controls.block', { kind: 'merchant', merchant_id: 'm-linetalk' }).merchant_id, 'm-linetalk');
  assert.equal(boom(() => f.call('keelcard.controls.block', { kind: 'merchant', merchant_id: 'm-linetalk' })).code, 'invalid_arguments');
  assert.equal(f.call('keelcard.controls.block', { kind: 'category', category: 'entertainment' }).category, 'entertainment');
  assert.equal(f.data.control_changes.at(-1).verification, 'direct');
});

test('FreshCart task amounts decline or approve and read back without card details', () => {
  const f = fixture();
  f.advance(SESSION);
  const before = f.data.funding.balance_cents;
  f.event(groceryEvent('task-decline', 'freshcart:fc-grace:fc-order-8812:1', 12438, '2026-11-20T06:14:00-05:00'));
  const decline = f.call('keelcard.authorizations.lookup', { authorization_key: 'freshcart:fc-grace:fc-order-8812:1' }).authorization;
  assert.equal(decline.decision, 'declined');
  assert.equal(decline.decline_code, 'exceeds_transaction_limit');
  assert.equal(decline.amount_cents, 12438);
  assert.equal(decline.hold_cents, 0);
  assert.equal(decline.merchant_ref.object_id, 'fc-order-8812');
  assert.equal(JSON.stringify(decline).includes(GROCERY), false);
  assert.equal(f.data.funding.balance_cents, before);
  assert.equal(f.data.cards[0].limits.per_transaction, 7500);
  assert.match(f.data.notices.at(-1).body, /Manage limits in Keelcard/);
  f.event(groceryEvent('task-ok-1', 'freshcart:fc-grace:fc-order-7062:1', 7062, '2026-11-20T06:20:00-05:00'));
  f.event({
    event_id: 'task-cap-1',
    at: '2026-11-20T06:21:00-05:00',
    operation: 'authorization.capture',
    payload: { authorization_key: 'freshcart:fc-grace:fc-order-7062:1', capture_key: 'cap-task-7062', amount_cents: 7062 }
  });
  f.event(groceryEvent('task-ok-2', 'freshcart:fc-grace:fc-order-4327:1', 4327, '2026-11-20T06:30:00-05:00'));
  const first = f.call('keelcard.authorizations.lookup', { authorization_key: 'freshcart:fc-grace:fc-order-7062:1' }).authorization;
  const second = f.call('keelcard.authorizations.lookup', { authorization_key: 'freshcart:fc-grace:fc-order-4327:1' }).authorization;
  assert.equal(first.decision, 'approved');
  assert.equal(first.status, 'captured');
  assert.equal(second.decision, 'approved');
  assert.equal(second.status, 'pending');
  assert.equal(second.hold_cents, 4327);
  assert.equal(f.data.funding.balance_cents, before - 7062);
  const txn = f.call('keelcard.transactions.get', { authorization_id: first.authorization_id }).transaction;
  assert.equal(txn.captured_cents, 7062);
  assert.equal(JSON.stringify(txn).includes(GROCERY), false);
});

test('captures, reversals, holds and expiry follow the ledger rules', () => {
  const f = fixture();
  const start = f.data.funding.balance_cents;
  f.event(groceryEvent('hold-a', 'freshcart:fc-grace:fc-hold-a:1', 7000, '2026-11-20T08:00:00-05:00'));
  f.event(groceryEvent('hold-b', 'freshcart:fc-grace:fc-hold-b:1', 7000, '2026-11-20T08:05:00-05:00'));
  f.event(groceryEvent('hold-c', 'freshcart:fc-grace:fc-hold-c:1', 7000, '2026-11-20T08:10:00-05:00'));
  const third = f.data.declines.find(row => row.authorization_key === 'freshcart:fc-grace:fc-hold-c:1');
  assert.equal(third.decline_code, 'exceeds_daily_limit');
  assert.equal(f.data.funding.balance_cents, start);
  assert.equal(f.call('keelcard.spend.summary', { card_id: CARD }).summary.available_cents, start - 14000);
  const pending = f.data.authorizations.find(row => row.authorization_key === 'freshcart:fc-grace:fc-hold-a:1');
  f.event({
    event_id: 'partial-cap',
    at: '2026-11-20T08:20:00-05:00',
    operation: 'authorization.capture',
    payload: { authorization_id: pending.authorization_id, capture_key: 'cap-partial-a', amount_cents: 2000 }
  });
  const captured = f.data.authorizations.find(row => row.authorization_id === pending.authorization_id);
  assert.equal(captured.status, 'captured');
  assert.equal(captured.captured_cents, 2000);
  assert.equal(captured.hold_cents, 0);
  assert.equal(f.data.funding.balance_cents, start - 2000);
  assert.equal(boom(() => f.event({
    event_id: 'partial-again',
    at: '2026-11-20T08:21:00-05:00',
    operation: 'authorization.capture',
    payload: { authorization_id: pending.authorization_id, capture_key: 'cap-partial-b', amount_cents: 1000 }
  })).code, 'not_pending');
  const other = f.data.authorizations.find(row => row.authorization_key === 'freshcart:fc-grace:fc-hold-b:1');
  f.event({
    event_id: 'reverse-b',
    at: '2026-11-20T08:30:00-05:00',
    operation: 'authorization.reverse',
    payload: { authorization_id: other.authorization_id, reason: 'customer cancelled' }
  });
  assert.equal(f.data.authorizations.find(row => row.authorization_id === other.authorization_id).status, 'reversed');
  assert.equal(boom(() => f.event({
    event_id: 'reverse-again',
    at: '2026-11-20T08:31:00-05:00',
    operation: 'authorization.reverse',
    payload: { authorization_id: other.authorization_id, reason: 'again' }
  })).code, 'not_pending');
  f.event(groceryEvent('expire-me', 'freshcart:fc-grace:fc-expire:1', 1000, '2026-11-21T09:00:00-05:00'));
  const expiring = f.data.authorizations.find(row => row.authorization_key === 'freshcart:fc-grace:fc-expire:1');
  f.advance(expiring.expires_at);
  const viewed = f.call('keelcard.transactions.get', { authorization_id: expiring.authorization_id }).transaction;
  assert.equal(viewed.effective_status, 'expired');
  assert.equal(f.data.authorizations.find(row => row.authorization_id === expiring.authorization_id).status, 'pending');
  f.event({ event_id: 'settle-expire', at: expiring.expires_at, operation: 'ledger.settle_due', payload: {} });
  assert.equal(f.data.authorizations.find(row => row.authorization_id === expiring.authorization_id).status, 'expired');
  assert.equal(boom(() => f.event({
    event_id: 'capture-expired',
    at: addMinutes(expiring.expires_at, 1),
    operation: 'authorization.capture',
    payload: { authorization_id: expiring.authorization_id, capture_key: 'cap-expired', amount_cents: 1000 }
  })).code, 'authorization_expired');
});

test('the same authorization key is redelivered once and conflicts when the content changes', () => {
  const f = fixture();
  const at = '2026-11-20T10:00:00-05:00';
  f.event(groceryEvent('live-1', 'freshcart:fc-grace:fc-live:1', 1500, at));
  f.event(groceryEvent('live-2', 'freshcart:fc-grace:fc-live:1', 1500, '2026-11-20T10:05:00-05:00'));
  const rows = f.data.authorizations.filter(row => row.authorization_key === 'freshcart:fc-grace:fc-live:1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].redelivered_at.length, 1);
  assert.equal(rows[0].hold_cents, 1500);
  const conflict = boom(() => f.event(groceryEvent('live-3', 'freshcart:fc-grace:fc-live:1', 1600, '2026-11-20T10:06:00-05:00')));
  assert.equal(conflict.code, 'authorization_key_conflict');
  assert.equal(f.data.authorizations.filter(row => row.authorization_key === 'freshcart:fc-grace:fc-live:1').length, 1);
});

test('decision order covers card state, locks, blocks, limits and funding', () => {
  const f = fixture();
  const created = f.call('keelcard.cards.create', { type: 'single_use', nickname: 'Once', limits: underCeiling() });
  const number = f.data.cards.find(card => card.card_id === created.card_id).number;
  const card = { number, expiry: '2029-12', security_code: f.data.cards.find(item => item.card_id === created.card_id).security_code };
  const merchant = { merchant_id: 'm-corner-snacks', name: 'Corner Snacks', category: 'restaurants' };
  const at = '2026-11-19T10:00:00-05:00';
  function pay(id, key, amount, when, extraCard = card, extraMerchant = merchant) {
    f.event({
      event_id: id, at: when, operation: 'authorization.request',
      payload: {
        authorization_key: key, amount_cents: amount, currency: 'USD', card: extraCard, merchant: extraMerchant,
        merchant_ref: { app_id: 'freshcart', account_id: 'fc-grace', object_type: 'order', object_id: 'once' }
      }
    });
  }
  pay('once-1', 'once:kc:once:1', 500, at);
  pay('once-2', 'once:kc:once:2', 500, '2026-11-19T10:05:00-05:00');
  assert.equal(f.data.declines.at(-1).decline_code, 'single_use_spent');
  f.mutate(data => {
    const held = data.cards.find(item => item.card_id === created.card_id);
    held.status = 'paused';
    held.paused_by = 'owner';
  });
  f.call('keelcard.controls.request_change', { card_id: created.card_id, field: 'unpause' });
  assert.equal(f.data.change_requests.at(-1).status, 'pending_verification');
  f.event({
    event_id: 'once-cap', at: '2026-11-19T10:06:00-05:00', operation: 'authorization.capture',
    payload: { authorization_key: 'once:kc:once:1', capture_key: 'cap-once', amount_cents: 500 }
  });
  assert.equal(f.data.cards.find(item => item.card_id === created.card_id).closure_reason, 'single_use');
  assert.equal(f.data.change_requests.at(-1).status, 'cancelled');
  assert.equal(f.data.notices.some(notice => notice.kind === 'card_closed' && notice.related_id === created.card_id), true);
  pay('once-3', 'once:kc:once:3', 500, '2026-11-19T10:07:00-05:00');
  assert.equal(f.data.declines.at(-1).decline_code, 'single_use_spent');
  const locked = f.call('keelcard.cards.create', {
    type: 'merchant_locked', nickname: 'Shop', limits: underCeiling()
  });
  const lockedCard = f.data.cards.find(item => item.card_id === locked.card_id);
  const lockedInput = { number: lockedCard.number, expiry: lockedCard.expiry, security_code: lockedCard.security_code };
  pay('lock-1', 'lock:kc:lock:1', 400, '2026-11-19T11:00:00-05:00', lockedInput, { merchant_id: 'm-freshcart', name: 'FreshCart', category: 'grocery' });
  assert.equal(f.data.cards.find(item => item.card_id === locked.card_id).merchant_lock, 'm-freshcart');
  pay('lock-2', 'lock:kc:lock:2', 400, '2026-11-19T11:05:00-05:00', lockedInput, merchant);
  assert.equal(f.data.declines.at(-1).decline_code, 'merchant_not_allowed');
  const categoryCard = f.call('keelcard.cards.create', {
    type: 'category_locked', nickname: 'Food', limits: underCeiling(), categories: ['grocery']
  });
  const category = f.data.cards.find(item => item.card_id === categoryCard.card_id);
  pay('cat-1', 'cat:kc:cat:1', 300, '2026-11-19T12:00:00-05:00', { number: category.number, expiry: category.expiry, security_code: category.security_code }, merchant);
  assert.equal(f.data.declines.at(-1).decline_code, 'category_blocked');
  const general = f.call('keelcard.cards.create', { type: 'general', nickname: 'Open', limits: underCeiling() });
  const generalCard = f.data.cards.find(item => item.card_id === general.card_id);
  f.call('keelcard.controls.block', { kind: 'merchant', merchant_id: 'm-harbor-domains' });
  pay('blocked-merchant', 'block:kc:block:1', 100, '2026-11-19T13:00:00-05:00', {
    number: generalCard.number, expiry: generalCard.expiry, security_code: generalCard.security_code
  }, { merchant_id: 'm-harbor-domains', name: 'Harbor Domains', category: 'domains_hosting' });
  assert.equal(f.data.declines.at(-1).decline_code, 'merchant_blocked');
  f.call('keelcard.controls.block', { kind: 'category', category: 'grocery' });
  f.event(groceryEvent('blocked-category', 'freshcart:fc-grace:fc-blockcat:1', 100, '2026-11-19T13:05:00-05:00'));
  assert.equal(f.data.declines.at(-1).decline_code, 'category_blocked');
  const paused = fixture();
  paused.mutate(data => { data.cards[1].status = 'paused'; data.cards[1].paused_by = 'delegate'; });
  paused.event({
    event_id: 'paused-auth', at: '2026-11-19T14:00:00-05:00', operation: 'authorization.request',
    payload: {
      authorization_key: 'snack:kc:paused:1', amount_cents: 100, currency: 'USD',
      card: { card_id: 'card-8821' },
      merchant: { merchant_id: 'm-corner-snacks', name: 'Corner Snacks', category: 'restaurants' }
    }
  });
  assert.equal(paused.data.declines.at(-1).decline_code, 'card_paused');
  const poor = fixture();
  poor.mutate(data => {
    const drop = data.funding.balance_cents - 100;
    data.ledger.push({
      entry_id: 'led-low', at: '2026-11-18T12:00:00-05:00', kind: 'top_up', direction: 'debit',
      amount_cents: drop, balance_after_cents: 100, authorization_id: null, card_id: null, statement_id: null
    });
    data.funding.balance_cents = 100;
  });
  const rich = poor.call('keelcard.cards.create', { type: 'general', nickname: 'Low', limits: underCeiling() });
  const richCard = poor.data.cards.find(item => item.card_id === rich.card_id);
  poor.event({
    event_id: 'poor-auth', at: '2026-11-19T15:00:00-05:00', operation: 'authorization.request',
    payload: {
      authorization_key: 'poor:kc:poor:1', amount_cents: 500, currency: 'USD',
      card: { number: richCard.number, expiry: richCard.expiry, security_code: richCard.security_code },
      merchant: { merchant_id: 'm-corner-snacks', name: 'Corner Snacks', category: 'restaurants' }
    }
  });
  assert.equal(poor.data.declines.at(-1).decline_code, 'insufficient_funds');
  const missing = boom(() => f.event(groceryEvent('bad-amount', 'freshcart:fc-grace:fc-zero:1', 0, '2026-11-19T16:00:00-05:00')));
  assert.equal(missing.code, 'invalid_event');
  assert.equal(boom(() => f.event(groceryEvent('bad-ccy', 'freshcart:fc-grace:fc-eur:1', 100, '2026-11-19T16:05:00-05:00', { currency: 'EUR' }))).code, 'invalid_event');
  assert.equal(boom(() => f.event({
    event_id: 'no-key', at: '2026-11-19T16:06:00-05:00', operation: 'authorization.request',
    payload: { amount_cents: 100, currency: 'USD', card: { number: GROCERY, expiry: '2028-09', security_code: '317' }, merchant: { merchant_id: 'm-freshcart', name: 'FreshCart', category: 'grocery' } }
  })).code, 'invalid_event');
  f.event(groceryEvent('mismatch', 'freshcart:fc-grace:fc-mismatch:1', 100, '2026-11-19T16:10:00-05:00', {
    card: { number: GROCERY, expiry: '2028-09', security_code: '000' }
  }));
  assert.equal(f.data.declines.at(-1).decline_code, 'card_details_mismatch');
  f.event(groceryEvent('unknown-card', 'freshcart:fc-grace:fc-missing-card:1', 100, '2026-11-19T16:12:00-05:00', {
    card: { number: '9000000000000000', expiry: '2028-09', security_code: '000' }
  }));
  assert.equal(f.data.declines.at(-1).decline_code, 'card_not_found');
});

test('delivery results and the reviewer renderer keep secrets in their own places', () => {
  const f = fixture();
  f.call('keelcard.controls.request_change', { card_id: CARD, field: 'per_transaction', amount_cents: 9000 });
  const notice = f.data.notices[0];
  const wire = wireFor(f.data, notice);
  const valid = compile(require('../schemas/router-message.schema.json'), path.resolve(__dirname, '../schemas'));
  assert.equal(valid(wire), true);
  assert.equal(wire.source, 'urn:pale:app:keelcard:account:kc-adeyemi');
  f.event({
    event_id: 'delivery-unknown',
    at: addMinutes(f.ctx.virtual_now, 1),
    operation: 'notice.delivery_result',
    payload: { notice_id: notice.notice_id, publish_request_id: notice.publish_request_id, status: 'unknown', event_id: 'router-unknown1' }
  });
  assert.equal(f.data.notices[0].status, 'unknown');
  f.event({
    event_id: 'delivery-committed',
    at: addMinutes(f.ctx.virtual_now, 1),
    operation: 'notice.delivery_result',
    payload: { notice_id: notice.notice_id, publish_request_id: notice.publish_request_id, status: 'committed', event_id: 'router-unknown1' }
  });
  assert.equal(f.data.notices[0].status, 'committed');
  assert.equal(f.data.notices[0].delivery.event_id, 'router-unknown1');
  assert.equal(boom(() => f.event({
    event_id: 'delivery-other-event',
    at: addMinutes(f.ctx.virtual_now, 1),
    operation: 'notice.delivery_result',
    payload: { notice_id: notice.notice_id, publish_request_id: notice.publish_request_id, status: 'committed', event_id: 'router-committed1' }
  })).code, 'delivery_status_conflict');
  assert.equal(boom(() => f.event({
    event_id: 'delivery-conflict',
    at: addMinutes(f.ctx.virtual_now, 1),
    operation: 'notice.delivery_result',
    payload: { notice_id: notice.notice_id, publish_request_id: notice.publish_request_id, status: 'rejected', code: 'receiver_rejected' }
  })).code, 'delivery_status_conflict');
  assert.equal(classifyDelivery({
    receipt: { status: 'committed', event_id: 'router-1', duplicate: true },
    eventStatus: { status: 'ok', receipt: { status: 'committed', event_id: 'router-1' } },
    expectedEventId: 'router-1'
  }).outcome, 'confirmed');
  assert.equal(classifyDelivery({ receipt: { status: 'rejected', code: 'recipient_not_authorized' } }).outcome, 'rejected');
  assert.equal(classifyDelivery({ receipt: { status: 'unknown', code: 'receiver_unconfirmed', stop_run: true } }).outcome, 'unresolved');
  assert.equal(classifyDelivery({ eventStatus: { status: 'ok', receipt: { status: 'committed', event_id: 'router-1' } }, expectedEventId: 'router-1' }).outcome, 'confirmed');
  assert.equal(classifyDelivery({ eventStatus: { status: 'ok', receipt: { status: 'committed', event_id: 'router-1' } }, mailRecord: { id: 'other' }, expectedEventId: 'router-1' }).outcome, 'confirmed');
  assert.equal(classifyDelivery({ receipt: { status: 'unknown', event_id: 'router-attempt', stop_run: true }, eventStatus: { status: 'ok', receipt: { status: 'committed', event_id: 'router-other' } }, expectedEventId: 'router-attempt' }).outcome, 'unresolved');
  assert.equal(classifyDelivery({ receipt: { status: 'unknown', stop_run: true }, eventStatus: { status: 'ok', receipt: null }, mailRecord: { id: 'other' }, expectedEventId: 'router-1' }).outcome, 'unresolved');
  assert.equal(classifyDelivery({
    receipt: { status: 'committed', event_id: 'router-b' },
    eventStatus: { status: 'ok', receipt: { status: 'committed', event_id: 'router-b' } },
    expectedEventId: 'router-a'
  }).outcome, 'unresolved');
  const hits = scan('number 9417220000014417 expires 2028-09 code 317', f.data.fingerprints);
  const groceryHit = hits.find(hit => hit.card_id === CARD);
  assert.ok(groceryHit.fields.includes('number'));
  assert.ok(groceryHit.fields.includes('security_code'));
  assert.ok(groceryHit.fields.includes('expiry'));
  const lastFour = scan('last four 4417 expires 2028-09', f.data.fingerprints);
  assert.ok(lastFour.some(hit => hit.card_id === CARD && hit.fields.includes('last_four_with_expiry')));
  assert.equal(scan('4417 alone', f.data.fingerprints).length, 0);
  const view = require('../gui/src/view.js');
  const html = view.render([{ card_id: CARD, nickname: '<img src=x onerror=alert(1)>', number: GROCERY, security_code: '317' }]);
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes(GROCERY), false);
  assert.equal(html.includes('&lt;img'), true);
});

test('runtime replays, stale versions, reset and the clock', { skip: !fs.existsSync(path.resolve(__dirname, '../../../runtime/core/runtime.cjs')) && 'runtime is outside this package copy' }, () => {
  const { createRuntime } = require(path.resolve(__dirname, '../../../runtime/core/runtime.cjs'));
  const model = createRuntime({ registryFile: path.resolve(__dirname, '../../../apps.registry.json') });
  let state = model.create('keelcard', 'keel-run', 'sandbox');
  const version = () => model.version(state);
  const firstArgs = { card_id: CARD, field: 'per_transaction', amount_cents: 10000, expected_version: version(), request_id: 'req-raise-1' };
  const first = model.execute(state, 'agent', 'keelcard.controls.request_change', firstArgs);
  assert.equal(first.result.status, 'committed');
  state = first.state;
  const replay = model.execute(state, 'agent', 'keelcard.controls.request_change', firstArgs);
  assert.equal(replay.result.duplicate, true);
  assert.equal(replay.state.revision, state.revision);
  assert.equal(replay.state.data.change_requests.length, 1);
  const conflict = model.execute(state, 'agent', 'keelcard.controls.request_change', {
    card_id: CARD, field: 'per_transaction', amount_cents: 11000, expected_version: version(), request_id: 'req-raise-1'
  });
  assert.equal(conflict.result.status, 'idempotency_conflict');
  const stale = model.execute(state, 'agent', 'keelcard.controls.confirm_change', {
    change_request_id: state.data.change_requests[0].change_request_id,
    code: '000000',
    expected_version: { epoch: state.epoch, revision: state.revision + 1 },
    request_id: 'req-stale'
  });
  assert.equal(stale.result.status, 'stale_version');
  assert.equal(stale.state.data.change_requests[0].attempts_used, 0);
  assert.equal(stale.state.audit.at(-1).decision, 'deny');
  state = model.create('keelcard', 'keel-owner', 'sandbox');
  state = model.execute(state, 'agent', 'keelcard.controls.request_change', {
    card_id: CARD, field: 'per_transaction', amount_cents: 10000, expected_version: model.version(state), request_id: 'owner-open'
  }).state;
  const ownerState = model.execute(state, 'infra', 'env.load_seed', {
    expected_version: model.version(state),
    request_id: 'mode-owner',
    data: { ...state.data, verification: { ...state.data.verification, mode: 'owner_approval' }, change_requests: [], notices: [] },
    bundle: state.resources.bundle
  });
  assert.equal(ownerState.result.status, 'ready');
  state = ownerState.state;
  const opened = model.execute(state, 'agent', 'keelcard.controls.request_change', {
    card_id: CARD, field: 'per_transaction', amount_cents: 15000, expected_version: model.version(state), request_id: 'owner-open-2'
  });
  assert.equal(opened.result.status, 'committed');
  state = opened.state;
  const thrown = model.execute(state, 'agent', 'keelcard.controls.confirm_change', {
    change_request_id: state.data.change_requests[0].change_request_id,
    code: '123456',
    expected_version: model.version(state),
    request_id: 'owner-confirm'
  });
  assert.equal(thrown.result.status, 'owner_approval_required');
  assert.equal(thrown.state.data.change_requests[0].attempts_used, 0);
  assert.equal(thrown.state.audit.at(-1).decision, 'deny');
  const reset = model.execute(thrown.state, 'infra', 'env.reset', { expected_version: model.version(thrown.state) });
  assert.equal(reset.result.status, 'ready');
  assert.equal(reset.state.data.change_requests.length, 0);
  assert.equal(reset.state.data.funding.balance_cents, 441170);
  assert.equal(reset.state.virtual_now, CLOCK);
  assert.ok(reset.state.epoch > thrown.state.epoch);
  const event = groceryEvent('rt-auth', 'freshcart:fc-grace:fc-rt:1', 1200, '2026-11-20T12:00:00-05:00');
  const applied = model.execute(reset.state, 'infra', 'env.apply_event', { expected_version: model.version(reset.state), event });
  assert.equal(applied.result.status, 'committed');
  const again = model.execute(applied.state, 'infra', 'env.apply_event', { expected_version: model.version(applied.state), event });
  assert.equal(again.result.duplicate, true);
  assert.equal(again.state.revision, applied.state.revision);
  const ahead = '2026-11-28T12:00:00-05:00';
  const clock = model.execute(applied.state, 'infra', 'env.advance_time', {
    expected_version: model.version(applied.state), virtual_now: ahead, request_id: 'clock-1'
  });
  assert.equal(clock.result.status, 'committed');
  assert.equal(clock.state.data.authorizations.find(row => row.authorization_key === 'freshcart:fc-grace:fc-rt:1').status, 'pending');
  const read = model.execute(clock.state, 'agent', 'keelcard.transactions.list', { card_id: CARD });
  const row = read.result.transactions.find(item => item.authorization_key === 'freshcart:fc-grace:fc-rt:1');
  assert.equal(row.effective_status, 'expired');
  assert.equal(read.state.data.authorizations.find(item => item.authorization_key === 'freshcart:fc-grace:fc-rt:1').status, 'pending');
  const settled = model.execute(read.state, 'infra', 'env.apply_event', {
    expected_version: model.version(read.state),
    event: { event_id: 'rt-settle', at: ahead, operation: 'ledger.settle_due', payload: {} }
  });
  assert.equal(settled.state.data.authorizations.find(item => item.authorization_key === 'freshcart:fc-grace:fc-rt:1').status, 'expired');
  const raiseTool = require('../tools.json').find(tool => tool.name === 'keelcard.controls.request_change');
  const replayValid = compile(raiseTool.outputSchema, path.resolve(__dirname, '..'));
  assert.equal(replayValid(replay.result), true);
  const emptyCard = groceryEvent('empty-card', 'freshcart:fc-grace:fc-empty:1', 1000, ahead, { card: {} });
  const beforeEmpty = JSON.stringify(settled.state.data);
  const empty = model.execute(settled.state, 'infra', 'env.apply_event', { expected_version: model.version(settled.state), event: emptyCard });
  assert.equal(empty.result.status, 'invalid_event');
  assert.match(JSON.stringify(empty.result), /card id or the full card details/);
  assert.equal(JSON.stringify(empty.state.data), beforeEmpty);
  assert.equal(empty.state.virtual_now, settled.state.virtual_now);
  assert.equal(empty.state.audit.at(-1).decision, 'deny');
  const raceSeed = model.create('keelcard', 'keel-race', 'sandbox');
  const raceData = structuredClone(raceSeed.data);
  const raceCard = raceData.cards.find(card => card.card_id === CARD);
  raceCard.limits.per_transaction = 10000;
  raceCard.limits.per_day = 10000;
  const raceLoaded = model.execute(raceSeed, 'infra', 'env.load_seed', {
    expected_version: model.version(raceSeed), request_id: 'race-limits', data: raceData, bundle: raceSeed.resources.bundle
  });
  assert.equal(raceLoaded.result.status, 'ready');
  const raceBase = raceLoaded.state;
  const raceVersion = model.version(raceBase);
  const firstRace = model.execute(raceBase, 'infra', 'env.apply_event', {
    expected_version: raceVersion,
    event: groceryEvent('race-a', 'freshcart:fc-grace:fc-race-a:1', 6000, '2026-11-21T13:00:00-05:00')
  });
  const secondRace = model.execute(firstRace.state, 'infra', 'env.apply_event', {
    expected_version: raceVersion,
    event: groceryEvent('race-b', 'freshcart:fc-grace:fc-race-b:1', 6000, '2026-11-21T13:05:00-05:00')
  });
  assert.equal(firstRace.result.status, 'committed');
  assert.equal(secondRace.result.status, 'stale_version');
  const retried = model.execute(firstRace.state, 'infra', 'env.apply_event', {
    expected_version: model.version(firstRace.state),
    event: groceryEvent('race-b', 'freshcart:fc-grace:fc-race-b:1', 6000, '2026-11-21T13:05:00-05:00')
  });
  assert.equal(retried.state.data.declines.at(-1).decline_code, 'exceeds_daily_limit');
  const openedWrong = model.execute(firstRace.state, 'agent', 'keelcard.controls.request_change', {
    card_id: CARD, field: 'per_transaction', amount_cents: 12000, expected_version: model.version(firstRace.state), request_id: 'open-wrong'
  });
  const storedWrong = openedWrong.state.data.change_requests.at(-1).code;
  const wrongArgs = {
    change_request_id: openedWrong.state.data.change_requests.at(-1).change_request_id,
    code: storedWrong === '010101' ? '010102' : '010101',
    expected_version: model.version(openedWrong.state),
    request_id: 'wrong-once'
  };
  const wrong = model.execute(openedWrong.state, 'agent', 'keelcard.controls.confirm_change', wrongArgs);
  const wrongAgain = model.execute(wrong.state, 'agent', 'keelcard.controls.confirm_change', wrongArgs);
  assert.equal(wrong.result.status, 'committed');
  assert.equal(wrong.result.outcome, 'code_rejected');
  assert.equal(wrong.state.data.change_requests.at(-1).attempts_used, 1);
  assert.equal(wrongAgain.result.duplicate, true);
  assert.equal(wrongAgain.state.data.change_requests.at(-1).attempts_used, 1);
  const resetAgain = model.execute(reset.state, 'infra', 'env.reset', { expected_version: model.version(reset.state) });
  assert.equal(JSON.stringify(resetAgain.state.data), JSON.stringify(reset.state.data));
});

test('monthly and lifetime limits, a closed card and an over-capture decline', () => {
  const monthly = fixture();
  monthly.mutate(data => {
    const card = data.cards.find(item => item.card_id === CARD);
    card.limits.per_transaction = 200000;
    card.limits.per_month = 20000;
  });
  monthly.event(groceryEvent('month-over', 'freshcart:fc-grace:fc-month:1', 9000, '2026-11-20T15:00:00-05:00'));
  assert.equal(monthly.data.declines.at(-1).decline_code, 'exceeds_monthly_limit');
  const lifetime = fixture();
  lifetime.mutate(data => {
    const card = data.cards.find(item => item.card_id === CARD);
    card.limits.per_transaction = 200000;
    card.limits.per_day = 200000;
    card.limits.per_month = 2000000;
    card.limits.lifetime = 1;
  });
  lifetime.event(groceryEvent('life-over', 'freshcart:fc-grace:fc-life:1', 1000, '2026-11-20T15:10:00-05:00'));
  assert.equal(lifetime.data.declines.at(-1).decline_code, 'exceeds_lifetime_limit');
  const closed = fixture();
  closed.call('keelcard.cards.close', { card_id: CARD });
  closed.event(groceryEvent('closed-auth', 'freshcart:fc-grace:fc-closed:1', 1000, '2026-11-20T15:20:00-05:00'));
  assert.equal(closed.data.declines.at(-1).decline_code, 'card_closed');
  const over = fixture();
  over.event(groceryEvent('over-hold', 'freshcart:fc-grace:fc-over-hold:1', 1000, '2026-11-20T15:30:00-05:00'));
  const held = over.data.authorizations.find(row => row.authorization_key === 'freshcart:fc-grace:fc-over-hold:1');
  assert.equal(boom(() => over.event({
    event_id: 'over-cap', at: '2026-11-20T15:40:00-05:00', operation: 'authorization.capture',
    payload: { authorization_id: held.authorization_id, capture_key: 'cap-over', amount_cents: 1001 }
  })).code, 'amount_exceeds_hold');
});

test('request identity, expiry, cancellation and a closed card stay consistent in both modes', () => {
  const email = fixture();
  assert.equal(boom(() => email.call('keelcard.controls.request_change', {
    card_id: CARD, field: 'per_transaction', amount_cents: 10000, merchant_id: 'm-freshcart'
  })).code, 'invalid_arguments');
  const opened = email.call('keelcard.controls.request_change', { card_id: CARD, field: 'per_transaction', amount_cents: 10000 });
  assert.equal(boom(() => email.call('keelcard.controls.request_change', { card_id: CARD, field: 'per_transaction', amount_cents: 11000 })).code, 'request_already_open');
  const request = email.data.change_requests.find(item => item.change_request_id === opened.change_request_id);
  email.advance(request.expires_at);
  const listed = email.call('keelcard.controls.requests.list', { card_id: CARD }).requests.find(item => item.change_request_id === request.change_request_id);
  assert.equal(listed.effective_status, 'expired');
  assert.equal(email.data.change_requests.find(item => item.change_request_id === request.change_request_id).status, 'pending_verification');
  const replacement = email.call('keelcard.controls.request_change', { card_id: CARD, field: 'per_transaction', amount_cents: 12000 });
  assert.equal(email.data.change_requests.find(item => item.change_request_id === request.change_request_id).status, 'expired');
  assert.notEqual(replacement.change_request_id, request.change_request_id);
  const cancel = fixture();
  const cancelOpen = cancel.call('keelcard.controls.request_change', { card_id: CARD, field: 'per_transaction', amount_cents: 13000 });
  cancel.advance(cancel.data.change_requests[0].expires_at);
  const cancelled = cancel.call('keelcard.controls.cancel_request', { change_request_id: cancelOpen.change_request_id });
  assert.equal(cancelled.request_status, 'expired');
  assert.equal(cancel.data.change_requests[0].status, 'expired');
  const expiredCode = fixture();
  const codeOpen = expiredCode.call('keelcard.controls.request_change', { card_id: CARD, field: 'per_transaction', amount_cents: 14000 });
  const saved = expiredCode.data.change_requests[0];
  expiredCode.advance(saved.expires_at);
  const confirmed = expiredCode.call('keelcard.controls.confirm_change', { change_request_id: codeOpen.change_request_id, code: saved.code });
  assert.equal(confirmed.outcome, 'code_expired');
  assert.equal(expiredCode.data.change_requests[0].attempts_used, 0);
  assert.equal(expiredCode.data.cards.find(card => card.card_id === CARD).limits.per_transaction, 7500);
  for (const mode of ['email_code', 'owner_approval']) {
    const account = fixture();
    if (mode === 'owner_approval') {
      account.mutate(data => { data.verification.mode = mode; data.change_requests = []; data.notices = []; });
    }
    account.mutate(data => {
      const card = data.cards.find(item => item.card_id === CARD);
      card.status = 'paused';
      card.paused_by = 'owner';
    });
    const pauseRequest = account.call('keelcard.controls.request_change', { card_id: CARD, field: 'unpause' });
    account.call('keelcard.cards.close', { card_id: CARD });
    assert.equal(account.data.change_requests.find(item => item.change_request_id === pauseRequest.change_request_id).status, 'cancelled');
    assert.equal(account.data.cards.find(item => item.card_id === CARD).status, 'closed');
    account.mutate(data => {
      const row = data.change_requests.find(item => item.change_request_id === pauseRequest.change_request_id);
      row.status = mode === 'owner_approval' ? 'pending_owner' : 'pending_verification';
      row.resolved_at = null;
    });
    if (mode === 'email_code') {
      assert.equal(boom(() => account.call('keelcard.controls.confirm_change', {
        change_request_id: pauseRequest.change_request_id, code: account.data.change_requests[0].code
      })).code, 'card_closed');
    } else {
      assert.equal(boom(() => account.event({
        event_id: 'owner-unpause-' + mode, at: account.ctx.virtual_now, operation: 'change_request.owner_decision',
        payload: { change_request_id: pauseRequest.change_request_id, decision: 'approved' }
      })).code, 'card_closed');
    }
    assert.equal(account.data.cards.find(item => item.card_id === CARD).status, 'closed');
  }
});

test('clock windows keep both civil days and fractional seconds', () => {
  const { dayWindow, isoWithOffset } = require('../src/domain-utils.cjs');
  const fall = dayWindow('2026-11-01T15:00:00Z', 'America/New_York');
  const spring = dayWindow('2026-03-08T15:00:00Z', 'America/New_York');
  assert.equal(Date.parse(fall.end) - Date.parse(fall.start), 25 * 60 * 60 * 1000);
  assert.equal(Date.parse(spring.end) - Date.parse(spring.start), 23 * 60 * 60 * 1000);
  assert.equal(isoWithOffset(Date.parse('2026-11-18T19:00:00.250Z'), '-05:00').includes('.250'), true);
  assert.equal(isoWithOffset(Date.parse('2026-11-18T19:00:00.000Z'), '-05:00').includes('.'), false);
});

test('fingerprints match grouped numbers and short expiry forms', () => {
  const prints = fixture().data.fingerprints;
  assert.ok(scan('9417 2200 0001 4417', prints).some(hit => hit.card_id === CARD && hit.fields.includes('number')));
  assert.ok(scan('9417-2200-0001-4417', prints).some(hit => hit.card_id === CARD && hit.fields.includes('number')));
  assert.ok(scan('expires 09/28', prints).some(hit => hit.card_id === CARD && hit.fields.includes('expiry')));
  assert.ok(scan('expires 09/2028', prints).some(hit => hit.card_id === CARD && hit.fields.includes('expiry')));
  assert.equal(scan('4417', prints).length, 0);
  assert.equal(scan('4417', prints).some(hit => hit.fields.includes('security_code')), false);
  assert.ok(scan('code 441', prints).some(hit => hit.card_id === 'card-8821' && hit.fields.includes('security_code')));
});

test('a seeded authorization is redelivered with the shared digest', () => {
  const f = fixture();
  const sameCard = { card_id: CARD, number: GROCERY, expiry: '2028-09', security_code: '317' };
  f.event(groceryEvent('seed-again', 'freshcart:fc-grace:fc-week-01:1', 4200, '2026-11-20T16:00:00-05:00', { card: sameCard }));
  const row = f.data.authorizations.find(item => item.authorization_key === 'freshcart:fc-grace:fc-week-01:1');
  assert.equal(row.redelivered_at.length, 1);
  assert.equal(f.data.authorizations.filter(item => item.authorization_key === 'freshcart:fc-grace:fc-week-01:1').length, 1);
  const changed = boom(() => f.event(groceryEvent('seed-other-card', 'freshcart:fc-grace:fc-week-01:1', 4200, '2026-11-20T16:01:00-05:00', {
    card: { card_id: 'card-8821', number: GROCERY, expiry: '2028-09', security_code: '317' }
  })));
  assert.equal(changed.code, 'authorization_key_conflict');
  f.event(groceryEvent('fresh-mismatch', 'freshcart:fc-grace:fc-fresh-card:1', 1000, '2026-11-20T16:02:00-05:00', {
    card: { card_id: 'card-8821', number: GROCERY, expiry: '2028-09', security_code: '317' }
  }));
  assert.equal(f.data.declines.at(-1).decline_code, 'card_details_mismatch');
});

test('a direct lower sends a limit notice and email verification requires code alerts', () => {
  const f = fixture();
  f.call('keelcard.controls.lower', { card_id: CARD, field: 'per_transaction', amount_cents: 7000 });
  assert.ok(f.data.notices.some(notice => notice.kind === 'limit_changed'));
  const broken = fixture();
  assert.equal(boom(() => broken.mutate(data => { data.alerts.codes = false; })).code, 'invalid_seed');
});

test('settlement records mixed deadlines in one time order', () => {
  const { settleDue } = require('../src/ledger.cjs');
  const f = fixture();
  f.event(groceryEvent('mix-auth', 'freshcart:fc-grace:fc-mix:1', 1000, '2026-11-20T17:00:00-05:00'));
  f.call('keelcard.controls.request_change', { card_id: CARD, field: 'per_transaction', amount_cents: 10000 });
  const data = f.data;
  const auth = data.authorizations.find(item => item.authorization_key === 'freshcart:fc-grace:fc-mix:1');
  auth.expires_at = '2026-11-25T12:00:00-05:00';
  data.change_requests[0].expires_at = '2026-11-30T12:00:00-05:00';
  const transitions = settleDue(data, '2026-12-02T12:00:00-05:00');
  const relevant = transitions.filter(item => item.id === auth.authorization_id || item.id === data.change_requests[0].change_request_id || item.kind === 'statement_issued');
  const authAt = relevant.findIndex(item => item.id === auth.authorization_id);
  const requestAt = relevant.findIndex(item => item.id === data.change_requests[0].change_request_id);
  const statementAt = relevant.findIndex(item => item.kind === 'statement_issued');
  assert.ok(authAt >= 0 && authAt < requestAt && requestAt < statementAt);
});

test('disputes, refunds, top-ups and alert writes follow the approved rules', () => {
  const f = fixture();
  assert.equal(boom(() => f.call('keelcard.disputes.open', {
    authorization_id: 'auth-snack', reason: 'unauthorized_by_cardholder', note: 'The April snack charge.'
  })).code, 'dispute_window_closed');
  f.event({
    event_id: 'snack-live', at: '2026-11-20T18:00:00-05:00', operation: 'authorization.request',
    payload: {
      authorization_key: 'corner-snacks:kc-adeyemi:snack-live:1', amount_cents: 21240, currency: 'USD',
      card: { card_id: 'card-8821' },
      merchant: { merchant_id: 'm-corner-snacks', name: 'Corner Snacks', category: 'grocery' }
    }
  });
  const live = f.data.authorizations.find(item => item.authorization_key === 'corner-snacks:kc-adeyemi:snack-live:1');
  f.event({
    event_id: 'snack-live-cap', at: '2026-11-20T18:05:00-05:00', operation: 'authorization.capture',
    payload: { authorization_id: live.authorization_id, capture_key: 'cap-snack-live', amount_cents: 21240 }
  });
  const opened = f.call('keelcard.disputes.open', { authorization_id: live.authorization_id, reason: 'unauthorized_by_cardholder', note: 'Snack charge was not mine.' });
  const withdrawn = f.call('keelcard.disputes.withdraw', { dispute_id: opened.dispute_id });
  assert.equal(withdrawn.dispute_status, 'withdrawn');
  const again = f.call('keelcard.disputes.open', { authorization_id: live.authorization_id, reason: 'duplicate_charge', note: 'Charged twice.' });
  f.event({
    event_id: 'dispute-review', at: '2026-11-20T18:10:00-05:00', operation: 'dispute.update',
    payload: { dispute_id: again.dispute_id, status: 'under_review' }
  });
  assert.equal(boom(() => f.call('keelcard.disputes.withdraw', { dispute_id: again.dispute_id })).code, 'not_withdrawable');
  const early = fixture();
  early.event(groceryEvent('dispute-early', 'freshcart:fc-grace:fc-dearly:1', 1000, '2026-11-20T18:00:00-05:00'));
  const earlyAuth = early.data.authorizations.find(item => item.authorization_key === 'freshcart:fc-grace:fc-dearly:1');
  early.event({ event_id: 'dispute-early-cap', at: '2026-11-20T18:20:00-05:00', operation: 'authorization.capture', payload: { authorization_id: earlyAuth.authorization_id, capture_key: 'cap-early', amount_cents: 1000 } });
  const submitted = early.call('keelcard.disputes.open', { authorization_id: earlyAuth.authorization_id, reason: 'incorrect_amount', note: 'Too high.' });
  assert.equal(boom(() => early.event({
    event_id: 'dispute-won-early', at: '2026-11-20T18:30:00-05:00', operation: 'dispute.update',
    payload: { dispute_id: submitted.dispute_id, status: 'won', refund_cents: 1000 }
  })).code, 'invalid_transition');
  const before = f.data.funding.balance_cents;
  f.event({
    event_id: 'dispute-won', at: '2026-11-20T18:40:00-05:00', operation: 'dispute.update',
    payload: { dispute_id: again.dispute_id, status: 'won', refund_cents: 21240 }
  });
  assert.equal(f.data.funding.balance_cents, before + 21240);
  assert.equal(f.data.refunds[0].refund_key, 'dispute:' + again.dispute_id);
  const refunded = fixture();
  refunded.event(groceryEvent('refund-auth', 'freshcart:fc-grace:fc-refund:1', 3000, '2026-11-20T19:00:00-05:00'));
  const refundAuth = refunded.data.authorizations.find(item => item.authorization_key === 'freshcart:fc-grace:fc-refund:1');
  assert.equal(boom(() => refunded.event({
    event_id: 'refund-pending', at: '2026-11-20T19:05:00-05:00', operation: 'refund.issue',
    payload: { authorization_id: refundAuth.authorization_id, refund_key: 'rf-1', amount_cents: 1000 }
  })).code, 'not_refundable');
  refunded.event({ event_id: 'refund-cap', at: '2026-11-20T19:06:00-05:00', operation: 'authorization.capture', payload: { authorization_id: refundAuth.authorization_id, capture_key: 'cap-refund', amount_cents: 3000 } });
  assert.equal(boom(() => refunded.event({
    event_id: 'refund-too-much', at: '2026-11-20T19:07:00-05:00', operation: 'refund.issue',
    payload: { authorization_id: refundAuth.authorization_id, refund_key: 'rf-big', amount_cents: 30000 }
  })).code, 'refund_exceeds_captured');
  const balance = refunded.data.funding.balance_cents;
  refunded.event({ event_id: 'refund-ok', at: '2026-11-20T19:08:00-05:00', operation: 'refund.issue', payload: { authorization_id: refundAuth.authorization_id, refund_key: 'rf-ok', amount_cents: 1000 } });
  refunded.event({ event_id: 'refund-ok-again', at: '2026-11-20T19:09:00-05:00', operation: 'refund.issue', payload: { authorization_id: refundAuth.authorization_id, refund_key: 'rf-ok', amount_cents: 1000 } });
  assert.equal(refunded.data.funding.balance_cents, balance + 1000);
  assert.equal(boom(() => refunded.event({
    event_id: 'refund-conflict', at: '2026-11-20T19:10:00-05:00', operation: 'refund.issue',
    payload: { authorization_id: refundAuth.authorization_id, refund_key: 'rf-ok', amount_cents: 500 }
  })).code, 'refund_key_conflict');
  const funded = fixture();
  const start = funded.data.funding.balance_cents;
  funded.event({ event_id: 'top-1', at: '2026-11-20T20:00:00-05:00', operation: 'funding.top_up', payload: { top_up_key: 'bank-1', amount_cents: 5000 } });
  funded.event({ event_id: 'top-1b', at: '2026-11-20T20:01:00-05:00', operation: 'funding.top_up', payload: { top_up_key: 'bank-1', amount_cents: 5000 } });
  assert.equal(funded.data.funding.balance_cents, start + 5000);
  assert.equal(boom(() => funded.event({
    event_id: 'top-conflict', at: '2026-11-20T20:02:00-05:00', operation: 'funding.top_up',
    payload: { top_up_key: 'bank-1', amount_cents: 4000 }
  })).code, 'top_up_key_conflict');
  const alerts = fixture();
  const off = alerts.call('keelcard.alerts.preferences.update', { alert: 'declines', enabled: false });
  assert.equal(off.outcome, 'request_opened');
  assert.equal(alerts.data.alerts.declines, true);
  assert.match(alerts.data.notices.at(-1).body, /turning off declines alerts/);
  assert.equal(alerts.data.notices.at(-1).body.includes('undefined'), false);
  assert.equal(boom(() => alerts.call('keelcard.alerts.preferences.update', { alert: 'codes', enabled: false })).code, 'invalid_arguments');
  assert.equal(alerts.data.change_requests.filter(request => request.alert === 'codes').length, 0);
  assert.equal(alerts.call('keelcard.alerts.preferences.update', { decline_threshold_cents: 1000 }).outcome, 'request_opened');
  const threshold = fixture();
  threshold.mutate(data => { data.alerts.decline_threshold_cents = 5000; });
  const lower = threshold.call('keelcard.alerts.preferences.update', { decline_threshold_cents: 1000 });
  assert.equal(lower.outcome, 'applied');
  assert.equal(threshold.data.alerts.decline_threshold_cents, 1000);
  const raise = threshold.call('keelcard.alerts.preferences.update', { decline_threshold_cents: 8000 });
  assert.equal(raise.outcome, 'request_opened');
  assert.match(threshold.data.notices.at(-1).body, /decline alert threshold/);
  assert.equal(threshold.data.notices.at(-1).body.includes('undefined'), false);
  assert.equal(threshold.data.alerts.decline_threshold_cents, 1000);
});

test('new cards use private credentials and the other fixtures still validate', () => {
  const { luhnOk } = require('../src/domain-utils.cjs');
  const { validateSeed } = require('../src/model.cjs');
  const f = fixture();
  const created = f.call('keelcard.cards.create', {
    type: 'general', nickname: 'Spare', limits: { per_transaction: 1000, per_day: 1000, per_month: 1000, lifetime: 1000 }
  });
  assert.match(created.card_id, /^card-[0-9a-f]{8}$/);
  const card = f.data.cards.find(item => item.card_id === created.card_id);
  assert.match(card.number, /^9\d{15}$/);
  assert.equal(luhnOk(card.number), true);
  assert.notEqual(card.number, '9417220000014417');
  const freelancer = require('../fixtures/freelancer.json');
  const delegate = require('../fixtures/delegate.json');
  validateSeed({ app_id: 'keelcard', virtual_now: '2026-11-18T12:00:00-05:00', binding: require('../fixtures/freelancer-binding.json') }, freelancer);
  validateSeed({ app_id: 'keelcard', virtual_now: '2026-11-18T10:00:00-05:00', binding: require('../fixtures/delegate-binding.json') }, delegate);
  assert.equal(freelancer.cards.length, 6);
  assert.equal(freelancer.merchants.length, 60);
  assert.ok(freelancer.authorizations.length + freelancer.declines.length >= 500);
  assert.equal(delegate.verification.mode, 'owner_approval');
  assert.equal(delegate.change_requests[0].status, 'pending_owner');
  const { joinEvidence } = require('../examples/join-evidence.cjs');
  const joined = joinEvidence({ data: f.data, audit: [{ tool: 'keelcard.cards.create', decision: 'allow', input: { request_id: 'local-create' }, virtual_time: f.ctx.virtual_now }] }, [
    { request_id: 'local-create', tool: 'keelcard.cards.create', arguments: { type: 'general' }, result: created }
  ]);
  assert.equal(joined.counts.authorizations, f.data.authorizations.length + f.data.declines.length);
  assert.equal(joined.authorizations[0].limits_in_force.per_transaction, 7500);
  assert.equal(joined.rejected.missing_request, undefined);
  const denied = joinEvidence({ data: f.data, audit: [{ tool: 'keelcard.cards.reveal', decision: 'deny', reason: 'card_closed', input: { request_id: 'req-reveal' }, virtual_time: f.ctx.virtual_now }] }, [
    { request_id: 'req-reveal', tool: 'keelcard.cards.reveal', arguments: { card_id: CARD } }
  ]);
  assert.equal(Object.values(denied.rejected).flat()[0].reason, 'card_closed');
  assert.equal(joined.requests.length, f.data.change_requests.length);
  const before = JSON.stringify(f.data);
  joinEvidence({ data: f.data, audit: [] }, []);
  assert.equal(JSON.stringify(f.data), before);
});

test('imported spend has to match the history in decision order', () => {
  const { validateSeed } = require('../src/model.cjs');
  const clock = '2026-11-18T09:00:00-08:00';
  const ctx = { app_id: 'keelcard', virtual_now: clock, binding: require('../fixtures/binding.json') };
  const base = require('../fixtures/minimal.json');
  const daily = structuredClone(base);
  daily.declines.push({
    ...base.declines[0],
    authorization_id: 'auth-0099',
    authorization_key: 'freshcart:fc-grace:imported-day:1',
    amount_cents: 1,
    decline_code: 'exceeds_daily_limit',
    decided_at: clock,
    limits_in_force: { per_transaction: 7500, per_day: 20000, per_month: 120000, lifetime: null, spend_in_force: { per_day: 20000 } }
  });
  assert.throws(() => validateSeed(ctx, daily), /history does not support/);
  const transaction = structuredClone(base);
  transaction.declines.push({
    ...base.declines[0],
    authorization_id: 'auth-0098',
    authorization_key: 'freshcart:fc-grace:imported-tx:1',
    amount_cents: 1,
    decline_code: 'exceeds_transaction_limit',
    decided_at: '2026-10-17T15:05:00.000Z',
    limits_in_force: { per_transaction: 7500, per_day: 20000, per_month: 120000, lifetime: null, spend_in_force: { per_transaction: 7500 } }
  });
  assert.throws(() => validateSeed(ctx, transaction), /per-transaction/);
});

test('each publication fault halts after one publish and leaves the other notice untouched', async () => {
  const minimal = require('../fixtures/minimal.json');
  function notices() {
    return [
      { notice_id: 'notice-0001-aaaa', kind: 'code', status: 'pending_delivery', cloud_event_id: 'keelcard-kc-adeyemi-notice-0001-aaaa', publish_request_id: 'notice-notice-0001-aaaa', title: 'Code', body: 'Code 111111', created_at: minimal.initial_clock, source_object: { object_type: 'change_request', object_id: 'cr-1' }, related_id: 'cr-1', delivery: null },
      { notice_id: 'notice-0002-bbbb', kind: 'decline', status: 'pending_delivery', cloud_event_id: 'keelcard-kc-adeyemi-notice-0002-bbbb', publish_request_id: 'notice-notice-0002-bbbb', title: 'Declined', body: 'Declined', created_at: minimal.initial_clock, source_object: { object_type: 'decline', object_id: 'auth-1' }, related_id: 'auth-1', delivery: null }
    ];
  }
  function data() {
    const copy = structuredClone(minimal);
    copy.notices = notices();
    return copy;
  }
  const binding = { run_id: 'run-1', account_id: 'mail-maya', epoch: 2 };
  const committed = { status: 'committed', event_id: 'router-1', run_id: 'run-1', target: { account_id: 'mail-maya' }, version: { epoch: 2 }, cloud_event: { id: 'keelcard-kc-adeyemi-notice-0001-aaaa' } };
  async function runCase(name, setup) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keelcard-fault-'));
    const log = path.join(dir, 'messaging.receipts.jsonl');
    let publishes = 0;
    const router = {
      async call() {
        publishes += 1;
        return setup.onPublish(log);
      }
    };
    const inspect = setup.inspect || (async () => ({ eventStatus: { status: 'ok', receipt: null }, mailRecord: null }));
    const firstData = data();
    const first = await publishPending({
      data: firstData,
      router,
      inspect,
      commit: setup.commit || (async () => ({ status: 'committed' })),
      receiptLog: log,
      binding
    });
    const server = data();
    if (setup.hideLog) fs.rmSync(log, { force: true });
    const second = await publishPending({
      data: server,
      router,
      inspect,
      commit: setup.secondCommit || setup.commit || (async () => ({ status: 'committed' })),
      receiptLog: log,
      binding
    });
    assert.ok(publishes <= 1, name);
    assert.equal(server.notices[1].status, 'pending_delivery', name);
    assert.equal(second.sent.filter(item => !item.recovered).length, 0, name);
    return { first, second, firstData, server, publishes };
  }
  const lost = await runCase('lost reply', {
    onPublish(log) {
      fs.appendFileSync(log, JSON.stringify({ request_id: 'notice-notice-0001-aaaa', cloud_event: { id: 'keelcard-kc-adeyemi-notice-0001-aaaa' }, result: committed }) + '\n');
      throw new Error('reply lost');
    },
    inspect: async () => ({ eventStatus: { status: 'ok', receipt: { status: 'committed', event_id: 'router-1' } }, mailRecord: { id: 'router-1' } })
  });
  assert.equal(lost.first.halted, true);
  assert.equal(lost.first.report.mail_confirmed, true);
  assert.equal(lost.first.report.persisted, true);
  assert.equal(lost.firstData.notices[1].status, 'pending_delivery');
  assert.equal(lost.publishes, 1);

  const ack = await runCase('lost ack', {
    onPublish() {
      return { status: 'unknown', code: 'receiver_unconfirmed', stop_run: true, event_id: 'router-1' };
    },
    inspect: async () => ({ eventStatus: { status: 'ok', receipt: { status: 'committed', event_id: 'router-1' } }, mailRecord: { id: 'router-1' } })
  });
  assert.equal(ack.first.halted, true);
  assert.equal(ack.first.report.mail_confirmed, true);
  assert.equal(ack.first.report.persisted, true);
  assert.equal(ack.publishes, 1);

  const rejected = await runCase('rejection', {
    onPublish() {
      return { status: 'rejected', code: 'recipient_not_authorized' };
    }
  });
  assert.equal(rejected.first.report.outcome, 'rejected');
  assert.equal(rejected.first.halted, true);
  assert.equal(rejected.server.notices[0].status, 'rejected');
  assert.equal(rejected.publishes, 1);

  const lookup = await runCase('thrown lookup', {
    onPublish() {
      return { status: 'unknown', code: 'receiver_unconfirmed', stop_run: true, event_id: 'router-1' };
    },
    inspect: async () => { throw new Error('lookup failed'); }
  });
  assert.equal(lookup.first.report.code, 'inspection_unavailable');
  assert.equal(lookup.first.halted, true);
  assert.equal(lookup.server.notices[0].status, 'unknown');
  assert.equal(lookup.publishes, 1);

  const inspected = [];
  const missing = await runCase('missing log', {
    hideLog: true,
    onPublish(log) {
      fs.appendFileSync(log, JSON.stringify({ request_id: 'notice-notice-0001-aaaa', cloud_event: { id: 'keelcard-kc-adeyemi-notice-0001-aaaa' }, result: { status: 'unknown', event_id: 'router-1', stop_run: true, code: 'receiver_unconfirmed' } }) + '\n');
      return { status: 'unknown', event_id: 'router-1', stop_run: true, code: 'receiver_unconfirmed' };
    },
    inspect: async (query) => {
      inspected.push(query.event_id);
      return { eventStatus: { status: 'ok', receipt: { status: 'committed', event_id: query.event_id } }, mailRecord: { id: query.event_id } };
    }
  });
  assert.equal(missing.publishes, 1);
  assert.equal(missing.second.halted, true);
  assert.equal(missing.second.report.mail_confirmed, true);
  assert.equal(missing.second.report.persisted, true);
  assert.deepEqual(inspected, ['router-1', 'router-1']);
  assert.equal(missing.server.notices[1].status, 'pending_delivery');

  const foreign = await runCase('foreign run', {
    onPublish() {
      return { ...committed, run_id: 'other-run' };
    },
    inspect: async () => ({ eventStatus: { status: 'ok', receipt: { status: 'committed', event_id: 'router-1' } }, mailRecord: { id: 'router-1' } })
  });
  assert.equal(foreign.first.halted, true);
  assert.equal(foreign.publishes, 1);
  assert.equal(foreign.server.notices[1].status, 'pending_delivery');

  let writes = 0;
  const stale = await runCase('stale evidence', {
    onPublish() {
      return { status: 'unknown', code: 'receiver_unconfirmed', stop_run: true, event_id: null };
    },
    commit: async (item) => {
      writes += 1;
      if (item.kind === 'halt') return { status: 'committed' };
      return { status: 'stale_version' };
    },
    secondCommit: async () => {
      writes += 1;
      return { status: 'committed' };
    }
  });
  assert.equal(stale.first.report.persisted, false);
  assert.equal(stale.second.report.persisted, true);
  assert.equal(stale.publishes, 1);
  assert.equal(writes, 4);
  assert.equal(stale.server.notices[0].status, 'unknown');

  const outage = await runCase('outage before an event id', {
    onPublish() {
      return { status: 'unknown', code: 'receiver_unconfirmed', stop_run: true };
    }
  });
  assert.equal(outage.first.report.event_id, null);
  assert.equal(outage.first.halted, true);
  assert.equal(outage.server.notices[0].status, 'unknown');
  assert.equal(outage.publishes, 1);

  const mixed = path.join(os.tmpdir(), 'keelcard-mixed-' + process.pid + '.jsonl');
  fs.writeFileSync(mixed, JSON.stringify({
    request_id: 'notice-notice-0001-aaaa',
    cloud_event: { id: 'keelcard-kc-adeyemi-notice-0002-bbbb' },
    result: committed
  }) + '\n');
  assert.equal(receiptForNotice(mixed, data().notices[0]), null);
  fs.rmSync(mixed, { force: true });
});

test('an inspection failure stays in the report and can be confirmed from the saved receiver id', async () => {
  const minimal = require('../fixtures/minimal.json');
  const copy = structuredClone(minimal);
  copy.notices = [
    { notice_id: 'notice-0001-aaaa', kind: 'code', status: 'pending_delivery', cloud_event_id: 'keelcard-kc-adeyemi-notice-0001-aaaa', publish_request_id: 'notice-notice-0001-aaaa', title: 'Code', body: 'Code 111111', created_at: minimal.initial_clock, source_object: { object_type: 'change_request', object_id: 'cr-1' }, related_id: 'cr-1', delivery: null },
    { notice_id: 'notice-0002-bbbb', kind: 'decline', status: 'pending_delivery', cloud_event_id: 'keelcard-kc-adeyemi-notice-0002-bbbb', publish_request_id: 'notice-notice-0002-bbbb', title: 'Declined', body: 'Declined', created_at: minimal.initial_clock, source_object: { object_type: 'decline', object_id: 'auth-1' }, related_id: 'auth-1', delivery: null }
  ];
  let publishes = 0;
  let failInspection = true;
  const seen = [];
  const router = {
    async call() {
      publishes += 1;
      return { status: 'committed', event_id: 'router-' + publishes, stop_run: false };
    }
  };
  const inspect = async ({ event_id }) => {
    seen.push(event_id);
    if (failInspection && event_id === 'router-1') throw new Error('inspection is down');
    return { eventStatus: { status: 'ok', receipt: { status: 'committed', event_id } }, mailRecord: { id: event_id } };
  };
  const first = await publishPending({ data: copy, router, inspect });
  assert.equal(first.halted, false);
  assert.equal(first.reports[0].outcome, 'unresolved');
  assert.equal(first.reports[0].persisted, false);
  assert.equal(first.reports[1].mail_confirmed, true);
  assert.equal(copy.notices[0].status, 'unknown');
  assert.equal(copy.notices[0].delivery.event_id, 'router-1');
  failInspection = false;
  const again = await publishPending({ data: copy, router, inspect });
  assert.equal(publishes, 2);
  assert.equal(again.sent.length, 0);
  assert.equal(seen.includes('router-1'), true);
  assert.equal(copy.notices[0].status, 'committed');
  let writes = 0;
  copy.notices[0].delivery.recorded_at = minimal.initial_clock;
  copy.publication = {
    halted: true,
    notice_id: 'notice-0001-aaaa',
    publish_request_id: 'notice-notice-0001-aaaa',
    cloud_event_id: 'keelcard-kc-adeyemi-notice-0001-aaaa',
    event_id: 'router-1',
    status: 'committed',
    stop_run: false,
    code: null
  };
  const saved = await publishPending({
    data: copy,
    router,
    inspect,
    commit: async () => { writes += 1; return { status: 'committed' }; }
  });
  assert.equal(writes, 0);
  assert.equal(saved.report.persisted, true);
  assert.equal(copy.notices[1].status, 'committed');
});

test('a stale halt write is repeated until Core keeps it', async () => {
  const minimal = require('../fixtures/minimal.json');
  function pair() {
    const copy = structuredClone(minimal);
    copy.notices = [
      { notice_id: 'notice-0001-aaaa', kind: 'code', status: 'pending_delivery', cloud_event_id: 'keelcard-kc-adeyemi-notice-0001-aaaa', publish_request_id: 'notice-notice-0001-aaaa', title: 'Code', body: 'Code 111111', created_at: minimal.initial_clock, source_object: { object_type: 'change_request', object_id: 'cr-1' }, related_id: 'cr-1', delivery: null },
      { notice_id: 'notice-0002-bbbb', kind: 'decline', status: 'pending_delivery', cloud_event_id: 'keelcard-kc-adeyemi-notice-0002-bbbb', publish_request_id: 'notice-notice-0002-bbbb', title: 'Declined', body: 'Declined', created_at: minimal.initial_clock, source_object: { object_type: 'decline', object_id: 'auth-1' }, related_id: 'auth-1', delivery: null }
    ];
    return copy;
  }
  let core = null;
  let haltWrites = 0;
  let publishes = 0;
  const read = async () => ({ publication: core, notices: [] });
  const commit = async (item) => {
    if (item.kind !== 'halt') return { status: 'committed' };
    haltWrites += 1;
    if (haltWrites === 1) return { status: 'stale_version' };
    core = {
      halted: true,
      notice_id: item.notice_id,
      publish_request_id: item.publish_request_id,
      cloud_event_id: item.cloud_event_id,
      event_id: item.receipt_event_id,
      status: item.status,
      stop_run: Boolean(item.stop_run),
      code: item.code || null
    };
    return { status: 'committed' };
  };
  const lostDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keelcard-halt-lost-'));
  const lostRouter = { async call() { publishes += 1; throw new Error('reply lost'); } };
  const lost = await publishPending({ data: pair(), router: lostRouter, commit, read, runDir: lostDir });
  assert.equal(publishes, 1);
  assert.equal(lost.stopped, true);
  assert.equal(haltWrites, 2);
  assert.equal(core.halted, true);
  const lostFresh = pair();
  lostFresh.publication = structuredClone(core);
  const lostAgain = await publishPending({ data: lostFresh, router: lostRouter, commit, read });
  assert.equal(publishes, 1);
  assert.equal(lostAgain.sent.length, 0);
  assert.equal(lostFresh.notices[1].status, 'pending_delivery');

  publishes = 0;
  haltWrites = 0;
  core = null;
  const receiverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keelcard-halt-receiver-'));
  const receiverRouter = {
    async call() {
      publishes += 1;
      return { status: 'unknown', code: 'receiver_unconfirmed', stop_run: true, event_id: 'router-halted' };
    }
  };
  const receiver = await publishPending({ data: pair(), router: receiverRouter, commit, read, runDir: receiverDir });
  assert.equal(publishes, 1);
  assert.equal(receiver.stopped, true);
  assert.equal(haltWrites, 2);
  const receiverFresh = pair();
  receiverFresh.publication = structuredClone(core);
  const receiverAgain = await publishPending({ data: receiverFresh, router: receiverRouter, commit, read });
  assert.equal(publishes, 1);
  assert.equal(receiverAgain.sent.length, 0);
  assert.equal(receiverFresh.notices.find(notice => notice.notice_id !== core.notice_id).status, 'pending_delivery');

  publishes = 0;
  haltWrites = 0;
  core = null;
  const fileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keelcard-halt-file-'));
  fs.writeFileSync(path.join(fileDir, 'keelcard-publication.json'), JSON.stringify({
    halted: true,
    notice_id: 'notice-0001-aaaa',
    publish_request_id: 'notice-notice-0001-aaaa',
    cloud_event_id: 'keelcard-kc-adeyemi-notice-0001-aaaa',
    event_id: 'router-1',
    status: 'unknown',
    stop_run: true,
    code: 'receiver_unconfirmed'
  }));
  const fromFile = await publishPending({ data: pair(), router: receiverRouter, commit, read, runDir: fileDir });
  assert.equal(publishes, 0);
  assert.equal(fromFile.stopped, true);
  assert.equal(fromFile.sent.length, 0);
  assert.equal(core.notice_id, 'notice-0001-aaaa');

  let stuckWrites = 0;
  const stuckDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keelcard-halt-stuck-'));
  fs.writeFileSync(path.join(stuckDir, 'keelcard-publication.json'), JSON.stringify({
    halted: true,
    notice_id: 'notice-0001-aaaa',
    publish_request_id: 'notice-notice-0001-aaaa',
    cloud_event_id: 'keelcard-kc-adeyemi-notice-0001-aaaa',
    event_id: null,
    status: 'unknown',
    stop_run: true,
    code: 'response_lost'
  }));
  const refused = await publishPending({
    data: pair(),
    router: receiverRouter,
    read: async () => ({ publication: null, notices: [] }),
    commit: async () => { stuckWrites += 1; return { status: 'stale_version' }; },
    runDir: stuckDir
  });
  assert.equal(publishes, 0);
  assert.equal(stuckWrites, 8);
  assert.equal(refused.stopped, true);
  assert.equal(refused.sent.length, 0);
});

test('a reused snapshot reports persisted from a Core receipt or a fresh read', async () => {
  const minimal = require('../fixtures/minimal.json');
  const copy = structuredClone(minimal);
  copy.notices = [
    { notice_id: 'notice-0001-aaaa', kind: 'code', status: 'pending_delivery', cloud_event_id: 'keelcard-kc-adeyemi-notice-0001-aaaa', publish_request_id: 'notice-notice-0001-aaaa', title: 'Code', body: 'Code 111111', created_at: minimal.initial_clock, source_object: { object_type: 'change_request', object_id: 'cr-1' }, related_id: 'cr-1', delivery: null },
    { notice_id: 'notice-0002-bbbb', kind: 'decline', status: 'pending_delivery', cloud_event_id: 'keelcard-kc-adeyemi-notice-0002-bbbb', publish_request_id: 'notice-notice-0002-bbbb', title: 'Declined', body: 'Declined', created_at: minimal.initial_clock, source_object: { object_type: 'decline', object_id: 'auth-1' }, related_id: 'auth-1', delivery: null }
  ];
  let publishes = 0;
  const router = {
    async call() {
      publishes += 1;
      return { status: 'committed', event_id: 'mem-' + publishes, stop_run: false };
    }
  };
  const first = await publishPending({ data: copy, router });
  assert.equal(first.stopped, false);
  assert.equal(first.reports.length, 2);
  assert.equal(first.reports.every(report => report.persisted === false), true);
  assert.equal(copy.notices.every(notice => notice.status === 'unknown'), true);
  const coreNotices = copy.notices.map(notice => ({ notice_id: notice.notice_id, status: 'pending_delivery', delivery: null }));
  let writes = 0;
  const second = await publishPending({
    data: copy,
    router,
    read: async () => ({ publication: null, notices: coreNotices }),
    commit: async (item) => {
      writes += 1;
      const notice = coreNotices.find(row => row.notice_id === item.notice_id);
      notice.status = item.status;
      notice.delivery = {
        publish_request_id: item.publish_request_id,
        status: item.status,
        event_id: item.receipt_event_id,
        code: item.code,
        recorded_at: minimal.initial_clock
      };
      return { status: 'committed' };
    }
  });
  assert.equal(publishes, 2);
  assert.equal(writes, 2);
  assert.equal(second.reports.every(report => report.persisted === true), true);
  assert.equal(coreNotices.every(notice => notice.status === 'unknown'), true);
  const quietData = structuredClone(minimal);
  quietData.notices = coreNotices.map(notice => ({
    notice_id: notice.notice_id,
    kind: 'code',
    status: notice.status,
    cloud_event_id: 'keelcard-kc-adeyemi-' + notice.notice_id,
    publish_request_id: 'notice-' + notice.notice_id,
    title: 'Saved',
    body: 'Saved',
    created_at: minimal.initial_clock,
    source_object: { object_type: 'change_request', object_id: 'cr-1' },
    related_id: 'cr-1',
    delivery: notice.delivery
  }));
  let quietWrites = 0;
  const quiet = await publishPending({
    data: quietData,
    router,
    commit: async () => { quietWrites += 1; return { status: 'committed' }; }
  });
  assert.equal(quietWrites, 0);
  assert.equal(quiet.stopped, false);
  assert.equal(quiet.reports.every(report => report.persisted === true), true);
});

test('coverage counts match the delivered 2025-26 window', () => {
  const { buildCoverage } = require('../examples/coverage-report.cjs');
  const report = buildCoverage();
  const household = report.sources.a;
  const freelancer = report.sources.b;
  const delegate = report.sources.c;
  const december = report.sources.december;
  const weekly = household.per_card['card-4417'];
  assert.equal(household.sha256, 'd9eeb281a49e632fa726f5a06c9c5147c8ba6924c42acfd88dd5b420073c6bc4');
  assert.equal(household.counts.approved, 62);
  assert.equal(household.counts.declined, 1);
  assert.equal(household.counts.statements, 14);
  assert.equal(household.distinct_dates, 62);
  assert.equal(household.earliest, '2025-09-20');
  assert.equal(household.latest, '2026-11-14');
  assert.equal(weekly.approved, 61);
  assert.equal(weekly.declined, 1);
  assert.equal(weekly.distinct_dates, 61);
  assert.deepEqual(weekly.weekdays, ['Saturday']);
  assert.equal(weekly.earliest, '2025-09-20');
  assert.equal(weekly.latest, '2026-11-14');
  assert.equal(freelancer.counts.approved, 508);
  assert.equal(freelancer.counts.declined, 37);
  assert.equal(freelancer.counts.statements, 22);
  assert.equal(freelancer.distinct_dates, 397);
  assert.equal(freelancer.earliest, '2025-01-01');
  assert.equal(freelancer.latest, '2026-11-11');
  assert.equal(december.counts.events, 48);
  assert.equal(december.counts.requests, 24);
  assert.equal(december.counts.approved, 23);
  assert.equal(december.counts.captured, 23);
  assert.equal(december.counts.declined, 1);
  assert.equal(december.distinct_dates, 18);
  assert.equal(december.by_month['2026-12'].dates, 18);
  assert.equal(delegate.counts.approved, 0);
  assert.equal(delegate.counts.declined, 0);
  assert.equal(delegate.counts.statements, 0);
  assert.equal(delegate.distinct_dates, 1);
  assert.equal(delegate.earliest, '2026-11-18');
  assert.equal(report.global.seeds.distinct_dates, 424);
  assert.equal(report.global.seeds.earliest, '2025-01-01');
  assert.equal(report.global.seeds.latest, '2026-11-18');
  assert.equal(report.global.seeds_plus_december.distinct_dates, 442);
  assert.equal(report.global.seeds_plus_december.months_with_activity, 24);
  assert.equal(household.exclusions.length, 0);
  assert.equal(freelancer.exclusions.length, 0);
  assert.equal(delegate.exclusions.length, 0);
  assert.equal(december.exclusions.length, 1);
  assert.equal(december.exclusions[0].reason, 'out_of_window');
  assert.equal(december.counts.basis, 'scheduled');
  const { zonedToIso } = require('../src/domain-utils.cjs');
  const seed = require('../fixtures/freelancer.json');
  const householdSeed = require('../fixtures/minimal.json');
  assert.equal(seed.statements.length, 22);
  assert.equal(seed.statements[0].statement_id, 'stmt-2025-01');
  assert.equal(seed.statements.at(-1).statement_id, 'stmt-2026-10');
  for (const statement of seed.statements) {
    const match = /^stmt-(\d{4})-(\d{2})$/.exec(statement.statement_id);
    let year = Number(match[1]);
    let month = Number(match[2]) + 1;
    if (month === 13) { month = 1; year += 1; }
    const boundary = zonedToIso(year, month, 1, 0, 0, 0, 'America/New_York');
    assert.equal(statement.issued_at, boundary, statement.statement_id);
    assert.equal(statement.effective_at, boundary);
  }
  assert.equal(householdSeed.statements.length, 14);
  assert.equal(householdSeed.statements.every(statement => statement.issued_at === '2026-11-18T17:00:00.000Z'), true);
  const { emit } = require('../examples/coverage-report.cjs');
  const skipped = emit({ load: { skipped: true, ok: true, reason: 'Public runtime is not beside the package, so the load query was skipped.' } }, { json: true });
  assert.equal(JSON.parse(skipped.stdout).load.skipped, true);
  assert.equal(skipped.stderr, '');
  assert.equal(skipped.exitCode, 0);
});

test('reviewer views escape text and omit card secrets', () => {
  const view = require('../gui/src/view.js');
  const number = '9417220000014417';
  const code = '317';
  const card = {
    card_id: CARD,
    nickname: '<img src=x onerror=alert(1)>',
    last_four: '4417',
    status: 'active',
    number,
    security_code: code,
    limits: { per_transaction: 7500, per_day: 20000, per_month: 120000, lifetime: null }
  };
  const transaction = {
    authorization_id: 'auth-w01',
    decided_at: '2025-09-20T12:12:00.000Z',
    merchant_name: 'FreshCart <b>',
    amount_cents: 4200,
    status: 'captured',
    number,
    security_code: code
  };
  const pages = [
    view.render([card]),
    view.renderCardList([card]),
    view.renderCardDetail(card),
    view.renderTransactions([transaction])
  ];
  for (const html of pages) {
    assert.equal(html.includes(number), false);
    assert.equal(html.includes(code), false);
    assert.equal(html.includes('<img'), false);
    assert.equal(html.includes('<script'), false);
  }
  assert.equal(pages[0].includes('&lt;img'), true);
  assert.equal(pages[1].includes('&lt;img'), true);
  assert.equal(pages[1].includes('Last four 4417'), true);
  assert.equal(pages[1].includes('Status active'), true);
  assert.equal(pages[2].includes('Per transaction'), true);
  assert.equal(pages[2].includes('7500'), true);
  assert.equal(pages[2].includes('Per day'), true);
  assert.equal(pages[2].includes('Per month'), true);
  assert.equal(pages[2].includes('Lifetime'), true);
  assert.equal(pages[3].includes('FreshCart &lt;b&gt;'), true);
  assert.equal(pages[3].includes('4200'), true);
  assert.equal(pages[3].includes('2025-09-20T12:12:00.000Z'), true);
  assert.equal(pages[3].includes('captured'), true);
  assert.equal(pages[2].includes('7500 cents'), true);
  assert.equal(pages[2].includes('Unlimited'), true);
  const nestedEvent = require('../examples/events/freelancer-2026-12.json').find(event => event.event_id === 'b-dec-req-24');
  const nested = { payload: { card: { card_id: 'card-x', number: '9418000000000099', security_code: '9091' } } };
  const secretPages = [
    view.render([nestedEvent]),
    view.render([nested]),
    view.renderCardList([nestedEvent, nested]),
    view.renderCardDetail(nestedEvent),
    view.renderCardDetail(nested),
    view.renderTransactions([nestedEvent]),
    view.renderTransactions([nested])
  ];
  for (const html of secretPages) {
    assert.equal(html.includes('9418000000000023'), false);
    assert.equal(html.includes('9418000000000099'), false);
    assert.equal(html.includes('9091'), false);
    assert.equal(html.includes(number), false);
    assert.equal(html.includes(code), false);
  }
  assert.equal(secretPages[0].includes('202'), false);
  assert.equal(secretPages[0].includes('card-software'), true);
  assert.equal(secretPages[0].includes('Vellum Keys'), true);
});
