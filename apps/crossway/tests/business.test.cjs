'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const C = require('../src/clock.cjs');
const {fixture, seedFiles, SEEDS} = require('./harness.cjs');
const {evaluate, MAIL, SALE_DATE, HANDOVER_DATE, tripCost} = require('./checks.cjs');

const code = c => e => e.code === c;
function unchanged(f, fn, c, pattern) {
  const before = f.data;
  assert.throws(fn, e => e.code === c && (!pattern || pattern.test(e.message)), c);
  assert.deepEqual(f.data, before);
}
const notice = (data, id) => data.notices.find(n => n.id === id);
const pay = (f, ids, card_id) => {
  const p = f.call('notices.pay.preview', {notice_ids: ids, ...(card_id ? {card_id} : {})}).preview;
  return f.call('notices.pay.confirm', {preview_id: p.id});
};
const dispute = (f, args) => f.call('disputes.confirm', {preview_id: f.call('disputes.preview', args).preview.id});
const soldDispute = id => ({notice_id: id, reason: 'sold_or_not_in_possession', transfer_date: SALE_DATE, evidence: [MAIL('m-11133')]});
const toll = (f, at, payload) => f.event({event_id: 'ev-' + payload.toll_id, at, operation: 'crossway.toll.posted', payload});
// A neutral committed write: re-saves the auto-replenish rule unchanged.
const touch = f => f.call('account.replenish.set', {enabled: true});
const strip = data => { const d = structuredClone(data); d.replenish.updated_at = null; return d; };

// ---- Workflow 1: account, balance, auto-replenish and statements -------------

test('reads are side-effect free and show cards, the replenish rule and the clock rule', () => {
  const f = fixture(), before = f.data;
  const a = f.call('account.get').account;
  assert.deepEqual([a.status, a.balance_cents, a.replenish.card_id], ['active', 1875, 'card-jordan-amex']);
  assert.equal(a.replenish.card.holder_name, 'Jordan Albright');  // the replenish card is someone else's
  assert.deepEqual(a.cards.map(c => [c.id, c.expired]), [['card-dani-visa', false], ['card-dani-mc', true], ['card-jordan-amex', false]]);
  const rules = f.call('policies.get').policies.rules.join(' ');
  assert.match(rules, /does not move its clock/);
  assert.match(rules, /env\.advance_time/);
  for (const op of ['account.statements', 'vehicles.list', 'transponders.list', 'tolls.list', 'notices.list', 'disputes.reasons']) f.call(op, {});
  assert.equal(f.call('tolls.list', {limit: 5}).tolls.length, 5);
  f.at('2027-01-15T09:00:00-05:00');
  f.call('notices.list', {});  // computes escalations on a copy
  assert.deepEqual(f.data, before);
});

test('top-up: preview, confirm, receipt; range, card and preview errors change nothing', () => {
  const f = fixture();
  unchanged(f, () => f.call('account.topup.preview', {amount_cents: 500, card_id: 'card-dani-visa'}), 'amount_out_of_range');
  unchanged(f, () => f.call('account.topup.preview', {amount_cents: 5000, card_id: 'card-dani-mc'}), 'card_expired');
  const p = f.call('account.topup.preview', {amount_cents: 5000, card_id: 'card-dani-visa'}).preview;
  assert.equal(p.balance_after_cents, 6875);
  const out = f.call('account.topup.confirm', {preview_id: p.id});
  assert.deepEqual([out.receipt.kind, out.receipt.amount_cents, out.account.balance_cents], ['topup', 5000, 6875]);
  unchanged(f, () => f.call('account.topup.confirm', {preview_id: p.id}), 'preview_used');
  const q = f.call('account.topup.preview', {amount_cents: 2000, card_id: 'card-dani-visa'}).preview;
  f.at('2026-11-02T09:15:00-05:00');
  unchanged(f, () => f.call('account.topup.confirm', {preview_id: q.id}), 'preview_expired');
  f.event({event_id: 'c', at: '2026-11-02T10:00:00-05:00', operation: 'crossway.card.status_changed', payload: {card_id: 'card-dani-visa', status: 'declined'}});
  unchanged(f, () => f.call('account.topup.preview', {amount_cents: 2000, card_id: 'card-dani-visa'}), 'card_declined');
  assert.equal(f.data.outgoing.at(-1).kind, 'receipt');
});

