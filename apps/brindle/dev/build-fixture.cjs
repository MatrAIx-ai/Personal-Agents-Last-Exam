'use strict';
// Writes fixtures/minimal.json. It replays one scripted year of the account, from its opening on 10 November 2025 to the clock of
// 5 December 2026, through the App's own hooks (dev/replay.cjs). So the App accepted every step, and every statement balance is the
// App's balance at the closing time.
// Run `node dev/build-fixture.cjs` after a change, or `node dev/build-fixture.cjs --check` to compare with the committed file. Never used at run time.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {at, replay, check, ctxAt} = require('./replay.cjs');
const plugin = require('../plugin.cjs');
const views = require('../src/views.cjs');
const time = require('../src/time.cjs');
const {counts, PLAN} = require('./check-fixture.cjs');
const base = require('./base.json');
const APP = require('../app.json').app_id, CLOCK = require('../fixtures/clock.json').initial_time, ZONE = base.issuer.timezone;
const ACCOUNT = base.account_id, BANK = base.account.autopay.source, NEW_BANK = 'Checking ending 7302';
const pad = (number, size) => String(number).padStart(size, '0');
const cents = amount => Math.round(amount * 100);
const sum = values => values.reduce((a, b) => a + b, 0);

// IDs that events make are written as '@txn:label', '@pts:label' or '@off:label' and numbered in time order when the step runs.
const ids = new Map(), next = {txn: 0, pts: 0, off: 0};
function resolve(value) {
  if (typeof value === 'string' && /^@(txn|pts|off):/.test(value)) {
    if (!ids.has(value)) { const family = value.slice(1, 4); ids.set(value, family + '-' + pad(++next[family], 4)); }
    return ids.get(value);
  }
  if (Array.isArray(value)) return value.map(resolve);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]));
  return value;
}
const id = label => resolve(label);

const steps = [];
const lazy = value => data => resolve(typeof value === 'function' ? value(data) : value);
const call = (local, name, args) => steps.push({at: at(local), call: name, args: lazy(args)});
const event = (local, name, payload) => steps.push({at: at(local), event: name, payload: lazy(payload)});
const buy = (local, label, merchant, amount) => event(local, 'transaction.posted', {transaction_id: '@txn:' + label, kind: 'purchase', state: 'posted', amount, merchant});
// A hold that the merchant settles later at its final amount, or that stays pending when `settled` is null.
function hold(local, settled, label, merchant, held, amount) {
  event(local, 'transaction.posted', {transaction_id: '@txn:' + label, kind: 'purchase', state: 'pending', amount: held, merchant});
  if (settled) event(settled, 'transaction.posted', {transaction_id: '@txn:' + label, kind: 'purchase', state: 'posted', amount});
}
const refund = (local, label, purchase, merchant, amount, note) => event(local, 'transaction.posted',
  {transaction_id: '@txn:' + label, kind: 'refund', state: 'posted', amount, merchant, relates_to: '@txn:' + purchase, note});
const points = (local, label, value, reason, note, extra = {}) => event(local, 'points.adjusted',
  data => ({entry_id: '@pts:' + label, points: typeof value === 'function' ? value(data) : value, reason, note, ...extra}));
const pay = (local, amountType, payOn, extra = {}) => call(local, 'payments.schedule', {id: ACCOUNT, amount_type: amountType, pay_on: payOn, source: BANK, ...extra});

