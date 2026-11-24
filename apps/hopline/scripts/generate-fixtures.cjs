'use strict';
// Deterministic synthetic fixture generator. Same seed, same bytes. `--check` fails on drift.
// Rider history is produced by running Hopline's own handlers (taps, loads, settlements, writes) in time
// order, so every seeded charge, balance and notification is one the App itself computes.
const fs = require('node:fs'), path = require('node:path');
const plugin = require('../plugin.cjs');
const {TZ, network} = require('./ashford.cjs');
const {instantOf, addDays, render} = require('../src/time.cjs');
const root = path.resolve(__dirname, '..');
const SEED = 20261207;

function prng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const local = (date, hhmm) => render(instantOf(date, hhmm, TZ), TZ);
const weekday = date => (new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7 + 1;

function account({account_id, person, name, methods}) {
  return {account_id, owner_person_id: person, settings: {time_zone: TZ}, rider: {name, payment_methods: methods}, ...network(),
    alerts: [], trip_updates: [], cards: [], ledger: [], taps: [], passes: [], applications: [], saved: [], subscriptions: [], notifications: [],
    ignored_events: [], redirects: []};
}
const card = (card_id, holder_name, label, created_at, reduced = null) => ({card_id, holder_name, label, status: 'active', balance_cents: 0, carried_in_cents: 0,
  carried_out_cents: 0, replaces: null, replaced_by: null, fee_owed_cents: 0, autoreload: null, reduced, created_at, blocked_at: null});
const binding = (person, name, account_id, objects) => ({people: [{person_id: person, name}], accounts: [{app_id: 'hopline', account_id, owner_person_id: person}], objects: {hopline: objects}});

// Run handlers in time order, as Core would.
function simulate(data, bind) {
  let n = 0, now = null, taps = 0;
  const ctx = at => {
    if (now && Date.parse(at) < Date.parse(now)) throw new Error('History out of order at ' + at);
    now = at;
    return {app_id: 'hopline', role: 'infra', virtual_now: at, binding: bind};
  };
  const s = {
    event(at, operation, payload) { data = plugin.applyEvent(ctx(at), data, {event_id: 'hist-' + (++n), at, operation, payload}); plugin.validateSeed(ctx(at), data); return data; },
    tool(at, name, args = {}) {
      const out = plugin.handleTool(ctx(at), data, name, {expected_version: {epoch: 1, revision: n}, request_id: 'hist-' + (++n), ...args});
      data = out.data; plugin.validateSeed(ctx(at), data); return out.result;
    },
    tap(at, card_id, stop_id, route_id, mode) { return s.event(at, 'fare.tap_recorded', {tap_id: `tp-${card_id.replace(/~/g, '-')}-${++taps}`, card_id, stop_id, route_id, mode}); },
    settleAll(at, card_id) {
      for (const e of data.ledger.filter(x => x.card_id === card_id && x.kind === 'load_pending' && Date.parse(x.at) < Date.parse(at))) s.event(at, 'payment.settled', {entry_id: e.entry_id, outcome: 'settled'});
    },
    get data() { return data; }
  };
  return s;
}
// A commuter's day: an outbound and a return rail or bus tap, each a new fare (more than 2 h apart).
const RIDES = {
  'blue-central': ['st-central', 'rt-blue', 'rail'], 'blue-harbor': ['st-harbor-sq', 'rt-blue', 'rail'], 'blue-mill': ['st-mill', 'rt-blue', 'rail'],
  'blue-airport': ['st-airport', 'rt-blue', 'rail'], 'red-westgate': ['st-westgate', 'rt-red', 'rail'], 'red-central': ['st-central', 'rt-red', 'rail'],
  'bus12-elm': ['st-elm-3rd', 'rt-12', 'bus'], 'bus40-elm': ['st-elm-3rd', 'rt-40', 'bus'], 'bus40-harbor': ['st-harbor-sq-bus', 'rt-40', 'bus'],
  'bus40-seaport': ['st-seaport', 'rt-40', 'bus'], 'bus40-birch': ['st-birch', 'rt-40', 'bus'], 'bus12-central': ['st-central', 'rt-12', 'bus']
};
const ride = (s, at, cardId, key) => s.tap(at, cardId, ...RIDES[key]);

// Minimal fixture: Dana before the core examples (Mon Dec 7, 2026, 05:30 EST).
function minimal() {
  const bind = binding('person-dana', 'Dana Brooks', 'hopline-dana', ['st-central', 'fac-el12', 'pl-elm-3rd', 'pl-harbor-sq']);
  const data = account({account_id: 'hopline-dana', person: 'person-dana', name: 'Dana Brooks',
    methods: [{payment_method_id: 'pm-visa', label: 'Visa', last4: '4242', fails: false}, {payment_method_id: 'pm-debit', label: 'Debit card', last4: '1881', fails: false}]});
  data.cards = [card('cd-dana', 'Dana Brooks', "Dana's card", '2026-03-02T09:00:00-05:00', {program: 'disability', approved_at: '2026-03-02T09:00:00-05:00', expires_at: '2027-06-30T23:59:00-04:00'}),
    card('cd-lee', 'Lee Brooks', "Dad's card (Lee)", '2026-06-01T09:00:00-04:00')];
  data.applications = [{application_id: 'ap-cd-dana-1', card_id: 'cd-dana', program: 'disability', status: 'approved', submitted_at: '2026-02-20T10:00:00-05:00',
    decided_at: '2026-03-02T09:00:00-05:00', expires_at: '2027-06-30T23:59:00-04:00', history: [{at: '2026-03-02T09:00:00-05:00', action: 'approved'}]}];
  const s = simulate(data, bind);
  s.tool('2026-11-23T08:00:00-05:00', 'hopline.cards.add_value', {card_id: 'cd-lee', amount_cents: 1060, payment_method_id: 'pm-visa'});
  s.settleAll('2026-11-23T12:00:00-05:00', 'cd-lee');
  for (const at of ['2026-11-24T09:05:00-05:00', '2026-11-24T15:20:00-05:00', '2026-11-26T10:10:00-05:00', '2026-11-26T16:40:00-05:00']) ride(s, at, 'cd-lee', 'blue-harbor');
  s.tool('2026-11-29T19:00:00-05:00', 'hopline.cards.add_value', {card_id: 'cd-dana', amount_cents: 2500, payment_method_id: 'pm-debit'});
  s.settleAll('2026-11-30T06:00:00-05:00', 'cd-dana');
  for (const d of ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04']) {
    ride(s, local(d, '07:40'), 'cd-dana', 'bus12-elm'); ride(s, local(d, '07:58'), 'cd-dana', 'blue-central');
    ride(s, local(d, '17:20'), 'cd-dana', 'blue-harbor'); ride(s, local(d, '17:38'), 'cd-dana', 'bus12-central');
  }
  const add = (at, a) => s.tool(at, 'hopline.saved.add', a).saved_id;
  const home = add('2026-12-05T10:00:00-05:00', {kind: 'place', label: 'Home', place_ref: 'pl-elm-3rd'});
  const work = add('2026-12-05T10:01:00-05:00', {kind: 'place', label: 'Harbor Square', place_ref: 'pl-harbor-sq'});
  const clinic = add('2026-12-05T10:02:00-05:00', {kind: 'place', label: 'Clinic', place_ref: 'pl-westgate-clinic'});
  const commute = add('2026-12-05T10:03:00-05:00', {kind: 'commute', label: 'Work commute', from_saved_id: home, to_saved_id: work, days: [1, 2, 3, 4, 5],
    window: {start: '07:20', end: '08:00'}, step_free: true});
  const visit = add('2026-12-05T10:04:00-05:00', {kind: 'commute', label: 'Clinic visits', from_saved_id: home, to_saved_id: clinic, days: [4], window: {start: '13:00', end: '14:30'}, step_free: true});
  const sub = (at, a) => s.tool(at, 'hopline.subscriptions.create', a);
  sub('2026-12-05T10:10:00-05:00', {target: {kind: 'route', id: 'rt-40'}, delay_threshold_min: 10, delivery: 'in_app'});
  sub('2026-12-05T10:11:00-05:00', {target: {kind: 'card', id: 'cd-lee'}, low_balance_cents: 500, delivery: 'mail', quiet_hours: {start: '22:00', end: '06:30'}});
  sub('2026-12-05T10:12:00-05:00', {target: {kind: 'commute', id: commute}, delay_threshold_min: 10, delivery: 'mail', quiet_hours: {start: '22:00', end: '06:30'}, urgent_override: true});
  sub('2026-12-05T10:13:00-05:00', {target: {kind: 'commute', id: visit}, delivery: 'in_app'});
  return {seed: s.data, binding: bind, clock: {initial_time: '2026-12-07T05:30:00-05:00'}};
}

// Weekday commuting from start to end: outbound and return taps on chosen days, loads by autoreload.
function commuteHistory(s, rand, cardId, {from, to, days, outbound, back, skip = 0.12}) {
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!days.includes(weekday(d)) || rand() < skip) continue;
    const jitter = Math.floor(rand() * 9);
    for (const [hh, keys] of [[outbound, 'out'], [back, 'back']]) {
      const [h, m] = hh.split(':').map(Number), at = local(d, `${String(h).padStart(2, '0')}:${String(m + jitter).padStart(2, '0')}`);
      ride(s, at, cardId, keys === 'out' ? s.plan.out : s.plan.back);
    }
    s.settleAll(local(addDays(d, 0), '23:30'), cardId);
  }
}

