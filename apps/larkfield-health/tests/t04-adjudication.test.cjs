'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const S = require('./seeds.cjs');
const A = require('../src/adjudication.cjs');
const { ms, toIso, fromLocal, addDays, endOfDay } = require('../src/time.cjs');

const H = S.household();
const services = new Map(H.services.map(s => [s.service_id, s]));
const ctx = now => ({ app_id: 'larkfield-health', run_id: 'unit', role: 'agent', virtual_now: now ?? '2026-11-18T12:00:00-05:00', binding: structuredClone(require('../fixtures/binding.json')) });
const R = (s, pattern, now) => assert.throws(() => plugin.validateSeed(ctx(now), s), e => e.code === 'invalid_seed' && pattern.test(e.message), String(pattern));
const L = (s, now) => assert.doesNotThrow(() => plugin.validateSeed(ctx(now), s));
const planWith = over => { const p = structuredClone(H.plan); for (const [y, o] of Object.entries(over)) p.years[y] = { ...p.years[y], ...o }; return p; };
const cell = (md = 0, mo = 0, fd = md, fo = mo) => ({ member: { deductible_cents: md, oop_cents: mo }, family: { deductible_cents: fd, oop_cents: fo } });
const ln = (id, pos, svc, date, billed, extra) => S.line(id, pos, svc, date, billed, extra);
const parts = l => [l.status, l.reason, l.allowed_cents, l.copay_cents, l.deductible_cents, l.coinsurance_cents, l.member_cost_cents, l.plan_paid_cents, l.not_allowed_cents, l.pa_id, l.pa_units];
const paidAs = (allowed, copay, ded, coins, billed, pa = null, units = 0) => ['paid', null, allowed, copay, ded, coins, copay + ded + coins, allowed - copay - ded - coins, billed - allowed, pa, units];
const deniedAs = (reason, billed) => ['denied', reason, 0, 0, 0, 0, 0, 0, billed, null, 0];

function run(lines, { plan = H.plan, ledger = { 2026: cell() }, outcomes = {}, pas = [], network = true, member = 'm-1' } = {}) {
  const before = structuredClone(ledger), pool = structuredClone(pas);
  const out = A.adjudicate({ plan, services, provider: { in_network: network }, memberId: member, lines, ledger, outcomes, pas });
  assert.deepEqual([ledger, pas], [before, pool]);
  assert.deepEqual(out.lines.map(l => l.line_id), lines.map(l => l.line_id));
  out.lines.forEach((l, i) => assert.equal(lines[i].billed_cents, l.plan_paid_cents + l.member_cost_cents + l.not_allowed_cents));
  return out;
}

test('T04 copays count toward the out-of-pocket maximum and stop at it; they never touch the deductible', () => {
  const plan = planWith({ 2026: { deductible: { individual_cents: 5000, family_cents: 300000 }, oop_max: { individual_cents: 6000, family_cents: 800000 } } });
  const lines = [1, 2, 3, 4].map(i => ln('ln-' + i, i, 'svc-office-visit', '2026-11-10', 21000));
  const out = run(lines, { plan });
  assert.deepEqual(out.lines.map(parts), [paidAs(18000, 2500, 0, 0, 21000), paidAs(18000, 2500, 0, 0, 21000), paidAs(18000, 1000, 0, 0, 21000), paidAs(18000, 0, 0, 0, 21000)]);
  assert.deepEqual(out.ledger, { 2026: cell(0, 6000) });
  assert.deepEqual(out.postings, [{ member_id: 'm-1', plan_year: 2026, deductible_cents: 0, oop_cents: 6000 }]);
});

test('T04 the deductible comes first and coinsurance after it, across claims and in service-date order within one', () => {
  const a = run([ln('ln-1', 1, 'svc-knee-mri', '2026-11-01', 100000)]);
  assert.deepEqual(parts(a.lines[0]), paidAs(100000, 0, 100000, 0, 100000));
  const b = run([ln('ln-1', 1, 'svc-knee-mri', '2026-11-02', 120000)], { ledger: a.ledger });
  assert.deepEqual(parts(b.lines[0]), paidAs(120000, 0, 50000, 14000, 120000));
  const c = run([ln('ln-1', 1, 'svc-knee-mri', '2026-11-03', 160000)], { ledger: b.ledger });
  assert.deepEqual(parts(c.lines[0]), paidAs(150000, 0, 0, 30000, 160000));
  assert.deepEqual(c.ledger, { 2026: cell(150000, 194000) });
  const d = run([ln('ln-1', 1, 'svc-lab-panel', '2026-11-05', 9000), ln('ln-2', 2, 'svc-knee-mri', '2026-11-02', 150000)], { ledger: { 2026: cell(145000, 145000) } });
  assert.deepEqual(d.lines.map(parts), [paidAs(9000, 0, 0, 1800, 9000), paidAs(150000, 0, 5000, 29000, 150000)]);
  const same = run([ln('ln-1', 1, 'svc-lab-panel', '2026-11-02', 9000), ln('ln-2', 2, 'svc-knee-mri', '2026-11-02', 150000)], { ledger: { 2026: cell(145000, 145000) } });
  assert.deepEqual(same.lines.map(parts), [paidAs(9000, 0, 5000, 800, 9000), paidAs(150000, 0, 0, 30000, 150000)]);
});

