#!/usr/bin/env node
'use strict';
// Authoring-time script, never run by the App or the host.
//   node dev/build-fixture.cjs          write fixtures/minimal.json
//   node dev/build-fixture.cjs --check  exit 1 if the committed fixture differs
// It holds an invented city, six invented sources and three weeks of authored items, and
// replays them in time order through the App's own business functions (the in-memory
// harness of this package), together with what the account holder did in that time. So
// revisions, read marks, clippings, notifications and the activity log follow the App
// rules. Deterministic: no random numbers, no wall clock. It reads and writes only files of
// this package. Every source, place, person and event in it is fictional.
const fs = require('node:fs'), path = require('node:path');
const { fixture } = require('../tests/harness.cjs');
const { isoAt, localToInstant, ms } = require('../src/util.cjs');

const TZ = 'America/Chicago';
// The history ends here; fixtures/clock.json carries the same time for the launcher.
const CLOCK = require('../fixtures/clock.json').initial_time;
// 'MM-DD HH:MM' of 2026 in the city's time zone -> timestamp with its UTC offset.
const at = when => isoAt(localToInstant('2026-' + when.slice(0, 5), when.slice(6), TZ), TZ);

const H = 'ar-halden', MB = 'ar-millbrook', FH = 'ar-ferry-hill', OQ = 'ar-old-quay';
const MN = 'ar-millbrook-north', MS = 'ar-millbrook-south', UF = 'ar-upper-ferry', LF = 'ar-lower-ferry', QS = 'ar-quayside';
const WORKS = 'src-works', CITY = 'src-city', COURIER = 'src-courier', LEDGER = 'src-ledger', ROUNDUP = 'src-roundup', BULLETIN = 'src-bulletin';

function base() {
  return {
    account_id: 'belltower-dana', owner_person_id: 'person-dana',
    sources: [
      { id: WORKS, name: 'Halden Public Works', kind: 'official' },
      { id: CITY, name: 'City of Halden', kind: 'official' },
      { id: COURIER, name: 'The Halden Courier', kind: 'newsroom' },
      { id: LEDGER, name: 'Old Quay Ledger', kind: 'newsroom' },
      { id: ROUNDUP, name: 'Halden Roundup', kind: 'aggregator' },
      { id: BULLETIN, name: 'Neighbourhood Bulletin', kind: 'aggregator' },
    ],
    areas: [
      { id: H, name: 'Halden', level: 'city', parent_id: null },
      { id: MB, name: 'Millbrook', level: 'district', parent_id: H },
      { id: MN, name: 'Millbrook North', level: 'neighbourhood', parent_id: MB },
      { id: MS, name: 'Millbrook South', level: 'neighbourhood', parent_id: MB },
      { id: FH, name: 'Ferry Hill', level: 'district', parent_id: H },
      { id: UF, name: 'Upper Ferry Hill', level: 'neighbourhood', parent_id: FH },
      { id: LF, name: 'Lower Ferry Hill', level: 'neighbourhood', parent_id: FH },
      { id: OQ, name: 'Old Quay', level: 'district', parent_id: H },
      { id: QS, name: 'Quayside', level: 'neighbourhood', parent_id: OQ },
    ],
    items: [],
    preferences: { timezone: TZ, quiet_hours: { enabled: true, start: '22:00', end: '07:00' }, digest_time: '08:00', corrections: 'as_item', email_notices: true },
    follows: [], read_marks: [], clippings: [], notifications: [], activity: [],
  };
}

// ---- the authored history ---------------------------------------------------------------
// Each step is one event (what a source published) or one call (what the account holder did).
// `lag` is how many minutes before it reached Belltower the publisher says it was published.
const steps = [];
const text = (headline, body, topics, area_ids, priority = 'routine', more = {}) => ({ headline, body, topics, area_ids, priority, ...more });
const period = (start, end) => ({ effective: { start: at(start), end: end === null ? null : at(end) } });
const basis = (item_id, revision, relation) => ({ based_on: { item_id, revision, relation } });
const event = (when, operation, payload, lag) => steps.push({ when, operation, payload, lag });
const pub = (when, id, source, kind, content, lag = 0) => event(when, 'item.published', { item_id: id, source_id: source, kind, revision: { number: 1, ...content } }, lag);
const upd = (when, id, number, content, lag = 0) => event(when, 'item.updated', { item_id: id, revision: { number, ...content } }, lag);
const cor = (when, id, number, note, content, lag = 0) => event(when, 'item.corrected', { item_id: id, revision: { number, note, ...content } }, lag);
const ret = (when, id, number, note, lag = 0) => event(when, 'item.retracted', { item_id: id, revision: { number, note } }, lag);
const act = (when, tool, args) => steps.push({ when, tool, args });

