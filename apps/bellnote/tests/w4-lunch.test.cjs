'use strict';
// W4 Lunch account: T14–T16.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, ev} = require('./harness.cjs');

function refused(f, name, args, code) {
  const before = f.data, rev = f.revision, r = f.try(name, args);
  assert.equal(r.status, code, name + ' should be refused with ' + code + ': ' + r.message);
  assert.deepEqual(f.data, before); assert.equal(f.revision, rev);
}
const charge = (child_id, at, amount_cents, extra = {}, id) => ev('lunch.charged', at, {transaction_id: id || 'tx-' + at.slice(5, 16).replace(/\D/g, '') + '-' + child_id.slice(6),
  child_id, kind: 'purchase', amount_cents, item: 'Lunch', allergens: [], ...extra});
function balancesMatch(f) {
  for (const a of f.data.lunch_accounts) {
    const sum = f.data.lunch_transactions.filter(t => t.lunch_account_id === a.id).reduce((s, t) => s + t.amount_cents, 0);
    assert.equal(a.balance_cents, sum, a.id + ' balance equals the sum of its transactions');
  }
}

test('T14 balances equal the sum of transactions after top-ups, purchases, refunds and adjustments; the debt limit', () => {
  const f = fixture();
  // Main path: Ines 3.10 → top-up 20.00 → 23.10; a peanut item charged → 18.85, flagged for her restrictions.
  const t = f.call('bellnote.lunch.topup', {id: 'lunch-ines', amount_cents: 2000});
  assert.equal(t.balance_cents, 2310); assert.equal(t.payment.status, 'paid'); assert.equal(t.payment.amount_cents, 2000);
  assert.equal(f.data.lunch_transactions.filter(x => x.request_id === 'local-1').length, 1);
  balancesMatch(f);
  f.event(ev('lunch.charged', '2026-11-18T12:10:00-08:00', {transaction_id: 'tx-0412', child_id: 'child-ines', kind: 'purchase', amount_cents: -425, item: 'Peanut noodle bowl', allergens: ['peanut', 'wheat', 'soy']}));
  const acct = f.call('bellnote.lunch.account_get', {id: 'lunch-ines', start: '2026-11-18', end: '2026-11-18'});
  assert.equal(acct.account.balance_cents, 1885);
  assert.equal(acct.transactions.find(x => x.id === 'tx-0412').restricted_item, true);
  balancesMatch(f);
  // A refund of a top-up returns it to the card and marks the payment refunded; a meal refund credits the balance.
  f.event(ev('lunch.charged', '2026-11-18T15:00:00-08:00', {transaction_id: 'tx-0413', child_id: 'child-theo', kind: 'refund', amount_cents: -2000, payment_id: 'pay-0001'}));
  assert.equal(f.data.payments.find(p => p.id === 'pay-0001').status, 'refunded');
  f.event(ev('lunch.charged', '2026-11-18T15:05:00-08:00', {transaction_id: 'tx-0414', child_id: 'child-theo', kind: 'refund', amount_cents: 375, item: 'Chicken rice bowl', note: 'Meal not served'}));
  f.event(ev('lunch.charged', '2026-11-18T15:10:00-08:00', {transaction_id: 'tx-0415', child_id: 'child-nico', kind: 'adjustment', amount_cents: -150, note: 'Correction'}));
  assert.deepEqual(f.data.notifications.filter(n => n.kind === 'lunch.refund').map(n => n.object_id), ['tx-0413', 'tx-0414']);
  balancesMatch(f);
  assert.equal(f.data.lunch_accounts.find(a => a.id === 'lunch-theo').balance_cents, -375);
  // The debt limit (10.00): down to exactly -10.00 is applied as given; one cent further is refused.
  f.event(charge('child-theo', '2026-11-19T12:00:00-08:00', -625));
  assert.equal(f.data.lunch_accounts.find(a => a.id === 'lunch-theo').balance_cents, -1000);
  const before = f.data;
  assert.equal(f.tryEvent(charge('child-theo', '2026-11-19T12:01:00-08:00', -1)).status, 'invalid_event');
  assert.deepEqual(f.data, before);
  // A purchase cannot credit; a refund of a top-up must return exactly that top-up.
  assert.equal(f.tryEvent(charge('child-theo', '2026-11-19T12:02:00-08:00', 100)).status, 'invalid_event');
  assert.equal(f.tryEvent(ev('lunch.charged', '2026-11-19T12:03:00-08:00', {transaction_id: 'tx-0420', child_id: 'child-ines', kind: 'refund', amount_cents: -100, payment_id: 'pay-0002'})).status, 'invalid_event');
  balancesMatch(f);
});

