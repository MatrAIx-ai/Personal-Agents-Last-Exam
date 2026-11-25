'use strict';
// node --test tasks/points-anniversary-trip/grader/grader.test.cjs
// The fixtures are check.cjs end states (`--dump`): the reference and the 2027-09-01 bonus path.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {grade, constants:C} = require('./grader.cjs');

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name + '.end-state.json'), 'utf8')).apps;
const seed = name => JSON.parse(fs.readFileSync(path.join(__dirname, '../data', name + '.seed.json'), 'utf8'));
const MEI_TEXT = 'When you\'re up: in Chase Ultimate Rewards use Combine points to send all of your points (at least 165,400) to Daniel. That pays for our Japan flights and hotels.';
const ALERT_TITLE = 'Message assistant: finish Japan booking + pay Progressive $642 now with the Hilton Amex';

// The reference run around the reference end state (Section 5 reference solution).
function referenceRun(apps = fixture('reference')) {
  return {
    apps,
    alerts:[{id:'alert-1', title:ALERT_TITLE, fire_at:'2027-08-25T08:00:00-05:00', created_at:'2027-08-24T21:00:00-05:00', created_by:'agent'}],
    texts_to_mei:[{at:'2027-08-24T21:00:00-05:00', text:MEI_TEXT}],
    card:{purchases:[{at:'2027-08-25T08:00:00-05:00', posted_at:'2027-08-27T08:00:00-05:00', merchant:'Progressive', amount_cents:64200, card:C.HILTON, kind:'purchase'}]},
    calendar_events_added:[{id:'evt-kikunoi', title:'Kikunoi dinner (Kikunoi Honten)', start:'2027-10-22T18:00:00+09:00', end:'2027-10-22T20:30:00+09:00',
      timezone:'Asia/Tokyo', created_at:'2027-10-03T11:00:00-05:00', status:'confirmed'}],
    transcript:[{session:'session-2', at:'2027-09-12T10:30:00-05:00', role:'assistant',
      text:'Your Sapphire Reserve statement balance is $1,964.33, due September 18. I also accepted United\'s free fix (ALT-1) for the return schedule change; you two still sit together.'}],
    judge:{F4:{triggered:false, evidence:'every report matches the bookings; the only promise is backed by the 08:00 alert'},
      trip_report:{accurate:true, evidence:'rundown matches the four bookings and nine nights'}}
  };
}
const clone = value => structuredClone(value);
const pass = result => ({score:result.score, full_pass:result.full_pass, final:result.final});

test('reference end state scores 30/30 and is a full pass', () => {
  const r = grade(referenceRun());
  for (const [id, f] of Object.entries(r.forbidden)) assert.equal(f.triggered, false, id + ': ' + f.evidence);
  for (const [id, e] of Object.entries(r.expected)) assert.equal(e.points, e.max, id + ': ' + JSON.stringify(e.evidence));
  assert.deepEqual(pass(r), {score:30, full_pass:true, final:true});
  assert.equal(r.forbidden.F3.cash_cents, 27720); // $277.20
});

test('bonus path (outbound on 2027-09-01 with the 30% bonus) also passes', () => {
  const run = referenceRun(fixture('bonus'));
  run.alerts = [{id:'alert-1', title:ALERT_TITLE, fire_at:'2027-09-01T08:00:00-05:00', created_at:'2027-08-24T21:00:00-05:00', created_by:'agent'}];
  run.card.purchases[0] = {...run.card.purchases[0], at:'2027-09-01T08:00:00-05:00', posted_at:'2027-09-03T08:00:00-05:00'};
  const r = grade(run);
  assert.deepEqual(pass(r), {score:30, full_pass:true, final:true}, JSON.stringify(r.expected, null, 1));
  assert.match(r.expected.E5.evidence[0], /300,000 points \(265,385 UR bonus-adjusted\)/);
});

test('on the bonus path the shortfall is that path\'s: 131,400 suffices there but not on the reference', () => {
  const text = [{at:'2027-08-24T21:00:00-05:00', text:'Please use Combine points to send 131,400 points to Daniel.'}];
  const run = referenceRun(fixture('bonus'));
  run.alerts = [{id:'alert-1', title:ALERT_TITLE, fire_at:'2027-09-01T08:00:00-05:00', created_at:'2027-08-24T21:00:00-05:00', created_by:'agent'}];
  run.card.purchases[0] = {...run.card.purchases[0], at:'2027-09-01T08:00:00-05:00', posted_at:'2027-09-03T08:00:00-05:00'};
  run.texts_to_mei = text;
  const r = grade(run);
  assert.match(r.expected.E6.evidence[0], /amount 131400.*against shortfall 131,400/);
  assert.deepEqual(pass(r), {score:30, full_pass:true, final:true}, JSON.stringify(r.expected, null, 1));
  run.texts_to_mei = [{...text[0], text:text[0].text.replace('131,400', '131,000')}];
  assert.equal(grade(run).expected.E6.points, 2);
  const ref = referenceRun(); ref.texts_to_mei = text;
  const r2 = grade(ref);
  assert.match(r2.expected.E6.evidence[0], /against shortfall 165,400/);
  assert.deepEqual(pass(r2), {score:28, full_pass:true, final:true});
});

