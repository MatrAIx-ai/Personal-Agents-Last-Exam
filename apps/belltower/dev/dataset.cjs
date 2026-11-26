#!/usr/bin/env node
'use strict';
// Authoring-time script, never run by the App or the host.
//   node dev/dataset.cjs          write datasets/full-window/{seed.json,clock.json,dataset.json}
//   node dev/dataset.cjs --check  exit 1 if the committed files differ from a fresh build
// Builds the full-window evaluation dataset: two years of what Halden's six invented sources
// published (1 January 2025 to 31 December 2026), with updates, corrections, retractions,
// copies and reports, and what the account holder Dana did with it (follow rules, preferences,
// read marks, clippings). Everything is replayed in time order through the App's own business
// functions, so revisions, notifications and the activity log follow the App rules. It is
// separate from fixtures/minimal.json, which stays the small smoke-test fixture.
// Deterministic: a seeded generator, no wall clock. Every source, place and person is fictional.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { fixture, plugin } = require('../tests/harness.cjs');
const { compile } = require('../tests/schema-validator.cjs');
const { isoAt, localToInstant, ms, addDays } = require('../src/util.cjs');
const { itemStatus, notificationState } = require('../src/model.cjs');
const { base } = require('./build-fixture.cjs');

const SEED = 20250102, VERSION = '1.0.0', TZ = 'America/Chicago';
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(ROOT, 'datasets/full-window');
const START = '2025-01-01', END = '2026-12-31';
const at = (date, hhmm) => isoAt(localToInstant(date, hhmm, TZ), TZ);
const CLOCK = at(END, '20:00'), BEGIN = at('2024-12-31', '12:00');
const HOUR = 3600000;
const binding = require('../fixtures/binding.json');