test('T04 the individual and the family out-of-pocket caps each stop the member share on their own, also in the middle of a line', () => {
  const indiv = run([ln('ln-1', 1, 'svc-knee-mri', '2026-11-01', 150000), ln('ln-2', 2, 'svc-knee-mri', '2026-11-02', 150000)], { ledger: { 2026: cell(150000, 399000) } });
  assert.deepEqual(indiv.lines.map(parts), [paidAs(150000, 0, 0, 1000, 150000), paidAs(150000, 0, 0, 0, 150000)]);
  assert.deepEqual(indiv.ledger, { 2026: cell(150000, 400000) });
  const fam = run([ln('ln-1', 1, 'svc-knee-mri', '2026-11-01', 150000)], { ledger: { 2026: cell(150000, 100000, 300000, 799000) } });
  assert.deepEqual(parts(fam.lines[0]), paidAs(150000, 0, 0, 1000, 150000));
  assert.deepEqual(fam.ledger, { 2026: cell(150000, 101000, 300000, 800000) });
  const mid = run([ln('ln-1', 1, 'svc-knee-mri', '2026-11-01', 150000)], { ledger: { 2026: cell(100000, 395000) } });
  assert.deepEqual(parts(mid.lines[0]), paidAs(150000, 0, 5000, 0, 150000));
  assert.deepEqual(mid.ledger, { 2026: cell(105000, 400000) });
  const famMid = run([ln('ln-1', 1, 'svc-office-visit', '2026-11-01', 21000)], { ledger: { 2026: cell(0, 0, 0, 799000) } });
  assert.deepEqual(parts(famMid.lines[0]), paidAs(18000, 1000, 0, 0, 21000));
});

test('T04 the family deductible met by two members stops a third member\'s deductible; a partly met one binds before the individual', () => {
  const s = run([ln('ln-1', 1, 'svc-knee-mri', '2026-11-01', 100000)], { member: 'm-3', ledger: { 2026: cell(0, 0, 300000, 300000) } });
  assert.deepEqual(parts(s.lines[0]), paidAs(100000, 0, 0, 20000, 100000));
  assert.deepEqual(s.postings, [{ member_id: 'm-3', plan_year: 2026, deductible_cents: 0, oop_cents: 20000 }]);
  const plan = planWith({ 2026: { deductible: { individual_cents: 150000, family_cents: 200000 } } });
  const p = run([ln('ln-1', 1, 'svc-knee-mri', '2026-11-01', 150000)], { plan, member: 'm-2', ledger: { 2026: cell(0, 0, 150000, 150000) } });
  assert.deepEqual(parts(p.lines[0]), paidAs(150000, 0, 50000, 20000, 150000));
  assert.deepEqual(p.ledger, { 2026: cell(50000, 70000, 200000, 220000) });
});

test('T04 coinsurance rounds half up: the helper at 15% and 20%, and a 15% plan line', () => {
  assert.deepEqual([[10, 15], [30, 15], [70, 15], [1, 15], [2, 20], [3, 20], [7, 20], [8, 20], [0, 20], [100010, 15], [5, 50], [3, 50], [99, 100], [7, 7], [107, 7]].map(([c, p]) => A.halfUp(c, p)), [2, 5, 11, 0, 0, 1, 1, 2, 0, 15002, 3, 2, 99, 0, 7]);
  const out = run([ln('ln-1', 1, 'svc-knee-mri', '2026-11-01', 100010)], { plan: planWith({ 2026: { coinsurance_pct: 15 } }), ledger: { 2026: cell(150000, 150000) } });
  assert.deepEqual(parts(out.lines[0]), paidAs(100010, 0, 0, 15002, 100010));
});

test('T04 allowed is the lesser of billed and fee times units; a copay above it is cut to it; every paid line balances billed', () => {
  const out = run([ln('ln-1', 1, 'svc-specialist-visit', '2026-11-01', 3000), ln('ln-2', 2, 'svc-office-visit', '2026-11-01', 0), ln('ln-3', 3, 'svc-office-visit', '2026-11-01', 50000, { units: 2 }), ln('ln-4', 4, 'svc-lab-panel', '2026-11-01', 9000, { units: 3 })]);
  assert.deepEqual(out.lines.map(parts), [paidAs(3000, 3000, 0, 0, 3000), paidAs(0, 0, 0, 0, 0), paidAs(36000, 2500, 0, 0, 50000), paidAs(9000, 0, 9000, 0, 9000)]);
});

test('T04 amounts at the bounds stay exact', () => {
  const out = run([ln('ln-1', 1, 'svc-office-visit', '2026-11-01', 100000000, { units: 1000 }), ln('ln-2', 2, 'svc-arthroscopy', '2026-11-02', 100000000, { units: 1000, emergency: true })]);
  assert.deepEqual(out.lines.map(parts), [paidAs(18000000, 2500, 0, 0, 100000000), paidAs(100000000, 0, 150000, 247500, 100000000)]);
  assert.deepEqual(out.ledger, { 2026: cell(150000, 400000) });
});

test('T04 line outcomes: other_primary standing or answer and work_related deny as other_party_liable, kept over a later expiry; an expiry alone is missing_information; other answers pay', () => {
  const ans = (type, answer) => ({ type, status: 'answered', answer });
  const exp = type => ({ type, status: 'expired', answer: null });
  const open = type => ({ type, status: 'open', answer: null });
  const cases = [
    ['other_primary', [], 'other_party_liable'], ['none', [ans('other_coverage', 'other_primary')], 'other_party_liable'], ['unknown', [ans('accident', 'work_related'), exp('other_coverage')], 'other_party_liable'],
    ['none', [exp('accident'), ans('other_coverage', 'other_primary')], 'other_party_liable'], ['other_primary', [exp('accident')], 'other_party_liable'], ['none', [exp('accident')], 'missing_information'],
    ['unknown', [ans('other_coverage', 'none'), exp('accident')], 'missing_information'], ['other_secondary', [ans('other_coverage', 'other_secondary'), ans('accident', 'accident')], null],
    ['none', [ans('accident', 'not_accident')], null], ['unknown', [ans('other_coverage', 'none')], null], ['none', [], null], ['unknown', [open('accident')], null],
  ];
  for (const [standing, requests, want] of cases) assert.equal(A.lineOutcome(standing, requests), want, standing + ' ' + JSON.stringify(requests));
});