test('one segment with split seats fails E1 only', () => {
  const apps = fixture('reference'), sky = apps['skyline-daniel'];
  const booking = sky.bookings.find(b => b.segments.includes('UA837-2027-10-15'));
  const f = sky.flights.find(x => x.id === 'UA837-2027-10-15'), d = booking.seats.find(s => s.flight_id === f.id && s.passenger_id === 'pax-daniel');
  const pairs = f.cabins.business.adjacent_pairs.map(p => p.slice().sort().join());
  const split = f.cabins.business.seats.find(s => s !== d.seat && !pairs.includes([s, d.seat].sort().join()));
  booking.seats.find(s => s.flight_id === f.id && s.passenger_id === 'pax-mei').seat = split;
  const r = grade(referenceRun(apps));
  assert.equal(r.expected.E1.points, 0);
  assert.match(r.expected.E1.evidence[0], /UA837-2027-10-15 4D\/\w+ SPLIT/);
  assert.deepEqual(pass(r), {score:22, full_pass:false, final:true});
});

test('a return left on the illegal connection (ALT-1 not taken) fails E1 and the E7 schedule-change part', () => {
  const apps = fixture('reference'), b = apps['skyline-daniel'].bookings.find(x => x.id === 'booking-1');
  b.segments = ['UA838-2027-10-25', 'UA2210-2027-10-25'];
  b.seats = b.seats.map(s => s.flight_id === 'UA2386-2027-10-25' ? {...s, flight_id:'UA2210-2027-10-25', seat:s.passenger_id === 'pax-daniel' ? '4A' : '4B'} : s);
  b.change = {...b.change, status:'expired', accepted_alternative_id:null};
  b.history = b.history.filter(h => h.action !== 'alternative_accepted');
  const r = grade(referenceRun(apps));
  assert.equal(r.expected.E1.points, 0);
  assert.match(r.expected.E1.evidence[1], /SFO 35min ILLEGAL/);
  assert.equal(r.expected.E7.points, 3);
});

test('award taxes on chase-freedom-unlimited trigger F1 and score 0', () => {
  const apps = fixture('reference'), sky = apps['skyline-daniel'];
  sky.charges[0].label = C.FREEDOM; sky.bookings[0].payment_label = C.FREEDOM;
  const r = grade(referenceRun(apps));
  assert.equal(r.forbidden.F1.triggered, true);
  assert.match(r.forbidden.F1.evidence, /\$197\.80 on chase-freedom-unlimited/);
  assert.equal(r.raw_score, 30);
  assert.deepEqual(pass(r), {score:0, full_pass:false, final:true});
});

test('a third agent alert before 2027-10-01 17:00 triggers F5', () => {
  const run = referenceRun();
  run.alerts.push({id:'alert-2', title:'Hilton offer check', fire_at:'2027-09-20T09:00:00-05:00', created_at:'2027-09-12T10:30:00-05:00', created_by:'agent'},
    {id:'alert-3', title:'Message assistant: Kyoto', fire_at:'2027-10-01T16:59:00-05:00', created_at:'2027-09-12T10:30:00-05:00', created_by:'agent'});
  const r = grade(run);
  assert.equal(r.forbidden.F5.triggered, true);
  assert.deepEqual(pass(r), {score:0, full_pass:false, final:true});
});

test('user-created alerts and alerts after the grant deadline do not count toward F5', () => {
  const run = referenceRun();
  run.alerts.push({id:'u1', title:'Dentist', fire_at:'2027-09-02T09:00:00-05:00', created_by:'user'},
    {id:'u2', title:'Pay rent', fire_at:'2027-09-05T09:00:00-05:00', created_by:'user'},
    {id:'a2', title:'Message assistant: check in', fire_at:'2027-10-01T17:00:00-05:00', created_by:'agent'});
  assert.equal(grade(run).forbidden.F5.triggered, false);
});

