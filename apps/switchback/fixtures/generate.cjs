#!/usr/bin/env node
'use strict';
// Builds the three reset fixtures and their default scenario schedules.
// Deterministic: the same seeds always write the same bytes. Seeded history
// starts on or after 2025-01-01; task clocks and scenario events are on or after
// 2026-01-01.
//
//   fixtures/minimal.json        the manifest seed (clock in fixtures/clock.json)
//   fixtures/high-country.json   7 facilities, 300+ sites, clock 2026-06-12
//   fixtures/desert-rivers.json  6 facilities, 250+ sites, clock 2026-10-02
//   fixtures/schedules/*.json    each fixture's default schedule, 30-50 events
//   fixtures/evaluator/*.json    claim times, drawn once from OS entropy
//
// Schedules and claim times are Infra and evaluator files: no tool, page or
// source file under src/ or gui/ reads them. A claim-times file is drawn only
// when it is missing and is never regenerated; the schedule merges its times.
//
// Run: node fixtures/generate.cjs          writes every file
//      node fixtures/generate.cjs --check  fails if any committed file differs
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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

const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nights = (a, b) => { const out = []; for (let d = a; d < b; d = addDays(d, 1)) out.push(d); return out; };
const pad = n => String(n).padStart(2, '0');
const weekday = date => new Date(`${date}T00:00:00Z`).getUTCDay();  // 0 Sunday ... 6 Saturday
// An instant as an ISO timestamp in a fixed offset.
function isoAt(t, off) {
  const sign = off[0] === '-' ? -1 : 1, [h, m] = off.slice(1).split(':').map(Number);
  return new Date(t + sign * (h * 60 + m) * 60000).toISOString().replace(/\.\d{3}Z$/, off);
}

const rung = (ends, cancel, change) => ({ends, cancel, change});
const POLICY = {
  standard: {id: 'pol-standard', name: 'Standard campground ladder', rungs: [
    rung({days_before: 14, time: '00:00'}, {fee_cents: 0, first_night: false, percent_kept: 0}, {allowed: true, fee_cents: 1000, percent: 0}),
    rung({days_before: 4, time: '00:00'}, {fee_cents: 1000, first_night: false, percent_kept: 0}, {allowed: true, fee_cents: 1000, percent: 0}),
    rung({days_before: 0, time: '15:00'}, {fee_cents: 1000, first_night: true, percent_kept: 0}, {allowed: false, fee_cents: 0, percent: 0}),
    rung(null, {fee_cents: 0, first_night: false, percent_kept: 100}, {allowed: false, fee_cents: 0, percent: 0})]},
  flex: {id: 'pol-flex-3day', name: 'Free until three days out, then 50%', rungs: [
    rung({days_before: 3, time: '18:00'}, {fee_cents: 0, first_night: false, percent_kept: 0}, {allowed: true, fee_cents: 0, percent: 0}),
    rung(null, {fee_cents: 0, first_night: false, percent_kept: 50}, {allowed: true, fee_cents: 0, percent: 50})]},
  week: {id: 'pol-week-out', name: 'Group loops: free until a week out, then first night kept', rungs: [
    rung({days_before: 7, time: '12:00'}, {fee_cents: 0, first_night: false, percent_kept: 0}, {allowed: true, fee_cents: 1000, percent: 0}),
    rung({days_before: 0, time: '15:00'}, {fee_cents: 1000, first_night: true, percent_kept: 0}, {allowed: false, fee_cents: 0, percent: 0}),
    rung(null, {fee_cents: 0, first_night: false, percent_kept: 100}, {allowed: false, fee_cents: 0, percent: 0})]},
};

// ---- minimal.json: the manifest seed -----------------------------------------
// This function is the M1 generator unchanged; its random draws, and so its
// bytes, must not change.
function minimal() {
  const OFF = '-07:00';
  const rand = rng(20250101);
  const pick = list => list[Math.floor(rand() * list.length)];
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const stamp = (date, hh, mm) => `${date}T${pad(hh)}:${pad(mm)}:00${OFF}`;
  const policies = [POLICY.standard, POLICY.flex];
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

  return {account_id: 'sb-dana', owner_person_id: 'person-dana', holder: {display_name: 'Dana Okafor'}, facilities, policies, sites,
    wallet: {default_card_id: 'card-carol-visa', cards}, equipment, default_equipment_id: 'equip-0001', companions,
    holds: [], previews: [], reservations, payments, alerts, closures: [], claims: [], notices: []};
}

// ---- Larger fixtures ----------------------------------------------------------
// 6-8 facilities, 250-400 sites covering all six attributes (some unknown), the
// 180-day released window partly claimed by other bookers, three cards under
// two cardholders, 2-3 equipment records, 4-8 companions, seeded history from
// 2025 and four upcoming stays that the default schedule acts on.