test('T04 a request outcome comes before the network and PA checks; the network check comes before the PA check', () => {
  const lines = [ln('ln-1', 1, 'svc-arthroscopy', '2026-11-01', 800000), ln('ln-2', 2, 'svc-knee-mri', '2026-11-01', 150000), ln('ln-3', 3, 'svc-office-visit', '2026-11-01', 18000), ln('ln-4', 4, 'svc-er-visit', '2026-11-01', 220000, { emergency: true })];
  const out = run(lines, { network: false, outcomes: { 'ln-1': 'other_party_liable', 'ln-2': 'missing_information', 'ln-4': 'other_party_liable', 'ln-3': null } });
  assert.deepEqual(out.lines.map(parts), [deniedAs('other_party_liable', 800000), deniedAs('missing_information', 150000), deniedAs('out_of_network', 18000), deniedAs('other_party_liable', 220000)]);
  assert.deepEqual([out.ledger, out.postings, out.pa_use], [{ 2026: cell() }, [{ member_id: 'm-1', plan_year: 2026, deductible_cents: 0, oop_cents: 0 }], []]);
  const pa = [{ pa_id: 'pa-1', service_id: 'svc-arthroscopy', valid_from: '2026-10-01', valid_until: '2026-12-31', remaining: 3 }];
  assert.deepEqual(parts(run([lines[0]], { network: false, pas: pa }).lines[0]), deniedAs('out_of_network', 800000));
  assert.deepEqual(parts(run([lines[0]]).lines[0]), deniedAs('prior_auth_missing', 800000));
  assert.deepEqual(parts(run([lines[0]], { outcomes: { 'ln-1': 'missing_information' }, pas: pa }).lines[0]), deniedAs('missing_information', 800000));
});

test('T04 an emergency line is priced at in-network sharing with its service\'s own category, with no PA check and no units', () => {
  const pa = [{ pa_id: 'pa-1', service_id: 'svc-arthroscopy', valid_from: '2026-10-01', valid_until: '2026-12-31', remaining: 3 }];
  const plan = planWith({ 2026: { copays: { office: 2500, imaging: 10000, emergency: 25000 } } });
  const out = run([ln('ln-1', 1, 'svc-arthroscopy', '2026-11-01', 900000, { emergency: true }), ln('ln-2', 2, 'svc-knee-mri', '2026-11-01', 180000, { emergency: true }), ln('ln-3', 3, 'svc-er-visit', '2026-11-01', 220000, { emergency: true })], { plan, network: false, pas: pa });
  assert.deepEqual(out.lines.map(parts), [paidAs(800000, 0, 150000, 130000, 900000), paidAs(150000, 10000, 0, 0, 180000), paidAs(220000, 25000, 0, 0, 220000)]);
  assert.deepEqual(out.pa_use, []);
  assert.deepEqual(parts(run([ln('ln-1', 1, 'svc-knee-mri', '2026-11-01', 180000)], { network: false }).lines[0]), deniedAs('out_of_network', 180000));
});

test('T04 PA attribution: validity bounds inclusive, remaining units cover the line, earliest valid_until first, then the lower ID as a string; units are used in line order', () => {
  const pa = (id, from, until, remaining, service = 'svc-physical-therapy') => ({ pa_id: id, service_id: service, valid_from: from, valid_until: until, remaining });
  const pt = (id, pos, date, units = 1) => ln(id, pos, 'svc-physical-therapy', date, 15000 * units, { units });
  const at = (date, pool) => parts(run([pt('ln-1', 1, date)], { pas: pool }).lines[0]);
  const one = [pa('pa-1', '2026-11-05', '2026-11-20', 1)];
  assert.deepEqual([at('2026-11-05', one), at('2026-11-20', one)], [paidAs(15000, 3500, 0, 0, 15000, 'pa-1', 1), paidAs(15000, 3500, 0, 0, 15000, 'pa-1', 1)]);
  assert.deepEqual([at('2026-11-04', one), at('2026-11-21', one), at('2026-11-10', [pa('pa-1', '2026-11-05', '2026-11-20', 1, 'svc-arthroscopy')])], [deniedAs('prior_auth_missing', 15000), deniedAs('prior_auth_missing', 15000), deniedAs('prior_auth_missing', 15000)]);
  assert.deepEqual(parts(run([pt('ln-1', 1, '2026-11-10', 2)], { pas: one }).lines[0]), deniedAs('prior_auth_missing', 30000));
  const two = run([pt('ln-1', 1, '2026-11-10', 2)], { pas: [pa('pa-1', '2026-11-05', '2026-11-20', 2)] });
  assert.deepEqual([parts(two.lines[0]), two.pa_use], [paidAs(30000, 3500, 0, 0, 30000, 'pa-1', 2), [{ pa_id: 'pa-1', units: 2 }]]);
  const overlap = run([pt('ln-1', 1, '2026-11-10'), pt('ln-2', 2, '2026-12-05'), pt('ln-3', 3, '2026-11-15')], { pas: [pa('pa-b', '2026-11-01', '2026-12-31', 5), pa('pa-a', '2026-11-01', '2026-11-30', 1)] });
  assert.deepEqual(overlap.lines.map(l => l.pa_id), ['pa-a', 'pa-b', 'pa-b']);
  assert.deepEqual(overlap.pa_use, [{ pa_id: 'pa-a', units: 1 }, { pa_id: 'pa-b', units: 1 }, { pa_id: 'pa-b', units: 1 }]);
  const tie = run([pt('ln-1', 1, '2026-11-10'), pt('ln-2', 2, '2026-11-11')], { pas: [pa('pa-2', '2026-11-01', '2026-12-31', 1), pa('pa-1', '2026-11-02', '2026-12-31', 1)] });
  assert.deepEqual(tie.lines.map(l => l.pa_id), ['pa-1', 'pa-2']);
  assert.deepEqual(run([pt('ln-1', 1, '2026-11-10')], { pas: [pa('pa-1', '2026-11-01', '2026-12-31', 1), pa('pa-2', '2026-11-01', '2026-11-30', 1)] }).lines[0].pa_id, 'pa-2');
  assert.deepEqual(run([pt('ln-1', 1, '2026-11-10')], { pas: [pa('pa-9', '2026-11-01', '2026-12-31', 1), pa('pa-10', '2026-11-01', '2026-12-31', 1)] }).lines[0].pa_id, 'pa-10');
  const sameDay = run([pt('ln-a', 1, '2026-11-10'), pt('ln-b', 2, '2026-11-10')], { pas: one });
  assert.deepEqual(sameDay.lines.map(l => [l.line_id, l.status, l.reason]), [['ln-a', 'paid', null], ['ln-b', 'denied', 'prior_auth_missing']]);
  const byDate = run([pt('ln-a', 1, '2026-11-12'), pt('ln-b', 2, '2026-11-10')], { pas: one });
  assert.deepEqual(byDate.lines.map(l => [l.line_id, l.status]), [['ln-a', 'denied'], ['ln-b', 'paid']]);
  const later = run([ln('ln-1', 1, 'svc-office-visit', '2026-11-10', 18000)], { pas: one });
  assert.deepEqual([later.lines[0].pa_id, later.pa_use], [null, []]);
});