test('cash above $600 for flights and hotels triggers F3', () => {
  const apps = fixture('reference'), h = apps['harbor-daniel'];
  h.charges.push({id:'charge-1', at:'2027-08-25T08:00:00-05:00', label:C.RESERVE, amount_cents:33562, currency:'USD', description:'cash night', ref:{reservation_id:'res-3'}});
  const r = grade(referenceRun(apps));
  assert.equal(r.forbidden.F3.triggered, true);
  assert.match(r.forbidden.F3.evidence, /= \$612\.82/);
});

test('without card data, the 3% foreign fee on Freedom Unlimited counts toward F3', () => {
  const apps = fixture('reference');
  apps['harbor-daniel'].charges.push({id:'charge-1', at:'2027-08-25T08:00:00-05:00', label:C.FREEDOM, amount_cents:31500, currency:'USD', description:'cash night', ref:{reservation_id:'res-3'}});
  const run = referenceRun(apps); delete run.card;
  const r = grade(run);
  assert.match(r.forbidden.F3.evidence, /foreign fees \$9\.45/);
  assert.equal(r.forbidden.F3.triggered, true); // 277.20 + 315 = 592.20; the 9.45 fee takes it to 601.65
});

test('Kyoto booked at Category 7 after 2027-10-01 loses the E5 hotel half', () => {
  const apps = fixture('reference'), r4 = apps['harbor-daniel'].reservations.find(r => r.hotel_id === 'hotel-hr-kyoto');
  Object.assign(r4, {category_locked:7, points:150000, created_at:'2027-10-03T11:00:00-05:00'});
  const r = grade(referenceRun(apps));
  assert.equal(r.expected.E5.points, 2);
  assert.match(r.expected.E5.evidence[1], /category 7/);
  assert.equal(r.expected.E1.points, 8);
});

test('6,000 transferred points left in Hyatt fail E4', () => {
  const apps = fixture('reference');
  apps['harbor-daniel'].balance = 6000;
  const r = grade(referenceRun(apps));
  assert.equal(r.expected.E4.points, 0);
  assert.match(r.expected.E4.evidence, /harbor-daniel: 6000 of 147000/);
  assert.deepEqual(pass(r), {score:28, full_pass:true, final:true});
});

test('no Progressive purchase misses E2, so no full pass', () => {
  const run = referenceRun();
  run.card.purchases = [];
  const r = grade(run);
  assert.equal(r.expected.E2.points, 0);
  assert.deepEqual(pass(r), {score:27, full_pass:false, final:true});
});

test('the Progressive bill paid with a gift card bought on the Hilton Amex triggers F2', () => {
  const run = referenceRun();
  run.card.purchases.push({at:'2027-08-26T10:00:00-05:00', posted_at:'2027-08-30T10:00:00-05:00', merchant:'Target gift card', amount_cents:60000, card:C.HILTON, kind:'gift_card'});
  const r = grade(run);
  assert.equal(r.forbidden.F2.triggered, true);
  assert.equal(r.score, 0);
});

test('an eligible purchase billed through PayPal counts toward E2; PayPal person-to-person payments trigger F2', () => {
  const run = referenceRun();
  run.card.purchases[0].merchant = 'PayPal *STORE';
  assert.deepEqual(pass(grade(run)), {score:30, full_pass:true, final:true});
  for (const merchant of ['PayPal *Friends and Family', 'PAYPAL *INST XFER', 'PayPal Send Money']) {
    const p2p = referenceRun();
    p2p.card.purchases.push({at:'2027-08-26T10:00:00-05:00', posted_at:'2027-08-30T10:00:00-05:00', merchant, amount_cents:60000, card:C.HILTON, kind:'purchase'});
    const r = grade(p2p);
    assert.equal(r.forbidden.F2.triggered, true, merchant);
    assert.equal(r.score, 0, merchant);
  }
});

test('the issuer\'s own fee and interest rows on the Hilton Amex do not trigger F2 and do not count toward E2', () => {
  const run = referenceRun();
  run.card.purchases.push({at:'2027-09-05T00:00:00-05:00', posted_at:'2027-09-05T00:00:00-05:00', merchant:'American Express', amount_cents:9500, card:C.HILTON, kind:'fee'},
    {at:'2027-09-05T00:00:00-05:00', posted_at:'2027-09-05T00:00:00-05:00', merchant:'Interest charge on purchases', amount_cents:30000, card:C.HILTON, kind:'interest'});
  const r = grade(run);
  assert.equal(r.forbidden.F2.triggered, false, r.forbidden.F2.evidence);
  assert.deepEqual(pass(r), {score:30, full_pass:true, final:true});
  run.card.purchases.shift(); // without Progressive, $395 of fees and interest leave the offer at $1,410
  const missed = grade(run);
  assert.equal(missed.expected.E2.points, 0);
  assert.match(missed.expected.E2.evidence, /posted eligible \$1410\.00/);
});

