'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture } = require('./harness.cjs');
const { compile } = require('./schema-validator.cjs');
const { addMinutes, parts } = require('../src/domain-utils.cjs');
const { scan } = require('../src/fingerprints.cjs');
const { wireFor } = require('../src/publisher.cjs');
const { classifyDelivery } = require('../src/publisher.cjs');

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
  assert.equal(rejected.code, 'not_pending');
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
  f.event({
    event_id: 'once-cap', at: '2026-11-19T10:06:00-05:00', operation: 'authorization.capture',
    payload: { authorization_key: 'once:kc:once:1', capture_key: 'cap-once', amount_cents: 500 }
  });
  assert.equal(f.data.cards.find(item => item.card_id === created.card_id).closure_reason, 'single_use');
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
    payload: { notice_id: notice.notice_id, publish_request_id: notice.publish_request_id, status: 'committed', event_id: 'router-committed1' }
  });
  assert.equal(f.data.notices[0].status, 'committed');
  assert.equal(boom(() => f.event({
    event_id: 'delivery-conflict',
    at: addMinutes(f.ctx.virtual_now, 1),
    operation: 'notice.delivery_result',
    payload: { notice_id: notice.notice_id, publish_request_id: notice.publish_request_id, status: 'rejected' }
  })).code, 'delivery_status_conflict');
  assert.equal(classifyDelivery({ receipt: { status: 'committed', duplicate: true } }).outcome, 'confirmed');
  assert.equal(classifyDelivery({ receipt: { status: 'rejected', code: 'recipient_not_authorized' } }).outcome, 'rejected');
  assert.equal(classifyDelivery({ receipt: { status: 'unknown', code: 'receiver_unconfirmed', stop_run: true } }).outcome, 'unresolved');
  assert.equal(classifyDelivery({ mailStatus: 'committed' }).outcome, 'confirmed');
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
});