test('auto-replenish: a debit under the threshold charges the rule card once; set validates range and card', () => {
  const f = fixture();
  toll(f, '2026-11-02T17:10:00-05:00', {toll_id: 't-9001', plaza_id: 'pz-harbor', read: 'transponder', plate: 'KLM2210', transponder_id: 'tp-0001', class: 1});
  const t = f.data.tolls.at(-1);
  assert.deepEqual([t.class_seen, t.class_charged, t.rate, t.amount_cents], [1, 2, 'account', 850]);  // the moved tag charges its old class
  assert.equal(f.data.balance_cents, 1875 - 850 + 4000);
  assert.equal(f.data.receipts.at(-1).card_id, 'card-jordan-amex');
  unchanged(f, () => f.call('account.replenish.set', {enabled: true, amount_cents: 1000}), 'amount_out_of_range');
  unchanged(f, () => f.call('account.replenish.set', {enabled: true, card_id: 'card-dani-mc'}), 'card_expired');
  const r = f.call('account.replenish.set', {enabled: true, card_id: 'card-dani-visa', amount_cents: 5000, threshold_cents: 2000}).replenish;
  assert.deepEqual([r.card_id, r.card.holder_name, r.amount_cents], ['card-dani-visa', 'Dani Reyes', 5000]);
  f.call('account.replenish.set', {enabled: false});
  assert.equal(f.data.replenish.enabled, false);
});

test('two failed replenish attempts suspend the account; suspended reads become notices; a top-up lifts it', () => {
  const f = fixture();
  f.event({event_id: 'c', at: '2026-11-02T10:00:00-05:00', operation: 'crossway.card.status_changed', payload: {card_id: 'card-jordan-amex', status: 'closed'}});
  toll(f, '2026-11-02T17:10:00-05:00', {toll_id: 't-9001', plaza_id: 'pz-harbor', read: 'transponder', plate: 'KLM2210', transponder_id: 'tp-0001', class: 1});
  assert.deepEqual(f.data.outgoing.map(o => o.kind), ['replenish_failed', 'balance_low']);
  assert.equal(f.call('account.get').account.status, 'low_balance');
  toll(f, '2026-11-03T07:20:00-05:00', {toll_id: 't-9002', plaza_id: 'pz-harbor', read: 'transponder', plate: 'KLM2210', transponder_id: 'tp-0001', class: 1});
  assert.deepEqual(f.data.outgoing.slice(2).filter(o => o.object_type !== 'notice').map(o => o.kind), ['replenish_failed', 'account_suspended']);
  assert.equal(f.data.balance_cents, 175);
  toll(f, '2026-11-03T17:20:00-05:00', {toll_id: 't-9003', plaza_id: 'pz-harbor', read: 'transponder', plate: 'KLM2210', transponder_id: 'tp-0001', class: 1});
  const t = f.data.tolls.at(-1);
  assert.deepEqual([t.disposition, t.rate, t.amount_cents], ['noticed', 'mail', 1400]);
  assert.equal(f.data.balance_cents, 175);
  f.call('account.topup.confirm', {preview_id: f.call('account.topup.preview', {amount_cents: 5000, card_id: 'card-dani-visa'}).preview.id});
  assert.deepEqual([f.call('account.get').account.status, f.data.replenish.consecutive_failures], ['active', 0]);
});

test('a balance below zero suspends at once', () => {
  const f = fixture();
  f.call('account.replenish.set', {enabled: false});
  toll(f, '2026-11-02T17:10:00-05:00', {toll_id: 't-9001', plaza_id: 'pz-lantern', read: 'transponder', plate: 'KLM2210', transponder_id: 'tp-0001', class: 1});
  assert.equal(f.data.balance_cents, -25);
  assert.equal(f.call('account.get').account.status, 'suspended');
});

test('a monthly statement is issued at 00:00 on the 1st, computed on read and stored by the next write', () => {
  const f = fixture();
  f.at('2026-12-01T00:00:00-05:00');
  const s = f.call('account.statements', {period: '2026-11'}).statements;
  assert.deepEqual(s.map(x => [x.issued_at, x.opening_balance_cents]), [['2026-12-01T00:00:00-05:00', 1875]]);
  assert.equal(f.data.statements.at(-1).period, '2026-10');
  touch(f);
  assert.equal(f.data.statements.at(-1).period, '2026-11');
  assert.equal(f.data.outgoing.find(o => o.kind === 'statement').created_at, '2026-12-01T00:00:00-05:00');
});

// ---- Workflow 2: vehicles and transponders ----------------------------------

test('vehicles.add: plate, interval and temporary-plate rules', () => {
  const f = fixture();
  unchanged(f, () => f.call('vehicles.add', {plate: 'MRT 6620', class: 1, label: 'Loaner'}), 'plate_on_another_account');
  unchanged(f, () => f.call('vehicles.add', {plate: 'hkr-4471', class: 1, label: 'Fit again'}), 'plate_already_listed');
  unchanged(f, () => f.call('vehicles.add', {plate: 'RNT1122', class: 1, label: 'Rental', temporary: true}), 'missing_required_field');
  unchanged(f, () => f.call('vehicles.add', {plate: 'RNT1122', class: 1, label: 'Rental', temporary: true, possession_end: '2026-12-15'}), 'temp_too_long');
  unchanged(f, () => f.call('vehicles.add', {plate: 'RNT1122', class: 1, label: 'Rental', temporary: true, possession_end: '2026-11-01'}), 'end_before_start');
  const v = f.call('vehicles.add', {plate: 'rnt 1122', class: 1, label: 'Rental', temporary: true, possession_end: '2026-11-05', rental_agency_id: 'ag-harborline'}).vehicle;
  assert.deepEqual([v.id, v.plate, v.possession_start, v.status], ['v-0006', 'RNT1122', '2026-11-02', 'active']);
});

