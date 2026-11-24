#!/usr/bin/env node
'use strict';
// Deterministic generator for the three seeds. Each opens one account and
// replays its history through Crossway's own event and tool handlers, so every
// balance, statement, notice and dispute in a seed was produced by the same
// rules the App enforces. Random tolls come from a fixed-seed PRNG per seed.
// A run ends at the seed's clock; outgoing Mail notices from history count as
// delivered and are cleared, as are the history's spent previews (run state).
//   dani     fixtures/minimal.json (the manifest seed), opened 2025-01-06
//   marisol  fixtures/seeds/marisol/seed.json, opened 2025-02-03
//   theo     fixtures/seeds/theo/seed.json, opened 2025-05-12
//   node scripts/generate-seed.cjs           writes all three
//   node scripts/generate-seed.cjs --check   compares only
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const C = require('../src/clock.cjs');
const {settle} = require('../src/settle.cjs');

const root = path.resolve(__dirname, '..');
const OPENED = '2025-01-06';
const PRNG_SEED = 20250106;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const at = (date, hh, mm = 0) => C.stamp(C.midnight(date) + (hh * 60 + mm) * C.MINUTE);
const mail = c => Math.round(c * 1.65 / 25) * 25;
const PLAZAS = [
  ['pz-harbor', 'Harbor Bridge', 'Harbor Expressway', 425], ['pz-millrace', 'Millrace', 'Millrace Parkway', 300],
  ['pz-kettle', 'Kettle Creek', 'Northern Turnpike', 650], ['pz-northgate', 'Northgate', 'Northern Turnpike', 550],
  ['pz-cedar', 'Cedar Road', 'Valley Connector', 225], ['pz-fallow', 'Fallow Hill', 'Valley Connector', 375],
  ['pz-stonebridge', 'Stonebridge', 'Stonebridge Crossing', 800], ['pz-ridge', 'Ridgeline', 'Ridgeline Highway', 475],
  ['pz-lantern', 'Lantern Point', 'Lantern Point Bridge', 950], ['pz-ferry', 'Ferry Street', 'Harbor Expressway', 275],
  ['pz-ashford', 'Ashford', 'Ridgeline Highway', 350], ['pz-quarry', 'Quarry Gap', 'Northern Turnpike', 600],
].map(([id, name, road, c1]) => ({id, name, road, account_cents: [c1, 2 * c1, 3 * c1], mail_cents: [mail(c1), mail(2 * c1), mail(3 * c1)]}));

const card = (id, holder_person_id, holder_name, brand, last4, exp_month, exp_year) =>
  ({id, holder_person_id, holder_name, brand, last4, exp_month, exp_year, status: 'active', history: []});

// One account at the shared fictional authority.
function account({account_id, owner, name, opened, cards, transponders, replenish}) {
  const tp = ([id, serial, cls]) => ({id, serial, class: cls, vehicle_id: null, issued_on: opened, history: []});
  return {
    account_id, owner_person_id: owner, holder: {display_name: name}, opened_on: opened,
    authority: {
      name: 'Crossway Toll Authority', time_zone: 'America/New_York', plazas: PLAZAS,
      rental_agencies: [{id: 'ag-swiftrent', name: 'SwiftRent Car Rental'}, {id: 'ag-harborline', name: 'Harborline Rentals'}],
      plates_on_other_accounts: ['BXL3307', 'MRT6620', 'QPN4418'],
      policy: {
        vehicle_classes: [{class: 1, label: 'Two axles: car, SUV or pickup'}, {class: 2, label: 'Two axles: commercial or high-roof van'},
          {class: 3, label: 'Three or more axles, or any vehicle towing a trailer'}],
        late_fee_cents: 2500, notice_due_days: 30, escalated_due_days: 30, dispute_window_days: 45, denial_due_days: 14,
        preview_minutes: 15, temporary_plate_max_days: 30, topup_min_cents: 1000, topup_max_cents: 50000,
        replenish_min_cents: 2000, replenish_max_cents: 20000, threshold_min_cents: 1000, threshold_max_cents: 10000,
      },
    },
    cards,
    replenish: {enabled: false, ...replenish, consecutive_failures: 0, updated_at: at(opened, 10)},
    balance_cents: 0, suspended_at: null,
    vehicles: [], transponders: transponders.map(tp),
    tolls: [], ledger: [], statements: [], notices: [], disputes: [], dispute_decisions: [], receipts: [], outgoing: [], run: {previews: []},
  };
}

