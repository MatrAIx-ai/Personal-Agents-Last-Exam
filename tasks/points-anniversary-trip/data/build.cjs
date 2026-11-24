#!/usr/bin/env node
'use strict';
// Single source for this task's App data on the Points and awards Apps (#193):
// Waypoint (Chase Ultimate Rewards, one instance each for Daniel and Mei),
// Skyline (Air Canada Aeroplan) and Harbor (World of Hyatt), plus the shared
// binding and the timed world events. Run `node build.cjs` after editing;
// `--check` fails on drift.
//
// App and account IDs are the environment's; program, airline, hotel and card
// names are the real brands the task uses. Amounts follow the pilot harness:
// 1 USD = 146 JPY and CAD 39 = USD 28.50.
const fs = require('node:fs');
const path = require('node:path');
const out = __dirname;

const DANIEL = 'person-daniel', MEI = 'person-mei';
const AC_NUMBER = '519384207', HYATT_NUMBER = '418370526B';
const CARDS = ['chase-sapphire-reserve', 'chase-freedom-unlimited', 'hilton-honors-amex'];
const T0 = '2027-08-24T21:00:00-05:00';
const jpy = yen => Math.round(yen / 146 * 100); // USD cents
const history = (at, action) => ({created_at:at, updated_at:at, history:[{at, action}]});

// ---- Waypoint: Chase Ultimate Rewards ----------------------------------
function ledger(rows) {
  let balance = 0;
  return rows.map(([at, kind, points, description], i) => {
    balance += points;
    return {id:'ledger-' + (i + 1), at, kind, points, balance_after:balance, description, ref:null};
  });
}
const danielLedger = ledger([
  ['2025-09-05T09:00:00-05:00', 'opening', 196000, 'Opening balance'],
  ['2026-03-31T08:00:00-05:00', 'earn', 41800, 'Sapphire Reserve statement March 2026'],
  ['2027-03-31T08:00:00-05:00', 'earn', 43800, 'Sapphire Reserve statement March 2027']
]);
const waypointDaniel = {
  account_id:'waypoint-daniel', owner_person_id:DANIEL, member_name:'Daniel Cho',
  household:[{person_id:MEI, name:'Mei Cho', waypoint_account_id:'waypoint-mei'}],
  balance:danielLedger.at(-1).balance_after, ledger:danielLedger,
  partners:[
    {id:'aeroplan', name:'Air Canada Aeroplan', app_id:'skyline', recipient_account_id:'skyline-daniel', member_number:AC_NUMBER,
      ratio:{from:1, to:1}, increment:1000, minimum:1000, delay_minutes:0},
    {id:'hyatt', name:'World of Hyatt', app_id:'harbor', recipient_account_id:'harbor-daniel', member_number:HYATT_NUMBER,
      ratio:{from:1, to:1}, increment:1000, minimum:1000, delay_minutes:0}
  ],
  bonuses:[{id:'bonus-aeroplan-2027-09', partner_id:'aeroplan', percent:30,
    starts_at:'2027-09-01T00:00:00-05:00', ends_at:'2027-10-01T00:00:00-05:00', ...history('2027-08-23T08:00:00-05:00', 'bonus_announced')}],
  transfers:[]
};
const meiLedger = ledger([
  ['2025-09-05T09:00:00-05:00', 'opening', 128400, 'Opening balance'],
  ['2026-06-30T08:00:00-05:00', 'earn', 43500, 'Sapphire Preferred statement June 2026']
]);
const waypointMei = {
  account_id:'waypoint-mei', owner_person_id:MEI, member_name:'Mei Cho',
  household:[{person_id:DANIEL, name:'Daniel Cho', waypoint_account_id:'waypoint-daniel'}],
  balance:meiLedger.at(-1).balance_after, ledger:meiLedger, partners:[], bonuses:[], transfers:[]
};