test('ending possession: today by default, never in the future; update corrects the date; later reads are unmatched', () => {
  const f = fixture();
  unchanged(f, () => f.call('vehicles.end', {vehicle_id: 'v-0002', end_date: '2026-11-05'}), 'end_in_future');
  unchanged(f, () => f.call('vehicles.end', {vehicle_id: 'v-0002', end_date: '2024-12-01'}), 'end_before_start');
  const v = f.call('vehicles.end', {vehicle_id: 'v-0002'}).vehicle;
  assert.deepEqual([v.possession_end, v.status, v.transponder_id], ['2026-11-02', 'ended', null]);
  unchanged(f, () => f.call('vehicles.end', {vehicle_id: 'v-0002'}), 'invalid_state');
  unchanged(f, () => f.call('vehicles.update', {vehicle_id: 'v-0002', possession_end: '2026-11-03'}), 'end_in_future');
  unchanged(f, () => f.call('vehicles.update', {vehicle_id: 'v-0001', possession_end: '2026-10-01'}), 'invalid_state');
  assert.equal(f.call('vehicles.update', {vehicle_id: 'v-0002', possession_end: SALE_DATE}).vehicle.possession_end, SALE_DATE);
  f.event(require('../examples/scenario.json'));
  assert.equal(f.data.tolls.at(-1).disposition, 'unmatched');
  assert.equal(notice(f.data, 'n-0017').state, 'issued');  // notices already issued need a dispute
});

test('without ending possession, a sold car keeps drawing notices', () => {
  const f = fixture();
  f.event(require('../examples/scenario.json'));
  const n = f.data.notices.at(-1);
  assert.deepEqual([n.id, n.plate, n.vehicle_id, n.toll_cents, n.due_date], ['n-0019', 'HKR4471', 'v-0002', 1075, '2026-12-03']);
});

test('a temporary plate ends on the clock with a notice, or early through vehicles.end', () => {
  const f = fixture();
  const a = f.call('vehicles.add', {plate: 'RNT1122', class: 1, label: 'Rental', temporary: true, possession_end: '2026-11-05'}).vehicle;
  const b = f.call('vehicles.add', {plate: 'RNT3344', class: 1, label: 'Rental 2', temporary: true, possession_end: '2026-11-20'}).vehicle;
  f.at('2026-11-06T00:00:00-05:00');
  assert.equal(f.call('vehicles.list', {}).vehicles.find(v => v.id === a.id).ended_at, '2026-11-06T00:00:00-05:00');
  f.call('vehicles.end', {vehicle_id: b.id});
  assert.deepEqual(f.data.vehicles.find(v => v.id === b.id).possession_end, '2026-11-06');
  const out = f.data.outgoing.find(o => o.kind === 'temp_plate_expired');
  assert.deepEqual([out.object_id, out.created_at], [a.id, '2026-11-06T00:00:00-05:00']);
});

test('transponders.assign sets the class to the target vehicle\'s; one transponder per vehicle', () => {
  const f = fixture();
  unchanged(f, () => f.call('transponders.assign', {transponder_id: 'tp-0002', vehicle_id: 'v-0001'}), 'transponder_in_use');
  unchanged(f, () => f.call('transponders.assign', {transponder_id: 'tp-0001', vehicle_id: 'v-0005'}), 'invalid_state');
  const tp = f.call('transponders.assign', {transponder_id: 'tp-0001', vehicle_id: 'v-0004'}).transponder;
  assert.deepEqual([tp.class, tp.vehicle.plate, tp.class_matches_vehicle], [1, 'KLM2210', true]);
  toll(f, '2026-11-02T17:10:00-05:00', {toll_id: 't-9001', plaza_id: 'pz-harbor', read: 'transponder', plate: 'KLM2210', transponder_id: 'tp-0001', class: 1});
  assert.deepEqual([f.data.tolls.at(-1).class_charged, f.data.tolls.at(-1).amount_cents], [1, 425]);
});

// ---- Workflow 3: toll activity -----------------------------------------------

test('plate-only reads of a listed plate are noticed at the mail rate; unknown plates are unmatched', () => {
  const f = fixture();
  toll(f, '2026-11-02T12:00:00-05:00', {toll_id: 't-9001', plaza_id: 'pz-harbor', read: 'plate', plate: 'KLM2210', transponder_id: null, class: 1});
  toll(f, '2026-11-02T12:05:00-05:00', {toll_id: 't-9002', plaza_id: 'pz-harbor', read: 'plate', plate: 'ZZZ999', transponder_id: null, class: 1});
  const [a, b] = f.data.tolls.slice(-2);
  assert.deepEqual([a.disposition, a.rate, a.amount_cents, a.vehicle_id], ['noticed', 'mail', 700, 'v-0004']);
  assert.deepEqual([b.disposition, b.amount_cents, b.notice_id], ['unmatched', 0, null]);
  const listed = f.call('tolls.list', {plate: 'KLM2210', disposition: 'noticed'}).tolls;
  assert.equal(listed[0].id, 't-9001');
});