// (a) A wheelchair user with a reduced-fare card whose commute runs through Central (EL-12).
function wheelchairCommute(rand) {
  const bind = binding('person-ines', 'Ines Ortega', 'hopline-ines', ['st-central', 'fac-el12', 'st-mill']);
  const data = account({account_id: 'hopline-ines', person: 'person-ines', name: 'Ines Ortega', methods: [{payment_method_id: 'pm-visa', label: 'Visa', last4: '7310', fails: false}]});
  data.cards = [card('cd-ines', 'Ines Ortega', 'My card', '2026-01-02T09:00:00-05:00', {program: 'disability', approved_at: '2026-01-02T09:00:00-05:00', expires_at: '2028-01-01T23:59:00-05:00'})];
  const s = simulate(data, bind);
  s.tool('2026-01-02T09:30:00-05:00', 'hopline.cards.add_value', {card_id: 'cd-ines', amount_cents: 3000, payment_method_id: 'pm-visa'});
  s.settleAll('2026-01-03T09:00:00-05:00', 'cd-ines');
  s.tool('2026-01-03T09:05:00-05:00', 'hopline.cards.set_autoreload', {card_id: 'cd-ines', rule: {threshold_cents: 1000, amount_cents: 3000, payment_method_id: 'pm-visa'}});
  s.plan = {out: 'blue-central', back: 'blue-mill'};
  commuteHistory(s, rand, 'cd-ines', {from: '2026-01-05', to: '2026-11-27', days: [1, 2, 3, 4], outbound: '08:05', back: '16:40'});
  const add = (at, a) => s.tool(at, 'hopline.saved.add', a).saved_id;
  const home = add('2026-11-28T10:00:00-05:00', {kind: 'place', label: 'Home', place_ref: 'pl-elm-3rd'});
  const office = add('2026-11-28T10:01:00-05:00', {kind: 'place', label: 'Office', place_ref: 'pl-mill-office'});
  const commute = add('2026-11-28T10:02:00-05:00', {kind: 'commute', label: 'To the office', from_saved_id: home, to_saved_id: office, days: [1, 2, 3, 4], window: {start: '07:45', end: '08:30'}, step_free: true});
  s.tool('2026-11-28T10:05:00-05:00', 'hopline.subscriptions.create', {target: {kind: 'commute', id: commute}, delivery: 'mail', quiet_hours: {start: '22:00', end: '06:30'}, urgent_override: true});
  s.tool('2026-11-28T10:06:00-05:00', 'hopline.subscriptions.create', {target: {kind: 'facility', id: 'fac-el12'}, delivery: 'in_app'});
  const events = [
    ['2026-11-30T05:20:00-05:00', 'facility.status_changed', {facility_id: 'fac-el12', stop_id: 'st-central', status: 'out_of_service', since: '2026-11-30T05:10:00-05:00', expected_return: '2026-12-01T18:00:00-05:00', note: 'Door fault'}],
    ['2026-11-30T07:10:00-05:00', 'service.trip_updated', {trip_id: 'trip:12:nb:2026-11-30:0750', delay_min: 12}],
    ['2026-12-01T09:00:00-05:00', 'facility.status_changed', {facility_id: 'fac-el12', status: 'out_of_service', since: '2026-11-30T05:10:00-05:00', expected_return: '2026-12-02T12:00:00-05:00', note: 'Part on order'}],
    ['2026-12-02T15:30:00-05:00', 'facility.status_changed', {facility_id: 'fac-el12', status: 'restored', since: '2026-12-02T15:25:00-05:00'}]
  ];
  return {name: 'wheelchair-commute', seed: s.data, binding: bind, clock: '2026-11-30T05:00:00-05:00', events};
}

