'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { compile } = require('./schema-validator.cjs');
const { validateSeed } = require('../src/model.cjs');
const { baseSeed, fill, rx, claim, only, drop } = require('./seeds.cjs');
const t = require('../src/time.cjs');

const root = path.resolve(__dirname, '..');
const seedSchema = compile(require('../schemas/seed.schema.json'), path.join(root, 'schemas'));
const binding = require('../fixtures/binding.json');
const ctx = (now = '2026-11-30T09:00:00-05:00', b = binding) => ({ app_id: 'mendwell-pharmacy', run_id: 'unit', role: 'agent', virtual_now: now, binding: structuredClone(b) });
const accepts = (s, c = ctx()) => { assert.ok(seedSchema(s), 'seed schema'); validateSeed(c, s); };
const rejects = (s, pattern, c = ctx()) => {
  assert.ok(seedSchema(s), 'schema-valid, so the business check decides');
  assert.throws(() => validateSeed(c, s), e => e.code === 'invalid_seed' && pattern.test(e.message), 'expected invalid_seed matching ' + pattern);
};
const edit = fn => { const s = baseSeed(); fn(s); return s; };
const quiet = fn => edit(s => { drop(s, 'f-1'); fn(s); });
const F = (s, id) => s.fills.find(f => f.fill_id === id);
const zeroCopay = s => {
  s.plans.find(p => p.plan_id === 'plan-b').rules['d-atorvastatin-40'].copay_cents = 0;
  for (const c of s.claims) if (c.result === 'paid') c.copay_cents = 0;
  for (const f of s.fills) if (f.amount_due_cents !== null) f.amount_due_cents = 0;
};
const C = (s, id) => s.claims.find(c => c.claim_id === id);

test('T02 the base seed covers every fill state and passes', () => {
  const s = baseSeed();
  assert.deepEqual([...new Set(s.fills.map(f => f.state))].sort(), ['cancelled', 'claim_rejected', 'collected', 'pending_plan_decision', 'ready', 'requested', 'returned_to_stock', 'waiting_stock']);
  accepts(s);
  accepts(require('./unit-seed.json'));
});

test('T02 binding: owner, account and every person must be bound', () => {
  rejects(edit(s => { s.account_id = 'mendwell-p-9'; }), /not bound/);
  rejects(edit(s => { s.owner_person_id = 'p-1'; s.people.find(p => p.person_id === 'p-1').relation = 'self'; s.people.find(p => p.person_id === 'p-2').relation = 'spouse'; }), /not the bound account holder/);
  const unbound = edit(s => { s.people.push({ person_id: 'p-9', name: 'Casey Brook', relation: 'other', birth_date: '1990-01-01', is_minor: false, guardian_ids: [], plan_id: null, grant_set_version: 0 }); });
  rejects(unbound, /p-9 is not in the run binding/);
  accepts(unbound, ctx(undefined, { ...binding, people: [...binding.people, { person_id: 'p-9', name: 'Casey Brook' }] }));
});

test('T02 people: one self, guardians only for minors and only adults, plans exist', () => {
  rejects(edit(s => { s.people.find(p => p.person_id === 'p-1').relation = 'self'; }), /relation self/);
  rejects(edit(s => { s.people.find(p => p.person_id === 'p-3').guardian_ids = []; }), /no guardian/);
  rejects(edit(s => { s.people.find(p => p.person_id === 'p-1').guardian_ids = ['p-2']; }), /Adult p-1 cannot have guardians/);
  rejects(edit(s => { s.people.find(p => p.person_id === 'p-3').guardian_ids = ['p-3']; }), /must be another adult/);
  rejects(edit(s => { s.people.find(p => p.person_id === 'p-1').plan_id = 'plan-z'; }), /unknown plan plan-z/);
  accepts(edit(s => { s.people.find(p => p.person_id === 'p-1').plan_id = null; }));
});

test('T02 guardianship is the stored flag, not the birth date', () => {
  accepts(edit(s => { s.people.find(p => p.person_id === 'p-3').birth_date = '1990-01-01'; }));
  accepts(edit(s => { s.people.find(p => p.person_id === 'p-3').birth_date = '2018-09-21'; }), ctx('2040-01-01T09:00:00-05:00'));
});

test('T02 missing price, plan rule, drug or fact source is invalid_seed; an explicit zero price is valid', () => {
  rejects(edit(s => { delete s.cash_prices['d-atorvastatin-40']['30']; }), /no cash price for quantity 30/);
  rejects(edit(s => { delete s.plans.find(p => p.plan_id === 'plan-b').rules['d-atorvastatin-40']; }), /has no rule for d-atorvastatin-40/);
  rejects(edit(s => { s.prescriptions[0].drug_id = 'd-unknown'; }), /unknown drug d-unknown/);
  rejects(edit(s => { delete s.drugs[0].facts[0].source; }), /has no source/);
  rejects(edit(s => { s.cash_prices['d-atorvastatin-40']['60'] = 100; }), /does not come in: 60/);
  rejects(edit(s => { s.stores[0].stock['d-none'] = true; }), /unknown drug d-none/);
  rejects(edit(s => { s.stores[0].hours = []; }), /no opening hours/);
  rejects(edit(s => { s.issued.zz = 1; }), /Unknown ID counter zz/);
  accepts(edit(s => { s.cash_prices['d-atorvastatin-40']['30'] = 0; }));
});

test('T02 references: schema-valid missing references are invalid_seed', () => {
  rejects(edit(s => { s.prescriptions[0].prescriber_id = 'dr-9'; }), /unknown prescriber dr-9/);
  rejects(edit(s => { s.prescriptions[0].patient_id = 'p-9'; }), /unknown patient p-9/);
  rejects(edit(s => { F(s, 'f-1').store_id = 'st-9'; }), /unknown store st-9/);
  rejects(edit(s => { s.cards[0].owner_id = 'p-9'; }), /unknown person p-9/);
  rejects(edit(s => { s.charges[0].card_id = 'card-9'; }), /unknown card card-9/);
});

test('T02 unique IDs, one active fill per prescription, quantities the drug comes in', () => {
  rejects(edit(s => { s.prescriptions.push(rx('rx-1')); }), /Duplicate prescription ID rx-1/);
  rejects(edit(s => { F(s, 'f-2').rx_id = 'rx-1'; }), /rx-1 has two active fills/);
  accepts(edit(s => { F(s, 'f-8').rx_id = 'rx-1'; s.prescriptions = s.prescriptions.filter(r => r.rx_id !== 'rx-8'); }));
  rejects(edit(s => { F(s, 'f-1').quantity = 60; }), /quantity the drug does not come in/);
});