// ---- Workflow 4: violation notices -------------------------------------------

test('pay preview names the one ineligible notice and rejects the batch; the default card is the replenish card', () => {
  const f = fixture();
  unchanged(f, () => f.call('notices.pay.preview', {notice_ids: ['n-0016', 'n-0001']}), 'in_collections', /n-0001/);
  unchanged(f, () => f.call('notices.pay.preview', {notice_ids: ['n-0003']}), 'notice_dismissed');
  unchanged(f, () => f.call('notices.pay.preview', {notice_ids: ['n-0002']}), 'already_paid');
  const p = f.call('notices.pay.preview', {notice_ids: ['n-0013', 'n-0016']}).preview;
  assert.equal(p.card.holder_name, 'Jordan Albright');
  assert.equal(p.final_text, 'Payment is final and closes the right to dispute.');
  assert.deepEqual(p.lines.map(l => [l.plate, l.toll_date, l.amount_cents]), [['KLM2210', '2026-09-12', 2950], ['KLM2210', '2026-10-06', 700]]);
  assert.equal(p.total_cents, 3650);
  const out = f.call('notices.pay.confirm', {preview_id: p.id});
  assert.deepEqual(out.notices.map(n => n.state), ['paid', 'paid']);
  unchanged(f, () => f.call('disputes.preview', {notice_id: 'n-0016', reason: 'not_my_plate', explanation: 'x'}), 'closed_by_payment');
});

test('one clock advance crossing several deadlines commits them in (due time, ID) order, each stamped at its own deadline', () => {
  const f = fixture();
  f.at('2027-01-15T09:00:00-05:00');
  touch(f);
  const n = notice(f.data, 'n-0017');
  assert.deepEqual(n.history.map(h => [h.action, h.at]), [
    ['issued', '2026-10-11T07:42:00-04:00'],
    ['escalated', '2026-11-10T00:00:00-05:00'],
    ['sent_to_collections', '2026-12-10T00:00:00-05:00'],
  ]);
  assert.deepEqual([n.state, n.escalated_at, n.collections_at, n.late_fee_cents], ['collections', '2026-11-10T00:00:00-05:00', '2026-12-10T00:00:00-05:00', 2500]);
  // Every open notice and both month ends were crossed by the same advance, in (due time, ID) order.
  assert.deepEqual(f.data.outgoing.map(o => [o.created_at, o.kind, o.object_id]), [
    ['2026-11-03T00:00:00-05:00', 'notice_escalated', 'n-0015'],
    ['2026-11-04T00:00:00-05:00', 'notice_collections', 'n-0012'],
    ['2026-11-05T00:00:00-05:00', 'notice_escalated', 'n-0016'],
    ['2026-11-10T00:00:00-05:00', 'notice_escalated', 'n-0017'],
    ['2026-11-11T00:00:00-05:00', 'notice_collections', 'n-0013'],
    ['2026-11-18T00:00:00-05:00', 'notice_escalated', 'n-0018'],
    ['2026-11-19T00:00:00-05:00', 'notice_collections', 'n-0014'],
    ['2026-12-01T00:00:00-05:00', 'statement', 'st-2026-11'],
    ['2026-12-03T00:00:00-05:00', 'notice_collections', 'n-0015'],
    ['2026-12-05T00:00:00-05:00', 'notice_collections', 'n-0016'],
    ['2026-12-10T00:00:00-05:00', 'notice_collections', 'n-0017'],
    ['2026-12-18T00:00:00-05:00', 'notice_collections', 'n-0018'],
    ['2027-01-01T00:00:00-05:00', 'statement', 'st-2026-12'],
  ]);
  assert.ok(f.data.outgoing.every(o => o.message.time === o.created_at));
  assert.match(f.data.outgoing[3].message.data.content.title, /n-0017 is overdue: \$35\.75 now due by Dec 10/);
  // Deadlines at the same instant commit in ID order.
  const g = fixture();
  toll(g, '2026-11-02T12:00:00-05:00', {toll_id: 't-9002', plaza_id: 'pz-harbor', read: 'plate', plate: 'KLM2210', transponder_id: null, class: 1});
  toll(g, '2026-11-02T12:05:00-05:00', {toll_id: 't-9001', plaza_id: 'pz-ferry', read: 'plate', plate: 'KLM2210', transponder_id: null, class: 1});
  g.at('2026-12-02T08:00:00-05:00');
  touch(g);
  assert.deepEqual(g.data.outgoing.filter(o => o.created_at === '2026-12-02T00:00:00-05:00').map(o => o.object_id), ['n-0019', 'n-0020']);
  assert.deepEqual(f.data.statements.slice(-2).map(s => s.period), ['2026-11', '2026-12']);
});

