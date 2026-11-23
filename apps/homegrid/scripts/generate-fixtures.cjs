'use strict';
// Deterministic synthetic fixture generator. Same seed, same bytes. `--check` fails on drift.
// Account history is produced by running Homegrid's own handlers (events and agent writes) in time order,
// so every seeded bill, payment, arrangement and notification is one the App itself would compute.
const fs = require('node:fs'), path = require('node:path');
const plugin = require('../plugin.cjs');
const {TYPES} = require('../src/catalog.cjs');
const {addDays} = require('../src/time.cjs');
const root = path.resolve(__dirname, '..');
const SEED = 20270112;

function prng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const NY = 'America/New_York', CHI = 'America/Chicago';
const AREAS = [
  {area_id: 'ar-maple', name: 'Fairmont: Maple Heights', time_zone: NY},
  {area_id: 'ar-linden', name: 'Fairmont: Linden', time_zone: NY},
  {area_id: 'ar-riverside', name: 'Wexley: Riverside', time_zone: CHI},
  {area_id: 'ar-hollow', name: 'Wexley: Cedar Hollow', time_zone: CHI}
];
// Fictional holiday calendar shared by both towns.
const HOLIDAYS = ['2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-05-31', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24'];
const TOWN = {'ar-maple': 'Fairmont', 'ar-linden': 'Fairmont', 'ar-riverside': 'Wexley', 'ar-hollow': 'Wexley'};
const premise = (premise_id, address, area_id, internet_tech, self_install) => ({premise_id, address: `${address}, ${TOWN[area_id]}`, area_id, internet_tech, self_install, external_ref: null});
// Premises the examples name.
const NAMED = [
  premise('pr-maple-22', '22 Maple St', 'ar-maple', 'fiber', false),
  premise('pr-linden-14', '14 Linden Ct', 'ar-linden', 'fiber', false),
  premise('pr-birch-3', '3 Birch St', 'ar-maple', 'cable', true),
  premise('pr-quarry-8', '8 Quarry Rd', 'ar-linden', 'none', false),
  premise('pr-elm-41', '41 Elm Ave', 'ar-riverside', 'cable', false),
  premise('pr-heron-7', '7 Heron Way', 'ar-hollow', 'cable', true),
  premise('pr-river-12', '12 River Rd', 'ar-riverside', 'cable', false),
  premise('pr-hollow-30', '30 Hollow Ln', 'ar-hollow', 'cable', false)
];
const STREETS = {'ar-maple': ['Chestnut St', 'Orchard Pl', 'Walnut St'], 'ar-linden': ['Aspen Ct', 'Juniper Dr', 'Sumac Ln'],
  'ar-riverside': ['Ferry St', 'Willow Bend', 'Mill Rd'], 'ar-hollow': ['Ridge Rd', 'Fox Run', 'Larch St']};
const TECH = {'ar-maple': ['fiber', 'fiber', 'cable'], 'ar-linden': ['fiber', 'fiber', 'none'], 'ar-riverside': ['cable', 'cable', 'fiber'], 'ar-hollow': ['cable', 'none', 'cable']};

function world(rand, perArea) {
  const out = [...NAMED];
  for (const area of AREAS) {
    const used = new Set();
    while (used.size < perArea) {
      const street = STREETS[area.area_id][Math.floor(rand() * 3)], num = 2 + Math.floor(rand() * 98);
      const slug = street.split(' ')[0].toLowerCase(), id = `pr-${slug}-${num}`;
      if (used.has(id) || out.some(p => p.premise_id === id)) continue;
      used.add(id);
      out.push(premise(id, `${num} ${street}`, area.area_id, TECH[area.area_id][Math.floor(rand() * 3)], rand() < 0.3));
    }
  }
  return out.sort((a, b) => a.premise_id.localeCompare(b.premise_id));
}

function account({account_id, person, name, tz, premises, methods}) {
  return {account_id, owner_person_id: person,
    customer: {name, late_payments: [], payment_methods: methods},
    // History is generated with in-app delivery so the seed has nothing waiting for Mail.
    preferences: {time_zone: tz, quiet_hours: null, types: Object.fromEntries(TYPES.map(t => [t, {enabled: true, delivery: 'in_app'}])),
      health: {bypass_quiet_hours: true, delivery: 'in_app'}},
    areas: AREAS, holidays: HOLIDAYS, premises, capacity: [], stock: [], services: [], orders: [], appointments: [], equipment: [],
    outages: [], advisories: [], reports: [], charges: [], bills: [], payments: [], autopay: {payment_method_id: null}, arrangements: [],
    notifications: [], ignored_events: []};
}
const binding = (person, name, account_id, objects) => ({people: [{person_id: person, name}],
  accounts: [{app_id: 'homegrid', account_id, owner_person_id: person}], objects: {homegrid: objects}});
const service = (premise_id, type, plan_id, start, activated_at) => ({service_id: `sv-${premise_id}-${type}`, premise_id, service_type: type, plan_id,
  status: 'active', start_date: start, stop_date: null, activated_at, last_test: null});
const mail = data => {
  for (const t of TYPES) data.preferences.types[t].delivery = 'mail';
  data.preferences.health.delivery = 'mail';
  return data;
};

// Run handlers in time order, as Core would.
function simulate(data, bind) {
  let n = 0, now = null;
  const ctx = at => {
    if (now && Date.parse(at) < Date.parse(now)) throw new Error('History out of order at ' + at);
    now = at;
    return {app_id: 'homegrid', role: 'infra', virtual_now: at, binding: bind};
  };
  return {
    event(at, operation, payload) { data = plugin.applyEvent(ctx(at), data, {event_id: 'hist-' + (++n), at, operation, payload}); plugin.validateSeed(ctx(at), data); },
    tool(at, name, args = {}) {
      const out = plugin.handleTool(ctx(at), data, name, {expected_version: {epoch: 1, revision: n}, request_id: 'hist-' + (++n), ...args});
      data = out.data; plugin.validateSeed(ctx(at), data); return out.result;
    },
    get data() { return data; }
  };
}
const usage = (rand, premiseId, month) => {
  const winter = [1, 2, 12].includes(month) ? 1.35 : [6, 7, 8].includes(month) ? 1.2 : 1;
  return {[`sv-${premiseId}-electricity`]: {kwh: Math.round((380 + rand() * 180) * winter)}, [`sv-${premiseId}-water`]: {gal: Math.round(2400 + rand() * 1500)}};
};
const monthEnd = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
const pad = n => String(n).padStart(2, '0');

// Minimal fixture: Sam before the move in the core examples (Tue Jan 12, 2027, 10:00 EST).
function minimal() {
  const rand = prng(SEED);
  const premises = world(rand, 1).filter(p => p.area_id.startsWith('ar-maple') || p.area_id === 'ar-linden' || NAMED.includes(p));
  const bind = binding('person-sam', 'Sam Okafor', 'homegrid-sam', ['pr-maple-22', 'pr-linden-14']);
  const data = account({account_id: 'homegrid-sam', person: 'person-sam', name: 'Sam Okafor', tz: NY, premises,
    methods: [{payment_method_id: 'pm-visa', label: 'Visa', last4: '4242', fails: false}, {payment_method_id: 'pm-checking', label: 'Checking', last4: '6789', fails: false}]});
  data.services = ['electricity', 'water', 'internet'].map(t => service('pr-maple-22', t, {electricity: 'elec-standard', water: 'water-standard', internet: 'net-fiber-300'}[t],
    '2026-06-01', '2026-06-01T00:00:00-04:00'));
  data.equipment = [{equipment_id: 'eq-gw-maple', kind: 'gateway', premise_id: 'pr-maple-22', order_id: null, status: 'in_use', return_due: null, return_method: null, returned_at: null}];
  // Linden installation windows on Fri Jan 15 and Sat Jan 16 are full.
  data.capacity = [...['08-12', '12-16', '16-20'].map(slot => ({area_id: 'ar-linden', date: '2027-01-15', slot, capacity: 0})),
    {area_id: 'ar-linden', date: '2027-01-16', slot: '08-12', capacity: 0}];
  data.stock = [{area_id: 'ar-maple', hotspots: 1}, {area_id: 'ar-linden', hotspots: 1}];
  const s = simulate(data, bind);
  s.event('2026-12-31T23:59:00-05:00', 'billing.cycle_closed', {bill_id: 'bl-1231', period: {from: '2026-12-01', to: '2026-12-31'},
    usage: {'sv-pr-maple-22-electricity': {kwh: 520}, 'sv-pr-maple-22-water': {gal: 3100}}});
  const total = s.data.bills[0].total_cents;
  s.tool('2027-01-06T19:00:00-05:00', 'homegrid.payments.make', {amount_cents: total, payment_method_id: 'pm-visa'});
  s.event('2027-01-08T09:00:00-05:00', 'payment.settled', {selector: {oldest_pending: true}, outcome: 'settled'});
  const out = mail(s.data);
  out.preferences.quiet_hours = {start: '22:00', end: '07:00'};
  return {seed: out, binding: bind, clock: {initial_time: '2027-01-12T10:00:00-05:00'}};
}

// (a) Remote worker mid-move in Wexley (#9-shaped): transfer ordered, self-install kit on its way, old gateway to return.
function moveRemoteWorker(rand, premises) {
  const bind = binding('person-priya', 'Priya Nair', 'homegrid-priya', ['pr-elm-41', 'pr-heron-7']);
  const data = account({account_id: 'homegrid-priya', person: 'person-priya', name: 'Priya Nair', tz: CHI, premises,
    methods: [{payment_method_id: 'pm-amex', label: 'Amex', last4: '1009', fails: false}]});
  data.services = [service('pr-elm-41', 'electricity', 'elec-standard', '2026-01-04', '2026-01-04T00:00:00-06:00'),
    service('pr-elm-41', 'water', 'water-standard', '2026-01-04', '2026-01-04T00:00:00-06:00'),
    service('pr-elm-41', 'internet', 'net-cable-200', '2026-01-08', '2026-01-08T13:20:00-06:00')];
  data.equipment = [{equipment_id: 'eq-gw-elm', kind: 'gateway', premise_id: 'pr-elm-41', order_id: null, status: 'in_use', return_due: null, return_method: null, returned_at: null}];
  data.stock = AREAS.map(a => ({area_id: a.area_id, hotspots: 2}));
  data.autopay.payment_method_id = 'pm-amex';
  const s = simulate(data, bind);
  for (const m of [10, 11, 12, 13]) {
    const y = m > 12 ? 2027 : 2026, mm = m > 12 ? m - 12 : m, to = monthEnd(y, mm);
    s.event(`${to}T23:59:00-06:00`, 'billing.cycle_closed', {bill_id: `bl-elm-${y % 100}${pad(mm)}`, period: {from: `${y}-${pad(mm)}-01`, to}, usage: usage(rand, 'pr-elm-41', mm)});
    const due = s.data.bills.at(-1).due_date;
    s.event(`${addDays(due, 1)}T09:00:00-06:00`, 'payment.settled', {selector: {oldest_pending: true}, outcome: 'settled'});
  }
  const preview = s.tool('2027-02-26T11:00:00-06:00', 'homegrid.orders.preview', {type: 'transfer', from_premise_id: 'pr-elm-41', to_premise_id: 'pr-heron-7',
    stop_date: '2027-03-05', start_date: '2027-03-05'});
  s.tool('2027-02-26T11:04:00-06:00', 'homegrid.orders.create', {order_token: preview.order_token});
  s.event('2027-02-28T23:59:00-06:00', 'billing.cycle_closed', {bill_id: 'bl-elm-2702', period: {from: '2027-02-01', to: '2027-02-28'}, usage: usage(rand, 'pr-elm-41', 2)});
  const out = mail(s.data);
  out.preferences.quiet_hours = {start: '23:00', end: '07:00'};
  const kit = out.equipment.find(e => e.premise_id === 'pr-heron-7').equipment_id;
  const events = [
    ['2027-03-01T12:00:00-06:00', 'logistics.shipment_update', {shipment_id: 'sh-heron-kit', equipment_id: kit, status: 'shipped'}],
    ['2027-03-02T15:10:00-06:00', 'logistics.shipment_update', {shipment_id: 'sh-heron-kit', equipment_id: kit, status: 'delivered'}],
    ['2027-03-03T10:00:00-06:00', 'field.activation_result', {service_id: 'sv-pr-heron-7-internet', result: 'activated', speed_mbps: 200}],
    ['2027-03-08T08:00:00-06:00', 'grid.outage_updated', {outage_id: 'out-hollow-3', service: 'internet', status: 'started', premise_ids: ['pr-heron-7'], etr: '2027-03-08T16:00:00-06:00', cause: 'damaged node'}],
    ['2027-03-08T15:30:00-06:00', 'grid.outage_updated', {outage_id: 'out-hollow-3', status: 'etr_updated', etr: '2027-03-09T12:00:00-06:00'}],
    ['2027-03-09T11:00:00-06:00', 'grid.outage_updated', {outage_id: 'out-hollow-3', status: 'restored'}],
    ['2027-03-20T14:00:00-05:00', 'logistics.shipment_update', {shipment_id: 'sh-elm-return', equipment_id: 'eq-gw-elm', status: 'returned_received'}],
    ['2027-03-31T23:59:00-05:00', 'billing.cycle_closed', {bill_id: 'bl-heron-2703', period: {from: '2027-03-01', to: '2027-03-31'},
      usage: {'sv-pr-heron-7-electricity': {kwh: 455}, 'sv-pr-heron-7-water': {gal: 2810}}}]
  ];
  return {name: 'move-remote-worker', seed: out, binding: bind, clock: '2027-03-01T09:00:00-06:00', events};
}

// (b) Family with an infant in Riverside (#115-shaped): a boil-water advisory issued at night, widened, then lifted.
function boilWaterInfant(rand, premises) {
  const bind = binding('person-ama', 'Ama Osei', 'homegrid-ama', ['pr-river-12']);
  const data = account({account_id: 'homegrid-ama', person: 'person-ama', name: 'Ama Osei', tz: CHI, premises,
    methods: [{payment_method_id: 'pm-debit', label: 'Debit card', last4: '5310', fails: false}]});
  data.services = [service('pr-river-12', 'electricity', 'elec-standard', '2026-08-03', '2026-08-03T00:00:00-05:00'),
    service('pr-river-12', 'water', 'water-standard', '2026-08-03', '2026-08-03T00:00:00-05:00'),
    service('pr-river-12', 'internet', 'net-cable-200', '2026-08-05', '2026-08-05T11:40:00-05:00')];
  data.equipment = [{equipment_id: 'eq-gw-river', kind: 'gateway', premise_id: 'pr-river-12', order_id: null, status: 'in_use', return_due: null, return_method: null, returned_at: null}];
  data.stock = AREAS.map(a => ({area_id: a.area_id, hotspots: 2}));
  const s = simulate(data, bind);
  // An earlier advisory, already lifted, so the account has a complete chain on record.
  s.event('2026-10-14T06:30:00-05:00', 'water.advisory_published', {advisory_id: 'adv-rv1', version: 1, msg_type: 'issue', kind: 'boil_water', areas: ['ar-riverside'],
    effective_from: '2026-10-14T06:30:00-05:00', instructions: 'Boil tap water for 1 minute before drinking, cooking, making formula or brushing teeth.'});
  s.event('2026-10-15T17:00:00-05:00', 'water.advisory_published', {advisory_id: 'adv-rv1', version: 2, msg_type: 'lift', kind: 'boil_water',
    effective_from: '2026-10-14T06:30:00-05:00', instructions: 'Tap water is safe to drink. Run cold taps for 2 minutes first.', references: [{advisory_id: 'adv-rv1', version: 1}]});
  for (const [y, mm] of [[2026, 12], [2027, 1], [2027, 2], [2027, 3]]) {
    const to = monthEnd(y, mm);
    s.event(`${to}T23:59:00-0${mm >= 3 && mm <= 10 ? 5 : 6}:00`, 'billing.cycle_closed', {bill_id: `bl-river-${y % 100}${pad(mm)}`, period: {from: `${y}-${pad(mm)}-01`, to}, usage: usage(rand, 'pr-river-12', mm)});
    if (mm === 3) break;
    const bill = s.data.bills.at(-1);
    s.tool(`${addDays(bill.due_date, -4)}T20:00:00-0${mm >= 2 ? 5 : 6}:00`, 'homegrid.payments.make', {amount_cents: bill.total_cents, payment_method_id: 'pm-debit'});
    s.event(`${addDays(bill.due_date, -2)}T09:00:00-0${mm >= 2 ? 5 : 6}:00`, 'payment.settled', {selector: {oldest_pending: true}, outcome: 'settled'});
  }
  const out = mail(s.data);
  // Quiet hours at night; the health bypass was switched off on this account.
  out.preferences.quiet_hours = {start: '21:00', end: '07:00'};
  out.preferences.health.bypass_quiet_hours = false;
  const events = [
    ['2027-04-07T02:10:00-05:00', 'water.advisory_published', {advisory_id: 'adv-rv3', version: 1, msg_type: 'issue', kind: 'boil_water', areas: ['ar-riverside'],
      effective_from: '2027-04-07T02:10:00-05:00', instructions: 'Boil tap water for 1 minute before drinking, cooking, making formula or brushing teeth. Use bottled water for infant formula if you can.'}],
    ['2027-04-07T14:00:00-05:00', 'water.advisory_published', {advisory_id: 'adv-rv3', version: 2, msg_type: 'update', kind: 'boil_water', areas: ['ar-riverside', 'ar-hollow'],
      effective_from: '2027-04-07T02:10:00-05:00', instructions: 'The advisory now also covers Cedar Hollow. Boil tap water for 1 minute before drinking, cooking, making formula or brushing teeth.',
      references: [{advisory_id: 'adv-rv3', version: 1}]}],
    ['2027-04-08T09:00:00-05:00', 'water.advisory_published', {advisory_id: 'adv-ps1', version: 1, msg_type: 'issue', kind: 'planned_shutoff', areas: [], premise_ids: ['pr-river-12'],
      effective_from: '2027-04-12T09:00:00-05:00', planned_end: '2027-04-12T13:00:00-05:00', instructions: 'Water will be off for main replacement on River Rd.'}],
    ['2027-04-09T10:00:00-05:00', 'water.advisory_published', {advisory_id: 'adv-rv3', version: 3, msg_type: 'lift', kind: 'boil_water',
      effective_from: '2027-04-07T02:10:00-05:00', instructions: 'Tap water is safe to drink. Run cold taps for 2 minutes and discard ice made during the advisory.',
      references: [{advisory_id: 'adv-rv3', version: 2}]}]
  ];
  return {name: 'boil-water-infant', seed: out, binding: bind, clock: '2027-04-06T18:00:00-05:00', events};
}

// (c) Household behind on bills: 14 months of bills, two returned payments, one past arrangement, the latest bill past due.
function tightMonth(rand, premises) {
  const bind = binding('person-dana', 'Dana Whitfield', 'homegrid-dana', ['pr-hollow-30']);
  const data = account({account_id: 'homegrid-dana', person: 'person-dana', name: 'Dana Whitfield', tz: CHI, premises,
    methods: [{payment_method_id: 'pm-checking', label: 'Checking', last4: '2231', fails: false}, {payment_method_id: 'pm-mc', label: 'Mastercard', last4: '8812', fails: false}]});
  data.services = [service('pr-hollow-30', 'electricity', 'elec-standard', '2026-01-02', '2026-01-02T00:00:00-06:00'),
    service('pr-hollow-30', 'water', 'water-standard', '2026-01-02', '2026-01-02T00:00:00-06:00'),
    service('pr-hollow-30', 'internet', 'net-cable-200', '2026-01-02', '2026-01-02T15:00:00-06:00')];
  data.equipment = [{equipment_id: 'eq-gw-hollow', kind: 'gateway', premise_id: 'pr-hollow-30', order_id: null, status: 'in_use', return_due: null, return_method: null, returned_at: null}];
  data.stock = AREAS.map(a => ({area_id: a.area_id, hotspots: 2}));
  data.customer.late_payments = ['2026-01-20T10:00:00-06:00'];
  const s = simulate(data, bind);
  const off = date => (date >= '2026-03-08' && date < '2026-11-01') || (date >= '2027-03-14') ? '-05:00' : '-06:00';
  const at = (date, hhmm) => `${date}T${hhmm}:00${off(date)}`;
  // Actions run in time order; an action may schedule later ones from the state it sees.
  const queue = [];
  let seq = 0;
  const schedule = (time, fn) => { queue.push({time, fn, seq: seq++}); queue.sort((a, b) => Date.parse(a.time) - Date.parse(b.time) || a.seq - b.seq); };
  const pay = (date, amount, outcome = 'settled', method = 'pm-checking') => schedule(at(date, '19:30'), () => {
    const {payment_id} = s.tool(at(date, '19:30'), 'homegrid.payments.make', {amount_cents: amount(), payment_method_id: method});
    schedule(at(addDays(date, 2), '09:00'), () => s.event(at(addDays(date, 2), '09:00'), 'payment.settled', {payment_id, outcome}));
  });
  for (let i = 0; i < 14; i++) {
    const y = 2026 + Math.floor(i / 12), mm = (i % 12) + 1, to = monthEnd(y, mm), id = `bl-dana-${y % 100}${pad(mm)}`, use = usage(rand, 'pr-hollow-30', mm);
    schedule(at(to, '23:59'), () => {
      s.event(at(to, '23:59'), 'billing.cycle_closed', {bill_id: id, period: {from: `${y}-${pad(mm)}-${i === 0 ? '02' : '01'}`, to}, usage: use});
      const bill = s.data.bills.at(-1), total = () => bill.total_cents;
      if (id === 'bl-dana-2601') {
        // Past due, then a 3-installment plan paid on time.
        const when = addDays(bill.due_date, 5);
        schedule(at(when, '12:00'), () => {
          const plan = s.tool(at(when, '12:00'), 'homegrid.arrangements.request', {bill_id: id, installments: 3});
          for (const inst of plan.installments) pay(addDays(inst.due_date, -1), () => inst.amount_cents);
        });
      } else if (id === 'bl-dana-2605' || id === 'bl-dana-2612') {
        // Returned by the bank, then paid late with another card (including the returned-payment fee).
        pay(addDays(bill.due_date, -4), total, 'returned');
        pay(addDays(bill.due_date, 3), () => bill.total_cents + 1500, 'settled', 'pm-mc');
      } else if (id !== 'bl-dana-2701' && id !== 'bl-dana-2702') pay(addDays(bill.due_date, -3), total);
    });
  }
  while (queue.length) { const next = queue.shift(); next.fn(); }
  const out = mail(s.data);
  out.preferences.quiet_hours = {start: '22:00', end: '06:30'};
  const events = [
    ['2027-03-12T09:00:00-06:00', 'payment.settled', {selector: {oldest_pending: true}, outcome: 'settled'}],
    ['2027-03-31T23:59:00-05:00', 'billing.cycle_closed', {bill_id: 'bl-dana-2703', period: {from: '2027-03-01', to: '2027-03-31'}, usage: usage(rand, 'pr-hollow-30', 3)}]
  ];
  return {name: 'tight-month', seed: out, binding: bind, clock: '2027-03-10T09:00:00-06:00', events};
}

const policies = () => {
  const names = require('../tools.json').map(t => t.name);
  return {scenario: {allow: names, constraints: {}}, sandbox: {allow: names, constraints: {}}};
};
const json = value => JSON.stringify(value, null, 2) + '\n';

function outputs() {
  const m = minimal(), rand = prng(SEED + 1), premises = world(rand, 13);
  const files = {'fixtures/minimal.json': m.seed, 'fixtures/binding.json': m.binding, 'fixtures/clock.json': m.clock, 'fixtures/policies.json': policies()};
  for (const pack of [moveRemoteWorker(rand, premises), boilWaterInfant(rand, premises), tightMonth(rand, premises)]) {
    files[`examples/packs/${pack.name}/seed.json`] = pack.seed;
    files[`examples/packs/${pack.name}/binding.json`] = pack.binding;
    files[`examples/packs/${pack.name}/clock.json`] = {initial_time: pack.clock};
    files[`examples/packs/${pack.name}/events.json`] = pack.events.map(([at, operation, payload], i) => ({event_id: `${pack.name}-${i + 1}`, at, operation, payload}));
  }
  return files;
}

function build({check = false} = {}) {
  const files = outputs();
  for (const [file, value] of Object.entries(files)) {
    const target = path.join(root, file), text = json(value);
    if (check) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) throw new Error('Generated fixture drift: ' + file); }
    else { fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, text); }
  }
  return {files: Object.keys(files).length};
}
module.exports = {build, outputs};
if (require.main === module) console.log(JSON.stringify(build({check: process.argv.includes('--check')})));