test('T04 a claim across a plan-year boundary posts each line to its own year, with that year\'s plan', () => {
  const plan = planWith({ 2025: { deductible: { individual_cents: 100000, family_cents: 300000 } }, 2027: { copays: { office: 3000 } } });
  const a = run([ln('ln-1', 1, 'svc-knee-mri', '2025-12-31', 150000), ln('ln-2', 2, 'svc-knee-mri', '2026-01-01', 150000)], { plan, ledger: { 2025: cell(90000, 90000), 2026: cell() } });
  assert.deepEqual(a.lines.map(parts), [paidAs(150000, 0, 10000, 28000, 150000), paidAs(150000, 0, 150000, 0, 150000)]);
  assert.deepEqual(a.postings, [{ member_id: 'm-1', plan_year: 2025, deductible_cents: 10000, oop_cents: 38000 }, { member_id: 'm-1', plan_year: 2026, deductible_cents: 150000, oop_cents: 150000 }]);
  assert.deepEqual(a.ledger, { 2025: cell(100000, 128000), 2026: cell(150000, 150000) });
  const b = run([ln('ln-1', 1, 'svc-office-visit', '2027-01-01', 21000), ln('ln-2', 2, 'svc-office-visit', '2026-12-31', 21000)], { plan, ledger: { 2026: cell(0, 399000), 2027: cell() } });
  assert.deepEqual(b.lines.map(parts), [paidAs(18000, 3000, 0, 0, 21000), paidAs(18000, 1000, 0, 0, 21000)]);
  assert.deepEqual(b.postings.map(p => [p.plan_year, p.oop_cents]), [[2026, 1000], [2027, 3000]]);
});

test('T04 an overturn reprices the named lines as covered against one running ledger in line order and copies the rest', () => {
  const lines = [ln('ln-1', 1, 'svc-knee-mri', '2026-11-11', 180000), ln('ln-2', 2, 'svc-specialist-visit', '2026-11-11', 32000), ln('ln-3', 3, 'svc-office-visit', '2026-11-10', 21000), ln('ln-4', 4, 'svc-arthroscopy', '2026-11-12', 800000)];
  const previous = [S.denied('ln-1', 'out_of_network', 180000), S.denied('ln-2', 'out_of_network', 32000), S.paid('ln-3', 18000, { copay: 2500 }, 21000), S.denied('ln-4', 'prior_auth_missing', 800000)];
  const ledger = { 2026: cell(100000, 102500) };
  const out = A.overturn({ plan: H.plan, services, memberId: 'm-1', lines, previous, named: ['ln-4', 'ln-2', 'ln-1'], ledger });
  assert.deepEqual(ledger, { 2026: cell(100000, 102500) });
  assert.deepEqual(out.lines.map(parts), [paidAs(150000, 0, 50000, 20000, 180000), paidAs(30000, 5000, 0, 0, 32000), paidAs(18000, 2500, 0, 0, 21000), paidAs(800000, 0, 0, 160000, 800000)]);
  assert.deepEqual(out.lines[2], previous[2]);
  assert.notEqual(out.lines[2], previous[2]);
  assert.deepEqual(out.postings, [{ member_id: 'm-1', plan_year: 2026, deductible_cents: 50000, oop_cents: 237500 }]);
  assert.deepEqual(out.ledger, { 2026: cell(150000, 337500) });
  const small = A.overturn({ plan: H.plan, services, memberId: 'm-1', lines: [ln('ln-1', 1, 'svc-knee-mri', '2026-11-11', 100), ln('ln-2', 2, 'svc-knee-mri', '2026-11-11', 100)], previous: [S.denied('ln-1', 'out_of_network', 100), S.denied('ln-2', 'out_of_network', 100)], named: ['ln-2', 'ln-1'], ledger: { 2026: cell(0, 0, 299900, 299900) } });
  assert.deepEqual(small.lines.map(l => [l.deductible_cents, l.coinsurance_cents]), [[100, 0], [0, 20]]);
  const part = A.overturn({ plan: H.plan, services, memberId: 'm-1', lines, previous, named: ['ln-2'], ledger });
  assert.deepEqual(part.lines.map(l => l.status), ['denied', 'paid', 'paid', 'denied']);
  assert.deepEqual(part.lines[0], previous[0]);
});