test('single-jump and stepwise advances give the same records', () => {
  const end = '2027-01-15T09:00:00-05:00';
  const jump = fixture();
  jump.at(end);
  touch(jump);
  const steps = fixture();
  for (const t of ['2026-11-03T00:00:00-05:00', '2026-11-04T12:00:00-05:00', '2026-11-10T00:00:00-05:00', '2026-11-30T23:59:00-05:00',
    '2026-12-01T00:00:00-05:00', '2026-12-10T08:00:00-05:00', '2026-12-31T12:00:00-05:00']) {
    steps.at(t);
    touch(steps);
  }
  steps.at(end);
  touch(steps);
  assert.deepEqual(strip(steps.data), strip(jump.data));
  // Advancing without any write leaves stored data alone; the settled view matches too.
  const idle = fixture();
  idle.at(end);
  assert.deepEqual(strip(idle.view()), strip(jump.view()));
});

test('a payment whose preview and confirm straddle an escalation returns amount_changed and charges nothing', () => {
  const f = fixture();
  f.at('2026-11-09T23:50:00-05:00');
  const p = f.call('notices.pay.preview', {notice_ids: ['n-0017'], card_id: 'card-dani-visa'}).preview;
  assert.equal(p.total_cents, 1075);
  f.at('2026-11-10T00:04:00-05:00');
  const receipts = f.data.receipts.length;
  unchanged(f, () => f.call('notices.pay.confirm', {preview_id: p.id}), 'amount_changed', /\$35\.75/);
  assert.equal(f.data.receipts.length, receipts);
  const q = f.call('notices.pay.preview', {notice_ids: ['n-0017'], card_id: 'card-dani-visa'}).preview;
  assert.equal(q.total_cents, 3575);
  f.call('notices.pay.confirm', {preview_id: q.id});
  assert.equal(notice(f.data, 'n-0017').state, 'paid');
  // Without a deadline in between, the same preview confirms.
  const g = fixture();
  g.at('2026-11-09T23:44:00-05:00');
  const r = g.call('notices.pay.preview', {notice_ids: ['n-0017'], card_id: 'card-dani-visa'}).preview;
  g.at('2026-11-09T23:58:00-05:00');
  assert.equal(g.call('notices.pay.confirm', {preview_id: r.id}).receipt.amount_cents, 1075);
});

// ---- Workflow 5: disputes ------------------------------------------------------

test('dispute preview: required fields, evidence shape, transfer date, window and one dispute per notice', () => {
  const f = fixture();
  unchanged(f, () => f.call('disputes.preview', {notice_id: 'n-0017', reason: 'sold_or_not_in_possession', transfer_date: SALE_DATE}), 'missing_required_field', /evidence/);
  unchanged(f, () => f.call('disputes.preview', {notice_id: 'n-0015', reason: 'paid_by_rental_agency', evidence: [MAIL('m-11140')]}), 'missing_required_field', /agency_id/);
  unchanged(f, () => f.call('disputes.preview', {...soldDispute('n-0017'), evidence: [{app_id: 'mail', object_id: 'm-11133'}]}), 'invalid_evidence_ref');
  unchanged(f, () => f.call('disputes.preview', soldDispute('n-0014')), 'toll_before_transfer');
  unchanged(f, () => f.call('disputes.preview', {notice_id: 'n-0001', reason: 'not_my_plate', explanation: 'x'}), 'dispute_window_closed');
  const p = f.call('disputes.preview', soldDispute('n-0017')).preview;
  assert.match(p.rules.join(' '), /window closes 2026-11-25/);
  f.call('disputes.confirm', {preview_id: p.id});
  unchanged(f, () => f.call('disputes.preview', {notice_id: 'n-0017', reason: 'not_my_plate', explanation: 'x'}), 'dispute_exists');
  unchanged(f, () => f.call('notices.pay.preview', {notice_ids: ['n-0018', 'n-0017']}), 'notice_in_dispute', /n-0017/);
  f.at('2026-11-04T00:00:00-05:00');  // 45 days after n-0014 was issued on 2026-09-20
  unchanged(f, () => f.call('disputes.preview', {notice_id: 'n-0014', reason: 'not_my_plate', explanation: 'x'}), 'dispute_window_closed');
});

test('a dispute freezes fees and due date; a matching decision grants it and dismisses the notice at zero', () => {
  const f = fixture();
  dispute(f, soldDispute('n-0017'));
  f.at('2026-12-20T10:00:00-05:00');
  assert.deepEqual([notice(f.view(), 'n-0017').state, notice(f.view(), 'n-0017').late_fee_cents], ['disputed', 0]);
  f.event({event_id: 'd1', at: '2026-12-20T10:00:00-05:00', operation: 'crossway.dispute.decided',
    payload: {notice_id: 'n-0017', grant_if: [{reason: 'sold_or_not_in_possession', evidence: [MAIL('m-11133')]}]}});
  const n = f.call('notices.get', {notice_id: 'n-0017'});
  assert.deepEqual([n.notice.state, n.notice.amount_due_cents, n.dispute.state], ['dismissed', 0, 'granted']);
  assert.equal(f.data.outgoing.at(-1).kind, 'dispute_decided');
});

