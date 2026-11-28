'use strict';
const minimal = require('./unit-seed.json');

function fill(o) {
  return {
    fill_id: o.fill_id, fill_version: o.fill_version ?? 0, rx_id: o.rx_id, store_id: o.store_id ?? 'st-1', quantity: o.quantity ?? 30, state: o.state, requested_at: o.requested_at,
    review_due_at: null, resubmission_due_at: null, ready_at: null, warning_due_at: null, return_due_at: null, warned_at: null, hold: null,
    amount_due_cents: null, claim_id: null, waived: [], cash: null, authorization_id: null, charge_id: null, collector: null, plan_request_id: null, notes: [],
    timeline: o.timeline, refusals: [], cancellation: null, closed_at: null, ...o.more,
  };
}

function rx(id, extra = {}) {
  return { rx_id: id, patient_id: 'p-4', prescriber_id: 'dr-2', drug_id: 'd-atorvastatin-40', quantity: 30, fills_authorized: 5, fills_remaining: 5, written_on: '2026-06-01', received_at: '2026-06-01T10:00:00-04:00', state: 'active', superseded_by: null, superseded_at: null, ...extra };
}

const claim = (id, fillId, at, result, extra = {}) => ({ claim_id: id, fill_id: fillId, attempt: 1, at, result, reason: null, eligible_on: null, copay_cents: result === 'paid' ? 1200 : null, reversed_at: null, ...extra });

