'use strict';
// Writes examples/task-data/seed.json, the seed of the acceptance tests. It replays August to early November 2026 of the account
// through the App's own hooks. The seed holds only this part of the history, so the App's own IDs are then numbered after
// the earlier history that the seed leaves out (payments from pay-0058, disputes from dsp-0007, notifications up to ntf-0056).
// Then the plan's example events and IDs fit it: dsp-0009, pay-0061, ntf-0057 and ntf-0058 come next.
// Run `node dev/build-task-seed.cjs` after a change, or `--check` to compare with the committed file. Never used at run time.
const fs = require('node:fs');
const path = require('node:path');
const {at, replay, check} = require('./replay.cjs');
const CLOCK = '2026-11-09T06:00:00-05:00';
const FILE = path.resolve(__dirname, '../examples/task-data/seed.json');
const BANK = 'Checking ending 4410';

const base = {
  account_id: 'brindle-riley', owner_person_id: 'person-riley',
  issuer: {name: 'Brindle Card', timezone: 'America/New_York', rules: {dispute_window_days: 60, fee_refund_days: 30, redeem_cents_per_point: 1, min_redeem_points: 1000}},
  products: [
    {id: 'prd-reserve', name: 'Brindle Reserve', annual_fee: 550, partners: [
      {id: 'skyway', name: 'Skyway Miles', ratio: 1, min_points: 1000, step: 1000},
      {id: 'larch', name: 'Larch Hotels Rewards', ratio: 2, min_points: 1000, step: 1000},
      {id: 'meridian', name: 'Meridian Rail Club', ratio: 1, min_points: 2000, step: 500}]},
    {id: 'prd-everyday', name: 'Brindle Everyday', annual_fee: null, partners: []}],
  account: {product_id: 'prd-reserve', credit_limit: 8000, state: 'open', opened_at: '2024-12-01T09:00:00-05:00', closed_at: null,
    autopay: {mode: 'off', source: BANK}, fee_refunds: [], history: []},
  preferences: {timezone: 'America/New_York', email_notices: true},
  statements: [], transactions: [], payments: [], disputes: [], offers: [], points_entries: [], notifications: [], activity: []
};

const steps = [];
const call = (local, name, args) => steps.push({at: at(local), call: name, args});
let events = 0;
const event = (local, name, payload) => steps.push({at: at(local), event: name, event_id: 'ev-br-' + String(++events).padStart(3, '0'), payload});
const buy = (local, id, merchant, amount) => event(local, 'transaction.posted', {transaction_id: id, kind: 'purchase', state: 'posted', amount, merchant});
// A statement closes at the end of the month. Its balance is the App's balance at the closing, and the minimum is 1 percent, at least 35.00.
const statement = (id, closing, issued, due) => event(issued, 'statement.issued', data => {
  const views = require('../src/views.cjs'), balance = views.balance(data, Date.parse(at(issued)), Date.parse(at(closing))) / 100;
  return {statement_id: id, closing_at: at(closing), statement_balance: balance, minimum_due: Math.min(balance, Math.max(35, Math.round(balance) / 100)), due_at: at(due)};
});
const points = (local, id, value, note, reason = 'earned') => event(local, 'points.adjusted', {entry_id: id, points: value, reason, note});

points('2026-08-01 04:00', 'pts-0180', 10220, 'Points from the statements before August 2026.', 'adjustment');
buy('2026-08-02 06:00', 'txn-0371', 'Ironworks Gym', 60);
buy('2026-08-05 06:00', 'txn-0372', 'Streamlet TV', 15.99);
buy('2026-08-09 03:10', 'txn-0373', 'Greenway Market', 112.4);
buy('2026-08-15 02:40', 'txn-0374', 'Harbor Lane Bistro', 64.2);
buy('2026-08-18 06:00', 'txn-0375', 'Kestrel Mobile', 85);
buy('2026-08-23 03:05', 'txn-0376', 'Greenway Market', 96.75);
buy('2026-08-25 02:30', 'txn-0377', 'Parcelbox Online', 149);
statement('stm-2026-08', '2026-08-31 23:59:59', '2026-09-01 02:00', '2026-09-26 17:00');
points('2026-09-02 04:00', 'pts-0181', 647, 'Points for the August statement.');
buy('2026-09-02 06:00', 'txn-0378', 'Ironworks Gym', 60);
call('2026-09-04 20:15', 'disputes.open', {id: 'txn-0377', amount: 149, reason: 'not_received', note: 'The parcel never arrived. The tracking page has not changed since 26 August.'});
buy('2026-09-05 06:00', 'txn-0379', 'Streamlet TV', 15.99);
event('2026-09-09 10:20', 'dispute.updated', {dispute_id: 'dsp-0001', status: 'open', provisional_credit: {transaction_id: 'txn-0380', amount: 149}, note: 'Temporary credit while we review.'});
buy('2026-09-13 03:15', 'txn-0381', 'Greenway Market', 78.3);
call('2026-09-15 19:40', 'payments.schedule', {id: 'brindle-riley', amount_type: 'statement_balance', pay_on: '2026-09-20', source: BANK});
buy('2026-09-18 06:00', 'txn-0382', 'Kestrel Mobile', 85);
buy('2026-09-20 02:50', 'txn-0383', 'Corner Slice', 42);
buy('2026-09-20 02:51', 'txn-0384', 'Corner Slice', 42);
call('2026-09-21 18:30', 'disputes.open', {id: 'txn-0384', amount: 42, reason: 'duplicate_charge', note: 'Corner Slice charged my dinner of 19 September twice.'});
event('2026-09-23 04:10', 'transaction.posted', {transaction_id: 'txn-0385', kind: 'refund', state: 'posted', amount: 42, merchant: 'Corner Slice', relates_to: 'txn-0384', note: 'Duplicate charge refunded'});
call('2026-09-23 21:05', 'disputes.withdraw', {id: 'dsp-0002', note: 'The restaurant refunded the second charge.'});
buy('2026-09-27 03:20', 'txn-0386', 'Greenway Market', 104.6);
event('2026-09-29 14:30', 'dispute.updated', {dispute_id: 'dsp-0001', status: 'resolved_for_me', note: 'The merchant could not show that the parcel was delivered.'});
statement('stm-2026-09', '2026-09-30 23:59:59', '2026-10-01 02:00', '2026-10-26 17:00');
points('2026-10-02 04:00', 'pts-0182', 427, 'Points for the September statement.');
buy('2026-10-02 06:00', 'txn-0387', 'Ironworks Gym', 60);
buy('2026-10-05 06:00', 'txn-0388', 'Streamlet TV', 15.99);
event('2026-10-06 11:30', 'offer.issued', {offer_id: 'off-0019', kind: 'statement_credit', credit_amount: 25, accept_by: at('2026-10-31 23:59:59'),
  terms: 'A statement credit of 25.00 after you accept. The credit posts within 30 days.'});