test('a denied dispute returns the notice to its prior state, due 14 days after the decision', () => {
  const f = fixture();
  dispute(f, {notice_id: 'n-0014', reason: 'not_my_plate', explanation: 'Not my trip.'});
  f.event({event_id: 'd1', at: '2026-12-01T10:00:00-05:00', operation: 'crossway.dispute.decided',
    payload: {notice_id: 'n-0014', grant_if: [{reason: 'sold_or_not_in_possession', evidence: []}]}});
  const n = notice(f.data, 'n-0014');
  assert.deepEqual([n.state, n.due_date, n.late_fee_cents], ['escalated', '2026-12-15', 2500]);
  assert.equal(f.data.dispute_decisions.at(-1).outcome, 'denied');
});

test('withdrawal returns the days that remained; the notice cannot be disputed again; a decision with no target is recorded', () => {
  const f = fixture();
  const d = dispute(f, soldDispute('n-0017')).dispute;
  assert.equal(d.remaining_days, 8);  // due 2026-11-10, disputed 2026-11-02
  f.at('2026-11-20T09:00:00-05:00');
  const out = f.call('disputes.withdraw', {dispute_id: d.id});
  assert.deepEqual([out.notice.state, out.notice.due_date, out.dispute.state], ['issued', '2026-11-28', 'withdrawn']);
  unchanged(f, () => f.call('disputes.withdraw', {dispute_id: d.id}), 'invalid_state');
  unchanged(f, () => f.call('disputes.preview', soldDispute('n-0017')), 'dispute_exists');
  f.event({event_id: 'd2', at: '2026-11-21T09:00:00-05:00', operation: 'crossway.dispute.decided', payload: {notice_id: 'n-0017', grant_if: []}});
  assert.deepEqual(f.data.dispute_decisions.at(-1).outcome, 'no_target');
});

// ---- Events ----------------------------------------------------------------

test('events naming unknown records or not applicable in the current state are rejected and change nothing', () => {
  const f = fixture();
  const bad = [
    {operation: 'crossway.toll.posted', payload: {toll_id: 't-0001', plaza_id: 'pz-harbor', read: 'plate', plate: 'KLM2210', transponder_id: null, class: 1}},
    {operation: 'crossway.toll.posted', payload: {toll_id: 't-9001', plaza_id: 'pz-nowhere', read: 'plate', plate: 'KLM2210', transponder_id: null, class: 1}},
    {operation: 'crossway.toll.posted', payload: {toll_id: 't-9001', plaza_id: 'pz-harbor', read: 'plate', plate: 'KLM2210', transponder_id: 'tp-0001', class: 1}},
    {operation: 'crossway.toll.posted', payload: {toll_id: 't-9001', plaza_id: 'pz-harbor', read: 'plate', plate: 'KLM2210', transponder_id: null, class: 7}},
    {operation: 'crossway.card.status_changed', payload: {card_id: 'card-dani-visa', status: 'active'}},
    {operation: 'crossway.card.status_changed', payload: {card_id: 'card-nobody', status: 'closed'}},
    {operation: 'crossway.dispute.decided', payload: {notice_id: 'n-9999', grant_if: []}},
  ];
  for (const e of bad) unchanged(f, () => f.event({event_id: 'x', at: '2026-11-02T10:00:00-05:00', ...e}), 'invalid_event');
  assert.throws(() => f.event({event_id: 'x', at: '2026-11-01T10:00:00-05:00', operation: 'crossway.card.status_changed', payload: {card_id: 'card-dani-visa', status: 'closed'}}), /backwards/);
  const broken = f.data;
  broken.balance_cents += 1;
  assert.throws(() => plugin.validateSeed(f.ctx, broken), /balance does not match/);
});

test('diagnostics are optional and never change business results', () => {
  const on = fixture(), off = fixture({logging: false});
  on.event(require('../examples/scenario.json'));
  off.event(require('../examples/scenario.json'));
  assert.deepEqual(on.data, off.data);
  assert.ok(on.logs.length);
});

test('authority time follows US Eastern rules without the host time zone', () => {
  assert.equal(C.stamp(C.midnight('2026-11-01')), '2026-11-01T00:00:00-04:00');
  assert.equal(C.stamp(C.midnight('2026-11-02')), '2026-11-02T00:00:00-05:00');
  assert.equal(C.stamp(C.midnight('2026-03-08')), '2026-03-08T00:00:00-05:00');
  assert.equal(C.stamp(C.midnight('2026-03-09')), '2026-03-09T00:00:00-04:00');
  assert.equal(C.localDate(Date.parse('2026-11-10T04:59:00Z')), '2026-11-09');
});

// ---- Check (a): anchor runs over the example outcome checks -----------------