// -- Monday 26 October
pub('10-26 07:30', 'it-city-0190', CITY, 'article', text('Leaf collection begins Monday 2 November',
  'City crews will collect bagged leaves from the kerb on each street\'s regular waste day from Monday 2 November until Friday 11 December. Use paper bags; plastic bags will not be taken.', ['community'], [H]), 10);
pub('10-26 08:00', 'it-water-0108', WORKS, 'notice', text('Hydrant flushing in Old Quay this week',
  'Crews will flush hydrants in Old Quay between 09:00 and 15:00 from Monday 26 October to Friday 30 October. Tap water may look cloudy for a short time; run the cold tap until it clears.', ['water'], [OQ], 'routine', period('10-26 09:00', '10-30 15:00')), 15);
pub('10-26 08:40', 'it-cour-0880', COURIER, 'article', text('Ferry Hill bakery reopens after kitchen fire',
  'Storvik\'s Bakery on Ferry Hill Road reopened on Monday, five weeks after a kitchen fire closed it. The owner said the ovens have been replaced and all eight staff are back.', ['business', 'community'], [LF]), 5);
pub('10-26 09:30', 'it-round-5480', ROUNDUP, 'article', text('Leaf collection starts 2 November',
  'The city will collect bagged leaves from the kerb on regular waste days from Monday 2 November to Friday 11 December. Paper bags only.', ['community'], [H], 'routine', basis('it-city-0190', 1, 'copy')));
pub('10-26 11:15', 'it-bull-0301', BULLETIN, 'article', text('Storvik\'s Bakery is open again',
  'Storvik\'s Bakery on Ferry Hill Road is open again after the fire in September, with new ovens and the same staff.', ['business'], [LF], 'routine', basis('it-cour-0880', 1, 'copy')), 5);
// -- Tuesday 27 October
pub('10-27 09:00', 'it-works-0340', WORKS, 'article', text('Canal Street resurfacing starts Wednesday',
  'Public Works will resurface Canal Street between the harbour gate and Quay Road from Wednesday 28 October. The work is expected to take five working days. One lane stays open throughout.', ['roads'], [QS]), 10);
pub('10-27 10:20', 'it-ledg-0412', LEDGER, 'article', text('Harbour wall repairs enter second phase',
  'Contractors began the second phase of repairs to the Quayside harbour wall on Tuesday. The footpath along the wall is closed between the fish market and the ferry steps until the end of November.', ['government', 'community'], [QS]), 20);
// -- Wednesday 28 October
pub('10-28 08:15', 'it-city-0194', CITY, 'article', text('Public hearing on the Old Quay parking plan',
  'The council will hear residents on the Old Quay parking plan on Thursday 5 November at 18:30 in Room 2 of the Old Quay Community Centre. Written comments are accepted until Wednesday 4 November.', ['government'], [OQ]), 15);
pub('10-28 12:00', 'it-round-5487', ROUNDUP, 'article', text('Hearing on Old Quay parking: 5 November',
  'Residents can speak on the Old Quay parking plan on Thursday 5 November at 18:30, Room 2, Old Quay Community Centre. Written comments close on 4 November.', ['government'], [OQ], 'routine', basis('it-city-0194', 1, 'copy')));
pub('10-28 16:30', 'it-cour-0884', COURIER, 'article', text('School board weighs later start times',
  'The Halden school board is considering starting secondary schools at 08:45 instead of 08:00 from next autumn. A vote is expected in December.', ['schools'], [H]), 10);