// Statements close at the end of the month and are due on the 26th at 17:00. The balance is the App's balance at the closing.
// The minimum is 1 percent of the balance, at least 35.00, and never above the balance.
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const closingOf = month => { const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)); return d.toISOString().slice(0, 10); };
const nextMonth = month => time.addDays(closingOf(month), 1).slice(0, 7);
function statement(month) {
  const issued = nextMonth(month) + '-01 02:00', closing = closingOf(month) + ' 23:59:59';
  event(issued, 'statement.issued', data => {
    const balance = views.balance(data, Date.parse(at(issued)), Date.parse(at(closing)));
    const minimum = balance <= 0 ? 0 : Math.min(balance, Math.max(3500, Math.round(balance / 100)));
    return {statement_id: 'stm-' + month, closing_at: at(closing), statement_balance: balance / 100, minimum_due: minimum / 100, due_at: at(nextMonth(month) + '-26 17:00')};
  });
}
// The cycle of a statement: what posted after the closing before it, up to its own closing.
function cycle(data, month) {
  const list = views.ordered(data), s = list.find(x => x.id === 'stm-' + month), i = list.indexOf(s);
  const from = i > 0 ? Date.parse(list[i - 1].closing_at) : -Infinity, to = Date.parse(s.closing_at);
  return data.transactions.filter(tx => tx.state === 'posted' && Date.parse(tx.posted_at) > from && Date.parse(tx.posted_at) <= to);
}
// Net purchases in whole units: purchases of a set of merchants, minus their refunds, in the same transactions.
const TRAVEL = new Set(['Skyway Air', 'Bayview Suites', 'Pinecrest Car Rental']);
const DINING = new Set(['Harbor Lane Bistro', 'Juniper Noodle House', 'Corner Slice', 'Morrow Coffee']);
function net(rows, merchants = null) {
  const pick = rows.filter(tx => merchants === null || merchants.has(tx.merchant));
  return Math.floor((sum(pick.filter(tx => tx.kind === 'purchase').map(tx => cents(tx.amount))) - sum(pick.filter(tx => tx.kind === 'refund').map(tx => cents(tx.amount)))) / 100);
}
// One point for each 1.00 of net purchases in the cycle, on the morning after the statement.
const earned = month => points(nextMonth(month) + '-02 04:00', 'earned-' + month, data => net(cycle(data, month)), 'earned', 'Points for the ' + MONTH[Number(month.slice(5, 7)) - 1] + ' statement.');
const travelBonus = month => points(nextMonth(month) + '-02 04:05', 'travel-' + month, data => 2 * net(cycle(data, month), TRAVEL), 'bonus',
  '2 extra points for each 1.00 of travel on the ' + MONTH[Number(month.slice(5, 7)) - 1] + ' statement.');
const diningBonus = (local, label, months, note) => points(local, label, data => net(months.flatMap(m => cycle(data, m)), DINING), 'bonus', note);

// The year of purchases. Groceries, subscriptions and the phone bill post at once. Fuel and restaurants are held first and settle later.
const GROCERY = [112.4, 96.75, 78.3, 131.2, 88.6, 104.6, 120.35, 67.15, 143.8, 92.05, 58.9, 126.45, 84.3, 109.7, 73.25, 138.6, 99.1, 61.45];
const FUEL = [48.62, 52.1, 44.85, 57.3, 50.04, 46.77, 55.9, 41.28, 53.66, 49.15, 58.02, 45.5, 51.33, 47.9, 54.41, 43.07, 56.25, 49.88, 52.74, 46.12, 55.06, 42.93, 50.6, 53.19];
const DINNER = [[52, 61.4], [38.5, 45.2], [71, 84.5], [44.2, 52.1], [66.8, 79], [29.9, 35.4], [58, 69.6], [47.5, 56], [62.3, 74], [35.75, 42.3], [54.6, 64.4], [41, 48.4],
  [69.9, 82.5], [33.2, 39.2], [57.4, 68.1], [45.8, 54], [63, 75.2], [39.6, 46.7], [50.5, 59.6], [36.9, 43.5], [48.3, 57], [42.7, 50.4], [61.2, 72.9], [58, 96.4]];
const PLACES = ['Harbor Lane Bistro', 'Juniper Noodle House', 'Corner Slice'];
let grocery = 0, fuel = 0, dinner = 0;
const shop = (local, label) => buy(local, label, 'Greenway Market', GROCERY[grocery++ % GROCERY.length]);
function fill(day, settle, label) { const n = fuel++; hold(day, settle, label, 'Northgate Fuel', 150, FUEL[n % FUEL.length]); }
function dine(local, settle, label, place = PLACES[dinner % PLACES.length]) { const [held, final] = DINNER[dinner++ % DINNER.length]; hold(local, settle, label, place, held, final); }

