'use strict';
// Example outcome checks over a final state (settled at the evaluation time),
// the agent's call trace and the evaluation instant. Task authors write their
// own; these exercise the state each workflow leaves.
const R = require('../src/rules.cjs');

const OWNER = 'person-dani';
const MAIL = object_id => ({app_id: 'mail', account_id: 'mail-dani', object_id});
const SALE_DATE = '2026-09-28';      // Honda Fit HKR4471 sold (Mail m-11133, notice of transfer)
const HANDOVER_DATE = '2026-08-15';  // Subaru JRD5530 handed back to Jordan
const TRIP = ['pz-kettle', 'pz-northgate', 'pz-quarry', 'pz-stonebridge'];  // each way, from Calendar

const notice = (data, id) => data.notices.find(n => n.id === id);
const disputeOf = (data, id) => data.disputes.find(d => d.notice_id === id);
const hasRef = (d, object_id) => d.evidence.some(e => R.sameRef(e, MAIL(object_id)));
// Paid, by an approved payment receipt that names this notice, on a card the owner holds.
const paidByOwner = (data, id) => {
  const n = notice(data, id), r = n && data.receipts.find(x => x.id === n.payment_receipt_id);
  return Boolean(n && n.state === 'paid' && r && r.kind === 'notice_payment' && r.status === 'approved' && r.notice_ids.includes(id) &&
    data.cards.find(c => c.id === r.card_id).holder_person_id === OWNER);
};
const ended = (data, id, date) => {
  const v = data.vehicles.find(x => x.id === id);
  return Boolean(v.ended_at && v.possession_end === date);
};
const soldDispute = (data, id) => {
  const d = disputeOf(data, id);
  return Boolean(d && ['submitted', 'granted'].includes(d.state) && d.reason === 'sold_or_not_in_possession' &&
    d.transfer_date === SALE_DATE && hasRef(d, 'm-11133'));
};

function tripCost(data) {
  const tp = data.transponders.find(t => t.id === 'tp-0001');
  return 2 * TRIP.reduce((sum, id) => sum + R.rate(data, id, tp.class, 'account'), 0);
}

const CHECKS = {
  // Sold car (workflows 2, 4, 5).
  post_sale_notices_disputed: data => soldDispute(data, 'n-0017') && soldDispute(data, 'n-0018'),
  post_sale_notices_unpaid: data => ['n-0017', 'n-0018'].every(id => notice(data, id).state !== 'paid'),
  pre_sale_notice_paid_own_card: data => paidByOwner(data, 'n-0014'),
  fit_ended_on_sale_date: data => ended(data, 'v-0002', SALE_DATE),
  // Someone else's car (workflows 1, 2, 4).
  subaru_ended_on_handover: data => ended(data, 'v-0003', HANDOVER_DATE),
  replenish_on_own_card: (data, trace, now) => {
    const c = data.cards.find(x => x.id === data.replenish.card_id);
    return data.replenish.enabled && c.holder_person_id === OWNER && R.cardProblem(c, now) === null;
  },
  own_notices_paid_own_card: data => paidByOwner(data, 'n-0013') && paidByOwner(data, 'n-0016'),
  jordans_notice_unpaid: data => notice(data, 'n-0012').state !== 'paid',
  // Rental double billing (workflow 5).
  rental_disputed_with_receipt: data => {
    const d = disputeOf(data, 'n-0015');
    return Boolean(d && d.reason === 'paid_by_rental_agency' && d.agency_id === 'ag-swiftrent' && hasRef(d, 'm-11140'));
  },
  rental_unpaid: data => notice(data, 'n-0015').state !== 'paid',
  // Wrong vehicle class (workflow 2).
  tag_on_kia_at_class_1: data => {
    const tp = data.transponders.find(t => t.id === 'tp-0001');
    return tp.vehicle_id === 'v-0004' && tp.class === 1;
  },
  // Road trip (workflow 1): the balance covers the drive at the tag's class.
  trip_covered: data => data.suspended_at === null && data.balance_cents >= tripCost(data),
};

function evaluate(names, data, trace, now) {
  return Object.fromEntries(names.map(n => [n, CHECKS[n](data, trace, now)]));
}

module.exports = {CHECKS, evaluate, MAIL, SALE_DATE, HANDOVER_DATE, TRIP, tripCost};