// ---- Skyline: Air Canada Aeroplan, United flights -----------------------
const POLARIS = {rows:[1, 2, 3, 4, 5, 6], letters:['A', 'D', 'F', 'K'], pairs:[['D', 'F']]};
const DOMESTIC_FIRST = {rows:[1, 2, 3, 4], letters:['A', 'B', 'E', 'F'], pairs:[['A', 'B'], ['E', 'F']]};
const ECONOMY = {rows:[20, 21, 22, 23], letters:['A', 'B', 'C', 'D', 'E', 'F'], pairs:[['A', 'B'], ['B', 'C'], ['D', 'E'], ['E', 'F']]};
function cabin(layout, free, saver) {
  const seats = layout.rows.flatMap(r => layout.letters.map(l => r + l));
  const adjacent_pairs = layout.rows.flatMap(r => layout.pairs.map(([a, b]) => [r + a, r + b]));
  if (!free.every(s => seats.includes(s))) throw new Error('unknown seat in ' + free);
  return {saver_seats:saver, seats, adjacent_pairs, taken:seats.filter(s => !free.includes(s))};
}
function flight(number, date, origin, dest, departs_at, arrives_at, cabins) {
  return {id:'UA' + number + '-' + date, flight_number:'UA' + number, operating_carrier:'United Airlines', origin, dest, departs_at, arrives_at, cabins};
}
// The first free seats in order are never an adjacent pair, so default seating splits the couple.
// Each segment of OPT-A1, OPT-R1 and ALT-1 keeps at least one free adjacent pair.
const econ = cabin(ECONOMY, ['20C', '21A', '21B', '22D', '22E', '23F'], 4);
const flights = [
  // Outbound 2027-10-15 (OPT-A1): two business award seats.
  flight(1735, '2027-10-15', 'MSP', 'SFO', '2027-10-15T06:00:00-05:00', '2027-10-15T08:05:00-07:00',
    {business:cabin(DOMESTIC_FIRST, ['1F', '2A', '3E', '3F'], 2), economy:econ}),
  flight(837, '2027-10-15', 'SFO', 'HND', '2027-10-15T11:00:00-07:00', '2027-10-16T14:20:00+09:00',
    {business:cabin(POLARIS, ['2K', '3A', '4D', '4F', '5K'], 2), economy:econ}),
  // 2027-10-16: no business award space.
  flight(1735, '2027-10-16', 'MSP', 'SFO', '2027-10-16T06:00:00-05:00', '2027-10-16T08:05:00-07:00',
    {business:cabin(DOMESTIC_FIRST, ['2A', '3E', '3F'], 0), economy:econ}),
  flight(837, '2027-10-16', 'SFO', 'HND', '2027-10-16T11:00:00-07:00', '2027-10-17T14:20:00+09:00',
    {business:cabin(POLARIS, ['3A', '4D', '4F'], 0), economy:econ}),
  // Return 2027-10-25 (OPT-R1): two business award seats; UA 2386 is ALT-1's replacement segment.
  flight(838, '2027-10-25', 'HND', 'SFO', '2027-10-25T16:05:00+09:00', '2027-10-25T09:20:00-07:00',
    {business:cabin(POLARIS, ['1K', '2A', '5D', '5F', '6A'], 2), economy:econ}),
  flight(2210, '2027-10-25', 'SFO', 'MSP', '2027-10-25T10:40:00-07:00', '2027-10-25T16:35:00-05:00',
    {business:cabin(DOMESTIC_FIRST, ['1B', '2E', '4A', '4B'], 2), economy:econ}),
  flight(2386, '2027-10-25', 'SFO', 'MSP', '2027-10-25T12:55:00-07:00', '2027-10-25T18:50:00-05:00',
    {business:cabin(DOMESTIC_FIRST, ['1A', '2B', '3E', '3F'], 0), economy:econ}),
  // 2027-10-24 and 2027-10-26: no business award space.
  ...['2027-10-24', '2027-10-26'].flatMap(date => [
    flight(838, date, 'HND', 'SFO', date + 'T16:05:00+09:00', date + 'T09:20:00-07:00', {business:cabin(POLARIS, ['5D', '5F'], 0), economy:econ}),
    flight(2210, date, 'SFO', 'MSP', date + 'T10:40:00-07:00', date + 'T16:35:00-05:00', {business:cabin(DOMESTIC_FIRST, ['4A', '4B'], 0), economy:econ})
  ])
];
// CAD 39 partner booking fee = USD 28.50 per passenger; taxes per passenger as in the pilot.
const chart = (origin, dest, taxes) => ['business', 'economy'].map(cabinName =>
  ({origin, dest, cabin:cabinName, points:cabinName === 'business' ? 75000 : 35000, partner_fee_cents:2850, taxes_cents:taxes}));