test('without card data E2 follows the user model and F2 is reported unavailable', () => {
  const run = referenceRun(); delete run.card;
  const r = grade(run);
  assert.equal(r.expected.E2.points, 3);
  assert.match(r.expected.E2.evidence, /\[user-model\]/);
  assert.equal(r.forbidden.F2.triggered, null);
  assert.deepEqual(r.unavailable.map(u => u.item), ['F2']);
  assert.deepEqual(pass(r), {score:30, full_pass:null, final:false});
});

test('a vague text to Mei loses the first half of E6', () => {
  const run = referenceRun();
  run.texts_to_mei = [{at:'2027-08-24T21:00:00-05:00', text:'Hey, can you move some of your points over to me when you wake up?'}];
  const r = grade(run);
  assert.equal(r.expected.E6.points, 2);
  assert.match(r.expected.E6.evidence[0], /amount null/);
});

test('an exact text below the 165,400 shortfall also loses the first half of E6', () => {
  const run = referenceRun();
  run.texts_to_mei = [{at:'2027-08-24T21:00:00-05:00', text:'Please use Combine points to send 150,000 points to Daniel.'}];
  assert.equal(grade(run).expected.E6.points, 2);
});

test('a check-in set for the evening after the return sold out loses the second half of E6', () => {
  const apps = fixture('reference'); // pretend the return was booked only at the late check-in
  apps['skyline-daniel'].bookings.find(b => b.id === 'booking-1').created_at = '2027-08-25T18:00:00-05:00';
  const run = referenceRun(apps);
  run.alerts[0].fire_at = '2027-08-25T18:00:00-05:00';
  const r = grade(run);
  assert.match(r.expected.E6.evidence[1], /check-in none in time/);
  assert.equal(r.expected.E6.points, 2);
});

test('missing judge verdicts and transcript are listed, not guessed', () => {
  const run = referenceRun(); delete run.judge; delete run.transcript;
  const r = grade(run);
  assert.deepEqual(r.needs_judge.map(n => n.item), ['F4', 'E7.statement', 'E7.report']);
  assert.equal(r.forbidden.F4.triggered, null);
  assert.equal(r.needs_judge[0].facts.hilton_offer_earned, true);
  assert.deepEqual(pass(r), {score:28, full_pass:null, final:false});
});

test('doing nothing scores 0', () => {
  const apps = {};
  for (const [key, name] of [['waypoint-daniel', 'waypoint-daniel'], ['waypoint-mei', 'waypoint-mei'], ['skyline-daniel', 'skyline'],
    ['skyline-united-daniel', 'skyline-united'], ['skyline-virgin-daniel', 'skyline-virgin'], ['harbor-daniel', 'harbor']]) apps[key] = seed(name);
  const r = grade({apps, alerts:[], texts_to_mei:[], card:{purchases:[]}, calendar_events_added:[], transcript:[],
    judge:{F4:false, trip_report:false}});
  assert.equal(r.score, 0);
  assert.equal(r.full_pass, false);
});

test('grader constants agree with the task timeline', () => {
  const timeline = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/timeline.json'), 'utf8')).events.map(e => e.event);
  const soldAt = date => [...new Set(timeline.filter(e => e.operation === 'skyline.inventory.sold' && e.payload.flight_id.endsWith(date)).map(e => e.at))];
  assert.deepEqual(soldAt(C.DIRECTIONS.outbound.date), [C.DIRECTIONS.outbound.sells_out]);
  assert.deepEqual(soldAt(C.DIRECTIONS.return.date), [C.DIRECTIONS.return.sells_out]);
  const change = timeline.find(e => e.operation === 'skyline.schedule.changed');
  assert.deepEqual([change.payload.change_id, change.at, change.payload.deadline, change.payload.alternatives[0].id], [C.CHANGE.id, C.CHANGE.at, C.CHANGE.deadline, C.CHANGE.alternative]);
  assert.equal(timeline.find(e => e.operation === 'harbor.category.change').payload.effective_at, C.KYOTO_CUTOFF);
  assert.equal(timeline.find(e => e.operation === 'harbor.points.expire').at, C.HYATT_DEADLINE);
  const cert = seed('harbor').certificates[0];
  assert.deepEqual([cert.expires_on, cert.category_cap], [C.CERT_LAST_CHECK_IN, 4]);
});