const C = (s, id) => s.claims.find(c => c.claim_id === id), V = (s, claim, v = 1) => s.eobs.find(e => e.claim_id === claim && e.version === v), P = (s, id) => s.pas.find(p => p.pa_id === id);
const repost = s => {
  for (const e of s.eobs) {
    const c = C(s, e.claim_id), year = l => Number(c.lines.find(x => x.line_id === l.line_id).service_date.slice(0, 4));
    e.postings = e.postings.map(p => { const mine = e.lines.filter(l => year(l) === p.plan_year); return { ...p, deductible_cents: mine.reduce((t, l) => t + l.deductible_cents, 0), oop_cents: mine.reduce((t, l) => t + l.member_cost_cents, 0) }; });
  }
  return S.finalize(s);
};
const AMOUNTS = /amounts differ from the plan's pricing against the ledger before it posted/;

test('T04 seed split checks: a 0/20/80 split with room left, a short copay with the caps far, and an early short copay hidden by a later cap are invalid_seed', () => {
  const small = split => { const s = S.base(); S.claim(s, { claim_id: 'cl-x', member_id: 'm-1', provider_id: 'pv-2', received_at: '2026-11-13T10:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-knee-mri', '2026-11-12', 100)] }); S.process(s, 'cl-x', [S.paid('ln-1', 100, split, 100)]); return S.finalize(s); };
  L(small({ ded: 100 }));
  R(small({ coins: 20 }), AMOUNTS);
  R(small({ ded: 80, coins: 4 }), AMOUNTS);
  R(repost(S.edit(S.base(), s => Object.assign(V(s, 'cl-1').lines[0], { copay_cents: 2400, member_cost_cents: 2400, plan_paid_cents: 15600 }))), AMOUNTS);
  const capped = copays => {
    const s = S.base();
    Object.assign(s.plan.years['2026'], { deductible: { individual_cents: 5000, family_cents: 300000 }, oop_max: { individual_cents: 6000, family_cents: 800000 } });
    S.claim(s, { claim_id: 'cl-y', member_id: 'm-1', provider_id: 'pv-1', received_at: '2026-11-13T10:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-office-visit', '2026-11-12', 21000), S.line('ln-2', 2, 'svc-office-visit', '2026-11-12', 21000)] });
    S.process(s, 'cl-y', copays.map((c, i) => S.paid('ln-' + (i + 1), 18000, { copay: c }, 21000)));
    return S.finalize(s);
  };
  L(capped([2500, 1000]));
  assert.throws(() => plugin.validateSeed(ctx(), capped([2000, 1500])), e => e.code === 'invalid_seed' && /^EOB eob-2 line ln-1 amounts differ/.test(e.message));
  R(capped([2500, 1001]), /copay|out-of-pocket|individual limits|amounts differ/);
});

test('T04 seed family deductible: met by two members, a third member\'s line pays coinsurance only', () => {
  const third = split => {
    const s = S.ledger([{ member: 'm-1', year: 2026, deductible_cents: 150000 }, { member: 'm-2', year: 2026, deductible_cents: 150000 }]);
    Object.assign(s.coverage.find(c => c.member_id === 'm-3' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: '2026-02-01T10:00:00-05:00' });
    S.claim(s, { claim_id: 'cl-z', member_id: 'm-3', provider_id: 'pv-2', received_at: '2026-11-13T10:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-knee-mri', '2026-11-12', 100000)] });
    S.process(s, 'cl-z', [S.paid('ln-1', 100000, split, 100000)]);
    return S.finalize(s);
  };
  const s = third({ coins: 20000 });
  L(s);
  assert.deepEqual(V(s, 'cl-z').ledger_before, { 2026: { member: { deductible_cents: 0, oop_cents: 0 }, family: { deductible_cents: 300000, oop_cents: 302500 } } });
  R(third({ ded: 100000 }), /outside the plan's family limits/);
  R(third({ coins: 19999 }), /amounts differ from the plan's pricing/);
});

test('T04 seed PA checks: the selector\'s PA among those approved before posting, with the units left at that point', () => {
  const twin = (decided, lineOn) => {
    const s = S.paUsed();
    s.pas.push({ ...structuredClone(P(s, 'pa-1')), pa_id: 'pa-2', units_used: 0 });
    if (decided) P(s, 'pa-1').decided_at = decided;
    V(s, 'cl-5').lines[0].pa_id = lineOn;
    P(s, 'pa-1').units_used = lineOn === 'pa-1' ? 1 : 0; P(s, 'pa-2').units_used = lineOn === 'pa-2' ? 1 : 0;
    return S.finalize(s);
  };
  L(twin(null, 'pa-1'));
  R(twin(null, 'pa-2'), /line ln-1 outcome differs .*it selects pa-1\./);
  L(twin('2026-11-17T10:00:00-05:00', 'pa-2'));
  R(twin('2026-11-17T10:00:00-05:00', 'pa-1'), /names a PA approved after it posted/);
  const pair = (units, second) => {
    const s = S.paApproved(units);
    Object.assign(s.coverage.find(c => c.member_id === 'm-3' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: '2026-02-01T10:00:00-05:00' });
    for (const [id, at] of [['cl-a', '2026-11-13T10:00:00-05:00'], ['cl-b', '2026-11-13T11:00:00-05:00']]) S.claim(s, { claim_id: id, member_id: 'm-3', provider_id: 'pv-3', received_at: at, lines: [S.line('ln-1', 1, 'svc-physical-therapy', '2026-11-12', 15000)] });
    S.process(s, 'cl-a', [S.paid('ln-1', 15000, { copay: 3500 }, 15000, { id: 'pa-1', units: 1 })]);
    S.process(s, 'cl-b', [second === 'paid' ? S.paid('ln-1', 15000, { copay: 3500 }, 15000, { id: 'pa-1', units: 1 }) : S.denied('ln-1', 'prior_auth_missing', 15000)]);
    if (second !== 'paid') S.window(s, 'claim', 'cl-b', C(s, 'cl-b').processed_at);
    P(s, 'pa-1').units_used = second === 'paid' ? 2 : 1;
    return S.finalize(s);
  };
  L(pair(1, 'denied'));
  L(pair(2, 'paid'));
  R(pair(2, 'denied'), /EOB eob-3 line ln-1 outcome differs .*it selects pa-1\./);
  R(pair(1, 'paid'), /units used differ|exceed the approved units|outcome differs/);
  const expired = denied => {
    const s = S.paUsed();
    Object.assign(P(s, 'pa-1'), { status: 'expired', expired_at: toIso(endOfDay('2026-11-12')) });
    P(s, 'pa-1').approved.valid_until = '2026-11-12';
    if (denied) { V(s, 'cl-5').lines[0] = S.denied('ln-1', 'prior_auth_missing', 15000); P(s, 'pa-1').units_used = 0; S.window(s, 'claim', 'cl-5', C(s, 'cl-5').processed_at); }
    return S.finalize(s);
  };
  L(expired(false));
  R(repost(expired(true)), /outcome differs .*it selects pa-1\./);
});

