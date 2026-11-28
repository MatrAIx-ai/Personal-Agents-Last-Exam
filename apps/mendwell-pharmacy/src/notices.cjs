'use strict';
const { nextId, byId, money, textLength } = require('./util.cjs');
const { ms, localParts } = require('./time.cjs');
const { inForceAt } = require('./authority.cjs');

const TITLE_LIMIT = 200, BODY_LIMIT = 20000;
const TITLES = {
  'notice.fill_ready': 'Fill ready for pickup', 'notice.return_warning': 'Pickup reminder', 'notice.returned': 'Fill returned to stock',
  'notice.refused': 'Collection refused', 'notice.held': 'Fill on hold', 'notice.released': 'Hold released', 'notice.claim_rejected': 'Claim rejected',
  'notice.plan_decision': 'Plan decision', 'notice.renewal_reply': 'Renewal reply', 'notice.payment_voided': 'Payment voided',
};
const LOGISTICS = new Set(['notice.fill_ready', 'notice.return_warning', 'notice.returned', 'notice.refused']);
const REASONS = {
  not_covered: 'the drug is not covered by the plan', quantity_limit: 'the quantity is above the plan limit', prior_auth_required: 'the plan requires prior authorization',
  refill_too_soon: 'it is too soon to refill', on_hold: 'the fill is on hold', not_ready: 'the fill is not ready', store_closed: 'the store is closed',
  collector_not_authorized: 'the collector is not authorized for this fill', payment_failed: 'the payment did not go through',
};
const REQUESTS = { refill_too_soon: 'early-refill override', prior_auth_required: 'prior authorization' };

function when(iso) {
  const p = localParts(ms(iso));
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(ms(iso)));
  return day + ' at ' + String(p.hour).padStart(2, '0') + ':' + String(p.minute).padStart(2, '0');
}

function fillFacts(data, fill) {
  const rx = byId(data.prescriptions, 'rx_id', fill.rx_id);
  const drug = byId(data.drugs, 'drug_id', rx.drug_id);
  const store = byId(data.stores, 'store_id', fill.store_id);
  const patient = byId(data.people, 'person_id', rx.patient_id);
  return { rx, drug, store, patient, what: drug.generic_name + ' ' + drug.strength + ' for ' + patient.name };
}

function recipients(data, patientId, fillId, at) {
  const t = ms(at), patient = byId(data.people, 'person_id', patientId);
  const full = new Set([patientId, ...(patient.is_minor ? patient.guardian_ids : [])]);
  const pickup = new Set();
  for (const g of data.grants) {
    if (g.patient_id !== patientId || !inForceAt(g, t)) continue;
    if (g.scope === 'view' || g.scope === 'refill') full.add(g.grantee_id);
    else if (g.scope === 'pickup' && fillId !== null && (g.fill_id === null || g.fill_id === fillId)) pickup.add(g.grantee_id);
  }
  for (const p of full) pickup.delete(p);
  return { full: [...full].sort(), pickup: [...pickup].sort() };
}

function fillBody(data, kind, fill, at, extra, audience) {
  const { drug, store, what } = fillFacts(data, fill);
  const due = fill.amount_due_cents === null ? null : money(fill.amount_due_cents);
  const owed = due === null ? '' : ' Amount due: ' + due + '.';
  if (audience === 'logistics') {
    if (kind === 'notice.fill_ready') return 'Fill ' + fill.fill_id + ' is ready at store ' + store.store_id + '.' + owed;
    if (kind === 'notice.return_warning') return 'Fill ' + fill.fill_id + ' at store ' + store.store_id + ' will return to stock soon unless collected.' + owed;
    if (kind === 'notice.returned') return 'Fill ' + fill.fill_id + ' was returned to stock at store ' + store.store_id + '.' + owed;
    return 'Collection of fill ' + fill.fill_id + ' at store ' + store.store_id + ' was refused.' + owed;
  }
  const head = 'Fill ' + fill.fill_id + ' of ' + what;
  if (kind === 'notice.fill_ready') return head + ' is ready at ' + store.name + ' (' + store.store_id + ').' + owed + ' It returns to stock if not collected by ' + when(fill.return_due_at) + '.';
  if (kind === 'notice.return_warning') return head + ' at ' + store.name + ' has not been collected. It returns to stock on ' + when(fill.return_due_at) + ' unless collected.' + owed;
  if (kind === 'notice.returned') return head + ' was returned to stock at ' + store.name + ' on ' + when(at) + (extra.reversed ? '. The plan claim was reversed' : '') + '. Fills remaining on the prescription are unchanged.';
  if (kind === 'notice.refused') return 'Collection of fill ' + fill.fill_id + ' of ' + what + ' at ' + store.name + ' was refused: ' + REASONS[extra.reason] + '.';
  if (kind === 'notice.held') return head + ' is on hold: ' + extra.note;
  if (kind === 'notice.released') return 'The hold on fill ' + fill.fill_id + ' of ' + what + ' was released: ' + extra.note;
  if (kind === 'notice.claim_rejected') return 'The plan rejected the claim for fill ' + fill.fill_id + ' of ' + what + ': ' + REASONS[extra.reason] + (extra.eligible_on ? '; it can be refilled from ' + extra.eligible_on : '') + '.';
  if (kind === 'notice.plan_decision') return 'The plan ' + extra.decision + ' the ' + REQUESTS[extra.reason] + ' request ' + extra.plan_request_id + ' for fill ' + fill.fill_id + ' of ' + what + '.';
  if (kind === 'notice.payment_voided') return 'The prepayment of ' + money(extra.amount_cents) + ' on the card ending ' + extra.card_last4 + ' for fill ' + fill.fill_id + ' of ' + drug.generic_name + ' was voided.';
  return head + '.';
}