function baseSeed() {
  const s = structuredClone(minimal);
  s.seed_id = 'mendwell-base-1';
  s.prescriptions = ['rx-1', 'rx-2', 'rx-3', 'rx-4', 'rx-5', 'rx-6', 'rx-7', 'rx-8'].map(id => rx(id));
  s.prescriptions.find(r => r.rx_id === 'rx-6').fills_remaining = 4;
  s.fills = [
    fill({ fill_id: 'f-1', rx_id: 'rx-1', state: 'requested', requested_at: '2026-11-30T08:30:00-05:00', timeline: [{ state: 'requested', at: '2026-11-30T08:30:00-05:00' }],
      more: { review_due_at: '2026-11-30T10:30:00-05:00' } }),
    fill({ fill_id: 'f-2', rx_id: 'rx-2', store_id: 'st-2', state: 'waiting_stock', requested_at: '2026-11-28T10:00:00-05:00', timeline: [{ state: 'requested', at: '2026-11-28T10:00:00-05:00' }, { state: 'waiting_stock', at: '2026-11-28T12:00:00-05:00' }],
      more: { claim_id: 'cl-1' } }),
    fill({ fill_id: 'f-3', rx_id: 'rx-3', state: 'claim_rejected', requested_at: '2026-11-28T10:00:00-05:00', timeline: [{ state: 'requested', at: '2026-11-28T10:00:00-05:00' }, { state: 'claim_rejected', at: '2026-11-28T12:00:00-05:00' }],
      more: { claim_id: 'cl-2' } }),
    fill({ fill_id: 'f-4', rx_id: 'rx-4', state: 'pending_plan_decision', requested_at: '2026-11-27T10:00:00-05:00', timeline: [{ state: 'requested', at: '2026-11-27T10:00:00-05:00' }, { state: 'claim_rejected', at: '2026-11-27T12:00:00-05:00' }, { state: 'pending_plan_decision', at: '2026-11-27T13:00:00-05:00' }],
      more: { claim_id: 'cl-3', plan_request_id: 'pr-1' } }),
    fill({ fill_id: 'f-5', rx_id: 'rx-5', state: 'ready', requested_at: '2026-11-29T10:00:00-05:00', timeline: [{ state: 'requested', at: '2026-11-29T10:00:00-05:00' }, { state: 'ready', at: '2026-11-29T12:00:00-05:00' }],
      more: { claim_id: 'cl-4', amount_due_cents: 1200, ready_at: '2026-11-29T12:00:00-05:00', warning_due_at: '2026-12-06T12:00:00-05:00', return_due_at: '2026-12-09T12:00:00-05:00' } }),
    fill({ fill_id: 'f-6', rx_id: 'rx-6', state: 'collected', requested_at: '2026-11-20T10:00:00-05:00', timeline: [{ state: 'requested', at: '2026-11-20T10:00:00-05:00' }, { state: 'ready', at: '2026-11-20T12:00:00-05:00' }, { state: 'collected', at: '2026-11-21T15:00:00-05:00' }],
      more: { claim_id: 'cl-5', amount_due_cents: 1200, ready_at: '2026-11-20T12:00:00-05:00', charge_id: 'ch-1', closed_at: '2026-11-21T15:00:00-05:00' } }),
    fill({ fill_id: 'f-7', rx_id: 'rx-7', state: 'returned_to_stock', requested_at: '2026-11-10T10:00:00-05:00', timeline: [{ state: 'requested', at: '2026-11-10T10:00:00-05:00' }, { state: 'ready', at: '2026-11-10T12:00:00-05:00' }, { state: 'returned_to_stock', at: '2026-11-20T12:00:00-05:00' }],
      more: { claim_id: 'cl-6', amount_due_cents: 1200, ready_at: '2026-11-10T12:00:00-05:00', warned_at: '2026-11-17T12:00:00-05:00', closed_at: '2026-11-20T12:00:00-05:00' } }),
    fill({ fill_id: 'f-8', rx_id: 'rx-8', state: 'cancelled', requested_at: '2026-11-25T10:00:00-05:00', timeline: [{ state: 'requested', at: '2026-11-25T10:00:00-05:00' }, { state: 'cancelled', at: '2026-11-25T10:30:00-05:00' }],
      more: { cancellation: { reason: 'agent', stage: 'requested', at: '2026-11-25T10:30:00-05:00' }, closed_at: '2026-11-25T10:30:00-05:00' } }),
  ];
  s.claims = [
    claim('cl-1', 'f-2', '2026-11-28T12:00:00-05:00', 'paid'),
    claim('cl-2', 'f-3', '2026-11-28T12:00:00-05:00', 'rejected', { reason: 'refill_too_soon', eligible_on: '2026-12-05' }),
    claim('cl-3', 'f-4', '2026-11-27T12:00:00-05:00', 'rejected', { reason: 'refill_too_soon', eligible_on: '2026-12-04' }),
    claim('cl-4', 'f-5', '2026-11-29T12:00:00-05:00', 'paid'),
    claim('cl-5', 'f-6', '2026-11-20T12:00:00-05:00', 'paid'),
    claim('cl-6', 'f-7', '2026-11-10T12:00:00-05:00', 'paid', { reversed_at: '2026-11-20T12:00:00-05:00' }),
  ];
  s.charges = [{ charge_id: 'ch-1', fill_id: 'f-6', payer_id: 'p-2', card_id: 'card-3', method: 'counter', amount_cents: 1200, at: '2026-11-21T15:00:00-05:00' }];
  s.plan_requests = [{ plan_request_id: 'pr-1', fill_id: 'f-4', claim_id: 'cl-3', reason: 'refill_too_soon', state: 'pending', decision: null, note: null, created_at: '2026-11-27T13:00:00-05:00', closed_at: null }];
  s.issued = { f: 8, cl: 6, ch: 1, pr: 1, g: 1 };
  return s;
}

const ready = (id, rxId, at, extra = {}) => fill({ fill_id: id, rx_id: rxId, state: 'ready', requested_at: at, timeline: [{ state: 'requested', at }, { state: 'ready', at: new Date(Date.parse(at) + 7200000).toISOString() }],
  more: { claim_id: 'cl-' + id.slice(2), amount_due_cents: extra.due ?? 1000, ready_at: new Date(Date.parse(at) + 7200000).toISOString(), warning_due_at: new Date(Date.parse(at) + 7200000 + 168 * 3600000).toISOString(), return_due_at: new Date(Date.parse(at) + 7200000 + 240 * 3600000).toISOString() } });
const requested = (id, rxId, at, store = 'st-1') => fill({ fill_id: id, rx_id: rxId, store_id: store, state: 'requested', requested_at: at, timeline: [{ state: 'requested', at }], more: { review_due_at: new Date(Date.parse(at) + 7200000).toISOString() } });