test('T15 top-up range, payment_declined, not_permitted; settings; the low_balance notification once per crossing', () => {
  const f = fixture();
  refused(f, 'bellnote.lunch.topup', {id: 'lunch-ines', amount_cents: 200}, 'amount_out_of_range');
  refused(f, 'bellnote.lunch.topup', {id: 'lunch-ines', amount_cents: 20001}, 'amount_out_of_range');
  refused(f, 'bellnote.lunch.topup', {id: 'lunch-ines', amount_cents: 2000, payment_method_id: 'pm-0003'}, 'payment_declined');
  refused(f, 'bellnote.lunch.topup', {id: 'lunch-zed', amount_cents: 2000}, 'not_found');
  assert.equal(f.call('bellnote.lunch.topup', {id: 'lunch-ines', amount_cents: 500}).balance_cents, 810, 'The minimum itself is accepted');
  const noPay = fixture({mutate: d => { d.guardian_links.find(l => l.id === 'gl-ines-maya').can_pay = false; }});
  refused(noPay, 'bellnote.lunch.topup', {id: 'lunch-ines', amount_cents: 2000}, 'not_permitted');
  refused(noPay, 'bellnote.lunch.settings_update', {id: 'lunch-ines', daily_limit_cents: 500}, 'not_permitted');
  // Settings.
  const s = f.call('bellnote.lunch.settings_update', {id: 'lunch-theo', low_balance_threshold_cents: 600, daily_limit_cents: 800});
  assert.deepEqual([s.low_balance_threshold_cents, s.daily_limit_cents], [600, 800]);
  assert.equal(f.call('bellnote.lunch.settings_update', {id: 'lunch-theo', daily_limit_cents: null}).daily_limit_cents, null);
  refused(f, 'bellnote.lunch.settings_update', {id: 'lunch-theo', low_balance_threshold_cents: -1}, 'invalid_arguments');
  refused(f, 'bellnote.lunch.settings_update', {id: 'lunch-theo', daily_limit_cents: -5}, 'invalid_arguments');
  refused(f, 'bellnote.lunch.settings_update', {id: 'lunch-theo', low_balance_threshold_cents: 10000001}, 'invalid_arguments');
  refused(f, 'bellnote.lunch.settings_update', {id: 'lunch-theo', daily_limit_cents: 10000001}, 'invalid_arguments');
  assert.equal(f.call('bellnote.lunch.settings_update', {id: 'lunch-theo', daily_limit_cents: 10000000}).daily_limit_cents, 10000000);
  refused(f, 'bellnote.lunch.settings_update', {id: 'lunch-theo'}, 'invalid_arguments');
  // Once per crossing: Theo 12.50, threshold 6.00.
  const lows = () => f.data.notifications.filter(n => n.kind === 'lunch.low_balance' && n.child_id === 'child-theo').length;
  f.event(charge('child-theo', '2026-11-17T12:00:00-08:00', -700));
  assert.equal(lows(), 1);
  f.event(charge('child-theo', '2026-11-18T12:00:00-08:00', -100));
  assert.equal(lows(), 1, 'Still under the threshold: no second notice');
  f.call('bellnote.lunch.topup', {id: 'lunch-theo', amount_cents: 2000});
  assert.equal(lows(), 1, 'My own top-up writes no notification');
  f.event(charge('child-theo', '2026-11-19T12:00:00-08:00', -2000));
  assert.equal(lows(), 2, 'A new crossing after recovering notifies again');
});

test('T16 menus with allergen tags and excluded_for; restricted_item and over_daily_limit are computed when read', () => {
  const f = fixture();
  const week = f.call('bellnote.menu.list', {start: '2026-11-16', end: '2026-11-20'});
  const noodles = week.days.find(d => d.school_id === 'school-alder' && d.date === '2026-11-18').items.find(i => i.id === 'item-peanut-noodles');
  assert.deepEqual(noodles.allergens, ['peanut', 'wheat', 'soy']); assert.deepEqual(noodles.excluded_for, ['child-ines']);
  const almond = week.days.find(d => d.date === '2026-11-19' && d.school_id === 'school-alder').items.find(i => i.id === 'item-almond-bar');
  assert.deepEqual(almond.excluded_for, ['child-ines']);
  const mac = week.days.find(d => d.school_id === 'school-kestrel' && d.date === '2026-11-18').items.find(i => i.id === 'item-mac');
  assert.deepEqual(mac.excluded_for, ['child-nico']);
  const empty = week.days.find(d => d.school_id === 'school-alder' && d.date === '2026-11-20');
  assert.deepEqual([empty.menu_published, empty.items], [false, []]);
  assert.equal(f.call('bellnote.menu.list', {id: 'school-kestrel', start: '2026-11-16', end: '2026-11-20'}).days.every(d => d.school_id === 'school-kestrel'), true);
  // Ines has a 6.00 daily limit: the second purchase of the day passes it.
  f.call('bellnote.lunch.topup', {id: 'lunch-ines', amount_cents: 2000});
  f.event(charge('child-ines', '2026-11-17T11:50:00-08:00', -345, {item: 'Cheese pizza', allergens: ['milk', 'wheat']}, 'tx-1001'));
  f.event(charge('child-ines', '2026-11-17T13:30:00-08:00', -300, {item: 'Almond oat bar', allergens: ['tree_nut', 'wheat']}, 'tx-1002'));
  let tx = f.call('bellnote.lunch.account_get', {id: 'lunch-ines', start: '2026-11-17', end: '2026-11-17'}).transactions;
  assert.deepEqual(tx.filter(t => t.kind === 'purchase').map(t => [t.id, t.restricted_item, t.over_daily_limit]), [['tx-1001', false, false], ['tx-1002', true, true]]);
  const stored = f.data.lunch_transactions.find(t => t.id === 'tx-1002');
  assert.ok(!('restricted_item' in stored) && !('over_daily_limit' in stored), 'Flags are never stored');
  // Raising the limit changes the flag at the next read; the stored transaction is untouched.
  f.call('bellnote.lunch.settings_update', {id: 'lunch-ines', daily_limit_cents: 1000});
  tx = f.call('bellnote.lunch.account_get', {id: 'lunch-ines', start: '2026-11-17', end: '2026-11-17'}).transactions;
  assert.equal(tx.find(t => t.id === 'tx-1002').over_daily_limit, false);
  assert.deepEqual(f.data.lunch_transactions.find(t => t.id === 'tx-1002'), stored);
  // The cafeteria is not checked: a restricted item is applied as given.
  assert.equal(f.data.lunch_accounts.find(a => a.id === 'lunch-ines').balance_cents, 310 + 2000 - 645);
});