test('T02 histories are checked by reachability, so cyclic and sparse timelines pass', () => {
  accepts(edit(s => {
    const f = F(s, 'f-3');
    f.timeline = [{ state: 'requested', at: '2026-11-28T10:00:00-05:00' }, { state: 'claim_rejected', at: '2026-11-28T12:00:00-05:00' }, { state: 'pending_plan_decision', at: '2026-11-28T13:00:00-05:00' }, { state: 'claim_rejected', at: '2026-11-29T09:00:00-05:00' }];
  }));
  accepts(edit(s => { F(s, 'f-6').timeline = [{ state: 'requested', at: '2026-11-20T10:00:00-05:00' }]; }));
  accepts(edit(s => { F(s, 'f-5').timeline = [{ state: 'requested', at: '2026-11-29T10:00:00-05:00' }, { state: 'claim_rejected', at: '2026-11-29T11:00:00-05:00' }, { state: 'ready', at: '2026-11-29T12:00:00-05:00' }]; }));
  rejects(edit(s => { F(s, 'f-5').timeline.push({ state: 'waiting_stock', at: '2026-11-29T13:00:00-05:00' }); }), /from ready to waiting_stock/);
  rejects(edit(s => { F(s, 'f-1').timeline[0].state = 'ready'; }), /not reachable from its last timeline entry ready/);
  accepts(edit(s => { F(s, 'f-5').timeline = [{ state: 'ready', at: '2026-11-29T12:00:00-05:00' }]; }));
  rejects(edit(s => { F(s, 'f-5').timeline = [{ state: 'ready', at: '2026-11-29T09:00:00-05:00' }]; }), /must start at or after its request/);
  rejects(edit(s => { F(s, 'f-2').timeline[1].at = '2026-11-27T12:00:00-05:00'; }), /back in time/);
  rejects(edit(s => { F(s, 'f-5').timeline = [{ state: 'requested', at: '2026-11-29T10:00:00-05:00' }, { state: 'ready', at: '2026-11-29T12:00:00-05:00' }, { state: 'collected', at: '2026-11-29T13:00:00-05:00' }]; }), /not reachable from its last timeline entry collected/);
});

test('T02 cash keeps its rejected claim in every later state and reverses nothing', () => {
  const cash = (state, more) => edit(s => {
    const f = F(s, 'f-3');
    Object.assign(f, { state, cash: { price_cents: 2400 }, store_id: state === 'ready' ? 'st-1' : 'st-2', closed_at: more.cancellation ? more.cancellation.at : null, ...more });
    f.timeline.push({ state, at: '2026-11-28T13:00:00-05:00' });
  });
  accepts(cash('waiting_stock', {}));
  accepts(cash('ready', { amount_due_cents: 2400, ready_at: '2026-11-28T13:00:00-05:00', warning_due_at: '2026-12-05T13:00:00-05:00', return_due_at: '2026-12-08T13:00:00-05:00' }));
  accepts(edit(s => {
    const f = F(s, 'f-3');
    Object.assign(f, { state: 'collected', cash: { price_cents: 2400 }, amount_due_cents: 2400, ready_at: '2026-11-28T13:00:00-05:00', charge_id: 'ch-2', closed_at: '2026-11-28T15:00:00-05:00' });
    f.timeline.push({ state: 'ready', at: '2026-11-28T13:00:00-05:00' }, { state: 'collected', at: '2026-11-28T15:00:00-05:00' });
    s.charges.push({ charge_id: 'ch-2', fill_id: 'f-3', payer_id: 'p-2', card_id: 'card-3', method: 'counter', amount_cents: 2400, at: '2026-11-28T15:00:00-05:00' });
    s.prescriptions.find(r => r.rx_id === 'rx-3').fills_remaining = 4;
  }));
  accepts(cash('cancelled', { cancellation: { reason: 'rx_expired', stage: 'waiting_stock', at: '2026-11-28T13:00:00-05:00' } }));
  rejects(cash('ready', { amount_due_cents: 1200, ready_at: '2026-11-28T13:00:00-05:00', warning_due_at: '2026-12-05T13:00:00-05:00', return_due_at: '2026-12-08T13:00:00-05:00' }), /differs from its cash price/);
  rejects(edit(s => { F(s, 'f-5').cash = { price_cents: 2400 }; }), /cash only after a rejected claim/);
});