// ---- a small seeded generator ---------------------------------------------------------------
let state = SEED;
function rand() { state = (state + 0x6D2B79F5) | 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const pick = list => list[Math.floor(rand() * list.length)];
const chance = p => rand() < p;
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

// ---- the city -----------------------------------------------------------------------------------
const H = 'ar-halden', MB = 'ar-millbrook', FH = 'ar-ferry-hill', OQ = 'ar-old-quay';
const MN = 'ar-millbrook-north', MS = 'ar-millbrook-south', UF = 'ar-upper-ferry', LF = 'ar-lower-ferry', QS = 'ar-quayside';
const WORKS = 'src-works', CITY = 'src-city', COURIER = 'src-courier', LEDGER = 'src-ledger', ROUNDUP = 'src-roundup', BULLETIN = 'src-bulletin';
const SOURCE_NAME = { [WORKS]: 'Halden Public Works', [CITY]: 'the City of Halden', [COURIER]: 'The Halden Courier', [LEDGER]: 'the Old Quay Ledger', [ROUNDUP]: 'Halden Roundup', [BULLETIN]: 'Neighbourhood Bulletin' };
const PREFIX = { [WORKS]: 'works', [CITY]: 'city', [COURIER]: 'cour', [LEDGER]: 'ledg', [ROUNDUP]: 'round', [BULLETIN]: 'bull' };
const NAME = { [H]: 'Halden', [MB]: 'Millbrook', [FH]: 'Ferry Hill', [OQ]: 'Old Quay', [MN]: 'Millbrook North', [MS]: 'Millbrook South', [UF]: 'Upper Ferry Hill', [LF]: 'Lower Ferry Hill', [QS]: 'Quayside' };
const DISTRICT = { [MN]: MB, [MS]: MB, [UF]: FH, [LF]: FH, [QS]: OQ };
const HOODS = [MN, MS, UF, LF, QS];
const STREETS = {
  [MN]: ['Tanner Street', 'Birch Lane', 'Mill Road', 'Orchard Way', 'Hollis Avenue'],
  [MS]: ['Alder Row', 'Riverside Drive', 'Pike Street', 'Weaver Lane', 'Cotton Street'],
  [UF]: ['Summit Road', 'Lookout Terrace', 'Pinecrest Avenue', 'Bellview Street'],
  [LF]: ['Ferry Hill Road', 'Dock Lane', 'Wharf Street', 'Juniper Street'],
  [QS]: ['Canal Street', 'Harbour Row', 'Quay Road', 'Net Lane'],
};
const CROSS = { 'Tanner Street': 'Mill Road', 'Birch Lane': 'Hollis Avenue', 'Mill Road': 'Orchard Way', 'Orchard Way': 'Birch Lane', 'Hollis Avenue': 'Tanner Street', 'Alder Row': 'Pike Street', 'Riverside Drive': 'Weaver Lane', 'Pike Street': 'Cotton Street', 'Weaver Lane': 'Alder Row', 'Cotton Street': 'Riverside Drive', 'Summit Road': 'Bellview Street', 'Lookout Terrace': 'Summit Road', 'Pinecrest Avenue': 'Lookout Terrace', 'Bellview Street': 'Pinecrest Avenue', 'Ferry Hill Road': 'Dock Lane', 'Dock Lane': 'Juniper Street', 'Wharf Street': 'Ferry Hill Road', 'Juniper Street': 'Wharf Street', 'Canal Street': 'Quay Road', 'Harbour Row': 'Net Lane', 'Quay Road': 'Harbour Row', 'Net Lane': 'Canal Street' };
const LIBRARY = { [OQ]: 'Old Quay Library', [MB]: 'Millbrook Library', [FH]: 'Ferry Hill Library' };
const SCHOOL = { [MN]: 'Millbrook North Primary', [MS]: 'Riverside Primary', [UF]: 'Ferry Hill Secondary', [LF]: 'Wharf Street Primary', [QS]: 'Quayside Primary' };
const PARK = { [MN]: 'Hollis Park', [MS]: 'Millbrook Park', [UF]: 'Summit Green', [LF]: 'Dock Lane playground', [QS]: 'the harbour lawn' };
const SHOPS = ['a bakery', 'a bike repair shop', 'a bookshop', 'a noodle bar', 'a hardware store', 'a florist', 'a coffee roaster', 'a pharmacy', 'a children\'s clothing shop', 'a deli'];
const SHOP_NAMES = ['Kestrel Coffee', 'Penny Lane Books', 'Northgate Hardware', 'Lindqvist Bikes', 'Orchard Deli', 'Harbour Noodles', 'Tanner\'s Florist', 'Riverside Pharmacy', 'Little Wharf Kids', 'Quay Roasters', 'Millbrook Fish & Chips', 'Ferry Hill Bagels'];
const ROUTES = ['2', '4', '7', '9', '12', '15'];
const OWNERS = [['Marta Lindqvist', 'Marta Lindqvst'], ['Joy Okafor', 'Joy Okafur'], ['Ana Ferreira', 'Ana Ferriera'], ['Ruth Whitlock', 'Ruth Whitlok'], ['Lena Brennan', 'Lena Brenan'], ['Mei Nakamura', 'Mei Nakamure']];

// ---- dates in the house style ("Monday 2 November") -------------------------------------------
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dow = date => new Date(date + 'T12:00:00Z').getUTCDay();
const dm = date => +date.slice(8, 10) + ' ' + MONTH[+date.slice(5, 7) - 1];
let writingYear = '2025';
const day = date => WEEKDAY[dow(date)] + ' ' + dm(date) + (date.slice(0, 4) !== writingYear ? ' ' + date.slice(0, 4) : '');
const nextWeekday = (date, wd, min = 1) => { let d = addDays(date, min); while (dow(d) !== wd) d = addDays(d, 1); return d; };
const workdaysAfter = (date, n) => { let d = date, left = n - 1; while (left > 0) { d = addDays(d, 1); if (dow(d) > 0 && dow(d) < 6) left--; } return d; };

// ---- what each source writes --------------------------------------------------------------------
// A story is one original item and what follows from it: later revisions (`then`), and other
// sources' copies or reports (`echo`). Hours count from the moment the original arrives.
const story = s => s;
const T = {
  // -- Halden Public Works
  resurfacing(d) {
    if (d.month <= 2 || d.month === 12) return null;
    const hood = pick(HOODS), street = pick(STREETS[hood]), start = nextWeekday(d.date, pick([1, 2, 3]), 3), days = between(3, 8), end = workdaysAfter(start, days), open = chance(0.6);
    const body = s => 'Public Works will resurface ' + street + ' between ' + CROSS[street] + ' and the ' + pick(['bus stop', 'school crossing', 'junction with the main road', 'library']) + ' from ' + day(s) + '. The work is expected to take ' + days + ' working days. ' + (open ? 'One lane stays open throughout.' : 'The street is closed to through traffic; residents keep access.');
    const then = [];
    if (chance(0.3)) { const later = workdaysAfter(end, between(2, 4)); then.push({ hours: between(40, 100), type: 'update', headline: street + ' resurfacing extended to ' + day(later), body: pick(['Rain', 'A late delivery of asphalt', 'A burst water pipe found under the road']) + ' has delayed the resurfacing of ' + street + '. Public Works now expects to finish on ' + day(later) + '. ' + (open ? 'One lane stays open throughout.' : 'Residents keep access.'), effective: { start: at(start, '07:00'), end: at(later, '17:00') } }); }
    else if (chance(0.06)) { const wrong = addDays(start, 7); return story({ src: WORKS, kind: 'notice', topics: ['roads'], areas: [hood], priority: 'routine', headline: street + ' resurfacing from ' + day(wrong), body: body(wrong), effective: { start: at(wrong, '07:00'), end: at(workdaysAfter(wrong, days), '17:00') }, then: [{ hours: between(3, 20), type: 'correction', what: 'a start date', note: 'An earlier version gave the wrong start date. The work starts on ' + day(start) + ', a week earlier.', headline: street + ' resurfacing from ' + day(start), body: body(start), effective: { start: at(start, '07:00'), end: at(end, '17:00') } }], echo: [copy(ROUNDUP, 0.35)] }); }
    return story({ src: WORKS, kind: 'notice', topics: ['roads'], areas: [hood], priority: 'routine', headline: street + ' resurfacing from ' + day(start), body: body(start), effective: { start: at(start, '07:00'), end: at(end, '17:00') }, then, echo: [copy(ROUNDUP, 0.3), report(COURIER, 0.06)] });
  },
  laneClosure(d) {
    const hood = pick(HOODS), street = pick(STREETS[hood]), start = addDays(d.date, between(2, 5)), nights = between(1, 3), end = addDays(start, nights), why = pick(['drain repairs', 'a gas main inspection', 'cable laying', 'sewer camera work', 'bridge joint repairs']);
    const text = (s, h) => ({ headline: 'Overnight lane closure on ' + s, body: 'One lane of ' + s + ' will be closed between 21:00 and 05:00 from ' + day(start) + ' to ' + day(end) + ' for ' + why + '. ' + pick(['Expect short delays.', 'Traffic lights will control the open lane.', 'Buses keep their stops.']), areas: [h] });
    if (chance(0.05)) {
      const other = pick(HOODS.filter(x => x !== hood)), wrongStreet = pick(STREETS[other]), right = text(street, hood);
      return story({ src: WORKS, kind: 'notice', topics: ['roads'], priority: 'important', ...text(wrongStreet, other), effective: { start: at(start, '21:00'), end: at(end, '05:00') },
        then: [{ hours: between(4, 22), type: 'correction', what: 'a street name', note: 'An earlier version named the wrong road. The lane closure is on ' + street + ' in ' + NAME[hood] + ', not ' + wrongStreet + '.', ...right, body: right.body + ' ' + wrongStreet + ' is not affected.', effective: { start: at(start, '21:00'), end: at(end, '05:00') } }],
        echo: [report(COURIER, 0.4, 2, 10)] });
    }
    return story({ src: WORKS, kind: 'notice', topics: ['roads'], priority: chance(0.4) ? 'important' : 'routine', ...text(street, hood), effective: { start: at(start, '21:00'), end: at(end, '05:00') }, echo: [copy(ROUNDUP, 0.2)] });
  },
  hydrants(d) {
    if (![4, 5, 9, 10].includes(d.month) || dow(d.date) !== 1 && dow(d.date) !== 5) return null;
    const area = pick([MB, FH, OQ]), start = nextWeekday(d.date, 1, 1), end = addDays(start, 4);
    return story({ src: WORKS, kind: 'notice', topics: ['water'], areas: [area], priority: 'routine', headline: 'Hydrant flushing in ' + NAME[area] + ' next week',
      body: 'Crews will flush hydrants in ' + NAME[area] + ' between 09:00 and 15:00 from ' + day(start) + ' to ' + day(end) + '. Tap water may look cloudy for a short time; run the cold tap until it clears.', effective: { start: at(start, '09:00'), end: at(end, '15:00') }, echo: [copy(BULLETIN, 0.3)] });
  },
  mainBreak(d) {
    if (!(d.month <= 3 || d.month >= 11) && !chance(0.3)) return null;
    const hood = pick(HOODS), street = pick(STREETS[hood]);
    return story({ src: WORKS, kind: 'article', topics: ['water'], areas: [hood], priority: 'important', time: pick(['06:40', '07:15', '11:30', '15:50', '19:20']), headline: 'Water main break on ' + street,
      body: 'A water main broke on ' + street + ' near ' + CROSS[street] + '. Homes on ' + street + ' and part of ' + CROSS[street] + ' have no water or low pressure while crews repair it. Bottled water is available at ' + (LIBRARY[DISTRICT[hood]] || 'the community centre') + '.',
      then: [{ hours: between(4, 14), type: 'update', headline: 'Water back on ' + street, body: 'Crews have repaired the water main on ' + street + ' and the supply is back. Water may look brown for a few hours; run the cold tap until it clears. ' + street + ' stays down to one lane until the road is patched.' }],
      echo: [copy(ROUNDUP, 0.25, 1, 3)] });
  },
  snowRoutes(d) {
    if (d.month !== 10 && d.month !== 11 || chance(0.7)) return null;
    return story({ src: WORKS, kind: 'article', topics: ['roads', 'weather'], areas: [H], priority: 'routine', headline: 'Winter gritting routes published for ' + d.year + '–' + (+d.year + 1 + '').slice(2),
      body: 'Public Works has published this winter\'s gritting routes. Main roads and bus routes are treated first; side streets follow when frost is forecast for more than one night. ' + pick(['Kestrel Bridge', 'Summit Road', 'Ferry Hill Road']) + ' is treated before the morning peak.', echo: [report(COURIER, 0.15)] });
  },
  sweeping(d) {
    if (d.month !== 3 && d.month !== 4 || dow(d.date) !== 3) return null;
    const area = pick([MB, FH, OQ]), start = nextWeekday(d.date, 1, 3), end = addDays(start, 11);
    return story({ src: WORKS, kind: 'notice', topics: ['roads', 'community'], areas: [area], priority: 'routine', headline: 'Spring street sweeping in ' + NAME[area],
      body: 'Sweepers will clear winter grit from streets in ' + NAME[area] + ' from ' + day(start) + ' to ' + day(end) + '. Signs go up the day before; please move cars on your street\'s sweeping day.', effective: { start: at(start, '07:00'), end: at(end, '16:00') }, echo: [copy(BULLETIN, 0.4)] });
  },
  lights(d) {
    const hood = pick(HOODS), street = pick(STREETS[hood]), start = addDays(d.date, between(1, 4));
    return story({ src: WORKS, kind: 'notice', topics: ['power'], areas: [hood], priority: 'routine', headline: 'Street lights off on ' + street + ' for cable repairs',
      body: 'Street lights on ' + street + ' between ' + CROSS[street] + ' and the end of the street will be off on the night of ' + day(start) + ' while crews replace a damaged cable. Homes are not affected.', effective: { start: at(start, '18:00'), end: at(addDays(start, 1), '06:00') } });
  },
  // -- City of Halden
  hearing(d) {
    const subject = pick([['the Old Quay parking plan', OQ, 'Old Quay Community Centre'], ['the Millbrook Park play area', MB, 'Millbrook Library'], ['bike lanes on Ferry Hill Road', FH, 'Ferry Hill Library'], ['the harbour wall footpath', QS, 'Old Quay Community Centre'],
      ['the ' + (+d.year + 1) + ' street repair list', H, 'City Hall'], ['new housing on Summit Road', UF, 'Ferry Hill Library'], ['the Riverside Drive crossing', MS, 'Millbrook Library'], ['opening hours of the fish market hall', QS, 'Old Quay Community Centre']]);
    const date = nextWeekday(d.date, pick([2, 4]), 6), deadline = addDays(date, -1), room = pick(['Room 2', 'the Main Hall', 'the Council Chamber', 'Room 1']), wrongRoom = pick(['Room 3', 'the Garden Room']);
    const body = r => 'The council will hear residents on ' + subject[0] + ' on ' + day(date) + ' at 18:30 in ' + r + ' of ' + subject[2] + '. Written comments are accepted until ' + day(deadline) + '.';
    const s = { src: CITY, kind: 'article', topics: ['government'], areas: [subject[1]], priority: 'routine', headline: 'Public hearing on ' + subject[0], echo: [copy(ROUNDUP, 0.45), report(subject[1] === OQ || subject[1] === QS ? LEDGER : COURIER, 0.35)] };
    if (chance(0.1)) return story({ ...s, body: body(wrongRoom), then: [{ hours: between(10, 40), type: 'correction', what: 'a room', note: 'An earlier version gave the wrong room. The hearing is in ' + room + ', not ' + wrongRoom + '.', headline: s.headline, body: body(room) }] });
    if (chance(0.08)) return story({ ...s, body: body(room), then: [{ hours: between(20, 70), type: 'update', headline: 'Hearing on ' + subject[0] + ' moved to ' + day(addDays(date, 7)), body: 'The hearing on ' + subject[0] + ' has moved to ' + day(addDays(date, 7)) + ' at 18:30, same place. Written comments are accepted until ' + day(addDays(date, 6)) + '.' }] });
    return story({ ...s, body: body(room) });
  },
  libraryClosure(d) {
    const area = pick([OQ, MB, FH]), lib = LIBRARY[area], date = addDays(d.date, between(3, 9)), why = pick(['staff training', 'a heating repair', 'new shelving', 'a power upgrade', 'floor cleaning']);
    return story({ src: CITY, kind: 'notice', topics: ['libraries'], areas: [area], priority: 'routine', headline: lib + ' closed on ' + day(date),
      body: lib + ' will be closed all day on ' + day(date) + ' for ' + why + '. Returns can be left in the outside box; nothing will be charged as late that day.', effective: { start: at(date, '09:00'), end: at(addDays(date, 1), '09:00') }, echo: [copy(BULLETIN, 0.3)] });
  },
  libraryHours(d) {
    if (chance(0.6)) return null;
    const area = pick([OQ, MB, FH]), lib = LIBRARY[area], from = nextWeekday(d.date, 1, 4), close = pick(['19:00', '20:00']);
    const s = { src: CITY, kind: 'notice', topics: ['libraries'], areas: [area], priority: 'routine', headline: lib + ' open until ' + close + ' on weekdays', effective: { start: at(from, '09:00'), end: null }, echo: [copy(ROUNDUP, 0.4), report(area === OQ ? LEDGER : COURIER, 0.4)] };
    const body = c => 'From ' + day(from) + ', ' + lib + ' is open until ' + c + ' from Monday to Friday. Weekend hours are unchanged.';
    if (chance(0.15)) { const wrong = close === '19:00' ? '21:00' : '19:00'; return story({ ...s, headline: lib + ' open until ' + wrong + ' on weekdays', body: body(wrong), then: [{ hours: between(10, 30), type: 'correction', what: 'a closing time', note: 'An earlier version gave the wrong closing time. On weekdays the library closes at ' + close + ', not ' + wrong + '.', headline: s.headline, body: body(close), effective: s.effective }] }); }
    return story({ ...s, body: body(close) });
  },
  busDetour(d) {
    const route = pick(ROUTES), hood = pick(HOODS), street = pick(STREETS[hood]), start = addDays(d.date, between(2, 6)), weeks = between(1, 4), end = addDays(start, weeks * 7);
    return story({ src: CITY, kind: 'notice', topics: ['transit'], areas: [hood], priority: 'routine', headline: 'Bus route ' + route + ' detour on ' + street,
      body: 'From ' + day(start) + ' to ' + day(end) + ', route ' + route + ' buses will not serve ' + street + ' while ' + pick(['a gas main is replaced', 'a building is demolished', 'the road is rebuilt']) + '. Use the temporary stop on ' + CROSS[street] + '.', effective: { start: at(start, '05:00'), end: at(end, '23:59') },
      then: chance(0.15) ? [{ hours: between(48, 200), type: 'update', headline: 'Route ' + route + ' back on ' + street + ' early', body: 'Route ' + route + ' buses serve ' + street + ' again from ' + day(addDays(start, Math.max(1, weeks * 7 - 5))) + ', earlier than planned.', effective: { start: at(start, '05:00'), end: at(addDays(start, Math.max(1, weeks * 7 - 5)), '05:00') } }] : [],
      echo: [copy(ROUNDUP, 0.35), copy(BULLETIN, 0.15)] });
  },
  timetable(d) {
    if (![1, 6, 9].includes(d.month) || d.dom > 10 || chance(0.6)) return null;
    const from = nextWeekday(d.date, 0, 5);
    return story({ src: CITY, kind: 'notice', topics: ['transit'], areas: [H], priority: 'routine', headline: 'New bus timetables from ' + day(from),
      body: 'New timetables start on ' + day(from) + '. Routes ' + pick(ROUTES) + ' and ' + pick(ROUTES) + ' run every ' + pick(['12', '15', '20']) + ' minutes at peak times; evening buses on route ' + pick(ROUTES) + ' run until ' + pick(['23:00', '23:30', '00:15']) + '. Printed timetables are at every library.', effective: { start: at(from, '04:30'), end: null }, echo: [copy(ROUNDUP, 0.5), report(COURIER, 0.25)] });
  },
  pool(d) {
    if (d.month !== 5 || d.dom < 10 || d.dom > 24 || chance(0.5)) return null;
    const open = nextWeekday(d.date, 6, 5);
    return story({ src: CITY, kind: 'article', topics: ['community'], areas: [MS], priority: 'routine', headline: 'Millbrook outdoor pool opens ' + day(open),
      body: 'The outdoor pool in Millbrook Park opens for the season on ' + day(open) + '. Lanes are open from 07:00 to 09:00 on weekdays; family swims run from 12:00 to 18:00. Season passes are on sale at the pool.', echo: [copy(BULLETIN, 0.5)] });
  },
  heat(d) {
    if (![6, 7, 8].includes(d.month) || chance(0.85)) return null;
    const end = addDays(d.date, between(1, 3));
    return story({ src: CITY, kind: 'notice', topics: ['weather', 'health'], areas: [H], priority: 'important', time: pick(['08:10', '10:30', '13:45']), headline: 'Cooling centres open as temperatures climb',
      body: 'With temperatures forecast above 35 °C until ' + day(end) + ', libraries and community centres are open as cooling centres from 10:00 to 20:00. Check on older neighbours and never leave anyone in a parked car.', effective: { start: at(d.date, '10:00'), end: at(end, '20:00') },
      echo: [copy(ROUNDUP, 0.5, 1, 3), report(COURIER, 0.3, 2, 8)] });
  },
  flu(d) {
    if (d.month !== 10 || d.dom > 12 || chance(0.7)) return null;
    const dates = [addDays(d.date, 6), addDays(d.date, 13), addDays(d.date, 20)];
    return story({ src: CITY, kind: 'article', topics: ['health'], areas: [H], priority: 'routine', headline: 'Free flu vaccination clinics this autumn',
      body: 'Free flu vaccinations are offered at ' + LIBRARY[OQ] + ' on ' + day(dates[0]) + ', ' + LIBRARY[MB] + ' on ' + day(dates[1]) + ' and ' + LIBRARY[FH] + ' on ' + day(dates[2]) + ', from 10:00 to 16:00. No appointment is needed; bring a photo ID.', echo: [copy(ROUNDUP, 0.5), copy(BULLETIN, 0.3), report(COURIER, 0.2)] });
  },
  busRouteSchool(d) {
    if (![1, 8, 9].includes(d.month) || chance(0.75)) return null;
    const hood = pick([MN, MS, UF]), street = pick(STREETS[hood]), from = nextWeekday(d.date, 1, 3), route = pick(ROUTES), time = pick(['07:10', '07:20', '07:35']);
    return story({ src: CITY, kind: 'notice', topics: ['schools', 'transit'], areas: [DISTRICT[hood]], priority: 'routine', headline: 'School bus route ' + route + ': stop change from ' + day(from),
      body: 'From ' + day(from) + ', school bus route ' + route + ' no longer stops at ' + street + '. Pupils board at ' + SCHOOL[hood] + ' instead, at ' + time + '. All other stops are unchanged.', effective: { start: at(from, '06:30'), end: null }, echo: [copy(ROUNDUP, 0.4), report(COURIER, 0.3)] });
  },
  planning(d) {
    const hood = pick(HOODS), street = pick(STREETS[hood]), units = between(6, 48), deadline = addDays(d.date, 21);
    return story({ src: CITY, kind: 'article', topics: ['government'], areas: [hood], priority: 'routine', headline: 'Planning application: ' + units + ' homes on ' + street,
      body: 'A developer has applied to build ' + units + ' homes on the site of ' + pick(['a former garage', 'an empty warehouse', 'a car park', 'a closed supermarket']) + ' on ' + street + '. Plans can be seen at ' + (LIBRARY[DISTRICT[hood]] || 'City Hall') + ' and online; comments close on ' + day(deadline) + '.', echo: [report(DISTRICT[hood] === OQ ? LEDGER : COURIER, 0.3)] });
  },
  // -- The Halden Courier
  business(d) {
    const hood = pick(HOODS), street = pick(STREETS[hood]), name = pick(SHOP_NAMES), opening = chance(0.6), [owner, misspelt] = pick(OWNERS), wrong = chance(0.06);
    const text = who => opening
      ? { headline: name + ' opens on ' + street, body: pick(SHOPS).replace(/^./, c => c.toUpperCase()) + ', ' + name + ', opened on ' + street + ' in ' + NAME[hood] + ' this week. The owner, ' + who + ', said ' + pick(['five people work there', 'it is her second shop', 'it had been planned for two years', 'the opening hours are 07:00 to 18:00']) + '.' }
      : { headline: name + ' to close after ' + between(4, 40) + ' years', body: name + ' on ' + street + ' will close at the end of ' + MONTH[d.month % 12] + '. The owner, ' + who + ', said ' + pick(['the rent had doubled', 'she is retiring', 'trade never recovered after the road works', 'the shop is moving to a bigger site in Northgate']) + '.' };
    const src = hood === QS ? LEDGER : COURIER, s = text(wrong ? misspelt : owner);
    return story({ src, kind: 'article', topics: ['business'], areas: [hood], priority: 'routine', ...s, echo: [copy(BULLETIN, 0.3)],
      then: wrong ? [{ hours: between(6, 30), type: 'correction', what: 'a name', note: 'An earlier version misspelt the owner\'s name. She is ' + owner + '.', ...text(owner), headline: s.headline }] : [] });
  },
  schoolBoard(d) {
    if (d.month === 7) return null;
    const topic = pick([['later start times for secondary schools', 'The board will vote'], ['a new lunch provider', 'A decision is expected'], ['the ' + (d.month < 8 ? +d.year - 1 : d.year) + ' test results', 'The full report is due'], ['phones in class', 'A policy is expected'], ['the school year calendar', 'The board will vote']]);
    const date = addDays(d.date, between(20, 50));
    return story({ src: COURIER, kind: 'article', topics: ['schools'], areas: [H], priority: 'routine', headline: 'School board debates ' + topic[0],
      body: 'The Halden school board discussed ' + topic[0] + ' at its meeting this week. ' + topic[1] + ' on ' + day(date) + '. ' + pick(['Parents can comment through the board\'s survey.', 'Two board members asked for more time.', 'Teachers\' representatives spoke in favour.']),
      then: chance(0.12) ? [{ hours: between(20, 80), type: 'correction', what: 'a date', note: 'An earlier version gave the wrong date. ' + topic[1].replace(/^./, c => c.toUpperCase()) + ' on ' + day(addDays(date, 7)) + '.', headline: 'School board debates ' + topic[0], body: 'The Halden school board discussed ' + topic[0] + ' at its meeting this week. ' + topic[1] + ' on ' + day(addDays(date, 7)) + '.' }] : [],
      echo: [copy(BULLETIN, 0.15)] });
  },
  schoolWin(d) {
    if (d.month === 7 || d.month === 8) return null;
    const hood = pick(HOODS);
    return story({ src: COURIER, kind: 'article', topics: ['schools', 'community'], areas: [hood], priority: 'routine', headline: SCHOOL[hood] + ' ' + pick(['choir wins regional prize', 'robotics team reaches state final', 'pupils plant 200 trees', 'chess club takes city title']),
      body: 'Pupils from ' + SCHOOL[hood] + ' ' + pick(['won the regional round on Saturday', 'were congratulated by the mayor this week', 'spent two weekends on the project', 'beat eleven other schools']) + '. Their teacher said the group had practised after school since ' + MONTH[(d.month + 9) % 12] + '.', echo: [copy(BULLETIN, 0.4)] });
  },
  clinic(d) {
    if (chance(0.6)) return null;
    const what = pick([['Riverside Clinic adds Saturday morning hours', 'Riverside Clinic in Millbrook South will open on Saturdays from 09:00 to 12:00 from ' + day(nextWeekday(d.date, 6, 7)) + ', the health board said.', MS],
      ['Northgate Clinic hires two more doctors', 'Northgate Clinic will take on two more family doctors in ' + MONTH[d.month % 12] + ', which should cut waiting times for appointments, the clinic said.', MB],
      ['Walk-in centre changes hours', 'The walk-in centre at Halden General Hospital will close at 20:00 instead of 22:00 from ' + day(nextWeekday(d.date, 1, 7)) + '.', H],
      ['Blood drive at the Old Quay Community Centre', 'A blood drive will be held at the Old Quay Community Centre on ' + day(nextWeekday(d.date, 6, 4)) + ' from 10:00 to 15:00.', OQ]]);
    return story({ src: COURIER, kind: 'article', topics: ['health'], areas: [what[2]], priority: chance(0.3) ? 'important' : 'routine', headline: what[0], body: what[1], echo: [copy(ROUNDUP, 0.2), copy(BULLETIN, 0.2)],
      then: chance(0.1) ? [{ hours: between(20, 120), type: 'update', headline: what[0] + ': details confirmed', body: what[1] + ' The details were confirmed on ' + day(addDays(d.date, 2)) + '.' }] : [] });
  },
  safety(d) {
    const hood = pick(HOODS), street = pick(STREETS[hood]), what = pick([
      ['Fire at a ' + pick(['house', 'garage', 'shop']) + ' on ' + street, 'Firefighters put out a fire at a ' + pick(['house', 'garage', 'shop']) + ' on ' + street + ' early on ' + WEEKDAY[dow(d.date)] + '. Nobody was hurt. The cause is being investigated.'],
      ['Collision closes ' + street + ' for three hours', 'A collision between a van and a car closed ' + street + ' near ' + CROSS[street] + ' for three hours on ' + WEEKDAY[dow(d.date)] + '. One driver was taken to Halden General Hospital with minor injuries.'],
      ['Police ask for witnesses after break-ins on ' + street, 'Police are asking for witnesses after ' + between(2, 5) + ' sheds and garages on ' + street + ' were broken into overnight. Anyone with camera footage is asked to call the station.'],
      ['Gas leak on ' + street + ' made safe', 'Crews made a gas leak safe on ' + street + ' after residents reported a smell. ' + between(10, 40) + ' homes were evacuated for two hours.']]);
    return story({ src: hood === QS ? LEDGER : COURIER, kind: 'article', topics: ['safety'], areas: [hood], priority: chance(0.3) ? 'important' : 'routine', time: pick(['07:30', '09:45', '12:10', '17:20', '20:40']), headline: what[0], body: what[1],
      then: chance(0.12) ? [{ hours: between(6, 30), type: 'update', headline: what[0] + ': update', body: what[1] + ' ' + pick(['The street reopened in the afternoon.', 'Police later said they had made an arrest.', 'The fire service said an electrical fault was to blame.']) }] : [],
      echo: [copy(BULLETIN, 0.15)] });
  },
  feature(d) {
    const hood = pick(HOODS), what = pick([
      ['Volunteers clean up ' + PARK[hood], between(20, 60) + ' volunteers spent Saturday morning clearing litter and planting bulbs in ' + PARK[hood] + '.', ['community']],
      ['Book swap starts in ' + NAME[hood], 'A free book swap now runs on the first Saturday of each month at ' + (LIBRARY[DISTRICT[hood]] || 'the community centre') + ', from 10:00 to 12:00.', ['community', 'libraries']],
      ['Neighbours raise money for ' + pick(['a new playground', 'the food bank', 'a defibrillator', 'the school library']), 'Residents of ' + NAME[hood] + ' raised ' + pick(['$4,200', '$7,800', '$2,500', '$11,000']) + ' at a street party last weekend.', ['community']],
      ['Repair café comes to ' + NAME[hood], 'Volunteers will fix broken lamps, bikes and clothes for free at a repair café in ' + NAME[hood] + ' on ' + day(nextWeekday(d.date, 6, 3)) + '.', ['community']]]);
    return story({ src: hood === QS ? LEDGER : pick([COURIER, BULLETIN]), kind: 'article', topics: what[2], areas: [hood], priority: 'routine', headline: what[0], body: what[1] });
  },
  harbour(d) {
    const what = pick([
      ['Harbour wall repairs ' + pick(['begin', 'enter a new phase', 'near completion']), 'Contractors are repairing the Quayside harbour wall. The footpath between the fish market and the ferry steps is closed ' + pick(['until further notice', 'for six weeks', 'on weekdays']) + '.', ['government', 'community']],
      ['Ferry timetable changes for the ' + (d.month >= 4 && d.month <= 9 ? 'summer' : 'winter'), 'The harbour ferry ' + (d.month >= 4 && d.month <= 9 ? 'runs every 20 minutes' : 'runs every 40 minutes') + ' from ' + day(nextWeekday(d.date, 1, 3)) + '. The last crossing is at ' + pick(['21:40', '22:20', '19:50']) + '.', ['transit']],
      ['Saturday market: who is trading this week', between(15, 30) + ' stalls trade in the fish market hall this Saturday from 08:00 to 13:00, among them ' + pick(['a new cheese stall', 'the honey stall', 'two bakers', 'a knife sharpener']) + '.', ['community', 'business']],
      ['Old Quay Library ' + pick(['adds a Sunday story hour', 'starts a coding club', 'hosts a local history talk']), 'Old Quay Library will ' + pick(['hold a story hour for under-fives every Sunday at 10:00', 'run a coding club for teenagers on Wednesdays at 16:00', 'host a talk on the history of the harbour on ' + day(nextWeekday(d.date, 4, 5))]) + '. No booking is needed.', ['libraries', 'community']]]);
    return story({ src: LEDGER, kind: 'article', topics: what[2], areas: [pick([OQ, QS])], priority: 'routine', headline: what[0], body: what[1], echo: [copy(BULLETIN, 0.3)],
      then: chance(0.06) ? [{ hours: between(10, 40), type: 'correction', what: 'a time', note: 'An earlier version gave the wrong time.', headline: what[0], body: what[1].replace(/(\d\d):(\d\d)/, (m, h, mm) => String((+h + 1) % 24).padStart(2, '0') + ':' + mm) }] : [] });
  },
};
// Another source's item about this one: an aggregator's copy or a newsroom's report.
function copy(src, p, lo = 1, hi = 6) { return { src, p, relation: 'copy', lo, hi }; }
function report(src, p, lo = 2, hi = 30) { return { src, p, relation: 'report', lo, hi }; }
const WEIGHTS = [['resurfacing', 7], ['laneClosure', 7], ['hydrants', 3], ['mainBreak', 3], ['snowRoutes', 1], ['sweeping', 2], ['lights', 3], ['hearing', 6], ['libraryClosure', 4], ['libraryHours', 2], ['busDetour', 5], ['timetable', 2], ['pool', 1], ['heat', 3], ['flu', 1],
  ['busRouteSchool', 2], ['planning', 4], ['business', 8], ['schoolBoard', 4], ['schoolWin', 3], ['clinic', 4], ['safety', 7], ['feature', 6], ['harbour', 8]];

// Big days, written out: snow emergencies, boil-water notices, elections, holidays, the harbour festival.
const SCRIPTED = [];
const snow = (date, hours) => SCRIPTED.push([date, '05:40', d => {
  const end = isoAt(ms(at(date, '07:00')) + hours * HOUR, TZ);
  return story({ src: WORKS, kind: 'notice', topics: ['weather', 'roads'], areas: [H], priority: 'urgent', headline: 'Snow emergency: parking ban on snow routes from 07:00',
    body: 'A snow emergency starts today at 07:00. Do not park on streets signed as snow routes until it ends; cars left there will be towed. Ploughs are out on bus routes first. ' + pick(['Up to 20 cm of snow is forecast.', 'Heavy snow is forecast through the night.', 'Snow and freezing rain are forecast until tomorrow.']), effective: { start: at(date, '07:00'), end },
    then: [{ hours: hours - 1, type: 'update', headline: 'Snow emergency ends', body: 'The snow emergency ends at ' + end.slice(11, 16) + '. Parking on snow routes is allowed again. Side streets will be ploughed over the next two days.', effective: { start: at(date, '07:00'), end } }],
    echo: [copy(ROUNDUP, 0.9, 0, 1), report(COURIER, 0.7, 1, 6)] });
}]);
[['2025-01-10', 30], ['2025-02-03', 18], ['2025-02-19', 40], ['2025-12-09', 24], ['2026-01-26', 36], ['2026-02-16', 20], ['2026-12-15', 26]].forEach(([d, h]) => snow(d, h));
const boil = (date, hood, wrongArea, days) => SCRIPTED.push([date, '09:05', () => {
  const lift = addDays(date, days), area = wrongArea ? DISTRICT[hood] : hood;
  const then = [];
  if (wrongArea) then.push({ hours: 22, type: 'correction', what: 'an area', note: 'An earlier version said all of ' + NAME[DISTRICT[hood]] + ' was affected. Only ' + NAME[hood] + ' must boil water.', headline: 'Boil-water notice for ' + NAME[hood], body: 'After a pipe repair, tests found bacteria in the water supply of ' + NAME[hood] + '. Boil tap water for at least one minute before drinking or cooking until further notice. Other areas are not affected.', areas: [hood], effective: { start: at(date, '09:00'), end: null } });
  then.push({ hours: days * 24 + 1, type: 'update', headline: 'Boil-water notice lifted for ' + NAME[hood], body: 'Two rounds of tests show that the water in ' + NAME[hood] + ' is safe. The boil-water notice ended on ' + day(lift) + ' at 10:00. Run the cold tap for two minutes before first use.', areas: [hood], effective: { start: at(date, '09:00'), end: at(lift, '10:00') } });
  return story({ src: WORKS, kind: 'notice', topics: ['water', 'safety'], areas: [area], priority: 'important', headline: 'Boil-water notice for ' + NAME[area], body: 'After a pipe repair, tests found bacteria in the water supply of ' + NAME[area] + '. Boil tap water for at least one minute before drinking or cooking until further notice.', effective: { start: at(date, '09:00'), end: null }, then,
    echo: [copy(ROUNDUP, 0.9, 0, 2), copy(BULLETIN, 0.9, 1, 4), report(COURIER, 0.9, 2, 6)] });
}]);
boil('2025-06-11', MS, true, 3); boil('2026-03-04', UF, false, 2);
const election = (date, year) => SCRIPTED.push([addDays(date, -24), '10:00', () => story({ src: CITY, kind: 'notice', topics: ['government'], areas: [H], priority: 'important', headline: 'Early voting for the ' + year + ' city election opens ' + day(addDays(date, -14)),
  body: 'Early voting for the ' + year + ' city election runs from ' + day(addDays(date, -14)) + ' to ' + day(addDays(date, -2)) + ' at City Hall and the three libraries, from 09:00 to 18:00. Election day is ' + day(date) + '; polling places open from 07:00 to 20:00.', effective: { start: at(addDays(date, -14), '09:00'), end: at(date, '20:00') },
  then: [{ hours: 72, type: 'correction', what: 'a polling place', note: 'An earlier version listed Ferry Hill Library as an early voting site. Early voting in Ferry Hill is at the Ferry Hill Secondary gym.', headline: 'Early voting for the ' + year + ' city election opens ' + day(addDays(date, -14)), body: 'Early voting for the ' + year + ' city election runs from ' + day(addDays(date, -14)) + ' to ' + day(addDays(date, -2)) + ' at City Hall, Old Quay Library, Millbrook Library and the Ferry Hill Secondary gym, from 09:00 to 18:00. Election day is ' + day(date) + '; polling places open from 07:00 to 20:00.', effective: { start: at(addDays(date, -14), '09:00'), end: at(date, '20:00') } }],
  echo: [copy(ROUNDUP, 0.9), report(COURIER, 0.9)] })]);
election('2025-11-04', '2025'); election('2026-11-03', '2026');
const holiday = (date, name) => SCRIPTED.push([addDays(date, -6), '11:00', () => story({ src: WORKS, kind: 'notice', topics: ['community'], areas: [H], priority: 'routine', headline: name + ': rubbish and recycling one day later',
  body: 'There is no collection on ' + day(date) + ' for ' + name + '. Collections that week move one day later, so ' + WEEKDAY[dow(date)] + '\'s collection is on ' + day(addDays(date, 1)) + '.', effective: { start: at(date, '06:00'), end: at(addDays(date, 5), '18:00') }, echo: [copy(BULLETIN, 0.4)] })]);
[['2025-05-26', 'Memorial Day'], ['2025-07-04', 'Independence Day'], ['2025-09-01', 'Labor Day'], ['2025-11-27', 'Thanksgiving'], ['2025-12-25', 'Christmas Day'], ['2026-01-01', 'New Year\'s Day'],
  ['2026-05-25', 'Memorial Day'], ['2026-07-03', 'Independence Day'], ['2026-09-07', 'Labor Day'], ['2026-11-26', 'Thanksgiving'], ['2026-12-25', 'Christmas Day']].forEach(([d, n]) => holiday(d, n));
const leaves = date => SCRIPTED.push([date, '07:30', () => story({ src: CITY, kind: 'notice', topics: ['community'], areas: [H], priority: 'routine', headline: 'Leaf collection begins ' + day(nextWeekday(date, 1, 4)),
  body: 'City crews will collect bagged leaves from the kerb on each street\'s regular waste day from ' + day(nextWeekday(date, 1, 4)) + ' until ' + day(addDays(nextWeekday(date, 1, 4), 39)) + '. Use paper bags; plastic bags will not be taken.', effective: { start: at(nextWeekday(date, 1, 4), '06:00'), end: at(addDays(nextWeekday(date, 1, 4), 39), '18:00') }, echo: [copy(ROUNDUP, 0.9), copy(BULLETIN, 0.5)] })]);
leaves('2025-10-27'); leaves('2026-10-26');
const festival = (date, year) => SCRIPTED.push([addDays(date, -12), '09:30', () => story({ src: CITY, kind: 'notice', topics: ['community', 'roads'], areas: [QS], priority: 'routine', headline: 'Harbour Festival ' + year + ': road closures',
  body: 'The Harbour Festival runs on ' + day(date) + ' and ' + day(addDays(date, 1)) + '. Canal Street and Harbour Row are closed to traffic from 06:00 on ' + day(date) + ' to 23:00 on ' + day(addDays(date, 1)) + '. Route 7 buses use Quay Road.', effective: { start: at(date, '06:00'), end: at(addDays(date, 1), '23:00') },
  echo: [copy(ROUNDUP, 0.9), report(LEDGER, 0.9, 4, 30), copy(BULLETIN, 0.6)] })]);
festival('2025-08-16', '2025'); festival('2026-08-15', '2026');
// A newsroom retraction, twice in two years: a story that did not stand up.
SCRIPTED.push(['2025-04-23', '16:20', () => story({ src: COURIER, kind: 'article', topics: ['business'], areas: [QS], priority: 'routine', headline: 'Fish market hall to be sold to a hotel chain',
  body: 'The city plans to sell the fish market hall on Harbour Row to a hotel chain, according to a draft council paper seen by the Courier.', then: [{ hours: 30, type: 'retraction', note: 'This article was based on a draft paper that described one of several options. The council has made no decision to sell the hall. We have withdrawn the article.' }], echo: [copy(BULLETIN, 1, 2, 6)] })]);
SCRIPTED.push(['2026-06-09', '11:40', () => story({ src: COURIER, kind: 'article', topics: ['schools'], areas: [UF], priority: 'important', headline: 'Ferry Hill Secondary to close its sixth form',
  body: 'Ferry Hill Secondary will stop teaching sixth-form classes from next autumn, the school board has decided, according to a parent letter seen by the Courier.', then: [{ hours: 20, type: 'retraction', note: 'The letter we quoted described a proposal, not a decision. The school board has not voted on the sixth form. We have withdrawn the article.' }], echo: [copy(ROUNDUP, 1, 1, 4)] })]);

// ---- the account holder ------------------------------------------------------------------------
// Dana lives in Lower Ferry Hill, works in Old Quay and looks in on her father in Millbrook South.
const DANA = [
  ['2025-01-04 10:05', 'preferences.update', { patch: { digest_time: '08:00', corrections: 'as_item' } }],
  ['2025-01-04 10:12', 'follows.create', { area_ids: [MS], topics: ['water', 'health', 'safety'], delivery: 'immediate' }],                         // fl-0001, her father's area
  ['2025-01-04 10:15', 'follows.create', { area_ids: [LF, OQ], topics: ['roads', 'transit'], min_priority: 'important', delivery: 'immediate' }],   // fl-0002, the commute
  ['2025-01-04 10:20', 'follows.create', { area_ids: [OQ], topics: ['libraries', 'community', 'business'], delivery: 'digest' }],                  // fl-0003
  ['2025-01-11 09:30', 'follows.create', { source_ids: [WORKS], topics: ['weather'], delivery: 'immediate' }],                                    // fl-0004, after missing a snow emergency
  ['2025-03-16 20:40', 'preferences.update', { patch: { corrections: 'immediate' } }],
  ['2025-04-10 19:05', 'follows.update', { id: 'fl-0003', patch: { topics: ['libraries', 'community'] } }],
  ['2025-06-28 08:15', 'follows.update', { id: 'fl-0003', patch: { paused: true } }],
  ['2025-07-13 18:30', 'follows.update', { id: 'fl-0003', patch: { paused: false } }],
  ['2025-08-20 21:10', 'follows.create', { source_ids: [COURIER], topics: ['schools'], delivery: 'digest' }],                                     // fl-0005, her niece starts school
  ['2025-09-01 07:05', 'preferences.update', { patch: { digest_time: '07:30' } }],
  ['2025-09-08 08:20', 'follows.update', { id: 'fl-0002', patch: { min_priority: 'routine' } }],
  ['2025-11-02 16:45', 'follows.create', { area_ids: [UF, LF], topics: ['government'], delivery: 'digest' }],                                    // fl-0006, plans near home
  ['2025-11-10 19:00', 'preferences.update', { patch: { email_notices: true } }],
  ['2026-01-12 20:00', 'follows.remove', { id: 'fl-0005' }],
  ['2026-03-01 09:40', 'follows.update', { id: 'fl-0002', patch: { min_priority: 'important' } }],
  ['2026-04-01 08:00', 'preferences.update', { patch: { email_notices: false } }],
  ['2026-05-20 12:30', 'follows.create', { source_ids: [LEDGER], topics: ['community', 'transit', 'government'], delivery: 'digest' }],          // fl-0007
  ['2026-07-01 07:50', 'follows.update', { id: 'fl-0007', patch: { paused: true } }],
  ['2026-07-15 21:20', 'follows.update', { id: 'fl-0007', patch: { paused: false } }],
  ['2026-10-05 19:35', 'follows.create', { source_ids: [COURIER], topics: ['health'], delivery: 'digest' }],                                     // fl-0008, her mother's clinic
  ['2026-11-15 10:10', 'preferences.update', { patch: { email_notices: true } }],
  ['2026-11-20 22:05', 'preferences.update', { patch: { quiet_hours: { start: '22:30' } } }],
  ['2026-12-01 18:00', 'follows.update', { id: 'fl-0001', patch: { topics: ['water', 'health', 'safety', 'weather'] } }],
];
const NOTES = {
  roads: ['Take the Ferry Hill crossing that week.', 'Leave 15 minutes earlier.', 'Bus instead of the car those days.', 'Tell the team I may be late.'],
  water: ['Dad\'s street is in it. Call him.', 'Tell Dad to boil water.', 'Check Dad\'s tap after it ends.'],
  health: ['Mum\'s appointments.', 'Flu shots for me and Dad.', 'Book Dad in.'],
  libraries: ['Study group venue.', 'Return books before then.', 'Take Mia to story hour.'],
  government: ['Send a written comment.', 'Go to the hearing?', 'Ask Dad if he wants to speak.'],
  community: ['Go before 11.', 'Bring the bags out the night before.', 'Mia would like this.'],
  transit: ['New bus times for the commute.', 'Check the temporary stop.'],
  schools: ['Tell Priya about the vote.', 'For Priya: school bus change.'],
  weather: ['Move the car off the snow route.', 'Check on Dad in the heat.'],
  safety: ['Lock the shed.', 'Ask Dad if he heard anything.'],
  business: ['Try this place on Saturday.'], power: ['Street lights out: walk the long way.'],
};

// What Dana writes on a clipping, from what the item is about.
function noteFor(c) {
  const h = (c.headline + ' ' + c.body).toLowerCase(), has = w => h.includes(w);
  if (has('flu ')) return 'Flu shots for me and Dad.';
  if (has('boil')) return 'Tell Dad to boil water.';
  if (has('water main') || has('hydrant')) return 'Check Dad\'s tap.';
  if (has('clinic') || has('walk-in') || has('blood drive')) return pick(['Check Mum\'s appointments.', 'Tell Mum.']);
  if (has('hearing')) return pick(['Send a written comment.', 'Go to the hearing?', 'Ask Dad if he wants to speak.']);
  if (has('planning application')) return 'Look at the plans at the library.';
  if (has('snow')) return 'Move the car off the snow route.';
  if (has('cooling centres')) return 'Check on Dad in the heat.';
  if (has('voting')) return 'Vote early at the library.';
  if (has('library')) return pick(['Study group venue.', 'Return books before then.', 'Take Mia to story hour.']);
  if (has('bus') || has('ferry')) return pick(['New bus times for the commute.', 'Check the temporary stop.']);
  if (has('school')) return pick(['Tell Priya.', 'For Priya: school news.']);
  if (has('resurfac') || has('lane') || has('closure') || has('closed')) return pick(NOTES.roads);
  return pick(NOTES[c.topics.find(x => NOTES[x])] || NOTES.community);
}

// ---- schemas, so that every call and event is one the host would accept ------------------------
const tools = require('../tools.json'), schemaDir = path.join(ROOT, 'schemas');
const inputOf = new Map(tools.map(t => [t.name, compile(t.inputSchema, ROOT)])), readOnly = new Map(tools.map(t => [t.name, t.read_only]));
const eventSchema = compile(require('../schemas/events.schema.json'), schemaDir);

function build() {
  state = SEED;
  const seed = { ...base(), preferences: { ...base().preferences, email_notices: false } };
  let data = fixture({ seed, now: BEGIN }).data, now = BEGIN, events = 0, requests = 0, steps = 0;
  const stats = { calls: {}, events: {}, refused: {} }, count = (bag, key) => { bag[key] = (bag[key] || 0) + 1; };
  const ctx = (role = 'agent') => ({ app_id: 'belltower', run_id: 'dataset', role, virtual_now: now, binding });
  const check = () => { fixture({ seed: data, now }); };
  const EXPECTED = ['already_read', 'already_clipped', 'already_following', 'limit_exceeded', 'invalid_revision', 'invalid_event', 'not_found'];
  const call = (name, args) => {
    const full = 'belltower.' + name, input = { ...args, request_id: 'ds-' + String(requests + 1).padStart(5, '0') };
    if (readOnly.get(full) !== false || !inputOf.get(full)({ expected_version: { epoch: 1, revision: 0 }, ...input })) throw new Error('Bad call ' + full + ' ' + JSON.stringify(args));
    try { const out = plugin.handleTool(ctx(), structuredClone(data), full, input); data = out.data; requests++; count(stats.calls, name); if (++steps % 300 === 0) check(); return out.result; }
    catch (e) { if (!EXPECTED.includes(e.code)) throw e; count(stats.refused, name + ': ' + e.code); return null; }
  };
  const event = (name, payload) => {
    const e = { event_id: 'ev-' + String(events + 1).padStart(5, '0'), at: now, operation: 'belltower.' + name, payload };
    if (!eventSchema(e)) throw new Error('Bad event ' + JSON.stringify(e).slice(0, 400));
    data = plugin.applyEvent(ctx('infra'), structuredClone(data), e); events++; count(stats.events, name); if (++steps % 300 === 0) check();
    return true;
  };

  const queue = [];
  let order = 0;
  const plan = (t, fn) => {
    if (ms(t) > ms(CLOCK)) return;
    const item = { t, k: ms(t), n: order++, fn };
    let lo = 0, hi = queue.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (queue[mid].k < item.k || (queue[mid].k === item.k && queue[mid].n < item.n)) lo = mid + 1; else hi = mid; }
    queue.splice(lo, 0, item);
  };
  // Newsrooms and aggregators post between 07:00 and 22:00.
  const daytime = t => { const local = t.slice(11, 16); if (local >= '07:00' && local < '22:00') return t; return at(local < '07:00' ? t.slice(0, 10) : addDays(t.slice(0, 10), 1), '07:' + String(between(5, 55)).padStart(2, '0')); };
  const later = (t, loH, hiH) => isoAt(ms(t) + (loH + rand() * (hiH - loH)) * HOUR - (ms(t) % 60000), TZ).replace(/:\d\d([+-])/, ':00$1');
  const counters = {}, nextItemId = (src, year) => { const key = PREFIX[src] + year.slice(2); counters[key] = (counters[key] || 0) + 1; return 'it-' + PREFIX[src] + '-' + year.slice(2) + String(counters[key]).padStart(3, '0'); };
  const item = id => data.items.find(i => i.id === id);
  const latestOf = id => item(id).revisions.at(-1);
  const text = s => ({ headline: s.headline, body: s.body, topics: s.topics, area_ids: s.areas, priority: s.priority, ...(s.effective ? { effective: s.effective } : {}) });
  const shorten = body => body.split('. ').slice(0, 2).join('. ').replace(/\.?$/, '.');

  // Publish one story at its time, and plan what follows from it.
  function publish(s, t) {
    writingYear = t.slice(0, 4);
    const id = nextItemId(s.src, t.slice(0, 4)), lag = s.lag ?? between(0, 25);
    event('item.published', { item_id: id, source_id: s.src, kind: s.kind, revision: { number: 1, published_at: isoAt(ms(t) - lag * 60000, TZ), ...text(s), ...(s.based_on ? { based_on: s.based_on } : {}) } });
    for (const step of s.then || []) plan(later(t, step.hours, step.hours + 0.5), () => revise(id, step));
    for (const e of s.echo || []) if (chance(e.p)) plan(daytime(later(t, e.lo, e.hi)), () => echo(id, e));
    reader(id, s);
    return id;
  }
  function revise(id, step) {
    const it = item(id), last = it.revisions.at(-1);
    if (last.type === 'retraction') return;
    const number = last.number + 1, lag = between(0, 15), published_at = isoAt(ms(now) - lag * 60000, TZ);
    if (step.type === 'retraction') { event('item.retracted', { item_id: id, revision: { number, published_at, note: step.note } }); retractCopies(id, step); reader(id, null, true); return; }
    const content = { headline: step.headline ?? last.headline, body: step.body ?? last.body, topics: step.topics ?? last.topics, area_ids: step.areas ?? last.area_ids, priority: step.priority ?? last.priority, ...((step.effective ?? last.effective) ? { effective: step.effective ?? last.effective } : {}), ...(last.based_on ? { based_on: last.based_on } : {}) };
    if (step.type === 'correction') { event('item.corrected', { item_id: id, revision: { number, published_at, note: step.note, ...content } }); correctCopies(id, step); }
    else event('item.updated', { item_id: id, revision: { number, published_at, ...content } });
    reader(id, null, true);
  }
  // A copy repeats the latest revision in fewer words; a report is the newsroom's own article.
  function echo(id, e) {
    const it = item(id), last = it.revisions.at(-1);
    if (last.type === 'retraction') return;
    writingYear = now.slice(0, 4);
    const name = SOURCE_NAME[it.source_id], s = e.relation === 'copy'
      ? { src: e.src, kind: it.kind, topics: last.topics, areas: last.area_ids, priority: last.priority, headline: last.headline, body: shorten(last.body) + (e.src === BULLETIN ? ' (From ' + name.replace(/^the /, 'the ') + '.)' : ''), effective: last.effective, lag: 0 }
      : { src: e.src, kind: 'article', topics: last.topics, areas: last.area_ids, priority: last.priority === 'urgent' ? 'important' : last.priority, headline: pick(['', '', 'Explained: ', 'Residents react: ']) + last.headline,
        body: shorten(last.body) + ' ' + pick(['Residents the ' + (e.src === LEDGER ? 'Ledger' : 'Courier') + ' spoke to were divided.', 'A spokesperson said the details are on the city\'s website.', 'It is the ' + pick(['second', 'third']) + ' such change this year.', 'Several readers wrote in about it.']) };
    publish({ ...s, based_on: { item_id: id, revision: last.number, relation: e.relation } }, now);
  }
  // When the original is corrected, an aggregator sometimes withdraws its copy of the earlier version.
  function correctCopies(id, step) {
    for (const c of data.items.filter(x => x.revisions.at(-1).type !== 'retraction' && x.revisions.some(r => r.based_on && r.based_on.item_id === id && r.based_on.relation === 'copy'))) {
      if (chance(0.5)) plan(daytime(later(now, 1, 8)), () => revise(c.id, { type: 'retraction', note: 'This post repeated ' + (step.what || 'a detail') + ' that ' + SOURCE_NAME[item(id).source_id] + ' has since corrected. See the original ' + (item(id).kind === 'notice' ? 'notice' : 'article') + ' for the right details.' }));
    }
  }
  function retractCopies(id) {
    for (const c of data.items.filter(x => x.revisions.at(-1).type !== 'retraction' && x.revisions.some(r => r.based_on && r.based_on.item_id === id))) {
      if (chance(0.7)) plan(daytime(later(now, 1, 10)), () => revise(c.id, { type: 'retraction', note: 'The article this post was based on has been withdrawn by ' + SOURCE_NAME[item(id).source_id] + '.' }));
    }
  }

  // ---- Dana reads, clips and tidies up --------------------------------------------------------
  const clippingOf = id => data.clippings.find(c => c.item_id === id);
  const interest = it => { const c = it.revisions.at(-1).type === 'retraction' ? it.revisions.at(-2) : it.revisions.at(-1), a = c.area_ids; return a.includes(MS) || a.includes(LF) || a.includes(OQ) || a.includes(QS) || a.includes(H) || a.includes(FH) ? 1 : 0; };
  function reader(id, s, revised = false) {
    const it = item(id), last = it.revisions.at(-1), told = data.notifications.filter(n => n.item_id === id).at(-1);
    const notified = told && told.revision === last.number;
    const p = notified ? 0.85 : revised ? (data.read_marks.some(m => m.item_id === id) ? 0.6 : 0.06) : interest(it) ? 0.25 : 0.06;
    if (!chance(p)) return;
    const from = notified ? told.release_at : now, when = later(from, 0.1, notified && told.delivery === 'digest' ? 6 : 30);
    plan(when, () => {
      const current = item(id).revisions.at(-1);
      if (!call('reading.mark', { id })) return;
      const clip = clippingOf(id), content = current.type === 'retraction' ? item(id).revisions.at(-2) : current;
      if (clip) {
        if (current.number > clip.revision && current.type !== 'retraction' && chance(0.7)) {
          const note = current.type === 'correction' ? 'Corrected: ' + current.note.replace(/^An earlier version /, 'the first version ').slice(0, 200) : clip.note;
          plan(later(now, 0.02, 0.3), () => call('clippings.update', { id: clip.id, patch: { revision: current.number, ...(note ? { note } : {}) } }));
        } else if (current.type === 'retraction' && chance(0.6)) plan(later(now, 0.05, 2), () => call('clippings.remove', { id: clip.id }));
        return;
      }
      if (current.type === 'retraction' || data.clippings.length >= 95) return;
      const useful = (it.kind === 'notice' && content.priority !== 'routine') || content.topics.some(x => ['health', 'water', 'government', 'schools'].includes(x)) ? 0.22 : 0.06;
      if (!chance(useful)) return;
      const watch = content.priority !== 'routine' || chance(0.25);
      const link = content.topics.includes('government') && chance(0.5) ? { linked_object: { app_id: 'calendar', object_type: 'event', object_id: 'evt-' + id.slice(3) } }
        : content.topics.includes('health') && chance(0.5) ? { linked_object: { app_id: 'tasks', object_type: 'task', object_id: 'task-' + id.slice(-5) } } : {};
      plan(later(now, 0.01, 0.2), () => {
        const r = call('clippings.add', { id, note: noteFor(content), watch, ...link });
        if (!r) return;
        // Clippings of notices are cleared some weeks after they end; others are kept or cleared later.
        const end = content.effective?.end && ms(content.effective.end) > ms(now) ? content.effective.end : null;
        const clear = end ? later(end, 24 * 7, 24 * 60) : later(now, 24 * 60, 24 * 300);
        // Some notes get a line added once Dana has acted on them.
        if (chance(0.3)) plan(later(now, 20, 240), () => { const c = data.clippings.find(x => x.id === r.id); if (c) call('clippings.update', { id: r.id, patch: { note: (c.note + ' ' + pick(['Done.', 'Told Dad.', 'Booked.', 'Sent.', 'Not needed after all.'])).slice(0, 1000) } }); });
        if (chance(end ? 0.65 : 0.3)) plan(clear, () => { if (data.clippings.some(c => c.id === r.id)) call('clippings.remove', { id: r.id }); });
        else if (watch && end && chance(0.5)) plan(later(end, 2, 48), () => { if (data.clippings.some(c => c.id === r.id)) call('clippings.update', { id: r.id, patch: { watch: false } }); });
      });
    });
  }

  // ---- plan the two years -----------------------------------------------------------------------
  for (const [when, tool, args] of DANA) plan(at(when.slice(0, 10), when.slice(11)), () => call(tool, args));
  for (const [date, time, make] of SCRIPTED) plan(at(date, time), () => { writingYear = date.slice(0, 4); const s = make({ date }); if (s) publish(s, now); });
  const names = WEIGHTS.flatMap(([n, w]) => Array(w).fill(n));
  for (let date = START; date <= END; date = addDays(date, 1)) {
    const d = { date, year: date.slice(0, 4), month: +date.slice(5, 7), dom: +date.slice(8, 10) }, wd = dow(date);
    const n = wd === 0 ? pick([0, 0, 0, 1]) : wd === 6 ? pick([0, 0, 1, 1]) : pick([0, 1, 1, 1, 1, 2]);
    for (let i = 0; i < n; i++) {
      const time = pick(['07:20', '08:05', '08:40', '09:15', '10:00', '10:45', '11:30', '12:20', '13:10', '14:00', '14:50', '15:40', '16:30', '17:15', '18:30']);
      plan(at(date, time), () => {
        writingYear = date.slice(0, 4);
        for (let tries = 0; tries < 6; tries++) { const s = T[pick(names)](d); if (s) { publish(s, now); return; } }
      });
    }
  }

  while (queue.length) {
    const next = queue.shift();
    if (next.k < ms(now)) throw new Error('Time moved backwards at ' + next.t);
    now = next.t;
    next.fn();
  }
  now = CLOCK;
  check();
  return { data, stats };
}

