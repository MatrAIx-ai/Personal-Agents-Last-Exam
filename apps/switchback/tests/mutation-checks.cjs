'use strict';
// Check (b), mutation. Each mutant changes one field of a reference end state
// (or one call in its trace). It must fail the check that reads that field and
// only the derived checks listed with it; every other check of the scenario
// must still pass. Checks that no mutant fails are reported.
const test = require('node:test');
const assert = require('node:assert/strict');
const {CHECKS, evaluate} = require('./checks.cjs');
const {SCENARIOS, endState} = require('./scenarios.cjs');

const res = id => data => data.reservations.find(r => r.id === id);
const lakeStay = data => data.reservations.find(r => r.facility_id === 'cedar-flat' && r.arrival === '2027-06-25' && r.state === 'confirmed');
const site = id => data => data.sites.find(s => s.id === id);
const pay = (kind, reservation) => data => data.payments.find(p => p.kind === kind && p.reservation_id === reservation);

// [scenario, field, set(data, trace), own check, derived checks]
const MUTANTS = [
  ['lake_weekend', 'reservation.site_id = cf-B14 (no power, 20 ft)', d => { lakeStay(d).site_id = 'cf-B14'; }, 'electric', ['fits_trailer']],
  ['lake_weekend', 'reservation.site_id = cf-C07 (length unknown)', d => { lakeStay(d).site_id = 'cf-C07'; }, 'fits_trailer', []],
  ['lake_weekend', 'site.electric_amps = 20', d => { site(lakeStay(d).site_id)(d).electric_amps = 20; }, 'electric', []],
  ['lake_weekend', 'site.electric_amps = null', d => { site(lakeStay(d).site_id)(d).electric_amps = null; }, 'electric', []],
  ['lake_weekend', 'site.max_vehicle_ft = 24', d => { site(lakeStay(d).site_id)(d).max_vehicle_ft = 24; }, 'fits_trailer', []],
  ['lake_weekend', 'site.max_vehicle_ft = null', d => { site(lakeStay(d).site_id)(d).max_vehicle_ft = null; }, 'fits_trailer', []],
  ['lake_weekend', 'reservation.equipment.length_ft = 18', d => { lakeStay(d).equipment.length_ft = 18; }, 'fits_trailer', []],
  ['lake_weekend', 'reservation.equipment = null', d => { lakeStay(d).equipment = null; }, 'fits_trailer', []],
  ['lake_weekend', 'reservation.card_id = card-carol-visa', d => { lakeStay(d).card_id = 'card-carol-visa'; }, 'own_card', []],
  ['lake_weekend', 'card.holder_person_id = person-carol', d => { d.wallet.cards.find(c => c.id === lakeStay(d).card_id).holder_person_id = 'person-carol'; }, 'own_card', []],
  ['lake_weekend', 'reservation.state = cancelled', d => { lakeStay(d).state = 'cancelled'; }, 'electric', ['fits_trailer', 'own_card']],
  ['lake_weekend', 'reservation.arrival = 2027-06-26', d => { lakeStay(d).arrival = '2027-06-26'; }, 'electric', ['fits_trailer', 'own_card']],
  ['lake_weekend', 'reservation.departure = 2027-06-28', d => { lakeStay(d).departure = '2027-06-28'; }, 'electric', ['fits_trailer', 'own_card']],
  ['lake_weekend', 'reservation.facility_id = lakeshore', d => { lakeStay(d).facility_id = 'lakeshore'; }, 'electric', ['fits_trailer', 'own_card']],
  ['free_window', 'res-0002.state = confirmed', d => { res('res-0002')(d).state = 'confirmed'; }, 'full_refund', []],
  ['free_window', 'refund.amount_cents - 1 cent', d => { pay('refund', 'res-0002')(d).amount_cents -= 1; }, 'full_refund', []],
  ['free_window', 'refund.kind = charge', d => { pay('refund', 'res-0002')(d).kind = 'charge'; }, 'full_refund', []],
  ['free_window', 'refund.reservation_id = res-0001', d => { pay('refund', 'res-0002')(d).reservation_id = 'res-0001'; }, 'full_refund', []],
  ['free_window', 'res-0002.total_cents + 1 cent', d => { res('res-0002')(d).total_cents += 1; }, 'full_refund', []],
  ['delayed_drive', 'res-0001.late_arrival = false', d => { res('res-0001')(d).late_arrival = false; }, 'kept_after_delay', []],
  ['delayed_drive', 'res-0001.state = no_show', d => { res('res-0001')(d).state = 'no_show'; }, 'kept_after_delay', []],
  ['closure', 'res-0001.state = confirmed', d => { res('res-0001')(d).state = 'confirmed'; }, 'no_action_after_closure', []],
  ['closure', 'refund.amount_cents - $1', d => { pay('refund', 'res-0001')(d).amount_cents -= 100; }, 'no_action_after_closure', []],
  ['closure', 'trace: one cancel attempt on res-0001', (d, t) => { t.push({name: 'reservations.cancel.preview', args: {reservation_id: 'res-0001'}, error: 'already_cancelled'}); }, 'no_action_after_closure', []],
  ['restriction', 'res-0002.state = cancelled', d => { res('res-0002')(d).state = 'cancelled'; }, 'kept_through_alert', []],
  ['restriction', 'res-0002.state = no_show', d => { res('res-0002')(d).state = 'no_show'; }, 'kept_through_alert', []],
];

// Evaluates every mutant and returns the per-mutant results and the coverage report.
function mutationReport() {
  const ends = Object.fromEntries(Object.entries(SCENARIOS).map(([n, s]) => [n, endState(s, s.reference)]));
  const rows = MUTANTS.map(([scenario, field, set, own, derived]) => {
    const s = SCENARIOS[scenario], data = structuredClone(ends[scenario].data), trace = structuredClone(ends[scenario].trace);
    set(data, trace);
    const result = evaluate(s.checks, data, trace);
    return {scenario, field, expected: [own, ...derived].sort(), failed: s.checks.filter(c => !result[c]).sort()};
  });
  const failedSomewhere = new Set(rows.flatMap(r => r.failed));
  return {rows, unkilled: Object.keys(CHECKS).filter(c => !failedSomewhere.has(c))};
}

test('check (b), mutation: each single-field mutant fails its own check and only its listed derived checks', () => {
  for (const [name, s] of Object.entries(SCENARIOS)) {
    const {data, trace} = endState(s, s.reference);
    assert.ok(Object.values(evaluate(s.checks, data, trace)).every(Boolean), name + ' reference passes before mutation');
  }
  const {rows, unkilled} = mutationReport();
  for (const r of rows) assert.deepEqual(r.failed, r.expected, `${r.scenario}: ${r.field}`);
  // The proposal asks for checks that no mutant fails to be reported; there are none.
  console.log(JSON.stringify({check: 'b', mutants: rows.length, checks: Object.keys(CHECKS).length, checks_no_mutant_fails: unkilled}));
  assert.deepEqual(unkilled, []);
});

module.exports = {MUTANTS, mutationReport};