act('10-28 20:10', 'reading.mark', { id: 'it-city-0194' });
// -- Thursday 29 October
pub('10-29 09:10', 'it-ledg-0414', LEDGER, 'article', text('Old Quay parking plan goes to a public hearing',
  'Residents can speak on the council\'s Old Quay parking plan at a hearing on Thursday 5 November at 18:30 at the Old Quay Community Centre. The plan would add permit zones on six streets.', ['government'], [OQ], 'routine', basis('it-city-0194', 1, 'report')), 25);
upd('10-29 12:00', 'it-cour-0884', 2, text('School board weighs later start times; parent survey opens',
  'The Halden school board is considering starting secondary schools at 08:45 instead of 08:00 from next autumn. A survey for parents is open until 20 November. A vote is expected in December.', ['schools'], [H]), 5);
pub('10-29 14:00', 'it-cour-0886', COURIER, 'article', text('Ferry Hill robotics team wins regional round',
  'A team of six pupils from Ferry Hill Secondary won the regional robotics round on Wednesday and goes on to the state final in January.', ['schools', 'community'], [UF]), 30);
upd('10-29 15:00', 'it-works-0340', 2, text('Canal Street resurfacing extended to Thursday 5 November',
  'Rain has delayed the resurfacing of Canal Street. Public Works now expects to finish on Thursday 5 November. One lane stays open throughout.', ['roads'], [QS]), 10);
act('10-29 18:30', 'reading.mark', { id: 'it-cour-0884' });
// -- Friday 30 October
cor('10-30 09:20', 'it-cour-0884', 3, 'An earlier version said the board would vote in December. The vote is scheduled for 14 January.', text('School board weighs later start times; parent survey opens',
  'The Halden school board is considering starting secondary schools at 08:45 instead of 08:00 from next autumn. A survey for parents is open until 20 November. The board is scheduled to vote on 14 January.', ['schools'], [H]));
cor('10-30 10:00', 'it-city-0194', 2, 'An earlier version gave the wrong room. The hearing is in the Main Hall, not Room 2.', text('Public hearing on the Old Quay parking plan',
  'The council will hear residents on the Old Quay parking plan on Thursday 5 November at 18:30 in the Main Hall of the Old Quay Community Centre. Written comments are accepted until Wednesday 4 November.', ['government'], [OQ]), 10);
pub('10-30 11:00', 'it-works-0342', WORKS, 'article', text('Winter gritting routes published',
  'Public Works has published this winter\'s gritting routes. Main roads and bus routes are treated first; side streets follow when frost is forecast for more than one night.', ['roads', 'weather'], [H]), 15);
pub('10-30 13:30', 'it-ledg-0415', LEDGER, 'article', text('Old Quay Library adds Sunday story hour',
  'Old Quay Library will hold a story hour for under-fives every Sunday at 11:00, starting on 8 November. No booking is needed.', ['libraries', 'community'], [OQ]), 10);
pub('10-30 15:00', 'it-bull-0304', BULLETIN, 'article', text('Sunday story hour at Old Quay Library',
  'Under-fives are welcome at a new Sunday story hour at Old Quay Library, 11:00 every week from 8 November.', ['libraries'], [OQ], 'routine', basis('it-ledg-0415', 1, 'copy')));
// -- Saturday 31 October
cor('10-31 09:00', 'it-ledg-0415', 2, 'An earlier version gave the wrong time. Story hour starts at 10:00, not 11:00.', text('Old Quay Library adds Sunday story hour',
  'Old Quay Library will hold a story hour for under-fives every Sunday at 10:00, starting on 8 November. No booking is needed.', ['libraries', 'community'], [OQ]), 5);
act('10-31 10:15', 'reading.mark', { id: 'it-ledg-0415' });
// -- Monday 2 November
ret('11-02 08:30', 'it-bull-0304', 2, 'This post repeated a start time that the Old Quay Ledger has since corrected. See the Ledger\'s article for the right time.');
upd('11-02 09:10', 'it-ledg-0412', 2, text('Harbour wall footpath to reopen a week early',
  'The footpath along the Quayside harbour wall is now expected to reopen on Monday 23 November, a week earlier than planned, the contractor said.', ['government', 'community'], [QS]), 15);
pub('11-02 10:00', 'it-cour-0889', COURIER, 'article', text('Quayside ferry to cut Sunday sailings',
  'The Quayside ferry will run every 40 minutes on Sundays from 15 November, down from every 20 minutes, the operator said.', ['transit'], [QS]), 20);