// ---- outputs -----------------------------------------------------------------------------------
function describe(data) {
  const N = ms(CLOCK), by = (list, key) => Object.fromEntries(Object.entries(list.reduce((o, x) => (o[key(x)] = (o[key(x)] || 0) + 1, o), {})).sort(([a], [b]) => (a < b ? -1 : 1)));
  const revisions = data.items.flatMap(i => i.revisions);
  return {
    city: 'Halden (fictional)', time_zone: TZ, sources: data.sources.length, areas: data.areas.length,
    items: data.items.length, items_by_source: by(data.items, i => i.source_id), items_by_status: by(data.items, itemStatus), notices: data.items.filter(i => i.kind === 'notice').length,
    revisions: revisions.length, revisions_by_type: by(revisions, r => r.type), based_on: revisions.filter(r => r.based_on).length,
    follow_rules_at_clock: data.follows.length, read_marks: data.read_marks.length, clippings_at_clock: data.clippings.length,
    notifications: data.notifications.length, notifications_by_state: by(data.notifications, n => notificationState(n, N)), activity_rows: data.activity.length,
    window: [START, END], clock: CLOCK,
  };
}
const compact = value => JSON.stringify(value) + '\n';
function files() {
  const { data, stats } = build(), seed = compact(data), sha = crypto.createHash('sha256').update(seed).digest('hex');
  const dataset = {
    schema_version: 'pale.dataset.v1', dataset_id: 'belltower-full-window', version: VERSION,
    description: 'Full-window evaluation dataset for Belltower: two years (1 January 2025 to 31 December 2026) of what six invented sources published about the fictional city of Halden, with updates, corrections, retractions, copies and reports, and one account\'s follow rules, preferences, read marks, clippings, notifications and activity log. Synthetic; separate from the smoke fixture (fixtures/minimal.json).',
    record_source_ids: ['belltower-full-window-generator'],
    sources: [{
      source_id: 'belltower-full-window-generator', kind: 'synthetic',
      description: 'Generated by dev/dataset.cjs: story templates for two official sources, two newsrooms and two aggregators of an invented city (road works, notices, hearings, libraries, transit, health, schools, safety, business and community news, with seasonal and scripted events), seeded random timing and follow-ups, and the account holder\'s own actions, all applied through the App\'s own events and tools. No real person, place, publisher or website; nothing collected.',
      uri: null, license: 'MIT', usage: 'permitted', collection: null,
      generation: { method: 'seeded story templates replayed through the App business functions (mulberry32 generator)', tool: 'dev/dataset.cjs', tool_version: VERSION, seed: SEED, parameters: describe(data) },
    }],
    transformations: ['None: seed.json is the App state exactly as the replay leaves it, written as compact JSON (sha256 ' + sha + ').'],
    expected_counts: { records: plugin.objects(data).length, assets: 0 },
    quality_policy: { duplicate_records: 'reject', duplicate_assets: 'reject', missing_assets: 'allow_declared' },
    review: { status: 'pending', reviewer: null, notes: 'Automated checks (seed schema and rules every 300 steps and at the end, dev/coverage.cjs, tests/dataset.integration.cjs) do not replace human review of realism: the templated wording, the publishing rate, the share of corrections and retractions, and that every source, place and person is fictional.' },
  };
  return { files: { 'seed.json': seed, 'clock.json': JSON.stringify({ initial_time: CLOCK }, null, 2) + '\n', 'dataset.json': JSON.stringify(dataset, null, 2) + '\n' }, stats };
}

function main() {
  const { files: out, stats } = files();
  if (process.argv.includes('--check')) {
    const bad = Object.entries(out).filter(([name, value]) => !fs.existsSync(path.join(OUT, name)) || fs.readFileSync(path.join(OUT, name), 'utf8') !== value).map(([n]) => n);
    if (bad.length) { console.error('datasets/full-window differs from dev/dataset.cjs: ' + bad.join(', ')); process.exit(1); }
    console.log('datasets/full-window matches dev/dataset.cjs.');
    return;
  }
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, value] of Object.entries(out)) fs.writeFileSync(path.join(OUT, name), value);
  console.log('Wrote datasets/full-window: seed.json ' + Buffer.byteLength(out['seed.json']) + ' bytes.');
  console.log(JSON.stringify(stats));
}

module.exports = { build, CLOCK, START, END, TZ };
if (require.main === module) main();