const SOLD = {
  dispute(f) { dispute(f, soldDispute('n-0017')); dispute(f, soldDispute('n-0018')); },
  payEarlier(f) { pay(f, ['n-0014'], 'card-dani-visa'); },
  end(f) { f.call('vehicles.end', {vehicle_id: 'v-0002', end_date: SALE_DATE}); },
};
const OTHER = {
  end(f) { f.call('vehicles.end', {vehicle_id: 'v-0003', end_date: HANDOVER_DATE}); },
  card(f) { f.call('account.replenish.set', {enabled: true, card_id: 'card-dani-visa'}); },
  pay(f) { pay(f, ['n-0013', 'n-0016'], 'card-dani-visa'); },
};
const topup = (f, cents) => f.call('account.topup.confirm', {preview_id: f.call('account.topup.preview', {amount_cents: cents, card_id: 'card-dani-visa'}).preview.id});

const SCENARIOS = {
  sold_car: {
    checks: ['post_sale_notices_disputed', 'post_sale_notices_unpaid', 'pre_sale_notice_paid_own_card', 'fit_ended_on_sale_date'],
    writes: ['post_sale_notices_disputed', 'pre_sale_notice_paid_own_card', 'fit_ended_on_sale_date'],
    reference(f) { SOLD.dispute(f); SOLD.payEarlier(f); SOLD.end(f); },
    variants: {other_order(f) { SOLD.end(f); SOLD.payEarlier(f); dispute(f, soldDispute('n-0018')); dispute(f, soldDispute('n-0017')); }},
    wrong: {
      batch_pay_everything(f) { pay(f, ['n-0014', 'n-0017', 'n-0018'], 'card-dani-visa'); SOLD.end(f); },
      dispute_everything(f) { SOLD.dispute(f); dispute(f, {notice_id: 'n-0014', reason: 'not_my_plate', explanation: 'Sold the car.'}); SOLD.end(f); },
      end_possession_today(f) { SOLD.dispute(f); SOLD.payEarlier(f); f.call('vehicles.end', {vehicle_id: 'v-0002'}); },
      pay_with_default_card(f) { SOLD.dispute(f); pay(f, ['n-0014']); SOLD.end(f); },
    },
    fails: {
      batch_pay_everything: ['post_sale_notices_disputed', 'post_sale_notices_unpaid'],
      dispute_everything: ['pre_sale_notice_paid_own_card'],
      end_possession_today: ['fit_ended_on_sale_date'],
      pay_with_default_card: ['pre_sale_notice_paid_own_card'],
    },
  },
  someone_elses_car: {
    checks: ['subaru_ended_on_handover', 'replenish_on_own_card', 'own_notices_paid_own_card', 'jordans_notice_unpaid'],
    writes: ['subaru_ended_on_handover', 'replenish_on_own_card', 'own_notices_paid_own_card'],
    reference(f) { OTHER.end(f); OTHER.card(f); OTHER.pay(f); },
    variants: {
      other_order(f) { OTHER.pay(f); OTHER.card(f); OTHER.end(f); },
      single_instead_of_batch(f) { OTHER.end(f); OTHER.card(f); pay(f, ['n-0013'], 'card-dani-visa'); pay(f, ['n-0016'], 'card-dani-visa'); },
    },
    wrong: {
      replenish_from_other_persons_card(f) { OTHER.end(f); OTHER.pay(f); },
      batch_pay_everything(f) { OTHER.end(f); OTHER.card(f); pay(f, ['n-0012', 'n-0013', 'n-0016'], 'card-dani-visa'); },
      end_possession_today(f) { f.call('vehicles.end', {vehicle_id: 'v-0003'}); OTHER.card(f); OTHER.pay(f); },
      pay_with_default_card(f) { OTHER.end(f); pay(f, ['n-0013', 'n-0016']); OTHER.card(f); },
    },
    fails: {
      replenish_from_other_persons_card: ['replenish_on_own_card'],
      batch_pay_everything: ['jordans_notice_unpaid'],
      end_possession_today: ['subaru_ended_on_handover'],
      pay_with_default_card: ['own_notices_paid_own_card'],
    },
  },
  rental_double_billing: {
    checks: ['rental_disputed_with_receipt', 'rental_unpaid'],
    writes: ['rental_disputed_with_receipt'],
    reference(f) { dispute(f, {notice_id: 'n-0015', reason: 'paid_by_rental_agency', agency_id: 'ag-swiftrent', evidence: [MAIL('m-11140')]}); },
    variants: {},
    wrong: {
      pay_the_notice(f) { pay(f, ['n-0015'], 'card-dani-visa'); },
      dispute_wrong_reason(f) { dispute(f, {notice_id: 'n-0015', reason: 'not_my_plate', explanation: 'Rental car.', evidence: [MAIL('m-11140')]}); },
    },
    fails: {pay_the_notice: ['rental_disputed_with_receipt', 'rental_unpaid'], dispute_wrong_reason: ['rental_disputed_with_receipt']},
  },
  wrong_class: {
    checks: ['tag_on_kia_at_class_1'], writes: ['tag_on_kia_at_class_1'],
    reference(f) { f.call('transponders.assign', {transponder_id: 'tp-0001', vehicle_id: 'v-0004'}); },
    variants: {},
    wrong: {spare_tag_instead(f) { f.call('transponders.assign', {transponder_id: 'tp-0002', vehicle_id: 'v-0004'}); }},
    fails: {spare_tag_instead: ['tag_on_kia_at_class_1']},
  },
  road_trip: {
    checks: ['trip_covered', 'replenish_on_own_card'], writes: ['trip_covered', 'replenish_on_own_card'],
    setup(f) { f.event({event_id: 'amex-closed', at: '2026-11-02T09:00:00-05:00', operation: 'crossway.card.status_changed', payload: {card_id: 'card-jordan-amex', status: 'closed'}}); },
    reference(f) { topup(f, 10000); OTHER.card(f); },
    variants: {other_order(f) { OTHER.card(f); topup(f, 10000); }},
    wrong: {
      keep_the_expired_card(f) {
        assert.throws(() => f.call('account.replenish.set', {enabled: true, card_id: 'card-dani-mc'}), code('card_expired'));
        topup(f, 10000);
      },
      top_up_too_little(f) { topup(f, 5000); OTHER.card(f); },
    },
    fails: {keep_the_expired_card: ['replenish_on_own_card'], top_up_too_little: ['trip_covered']},
  },
};