// November 2025: the account opens on 10 November, and the first annual fee posts with it.
event('2025-11-10 09:05', 'transaction.posted', {transaction_id: '@txn:fee-2025', kind: 'fee', fee_type: 'annual', state: 'posted', amount: 550, note: 'Annual fee for the Brindle Reserve card.'});
shop('2025-11-13 03:10', 'g-2025-11-a');
fill('2025-11-15 17:40', '2025-11-17 03:00', 'f-2025-11');
buy('2025-11-18 06:00', 'm-2025-11', 'Kestrel Mobile', 85);
dine('2025-11-22 19:30', '2025-11-24 02:40', 'd-2025-11');
shop('2025-11-24 03:20', 'g-2025-11-b');
buy('2025-11-28 10:15', 'parcel-2025-11', 'Parcelbox Online', 389);

// The monthly pattern from December 2025 to November 2026. `tweak` changes one month.
const MONTHS = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
for (const month of MONTHS) {
  const d = day => month + '-' + day;
  buy(d('03 06:00'), 'gym-' + month, 'Ironworks Gym', 45);
  shop(d('04 03:10'), 'g-' + month + '-a');
  buy(d('06 06:00'), 'tv-' + month, 'Streamlet TV', month >= '2026-07' ? 17.99 : 15.99);
  if (month === '2026-08') { hold(d('08 17:40'), null, 'f-' + month + '-a', 'Northgate Fuel', 150); fuel++; }
  else fill(d('08 17:40'), d('10 03:00'), 'f-' + month + '-a');
  dine(d('11 20:30'), d('13 02:40'), 'd-' + month + '-a', month === '2026-11' ? 'Harbor Lane Bistro' : undefined);
  shop(d('13 03:15'), 'g-' + month + '-b');
  buy(d('18 06:00'), 'm-' + month, 'Kestrel Mobile', 85);
  fill(d('21 18:05'), d('23 03:00'), 'f-' + month + '-b');
  shop(d('24 03:05'), 'g-' + month + '-c');
  dine(d('26 19:45'), d('28 03:00'), 'd-' + month + '-b');
}
event('2026-08-11 09:00', 'transaction.dropped', {transaction_id: '@txn:f-2026-08-a', reason: 'The pump did not start, so the station released the hold.'});

// The other purchases of the year, and what came of them.
buy('2025-12-06 03:40', 'hardware-2025-12', 'Fernhill Hardware', 245.6);
buy('2025-12-14 04:10', 'coat-2025-12', 'Ashgrove Outfitters', 162);
buy('2026-01-06 03:30', 'parcel-2026-01', 'Parcelbox Online', 89);
refund('2026-01-09 04:00', 'r-grocery-2026-01', 'g-2026-01-a', 'Greenway Market', 12.49, 'A spoiled item was refunded.');
buy('2026-03-02 05:10', 'air-2026-03', 'Skyway Air', 612.4);
event('2026-03-05 04:00', 'transaction.posted', {transaction_id: '@txn:travel-2026-03', kind: 'credit', state: 'posted', amount: 100, relates_to: '@txn:air-2026-03',
  note: 'Yearly travel credit of the Brindle Reserve card.'});
