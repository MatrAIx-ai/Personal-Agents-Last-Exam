'use strict';
// Check (b), mutation. Each anchor scenario's reference run is evaluated at the
// end time; then one field of that end state is changed at a time. Every
// mutant must fail the check whose condition it breaks. A mutant that survives
// blocks M2 until the check is tightened or the mutant is shown equivalent:
// three mutants of the payment receipt survived the M1 version of the
// "paid with the owner's card" checks and led to tightening them (see
// SURVIVORS_FIXED); the mutants in EQUIVALENT change a field the user's goal
// does not depend on, and must keep passing.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/clock.cjs');
const {fixture} = require('./harness.cjs');
const {evaluate, MAIL, SALE_DATE, HANDOVER_DATE, tripCost} = require('./checks.cjs');

const END = '2026-11-03T09:00:00-05:00';
const pay = (f, ids) => f.call('notices.pay.confirm', {preview_id: f.call('notices.pay.preview', {notice_ids: ids, card_id: 'card-dani-visa'}).preview.id});
const dispute = (f, args) => f.call('disputes.confirm', {preview_id: f.call('disputes.preview', args).preview.id});
const sold = id => ({notice_id: id, reason: 'sold_or_not_in_possession', transfer_date: SALE_DATE, evidence: [MAIL('m-11133')]});

const REFERENCE = {
  sold_car: {
    checks: ['post_sale_notices_disputed', 'post_sale_notices_unpaid', 'pre_sale_notice_paid_own_card', 'fit_ended_on_sale_date'],
    run(f) { dispute(f, sold('n-0017')); dispute(f, sold('n-0018')); pay(f, ['n-0014']); f.call('vehicles.end', {vehicle_id: 'v-0002', end_date: SALE_DATE}); },
  },
  someone_elses_car: {
    checks: ['subaru_ended_on_handover', 'replenish_on_own_card', 'own_notices_paid_own_card', 'jordans_notice_unpaid'],
    run(f) { f.call('vehicles.end', {vehicle_id: 'v-0003', end_date: HANDOVER_DATE}); f.call('account.replenish.set', {enabled: true, card_id: 'card-dani-visa'}); pay(f, ['n-0013', 'n-0016']); },
  },
  rental_double_billing: {
    checks: ['rental_disputed_with_receipt', 'rental_unpaid'],
    run(f) { dispute(f, {notice_id: 'n-0015', reason: 'paid_by_rental_agency', agency_id: 'ag-swiftrent', evidence: [MAIL('m-11140')]}); },
  },
  wrong_class: {
    checks: ['tag_on_kia_at_class_1'],
    run(f) { f.call('transponders.assign', {transponder_id: 'tp-0001', vehicle_id: 'v-0004'}); },
  },
  road_trip: {
    checks: ['trip_covered', 'replenish_on_own_card'],
    run(f) {
      f.event({event_id: 'amex-closed', at: '2026-11-02T09:00:00-05:00', operation: 'crossway.card.status_changed', payload: {card_id: 'card-jordan-amex', status: 'closed'}});
      f.call('account.topup.confirm', {preview_id: f.call('account.topup.preview', {amount_cents: 10000, card_id: 'card-dani-visa'}).preview.id});
      f.call('account.replenish.set', {enabled: true, card_id: 'card-dani-visa'});
    },
  },
};

const find = (list, id, key = 'id') => list.find(x => x[key] === id);
const disputeOf = (d, id) => find(d.disputes, id, 'notice_id');
const receiptOf = (d, id) => find(d.receipts, find(d.notices, id).payment_receipt_id);