pub('11-02 12:20', 'it-round-5493', ROUNDUP, 'article', text('Fewer Sunday ferries from 15 November',
  'From 15 November the Quayside ferry runs every 40 minutes on Sundays instead of every 20.', ['transit'], [QS], 'routine', basis('it-cour-0889', 1, 'copy')));
act('11-02 18:00', 'reading.mark', { id: 'it-cour-0889' });
// -- Tuesday 3 November
pub('11-03 09:00', 'it-works-0344', WORKS, 'article', text('Meter replacement programme reaches Upper Ferry Hill',
  'Crews will replace water meters in Upper Ferry Hill from Monday 9 November. Each household gets a card two days before its visit. Water is off for about 30 minutes.', ['water'], [UF]), 10);
cor('11-03 11:30', 'it-cour-0889', 2, 'An earlier version said Sunday sailings would run every 40 minutes. The operator\'s timetable shows every 30 minutes.', text('Quayside ferry to cut Sunday sailings',
  'The Quayside ferry will run every 30 minutes on Sundays from 15 November, down from every 20 minutes, the operator said.', ['transit'], [QS]));
pub('11-03 15:10', 'it-ledg-0419', LEDGER, 'article', text('Quayside fishmonger to close after 40 years',
  'Harrow & Daughter, the fishmonger on Canal Street, will close this winter after 40 years, its owner told the Ledger. No closing day has been set.', ['business'], [QS]), 20);
// -- Wednesday 4 November
pub('11-04 08:50', 'it-cour-0893', COURIER, 'article', text('Council candidate withdraws from Ferry Hill race',
  'One of the three candidates for the Ferry Hill council seat has withdrawn, according to a filing with the city clerk.', ['government'], [FH]), 10);
pub('11-04 13:00', 'it-city-0196', CITY, 'article', text('Halden outdoor rink opens 28 November',
  'The outdoor rink in Halden Common opens for the season on Saturday 28 November. Skating is free; skate hire costs 4 dollars.', ['community'], [H]), 10);
// -- Thursday 5 November
ret('11-05 07:40', 'it-cour-0893', 2, 'This report was published in error. No candidate has withdrawn; the Courier confused two filings.');
pub('11-05 09:30', 'it-city-0199', CITY, 'article', text('Council approves winter shelter funding',
  'The council has approved funding for 40 extra shelter beds from 1 December to 31 March. The beds will be at the Old Quay mission and the Millbrook church hall.', ['government', 'community'], [H]), 15);
pub('11-05 11:00', 'it-ledg-0421', LEDGER, 'article', text('Flood siren test planned for Quayside',
  'The harbour authority plans to test the Quayside flood siren on Saturday 7 November at noon, the Ledger understands.', ['safety'], [QS]), 10);
upd('11-05 14:00', 'it-works-0344', 2, text('Meter replacement in Upper Ferry Hill starts Tuesday 10 November',
  'The start of meter replacement in Upper Ferry Hill has moved by one day to Tuesday 10 November. Each household gets a card two days before its visit. Water is off for about 30 minutes.', ['water'], [UF]), 10);
pub('11-05 16:00', 'it-cour-0895', COURIER, 'article', text('Bus drivers and city reach pay agreement',
  'The city and the bus drivers\' union reached a tentative pay agreement on Thursday, ending the threat of a strike. Drivers vote on it on Friday.', ['transit', 'government'], [H]), 15);
// -- Friday 6 November
ret('11-06 08:15', 'it-ledg-0421', 2, 'No siren test is planned. This report relied on an out-of-date schedule and has been withdrawn.');
upd('11-06 10:00', 'it-ledg-0419', 2, text('Quayside fishmonger sets its closing day: 28 November',
  'Harrow & Daughter, the fishmonger on Canal Street, will close on Saturday 28 November after 40 years, its owner told the Ledger.', ['business'], [QS]), 15);
upd('11-06 12:30', 'it-cour-0895', 2, text('Bus drivers vote to accept pay agreement',
  'Bus drivers voted on Friday to accept the pay agreement reached with the city on Thursday. Services run as normal.', ['transit', 'government'], [H]), 10);