function householdSeed() {
  const s = baseSeed();
  s.seed_id = 'mendwell-household-1';
  s.prescriptions.push(rx('rx-21', { patient_id: 'p-2' }), rx('rx-31', { patient_id: 'p-1' }), rx('rx-41', { patient_id: 'p-3', drug_id: 'd-amoxicillin-250-5', quantity: 100, prescriber_id: 'dr-1' }));
  s.fills.push(requested('f-21', 'rx-21', '2026-11-30T08:00:00-05:00'), ready('f-31', 'rx-31', '2026-11-29T09:00:00-05:00'), requested('f-41', 'rx-41', '2026-11-30T08:15:00-05:00'));
  s.fills.find(f => f.fill_id === 'f-41').quantity = 100;
  s.claims.push(claim('cl-31', 'f-31', '2026-11-29T16:00:00.000Z', 'paid', { copay_cents: 1000 }));
  s.cards.push({ card_id: 'card-1', owner_id: 'p-1', label: 'Spouse card', last4: '2208', exp_month: 3, exp_year: 2029, status: 'active' });
  const g = (id, patient, grantee, scope, extra = {}) => ({ grant_id: id, grant_version: 0, patient_id: patient, grantor_id: patient, grantee_id: grantee, scope, fill_id: null, expires_at: null, status: 'active', created_at: '2026-11-01T09:00:00-05:00', revoked_at: null, ...extra });
  s.grants.push(g('g-2', 'p-1', 'p-2', 'view'), g('g-3', 'p-4', 'p-1', 'pickup', { fill_id: 'f-5', created_at: '2026-11-29T10:00:00-05:00' }), g('g-4', 'p-2', 'p-1', 'pickup'), g('g-5', 'p-1', 'p-4', 'view', { expires_at: '2026-11-20T09:00:00-05:00' }));
  s.issued.g = 5;
  return s;
}

function asActor(seed, binding, person) {
  const s = structuredClone(seed), b = structuredClone(binding);
  for (const p of s.people) if (p.relation === 'self') p.relation = 'other';
  s.people.find(p => p.person_id === person).relation = 'self';
  s.owner_person_id = person;
  s.account_id = 'mendwell-' + person;
  b.accounts = [{ app_id: 'mendwell-pharmacy', account_id: 'mendwell-' + person, owner_person_id: person }];
  return { seed: s, binding: b };
}

function withCollected(s, rxId, closedAt, id = 'f-c1') {
  const at = closedAt;
  const reqAt = new Date(Date.parse(at) - 4 * 3600000).toISOString(), readyAt = new Date(Date.parse(at) - 2 * 3600000).toISOString();
  const r = s.prescriptions.find(x => x.rx_id === rxId);
  const copay = s.plans.find(p => p.plan_id === s.people.find(x => x.person_id === r.patient_id).plan_id).rules[r.drug_id].copay_cents;
  s.fills.push(fill({ fill_id: id, rx_id: rxId, state: 'collected', requested_at: reqAt, quantity: r.drug_id === 'd-amoxicillin-250-5' ? 100 : 30, timeline: [{ state: 'requested', at: reqAt }, { state: 'ready', at: readyAt }, { state: 'collected', at }],
    more: { claim_id: 'cl-' + id, amount_due_cents: copay, ready_at: readyAt, charge_id: copay > 0 ? 'ch-' + id : null, closed_at: at } }));
  s.claims.push(claim('cl-' + id, id, readyAt, 'paid', { copay_cents: copay }));
  if (copay > 0) s.charges.push({ charge_id: 'ch-' + id, fill_id: id, payer_id: 'p-2', card_id: 'card-3', method: 'counter', amount_cents: copay, at });
  r.fills_remaining -= 1;
  return s;
}

function only(s, keep) {
  const ids = new Set(keep);
  s.fills = s.fills.filter(f => ids.has(f.fill_id));
  for (const key of ['claims', 'charges', 'authorizations', 'plan_requests']) s[key] = s[key].filter(r => ids.has(r.fill_id));
  s.notices = s.notices.filter(n => n.subject.type !== 'fill' || ids.has(n.subject.id));
  s.grants = s.grants.filter(g => g.fill_id === null || ids.has(g.fill_id));
  return s;
}
const drop = (s, ...gone) => only(s, s.fills.map(f => f.fill_id).filter(id => !gone.includes(id)));

module.exports = { baseSeed, householdSeed, asActor, fill, rx, claim, ready, requested, withCollected, only, drop };