test('T02 collection: $0 has no charge, a positive amount has exactly one, on the payer\'s card or a captured authorization', () => {
  const zero = edit(s => { zeroCopay(s); Object.assign(F(s, 'f-6'), { charge_id: null }); s.charges = []; });
  accepts(zero);
  rejects(edit(s => { zeroCopay(s); s.charges[0].amount_cents = 0; }), /at \$0 and cannot carry a charge/);
  rejects(edit(s => { F(s, 'f-6').charge_id = null; s.charges = []; }), /not exactly one charge/);
  rejects(edit(s => { s.cards.push({ card_id: 'card-9', owner_id: 'p-1', label: 'Spouse card', last4: '1111', exp_month: 1, exp_year: 2029, status: 'active' }); s.charges[0].card_id = 'card-9'; }), /not on the payer's own card/);
  accepts(edit(s => {
    s.charges[0].method = 'capture';
    s.authorizations.push({ authorization_id: 'au-1', fill_id: 'f-6', card_id: 'card-3', amount_cents: 1200, state: 'captured', at: '2026-11-20T13:00:00-05:00', ended_at: '2026-11-21T15:00:00-05:00' });
    F(s, 'f-6').authorization_id = 'au-1';
  }));
  rejects(edit(s => { s.charges[0].method = 'capture'; }), /captures no authorization/);
});

test('T02 fills remaining account for collected fills', () => {
  rejects(edit(s => { s.prescriptions.find(r => r.rx_id === 'rx-6').fills_remaining = 5; }), /do not account for its collected fills/);
  rejects(edit(s => { s.prescriptions[0].fills_remaining = 6; }), /more fills remaining than authorized/);
});

test('T02 authorizations: live only on a ready fill, amount equal to the amount due', () => {
  const live = extra => edit(s => {
    s.authorizations.push({ authorization_id: 'au-1', fill_id: 'f-5', card_id: 'card-3', amount_cents: 1200, state: 'live', at: '2026-11-29T13:00:00-05:00', ended_at: null, ...extra });
    F(s, 'f-5').authorization_id = 'au-1';
  });
  accepts(live({}));
  rejects(edit(s => {
    s.authorizations.push({ authorization_id: 'au-1', fill_id: 'f-5', card_id: 'card-3', amount_cents: 1200, state: 'live', at: '2026-11-29T13:00:00-05:00', ended_at: null });
    F(s, 'f-5').authorization_id = 'au-1';
    s.cards[0].exp_year = 2025;
  }), /made on a card that had expired/);
  rejects(live({ amount_cents: 1000 }), /does not match the positive amount due/);
  rejects(edit(s => { s.authorizations.push({ authorization_id: 'au-1', fill_id: 'f-7', card_id: 'card-3', amount_cents: 1200, state: 'live', at: '2026-11-11T13:00:00-05:00', ended_at: null }); }), /live on a fill that is returned_to_stock/);
});

test('T02 return and cancellation reverse a paid claim; a made fill is not cancelled by expiry', () => {
  rejects(edit(s => { C(s, 'cl-6').reversed_at = null; }), /without reversing its paid claim/);
  rejects(edit(s => { C(s, 'cl-4').reversed_at = '2026-11-29T13:00:00-05:00'; }), /reversed claim while ready/);
  rejects(edit(s => {
    Object.assign(F(s, 'f-5'), { state: 'cancelled', warning_due_at: null, return_due_at: null, closed_at: '2026-11-30T08:00:00-05:00', cancellation: { reason: 'rx_expired', stage: 'ready', at: '2026-11-30T08:00:00-05:00' } });
    F(s, 'f-5').timeline.push({ state: 'cancelled', at: '2026-11-30T08:00:00-05:00' });
    C(s, 'cl-4').reversed_at = '2026-11-30T08:00:00-05:00';
  }), /cannot cancel it/);
  accepts(edit(s => {
    Object.assign(F(s, 'f-5'), { state: 'cancelled', warning_due_at: null, return_due_at: null, closed_at: '2026-11-30T08:00:00-05:00', cancellation: { reason: 'agent', stage: 'ready', at: '2026-11-30T08:00:00-05:00' } });
    F(s, 'f-5').timeline.push({ state: 'cancelled', at: '2026-11-30T08:00:00-05:00' });
    C(s, 'cl-4').reversed_at = '2026-11-30T08:00:00-05:00';
  }));
});

test('T02 a made fill may sit on an expired or superseded prescription; an unmade active one may not be superseded', () => {
  accepts(edit(s => { s.prescriptions.find(r => r.rx_id === 'rx-5').written_on = '2025-11-29'; }));
  rejects(edit(s => { s.prescriptions.find(r => r.rx_id === 'rx-5').written_on = '2025-11-28'; }), /requested after its prescription expired/);
  const superseded = id => edit(s => {
    s.prescriptions.push(rx('rx-20'));
    Object.assign(s.prescriptions.find(r => r.rx_id === id), { state: 'superseded', superseded_by: 'rx-20', superseded_at: '2026-11-29T15:00:00-05:00' });
  });
  accepts(superseded('rx-5'));
  rejects(superseded('rx-1'), /unmade on a superseded prescription/);
  rejects(edit(s => { s.prescriptions.push(rx('rx-20', { patient_id: 'p-2' })); Object.assign(s.prescriptions[0], { state: 'superseded', superseded_by: 'rx-20', superseded_at: '2026-11-29T15:00:00-05:00' }); }), /unrelated prescription/);
  accepts(edit(s => { only(s, ['f-1']); s.prescriptions.find(r => r.rx_id === 'rx-1').written_on = '2025-11-01'; F(s, 'f-1').requested_at = F(s, 'f-1').timeline[0].at = '2026-11-01T22:00:00-05:00'; F(s, 'f-1').review_due_at = '2026-11-02T10:00:00-05:00'; }));
});

test('T02 holds: remaining durations for review, warning and return; absolute expiry and resubmission kept', () => {
  accepts(edit(s => { Object.assign(F(s, 'f-1'), { review_due_at: null, hold: { note: 'Interaction flag', placed_at: '2026-11-30T09:00:00-05:00', remaining: { review_ms: 5400000 }, stored_decision: null } }); }));
  rejects(edit(s => { F(s, 'f-1').hold = { note: 'x', placed_at: '2026-11-30T09:00:00-05:00', remaining: { review_ms: 5400000 }, stored_decision: null }; }), /review_due_at must be empty/);
  rejects(edit(s => { Object.assign(F(s, 'f-1'), { review_due_at: null, hold: { note: 'x', placed_at: '2026-11-30T09:00:00-05:00', remaining: {}, stored_decision: null } }); }), /without its remaining review time/);
  accepts(edit(s => { Object.assign(F(s, 'f-5'), { warning_due_at: null, return_due_at: null, hold: { note: 'x', placed_at: '2026-11-30T08:00:00-05:00', remaining: { warning_ms: 532800000, return_ms: 792000000 }, stored_decision: null } }); }));
  rejects(edit(s => { Object.assign(F(s, 'f-5'), { warning_due_at: null, return_due_at: null, hold: { note: 'x', placed_at: '2026-11-30T08:00:00-05:00', remaining: { return_ms: 1 }, stored_decision: null } }); }), /right remaining warning and return|held return would come less than 240 hours/);
  accepts(edit(s => { Object.assign(F(s, 'f-3'), { resubmission_due_at: '2026-12-05T00:00:00-05:00', hold: { note: 'x', placed_at: '2026-11-30T08:00:00-05:00', remaining: {}, stored_decision: null } }); }));
  accepts(edit(s => { F(s, 'f-4').hold = { note: 'x', placed_at: '2026-11-30T08:00:00-05:00', remaining: {}, stored_decision: { plan_request_id: 'pr-1', decision: 'approved', at: '2026-11-30T08:30:00-05:00' } }; }));
  rejects(edit(s => { F(s, 'f-8').hold = { note: 'x', placed_at: '2026-11-25T10:40:00-05:00', remaining: {}, stored_decision: null }; }), /finished and cannot be held/);
  rejects(edit(s => { F(s, 'f-2').resubmission_due_at = '2026-12-05T00:00:00-05:00'; }), /resubmission outside a refill_too_soon/);
});

test('T02 claims: attempts numbered, paid and rejected fields, eligible date only for refill_too_soon', () => {
  rejects(edit(s => { C(s, 'cl-2').attempt = 2; }), /numbered 1, 2/);
  rejects(edit(s => { C(s, 'cl-2').eligible_on = null; }), /eligible date only when rejected refill_too_soon/);
  rejects(edit(s => { C(s, 'cl-4').reason = 'not_covered'; }), /reason must be empty/);
  accepts(edit(s => {
    s.claims.push(claim('cl-7', 'f-3', '2026-11-29T00:00:00-05:00', 'rejected', { attempt: 2, reason: 'quantity_limit' }));
    F(s, 'f-3').claim_id = 'cl-7'; F(s, 'f-3').waived = ['refill_too_soon']; F(s, 'f-3').quantity = 90;
    s.plan_requests.push({ plan_request_id: 'pr-2', fill_id: 'f-3', claim_id: 'cl-2', reason: 'refill_too_soon', state: 'approved', decision: 'approved', note: null, created_at: '2026-11-28T13:00:00-05:00', closed_at: '2026-11-29T00:00:00-05:00' });
  }));
  rejects(edit(s => { F(s, 'f-3').waived = ['prior_auth_required']; }), /waives prior_auth_required without an approved plan request/);
  rejects(edit(s => { s.claims.push(claim('cl-7', 'f-3', '2026-11-29T00:00:00-05:00', 'rejected', { attempt: 2, reason: 'prior_auth_required' })); }), /does not point at its latest claim/);
});

test('T02 grants: grantor is the patient or a guardian of a minor, one active per identity, fill only for pickup', () => {
  const g = extra => ({ grant_id: 'g-2', grant_version: 0, patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-1', scope: 'view', fill_id: null, expires_at: null, status: 'active', created_at: '2026-11-01T09:00:00-05:00', revoked_at: null, ...extra });
  accepts(edit(s => { s.grants.push(g({})); }));
  rejects(edit(s => { s.grants.push(g({ grantor_id: 'p-2' })); }), /neither the patient nor a guardian/);
  accepts(edit(s => { s.grants.push(g({ patient_id: 'p-3', grantor_id: 'p-1', grantee_id: 'p-4' })); }));
  rejects(edit(s => { s.grants.push(g({ grant_id: 'g-2', grantee_id: 'p-2', scope: 'refill' })); }), /duplicates an active grant/);
  accepts(edit(s => { s.grants.push(g({ grantee_id: 'p-2', scope: 'refill', status: 'revoked', revoked_at: '2026-11-02T09:00:00-05:00' })); }));
  rejects(edit(s => { s.grants.push(g({ fill_id: 'f-5' })); }), /not a pickup grant/);
  accepts(edit(s => { s.grants.push(g({ scope: 'pickup', fill_id: 'f-5', created_at: '2026-11-29T10:00:00-05:00' })); }));
  rejects(edit(s => { s.grants.push(g({ scope: 'pickup', fill_id: 'f-5', created_at: '2026-11-29T09:59:59-05:00' })); }), /names fill f-5 before that fill was requested/);
  rejects(edit(s => { s.grants.push(g({ patient_id: 'p-2', grantor_id: 'p-2', grantee_id: 'p-1', scope: 'pickup', fill_id: 'f-5' })); }), /another patient's fill/);
  rejects(edit(s => { s.grants.push(g({ grantee_id: 'p-4' })); }), /names the patient as grantee/);
  rejects(edit(s => { s.grants.push(g({ status: 'revoked' })); }), /revocation time exactly when revoked/);
});

test('T02 plan requests and renewals stay consistent with their fills and prescriptions', () => {
  rejects(edit(s => { s.plan_requests[0].state = 'withdrawn'; s.plan_requests[0].closed_at = '2026-11-28T09:00:00-05:00'; }), /pending a plan decision exactly when/);
  rejects(edit(s => { s.plan_requests[0].reason = 'prior_auth_required'; }), /does not address a rejection/);
  const rn = extra => ({ renewal_id: 'rn-1', rx_id: 'rx-1', state: 'pending', new_rx_id: null, note: null, created_at: '2026-11-29T09:00:00-05:00', closed_at: null, ...extra });
  accepts(edit(s => { s.renewals.push(rn({})); }));
  rejects(edit(s => { s.renewals.push(rn({}), rn({ renewal_id: 'rn-2' })); }), /two pending renewals/);
  rejects(edit(s => { s.renewals.push(rn({ state: 'approved', new_rx_id: 'rx-2', closed_at: '2026-11-29T10:00:00-05:00' })); }), /does not supersede/);
});

test('T02 approvals are accepted as stored data; notices name known records and respect limits', () => {
  accepts(edit(s => { s.approvals.push({ approval_id: 'ap-1', token: 'tok-7c1e', subject: null, confirmed_by: 'p-2', confirmed_at: '2026-11-30T08:00:00-05:00', used_at: null }); }));
  const n = extra => ({ notice_id: 'n-1', kind: 'notice.fill_ready', recipient_id: 'p-4', audience: 'full', subject: { type: 'fill', id: 'f-5' }, at: '2026-11-29T12:00:00-05:00', title: 'Fill ready for pickup', body: 'Fill f-5 is ready.', fields: {}, ...extra });
  accepts(edit(s => { s.notices.push(n({})); }));
  rejects(edit(s => { s.notices.push(n({ subject: { type: 'fill', id: 'f-99' } })); }), /unknown fill f-99/);
  rejects(edit(s => { s.notices.push(n({ body: '😀'.repeat(10001) })); }), /over the message limits/);
});

test('T02 seeds whose timers are already due are accepted as they stand', () => {
  accepts(baseSeed(), ctx('2026-12-20T09:00:00-05:00'));
});

test('T02 time: opening hours, DST gaps and overlaps, past-midnight spans, Rx expiry', () => {
  const once = (day, open, close) => ({ hours: [{ day, open, close }] });
  assert.equal(t.toIso(t.rxExpiry('2026-06-01')), '2027-06-01T23:59:00-04:00');
  assert.equal(t.toIso(t.fromLocal('2026-03-08', '02:30')), '2026-03-08T03:00:00-04:00');
  assert.deepEqual(t.intervalsOn(once(0, '01:30', '02:30'), '2026-11-01').map(i => i.map(t.toIso)), [['2026-11-01T01:30:00-04:00', '2026-11-01T02:30:00-05:00']]);
  assert.equal(t.isOpen(once(0, '01:30', '02:30'), Date.parse('2026-11-01T01:00:00-05:00')), true);
  assert.deepEqual(t.intervalsOn(once(0, '02:10', '02:40'), '2027-03-14'), []);
  assert.equal(t.toIso(t.nextOpening(once(0, '02:10', '02:40'), Date.parse('2027-03-13T12:00:00-05:00'))), '2027-03-21T02:10:00-04:00');
  assert.equal(t.isOpen(once(5, '22:00', '02:00'), Date.parse('2026-12-05T01:00:00-05:00')), true);
  assert.equal(t.isOpen(once(5, '22:00', '02:00'), Date.parse('2026-12-05T02:00:00-05:00')), false);
  assert.equal(t.isOpen(once(1, '08:00', '21:00'), Date.parse('2026-11-30T21:00:00-05:00')), false);
  assert.equal(t.isOpen(once(1, '08:00', '21:00'), Date.parse('2026-11-30T08:00:00-05:00')), true);
  assert.equal(t.toIso(t.fromLocal('2026-11-01', '00:30') + 2 * t.HOUR), '2026-11-01T01:30:00-05:00');
  assert.equal(t.toIso(t.nextOpening(once(1, '08:00', '21:00'), Date.parse('2026-11-30T21:30:00-05:00'))), '2026-12-07T08:00:00-05:00');
});

test('T02 an expired grant does not block its replacement, and the expired record is kept', () => {
  const g = extra => ({ grant_id: 'g-2', grant_version: 0, patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-2', scope: 'refill', fill_id: null, expires_at: null, status: 'active', created_at: '2026-11-30T09:00:00-05:00', revoked_at: null, ...extra });
  const s = edit(x => { x.grants[0].expires_at = '2026-11-30T09:00:00-05:00'; x.grants.push(g({})); });
  accepts(s);
  rejects(edit(x => { x.grants[0].expires_at = '2026-11-30T09:00:00.001-05:00'; x.grants.push(g({})); }), /duplicates an active grant/);
});

test('T02 every plan in use has a rule for every catalog drug, as an own property', () => {
  rejects(edit(x => { delete x.plans.find(p => p.plan_id === 'plan-b').rules['d-amoxicillin-250-5']; }), /plan-b has no rule for d-amoxicillin-250-5/);
  rejects(edit(x => { const r = x.plans.find(p => p.plan_id === 'plan-b').rules; delete r['d-amoxicillin-250-5']; r.constructor = r['d-atorvastatin-40']; }), /unknown drug constructor|has no rule/);
  assert.ok(!seedSchema(edit(x => { x.drugs[0].facts[0].source.publisher = ''; })), 'blank citation fields fail the seed schema');
  assert.ok(!seedSchema(edit(x => { x.drugs[0].facts[0].source.url = 'not a url'; })));
});

test('T02 collection stays possible: fills remaining, positive authorizations, agreeing charge records', () => {
  rejects(edit(x => { x.prescriptions.find(r => r.rx_id === 'rx-5').fills_remaining = 0; }), /active fill but no fills remaining/);
  rejects(edit(x => {
    zeroCopay(x); x.charges = []; F(x, 'f-6').charge_id = null;
    x.authorizations.push({ authorization_id: 'au-1', fill_id: 'f-5', card_id: 'card-3', amount_cents: 0, state: 'live', at: '2026-11-29T13:00:00-05:00', ended_at: null });
    F(x, 'f-5').authorization_id = 'au-1';
  }), /positive amount due/);
  rejects(edit(x => {
    x.authorizations.push({ authorization_id: 'au-1', fill_id: 'f-6', card_id: 'card-3', amount_cents: 1200, state: 'captured', at: '2026-11-20T13:00:00-05:00', ended_at: '2026-11-21T15:00:00-05:00' });
    F(x, 'f-6').authorization_id = 'au-1';
  }), /beside a captured authorization/);
});

test('T02 calendar dates and millisecond timers', () => {
  rejects(edit(x => { x.prescriptions[0].written_on = '2026-02-31'; }), /not a calendar date: 2026-02-31/);
  rejects(edit(x => { C(x, 'cl-2').eligible_on = '2026-13-01'; }), /not a calendar date/);
  assert.equal(t.toIso(Date.parse('2026-11-30T09:00:00.500-05:00') + 2 * t.HOUR), '2026-11-30T11:00:00.500-05:00');
  assert.equal(t.toIso(Date.parse('2026-11-30T09:00:00-05:00')), '2026-11-30T09:00:00-05:00');
});

test('T02 readiness, cancellation stage and pickup timers agree with history', () => {
  rejects(edit(x => { F(x, 'f-1').ready_at = '2026-11-30T08:45:00-05:00'; }), /less than 2 hours after its request/);
  rejects(edit(x => { F(x, 'f-8').cancellation.stage = 'ready'; }), /does not match whether it was made/);
  rejects(edit(x => { F(x, 'f-8').cancellation.stage = 'pending_plan_decision'; F(x, 'f-8').timeline = [{ state: 'requested', at: '2026-11-25T10:00:00-05:00' }, { state: 'ready', at: '2026-11-25T10:10:00-05:00' }, { state: 'cancelled', at: '2026-11-25T10:30:00-05:00' }]; }), /history does not reach/);
  rejects(edit(x => { F(x, 'f-5').warning_due_at = '2026-12-06T13:00:00-05:00'; }), /72 hours apart/);
  accepts(edit(x => { F(x, 'f-1').timeline = []; }));
  accepts(edit(x => { F(x, 'f-6').timeline = []; }));
});

test('T02 plan requests target the latest claim; renewals are not pending on superseded prescriptions', () => {
  rejects(edit(x => {
    x.claims.push(claim('cl-7', 'f-4', '2026-11-28T00:00:00-05:00', 'rejected', { attempt: 2, reason: 'refill_too_soon', eligible_on: '2026-12-04' }));
    F(x, 'f-4').claim_id = 'cl-7';
  }), /latest claim/);
  rejects(edit(x => {
    x.prescriptions.push(rx('rx-20'));
    Object.assign(x.prescriptions.find(r => r.rx_id === 'rx-6'), { state: 'superseded', superseded_by: 'rx-20', superseded_at: '2026-11-29T15:00:00-05:00' });
    x.renewals.push({ renewal_id: 'rn-1', rx_id: 'rx-6', state: 'pending', new_rx_id: null, note: null, created_at: '2026-11-29T16:00:00-05:00', closed_at: null });
  }), /pending on a superseded prescription/);
});

test('T02 an intended collector is covered by a matching pickup grant, or is the patient or a guardian', () => {
  const pickup = { grant_id: 'g-2', grant_version: 0, patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-1', scope: 'pickup', fill_id: 'f-5', expires_at: null, status: 'active', created_at: '2026-11-29T10:00:00-05:00', revoked_at: null };
  rejects(edit(x => { F(x, 'f-5').collector = { person_id: 'p-1', via_grant_id: 'g-1', set_at: '2026-11-29T13:00:00-05:00' }; }), /does not cover them/);
  accepts(edit(x => { x.grants.push(pickup); F(x, 'f-5').collector = { person_id: 'p-1', via_grant_id: 'g-2', set_at: '2026-11-29T13:00:00-05:00' }; }));
  rejects(edit(x => { x.grants.push({ ...pickup, fill_id: 'f-1' }); F(x, 'f-5').collector = { person_id: 'p-1', via_grant_id: 'g-2', set_at: '2026-11-29T13:00:00-05:00' }; }), /does not cover them/);
  accepts(edit(x => { F(x, 'f-5').collector = { person_id: 'p-4', via_grant_id: null, set_at: '2026-11-29T13:00:00-05:00' }; }));
  rejects(edit(x => { F(x, 'f-5').collector = { person_id: 'p-2', via_grant_id: null, set_at: '2026-11-29T13:00:00-05:00' }; }), /neither the patient nor a guardian/);
});

test('T02 objects() returns each record\'s own ID', () => {
  const { objects } = require('../src/model.cjs');
  const ids = objects(baseSeed());
  assert.ok(ids.includes('rx-1') && ids.includes('f-1') && ids.includes('g-1'));
  assert.ok(!ids.includes(undefined));
  assert.equal(ids.filter(i => i === 'dr-2').length, 1);
});

test('T02 due times agree with the fill\'s own history', () => {
  rejects(edit(x => { F(x, 'f-1').review_due_at = '2026-11-30T07:00:00-05:00'; }), /less than 2 hours after its request/);
  rejects(edit(x => { Object.assign(F(x, 'f-5'), { warning_due_at: '2026-12-05T12:00:00-05:00', return_due_at: '2026-12-08T12:00:00-05:00' }); }), /less than 168 hours after ready/);
  rejects(edit(x => { F(x, 'f-3').resubmission_due_at = '2026-11-01T00:00:00-04:00'; }), /due before the rejection it answers/);
  rejects(edit(x => { x.prescriptions.find(r => r.rx_id === 'rx-3').written_on = '2025-11-28'; F(x, 'f-3').requested_at = F(x, 'f-3').timeline[0].at = '2026-11-28T10:00:00-05:00'; F(x, 'f-3').timeline[1].at = '2026-11-29T09:00:00-05:00'; }), /history after its prescription expired|pending prescription expiry/);
  rejects(edit(x => { F(x, 'f-2').store_id = 'st-1'; }), /waits for stock at a store that has it/);
  accepts(edit(x => { Object.assign(F(x, 'f-2'), { store_id: 'st-1', hold: { note: 'x', placed_at: '2026-11-29T09:00:00-05:00', remaining: {}, stored_decision: null } }); }));
  rejects(edit(x => { F(x, 'f-6').closed_at = null; }), /closed_at is required/);
  rejects(edit(x => { F(x, 'f-5').closed_at = '2026-11-30T08:00:00-05:00'; }), /closed_at must be empty/);
  rejects(edit(x => { F(x, 'f-8').closed_at = '2026-11-25T11:00:00-05:00'; }), /cancellation time differs/);
  rejects(edit(x => { F(x, 'f-5').ready_at = F(x, 'f-5').timeline[1].at; x.prescriptions.find(r => r.rx_id === 'rx-5').written_on = '2025-11-28'; F(x, 'f-5').requested_at = F(x, 'f-5').timeline[0].at = '2026-11-28T10:00:00-05:00'; }), /became ready after its prescription expired/);
});

test('T02 the seed agrees with the price tables and plans', () => {
  rejects(edit(x => { C(x, 'cl-4').copay_cents = 1000; F(x, 'f-5').amount_due_cents = 1000; }), /copay differs from the plan rule/);
  rejects(edit(x => { x.people.find(p => p.person_id === 'p-4').plan_id = null; }), /not a not_covered rejection although the patient has no plan/);
  rejects(edit(x => { Object.assign(F(x, 'f-3'), { state: 'waiting_stock', store_id: 'st-2', cash: { price_cents: 2000 } }); F(x, 'f-3').timeline.push({ state: 'waiting_stock', at: '2026-11-28T13:00:00-05:00' }); }), /cash price differs from the price table/);
});

test('T02 same-identity active grants may not overlap in time, whatever the clock', () => {
  const g = extra => ({ grant_id: 'g-2', grant_version: 0, patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-2', scope: 'refill', fill_id: null, expires_at: null, status: 'active', created_at: '2026-12-01T09:00:00-05:00', revoked_at: null, ...extra });
  const overlapping = quiet(x => { x.grants.push(g({})); });
  rejects(overlapping, /overlapping time/, ctx('2026-12-02T09:00:00-05:00'));
  rejects(overlapping, /overlapping time/, ctx('2026-12-20T09:00:00-05:00'));
  rejects(overlapping, /after the App's current time/, ctx('2026-11-30T09:00:00-05:00'));
  const later = quiet(x => { x.grants[0].expires_at = '2026-12-01T09:00:00-05:00'; x.grants.push(g({})); });
  accepts(later, ctx('2026-12-02T09:00:00-05:00'));
  accepts(later, ctx('2026-12-20T09:00:00-05:00'));
  rejects(quiet(x => { x.grants[0].expires_at = '2026-06-02T09:00:00-04:00'; }), /expires before it starts/);
});

test('T02 collector records are checked on every fill, finished ones included', () => {
  rejects(edit(x => { F(x, 'f-6').collector = { person_id: 'p-1', via_grant_id: 'g-1', set_at: '2026-11-20T13:00:00-05:00' }; }), /does not cover them/);
  rejects(edit(x => { F(x, 'f-6').collector = { person_id: 'p-99', via_grant_id: null, set_at: '2026-11-20T13:00:00-05:00' }; }), /unknown collector p-99/);
  accepts(edit(x => { F(x, 'f-6').collector = { person_id: 'p-4', via_grant_id: null, set_at: '2026-11-20T13:00:00-05:00' }; }));
});

test('T02 more accept and reject pairs', () => {
  accepts(quiet(x => {
    x.prescriptions.push(rx('rx-20'));
    Object.assign(x.prescriptions.find(r => r.rx_id === 'rx-6'), { state: 'superseded', superseded_by: 'rx-20', superseded_at: '2026-11-29T15:00:00-05:00' });
    x.renewals.push({ renewal_id: 'rn-1', rx_id: 'rx-6', state: 'approved', new_rx_id: 'rx-20', note: null, created_at: '2026-11-28T16:00:00-05:00', closed_at: '2026-11-29T15:00:00-05:00' });
  }));
  accepts(quiet(x => {
    const f = F(x, 'f-3');
    Object.assign(f, { state: 'returned_to_stock', cash: { price_cents: 2400 }, amount_due_cents: 2400, ready_at: '2026-11-18T13:00:00-05:00', warned_at: '2026-11-25T13:00:00-05:00', closed_at: '2026-11-28T13:00:00-05:00' });
    f.requested_at = f.timeline[0].at = '2026-11-18T10:00:00-05:00'; f.timeline[1].at = '2026-11-18T12:00:00-05:00';
    C(x, 'cl-2').at = '2026-11-18T12:00:00-05:00';
    f.timeline.push({ state: 'ready', at: '2026-11-18T13:00:00-05:00' }, { state: 'returned_to_stock', at: '2026-11-28T13:00:00-05:00' });
  }));
  accepts(quiet(x => { Object.assign(F(x, 'f-5'), { warning_due_at: null, return_due_at: null, warned_at: '2026-12-06T12:00:00-05:00', hold: { note: 'x', placed_at: '2026-12-07T08:00:00-05:00', remaining: { return_ms: 187200000 }, stored_decision: null } }); }), ctx('2026-12-07T09:00:00-05:00'));
  rejects(quiet(x => { F(x, 'f-3').hold = { note: 'x', placed_at: '2026-11-29T09:00:00-05:00', remaining: {}, stored_decision: { plan_request_id: 'pr-1', decision: 'approved', at: '2026-11-29T09:30:00-05:00' } }; }), /stores a decision for a request it is not waiting on/);
  rejects(quiet(x => { C(x, 'cl-1').fill_id = 'f-99'; }), /unknown fill f-99/);
  rejects(quiet(x => { x.plan_requests[0].claim_id = 'cl-99'; }), /unknown claim cl-99/);
  rejects(quiet(x => { x.renewals.push({ renewal_id: 'rn-1', rx_id: 'rx-99', state: 'pending', new_rx_id: null, note: null, created_at: '2026-11-29T09:00:00-05:00', closed_at: null }); }), /unknown prescription rx-99/);
  rejects(quiet(x => { x.grants[0].grantee_id = 'p-99'; }), /unknown grantee p-99/);
  rejects(quiet(x => { x.authorizations.push({ authorization_id: 'au-1', fill_id: 'f-5', card_id: 'card-99', amount_cents: 1200, state: 'live', at: '2026-11-29T13:00:00-05:00', ended_at: null }); }), /unknown card card-99/);
});

test('T02 time edges: a closing inside the spring gap, 24-hour spans on both DST days, leap-year expiry', () => {
  const once = (day, open, close) => ({ hours: [{ day, open, close }] });
  assert.deepEqual(t.intervalsOn(once(0, '01:00', '02:30'), '2026-03-08').map(i => i.map(t.toIso)), [['2026-03-08T01:00:00-05:00', '2026-03-08T03:00:00-04:00']]);
  const spring = t.intervalsOn(once(0, '00:00', '00:00'), '2026-03-08')[0];
  assert.equal((spring[1] - spring[0]) / t.HOUR, 23);
  const fall = t.intervalsOn(once(0, '00:00', '00:00'), '2026-11-01')[0];
  assert.equal((fall[1] - fall[0]) / t.HOUR, 25);
  assert.equal(t.toIso(t.rxExpiry('2027-03-01')), '2028-02-29T23:59:00-05:00');
  assert.equal(t.toIso(t.rxExpiry('2028-02-29')), '2029-02-28T23:59:00-05:00');
});

test('T02 empty and terminal-only timelines, hold, closing and clock bounds', () => {
  accepts(edit(x => { Object.assign(F(x, 'f-8'), { timeline: [{ state: 'cancelled', at: '2026-11-25T10:30:00-05:00' }] }); }));
  accepts(edit(x => { F(x, 'f-8').timeline = []; }));
  rejects(edit(x => { Object.assign(F(x, 'f-1'), { review_due_at: null, hold: { note: 'x', placed_at: '2026-11-30T08:40:00-05:00', remaining: { review_ms: 1 }, stored_decision: null } }); }), /held review would complete less than 2 hours/);
  accepts(edit(x => { Object.assign(F(x, 'f-1'), { review_due_at: null, hold: { note: 'x', placed_at: '2026-11-30T08:40:00-05:00', remaining: { review_ms: 6600000 }, stored_decision: null } }); }));
  rejects(edit(x => { Object.assign(F(x, 'f-1'), { review_due_at: null, hold: { note: 'x', placed_at: '2026-11-30T08:00:00-05:00', remaining: { review_ms: 9000000 }, stored_decision: null } }); }), /held before it was requested/);
  rejects(edit(x => { Object.assign(F(x, 'f-5'), { warning_due_at: null, return_due_at: null, hold: { note: 'x', placed_at: '2026-11-29T13:00:00-05:00', remaining: { warning_ms: 3600000, return_ms: 262800000 }, stored_decision: null } }); }), /held pickup warning would come less than 168 hours/);
  rejects(edit(x => { F(x, 'f-6').closed_at = F(x, 'f-6').timeline[2].at = x.charges[0].at = '2026-11-20T11:00:00-05:00'; }), /closed before it became ready|back in time/);
  rejects(edit(x => { F(x, 'f-6').closed_at = '2026-11-21T16:00:00-05:00'; }), /closing time differs from its collected timeline entry/);
  rejects(edit(x => { F(x, 'f-6').timeline.pop(); F(x, 'f-6').closed_at = '2026-11-21T16:00:00-05:00'; }), /not made at collection/);
  rejects(edit(x => { F(x, 'f-7').closed_at = F(x, 'f-7').timeline[2].at = C(x, 'cl-6').reversed_at = '2026-11-19T12:00:00-05:00'; }), /returned to stock less than 240 hours/);
  rejects(edit(x => { F(x, 'f-7').warned_at = '2026-11-16T12:00:00-05:00'; }), /warned less than 168 hours/);
  rejects(edit(x => { F(x, 'f-7').warned_at = '2026-11-21T12:00:00-05:00'; }), /warned after it was closed/);
  rejects(edit(x => { F(x, 'f-1').requested_at = F(x, 'f-1').timeline[0].at = '2026-11-30T09:30:00-05:00'; F(x, 'f-1').review_due_at = '2026-11-30T11:30:00-05:00'; }), /after the App's current time/);
});

test('T02 resubmission floor, applied plan approvals, citation fields', () => {
  rejects(edit(x => { F(x, 'f-3').resubmission_due_at = '2026-11-30T09:00:00-05:00'; }), /before 00:00 local on its eligible date/);
  accepts(edit(x => { F(x, 'f-3').resubmission_due_at = '2026-12-05T00:00:00-05:00'; }));
  rejects(edit(x => { Object.assign(x.plan_requests[0], { state: 'approved', decision: 'approved', closed_at: '2026-11-28T09:00:00-05:00' }); F(x, 'f-4').state = 'claim_rejected'; F(x, 'f-4').plan_request_id = 'pr-1'; }), /left no waiver and no later claim attempt/);
  rejects(edit(x => { x.drugs[0].facts[0].source.publisher = '   '; }), /blank publisher/);
  rejects(edit(x => { x.drugs[0].facts[0].source.url = 'https://?'; }), /no valid https URL/);
});

test('T02 request and event IDs follow the ID grammar', () => {
  const events = compile(require('../schemas/events.schema.json'), path.join(root, 'schemas'));
  const restock = id => ({ event_id: id, at: '2026-11-30T10:00:00-05:00', operation: 'store.restocked', payload: { store_id: 'st-2', drug_id: 'd-atorvastatin-40' } });
  assert.ok(events(restock('ev-7')));
  assert.ok(!events(restock('bad id')));
  assert.ok(!events(restock('x'.repeat(101))));
  const tools = require('../tools.json');
  const write = compile(tools.find(t => t.name === 'mendwell-pharmacy.fills.wait').inputSchema, root);
  assert.ok(write({ request_id: 'r-1', expected_version: { epoch: 1, revision: 0 }, fill_id: 'f-1' }));
  assert.ok(!write({ request_id: 'bad id', expected_version: { epoch: 1, revision: 0 }, fill_id: 'f-1' }));
});

test('T02 projection IDs are reserved as they are handed out', () => {
  const { nextId, PROJECTION } = require('../src/util.cjs');
  const d = baseSeed(); d.issued.cl = 999999999; d[PROJECTION] = true;
  assert.notEqual(nextId(d, 'cl'), nextId(d, 'cl'));
});

test('T02 recorded events precede the fill\'s pending timers', () => {
  rejects(quiet(x => { Object.assign(F(x, 'f-5'), { warning_due_at: null, warned_at: '2026-12-10T09:00:00-05:00' }); }), /pending return due/, ctx('2026-12-10T10:00:00-05:00'));
  accepts(quiet(x => { Object.assign(F(x, 'f-5'), { warning_due_at: null, warned_at: '2026-12-06T12:00:00-05:00' }); }), ctx('2026-12-10T10:00:00-05:00'));
  rejects(quiet(x => { F(x, 'f-5').refusals.push({ refusal_id: 'rf-1', reason: 'store_closed', collector_id: 'p-2', at: '2026-12-09T12:00:00-05:00' }); }), /pending (warning|return) due/, ctx('2026-12-10T10:00:00-05:00'));
  accepts(quiet(x => { F(x, 'f-5').refusals.push({ refusal_id: 'rf-1', reason: 'store_closed', collector_id: 'p-2', at: '2026-12-01T22:00:00-05:00' }); }), ctx('2026-12-10T10:00:00-05:00'));
  rejects(quiet(x => { F(x, 'f-3').resubmission_due_at = '2026-12-05T00:00:00-05:00'; F(x, 'f-3').notes.push({ at: '2026-12-05T09:00:00-05:00', text: 'Called the plan' }); }), /pending resubmission due/, ctx('2026-12-06T09:00:00-05:00'));
  accepts(quiet(x => { Object.assign(F(x, 'f-3'), { resubmission_due_at: '2026-12-05T00:00:00-05:00', hold: { note: 'x', placed_at: '2026-12-04T09:00:00-05:00', remaining: {}, stored_decision: null } }); F(x, 'f-3').notes.push({ at: '2026-12-05T09:00:00-05:00', text: 'Pharmacist note' }); }), ctx('2026-12-06T09:00:00-05:00'));
  accepts(baseSeed(), ctx('2026-12-20T09:00:00-05:00'));
});

test('T02 an approval naming a missing claim is invalid_seed, not a crash; a collector\'s grant was in force when set', () => {
  rejects(edit(x => { Object.assign(x.plan_requests[0], { state: 'approved', decision: 'approved', closed_at: '2026-11-28T09:00:00-05:00', claim_id: 'cl-missing' }); F(x, 'f-4').state = 'claim_rejected'; F(x, 'f-4').waived = ['refill_too_soon']; }), /unknown claim cl-missing/);
  const pickup = { grant_id: 'g-2', grant_version: 0, patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-1', scope: 'pickup', fill_id: null, expires_at: null, status: 'active', created_at: '2026-11-22T09:00:00-05:00', revoked_at: null };
  rejects(edit(x => { x.grants.push(pickup); F(x, 'f-6').collector = { person_id: 'p-1', via_grant_id: 'g-2', set_at: '2026-11-20T13:00:00-05:00' }; }), /not in force when the collector was set/);
  accepts(edit(x => { x.grants.push({ ...pickup, created_at: '2026-11-20T12:30:00-05:00' }); F(x, 'f-6').collector = { person_id: 'p-1', via_grant_id: 'g-2', set_at: '2026-11-20T13:00:00-05:00' }; }));
});

test('T02 claim times agree with the fill', () => {
  rejects(edit(x => { C(x, 'cl-6').reversed_at = '2026-11-19T12:00:00-05:00'; }), /reversed at a different time from when it closed/);
  rejects(edit(x => { C(x, 'cl-2').at = '2020-01-01T00:00:00-05:00'; }), /before its fill's review could finish/);
});

test('T02 paused durations are positive and a held fill is not warned during the hold', () => {
  const held = (placed, remaining, warned) => quiet(x => { Object.assign(F(x, 'f-5'), { warning_due_at: null, return_due_at: null, warned_at: warned, hold: { note: 'x', placed_at: placed, remaining, stored_decision: null } }); });
  rejects(held('2026-12-09T12:00:00-05:00', { return_ms: 0 }, '2026-12-06T12:00:00-05:00'), /no return time left/, ctx('2026-12-10T09:00:00-05:00'));
  accepts(held('2026-12-09T11:00:00-05:00', { return_ms: 3600000 }, '2026-12-06T12:00:00-05:00'), ctx('2026-12-10T09:00:00-05:00'));
  rejects(held('2026-12-07T08:00:00-05:00', { return_ms: 187200000 }, '2026-12-08T12:00:00-05:00'), /warned while held/, ctx('2026-12-10T09:00:00-05:00'));
  accepts(held('2026-12-06T12:00:00-05:00', { return_ms: 259200000 }, '2026-12-06T12:00:00-05:00'), ctx('2026-12-10T09:00:00-05:00'));
  rejects(edit(x => { Object.assign(F(x, 'f-1'), { review_due_at: null, hold: { note: 'x', placed_at: '2026-11-30T08:40:00-05:00', remaining: { review_ms: 0 }, stored_decision: null } }); }), /no review time left|less than 2 hours/);
});