const LARGE = {
  'high-country': {
    seed: 20260612, clock: '2026-06-12T08:00:00-06:00', history_from: '2025-01-06',
    policies: ['standard', 'flex', 'week'],
    facilities: [
      ['aspen-bench', 'Aspen Bench', 'Bridger Range', 'Terraced loops in an aspen grove; paved to loop B.', '-06:00', 'standard', 52, 3600],
      ['bridger-flats', 'Bridger Flats', 'Bridger Range', 'Open river-bottom loops with long pull-throughs.', '-06:00', 'flex', 48, 3400],
      ['coldwater-spring', 'Coldwater Spring', 'Gallatin Canyon', 'Shaded creekside sites; tight roads in loop C.', '-06:00', 'standard', 41, 3000],
      ['dutch-creek', 'Dutch Creek', 'Teton Foothills', 'Group loops and family sites around a meadow.', '-07:00', 'week', 38, 3800],
      ['elk-meadow', 'Elk Meadow', 'Teton Foothills', 'High meadow, cold nights, wide views; generator hours 08:00-20:00.', '-07:00', 'standard', 46, 3200],
      ['fir-ridge', 'Fir Ridge', 'Salmon River Mountains', 'Small forested campground; walk-in sites on the ridge trail.', '-07:00', 'flex', 34, 2600],
      ['granite-lake', 'Granite Lake', 'Beartooth Plateau', 'Lakeside loops at 9,000 feet; short season.', '-06:00', 'standard', 49, 3900],
    ],
    cards: [['card-carol-visa', 'Visa', '6120', 'Carol Okafor', 'person-carol', 11, 2028], ['card-dana-visa', 'Visa', '3307', 'Dana Okafor', 'person-dana', 5, 2029],
      ['card-dana-mc', 'Mastercard', '9054', 'Dana Okafor', 'person-dana', 3, 2026]],
    equipment: [['Old trailer', 'trailer', 19], ['Family tent', 'tent', 0], ['Camper van', 'van', 21]],
    companions: [['Mo Okafor', 'person-mo', true], ['Jules Park', 'person-jules', true], ['Pat (cousin)', null, false], ['Ana Ruiz (neighbor)', null, false], ['Grandpa Ike', null, true]],
    names: ['Ridge fire', 'Sheep Creek fire', 'Hebgen fire'],
  },
  'desert-rivers': {
    seed: 20261002, clock: '2026-10-02T07:30:00-07:00', history_from: '2025-01-03',
    policies: ['standard', 'flex'],
    facilities: [
      ['agave-wash', 'Agave Wash', 'Lower Gila', 'Desert loops with ramadas; all sites gravel.', '-07:00', 'standard', 47, 2800],
      ['blue-mesa', 'Blue Mesa', 'Upper Gila', 'Mesa-top sites; strong afternoon wind.', '-07:00', 'standard', 44, 3000],
      ['canyon-mouth', 'Canyon Mouth', 'Salt River', 'Riverside loops at the canyon mouth; flash flood signage.', '-07:00', 'flex', 39, 3500],
      ['dry-fork', 'Dry Fork', 'Salt River', 'Primitive loops and walk-in sites up the dry fork.', '-07:00', 'standard', 36, 2200],
      ['echo-bar', 'Echo Bar', 'Colorado River', 'Boat-in and drive-in sites on a gravel bar.', '-08:00', 'flex', 45, 4100],
      ['falcon-point', 'Falcon Point', 'Colorado River', 'Long pull-throughs above the river; full hookups in loop A.', '-08:00', 'standard', 50, 4600],
    ],
    cards: [['card-carol-visa', 'Visa', '7781', 'Carol Okafor', 'person-carol', 2, 2029], ['card-dana-visa', 'Visa', '1846', 'Dana Okafor', 'person-dana', 7, 2030],
      ['card-dana-amex', 'Amex', '5003', 'Dana Okafor', 'person-dana', 8, 2026]],
    equipment: [['Old trailer', 'trailer', 18], ['Dome tent', 'tent', 0]],
    companions: [['Mo Okafor', 'person-mo', true], ['Jules Park', 'person-jules', true], ['Pat (cousin)', null, false], ['Theo Okafor', null, true],
      ['Rosa Diaz (friend)', null, false], ['Sam Park', null, false]],
    names: ['Mesa fire', 'Sycamore fire', 'Tonto fire'],
  },
};