// ---- Dani Reyes (the manifest seed) ------------------------------------------

function skeleton() {
  return account({account_id: 'cw-dani', owner: 'person-dani', name: 'Dani Reyes', opened: OPENED,
    cards: [card('card-dani-visa', 'person-dani', 'Dani Reyes', 'Visa', '4417', 8, 2029),
      card('card-dani-mc', 'person-dani', 'Dani Reyes', 'Mastercard', '2290', 9, 2026),
      card('card-jordan-amex', 'person-jordan', 'Jordan Albright', 'Amex', '1007', 11, 2027)],
    transponders: [['tp-0001', 'CW-2501-88412', 2], ['tp-0002', 'CW-2501-88413', 1]],
    replenish: {card_id: 'card-dani-mc', amount_cents: 4000, threshold_cents: 1500}});
}

// Fixed history. Each plate read carries a plan for what Dani did with its notice.
function scripted() {
  const call = (time, name, args) => ({time, kind: 'call', name, args});
  const plate = (time, plaza, plateNo, plan, cls = 1) => ({time, kind: 'toll', read: 'plate', plaza, plate: plateNo, cls, plan});
  return [
    call(at(OPENED, 10, 0), 'vehicles.add', {plate: 'VNT8812', class: 2, label: '2017 Ford Transit Connect', possession_start: OPENED}),
    call(at(OPENED, 10, 1), 'vehicles.add', {plate: 'HKR4471', class: 1, label: '2014 Honda Fit', possession_start: OPENED}),
    call(at(OPENED, 10, 2), 'transponders.assign', {transponder_id: 'tp-0001', vehicle_id: 'v-0001'}),
    call(at(OPENED, 10, 3), 'transponders.assign', {transponder_id: 'tp-0002', vehicle_id: 'v-0002'}),
    {time: at(OPENED, 10, 4), kind: 'topup', amount: 5000, card: 'card-dani-mc'},
    call(at(OPENED, 10, 5), 'account.replenish.set', {enabled: true, card_id: 'card-dani-mc', amount_cents: 4000, threshold_cents: 1500}),
    call(at('2025-02-10', 18, 0), 'vehicles.add', {plate: 'JRD5530', class: 1, label: '2019 Subaru Outback (Jordan)', possession_start: '2025-02-10'}),
    call(at('2025-02-10', 18, 2), 'account.replenish.set', {enabled: true, card_id: 'card-jordan-amex'}),
    plate(at('2025-03-14', 17, 22), 'pz-northgate', 'JRD5530', 'ignore'),
    plate(at('2025-07-12', 11, 5), 'pz-lantern', 'HKR4471', 'dispute_granted'),
    plate(at('2025-11-08', 13, 40), 'pz-ridge', 'JRD5530', 'dispute_denied_then_pay'),
    call(at('2026-06-01', 12, 0), 'vehicles.add', {plate: 'KLM2210', class: 1, label: '2025 Kia Niro', possession_start: '2026-06-01'}),
    plate(at('2026-09-05', 15, 12), 'pz-quarry', 'JRD5530', 'leave'),
    plate(at('2026-09-12', 9, 31), 'pz-ferry', 'KLM2210', 'leave'),
    plate(at('2026-09-20', 10, 14), 'pz-kettle', 'HKR4471', 'leave'),
    call(at('2026-10-02', 14, 0), 'vehicles.add', {plate: 'RNT0917', class: 1, label: 'Rental: 2026 Nissan Sentra', temporary: true,
      possession_start: '2026-10-02', possession_end: '2026-10-06', rental_agency_id: 'ag-swiftrent'}),
    plate(at('2026-10-04', 16, 48), 'pz-stonebridge', 'RNT0917', 'leave'),
    plate(at('2026-10-06', 8, 2), 'pz-harbor', 'KLM2210', 'leave'),
    plate(at('2026-10-11', 7, 42), 'pz-kettle', 'HKR4471', 'leave'),
    plate(at('2026-10-19', 18, 26), 'pz-northgate', 'HKR4471', 'leave'),
  ];
}