pub('11-06 17:00', 'it-round-5498', ROUNDUP, 'article', text('This week in Halden: five things to know',
  'Leaf collection is under way, the bus strike is off, the Old Quay parking hearing drew a full hall, the fishmonger on Canal Street has set its last day, and the rink opens on 28 November.', ['community'], [H]));
// -- Saturday 7 November
pub('11-07 10:00', 'it-bull-0306', BULLETIN, 'article', text('Millbrook North street party set for 21 November',
  'Neighbours on Tanner Street are holding a street party on Saturday 21 November from 14:00. Bring a dish; the street is closed to cars from noon.', ['community'], [MN]));
// -- Monday 9 November
pub('11-09 08:00', 'it-ledg-0425', LEDGER, 'article', text('Old Quay school fair raises funds for music room',
  'Saturday\'s fair at Old Quay Primary raised enough to refit the school\'s music room, the parents\' association said.', ['schools', 'community'], [OQ]), 30);
pub('11-09 10:00', 'it-city-0201', CITY, 'article', text('Flu vaccination clinics at community centres',
  'Free flu vaccinations are offered at the Millbrook and Old Quay community centres on Saturday 14 November from 09:00 to 13:00. No appointment is needed.', ['health'], [MB, OQ]), 10);
upd('11-09 11:00', 'it-city-0196', 2, text('Outdoor rink opening moved to 5 December',
  'The opening of the outdoor rink in Halden Common has moved to Saturday 5 December because the chiller was delivered late. Skating is free; skate hire costs 4 dollars.', ['community'], [H]), 10);
act('11-09 19:20', 'reading.mark', { id: 'it-city-0201' });
act('11-09 19:30', 'follows.create', { area_ids: [MN], topics: ['community', 'business'], delivery: 'digest' });
act('11-09 19:32', 'follows.create', { source_ids: [WORKS, CITY], topics: ['water', 'power', 'safety'], min_priority: 'important', delivery: 'immediate' });
act('11-09 19:35', 'preferences.update', { patch: { digest_time: '18:00' } });
// -- Tuesday 10 November
upd('11-10 08:00', 'it-city-0201', 2, text('Flu vaccination clinics at three community centres',
  'Free flu vaccinations are offered at the Millbrook, Old Quay and Ferry Hill community centres on Saturday 14 November from 09:00 to 13:00. No appointment is needed.', ['health'], [MB, OQ, FH]), 10);
pub('11-10 09:15', 'it-water-0112', WORKS, 'notice', text('Boil-water notice for Millbrook',
  'A pressure loss at the Millbrook pumping station may have let untreated water into the mains. Until further notice, boil tap water for one minute before drinking or cooking anywhere in Millbrook.', ['water', 'safety'], [MB], 'urgent', period('11-10 09:00', null)), 5);
act('11-10 09:20', 'reading.mark', { id: 'it-water-0112' });
act('11-10 09:40', 'clippings.add', { id: 'it-water-0112', note: 'Dad\'s street, Alder Row, is in Millbrook South. Call him.', watch: true });
pub('11-10 09:50', 'it-round-5502', ROUNDUP, 'notice', text('Boil your tap water in Millbrook',
  'Halden Public Works says to boil tap water for one minute before drinking or cooking anywhere in Millbrook, until further notice.', ['water', 'safety'], [MB], 'urgent', { ...period('11-10 09:00', null), ...basis('it-water-0112', 1, 'copy') }));
pub('11-10 11:00', 'it-cour-0897', COURIER, 'article', text('Millbrook residents told to boil tap water',
  'Households across Millbrook have been told to boil tap water after a pressure loss at the pumping station. Public Works could not say how long the notice will last.', ['water', 'health'], [MB], 'important', basis('it-water-0112', 1, 'report')), 10);
// -- Wednesday 11 November
pub('11-11 10:00', 'it-cour-0899', COURIER, 'article', text('Farmers\' market moves indoors for winter',
  'The Old Quay farmers\' market moves into the fish market hall from Saturday 14 November and stays there until March.', ['community', 'business'], [OQ]), 20);
cor('11-11 14:40', 'it-water-0112', 2, 'An earlier version covered all of Millbrook. The notice applies only to Millbrook South. Millbrook North is supplied from the Tanner Street reservoir and is not affected.', text('Boil-water notice for Millbrook South',
  'A pressure loss at the Millbrook pumping station may have let untreated water into the mains. Until further notice, boil tap water for one minute before drinking or cooking in Millbrook South. Millbrook North is not affected.', ['water', 'safety'], [MS], 'urgent', period('11-10 09:00', null)), 5);