test('T04 a PA decision and an accident answer at one instant load in both genuine orders and only in those', () => {
  const T = '2026-11-17T10:00:00-05:00';
  const build = (paFirst, mark) => {
    const s = S.paApproved();
    Object.assign(s.coverage.find(c => c.member_id === 'm-3' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: '2026-02-01T10:00:00-05:00' });
    P(s, 'pa-1').decided_at = T;
    const c = S.claim(s, { claim_id: 'cl-6', member_id: 'm-3', provider_id: 'pv-3', received_at: '2026-11-13T10:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-physical-therapy', '2026-11-12', 15000, { possible_accident: true })] });
    s.info_requests.push({ info_request_id: 'ir-1', request_version: 1, type: 'accident', claim_id: 'cl-6', line_id: 'ln-1', plan_year: 2026, opened_at: c.review_at, expires_at: S.due(c.review_at, 45), status: 'answered', answer: 'not_accident', answered_at: T });
    s.issued.ir = '1';
    S.process(s, 'cl-6', [paFirst ? S.paid('ln-1', 15000, { copay: 3500 }, 15000, { id: 'pa-1', units: 1 }) : S.denied('ln-1', 'prior_auth_missing', 15000)], T);
    P(s, 'pa-1').units_used = paFirst ? 1 : 0;
    if (!paFirst) S.window(s, 'claim', 'cl-6', T);
    S.finalize(s);
    P(s, 'pa-1').approved_after_post = mark;
    return s;
  };
  L(build(true, '1'));
  L(build(false, '2'));
  R(build(true, '2'), /names a PA approved after it posted/);
  R(build(false, '1'), /line ln-1 outcome differs .*it selects pa-1\./);
});

test('T04 seed overturn checks: the repriced lines follow the ledger before the new version; the payload order does not matter', () => {
  L(S.overturned(['ln-2', 'ln-1']));
  R(repost(S.edit(S.overturned(), s => Object.assign(V(s, 'cl-3', 2).lines[0], { deductible_cents: 100000, coinsurance_cents: 10000, member_cost_cents: 110000, plan_paid_cents: 40000 }))), AMOUNTS);
  const after = S.overturned(['ln-1'], undefined, S.openAppeal(undefined, undefined, S.deniedClaim(undefined, S.ledger([{ member: 'm-1', year: 2026, deductible_cents: 100000 }]))), { 'ln-1': S.paid('ln-1', 150000, { ded: 50000, coins: 20000 }, 180000) });
  L(after);
  R(repost(S.edit(structuredClone(after), s => Object.assign(V(s, 'cl-3', 2).lines.find(l => l.line_id === 'ln-1'), { deductible_cents: 50000, coinsurance_cents: 19999, member_cost_cents: 69999, plan_paid_cents: 80001 }))), AMOUNTS);
});

