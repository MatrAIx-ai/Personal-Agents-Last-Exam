#!/usr/bin/env node
'use strict';
// Deterministic generator for fixtures/minimal.json. It opens Dani Reyes's
// account on 2025-01-06 and replays about 22 months of history through
// Crossway's own event and tool handlers, so every balance, statement, notice
// and dispute in the seed was produced by the same rules the App enforces.
// Random tolls come from a fixed-seed PRNG. The run ends at the fixture clock;
// outgoing Mail notices from history count as delivered and are cleared, as are
// the history's spent previews (run state).
//   node scripts/generate-seed.cjs           writes fixtures/minimal.json
//   node scripts/generate-seed.cjs --check   compares only
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const C = require('../src/clock.cjs');
const {settle} = require('../src/settle.cjs');

const root = path.resolve(__dirname, '..');
const CLOCK = require('../fixtures/clock.json').initial_time;
const binding = require('../fixtures/binding.json');
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

function skeleton() {
  const card = (id, holder_person_id, holder_name, brand, last4, exp_month, exp_year) =>
    ({id, holder_person_id, holder_name, brand, last4, exp_month, exp_year, status: 'active', history: []});
  const tp = (id, serial, cls) => ({id, serial, class: cls, vehicle_id: null, issued_on: OPENED, history: []});
  return {
    account_id: 'cw-dani', owner_person_id: 'person-dani', holder: {display_name: 'Dani Reyes'}, opened_on: OPENED,
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
    cards: [card('card-dani-visa', 'person-dani', 'Dani Reyes', 'Visa', '4417', 8, 2029),
      card('card-dani-mc', 'person-dani', 'Dani Reyes', 'Mastercard', '2290', 9, 2026),
      card('card-jordan-amex', 'person-jordan', 'Jordan Albright', 'Amex', '1007', 11, 2027)],
    replenish: {enabled: false, card_id: 'card-dani-mc', amount_cents: 4000, threshold_cents: 1500, consecutive_failures: 0, updated_at: at(OPENED, 10)},
    balance_cents: 0, suspended_at: null,
    vehicles: [], transponders: [tp('tp-0001', 'CW-2501-88412', 2), tp('tp-0002', 'CW-2501-88413', 1)],
    tolls: [], ledger: [], statements: [], notices: [], disputes: [], dispute_decisions: [], receipts: [], outgoing: [], run: {previews: []},
  };
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

function generate() {
  const rand = mulberry32(PRNG_SEED);
  let data = skeleton();
  const ctx = {app_id: 'crossway', role: 'infra', virtual_now: at(OPENED, 9), binding: structuredClone(binding)};
  const queue = [...scripted(), ...random(rand)];
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
      const p = result('notices.pay.preview', {notice_ids: [item.notice], card_id: 'card-dani-visa'}).preview;
      call('notices.pay.confirm', {preview_id: p.id});
    } else if (item.kind === 'dispute') {
      const p = result('disputes.preview', {notice_id: item.notice, ...item.args}).preview;
      call('disputes.confirm', {preview_id: p.id});
    } else if (item.kind === 'decide') {
      data = plugin.applyEvent(ctx, data, {event_id: `gen-${++seq}`, at: item.time, operation: 'crossway.dispute.decided',
        payload: {notice_id: item.notice, grant_if: item.grant_if}});
    }
  }
  ctx.virtual_now = CLOCK;
  data = settle(ctx, data);
  data.outgoing = [];
  data.run.previews = [];
  plugin.validateSeed(ctx, data);
  return data;
}

module.exports = {generate, PRNG_SEED};

if (require.main === module) {
  const text = JSON.stringify(generate(), null, 2) + '\n', target = path.join(root, 'fixtures/minimal.json');
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(target, 'utf8') !== text) throw Error('fixtures/minimal.json differs from the generator output.');
    console.log('fixtures/minimal.json matches the generator.');
  } else {
    fs.writeFileSync(target, text);
    console.log('Wrote fixtures/minimal.json');
  }
}