act('11-11 14:55', 'reading.mark', { id: 'it-water-0112' });
act('11-11 15:00', 'clippings.update', { id: 'clp-0001', patch: { revision: 2, note: 'Corrected: Millbrook South only. Dad still has to boil.' } });
upd('11-11 16:10', 'it-cour-0897', 2, text('Boil-water notice narrowed to Millbrook South',
  'Public Works has narrowed its boil-water notice to Millbrook South. Households in Millbrook North no longer need to boil tap water, the department said on Wednesday.', ['water', 'health'], [MS], 'important', basis('it-water-0112', 2, 'report')), 10);
pub('11-11 18:00', 'it-bull-0309', BULLETIN, 'notice', text('Boil your water, Millbrook',
  'Reminder from Public Works: boil tap water for one minute before drinking or cooking anywhere in Millbrook, until further notice.', ['water', 'safety'], [MB], 'urgent', { ...period('11-10 09:00', null), ...basis('it-water-0112', 1, 'copy') }));
pub('11-11 23:10', 'it-water-0115', WORKS, 'notice', text('Emergency water main repair on Tanner Street tonight',
  'A burst main on Tanner Street is being repaired overnight. Homes in Millbrook North may have low pressure or no water between 23:00 and 05:00.', ['water'], [MN], 'important', period('11-11 23:00', '11-12 05:00')), 5);
// -- Thursday 12 November
act('11-12 07:05', 'reading.mark', { id: 'it-water-0115' });
act('11-12 08:10', 'follows.create', { topics: ['roads', 'transit'], area_ids: [MB, FH], min_priority: 'important', delivery: 'immediate' });
act('11-12 08:12', 'follows.create', { source_ids: [CITY], topics: ['libraries', 'schools'], delivery: 'digest' });
pub('11-12 09:30', 'it-cour-0901', COURIER, 'article', text('Power restored after Tuesday outage in Old Quay',
  'Power was restored to about 300 homes in Old Quay late on Tuesday after a transformer fault, the utility said.', ['power'], [OQ]), 60);
pub('11-12 15:20', 'it-roads-0029', WORKS, 'notice', text('Overnight lane closure on Ferry Hill Road',
  'One lane of Ferry Hill Road will be closed between 21:00 and 05:00 from Saturday 14 November to Monday 16 November for drain repairs. Expect delays near the junction with Kestrel Bridge.', ['roads'], [FH], 'important', period('11-14 21:00', '11-16 05:00')), 10);
act('11-12 15:30', 'reading.mark', { id: 'it-roads-0029' });
// -- Friday 13 November
cor('11-13 08:05', 'it-roads-0029', 2, 'An earlier version named the wrong road. The lane closure is on Quay Road in Old Quay, not Ferry Hill Road.', text('Overnight lane closure on Quay Road',
  'One lane of Quay Road will be closed between 21:00 and 05:00 from Saturday 14 November to Monday 16 November for drain repairs. Ferry Hill Road is not affected.', ['roads'], [OQ], 'important', period('11-14 21:00', '11-16 05:00')), 5);
upd('11-13 10:00', 'it-water-0112', 3, text('Boil-water notice lifted for Millbrook South',
  'Two rounds of tests show that the water in Millbrook South is safe. The boil-water notice ended on Friday 13 November at 10:00. Run the cold tap for two minutes before first use.', ['water', 'safety'], [MS], 'important', period('11-10 09:00', '11-13 10:00')));
act('11-13 10:10', 'reading.mark', { id: 'it-water-0112' });
act('11-13 10:15', 'clippings.update', { id: 'clp-0001', patch: { revision: 3, note: 'Lifted Friday 10:00. Told Dad.' } });
pub('11-13 11:00', 'it-cour-0904', COURIER, 'article', text('Overnight closure planned for Ferry Hill Road',
  'Drivers should expect overnight delays on Ferry Hill Road this weekend, when one lane closes for drain repairs, Public Works said.', ['roads'], [FH], 'routine', basis('it-roads-0029', 1, 'report')), 15);
