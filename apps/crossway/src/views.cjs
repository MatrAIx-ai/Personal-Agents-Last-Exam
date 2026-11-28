'use strict';
// Read models. Each function takes settled data and an instant and returns plain copies.
const R = require('./rules.cjs');
const C = require('./clock.cjs');

const copy = value => structuredClone(value);

function cardView(data, c, now) {
  return {id: c.id, label: R.cardLabel(c), brand: c.brand, last4: c.last4, holder_name: c.holder_name,
    holder_person_id: c.holder_person_id, exp_month: c.exp_month, exp_year: c.exp_year, status: c.status,
    expired: R.cardExpired(c, now), chargeable: R.cardProblem(c, now) === null,
    is_replenish_card: data.replenish.card_id === c.id};
}

function replenishView(data, now) {
  const rule = data.replenish;
  return {...copy(rule), card: cardView(data, R.card(data, rule.card_id), now)};
}

function vehicleView(data, v) {
  const tp = data.transponders.find(t => t.vehicle_id === v.id);
  const agency = v.rental_agency_id ? data.authority.rental_agencies.find(a => a.id === v.rental_agency_id) : null;
  return {...copy(v), status: R.vehicleStatus(v), transponder_id: tp ? tp.id : null, rental_agency_name: agency ? agency.name : null};
}

function transponderView(data, t) {
  const v = t.vehicle_id ? data.vehicles.find(x => x.id === t.vehicle_id) : null;
  return {...copy(t), vehicle: v ? {id: v.id, plate: v.plate, label: v.label, class: v.class} : null,
    class_matches_vehicle: v ? v.class === t.class : null};
}

function tollView(data, t) {
  return {...copy(t), plaza_name: R.plaza(data, t.plaza_id).name, local_time: C.stamp(C.ms(t.at)).slice(0, 16).replace('T', ' ')};
}

function amountDue(n) {
  if (n.state === 'paid' || n.state === 'dismissed') return 0;
  return R.noticeAmount(n);
}

function noticeView(data, n, now) {
  const d = n.dispute_id ? data.disputes.find(x => x.id === n.dispute_id) : null;
  return {...copy(n), plaza_name: R.plaza(data, n.plaza_id).name, toll_date: C.localDate(C.ms(n.toll_at)),
    amount_due_cents: amountDue(n), payable: R.payBlock(n) === null,
    dispute_window_closes: R.disputeWindowCloses(data, n), can_dispute: R.disputeBlock(data, n, now) === null,
    dispute_state: d ? d.state : null};
}

function accountView(data, now) {
  return {account_id: data.account_id, holder: copy(data.holder), opened_on: data.opened_on,
    status: R.accountStatus(data), balance_cents: data.balance_cents, suspended_at: data.suspended_at,
    replenish: replenishView(data, now), cards: data.cards.map(c => cardView(data, c, now)),
    vehicles_active: data.vehicles.filter(v => !v.ended_at).length,
    open_notices: data.notices.filter(n => ['issued', 'escalated', 'disputed'].includes(n.state)).length,
    as_of: C.stamp(now)};
}

function policyText(data) {
  const p = R.policy(data);
  const dollars = c => '$' + (c / 100).toFixed(2);
  return {
    authority: data.authority.name,
    time_zone: data.authority.time_zone,
    rates: data.authority.plazas.map(z => ({plaza_id: z.id, name: z.name, road: z.road,
      account_cents_by_class: copy(z.account_cents), mail_cents_by_class: copy(z.mail_cents)})),
    vehicle_classes: copy(p.vehicle_classes),
    late_fee_cents: p.late_fee_cents,
    notice_due_days: p.notice_due_days,
    escalated_due_days: p.escalated_due_days,
    dispute_window_days: p.dispute_window_days,
    denial_due_days: p.denial_due_days,
    preview_minutes: p.preview_minutes,
    temporary_plate_max_days: p.temporary_plate_max_days,
    topup_range_cents: [p.topup_min_cents, p.topup_max_cents],
    replenish_amount_range_cents: [p.replenish_min_cents, p.replenish_max_cents],
    threshold_range_cents: [p.threshold_min_cents, p.threshold_max_cents],
    rental_agencies: copy(data.authority.rental_agencies),
    rules: [
      `Time: deadlines fall at 00:00 authority time (${data.authority.time_zone}). A due date is the instant 00:00 on that date; pay before it.`,
      'Reading or changing this account does not move its clock. Time moves only when the environment advances the clock (Infra env.advance_time) or applies a scheduled event at its time, so a missed deadline takes effect only after such an advance or event; its fee and status are dated at the deadline itself.',
      'A transponder read debits the prepaid balance at the account rate for the transponder\'s vehicle class. Tolls are charged at the transponder\'s class, which transponders.assign sets to the target vehicle\'s class.',
      'Crossway rule: a plate-only read is billed by violation notice at the mail rate, even for a plate listed on the account. Any read while the account is suspended is also billed by notice.',
      'Crossway rule: plates stay with a sold vehicle. The seller files a notice of transfer with the state and separately ends possession here; until then, tolls on the plate are billed to this account.',
      'A read belongs to this account when its toll time falls inside a vehicle\'s possession interval, which runs from 00:00 on the start date through the end of the end date. Ending possession stops later notices; notices already issued need a dispute. The end date defaults to today; vehicles.update corrects it.',
      `A temporary (rental) plate needs an end date at most ${p.temporary_plate_max_days} days after its start. It ends on the clock after its end date, or earlier through vehicles.end.`,
      `A toll that leaves the balance under the low-balance threshold triggers one auto-replenish attempt on the replenish card. Two failed attempts in a row, or a balance below zero, suspend the account until a top-up succeeds.`,
      `Violation notices: issued, due in ${p.notice_due_days} days; unpaid, escalated with one late fee of ${dollars(p.late_fee_cents)} and due ${p.escalated_due_days} days later; unpaid again, sent to collections, which ends Crossway's handling.`,
      'Payment is by card, defaulting to the auto-replenish card. Payment is final and closes the right to dispute. One ineligible notice rejects the whole payment preview and is named. If an amount changes between preview and confirm, the confirm returns amount_changed and charges nothing.',
      `Disputes: an issued or escalated notice can be disputed once, within ${p.dispute_window_days} days of issue. While disputed, its fees and due date are frozen. Granted: the notice is dismissed at $0.00. Denied: it returns to its prior state, due ${p.denial_due_days} days after the decision. Withdrawn: it returns with the days that remained.`,
      'Dispute evidence is a shared object reference {app_id, account_id, object_id}, normally a Mail message. Crossway records it as given and does not read other Apps.',
      `Previews expire ${p.preview_minutes} minutes after they are made and can be confirmed once.`,
    ],
  };
}

module.exports = {copy, cardView, replenishView, vehicleView, transponderView, tollView, noticeView, accountView, policyText, amountDue};