function rng(n) { let x = (n * 2654435761) >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

function generate(n, start) {
  const r = rng(n), pick = list => list[Math.floor(r() * list.length)], int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const s = S.household(), at = (day, hh, mm) => toIso(fromLocal(addDays(start, day), hh + ':' + String(mm).padStart(2, '0')));
  for (const y of Object.keys(s.plan.years)) {
    const ded = pick([0, 5000, 20000, 150000]), fded = ded * pick([1, 2, 3]), oop = ded + pick([0, 3000, 20000, 250000]);
    const copays = {};
    for (const c of ['office', 'specialist', 'imaging', 'therapy', 'emergency', 'lab', 'surgery']) if (r() < 0.5) copays[c] = pick([0, 1000, 2500, 30000]);
    s.plan.years[y] = { deductible: { individual_cents: ded, family_cents: fded }, oop_max: { individual_cents: oop, family_cents: Math.max(oop * pick([1, 2]), fded) }, coinsurance_pct: pick([0, 15, 20, 50, 100]), copays };
  }
  const attested = at(-1, '08', 0);
  for (const c of s.coverage) Object.assign(c, { status: pick(['none', 'none', 'none', 'other_secondary', 'other_primary']), version: 1, attested_at: attested });
  const now = at(130, '12', 0), events = [];
  const minute = { 10: 0, 11: 0, 14: 0, 15: 0 }, tick = h => minute[h]++ % 60;
  const claimSvc = H.services.filter(x => x.category !== 'pharmacy').map(x => x.service_id);
  let ir = 0;
  const claims = int(3, 9), pas = int(0, 4);
  for (let i = 0; i < claims; i++) {
    const day = int(0, 100), member = pick(['m-1', 'm-2', 'm-3']), received_at = at(day, '09', i);
    const lines = Array.from({ length: int(1, 4) }, (_, k) => {
      const service_id = pick(claimSvc), units = int(1, 3), fee = services.get(service_id).fee_cents * units;
      return S.line('ln-' + (k + 1), k + 1, service_id, addDays(received_at.slice(0, 10), -int(0, 40)), pick([0, fee, Math.max(0, fee - int(1, 1000)), fee + int(0, 50000), int(0, 300000)]), { units, emergency: r() < 0.2, possible_accident: r() < 0.25 });
    });
    const c = S.claim(s, { claim_id: 'cl-g' + i, member_id: member, provider_id: pick(['pv-1', 'pv-2', 'pv-3', 'pv-4', 'pv-5', 'pv-6']), received_at, lines });
    c.status = 'processed';
    const standing = l => s.coverage.find(x => x.member_id === member && x.plan_year === Number(l.service_date.slice(0, 4))).status;
    const reqs = lines.filter(l => standing(l) !== 'other_primary' && l.possible_accident).map(l => {
      const rq = { info_request_id: 'ir-' + (++ir), request_version: 1, type: 'accident', claim_id: c.claim_id, line_id: l.line_id, plan_year: Number(l.service_date.slice(0, 4)), opened_at: c.review_at, expires_at: S.due(c.review_at, 45), status: 'answered', answer: pick(['not_accident', 'accident', 'work_related']), answered_at: null };
      if (r() < 0.3 && ms(rq.expires_at) < ms(now)) Object.assign(rq, { status: 'expired', answer: null });
      else rq.answered_at = toIso(fromLocal(addDays(c.review_at.slice(0, 10), int(1, 20)), '10:' + String(tick(10)).padStart(2, '0')));
      s.info_requests.push(rq);
      return rq;
    });
    const closes = reqs.map(q => (q.status === 'answered' ? q.answered_at : q.expires_at));
    const v1 = [c.review_at, ...closes].reduce((a, b) => (ms(b) > ms(a) ? b : a));
    c.processed_at = v1;
    const timer = v1 === c.review_at || reqs.some(q => q.status === 'expired' && q.expires_at === v1);
    const key = v1 === c.review_at ? c.claim_id : reqs.filter(q => q.status === 'expired' && q.expires_at === v1).map(q => q.info_request_id).sort().pop();
    events.push({ t: ms(v1), timer, key: key + (v1 === c.review_at ? ' 0' : ' 1'), claim: c, version: 1, at: v1, standing, reqs });
  }
  s.issued.ir = String(ir);
  for (let k = 0; k < pas; k++) {
    const day = int(0, 90), submitted_at = at(day, '11', tick(11)), decided_at = at(day + 1, '11', tick(11));
    const from = addDays(decided_at.slice(0, 10), -int(0, 30)), until = addDays(from, int(5, 120)), units = int(1, 4);
    const cutoff = endOfDay(until), expired = cutoff <= ms(now);
    const pa = { pa_id: 'pa-g' + k, pa_version: 1, member_id: pick(['m-1', 'm-2', 'm-3']), provider_id: 'pv-3', service_id: pick(['svc-physical-therapy', 'svc-arthroscopy']), status: expired ? 'expired' : 'approved', submitted_at,
      requested: { units, valid_from: from, valid_until: until }, approved: { units, valid_from: from, valid_until: until }, approved_after_post: null, units_used: 0, info_requests: [], expedite: null, due_at: S.due(submitted_at, 15),
      overdue: false, overdue_at: null, decided_at, expired_at: expired ? toIso(Math.max(cutoff, ms(decided_at))) : null, denial_notice_at: null, covered_submissions: [] };
    s.pas.push(pa);
    events.push({ t: ms(decided_at), timer: false, key: '', pa });
  }
  events.sort((a, b) => a.t - b.t || (b.timer - a.timer) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const book = new Map(), cellOf = (m, y) => book.get(m + ':' + y) || { deductible_cents: 0, oop_cents: 0 };
  const family = y => ['m-1', 'm-2', 'm-3'].reduce((f, m) => ({ deductible_cents: f.deductible_cents + cellOf(m, y).deductible_cents, oop_cents: f.oop_cents + cellOf(m, y).oop_cents }), { deductible_cents: 0, oop_cents: 0 });
  const used = new Map();
  let post = 0, eob = 0, ap = 0;
  const appeals = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.pa) { ev.pa.approved_after_post = String(post); continue; }
    const c = ev.claim, years = [...new Set(c.lines.map(l => l.service_date.slice(0, 4)))].sort();
    const ledger_before = Object.fromEntries(years.map(y => [y, { member: { ...cellOf(c.member_id, Number(y)) }, family: family(Number(y)) }]));
    let out, prev = null;
    if (ev.version === 1) {
      const outcomes = Object.fromEntries(c.lines.map(l => [l.line_id, A.lineOutcome(ev.standing(l), ev.reqs.filter(q => q.line_id === l.line_id))]));
      const pas = s.pas.filter(p => p.member_id === c.member_id && p.approved_after_post !== null).map(p => ({ pa_id: p.pa_id, service_id: p.service_id, valid_from: p.approved.valid_from, valid_until: p.approved.valid_until, remaining: p.approved.units - (used.get(p.pa_id) || 0) }));
      out = A.adjudicate({ plan: s.plan, services, provider: s.providers.find(p => p.provider_id === c.provider_id), memberId: c.member_id, lines: c.lines, ledger: ledger_before, outcomes, pas });
      for (const u of out.pa_use) used.set(u.pa_id, (used.get(u.pa_id) || 0) + u.units);
    } else {
      prev = s.eobs.find(e => e.claim_id === c.claim_id && e.version === 1);
      out = A.overturn({ plan: s.plan, services, memberId: c.member_id, lines: c.lines, previous: prev.lines, named: ev.appeal.outcome.lines, ledger: ledger_before });
    }
    post++;
    const record = { eob_id: 'eob-' + (++eob), claim_id: c.claim_id, version: ev.version, issued_at: ev.at, posting_seq: String(post), reason: ev.version === 1 ? 'initial' : 'appeal', appeal_id: ev.version === 1 ? null : ev.appeal.appeal_id, ledger_before, lines: out.lines, postings: out.postings };
    s.eobs.push(record);
    for (const p of out.postings) {
      const was = prev ? prev.postings.find(x => x.plan_year === p.plan_year) : { deductible_cents: 0, oop_cents: 0 }, cur = cellOf(p.member_id, p.plan_year);
      book.set(p.member_id + ':' + p.plan_year, { deductible_cents: cur.deductible_cents + p.deductible_cents - was.deductible_cents, oop_cents: cur.oop_cents + p.oop_cents - was.oop_cents });
    }
    c.claim_version = ev.version;
    const denied = out.lines.filter(l => l.status === 'denied').map(l => l.line_id);
    if (ev.version === 1 && denied.length) {
      s.windows.push({ target: { type: 'claim', id: c.claim_id }, notice_at: ev.at, ends_at: S.due(ev.at, 180), closing: { due_at: S.due(ev.at, 166), done: false, notice_at: null } });
      const filed_at = toIso(fromLocal(addDays(ev.at.slice(0, 10), int(1, 5)), '14:' + String(tick(14)).padStart(2, '0'))), decided_at = toIso(fromLocal(addDays(filed_at.slice(0, 10), int(1, 20)), '15:' + String(tick(15)).padStart(2, '0')));
      if (r() < 0.6 && ms(decided_at) <= ms(now)) {
        const named = denied.filter(() => r() < 0.6);
        if (!named.length) named.push(denied[0]);
        const a = { appeal_id: 'ap-' + (++ap), appeal_version: 1, member_id: c.member_id, target: { type: 'claim', id: c.claim_id }, lines: denied, expedited: false, filed_at, filed_seq: '0', due_at: S.due(filed_at, 60), overdue: false, overdue_at: null,
          status: 'overturned', statements: [{ at: filed_at, by: 'm-1', text: 'Please review the denied lines.' }], info_requests: [], decided_at, outcome: { lines: named, units: null, valid_until: null }, withdrawn_at: null };
        appeals.push(a);
        const next = { t: ms(decided_at), timer: false, key: '', claim: c, version: 2, at: decided_at, appeal: a };
        let j = i + 1;
        while (j < events.length && (events[j].t < next.t || (events[j].t === next.t && events[j].timer))) j++;
        events.splice(j, 0, next);
      }
    }
  }
  appeals.sort((a, b) => ms(a.filed_at) - ms(b.filed_at)).forEach((a, i) => { a.filed_seq = String(i + 1); });
  s.appeals = appeals;
  for (const p of s.pas) p.units_used = used.get(p.pa_id) || 0;
  for (const a of s.accumulators) Object.assign(a, cellOf(a.member_id, a.plan_year));
  [...s.claims].sort((a, b) => ms(a.received_at) - ms(b.received_at)).forEach((c, i) => { c.received_seq = String(i + 1); });
  Object.assign(s.issued, { seq: String(s.claims.length), post: String(post), eob: String(eob), ap: String(ap), file: String(ap) });
  return { s, now };
}