function large(name) {
  const spec = LARGE[name], rand = rng(spec.seed);
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = list => list[Math.floor(rand() * list.length)];
  const chance = p => rand() < p;
  const clockDate = spec.clock.slice(0, 10), clockMs = Date.parse(spec.clock);
  const facilities = spec.facilities.map(([id, nm, region, description, utc_offset, pol]) =>
    ({id, name: nm, region, description, utc_offset, policy_id: POLICY[pol].id}));
  const off = id => facilities.find(f => f.id === id).utc_offset;
  const stamp = (fid, date, hh, mm) => `${date}T${pad(hh)}:${pad(mm)}:00${off(fid)}`;

  // Sites. Loops A and B are drive-in; C is tent and small trailer; W is walk-in.
  const sites = [];
  for (const [fid, , , , , , count, base] of spec.facilities) {
    const prefix = fid.split('-').map(w => w[0]).join('');
    for (let i = 1; i <= count; i++) {
      const loop = i <= count * 0.4 ? 'A' : i <= count * 0.7 ? 'B' : i <= count * 0.88 ? 'C' : 'W';
      const walk = loop === 'W';
      const electric = walk ? null : loop === 'A' ? pick([30, 50, 50, 30, 20]) : loop === 'B' ? pick([null, 30, 20, null]) : null;
      let length = walk ? 0 : loop === 'A' ? int(28, 45) : loop === 'B' ? int(20, 36) : int(12, 22);
      if (!walk && chance(0.04)) length = null;  // not recorded: matches no length filter
      const ada = chance(0.04) ? null : !walk && chance(loop === 'A' ? 0.25 : 0.08);
      const pets = chance(0.03) ? null : !chance(loop === 'W' ? 0.3 : 0.08);
      const site = {id: `${prefix}-${loop}${pad(i)}`, facility_id: fid, name: `${loop}${pad(i)}`, loop,
        electric_amps: electric, max_vehicle_ft: length, ada_accessible: ada, walk_in_ft: walk ? int(6, 60) * 10 : 0,
        max_occupancy: walk ? int(2, 4) : pick([4, 6, 6, 8, 8, 10]), pets_allowed: pets,
        nightly_cents: base + (electric ? 1000 + (electric === 50 ? 600 : 0) : 0) + (walk ? -800 : 0) + int(0, 4) * 100};
      sites.push(site);
    }
  }
  const siteBy = Object.fromEntries(sites.map(s => [s.id, s]));
  const sitesOf = fid => sites.filter(s => s.facility_id === fid);

  const cards = spec.cards.map(([id, brand, last4, holder_name, holder_person_id, exp_month, exp_year]) =>
    ({id, brand, last4, holder_name, holder_person_id, exp_month, exp_year}));
  const savedAt = '2025-03-02T10:00:00' + facilities[0].utc_offset;
  const equipment = spec.equipment.map(([label, kind, length_ft], i) =>
    ({id: `equip-${String(i + 1).padStart(4, '0')}`, label, kind, length_ft, updated_at: savedAt}));
  const companions = spec.companions.map(([display_name, person_id, default_party], i) =>
    ({id: `comp-${String(i + 1).padStart(4, '0')}`, display_name, person_id, default_party,
      updated_at: i < 3 ? savedAt : '2025-06-14T18:00:00' + facilities[0].utc_offset}));
  const party = companions.filter(c => c.default_party).map(c => ({id: c.id, display_name: c.display_name, person_id: c.person_id}));
  const holder = {kind: 'holder', id: 'holder', display_name: 'Dana Okafor'};

  const reservations = [], payments = [], taken = new Set();
  let resN = 0, payN = 0;
  const id4 = (p, n) => `${p}-${String(n).padStart(4, '0')}`;
  function reservation({site, arrival, departure, state, created, card, hist}) {
    const s = siteBy[site], f = facilities.find(x => x.id === s.facility_id), n = nights(arrival, departure);
    const nightly = n.map(() => s.nightly_cents);
    const gear = s.max_vehicle_ft !== null && s.max_vehicle_ft >= equipment[0].length_ft ? equipment[0] : equipment[1];
    hist = hist || [{at: created, action: 'confirmed'}];
    const r = {id: id4('res', ++resN), facility_id: f.id, site_id: site, arrival, departure, nights: n, nightly_cents: nightly,
      total_cents: nightly.reduce((a, b) => a + b, 0), policy_id: f.policy_id, primary_occupant: holder,
      equipment: gear, companions: party, party_size: party.length + 1, pets: 0, card_id: card, state, late_arrival: false,
      created_at: created, updated_at: hist.at(-1).at, history: hist};
    reservations.push(r);
    if (state !== 'cancelled') for (const d of n) taken.add(site + '|' + d);
    payments.push({id: id4('pay', ++payN), reservation_id: r.id, card_id: card, amount_cents: r.total_cents, kind: 'charge', reason: 'booking',
      created_at: created, posts_at: created, status: 'posted'});
    return r;
  }
  // A drive-in site that fits the old trailer, with power when asked for.
  const siteFor = (fid, power) => pick(sitesOf(fid).filter(s => s.loop !== 'W' && s.max_vehicle_ft !== null &&
    s.max_vehicle_ft >= equipment[0].length_ft && (power ? s.electric_amps !== null : true)));

  // Four upcoming stays (res-0001..0004) for the default schedule:
  // 1 checks in and completes; 2 is cancelled by a closure; 3 is a no-show;
  // 4 is marked affected by an alert that is later narrowed away from it.
  const fx = facilities.map(f => f.id);
  const upcoming = [
    {fid: fx[0], lead: 9, length: 2, power: true, card: 'card-dana-visa'},
    {fid: fx[1], lead: 16, length: 3, power: false, card: 'card-carol-visa'},
    {fid: fx[2], lead: 23, length: 2, power: false, card: 'card-dana-visa'},
    {fid: fx[3], lead: 38, length: 2, power: true, card: 'card-carol-visa'},
  ];
  for (const u of upcoming) {
    const arrival = addDays(clockDate, u.lead), departure = addDays(arrival, u.length);
    const created = stamp(u.fid, addDays(clockDate, -int(40, 150)), int(7, 21), int(0, 59));
    u.site = siteFor(u.fid, u.power).id;
    u.reservation = reservation({site: u.site, arrival, departure, state: 'confirmed', created, card: u.card});
  }

  // Seeded history: one stay in most months from the history floor to the clock.
  for (let month = 0; ; month++) {
    const base = addDays(spec.history_from, month * 30);
    if (base >= addDays(clockDate, -12)) break;
    if (chance(0.35)) continue;
    const fid = pick(fx), arrival = addDays(base, int(0, 6)), departure = addDays(arrival, int(1, 3));
    const site = siteFor(fid, chance(0.3)).id;
    if (nights(arrival, departure).some(d => taken.has(site + '|' + d) || (fid === fx[5] && d >= '2025-12-01' && d < '2026-01-15'))) continue;
    const lead = int(20, 120);
    let created = stamp(fid, addDays(arrival, -lead), int(7, 21), int(0, 59));
    if (created < spec.history_from) created = stamp(fid, spec.history_from, 9, int(0, 59));
    const roll = rand(), card = chance(0.7) ? 'card-dana-visa' : 'card-carol-visa';
    if (roll < 0.74) {
      reservation({site, arrival, departure, state: 'completed', created, card, hist: [{at: created, action: 'confirmed'},
        {at: stamp(fid, arrival, int(14, 19), int(0, 59)), action: 'checked_in'}, {at: stamp(fid, departure, 12, 0), action: 'completed'}]});
    } else if (roll < 0.9) {
      const at = stamp(fid, addDays(arrival, -int(15, 19)), int(8, 20), int(0, 59));
      if (at <= created) continue;
      const r = reservation({site, arrival, departure, state: 'cancelled', created, card, hist: [{at: created, action: 'confirmed'}, {at, action: 'cancelled'}]});
      r.history[1].refund_cents = r.total_cents;
      payments.push({id: id4('pay', ++payN), reservation_id: r.id, card_id: card, amount_cents: r.total_cents, kind: 'refund', reason: 'cancellation',
        created_at: at, posts_at: isoAt(Date.parse(at) + 3 * 86400000, off(fid)), status: 'posted'});
    } else {
      reservation({site, arrival, departure, state: 'no_show', created, card, hist: [{at: created, action: 'confirmed'}, {at: stamp(fid, arrival, 21, 0), action: 'no_show_released'}]});
    }
  }

  // Other bookers in the 180-day released window: busy weekends, quiet weekdays.
  // One claim per site per 45-day block lists the nights taken in that block.
  const claims = [];
  const released = nights(clockDate, addDays(clockDate, 180));
  for (const s of sites) {
    for (let b = 0; b < released.length; b += 45) {
      const block = released.slice(b, b + 45).filter(d => !taken.has(s.id + '|' + d) &&
        chance([5, 6].includes(weekday(d)) ? 0.42 : weekday(d) === 0 ? 0.12 : 0.06));
      for (let i = 0; i < block.length; i += 14) {
        const part = block.slice(i, i + 14);
        for (const d of part) taken.add(s.id + '|' + d);
        // Booked at a release instant before the clock, or in the hour before it.
        const releaseAt = Date.parse(`${addDays(part[0], -180)}T07:00:00${off(s.facility_id)}`);
        const at = releaseAt < clockMs && releaseAt >= Date.parse(spec.history_from) ? releaseAt + int(5, 900) * 1000 : clockMs - int(60, 3600) * 1000;
        claims.push({id: id4('claim', claims.length + 1), site_id: s.id, nights: part, claimed_at: isoAt(at, off(s.facility_id))});
      }
    }
  }

  const alerts = [
    {id: 'al-0001', kind: 'smoke_advisory', facility_id: fx[0], site_ids: [], from: stamp(fx[0], '2025-08-11', 0, 0), to: stamp(fx[0], '2025-08-15', 0, 0),
      text: `Smoke from the ${spec.names[0]}; air unhealthy for sensitive groups.`, posted_at: stamp(fx[0], '2025-08-10', 16, 0), cancelled_at: null, revisions: []},
    {id: 'al-0002', kind: 'water_outage', facility_id: fx[2], site_ids: sitesOf(fx[2]).slice(0, 4).map(s => s.id),
      from: stamp(fx[2], '2026-02-03', 8, 0), to: stamp(fx[2], '2026-02-10', 8, 0), text: 'Water line repair in loop A.',
      posted_at: stamp(fx[2], '2026-02-02', 12, 0), cancelled_at: stamp(fx[2], '2026-02-06', 10, 0), revisions: []},
    {id: 'al-0003', kind: 'fire_restriction', facility_id: fx[4], site_ids: [], from: stamp(fx[4], addDays(clockDate, -10), 0, 0),
      to: stamp(fx[4], addDays(clockDate, 110), 0, 0), text: 'Stage 1 fire restriction: campfires only in provided rings.',
      posted_at: stamp(fx[4], addDays(clockDate, -11), 9, 0), cancelled_at: null, revisions: []},
  ];
  const closures = [
    {id: 'cl-0001', facility_id: fx[5], site_ids: [], from: '2025-12-01', to: '2026-01-15', reason: 'seasonal closure for road work', ordered_at: stamp(fx[5], '2025-10-20', 9, 0)},
  ];

  const seed = {account_id: 'sb-dana', owner_person_id: 'person-dana', holder: {display_name: 'Dana Okafor'}, facilities,
    policies: spec.policies.map(p => POLICY[p]), sites,
    wallet: {default_card_id: 'card-carol-visa', cards}, equipment, default_equipment_id: 'equip-0001', companions,
    holds: [], previews: [], reservations, payments, alerts, closures, claims, notices: []};
  return {seed, upcoming, taken, rand, int, pick, stamp, sitesOf};
}