// Random transponder tolls and Jordan's occasional plate reads.
function random(rand) {
  const out = [], pick = list => list[Math.floor(rand() * list.length)];
  const trips = ['pz-kettle', 'pz-northgate', 'pz-cedar', 'pz-fallow', 'pz-stonebridge', 'pz-ridge', 'pz-lantern', 'pz-ashford', 'pz-quarry'];
  for (let d = C.addDays(OPENED, 1); d <= '2026-11-01'; d = C.addDays(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow >= 1 && dow <= 5 && rand() < 0.3) {
      // tp-0001 rode in the van until Dani moved it to the Kia on 2026-08-01, unreported.
      const kia = d >= '2026-08-01';
      out.push({time: at(d, 7, 5 + Math.floor(rand() * 50)), kind: 'toll', read: 'transponder', transponder: 'tp-0001',
        plaza: rand() < 0.7 ? 'pz-harbor' : 'pz-millrace', plate: kia ? 'KLM2210' : 'VNT8812', cls: kia ? 1 : 2});
    }
    if (dow === 6 && d <= '2026-09-26' && rand() < 0.25) {
      out.push({time: at(d, 9 + Math.floor(rand() * 8), Math.floor(rand() * 60)), kind: 'toll', read: 'transponder',
        transponder: 'tp-0002', plaza: pick(trips), plate: 'HKR4471', cls: 1});
    }
    if (d >= '2025-02-11' && d <= '2026-08-14' && rand() < 0.012) {
      out.push({time: at(d, 12 + Math.floor(rand() * 8), Math.floor(rand() * 60)), kind: 'toll', read: 'plate',
        plaza: pick(trips), plate: 'JRD5530', cls: 1, plan: 'pay'});
    }
  }
  return out;
}

// ---- Marisol Ortega ------------------------------------------------------------
// Catering business and a family minivan. Her auto-replenish card, a Discover,
// expired at the end of January 2026, so February's replenish attempts failed
// and the account is suspended: tolls since then are notices at the mail rate.
// Her son Leo's Malibu was sold on 2026-01-20 and is still listed. A loaner from
// Harborline is on the account while the minivan is in the body shop.

const M_OPENED = '2025-02-03';
const M_SALE = '2026-01-20';
const M_SHOP = ['2026-02-20', '2026-03-12'];
const M_MAIL = object_id => ({app_id: 'mail', account_id: 'mail-marisol', object_id});

function marisolSkeleton() {
  return account({account_id: 'cw-marisol', owner: 'person-marisol', name: 'Marisol Ortega', opened: M_OPENED,
    cards: [card('card-marisol-visa', 'person-marisol', 'Marisol Ortega', 'Visa', '6631', 5, 2028),
      card('card-marisol-disc', 'person-marisol', 'Marisol Ortega', 'Discover', '0458', 1, 2026),
      card('card-ana-mc', 'person-ana', 'Ana Ortega', 'Mastercard', '7719', 10, 2027)],
    transponders: [['tp-0001', 'CW-2502-30114', 1], ['tp-0002', 'CW-2502-30115', 2]],
    replenish: {card_id: 'card-marisol-disc', amount_cents: 3000, threshold_cents: 1000}});
}

const step = (days, hh, mm, item) => ({days, hh, mm, item});