event('2026-10-06 11:30', 'offer.issued', {offer_id: 'off-0020', kind: 'product_change', product_id: 'prd-everyday', accept_by: at('2026-11-30 23:59:59'),
  terms: 'Change to Brindle Everyday, a card with no annual fee and no transfer partners.'});
call('2026-10-08 20:10', 'offers.decline', {id: 'off-0020'});
call('2026-10-10 19:25', 'payments.schedule', {id: 'brindle-riley', amount_type: 'fixed', amount: 236.89, pay_on: '2026-10-15', source: BANK});
buy('2026-10-12 03:00', 'txn-0389', 'Greenway Market', 131.2);
buy('2026-10-18 02:35', 'txn-0390', 'Harbor Lane Bistro', 58.4);
buy('2026-10-18 06:00', 'txn-0391', 'Kestrel Mobile', 85);
buy('2026-10-25 03:40', 'txn-0392', 'Larch & Stone Outfitters', 210);
buy('2026-10-28 03:10', 'txn-0393', 'Greenway Market', 88.6);
statement('stm-2026-10', '2026-10-31 23:59:59', '2026-11-01 02:00', '2026-11-26 17:00');
points('2026-11-02 04:00', 'pts-0183', 706, 'Points for the October statement.');
buy('2026-11-02 06:00', 'txn-0412', 'Ironworks Gym', 60);
buy('2026-11-04 02:45', 'txn-0413', 'Greenway Market', 120.35);
call('2026-11-04 21:10', 'payments.schedule', {id: 'brindle-riley', amount_type: 'statement_balance', pay_on: '2026-11-05', source: BANK});
buy('2026-11-05 03:30', 'txn-0414', 'Fernhill Hardware', 200);
buy('2026-11-05 06:00', 'txn-0415', 'Streamlet TV', 15.99);
buy('2026-11-07 02:30', 'txn-0416', 'Harbor Lane Bistro', 72.8);
buy('2026-11-07 04:15', 'txn-0417', 'Skyway Air', 486.4);
buy('2026-11-08 03:20', 'txn-0418', 'Parcelbox Online', 214.46);
buy('2026-11-08 03:50', 'txn-0419', 'Tidewater Pharmacy', 130);
event('2026-11-08 17:42', 'transaction.posted', {transaction_id: 'txn-0440', kind: 'purchase', state: 'pending', amount: 150, merchant: 'Northgate Fuel'});

// The seed leaves out the earlier history, so the App's own IDs continue its numbering.
const SHIFT = {pay: 57, dsp: 6};
function renumber(data) {
  SHIFT.ntf = 56 - data.notifications.length;
  const text = JSON.stringify(data).replace(/\b(pay|dsp|ntf)-(\d{4})\b/g, (all, prefix, n) => prefix + '-' + String(Number(n) + SHIFT[prefix]).padStart(4, '0'));
  return JSON.parse(text);
}
function build() {
  const data = renumber(replay(base, steps));
  check(data, CLOCK, 'renumbering');
  return data;
}
if (require.main === module) {
  const expected = JSON.stringify(build(), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(FILE) || fs.readFileSync(FILE, 'utf8') !== expected) { console.error('examples/task-data/seed.json is out of date.'); process.exitCode = 1; }
    else console.log('Checked examples/task-data/seed.json.');
  } else { fs.writeFileSync(FILE, expected); console.log('Wrote examples/task-data/seed.json.'); }
}
module.exports = {build, CLOCK};