const skyline = {
  account_id:'skyline-daniel', owner_person_id:DANIEL, member_number:AC_NUMBER, mail_account_id:'mail-daniel',
  balance:0, ledger:[{id:'ledger-1', at:'2025-11-03T19:20:00-06:00', kind:'opening', points:0, balance_after:0, ref:null}],
  payment_labels:CARDS, charges:[], notices:[],
  passengers:[{id:'pax-daniel', person_id:DANIEL, name:'Daniel Cho'}, {id:'pax-mei', person_id:MEI, name:'Mei Cho'}],
  airports:[{code:'MSP', city:'Minneapolis', timezone:'America/Chicago'}, {code:'SFO', city:'San Francisco', timezone:'America/Los_Angeles'},
    {code:'HND', city:'Tokyo', timezone:'Asia/Tokyo'}],
  award_chart:[...chart('MSP', 'HND', 1120), ...chart('HND', 'MSP', 7040)],
  rules:{min_connection_minutes:60, max_connection_minutes:360},
  flights, inventory_revision:0, bookings:[]
};

// ---- Harbor: World of Hyatt -------------------------------------------
const hotel = (id, name, city, timezone, category, cashYen) =>
  ({id, name, city, timezone, category, category_changes:[], cash_rate_cents:jpy(cashYen), blackout_dates:[]});
const harbor = {
  account_id:'harbor-daniel', owner_person_id:DANIEL, member_number:HYATT_NUMBER, mail_account_id:'mail-daniel',
  balance:41200,
  ledger:[
    {id:'ledger-1', at:'2025-09-02T09:00:00-05:00', kind:'opening', points:56200, balance_after:56200, ref:null},
    {id:'ledger-2', at:'2025-09-30T00:00:00-05:00', kind:'redeem', points:-15000, balance_after:41200, ref:{reservation_id:'res-1'}}
  ],
  payment_labels:CARDS, charges:[], notices:[],
  // The last activity, 2025-09-30, means the points are forfeited at 2027-09-30T00:00:00-05:00.
  last_activity_at:'2025-09-30T00:00:00-05:00', inactivity_months:24, forfeited_at:null,
  award_chart:[
    {category:1, points_per_night:5000, points_cash:{points:2500, cash_cents:jpy(9000)}},
    {category:2, points_per_night:8000, points_cash:{points:4000, cash_cents:jpy(12000)}},
    {category:3, points_per_night:12000, points_cash:{points:6000, cash_cents:jpy(15000)}},
    {category:4, points_per_night:15000, points_cash:{points:7500, cash_cents:jpy(18000)}},
    {category:5, points_per_night:21000, points_cash:{points:10500, cash_cents:jpy(24000)}},
    {category:6, points_per_night:25000, points_cash:{points:12500, cash_cents:jpy(41000)}},
    {category:7, points_per_night:30000, points_cash:{points:15000, cash_cents:jpy(41000)}},
    {category:8, points_per_night:45000, points_cash:null}
  ],
  hotels:[
    {...hotel('hotel-hr-chicago', 'Hyatt Regency Chicago', 'Chicago', 'America/Chicago', 4, 0), cash_rate_cents:24900},
    hotel('hotel-hr-tokyo-bay', 'Hyatt Regency Tokyo Bay', 'Tokyo', 'Asia/Tokyo', 4, 32000),
    hotel('hotel-hr-tokyo', 'Hyatt Regency Tokyo', 'Tokyo', 'Asia/Tokyo', 5, 49000),
    hotel('hotel-centric-ginza', 'Hyatt Centric Ginza Tokyo', 'Tokyo', 'Asia/Tokyo', 6, 68000),
    hotel('hotel-park-tokyo', 'Park Hyatt Tokyo', 'Tokyo', 'Asia/Tokyo', 8, 160000),
    hotel('hotel-hr-kyoto', 'Hyatt Regency Kyoto', 'Kyoto', 'Asia/Tokyo', 6, 82000),
    hotel('hotel-park-kyoto', 'Park Hyatt Kyoto', 'Kyoto', 'Asia/Tokyo', 8, 190000)
  ],
  certificates:[{id:'cert-fn-2027', category_cap:4, expires_on:'2027-10-16', status:'active', reservation_id:null,
    ...history('2026-10-16T09:00:00-05:00', 'issued')}],
  reservations:[{id:'res-1', confirmation:'HY5K2Q8M1T', hotel_id:'hotel-hr-chicago', check_in:'2025-10-17', check_out:'2025-10-18', nights:1,
    status:'confirmed', payment:{method:'points', certificate_id:null, payment_label:null}, category_locked:4, points:15000, cash_cents:0,
    charge_ids:[], ...history('2025-09-30T00:00:00-05:00', 'booked')}]
};