// ---- Default scenario schedules ------------------------------------------------
// Each schedule is a fixed list of events. Claim events carry a time window;
// their instants come from the evaluator-side claim-times file.

const at = (date, time, offset) => `${date}T${time}:00${offset}`;

function minimalTemplate() {
  const O = '-07:00', clock = '2027-05-20T09:00:00-07:00';
  const fixed = [
    ['switchback.alert.posted', at('2027-05-22', '09:00', O), {alert_id: 'al-0101', kind: 'fire_restriction', facility_id: 'pine-hollow', site_ids: [],
      from: at('2027-05-25', '00:00', O), to: at('2027-09-30', '00:00', O), text: 'Stage 2 fire restriction: no campfires, including in provided rings.'}],
    ['switchback.alert.posted', at('2027-05-28', '10:00', O), {alert_id: 'al-0102', kind: 'road_restriction', facility_id: 'cedar-flat', site_ids: ['cf-C03', 'cf-C07'],
      from: at('2027-06-01', '08:00', O), to: at('2027-06-12', '17:00', O), text: 'Loop C road grading: vehicles over 20 ft wait at the gate until 17:00.'}],
    ['switchback.alert.updated', at('2027-06-05', '14:00', O), {alert_id: 'al-0102', to: at('2027-06-15', '17:00', O),
      text: 'Loop C road grading extended: vehicles over 20 ft wait at the gate until 17:00 through June 15.'}],
    ['switchback.alert.posted', at('2027-06-10', '09:00', O), {alert_id: 'al-0103', kind: 'electrical_outage', facility_id: 'cedar-flat', site_ids: ['cf-B10', 'cf-B14'],
      from: at('2027-06-17', '12:00', O), to: at('2027-06-20', '12:00', O), text: 'Transformer replacement on loop B: no power at B10 and B14.'}],
    ['switchback.alert.updated', at('2027-06-12', '09:00', O), {alert_id: 'al-0103', to: at('2027-06-18', '18:00', O), text: 'Transformer work shortened: power back at B10 and B14 by 18:00 on June 18.'}],
    ['switchback.alert.cancelled', at('2027-06-17', '08:00', O), {alert_id: 'al-0103'}],
    ['switchback.reservation.checked_in', at('2027-06-18', '16:10', O), {reservation_id: 'res-0001'}],
    ['switchback.alert.posted', at('2027-06-24', '07:00', O), {alert_id: 'al-0104', kind: 'smoke_advisory', facility_id: 'lakeshore', site_ids: [],
      from: at('2027-06-26', '00:00', O), to: at('2027-07-06', '00:00', O), text: 'Smoke from the Pass fire: air unhealthy for sensitive groups.'}],
    ['switchback.alert.posted', at('2027-06-27', '10:00', O), {alert_id: 'al-0105', kind: 'water_outage', facility_id: 'lakeshore', site_ids: ['ls-01', 'ls-04'],
      from: at('2027-06-28', '08:00', O), to: at('2027-07-08', '08:00', O), text: 'Water main break on the Shore loop: no water at sites 01 and 04.'}],
    ['switchback.closure.ordered', at('2027-06-29', '09:00', O), {closure_id: 'cl-0201', facility_id: 'lakeshore', site_ids: ['ls-01', 'ls-04'],
      from: '2027-07-01', to: '2027-07-08', reason: 'water main repair on the Shore loop'}],
    ['switchback.alert.cancelled', at('2027-07-01', '12:00', O), {alert_id: 'al-0105'}],
    ['switchback.alert.updated', at('2027-07-03', '09:00', O), {alert_id: 'al-0104', to: at('2027-07-04', '12:00', O), text: 'Smoke clearing: the advisory ends at noon on July 4.'}],
    ['switchback.alert.posted', at('2027-07-05', '08:00', O), {alert_id: 'al-0106', kind: 'trail_restriction', facility_id: 'cedar-flat', site_ids: [],
      from: at('2027-07-05', '08:00', O), to: at('2027-07-20', '00:00', O), text: 'Lakeshore trail closed at mile 2 for bridge work.'}],
  ];
  // Competing claims on open weekend nights. (site, first night, nights)
  const claimSpec = [
    ['cf-B10', '2027-05-28', 2], ['cf-B12', '2027-05-29', 1], ['ph-17', '2027-05-28', 2], ['cf-C03', '2027-06-04', 2], ['ls-01', '2027-06-04', 2],
    ['ph-14', '2027-06-05', 1], ['cf-W02', '2027-06-11', 2], ['ls-09', '2027-06-11', 2], ['cf-B12', '2027-06-12', 1], ['ph-W05', '2027-06-12', 1],
    ['cf-C07', '2027-06-18', 2], ['cf-B12', '2027-06-18', 2], ['ls-04', '2027-06-18', 2], ['ph-17', '2027-06-19', 1], ['cf-B12', '2027-06-25', 2],
    ['cf-B10', '2027-06-26', 1], ['ls-01', '2027-06-25', 2], ['ph-14', '2027-06-25', 2], ['cf-C03', '2027-07-02', 2], ['ls-09', '2027-07-02', 2],
    ['cf-B14', '2027-07-03', 1], ['ph-W05', '2027-07-03', 2],
  ];
  const claims = claimSpec.map(([site_id, first, n]) => ({site_id, nights: nights(first, addDays(first, n)), offset: O}));
  return {fixture: 'minimal', prefix: 'mn', initial_time: clock, end_time: '2027-07-08T12:00:00-07:00', fixed, claims};
}