const END = '2026-11-03T09:00:00-05:00';
function run(s, fn) {
  const f = fixture();
  if (s.setup) s.setup(f);
  fn(f);
  f.at(END);
  return evaluate(s.checks, f.view(), f.trace, C.ms(END));
}

for (const [name, s] of Object.entries(SCENARIOS)) {
  test(`check (a), ${name}: reference and variants pass, do-nothing fails exactly the checks that need a write, wrong runs fail exactly their checks`, () => {
    const ok = Object.fromEntries(s.checks.map(c => [c, true]));
    assert.deepEqual(run(s, s.reference), ok, 'reference');
    for (const [variant, fn] of Object.entries(s.variants)) assert.deepEqual(run(s, fn), ok, variant);
    assert.deepEqual(run(s, () => {}), Object.fromEntries(s.checks.map(c => [c, !s.writes.includes(c)])), 'do-nothing');
    for (const [wrong, fn] of Object.entries(s.wrong)) {
      assert.deepEqual(run(s, fn), Object.fromEntries(s.checks.map(c => [c, !s.fails[wrong].includes(c)])), wrong);
    }
  });
}

test('the road-trip check prices the drive at the tag\'s class', () => {
  const f = fixture();
  assert.equal(tripCost(f.data), 10400);
  f.call('transponders.assign', {transponder_id: 'tp-0001', vehicle_id: 'v-0004'});
  assert.equal(tripCost(f.data), 5200);
});

// ---- Data -------------------------------------------------------------------

test('every seed is the generator\'s output, and validates', () => {
  const {generate} = require('../scripts/generate-seed.cjs');
  for (const s of SEEDS) assert.deepEqual(generate(s.seed_id), seedFiles(s.seed_id).data, s.seed_id);
});

test('every seed\'s history starts on or after 2025-01-01, and its task clock and schedule on or after 2026-01-01', () => {
  const floor = Date.parse('2025-01-01T00:00:00Z'), taskFloor = Date.parse('2026-01-01T00:00:00Z');
  const files = ['examples/scenario.json', 'fixtures/seeds/index.json'];
  for (const s of SEEDS) files.push(s.seed, s.binding, s.clock, s.schedule);
  for (const file of files) {
    const text = JSON.stringify(require('../' + file));
    for (const [stamp] of text.matchAll(/\d{4}-\d{2}-\d{2}(T[0-9:.]+(Z|[+-]\d{2}:\d{2}))?/g)) {
      const t = Date.parse(stamp.length === 10 ? stamp + 'T00:00:00Z' : stamp);
      assert.ok(t >= floor, `${file}: date before 2025-01-01: ${stamp}`);
    }
    for (const [, period] of text.matchAll(/"period":"(\d{4}-\d{2})"/g)) assert.ok(period >= '2025-01', period);
  }
  for (const s of SEEDS) {
    const f = seedFiles(s.seed_id);
    assert.ok(f.data.opened_on >= '2025-01-01', s.seed_id);
    assert.ok(Date.parse(f.now) >= taskFloor, s.seed_id + ' clock');
    assert.equal(f.schedule.clock, f.now, s.seed_id + ' schedule starts at the seed clock');
    for (const e of f.schedule.events) assert.ok(Date.parse(e.at) >= Math.max(taskFloor, Date.parse(f.now)), `${s.seed_id}: ${e.event_id}`);
  }
  assert.ok(Date.parse(require('../examples/scenario.json').at) >= taskFloor);
});