function marisolScripted() {
  const call = (time, name, args) => ({time, kind: 'call', name, args});
  const plate = (time, plaza, plateNo, plan, cls = 1) => ({time, kind: 'toll', read: 'plate', plaza, plate: plateNo, cls, plan});
  const visa = 'card-marisol-visa';
  return [
    call(at(M_OPENED, 10, 0), 'vehicles.add', {plate: 'MSL2034', class: 1, label: '2019 Toyota Sienna', possession_start: M_OPENED}),
    call(at(M_OPENED, 10, 1), 'vehicles.add', {plate: 'ORT5521', class: 2, label: '2021 Ram ProMaster (Ortega Catering)', possession_start: M_OPENED}),
    call(at(M_OPENED, 10, 2), 'vehicles.add', {plate: 'BRT6618', class: 1, label: '2016 Chevrolet Malibu (Leo)', possession_start: M_OPENED}),
    call(at(M_OPENED, 10, 3), 'transponders.assign', {transponder_id: 'tp-0001', vehicle_id: 'v-0001'}),
    call(at(M_OPENED, 10, 4), 'transponders.assign', {transponder_id: 'tp-0002', vehicle_id: 'v-0002'}),
    {time: at(M_OPENED, 10, 5), kind: 'topup', amount: 4000, card: 'card-marisol-disc'},
    call(at(M_OPENED, 10, 6), 'account.replenish.set', {enabled: true, card_id: 'card-marisol-disc', amount_cents: 3000, threshold_cents: 1000}),
    // The tag was on the dashboard but not read; the dispute was granted.
    plate(at('2025-06-14', 13, 37), 'pz-lantern', 'MSL2034', [
      step(6, 20, 15, {kind: 'dispute', args: {reason: 'transponder_malfunction', transponder_id: 'tp-0001'}}),
      step(21, 10, 0, {kind: 'decide', grant_if: [{reason: 'transponder_malfunction', evidence: []}]})]),
    // Ana borrowed the Sienna for a beach weekend and topped up with her own card.
    {time: at('2025-08-15', 21, 10), kind: 'topup', amount: 5000, card: 'card-ana-mc'},
    plate(at('2025-09-20', 6, 48), 'pz-ferry', 'ORT5521', [
      step(4, 22, 0, {kind: 'dispute', args: {reason: 'not_my_plate', explanation: 'The van was parked at the commissary all morning.'}}),
      step(25, 10, 0, {kind: 'decide', grant_if: []}),
      step(30, 19, 45, {kind: 'pay', card: visa})], 2),
    plate(at('2025-11-15', 23, 4), 'pz-fallow', 'BRT6618', [step(9, 20, 30, {kind: 'pay', card: visa})]),
    plate(at('2025-12-06', 1, 52), 'pz-ashford', 'BRT6618', []),
    // Leo sold the Malibu on 2026-01-20 (bill of sale in Mail m-21107); nobody ended it here.
    plate(at('2026-01-31', 16, 20), 'pz-cedar', 'BRT6618', []),
    plate(at('2026-02-07', 11, 3), 'pz-quarry', 'BRT6618', [
      step(8, 21, 30, {kind: 'dispute', args: {reason: 'sold_or_not_in_possession', transfer_date: M_SALE, evidence: [M_MAIL('m-21107')]}})]),
    call(at('2026-02-20', 17, 30), 'vehicles.add', {plate: 'LNR4410', class: 1, label: 'Loaner: 2025 Hyundai Elantra (Harborline)', temporary: true,
      possession_start: '2026-02-20', possession_end: '2026-03-13', rental_agency_id: 'ag-harborline'}),
    plate(at('2026-02-21', 14, 12), 'pz-millrace', 'BRT6618', []),
    plate(at('2026-02-24', 7, 26), 'pz-harbor', 'LNR4410', []),
    // A catering run while suspended: the tag was read, but the toll became a notice.
    {time: at('2026-02-28', 9, 14), kind: 'toll', read: 'transponder', transponder: 'tp-0002', plaza: 'pz-stonebridge', plate: 'ORT5521', cls: 2},
    plate(at('2026-03-03', 7, 31), 'pz-harbor', 'LNR4410', []),
  ];
}

