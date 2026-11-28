'use strict';
// Pure business rules. Nothing here writes; time effects are computed from
// stored due dates and the supplied clock (ctx.virtual_now).
const {fail} = require('./domain-utils.cjs');
const C = require('./clock.cjs');

const REASONS = {
  sold_or_not_in_possession: {
    label: 'Vehicle sold or not in my possession at the toll time',
    required: ['transfer_date', 'evidence'],
  },
  paid_by_rental_agency: {
    label: 'Rental vehicle; the rental agency already paid this toll',
    required: ['agency_id', 'evidence'],
  },
  transponder_malfunction: {
    label: 'My transponder was mounted but was not read',
    required: ['transponder_id'],
  },
  not_my_plate: {
    label: 'The plate was misread; this is not my vehicle',
    required: ['explanation'],
  },
};

const PAYABLE = new Set(['issued', 'escalated']);
const DISPUTABLE = new Set(['issued', 'escalated']);
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$/;

const byId = (list, id, code = 'not_found', what = 'Record') => {
  const item = list.find(x => x.id === id);
  if (!item) fail(code, `${what} ${id} does not exist.`);
  return item;
};
const policy = data => data.authority.policy;
const plaza = (data, id) => byId(data.authority.plazas, id, 'not_found', 'Plaza');
const card = (data, id) => byId(data.cards, id, 'not_found', 'Card');
const vehicle = (data, id) => byId(data.vehicles, id, 'not_found', 'Vehicle');
const transponder = (data, id) => byId(data.transponders, id, 'not_found', 'Transponder');
const notice = (data, id) => byId(data.notices, id, 'not_found', 'Notice');
const dispute = (data, id) => byId(data.disputes, id, 'not_found', 'Dispute');

// ---- Rates ------------------------------------------------------------------

function rate(data, plazaId, cls, kind) {
  const p = plaza(data, plazaId);
  const table = kind === 'account' ? p.account_cents : p.mail_cents;
  if (!Number.isInteger(cls) || cls < 1 || cls > table.length) fail('invalid_event', 'Unknown vehicle class.');
  return table[cls - 1];
}

// ---- Cards ------------------------------------------------------------------

// Valid through the last day of its expiry month, authority time.
function cardExpired(c, now) {
  const next = c.exp_month === 12 ? `${c.exp_year + 1}-01-01` : `${c.exp_year}-${String(c.exp_month + 1).padStart(2, '0')}-01`;
  return now >= C.midnight(next);
}

// Why a charge on this card would fail now, or null.
function cardProblem(c, now) {
  if (c.status !== 'active') return 'card_declined';
  if (cardExpired(c, now)) return 'card_expired';
  return null;
}

function requireChargeable(c, now) {
  const problem = cardProblem(c, now);
  if (problem === 'card_expired') fail('card_expired', `${cardLabel(c)} expired ${String(c.exp_month).padStart(2, '0')}/${c.exp_year}.`);
  if (problem) fail('card_declined', `${cardLabel(c)} was declined (${c.status}).`);
}

function cardLabel(c) {
  return `${c.brand} ending ${c.last4}`;
}

// ---- Account ----------------------------------------------------------------

function accountStatus(data) {
  if (data.suspended_at) return 'suspended';
  if (data.balance_cents < data.replenish.threshold_cents) return 'low_balance';
  return 'active';
}

// ---- Vehicles ---------------------------------------------------------------

// Possession runs from 00:00 on the start date through the end of the end date.
function possessionCovers(v, t) {
  if (t < C.midnight(v.possession_start)) return false;
  return v.possession_end === null || t < C.midnight(C.addDays(v.possession_end, 1));
}

function vehicleStatus(v) {
  return v.ended_at ? 'ended' : 'active';
}

function intervalsOverlap(a, b) {
  const aEnd = a.possession_end || '9999-12-31', bEnd = b.possession_end || '9999-12-31';
  return a.possession_start <= bEnd && b.possession_start <= aEnd;
}

function normalizePlate(plate) {
  return String(plate).toUpperCase().replace(/[\s-]/g, '');
}

// ---- Notices ----------------------------------------------------------------

function noticeAmount(n) {
  return n.toll_cents + n.late_fee_cents;
}

function dueAt(n) {
  return C.midnight(n.due_date);
}

function disputeWindowCloses(data, n) {
  return C.addDays(n.issue_date, policy(data).dispute_window_days);
}

function disputeWindowOpen(data, n, now) {
  return now < C.midnight(disputeWindowCloses(data, n));
}

// The single error a payment of this notice would hit, or null.
function payBlock(n) {
  if (n.state === 'disputed') return ['notice_in_dispute', `Notice ${n.id} is in dispute; payment waits for the decision or a withdrawal.`];
  if (n.state === 'paid') return ['already_paid', `Notice ${n.id} is already paid.`];
  if (n.state === 'collections') return ['in_collections', `Notice ${n.id} was sent to collections and cannot be paid here.`];
  if (n.state === 'dismissed') return ['notice_dismissed', `Notice ${n.id} was dismissed after a granted dispute; nothing is owed.`];
  return null;
}

function disputeBlock(data, n, now) {
  if (n.state === 'paid') return ['closed_by_payment', `Notice ${n.id} was paid; payment closed the right to dispute it.`];
  if (n.dispute_id) return ['dispute_exists', `Notice ${n.id} already has dispute ${n.dispute_id}; a notice can be disputed once.`];
  if (!DISPUTABLE.has(n.state) || !disputeWindowOpen(data, n, now)) {
    return ['dispute_window_closed', `The dispute window for ${n.id} closed on ${disputeWindowCloses(data, n)}.`];
  }
  return null;
}

// Evidence is a shared object reference. Crossway checks only its shape.
function validEvidenceRef(ref) {
  return ref !== null && typeof ref === 'object' && !Array.isArray(ref) &&
    Object.keys(ref).sort().join(',') === 'account_id,app_id,object_id' &&
    ['app_id', 'account_id', 'object_id'].every(k => typeof ref[k] === 'string' && ID.test(ref[k]));
}

const sameRef = (a, b) => a.app_id === b.app_id && a.account_id === b.account_id && a.object_id === b.object_id;

module.exports = {
  REASONS, PAYABLE, DISPUTABLE, ID,
  byId, policy, plaza, card, vehicle, transponder, notice, dispute,
  rate, cardExpired, cardProblem, requireChargeable, cardLabel, accountStatus,
  possessionCovers, vehicleStatus, intervalsOverlap, normalizePlate,
  noticeAmount, dueAt, disputeWindowCloses, disputeWindowOpen, payBlock, disputeBlock, validEvidenceRef, sameRef,
};