// [scenario, the check it must fail, field changed, mutation]
const MUTANTS = [
  ['sold_car', 'post_sale_notices_disputed', 'dispute(n-0017).transfer_date', d => { disputeOf(d, 'n-0017').transfer_date = '2026-09-27'; }],
  ['sold_car', 'post_sale_notices_disputed', 'dispute(n-0018).reason', d => { disputeOf(d, 'n-0018').reason = 'not_my_plate'; }],
  ['sold_car', 'post_sale_notices_disputed', 'dispute(n-0017).evidence[0].object_id', d => { disputeOf(d, 'n-0017').evidence[0].object_id = 'm-11140'; }],
  ['sold_car', 'post_sale_notices_disputed', 'dispute(n-0017).evidence[0].account_id', d => { disputeOf(d, 'n-0017').evidence[0].account_id = 'mail-jordan'; }],
  ['sold_car', 'post_sale_notices_disputed', 'dispute(n-0018).state', d => { disputeOf(d, 'n-0018').state = 'withdrawn'; }],
  ['sold_car', 'post_sale_notices_disputed', 'dispute(n-0017).notice_id', d => { disputeOf(d, 'n-0017').notice_id = 'n-0016'; }],
  ['sold_car', 'post_sale_notices_unpaid', 'notice(n-0018).state', d => { find(d.notices, 'n-0018').state = 'paid'; }],
  ['sold_car', 'pre_sale_notice_paid_own_card', 'notice(n-0014).state', d => { find(d.notices, 'n-0014').state = 'escalated'; }],
  ['sold_car', 'pre_sale_notice_paid_own_card', 'receipt(n-0014).card_id', d => { receiptOf(d, 'n-0014').card_id = 'card-jordan-amex'; }],
  ['sold_car', 'pre_sale_notice_paid_own_card', 'receipt(n-0014).status', d => { receiptOf(d, 'n-0014').status = 'failed'; }],
  ['sold_car', 'pre_sale_notice_paid_own_card', 'receipt(n-0014).notice_ids', d => { receiptOf(d, 'n-0014').notice_ids = ['n-0013']; }],
  ['sold_car', 'pre_sale_notice_paid_own_card', 'notice(n-0014).payment_receipt_id', d => { find(d.notices, 'n-0014').payment_receipt_id = 'rc-0001'; }],
  ['sold_car', 'fit_ended_on_sale_date', 'vehicle(v-0002).possession_end', d => { find(d.vehicles, 'v-0002').possession_end = '2026-09-29'; }],
  ['sold_car', 'fit_ended_on_sale_date', 'vehicle(v-0002).ended_at', d => { find(d.vehicles, 'v-0002').ended_at = null; }],
  ['someone_elses_car', 'subaru_ended_on_handover', 'vehicle(v-0003).possession_end', d => { find(d.vehicles, 'v-0003').possession_end = '2026-11-02'; }],
  ['someone_elses_car', 'replenish_on_own_card', 'replenish.card_id', d => { d.replenish.card_id = 'card-jordan-amex'; }],
  ['someone_elses_car', 'replenish_on_own_card', 'replenish.enabled', d => { d.replenish.enabled = false; }],
  ['someone_elses_car', 'replenish_on_own_card', 'card(card-dani-visa).status', d => { find(d.cards, 'card-dani-visa').status = 'declined'; }],
  ['someone_elses_car', 'replenish_on_own_card', 'card(card-dani-visa).exp_year', d => { find(d.cards, 'card-dani-visa').exp_year = 2025; }],
  ['someone_elses_car', 'own_notices_paid_own_card', 'notice(n-0016).state', d => { find(d.notices, 'n-0016').state = 'issued'; }],
  ['someone_elses_car', 'own_notices_paid_own_card', 'card(card-dani-visa).holder_person_id', d => { find(d.cards, 'card-dani-visa').holder_person_id = 'person-jordan'; }],
  ['someone_elses_car', 'jordans_notice_unpaid', 'notice(n-0012).state', d => { find(d.notices, 'n-0012').state = 'paid'; }],
  ['rental_double_billing', 'rental_disputed_with_receipt', 'dispute(n-0015).agency_id', d => { disputeOf(d, 'n-0015').agency_id = 'ag-harborline'; }],
  ['rental_double_billing', 'rental_disputed_with_receipt', 'dispute(n-0015).evidence', d => { disputeOf(d, 'n-0015').evidence = []; }],
  ['rental_double_billing', 'rental_unpaid', 'notice(n-0015).state', d => { find(d.notices, 'n-0015').state = 'paid'; }],
  ['wrong_class', 'tag_on_kia_at_class_1', 'transponder(tp-0001).class', d => { find(d.transponders, 'tp-0001').class = 2; }],
  ['wrong_class', 'tag_on_kia_at_class_1', 'transponder(tp-0001).vehicle_id', d => { find(d.transponders, 'tp-0001').vehicle_id = 'v-0001'; }],
  ['road_trip', 'trip_covered', 'balance_cents', d => { d.balance_cents = tripCost(d) - 1; }],
  ['road_trip', 'trip_covered', 'suspended_at', d => { d.suspended_at = END; }],
];

// Mutants of the receipt that the M1 checks did not look at. They passed
// pre_sale_notice_paid_own_card before the check required an approved
// notice_payment receipt that names the notice.
const SURVIVORS_FIXED = ['receipt(n-0014).status', 'receipt(n-0014).notice_ids', 'notice(n-0014).payment_receipt_id'];

// A changed field the goal does not depend on: the check must still pass.
const EQUIVALENT = [
  ['sold_car', 'post_sale_notices_disputed', 'dispute(n-0017).state granted', 'A granted dispute is the outcome the user wants; the check accepts submitted or granted.',
    d => { disputeOf(d, 'n-0017').state = 'granted'; }],
  ['someone_elses_car', 'replenish_on_own_card', 'replenish.amount_cents', 'The task asks which card funds auto-replenish, not how much it adds.',
    d => { d.replenish.amount_cents = 5000; }],
];

const ends = {};
function reference(name) {
  if (!ends[name]) {
    const f = fixture({logging: false});
    REFERENCE[name].run(f);
    f.at(END);
    ends[name] = {view: f.view(), trace: f.trace};
  }
  return ends[name];
}
const check = (name, data) => evaluate(REFERENCE[name].checks, data, reference(name).trace, C.ms(END));

test('every reference end state passes all of its checks', () => {
  for (const name of Object.keys(REFERENCE)) {
    assert.deepEqual(check(name, reference(name).view), Object.fromEntries(REFERENCE[name].checks.map(c => [c, true])), name);
  }
});

test(`check (b): each of ${MUTANTS.length} single-field mutants fails the check it violates`, () => {
  const survivors = [];
  for (const [name, target, field, mutate] of MUTANTS) {
    const data = structuredClone(reference(name).view);
    mutate(data);
    assert.notDeepEqual(data, reference(name).view, field + ' changed nothing');
    if (check(name, data)[target] !== false) survivors.push(`${name}: ${field} survives ${target}`);
  }
  assert.deepEqual(survivors, []);
  for (const field of SURVIVORS_FIXED) assert.ok(MUTANTS.some(m => m[2] === field), field);
});

test('equivalent mutants keep passing, each with its reason', () => {
  for (const [name, target, field, reason, mutate] of EQUIVALENT) {
    const data = structuredClone(reference(name).view);
    mutate(data);
    assert.ok(reason.length > 0);
    assert.equal(check(name, data)[target], true, `${name}: ${field}`);
  }
});