buy('2026-03-09 03:45', 'parcel-2026-03', 'Parcelbox Online', 154.3);
hold('2026-03-19 15:20', '2026-03-23 03:30', 'hotel-2026-03', 'Bayview Suites', 450, 418.5);
refund('2026-03-20 04:15', 'r-parcel-2026-03', 'parcel-2026-03', 'Parcelbox Online', 39.99, 'One returned item.');
refund('2026-03-26 04:20', 'r-hotel-2026-03', 'hotel-2026-03', 'Bayview Suites', 35, 'The resort fee was removed.');
buy('2026-04-11 21:00', 'slice-2026-04-a', 'Corner Slice', 38.5);
buy('2026-04-11 21:01', 'slice-2026-04-b', 'Corner Slice', 38.5);
buy('2026-05-07 03:25', 'pharmacy-2026-05', 'Tidewater Pharmacy', 64.3);
refund('2026-05-14 04:00', 'r-pharmacy-2026-05', 'pharmacy-2026-05', 'Tidewater Pharmacy', 21.4, 'A returned item.');
buy('2026-06-01 05:30', 'air-2026-06', 'Skyway Air', 734.8);
refund('2026-06-09 04:10', 'r-air-2026-06', 'air-2026-06', 'Skyway Air', 60, 'The seat upgrade was cancelled.');
hold('2026-06-12 16:00', null, 'hotel-2026-06-hold', 'Bayview Suites', 400);
buy('2026-06-15 03:50', 'car-2026-06', 'Pinecrest Car Rental', 212.7);
event('2026-06-16 03:00', 'transaction.dropped', {transaction_id: '@txn:hotel-2026-06-hold', reason: 'The hotel released the hold and charged the final bill.'});
buy('2026-06-16 03:05', 'hotel-2026-06', 'Bayview Suites', 386.25);
buy('2026-06-18 04:00', 'table-2026-06', 'Larkspur Home', 240);
buy('2026-07-11 03:35', 'drill-2026-07', 'Fernhill Hardware', 129);
refund('2026-07-19 04:05', 'r-drill-2026-07', 'drill-2026-07', 'Fernhill Hardware', 129, 'The drill was returned.');
refund('2026-08-20 04:00', 'r-mobile-2026-08', 'm-2026-08', 'Kestrel Mobile', 20, 'A roaming charge was billed in error.');
buy('2026-08-22 04:15', 'jacket-2026-08', 'Ashgrove Outfitters', 180);
buy('2026-11-19 05:20', 'air-2026-11', 'Skyway Air', 528.6);
event('2026-11-23 04:00', 'transaction.posted', {transaction_id: '@txn:travel-2026-11', kind: 'credit', state: 'posted', amount: 100, relates_to: '@txn:air-2026-11',
  note: 'Yearly travel credit of the Brindle Reserve card.'});

// The second card year starts on 10 November 2026 with the second annual fee. The issuer then makes two offers in one group.
event('2026-11-10 04:00', 'transaction.posted', {transaction_id: '@txn:fee-2026', kind: 'fee', fee_type: 'annual', state: 'posted', amount: 550, note: 'Annual fee for the Brindle Reserve card.'});

// December 2026 up to the clock: two charges posted, and twelve holds still pending.
buy('2026-12-02 03:10', 'g-2026-12', 'Greenway Market', 91.35);
buy('2026-12-03 06:00', 'gym-2026-12', 'Ironworks Gym', 45);
hold('2026-12-02 18:10', null, 'theater-2026-12', 'Cinder Theater', 58);
hold('2026-12-03 08:15', null, 'f-2026-12-a', 'Northgate Fuel', 150);
hold('2026-12-03 12:40', null, 'parcel-2026-12', 'Parcelbox Online', 74.99);
hold('2026-12-03 19:50', null, 'd-2026-12-a', 'Juniper Noodle House', 46.2);
hold('2026-12-04 09:30', null, 'pharmacy-2026-12', 'Tidewater Pharmacy', 23.85);
hold('2026-12-04 11:00', null, 'g-2026-12-b', 'Greenway Market', 88.1);
hold('2026-12-04 15:10', null, 'hotel-2026-12', 'Bayview Suites', 300);
hold('2026-12-04 15:40', null, 'car-2026-12', 'Pinecrest Car Rental', 250);
hold('2026-12-04 20:15', null, 'd-2026-12-b', 'Harbor Lane Bistro', 72.4);
hold('2026-12-05 07:20', null, 'f-2026-12-b', 'Northgate Fuel', 150);
hold('2026-12-05 08:05', null, 'coffee-2026-12', 'Morrow Coffee', 6.75);
hold('2026-12-05 09:10', null, 'lamp-2026-12', 'Larkspur Home', 129);