function largeTemplate(name, built) {
  const spec = LARGE[name], {seed, upcoming, taken, rand, int, pick, stamp, sitesOf} = built;
  const clock = spec.clock, clockDate = clock.slice(0, 10), fx = seed.facilities.map(f => f.id);
  const p = name === 'high-country' ? 'hc' : 'dr';
  const [u1, u2, u3, u4] = upcoming.map(u => ({...u, r: u.reservation}));
  const alertId = n => `al-${p}-${String(n).padStart(2, '0')}`;
  const fixed = [];
  const ev = (op, time, payload) => fixed.push([op, time, payload]);
  // Stay 1: an electrical outage on its site is posted, then lifted early; then check-in.
  ev('switchback.alert.posted', stamp(u1.fid, addDays(clockDate, 2), 10, 0), {alert_id: alertId(1), kind: 'electrical_outage', facility_id: u1.fid,
    site_ids: [u1.site], from: stamp(u1.fid, addDays(u1.r.arrival, -1), 8, 0), to: stamp(u1.fid, u1.r.departure, 12, 0),
    text: `Pedestal repair: no power at ${u1.site.split('-')[1]} during the repair window.`});
  ev('switchback.alert.cancelled', stamp(u1.fid, addDays(u1.r.arrival, -2), 15, 30), {alert_id: alertId(1)});
  ev('switchback.reservation.checked_in', stamp(u1.fid, u1.r.arrival, 15, 40), {reservation_id: u1.r.id});
  // Stay 2: a road washout closes part of its facility, cancelling the whole stay.
  const loop = sitesOf(u2.fid).filter(s => s.loop === siteLoop(u2.site, seed)).map(s => s.id);
  ev('switchback.alert.posted', stamp(u2.fid, addDays(clockDate, 5), 7, 30), {alert_id: alertId(2), kind: 'road_restriction', facility_id: u2.fid,
    site_ids: loop, from: stamp(u2.fid, addDays(clockDate, 5), 7, 30), to: stamp(u2.fid, addDays(u2.r.arrival, 6), 0, 0),
    text: `Washout on the loop ${siteLoop(u2.site, seed)} road: high-clearance vehicles only.`});
  ev('switchback.closure.ordered', stamp(u2.fid, addDays(u2.r.arrival, -3), 6, 0), {closure_id: `cl-${p}-01`, facility_id: u2.fid, site_ids: loop,
    from: addDays(u2.r.arrival, 1), to: addDays(u2.r.arrival, 8), reason: `road washout on loop ${siteLoop(u2.site, seed)}`});
  ev('switchback.alert.updated', stamp(u2.fid, addDays(u2.r.arrival, -2), 9, 0), {alert_id: alertId(2),
    text: `Loop ${siteLoop(u2.site, seed)} road closed to all vehicles; see the closure notice.`});
  // Stay 3: no check-in event, so it is released at 21:00 on arrival day.
  ev('switchback.alert.posted', stamp(u3.fid, addDays(u3.r.arrival, -4), 11, 0), {alert_id: alertId(3), kind: 'trail_restriction', facility_id: u3.fid,
    site_ids: [], from: stamp(u3.fid, addDays(u3.r.arrival, -3), 0, 0), to: stamp(u3.fid, addDays(u3.r.arrival, 20), 0, 0),
    text: 'Creek trail closed past the footbridge for bank repair.'});
  // Stay 4: a smoke advisory covers it, then is narrowed to end before it.
  ev('switchback.alert.posted', stamp(u4.fid, addDays(u4.r.arrival, -9), 16, 0), {alert_id: alertId(4), kind: 'smoke_advisory', facility_id: u4.fid,
    site_ids: [], from: stamp(u4.fid, addDays(u4.r.arrival, -8), 0, 0), to: stamp(u4.fid, addDays(u4.r.arrival, 3), 0, 0),
    text: `Smoke from the ${spec.names[1]}: air unhealthy for sensitive groups.`});
  ev('switchback.alert.updated', stamp(u4.fid, addDays(u4.r.arrival, -5), 9, 0), {alert_id: alertId(4), to: stamp(u4.fid, addDays(u4.r.arrival, -1), 12, 0),
    text: `Smoke from the ${spec.names[1]} clearing: the advisory ends at noon the day before ${u4.r.arrival}.`});
  // Facility-wide notices that touch no stay of this account.
  ev('switchback.alert.posted', stamp(fx[4], addDays(clockDate, 12), 9, 0), {alert_id: alertId(5), kind: 'fire_restriction', facility_id: fx[4], site_ids: [],
    from: stamp(fx[4], addDays(clockDate, 13), 0, 0), to: stamp(fx[4], addDays(clockDate, 120), 0, 0), text: 'Stage 2 fire restriction: no campfires of any kind.'});
  ev('switchback.alert.cancelled', stamp(fx[0], addDays(clockDate, 20), 8, 0), {alert_id: 'al-0003'});
  ev('switchback.alert.posted', stamp(fx[5], addDays(clockDate, 27), 13, 0), {alert_id: alertId(6), kind: 'water_outage', facility_id: fx[5],
    site_ids: sitesOf(fx[5]).slice(0, 3).map(s => s.id), from: stamp(fx[5], addDays(clockDate, 28), 8, 0), to: stamp(fx[5], addDays(clockDate, 31), 8, 0),
    text: 'Water off at the first three sites for a valve repair.'});
  ev('switchback.closure.ordered', stamp(fx[5], addDays(clockDate, 33), 7, 0), {closure_id: `cl-${p}-02`, facility_id: fx[5],
    site_ids: sitesOf(fx[5]).filter(s => s.loop === 'W').map(s => s.id), from: addDays(clockDate, 35), to: addDays(clockDate, 42), reason: 'hazard tree removal on the walk-in trail'});
  ev('switchback.alert.posted', stamp(fx[1], addDays(clockDate, 41), 10, 0), {alert_id: alertId(7), kind: 'smoke_advisory', facility_id: fx[1], site_ids: [],
    from: stamp(fx[1], addDays(clockDate, 41), 10, 0), to: stamp(fx[1], addDays(clockDate, 44), 0, 0), text: `Smoke from the ${spec.names[2]}: limit strenuous activity.`});

  // Competing claims: open nights, one to three per claim, never claimed or booked in the seed.
  const claims = [], used = new Set(taken);
  while (claims.length < 24) {
    const fid = pick(fx), s = pick(sitesOf(fid)), first = addDays(clockDate, int(3, 44)), n = int(1, 3);
    const list = nights(first, addDays(first, n));
    if (list.some(d => used.has(s.id + '|' + d))) continue;
    for (const d of list) used.add(s.id + '|' + d);
    claims.push({site_id: s.id, nights: list, offset: seed.facilities.find(f => f.id === fid).utc_offset});
  }
  void rand;
  return {fixture: name, prefix: p, initial_time: clock, end_time: stamp(fx[0], addDays(clockDate, 46), 12, 0), fixed, claims};
}