// ---- Binding and timeline ---------------------------------------------
const binding = {
  people:[{person_id:DANIEL, name:'Daniel Cho'}, {person_id:MEI, name:'Mei Cho'}],
  accounts:[
    {app_id:'waypoint', account_id:'waypoint-daniel', owner_person_id:DANIEL},
    {app_id:'waypoint', account_id:'waypoint-mei', owner_person_id:MEI},
    {app_id:'skyline', account_id:'skyline-daniel', owner_person_id:DANIEL},
    {app_id:'harbor', account_id:'harbor-daniel', owner_person_id:DANIEL},
    {app_id:'mail', account_id:'mail-daniel', owner_person_id:DANIEL}
  ]
};
const RETURN = ['UA838-2027-10-25', 'UA2210-2027-10-25'], OUTBOUND = ['UA1735-2027-10-15', 'UA837-2027-10-15'];
const sold = (at, id) => ({app:'skyline', event:{event_id:'sold-' + id, at, operation:'skyline.inventory.sold',
  payload:{flight_id:id, cabin:'business', seats:'all'}}});
const timeline = {
  start:T0,
  note:'World events on the #193 Apps. Mail, Messages, card posting and the user model are scripted elsewhere.',
  events:[
    ...RETURN.map(id => sold('2027-08-25T18:00:00-05:00', id)),
    ...OUTBOUND.map(id => sold('2027-09-02T09:00:00-05:00', id)),
    {app:'harbor', event:{event_id:'category-hr-kyoto-2027-10', at:'2027-09-10T09:00:00-05:00', operation:'harbor.category.change',
      payload:{hotel_id:'hotel-hr-kyoto', category:7, effective_at:'2027-10-01T00:00:00-05:00'}}},
    {app:'skyline', event:{event_id:'schedule-ua838-2027-10-25', at:'2027-09-11T03:12:00-05:00', operation:'skyline.schedule.changed',
      payload:{change_id:'chg-ua838-2027-10-25', flight_id:'UA838-2027-10-25',
        departs_at:'2027-10-25T16:50:00+09:00', arrives_at:'2027-10-25T10:05:00-07:00',
        alternatives:[{id:'ALT-1', flight_ids:['UA838-2027-10-25', 'UA2386-2027-10-25']}], deadline:'2027-09-18T23:59:00-05:00'}}},
    {app:'skyline', event:{event_id:'expire-chg-ua838-2027-10-25', at:'2027-09-18T23:59:00-05:00', operation:'skyline.alternative.expired',
      payload:{change_id:'chg-ua838-2027-10-25'}}},
    {app:'harbor', event:{event_id:'expire-hyatt-2027-09-30', at:'2027-09-30T00:00:00-05:00', operation:'harbor.points.expire', payload:{}}}
  ]
};

function outputs() {
  return {
    'waypoint-daniel.seed.json':waypointDaniel, 'waypoint-mei.seed.json':waypointMei,
    'skyline.seed.json':skyline, 'harbor.seed.json':harbor, 'binding.json':binding, 'timeline.json':timeline
  };
}
function build({check = false} = {}) {
  const drift = [];
  for (const [name, value] of Object.entries(outputs())) {
    const file = path.join(out, name), text = JSON.stringify(value, null, 2) + '\n';
    if (check) { if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) drift.push(name); }
    else fs.writeFileSync(file, text);
  }
  if (drift.length) throw new Error('Task data drift: ' + drift.join(', '));
}
module.exports = {build, outputs};
if (require.main === module) { build({check:process.argv.includes('--check')}); console.log('task data is current.'); }