// Statements, points for each one, and the payments.
for (const month of ['2025-11', ...MONTHS]) { statement(month); earned(month); }
['2026-03', '2026-06', '2026-11'].forEach(travelBonus);
diningBonus('2026-01-02 04:10', 'dining-q4', ['2025-11', '2025-12'], '1 extra point for each 1.00 at restaurants in November and December.');
diningBonus('2026-04-02 04:10', 'dining-q1', ['2026-01', '2026-02', '2026-03'], '1 extra point for each 1.00 at restaurants from January to March.');
diningBonus('2026-07-02 04:10', 'dining-q2', ['2026-04', '2026-05', '2026-06'], '1 extra point for each 1.00 at restaurants from April to June.');
diningBonus('2026-10-02 04:10', 'dining-q3', ['2026-07', '2026-08', '2026-09'], '1 extra point for each 1.00 at restaurants from July to September.');

pay('2025-12-18 20:10', 'statement_balance', '2025-12-20');
pay('2026-01-15 19:30', 'current_balance', '2026-01-20');
// February: the payment is returned after the due time, so the January statement is not paid and the issuer charges interest.
pay('2026-02-15 18:45', 'statement_balance', '2026-02-25');
event('2026-02-27 09:30', 'payment.returned', data => ({payment_id: data.payments.find(p => p.pay_on === '2026-02-25').id, reason: 'The bank account did not have enough money.'}));
event('2026-02-28 21:00', 'transaction.posted', data => {
  const january = data.statements.find(s => s.id === 'stm-2026-01');
  return {transaction_id: '@txn:interest-2026-02', kind: 'interest', state: 'posted', amount: Math.round(cents(january.statement_balance) * 2199 / 120000) / 100,
    note: 'Interest at 21.99 percent a year on the January statement balance, which was not paid by 26 February.'};
});
pay('2026-03-04 20:00', 'statement_balance', '2026-03-06');
event('2026-03-10 11:00', 'transaction.posted', data => ({transaction_id: '@txn:courtesy-2026-03', kind: 'credit', state: 'posted',
  amount: data.transactions.find(tx => tx.id === id('@txn:interest-2026-02')).amount, relates_to: '@txn:interest-2026-02', note: 'Courtesy credit: the interest of 28 February is refunded.'}));
// April: a payment for the 24th is cancelled and paid earlier instead.
pay('2026-04-08 19:15', 'statement_balance', '2026-04-24');
call('2026-04-15 20:30', 'payments.cancel', data => ({id: data.payments.find(p => p.pay_on === '2026-04-24').id}));
pay('2026-04-15 20:35', 'statement_balance', '2026-04-17');
pay('2026-05-14 19:40', 'statement_balance', '2026-05-20');
// In June a fixed amount: the May statement balance rounded up to the next 100.00.
call('2026-06-15 20:20', 'payments.schedule', data => ({id: ACCOUNT, amount_type: 'fixed', pay_on: '2026-06-19', source: BANK,
  amount: Math.ceil(data.statements.find(s => s.id === 'stm-2026-05').statement_balance / 100) * 100}));
pay('2026-07-16 19:05', 'statement_balance', '2026-07-21');
pay('2026-08-17 20:45', 'statement_balance', '2026-08-20');
pay('2026-09-14 19:50', 'statement_balance', '2026-09-18');
// Autopay for the minimum due from the September statement. A full payment in October leaves the autopay payment nothing, so it is skipped.
call('2026-09-21 21:00', 'autopay.set', {id: ACCOUNT, mode: 'minimum_due'});
pay('2026-10-18 18:20', 'statement_balance', '2026-10-20');
// November: the old bank account is closed, so the autopay payment is returned. Autopay moves to the new account, and the statement is paid.
event('2026-11-27 10:00', 'payment.returned', data => ({payment_id: data.payments.find(p => p.pay_on === '2026-11-26').id, reason: 'The bank account is closed.'}));
call('2026-11-28 08:30', 'autopay.set', {id: ACCOUNT, mode: 'minimum_due', source: NEW_BANK});
call('2026-11-28 08:40', 'payments.schedule', {id: ACCOUNT, amount_type: 'statement_balance', pay_on: '2026-11-28', source: NEW_BANK});

// Disputes, one for each way a dispute ends, and one still open at the clock.
const purchase = label => id('@txn:' + label);
call('2026-01-18 20:15', 'disputes.open', () => ({id: purchase('parcel-2026-01'), amount: 89, reason: 'not_received',
  note: 'The order of 5 January never arrived. The tracking page has not changed since 8 January.'}));