function marisolRandom(rand) {
  const out = [], pick = list => list[Math.floor(rand() * list.length)];
  const all = PLAZAS.map(p => p.id);
  for (let d = C.addDays(M_OPENED, 1); d <= '2026-03-08'; d = C.addDays(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    const shop = d >= M_SHOP[0] && d <= M_SHOP[1];
    if (dow >= 1 && dow <= 5 && !shop && rand() < 0.3) {
      out.push({time: at(d, 7, 10 + Math.floor(rand() * 40)), kind: 'toll', read: 'transponder', transponder: 'tp-0001',
        plaza: rand() < 0.6 ? 'pz-harbor' : 'pz-millrace', plate: 'MSL2034', cls: 1});
    }
    if (dow === 6 && rand() < 0.4) {
      out.push({time: at(d, 8 + Math.floor(rand() * 9), Math.floor(rand() * 60)), kind: 'toll', read: 'transponder',
        transponder: 'tp-0002', plaza: pick(all), plate: 'ORT5521', cls: 2});
    }
  }
  return out;
}

// ---- Theo Lindqvist ------------------------------------------------------------
// A landscaping business with a pickup and a box truck. Theo traded his Mazda in
// on 2026-04-30 with its transponder still inside, so the dealer's next buyer
// runs up debits on his balance; the plate is still listed. His own Visa
// expired in 03/2026 and his business partner Sam's card now funds
// auto-replenish. A rental plate he used in 2025 is on the account again.

const T_OPENED = '2025-05-12';
const T_TRADE_IN = '2026-04-30';
const T_MAIL = object_id => ({app_id: 'mail', account_id: 'mail-theo', object_id});

function theoSkeleton() {
  return account({account_id: 'cw-theo', owner: 'person-theo', name: 'Theo Lindqvist', opened: T_OPENED,
    cards: [card('card-theo-amex', 'person-theo', 'Theo Lindqvist', 'Amex', '3006', 7, 2029),
      card('card-theo-visa', 'person-theo', 'Theo Lindqvist', 'Visa', '8824', 3, 2026),
      card('card-sam-visa', 'person-sam', 'Sam Okoro', 'Visa', '5170', 12, 2027)],
    transponders: [['tp-0001', 'CW-2505-71200', 1], ['tp-0002', 'CW-2505-71201', 2], ['tp-0003', 'CW-2505-71202', 1]],
    replenish: {card_id: 'card-theo-visa', amount_cents: 5000, threshold_cents: 2000}});
}

function theoScripted() {
  const call = (time, name, args) => ({time, kind: 'call', name, args});
  const plate = (time, plaza, plateNo, plan, cls = 1) => ({time, kind: 'toll', read: 'plate', plaza, plate: plateNo, cls, plan});
  const rental = (start, end) => ({plate: 'HRB2261', class: 1, label: 'Rental: 2025 Toyota Camry (Harborline)', temporary: true,
    possession_start: start, possession_end: end, rental_agency_id: 'ag-harborline'});
  return [
    call(at(T_OPENED, 10, 0), 'vehicles.add', {plate: 'LDQ7702', class: 1, label: '2020 Ford F-250', possession_start: T_OPENED}),
    call(at(T_OPENED, 10, 1), 'vehicles.add', {plate: 'GRN3390', class: 2, label: '2015 Isuzu NPR box truck (Lindqvist Landscapes)', possession_start: T_OPENED}),
    call(at(T_OPENED, 10, 2), 'vehicles.add', {plate: 'TLQ1185', class: 1, label: '2012 Mazda3', possession_start: T_OPENED}),
    call(at(T_OPENED, 10, 3), 'transponders.assign', {transponder_id: 'tp-0001', vehicle_id: 'v-0001'}),
    call(at(T_OPENED, 10, 4), 'transponders.assign', {transponder_id: 'tp-0002', vehicle_id: 'v-0002'}),
    call(at(T_OPENED, 10, 5), 'transponders.assign', {transponder_id: 'tp-0003', vehicle_id: 'v-0003'}),
    {time: at(T_OPENED, 10, 6), kind: 'topup', amount: 6000, card: 'card-theo-visa'},
    call(at(T_OPENED, 10, 7), 'account.replenish.set', {enabled: true, card_id: 'card-theo-visa', amount_cents: 5000, threshold_cents: 2000}),
    plate(at('2025-07-19', 15, 51), 'pz-stonebridge', 'GRN3390', [step(10, 19, 0, {kind: 'pay', card: 'card-theo-amex'})], 2),
    call(at('2025-08-04', 9, 30), 'vehicles.add', rental('2025-08-04', '2025-08-08')),
    // Harborline billed the rental toll to Theo's card (Mail m-30815); the dispute was granted.
    plate(at('2025-08-06', 12, 18), 'pz-kettle', 'HRB2261', [
      step(9, 21, 0, {kind: 'dispute', args: {reason: 'paid_by_rental_agency', agency_id: 'ag-harborline', evidence: [T_MAIL('m-30815')]}}),
      step(25, 10, 0, {kind: 'decide', grant_if: [{reason: 'paid_by_rental_agency', evidence: [T_MAIL('m-30815')]}]})]),
    plate(at('2025-10-11', 10, 2), 'pz-ridge', 'LDQ7702', []),
    plate(at('2026-02-14', 9, 40), 'pz-northgate', 'GRN3390', [
      step(5, 20, 0, {kind: 'dispute', args: {reason: 'not_my_plate', explanation: 'Our truck was in the shop that Saturday.'}}),
      step(20, 10, 0, {kind: 'decide', grant_if: []}),
      step(26, 18, 30, {kind: 'pay', card: 'card-sam-visa'})], 2),
    call(at('2026-04-08', 18, 0), 'account.replenish.set', {enabled: true, card_id: 'card-sam-visa'}),
    plate(at('2026-04-18', 8, 22), 'pz-cedar', 'LDQ7702', [
      step(3, 21, 0, {kind: 'dispute', args: {reason: 'transponder_malfunction', transponder_id: 'tp-0001'}}),
      step(12, 20, 0, {kind: 'withdraw'})]),
    // Traded in at Lakeside Motors on 2026-04-30 (bill of sale in Mail m-31042), tag still inside.
    plate(at('2026-05-09', 16, 44), 'pz-harbor', 'TLQ1185', []),
    plate(at('2026-05-28', 18, 9), 'pz-millrace', 'TLQ1185', []),
    call(at('2026-06-10', 11, 0), 'vehicles.add', rental('2026-06-10', '2026-06-20')),
    plate(at('2026-06-12', 13, 26), 'pz-lantern', 'HRB2261', []),
  ];
}

function theoRandom(rand) {
  const out = [], pick = list => list[Math.floor(rand() * list.length)];
  const all = PLAZAS.map(p => p.id);
  for (let d = C.addDays(T_OPENED, 1); d <= '2026-06-14'; d = C.addDays(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow >= 1 && dow <= 5 && rand() < 0.3) {
      out.push({time: at(d, 6, 30 + Math.floor(rand() * 60)), kind: 'toll', read: 'transponder', transponder: 'tp-0001',
        plaza: pick(all), plate: 'LDQ7702', cls: 1});
    }
    if ((dow === 2 || dow === 4) && rand() < 0.3) {
      out.push({time: at(d, 9 + Math.floor(rand() * 6), Math.floor(rand() * 60)), kind: 'toll', read: 'transponder',
        transponder: 'tp-0002', plaza: pick(all), plate: 'GRN3390', cls: 2});
    }
    // The Mazda: Theo's own Sunday drives, then the dealer's next buyer's commute.
    if (d <= T_TRADE_IN ? dow === 0 && rand() < 0.2 : dow >= 1 && dow <= 5 && rand() < 0.4) {
      out.push({time: at(d, d <= T_TRADE_IN ? 11 : 8, Math.floor(rand() * 60)), kind: 'toll', read: 'transponder',
        transponder: 'tp-0003', plaza: d <= T_TRADE_IN ? pick(all) : 'pz-harbor', plate: 'TLQ1185', cls: 1});
    }
  }
  return out;
}

// ---- Engine ------------------------------------------------------------------

const SEEDS = {
  dani: {file: 'fixtures/minimal.json', binding: 'fixtures/binding.json', clock: 'fixtures/clock.json',
    opened: OPENED, prng: PRNG_SEED, skeleton, scripted, random, payCard: 'card-dani-visa'},
  marisol: {file: 'fixtures/seeds/marisol/seed.json', binding: 'fixtures/seeds/marisol/binding.json', clock: 'fixtures/seeds/marisol/clock.json',
    opened: M_OPENED, prng: 20250203, skeleton: marisolSkeleton, scripted: marisolScripted, random: marisolRandom},
  theo: {file: 'fixtures/seeds/theo/seed.json', binding: 'fixtures/seeds/theo/binding.json', clock: 'fixtures/seeds/theo/clock.json',
    opened: T_OPENED, prng: 20250512, skeleton: theoSkeleton, scripted: theoScripted, random: theoRandom},
};

const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

function generate(id = 'dani') {
  const spec = SEEDS[id];
  if (!spec) throw Error(`Unknown seed ${id}.`);
  const rand = mulberry32(spec.prng);
  let data = spec.skeleton();
  const ctx = {app_id: 'crossway', role: 'infra', virtual_now: at(spec.opened, 9), binding: read(spec.binding)};
  const queue = [...spec.scripted(), ...spec.random(rand)];
  let seq = 0, tollSeq = 0;
  const call = (name, args) => (data = plugin.handleTool(ctx, data, 'crossway.' + name, args).data, data);
  const result = (name, args) => {
    const out = plugin.handleTool(ctx, data, 'crossway.' + name, args);
    data = out.data;
    return out.result;
  };
  const later = (time, item) => queue.push({time, ...item});
  for (;;) {
    queue.sort((a, b) => C.ms(a.time) - C.ms(b.time) || (a.order ?? 0) - (b.order ?? 0));
    const item = queue.shift();
    if (!item) break;
    ctx.virtual_now = item.time;
    if (item.kind === 'call') call(item.name, item.args);
    else if (item.kind === 'topup') {
      const p = result('account.topup.preview', {amount_cents: item.amount, card_id: item.card}).preview;
      call('account.topup.confirm', {preview_id: p.id});
    } else if (item.kind === 'toll') {
      const id = `t-${String(++tollSeq).padStart(4, '0')}`;
      data = plugin.applyEvent(ctx, data, {event_id: `gen-${++seq}`, at: item.time, operation: 'crossway.toll.posted',
        payload: {toll_id: id, plaza_id: item.plaza, read: item.read, plate: item.plate, transponder_id: item.transponder || null, class: item.cls}});
      const toll = data.tolls.find(t => t.id === id), day = C.localDate(C.ms(item.time));
      if (!toll.notice_id || item.read !== 'plate') continue;
      const n = toll.notice_id;
      if (Array.isArray(item.plan)) {
        for (const s of item.plan) later(at(C.addDays(day, s.days), s.hh, s.mm), {...s.item, notice: n});
        continue;
      }
      if (item.plan === 'pay') later(at(C.addDays(day, 10), 19, 30), {kind: 'pay', notice: n});
      if (item.plan === 'dispute_granted') {
        later(at(C.addDays(day, 8), 20, 0), {kind: 'dispute', notice: n, args: {reason: 'transponder_malfunction', transponder_id: 'tp-0002'}});
        later(at(C.addDays(day, 24), 10, 0), {kind: 'decide', notice: n, grant_if: [{reason: 'transponder_malfunction', evidence: []}]});
      }
      if (item.plan === 'dispute_denied_then_pay') {
        later(at(C.addDays(day, 6), 21, 0), {kind: 'dispute', notice: n, args: {reason: 'not_my_plate', explanation: 'I do not recognize this trip.'}});
        later(at(C.addDays(day, 27), 10, 0), {kind: 'decide', notice: n, grant_if: []});
        later(at(C.addDays(day, 33), 19, 0), {kind: 'pay', notice: n});
      }
    } else if (item.kind === 'pay') {
      const p = result('notices.pay.preview', {notice_ids: [item.notice], card_id: item.card || spec.payCard}).preview;
      call('notices.pay.confirm', {preview_id: p.id});
    } else if (item.kind === 'dispute') {
      const p = result('disputes.preview', {notice_id: item.notice, ...item.args}).preview;
      call('disputes.confirm', {preview_id: p.id});
    } else if (item.kind === 'withdraw') {
      call('disputes.withdraw', {dispute_id: data.notices.find(x => x.id === item.notice).dispute_id});
    } else if (item.kind === 'decide') {
      data = plugin.applyEvent(ctx, data, {event_id: `gen-${++seq}`, at: item.time, operation: 'crossway.dispute.decided',
        payload: {notice_id: item.notice, grant_if: item.grant_if}});
    }
  }
  ctx.virtual_now = read(spec.clock).initial_time;
  data = settle(ctx, data);
  data.outgoing = [];
  data.run.previews = [];
  plugin.validateSeed(ctx, data);
  return data;
}

module.exports = {generate, SEEDS, PRNG_SEED};

if (require.main === module) {
  const check = process.argv.includes('--check');
  for (const [id, spec] of Object.entries(SEEDS)) {
    const text = JSON.stringify(generate(id), null, 2) + '\n', target = path.join(root, spec.file);
    if (check) {
      if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) throw Error(`${spec.file} differs from the generator output.`);
      console.log(`${spec.file} matches the generator.`);
    } else {
      fs.writeFileSync(target, text);
      console.log(`Wrote ${spec.file}`);
    }
  }
}