test('T04 every history the engine produces loads: random plans, claims, requests, PAs and overturns across both plan-year boundaries', () => {
  let eobs = 0, paid = 0, paLines = 0, overturns = 0, capped = 0;
  for (const start of ['2025-11-01', '2026-11-01']) for (let n = 1; n <= 120; n++) {
    const { s, now } = generate(n, start);
    assert.doesNotThrow(() => plugin.validateSeed(ctx(now), s), start + ' #' + n);
    eobs += s.eobs.length; overturns += s.eobs.filter(e => e.version === 2).length;
    for (const e of s.eobs) for (const l of e.lines) { if (l.status === 'paid') paid++; if (l.pa_id) paLines++; }
    for (const a of s.accumulators) if (a.oop_cents === s.plan.years[String(a.plan_year)].oop_max.individual_cents && a.oop_cents > 0) capped++;
  }
  assert.ok(eobs > 1000 && paid > 600 && paLines > 20 && overturns > 50 && capped > 20, JSON.stringify({ eobs, paid, paLines, overturns, capped }));
});

test('T04 a one-cent change to any engine-priced paid line with a member share is invalid_seed', () => {
  let tried = 0;
  for (let n = 1; n <= 60; n++) {
    const { s, now } = generate(n, n % 2 ? '2025-11-01' : '2026-11-01');
    const targets = s.eobs.flatMap(e => e.lines.filter(l => l.status === 'paid' && l.member_cost_cents > 0).map(l => [e.eob_id, l.line_id]));
    if (!targets.length) continue;
    const [eobId, lineId] = targets[n % targets.length];
    const bad = structuredClone(s), l = bad.eobs.find(e => e.eob_id === eobId).lines.find(x => x.line_id === lineId);
    const field = l.coinsurance_cents > 0 ? 'coinsurance_cents' : l.deductible_cents > 0 ? 'deductible_cents' : 'copay_cents';
    l[field]--; l.member_cost_cents--; l.plan_paid_cents++;
    for (const e of bad.eobs.filter(x => x.claim_id === bad.eobs.find(y => y.eob_id === eobId).claim_id && x.version > 1)) {
      const copy = e.lines.find(x => x.line_id === lineId);
      if (copy.status === 'paid') Object.assign(copy, { [field]: l[field], member_cost_cents: l.member_cost_cents, plan_paid_cents: l.plan_paid_cents });
    }
    assert.throws(() => plugin.validateSeed(ctx(now), repost(bad)), e => e.code === 'invalid_seed', '#' + n + ' ' + eobId + ' ' + lineId);
    tried++;
  }
  assert.ok(tried > 40, String(tried));
});