event('2026-01-21 10:20', 'dispute.updated', {dispute_id: 'dsp-0001', status: 'open', provisional_credit: {transaction_id: '@txn:pc-dsp-0001', amount: 89}, note: 'Temporary credit while we review.'});
event('2026-02-25 14:30', 'dispute.updated', {dispute_id: 'dsp-0001', status: 'resolved_for_me', note: 'The merchant could not show that the parcel was delivered.'});
call('2026-04-13 19:40', 'disputes.open', () => ({id: purchase('slice-2026-04-b'), amount: 38.5, reason: 'duplicate_charge', note: 'Corner Slice charged my dinner of 11 April twice.'}));
refund('2026-04-15 04:10', 'r-slice-2026-04', 'slice-2026-04-b', 'Corner Slice', 38.5, 'Duplicate charge refunded.');
call('2026-04-16 20:05', 'disputes.withdraw', {id: 'dsp-0002', note: 'The restaurant refunded the second charge.'});
call('2026-06-25 21:10', 'disputes.open', () => ({id: purchase('table-2026-06'), amount: 240, reason: 'not_as_described',
  note: 'The side table is pine with an oak finish. The listing said solid oak.'}));
event('2026-06-29 09:45', 'dispute.updated', {dispute_id: 'dsp-0003', status: 'open', provisional_credit: {transaction_id: '@txn:pc-dsp-0003', amount: 240}, note: 'Temporary credit while we review.'});
event('2026-08-12 13:10', 'dispute.updated', {dispute_id: 'dsp-0003', status: 'resolved_for_merchant', reversal: {transaction_id: '@txn:rv-dsp-0003', amount: 240},
  note: 'The merchant showed that the listing named the wood and the finish.'});
call('2026-09-20 18:55', 'disputes.open', () => ({id: purchase('jacket-2026-08'), amount: 180, reason: 'credit_not_processed',
  note: 'I returned the jacket in the store on 1 September and have the return receipt. The refund has not posted.'}));
event('2026-09-24 10:05', 'dispute.updated', {dispute_id: 'dsp-0004', status: 'open', provisional_credit: {transaction_id: '@txn:pc-dsp-0004', amount: 180}, note: 'Temporary credit while we review.'});
refund('2026-10-02 04:00', 'r-jacket-2026-08', 'jacket-2026-08', 'Ashgrove Outfitters', 180, 'Refund for the jacket returned on 1 September.');
event('2026-10-08 11:40', 'dispute.updated', {dispute_id: 'dsp-0004', status: 'closed_matched', reversal: {transaction_id: '@txn:rv-dsp-0004', amount: 180},
  note: 'The merchant refunded you, so we took back the temporary credit.'});
call('2026-11-20 19:25', 'disputes.open', () => ({id: purchase('d-2026-11-a'), amount: 27, reason: 'wrong_amount',
  note: 'My bill at Harbor Lane Bistro on 11 November was 69.40 with the tip, but the charge is 96.40.'}));

// Offers, rewards and preferences.
event('2026-01-05 10:00', 'offer.issued', {offer_id: '@off:bonus', kind: 'bonus_points', points: 5000, accept_by: at('2026-01-31 23:59:59'),
  terms: '5,000 bonus points after you accept. The points arrive within 30 days.'});
call('2026-01-07 20:00', 'offers.accept', () => ({id: id('@off:bonus')}));
points('2026-02-02 04:15', 'offer-bonus', 5000, 'bonus', 'Bonus points of your accepted offer.', {offer_id: '@off:bonus'});
points('2026-02-12 04:00', 'welcome', 20000, 'bonus', 'Welcome bonus for 2,500.00 in purchases in the first 3 months.');
points('2026-02-26 04:00', 'dispute-credit', -89, 'adjustment', 'Points taken back for the credit on the Parcelbox Online charge of 6 January.');
event('2026-03-09 11:30', 'offer.issued', {offer_id: '@off:change-2026-03', kind: 'product_change', product_id: 'prd-everyday', accept_by: at('2026-03-31 23:59:59'),
  terms: 'Change to Brindle Everyday, a card with no annual fee and no transfer partners.'});