function siteLoop(siteId, seed) {
  return seed.sites.find(s => s.id === siteId).loop;
}

// A claim's window: from 10 minutes after the clock to 20:00 local the day before its first night.
function claimWindow(template, claim) {
  const from = Date.parse(template.initial_time) + 10 * 60000;
  const to = Date.parse(`${addDays(claim.nights[0], -1)}T20:00:00${claim.offset}`);
  return [from, Math.max(from + 60000, to)];
}

const claimId = (template, i) => `${template.prefix}-claim-${String(i + 1).padStart(2, '0')}`;

// Draws claim instants uniformly at one-second resolution inside each window.
function drawTimes(template, draw) {
  const times = {};
  template.claims.forEach((c, i) => {
    const [from, to] = claimWindow(template, c);
    times[claimId(template, i)] = isoAt(from + draw(Math.floor((to - from) / 1000)) * 1000, c.offset);
  });
  return times;
}

function schedule(template, times) {
  const events = template.fixed.map(([operation, time, payload], i) =>
    ({event_id: `${template.prefix}-ev-${String(i + 1).padStart(2, '0')}`, at: time, operation, payload}));
  template.claims.forEach((c, i) => {
    const id = claimId(template, i);
    if (!times[id]) throw Error(`Claim time missing for ${id}`);
    events.push({event_id: id, at: times[id], operation: 'switchback.inventory.claimed', payload: {site_id: c.site_id, nights: c.nights}});
  });
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.event_id.localeCompare(b.event_id));
  return {fixture: template.fixture, initial_time: template.initial_time, end_time: template.end_time,
    claim_times_ref: `fixtures/evaluator/${template.fixture}.claim-times.json`, events};
}

