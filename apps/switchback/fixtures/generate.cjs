#!/usr/bin/env node
'use strict';
// Builds fixtures/minimal.json. Deterministic: the same seed always writes the
// same bytes. History runs from 2025-01-01; the task clock (fixtures/clock.json)
// is 2027-05-20. Run: node fixtures/generate.cjs
const fs = require('node:fs');
const path = require('node:path');

const OFF = '-07:00';
const SEED = 20250101;
const NOW = '2027-05-20T09:00:00-07:00';

// mulberry32: small, seeded, reproducible.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const pick = list => list[Math.floor(rand() * list.length)];
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nights = (a, b) => { const out = []; for (let d = a; d < b; d = addDays(d, 1)) out.push(d); return out; };
const stamp = (date, hh, mm) => `${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00${OFF}`;

const rung = (ends, cancel, change) => ({ends, cancel, change});
const policies = [
  {id: 'pol-standard', name: 'Standard campground ladder', rungs: [
    rung({days_before: 14, time: '00:00'}, {fee_cents: 0, first_night: false, percent_kept: 0}, {allowed: true, fee_cents: 1000, percent: 0}),
    rung({days_before: 4, time: '00:00'}, {fee_cents: 1000, first_night: false, percent_kept: 0}, {allowed: true, fee_cents: 1000, percent: 0}),
    rung({days_before: 0, time: '15:00'}, {fee_cents: 1000, first_night: true, percent_kept: 0}, {allowed: false, fee_cents: 0, percent: 0}),
    rung(null, {fee_cents: 0, first_night: false, percent_kept: 100}, {allowed: false, fee_cents: 0, percent: 0})]},
  {id: 'pol-flex-3day', name: 'Free until three days out, then 50%', rungs: [
    rung({days_before: 3, time: '18:00'}, {fee_cents: 0, first_night: false, percent_kept: 0}, {allowed: true, fee_cents: 0, percent: 0}),
    rung(null, {fee_cents: 0, first_night: false, percent_kept: 50}, {allowed: true, fee_cents: 0, percent: 50})]},
];
const facilities = [
  {id: 'cedar-flat', name: 'Cedar Flat', region: 'Upper Sawtooth Lake', description: 'Lakeside loops under old cedars; paved roads to loop B, gravel to loop C.', utc_offset: OFF, policy_id: 'pol-standard'},
  {id: 'lakeshore', name: 'Lakeshore', region: 'North Basin', description: 'Open sites along the north shore, sixty miles from Pine Hollow.', utc_offset: OFF, policy_id: 'pol-flex-3day'},
  {id: 'pine-hollow', name: 'Pine Hollow', region: 'South Fork', description: 'Small forest campground with walk-in tent sites by the creek.', utc_offset: OFF, policy_id: 'pol-standard'},
];
const S = (id, facility_id, name, loop, electric_amps, max_vehicle_ft, ada_accessible, walk_in_ft, max_occupancy, pets_allowed, nightly_cents) =>
  ({id, facility_id, name, loop, electric_amps, max_vehicle_ft, ada_accessible, walk_in_ft, max_occupancy, pets_allowed, nightly_cents});