call('2026-03-12 19:10', 'offers.decline', () => ({id: id('@off:change-2026-03')}));
event('2026-04-01 11:00', 'offer.issued', {offer_id: '@off:spend-2026-04', kind: 'spend_credit', credit_amount: 150, spend_target: 2500, spend_days: 90,
  accept_by: at('2026-04-30 23:59:59'), terms: 'A statement credit of 150.00 after 2,500.00 in purchases within 90 days of accepting.'});
call('2026-04-03 19:00', 'offers.accept', () => ({id: id('@off:spend-2026-04')}));
call('2026-05-12 20:30', 'rewards.redeem', {id: ACCOUNT, points: 10000});
call('2026-06-03 21:15', 'rewards.transfer', {id: ACCOUNT, partner_id: 'skyway', points: 15000, member_name: 'Riley Hart'});
points('2026-06-20 04:00', 'missing-may', 150, 'adjustment', 'Points missing from the May statement were added.');
event('2026-07-06 10:30', 'offer.issued', {offer_id: '@off:credit-2026-07', kind: 'statement_credit', credit_amount: 40, accept_by: at('2026-07-31 23:59:59'),
  terms: 'A statement credit of 40.00 after you accept. The credit posts within 30 days.'});
event('2026-07-20 04:00', 'transaction.posted', {transaction_id: '@txn:spend-credit-2026-07', kind: 'credit', state: 'posted', amount: 150, offer_id: '@off:spend-2026-04',
  note: 'Credit for meeting the spending target of your offer.'});
points('2026-08-15 04:00', 'referral', 2500, 'bonus', 'Points for referring a friend who opened a Brindle card.');
call('2026-08-20 20:40', 'rewards.transfer', {id: ACCOUNT, partner_id: 'larch', points: 4000, member_name: 'Riley Hart'});
call('2026-09-15 21:05', 'rewards.transfer', {id: ACCOUNT, partner_id: 'meridian', points: 2500, member_name: 'Riley Hart'});
call('2026-10-14 19:55', 'rewards.redeem', {id: ACCOUNT, points: 5000});
event('2026-11-12 10:00', 'offer.issued', {offer_id: '@off:retain-credit', kind: 'statement_credit', group: 'retention-2026-11', credit_amount: 150, accept_by: at('2026-12-15 23:59:59'),
  terms: 'A statement credit of 150.00 to thank you for staying. The credit posts within 30 days of accepting.'});
event('2026-11-12 10:00', 'offer.issued', {offer_id: '@off:retain-change', kind: 'product_change', group: 'retention-2026-11', product_id: 'prd-everyday', accept_by: at('2026-12-15 23:59:59'),
  terms: 'Change to Brindle Everyday, a card with no annual fee and no transfer partners. If you change within 30 days of the annual fee, the fee is refunded.'});
call('2026-11-16 20:20', 'offers.accept', () => ({id: id('@off:retain-credit')}));
call('2026-11-18 21:00', 'preferences.update', {email_notices: false});
call('2026-11-24 08:00', 'preferences.update', {email_notices: true});
event('2026-12-03 15:20', 'offer.issued', {offer_id: '@off:spend-2026-12', kind: 'spend_credit', credit_amount: 200, spend_target: 2000, spend_days: 60,
  accept_by: at('2026-12-31 23:59:59'), terms: 'A statement credit of 200.00 after 2,000.00 in purchases within 60 days of accepting.'});