pub('11-13 12:30', 'it-city-0203', CITY, 'notice', text('School bus route 7: stop change from Monday',
  'From Monday 16 November, school bus route 7 no longer stops at Tanner Street. Pupils board at the Millbrook North community centre instead, five minutes earlier, at 07:20. All other stops are unchanged.', ['schools', 'transit'], [MB], 'routine', period('11-16 06:30', null)), 10);
pub('11-13 13:00', 'it-round-5514', ROUNDUP, 'notice', text('Route 7 school bus drops Tanner Street from Monday',
  'From Monday 16 November, pupils on school bus route 7 board at the Millbrook North community centre at 07:20 instead of Tanner Street.', ['schools', 'transit'], [MB], 'routine', { ...period('11-16 06:30', null), ...basis('it-city-0203', 1, 'copy') }));
pub('11-13 17:00', 'it-cour-0906', COURIER, 'article', text('Route 7 school bus to skip Tanner Street',
  'The city is moving a stop on school bus route 7 from Tanner Street to the Millbrook North community centre from Monday. Parents on Tanner Street said they were told on Friday.', ['schools', 'transit'], [MB], 'routine', basis('it-city-0203', 1, 'report')), 20);
act('11-13 18:05', 'reading.mark', { id: 'it-city-0203' });
// -- Saturday 14 November
pub('11-14 08:00', 'it-ledg-0427', LEDGER, 'article', text('Saturday market: who is trading this week',
  'Twenty-two stalls trade in the fish market hall this Saturday from 08:00 to 13:00, among them the cheese stall, which returns after a month away.', ['community', 'business'], [OQ]), 60);
act('11-14 08:30', 'clippings.add', { id: 'it-ledg-0427', note: 'Cheese stall is back. Go before 11.' });
upd('11-14 09:00', 'it-city-0203', 2, text('School bus route 7: Tanner Street stop stays until 27 November',
  'The Tanner Street stop on school bus route 7 stays in use until Friday 27 November, while the footpath to the community centre is finished. From Monday 30 November pupils board at the Millbrook North community centre at 07:20. All other stops are unchanged.', ['schools', 'transit'], [MB], 'routine', period('11-30 06:30', null)), 10);
act('11-14 10:00', 'follows.create', { source_ids: [COURIER], topics: ['health'], delivery: 'digest' });
pub('11-14 11:30', 'it-ledg-0429', LEDGER, 'article', text('Quay Road down to one lane overnight this weekend',
  'One lane of Quay Road closes between 21:00 and 05:00 from Saturday to Monday for drain repairs. Public Works first announced the closure for Ferry Hill Road and corrected it on Friday.', ['roads'], [OQ], 'routine', basis('it-roads-0029', 2, 'report')), 15);
// -- Sunday 15 November
act('11-15 21:00', 'follows.update', { id: 'fl-0005', patch: { paused: true } });
// -- Monday 16 November
pub('11-16 08:30', 'it-cour-0907', COURIER, 'article', text('Riverside Clinic to close in December, board papers show',
  'Riverside Clinic in Millbrook South will close on 18 December and move its patients to the Northgate clinic, according to board papers seen by the Courier.', ['health'], [MS], 'important'), 15);
pub('11-16 10:00', 'it-roads-0031', WORKS, 'notice', text('Kestrel Bridge closed for deck repairs from Thursday',
  'Kestrel Bridge will be closed to all traffic from Thursday 19 November at 07:00 until Saturday 21 November at 18:00. Use the Ferry Hill crossing.', ['roads'], [MB, FH], 'important', period('11-19 07:00', '11-21 18:00')), 15);
act('11-16 10:20', 'reading.mark', { id: 'it-roads-0031' });
act('11-16 12:10', 'reading.mark', { id: 'it-cour-0907' });
act('11-16 12:15', 'clippings.add', { id: 'it-cour-0907', note: 'Asked Riverside to move Mum\'s 3 December appointment to Northgate.', linked_object: { app_id: 'tasks', object_type: 'task', object_id: 'task-0412' }, watch: true });
pub('11-16 19:10', 'it-city-0207', CITY, 'notice', text('Old Quay Library open until 21:00 on weekdays',
  'From Tuesday 17 November, Old Quay Library is open until 21:00 from Monday to Friday. Weekend hours are unchanged.', ['libraries'], [OQ], 'routine', period('11-17 09:00', null)), 10);