// (b) A parent with a stroller who rides 3-5 days a week; a weekend detour moves the usual stop.
function strollerWeekend(rand) {
  const bind = binding('person-tomas', 'Tomas Reyes', 'hopline-tomas', ['st-elm-3rd', 'st-seaport', 'fac-es21']);
  const data = account({account_id: 'hopline-tomas', person: 'person-tomas', name: 'Tomas Reyes', methods: [{payment_method_id: 'pm-mc', label: 'Mastercard', last4: '5502', fails: false}]});
  data.cards = [card('cd-tomas', 'Tomas Reyes', 'Family card', '2026-05-30T09:00:00-04:00')];
  const s = simulate(data, bind);
  s.tool('2026-05-31T09:00:00-04:00', 'hopline.cards.add_value', {card_id: 'cd-tomas', amount_cents: 4000, payment_method_id: 'pm-mc'});
  s.settleAll('2026-06-01T08:00:00-04:00', 'cd-tomas');
  s.tool('2026-06-01T08:05:00-04:00', 'hopline.cards.set_autoreload', {card_id: 'cd-tomas', rule: {threshold_cents: 800, amount_cents: 4000, payment_method_id: 'pm-mc'}});
  s.plan = {out: 'bus40-elm', back: 'bus40-seaport'};
  commuteHistory(s, rand, 'cd-tomas', {from: '2026-06-01', to: '2026-12-10', days: [1, 3, 5, 6], outbound: '09:30', back: '14:10', skip: 0.25});
  const add = (at, a) => s.tool(at, 'hopline.saved.add', a).saved_id;
  const home = add('2026-12-10T20:00:00-05:00', {kind: 'place', label: 'Home', place_ref: 'pl-elm-3rd'});
  const aquarium = add('2026-12-10T20:01:00-05:00', {kind: 'place', label: 'Aquarium', place_ref: 'pl-seaport'});
  const outing = add('2026-12-10T20:02:00-05:00', {kind: 'commute', label: 'Saturday outing', from_saved_id: home, to_saved_id: aquarium, days: [6], window: {start: '09:30', end: '10:30'}, step_free: true});
  s.tool('2026-12-10T20:05:00-05:00', 'hopline.subscriptions.create', {target: {kind: 'commute', id: outing}, delivery: 'mail', quiet_hours: {start: '21:00', end: '07:00'}});
  s.tool('2026-12-10T20:06:00-05:00', 'hopline.subscriptions.create', {target: {kind: 'card', id: 'cd-tomas'}, low_balance_cents: 600, delivery: 'in_app'});
  const events = [
    ['2026-12-11T19:00:00-05:00', 'service.alert_published', {alert_id: 'al-40-weekend', version: 1, msg_type: 'alert', cause: 'construction', effect: 'stop_moved',
      informed: {route_ids: ['rt-40'], stop_ids: ['st-elm-3rd']}, replacement_stop_id: 'st-elm-4th',
      active_periods: [{start: '2026-12-12T08:00:00-05:00', end: '2026-12-12T18:00:00-05:00'}], header: 'Route 40: Elm & 3rd stop moved to Elm & 4th on Saturday'}],
    ['2026-12-11T21:30:00-05:00', 'service.alert_published', {alert_id: 'al-40-weekend', version: 2, msg_type: 'update',
      active_periods: [{start: '2026-12-12T08:00:00-05:00', end: '2026-12-13T18:00:00-05:00'}], header: 'Route 40: Elm & 3rd stop moved to Elm & 4th all weekend',
      references: [{alert_id: 'al-40-weekend', version: 1}]}],
    ['2026-12-12T08:15:00-05:00', 'facility.status_changed', {facility_id: 'fac-es21', status: 'out_of_service', since: '2026-12-12T08:10:00-05:00', expected_return: '2026-12-12T16:00:00-05:00'}],
    ['2026-12-12T09:52:00-05:00', 'fare.tap_recorded', {tap_id: 'tp-tomas-sat-1', card_id: 'cd-tomas', stop_id: 'st-elm-4th', route_id: 'rt-40', mode: 'bus'}],
    ['2026-12-13T19:00:00-05:00', 'service.alert_published', {alert_id: 'al-40-weekend', version: 3, msg_type: 'cancel', references: [{alert_id: 'al-40-weekend', version: 2}]}]
  ];
  return {name: 'stroller-weekend', seed: s.data, binding: bind, clock: '2026-12-11T18:00:00-05:00', events};
}