// Calls `visit` for every timestamp in a value, with its key.
function stamps(value, visit, key = '') {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) visit(value, key);
  else if (value && typeof value === 'object') for (const [inner, item] of Object.entries(value)) stamps(item, visit, Array.isArray(value) ? key : inner);
}
// What the plan promises of the fixture, and that each story holds together. A wrong count or a broken story fails the build.
function promised(data) {
  const now = Date.parse(CLOCK), made = counts(data, CLOCK), read = (name, args = {}) => plugin.handleTool(ctxAt(CLOCK), structuredClone(data), APP + '.' + name, args).result;
  const covers = (values, wanted) => assert.deepEqual([...new Set(values)].sort(), [...wanted].sort());
  for (const [name, count] of Object.entries(PLAN)) assert.deepEqual(made[name], count, 'Count of ' + name);
  covers(read('offers.list').items.map(o => o.state), ['available', 'enrolled', 'declined', 'expired', 'unavailable']);
  covers(data.offers.map(o => o.kind), ['statement_credit', 'spend_credit', 'bonus_points', 'product_change']);
  covers(data.disputes.map(d => d.state), ['open', 'withdrawn', 'resolved_for_me', 'resolved_for_merchant', 'closed_matched']);
  assert.deepEqual(data.statements.map(s => s.closing_at.slice(0, 10)), ['2025-11', ...MONTHS].map(closingOf), 'Statement closings');
  assert.deepEqual(data.transactions.filter(tx => tx.fee_type === 'annual').map(tx => tx.posted_at.slice(0, 7)), ['2025-11', '2026-11'], 'Annual fees');
  assert.ok(read('account.get').flags.includes('fee_refund_open'), 'fee_refund_open at the clock');
  for (const key of ['account_id', 'owner_person_id', 'issuer', 'products']) assert.deepEqual(data[key], base[key], 'The fixture keeps ' + key + ' of base.json');
  // A refund names a purchase at its own merchant and is not above it. A dispute's credit takes its purchase's merchant.
  const tx = new Map(data.transactions.map(x => [x.id, x]));
  for (const r of data.transactions.filter(x => x.kind === 'refund')) {
    const p = tx.get(r.relates_to);
    assert.ok(p.merchant === r.merchant && cents(r.amount) <= cents(p.amount) && Date.parse(r.posted_at) > Date.parse(p.posted_at), 'Refund ' + r.id + ' fits its purchase');
  }
  const firstMonths = data.transactions.filter(x => x.kind === 'purchase' && x.state === 'posted' && Date.parse(x.posted_at) < Date.parse(at('2026-02-11 00:00')));
  assert.ok(sum(firstMonths.map(x => cents(x.amount))) >= 250000, 'The welcome bonus was earned');
  for (const x of data.transactions.filter(t => t.dispute_id)) assert.equal(x.merchant, tx.get(x.relates_to).merchant, 'Merchant of ' + x.id);
  for (const d of data.disputes) assert.ok(cents(d.amount) <= cents(tx.get(d.transaction_id).amount), 'Dispute ' + d.id + ' is not above its purchase');
  stamps(data, value => assert.equal(time.iso(Date.parse(value), ZONE), value, 'UTC offset of ' + value));
  stamps(data, (value, key) => assert.ok(['due_at', 'posts_at', 'accept_by'].includes(key) || Date.parse(value) <= now, value + ' is after the clock'));
}

function build() {
  let data = replay(base, steps.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).map((step, n) => ({...step, event_id: step.event ? 'ev-br-' + pad(n + 1, 3) : undefined,
    request_id: step.call ? 'req-riley-' + pad(n + 1, 3) : undefined})));
  // A seed may hold any part of its history. The fixture keeps the 24 newest notifications and the activity rows from the time of the oldest one on.
  data.notifications = data.notifications.slice(-PLAN.notifications);
  data.activity = data.activity.filter(row => Date.parse(row.at) >= Date.parse(data.notifications[0].at));
  check(data, CLOCK, 'trimming');
  promised(data);
  return data;
}
if (require.main === module) {
  const data = build(), target = path.resolve(__dirname, '../fixtures/minimal.json'), text = JSON.stringify(data, null, 2) + '\n', checkOnly = process.argv.includes('--check');
  assert.ok(Buffer.byteLength(text) < 1048576, 'The fixture is under 1 MB');
  if (checkOnly && (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text)) {
    console.error('Generated file is out of date: fixtures/minimal.json');
    process.exitCode = 1;
  } else {
    if (!checkOnly) fs.writeFileSync(target, text);
    console.log((checkOnly ? 'Checked' : 'Wrote') + ' fixtures/minimal.json (' + data.transactions.length + ' transactions, ' + steps.length + ' steps, ' + Buffer.byteLength(text) + ' bytes).');
  }
}
module.exports = {build};