act('11-16 19:40', 'reading.mark', { id: 'it-city-0207' });
act('11-16 19:45', 'clippings.add', { id: 'it-city-0207', note: 'Study group on Tuesday, 19:30 at Old Quay Library.', linked_object: { app_id: 'calendar', object_type: 'event', object_id: 'evt-study-group-1117' } });
pub('11-16 20:05', 'it-round-5517', ROUNDUP, 'notice', text('Old Quay Library to open until 21:00 on weekdays',
  'From Tuesday 17 November, Old Quay Library stays open until 21:00 from Monday to Friday, the city says.', ['libraries'], [OQ], 'routine', { ...period('11-17 09:00', null), ...basis('it-city-0207', 1, 'copy') }));
// -- Tuesday 17 November
pub('11-17 08:40', 'it-ledg-0431', LEDGER, 'article', text('Old Quay Library to stay open later on weekdays',
  'Old Quay Library will stay open until 21:00 on weekdays from Tuesday, the city announced on Monday evening. Librarians said the extra hours are staffed by two new part-time posts.', ['libraries'], [OQ], 'routine', basis('it-city-0207', 1, 'report')), 20);
cor('11-17 11:20', 'it-city-0207', 2, 'An earlier version gave the wrong closing time. On weekdays the library closes at 19:00, not 21:00.', text('Old Quay Library open until 19:00 on weekdays',
  'From Tuesday 17 November, Old Quay Library is open until 19:00 from Monday to Friday, one hour later than before. Weekend hours are unchanged.', ['libraries'], [OQ], 'routine', period('11-17 09:00', null)), 5);
pub('11-17 12:30', 'it-bull-0312', BULLETIN, 'notice', text('Later evenings at Old Quay Library',
  'Good news for night owls: from Tuesday 17 November, Old Quay Library is open until 21:00 on weekdays.', ['libraries'], [OQ], 'routine', { ...period('11-17 09:00', null), ...basis('it-city-0207', 1, 'copy') }));
// The last step is the correction that the approved proposal gives as its example event
// (tests/proposal-events.json, ev-it-203), applied exactly as written there.
const LAST = require('../tests/proposal-events.json').find(e => e.event_id === 'ev-it-203');

// ---- replay ---------------------------------------------------------------------------
// Event IDs run in time order and end at the proposal's ev-it-203; request IDs run in the order of the account holder's writes.
function build({ until } = {}) {
  const ordered = steps.map((s, order) => ({ ...s, order, t: ms(at(s.when)) })).sort((a, b) => a.t - b.t || a.order - b.order);
  const events = ordered.filter(s => s.operation).length;
  const app = fixture({ seed: base(), now: at('10-26 00:00') });
  let n = Number(LAST.event_id.slice(6)) - events, requests = 0;
  for (const s of ordered) {
    const when = at(s.when);
    if (s.operation) {
      const payload = JSON.parse(JSON.stringify(s.payload));
      payload.revision = { number: payload.revision.number, published_at: isoAt(s.t - s.lag * 60000, TZ), ...payload.revision };
      app.event({ event_id: 'ev-it-' + (n++), at: when, operation: 'belltower.' + s.operation, payload });
    } else {
      app.advance(when);
      app.call(s.tool, { request_id: 'req-' + String(++requests).padStart(4, '0'), ...s.args });
    }
  }
  if (until === 'before-last') return app;
  app.event(LAST);
  app.advance(CLOCK);
  return app;
}

function print(data) { return JSON.stringify(data, null, 2) + '\n'; }
function main() {
  const file = path.resolve(__dirname, '../fixtures/minimal.json'), text = print(build().data);
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { console.error('fixtures/minimal.json differs from dev/build-fixture.cjs.'); process.exit(1); }
    console.log('fixtures/minimal.json matches dev/build-fixture.cjs.');
  } else {
    fs.writeFileSync(file, text);
    console.log('Wrote fixtures/minimal.json (' + text.length + ' bytes).');
  }
}

module.exports = { build, print, base, CLOCK, LAST };
if (require.main === module) main();