function clip(text, limit) {
  if (text.length <= limit && textLength(text) <= limit) return text;
  let out = '';
  for (const ch of text) { if (out.length + ch.length > limit - 1) break; out += ch; }
  return out + '…';
}

function append(data, kind, recipient, audience, subject, at, body, fields) {
  data.notices.push({ notice_id: nextId(data, 'n'), kind, recipient_id: recipient, audience, subject, at, title: TITLES[kind], body: clip(body, BODY_LIMIT), fields });
}

function notifyFill(data, kind, fill, at, extra = {}) {
  const rx = byId(data.prescriptions, 'rx_id', fill.rx_id);
  const { full, pickup } = recipients(data, rx.patient_id, fill.fill_id, at);
  const owner = kind === 'notice.payment_voided' ? extra.card_owner : null;
  const fields = { fill_id: fill.fill_id, store_id: fill.store_id, state: fill.state, amount_due_cents: fill.amount_due_cents, ...(extra.reason ? { reason: extra.reason } : {}) };
  for (const p of full) if (p !== owner) append(data, kind, p, 'full', { type: 'fill', id: fill.fill_id }, at, fillBody(data, kind, fill, at, extra, 'full'), fields);
  if (LOGISTICS.has(kind)) for (const p of pickup) if (p !== owner) append(data, kind, p, 'logistics', { type: 'fill', id: fill.fill_id }, at, fillBody(data, kind, fill, at, extra, 'logistics'), { fill_id: fill.fill_id, store_id: fill.store_id, amount_due_cents: fill.amount_due_cents });
  if (owner) {
    const id = nextId(data, 'n');
    data.notices.push({ notice_id: id, kind, recipient_id: owner, audience: 'card_owner', subject: { type: 'notice', id }, at, title: TITLES[kind],
      body: 'A prepayment of ' + money(extra.amount_cents) + ' on your card ending ' + extra.card_last4 + ' was voided.', fields: { card_last4: extra.card_last4, amount_cents: extra.amount_cents, status: 'voided' } });
  }
}

function notifyRenewal(data, renewal, at, extra) {
  const rx = byId(data.prescriptions, 'rx_id', renewal.rx_id);
  const drug = byId(data.drugs, 'drug_id', rx.drug_id);
  const patient = byId(data.people, 'person_id', rx.patient_id);
  const { full } = recipients(data, rx.patient_id, null, at);
  const body = 'The prescriber ' + extra.decision + ' renewal ' + renewal.renewal_id + ' of prescription ' + rx.rx_id + ' (' + drug.generic_name + ' ' + drug.strength + ' for ' + patient.name + ')' + (extra.new_rx_id ? '; the new prescription ' + extra.new_rx_id + ' replaces it' : '') + '.';
  for (const p of full) append(data, 'notice.renewal_reply', p, 'full', { type: 'renewal', id: renewal.renewal_id }, at, body, { renewal_id: renewal.renewal_id, rx_id: rx.rx_id, decision: extra.decision, new_rx_id: extra.new_rx_id || null });
}

module.exports = { notifyFill, notifyRenewal, recipients, TITLES, TITLE_LIMIT, BODY_LIMIT };