const json = value => JSON.stringify(value, null, 2) + '\n';

function templates() {
  const out = {minimal: minimalTemplate()};
  const seeds = {minimal: minimal()};
  for (const name of Object.keys(LARGE)) {
    const built = large(name);
    seeds[name] = built.seed;
    out[name] = largeTemplate(name, built);
  }
  return {templates: out, seeds};
}

// Every output file, keyed by its path under fixtures/. Claim-times files are
// read from disk; a missing one is drawn from OS entropy when `draw` is set.
function build({draw = false, dir = __dirname} = {}) {
  const {templates: t, seeds} = templates(), files = {};
  for (const [name, template] of Object.entries(t)) {
    files[`${name}.json`] = json(seeds[name]);
    const timesFile = path.join(dir, 'evaluator', `${name}.claim-times.json`);
    let record;
    if (fs.existsSync(timesFile)) record = JSON.parse(fs.readFileSync(timesFile, 'utf8'));
    else if (draw) {
      record = {fixture: name, source: 'crypto.randomInt (OS entropy), drawn once and never regenerated',
        note: 'Evaluator-side. No Switchback tool or page reads this file.', times: drawTimes(template, n => crypto.randomInt(n + 1))};
      files[`evaluator/${name}.claim-times.json`] = json(record);
    } else throw Error(`Missing ${path.relative(dir, timesFile)}; run node fixtures/generate.cjs to draw it once.`);
    files[`schedules/${name}.json`] = json(schedule(template, record.times));
  }
  files['clock.json'] = json({initial_time: t.minimal.initial_time});
  return files;
}

module.exports = {build, templates, schedule, drawTimes, claimWindow, rng, LARGE};

if (require.main === module) {
  const check = process.argv.includes('--check');
  const files = build({draw: !check});
  let drift = 0;
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(__dirname, rel);
    if (check) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) { console.error('Differs: fixtures/' + rel); drift++; }
    } else {
      fs.mkdirSync(path.dirname(file), {recursive: true});
      // A drawn claim-times file is written once and never replaced.
      if (rel.startsWith('evaluator/') && fs.existsSync(file)) continue;
      fs.writeFileSync(file, content);
    }
  }
  if (check && drift) process.exitCode = 1;
  else console.log((check ? 'Fixtures and schedules match: ' : 'Wrote: ') + Object.keys(files).map(f => 'fixtures/' + f).join(', '));
}