const sites = [
  S('cf-B10', 'cedar-flat', 'B10', 'B', 30, 28, false, 0, 6, true, 3800),
  S('cf-B12', 'cedar-flat', 'B12', 'B', 50, 40, true, 0, 8, true, 4200),
  S('cf-B14', 'cedar-flat', 'B14', 'B', null, 20, false, 0, 6, true, 2800),
  S('cf-C03', 'cedar-flat', 'C03', 'C', null, 18, false, 0, 6, true, 2600),
  S('cf-C07', 'cedar-flat', 'C07', 'C', 30, null, null, 0, 6, null, 3200),
  S('cf-W02', 'cedar-flat', 'W02', 'W', null, 0, false, 240, 4, false, 2200),
  S('ls-01', 'lakeshore', '01', 'Shore', 50, 45, true, 0, 8, true, 5200),
  S('ls-04', 'lakeshore', '04', 'Shore', 30, 32, false, 0, 6, true, 4600),
  S('ls-09', 'lakeshore', '09', 'Meadow', null, 24, false, 0, 6, true, 3400),
  S('ph-14', 'pine-hollow', '14', 'Creek', null, 22, false, 0, 6, true, 3200),
  S('ph-17', 'pine-hollow', '17', 'Creek', 30, 30, false, 0, 6, true, 4000),
  S('ph-W05', 'pine-hollow', 'W05', 'Walk-in', null, 0, false, 400, 4, true, 2000),
];
const siteBy = Object.fromEntries(sites.map(s => [s.id, s]));
const cards = [
  {id: 'card-carol-visa', brand: 'Visa', last4: '2290', holder_name: 'Carol Okafor', holder_person_id: 'person-carol', exp_month: 9, exp_year: 2028},
  {id: 'card-dana-visa', brand: 'Visa', last4: '4417', holder_name: 'Dana Okafor', holder_person_id: 'person-dana', exp_month: 3, exp_year: 2029},
  {id: 'card-dana-mc', brand: 'Mastercard', last4: '8831', holder_name: 'Dana Okafor', holder_person_id: 'person-dana', exp_month: 4, exp_year: 2027},
];
// Saved in early 2025 and never updated: the stale defaults the tasks turn on.
const equipment = [
  {id: 'equip-0001', label: 'Old trailer', kind: 'trailer', length_ft: 18, updated_at: '2025-03-02T10:00:00-07:00'},
  {id: 'equip-0002', label: "Mo's tent", kind: 'tent', length_ft: 0, updated_at: '2025-03-02T10:00:00-07:00'},
];
const companions = [
  {id: 'comp-0001', display_name: 'Mo Okafor', person_id: 'person-mo', default_party: true, updated_at: '2025-03-02T10:00:00-07:00'},
  {id: 'comp-0002', display_name: 'Jules Park', person_id: 'person-jules', default_party: true, updated_at: '2025-03-02T10:00:00-07:00'},
  {id: 'comp-0003', display_name: 'Pat (cousin)', person_id: null, default_party: false, updated_at: '2025-01-20T10:00:00-07:00'},
];
const party = companions.slice(0, 2).map(c => ({id: c.id, display_name: c.display_name, person_id: c.person_id}));
const holder = {kind: 'holder', id: 'holder', display_name: 'Dana Okafor'};

const reservations = [], payments = [];
let resN = 0, payN = 0;
const nextRes = () => `res-${String(++resN).padStart(4, '0')}`;
const nextPay = () => `pay-${String(++payN).padStart(4, '0')}`;

function reservation({site, arrival, departure, state, created, card = 'card-dana-visa', hist}) {
  const s = siteBy[site], n = nights(arrival, departure), nightly = n.map(() => s.nightly_cents);
  const f = facilities.find(x => x.id === s.facility_id);
  const r = {id: nextRes(), facility_id: f.id, site_id: site, arrival, departure, nights: n, nightly_cents: nightly,
    total_cents: nightly.reduce((a, b) => a + b, 0), policy_id: f.policy_id, primary_occupant: holder,
    equipment: equipment[0], companions: party, party_size: 3, pets: 0, card_id: card, state, late_arrival: false,
    created_at: created, updated_at: (hist || [{at: created}]).at(-1).at, history: hist || [{at: created, action: 'confirmed'}]};
  reservations.push(r);
  payments.push({id: nextPay(), reservation_id: r.id, card_id: card, amount_cents: r.total_cents, kind: 'charge', reason: 'booking', created_at: created, posts_at: created, status: 'posted'});
  return r;
}

// The two upcoming stays the tasks and checks use keep their IDs: res-0001 and res-0002.
reservation({site: 'cf-B14', arrival: '2027-06-18', departure: '2027-06-20', state: 'confirmed', created: '2026-12-20T07:03:00-07:00'});
reservation({site: 'ls-04', arrival: '2027-07-02', departure: '2027-07-05', state: 'confirmed', created: '2027-01-05T19:20:00-07:00', card: 'card-carol-visa'});