// (c) An airport visitor with a stored-value card that was reported lost, with a load still pending.
function airportLostCard(rand) {
  const bind = binding('person-kenji', 'Kenji Sato', 'hopline-kenji', ['st-airport']);
  const data = account({account_id: 'hopline-kenji', person: 'person-kenji', name: 'Kenji Sato', methods: [{payment_method_id: 'pm-amex', label: 'Amex', last4: '3005', fails: false}]});
  data.cards = [card('cd-kenji', 'Kenji Sato', 'Visitor card', '2026-09-28T14:00:00-04:00')];
  const s = simulate(data, bind);
  s.tool('2026-09-28T14:05:00-04:00', 'hopline.cards.add_value', {card_id: 'cd-kenji', amount_cents: 2000, payment_method_id: 'pm-amex'});
  s.settleAll('2026-09-28T14:30:00-04:00', 'cd-kenji');
  for (const [d, n] of [['2026-09-29', 3], ['2026-10-19', 4], ['2026-11-09', 4], ['2026-12-07', 2]]) {
    for (let i = 0; i < n; i++) {
      const day = addDays(d, i);
      ride(s, local(day, '09:' + String(10 + Math.floor(rand() * 40)).padStart(2, '0')), 'cd-kenji', i === 0 ? 'blue-airport' : 'blue-harbor');
      ride(s, local(day, '17:' + String(10 + Math.floor(rand() * 40)).padStart(2, '0')), 'cd-kenji', i === n - 1 ? 'blue-harbor' : 'blue-mill');
    }
    if (d !== '2026-12-07') { s.tool(local(addDays(d, n - 1), '20:00'), 'hopline.cards.add_value', {card_id: 'cd-kenji', amount_cents: 1500, payment_method_id: 'pm-amex'}); s.settleAll(local(addDays(d, n), '08:00'), 'cd-kenji'); }
  }
  // Lost on Dec 9 with a load still pending: the replacement carries the balance and the pending load.
  s.tool('2026-12-09T18:30:00-05:00', 'hopline.cards.add_value', {card_id: 'cd-kenji', amount_cents: 2000, payment_method_id: 'pm-amex'});
  s.tool('2026-12-09T21:00:00-05:00', 'hopline.cards.report_lost', {card_id: 'cd-kenji'});
  s.tool('2026-12-09T21:05:00-05:00', 'hopline.subscriptions.create', {target: {kind: 'card', id: 'cd-kenji~r1'}, low_balance_cents: 400, delivery: 'mail'});
  const pending = s.data.ledger.find(e => e.kind === 'load_pending').entry_id;
  const events = [
    // Written before the run against the original card: redirected to the replacement and recorded.
    ['2026-12-10T08:00:00-05:00', 'payment.settled', {card_id: 'cd-kenji', settle: 'oldest_pending', outcome: 'settled'}],
    ['2026-12-10T08:40:00-05:00', 'fare.tap_recorded', {tap_id: 'tp-kenji-old-1', card_id: 'cd-kenji', stop_id: 'st-harbor-sq', route_id: 'rt-blue', mode: 'rail'}],
    ['2026-12-10T08:42:00-05:00', 'fare.tap_recorded', {tap_id: 'tp-kenji-r1-1', card_id: 'cd-kenji~r1', stop_id: 'st-harbor-sq', route_id: 'rt-blue', mode: 'rail'}],
    ['2026-12-10T17:30:00-05:00', 'fare.tap_recorded', {tap_id: 'tp-kenji-r1-2', card_id: 'cd-kenji~r1', stop_id: 'st-airport', route_id: 'rt-blue', mode: 'rail'}]
  ];
  return {name: 'airport-lost-card', seed: s.data, binding: bind, clock: '2026-12-09T21:30:00-05:00', events, pending};
}

const policies = () => {
  const names = require('../tools.json').map(t => t.name);
  return {scenario: {allow: names, constraints: {}}, sandbox: {allow: names, constraints: {}}};
};
const json = value => JSON.stringify(value, null, 2) + '\n';

function outputs() {
  const m = minimal(), rand = prng(SEED);
  const files = {'fixtures/minimal.json': m.seed, 'fixtures/binding.json': m.binding, 'fixtures/clock.json': m.clock, 'fixtures/policies.json': policies()};
  for (const pack of [wheelchairCommute(rand), strollerWeekend(rand), airportLostCard(rand)]) {
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