// Past stays, 2025-01-01 onward: the family's usual weekends, mostly at Cedar Flat B14.
const past = [];
for (let month = 0; month < 28; month++) {
  const base = addDays('2025-02-01', month * 30);
  if (base >= '2027-04-01') break;
  if (rand() < 0.45) continue;
  const arrival = addDays(base, int(0, 20)), length = int(1, 3), departure = addDays(arrival, length);
  const site = rand() < 0.6 ? 'cf-B14' : pick(['cf-C03', 'ph-14', 'ls-09', 'cf-B10']);
  const lead = int(21, 150);
  let created = stamp(addDays(arrival, -lead), int(7, 21), int(0, 59));
  if (created < '2025-01-01') created = stamp('2025-01-02', 9, 0);
  past.push({site, arrival, departure, created});
}
past.sort((a, b) => a.arrival.localeCompare(b.arrival));
for (const p of past) {
  const roll = rand(), off = OFF;
  if (roll < 0.75) {
    reservation({...p, state: 'completed', hist: [{at: p.created, action: 'confirmed'},
      {at: stamp(p.arrival, int(15, 19), int(0, 59)), action: 'checked_in'}, {at: `${p.departure}T12:00:00${off}`, action: 'completed'}]});
  } else if (roll < 0.9) {
    // Cancelled between booking and arrival, in the free rung.
    const lead = Math.round((Date.parse(`${p.arrival}T00:00:00Z`) - Date.parse(p.created)) / 86400000);
    const at = stamp(addDays(p.arrival, -Math.max(15, Math.floor(lead / 2))), int(8, 20), int(0, 59));
    const r = reservation({...p, state: 'cancelled', hist: [{at: p.created, action: 'confirmed'}, {at, action: 'cancelled', refund_cents: 0}]});
    r.history[1].refund_cents = r.total_cents;
    payments.push({id: nextPay(), reservation_id: r.id, card_id: r.card_id, amount_cents: r.total_cents, kind: 'refund', reason: 'cancellation', created_at: at,
      posts_at: new Date(Date.parse(at) + 3 * 86400000).toISOString().replace('.000Z', 'Z'), status: 'posted'});
  } else {
    reservation({...p, state: 'no_show', hist: [{at: p.created, action: 'confirmed'}, {at: `${p.arrival}T21:00:00${off}`, action: 'no_show_released'}]});
  }
}

const alerts = [
  {id: 'al-0001', kind: 'fire_restriction', facility_id: 'pine-hollow', site_ids: [], from: '2027-05-15T00:00:00-07:00', to: '2027-09-30T00:00:00-07:00',
    text: 'Stage 1 fire restriction: campfires only in provided rings.', posted_at: '2027-05-14T09:00:00-07:00', cancelled_at: null, revisions: []},
  {id: 'al-0002', kind: 'smoke_advisory', facility_id: 'cedar-flat', site_ids: [], from: '2025-08-10T00:00:00-07:00', to: '2025-08-14T00:00:00-07:00',
    text: 'Smoke from the Ridge fire; air unhealthy for sensitive groups.', posted_at: '2025-08-09T16:00:00-07:00', cancelled_at: null, revisions: []},
  {id: 'al-0003', kind: 'water_outage', facility_id: 'lakeshore', site_ids: ['ls-01', 'ls-04'], from: '2026-06-03T08:00:00-07:00', to: '2026-06-10T08:00:00-07:00',
    text: 'Water line repair on the Shore loop.', posted_at: '2026-06-02T12:00:00-07:00', cancelled_at: '2026-06-06T10:00:00-07:00', revisions: []},
];

const seed = {account_id: 'sb-dana', owner_person_id: 'person-dana', holder: {display_name: 'Dana Okafor'}, facilities, policies, sites,
  wallet: {default_card_id: 'card-carol-visa', cards}, equipment, default_equipment_id: 'equip-0001', companions,
  holds: [], previews: [], reservations, payments, alerts, closures: [], claims: [], notices: []};

fs.writeFileSync(path.join(__dirname, 'minimal.json'), JSON.stringify(seed, null, 2) + '\n');
fs.writeFileSync(path.join(__dirname, 'clock.json'), JSON.stringify({initial_time: NOW}, null, 2) + '\n');
console.log(`minimal.json: ${reservations.length} reservations, ${payments.length} payments, earliest ${[...reservations.map(r => r.created_at)].sort()[0]}`);
