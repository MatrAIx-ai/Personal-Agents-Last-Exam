'use strict';
// Runnable without a host. Daniel's outbound flight is retimed (scenario.json); then points
// arrive from Waypoint, the Agent books the return HND→ORD for Daniel and Mei with seats together,
// the remaining saver seats sell out, a schedule change breaks the SFO connection, and the free
// next-day alternative is accepted with the pair kept. Finally the Mail notice is built.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture();

f.event(require('./scenario.json'));
assert.equal(f.call('skyline.trips', {id:'booking-1'}).trip.change.reason, 'time_change');

f.event({event_id:'msg-loyalty-0002', at:'2027-08-25T09:00:00-05:00', operation:'skyline.receive', payload:{recipient_account_id:'skyline-daniel', message:{
  specversion:'1.0', id:'waypoint-transfer-example-0002', source:'urn:pale:app:waypoint:account:waypoint-daniel', type:'org.pale.loyalty.credit.v1',
  time:'2027-08-25T08:59:00-05:00', datacontenttype:'application/json', dataschema:'urn:pale:loyalty-credit:1',
  data:{channel:'channel.loyalty-credit', recipient:{kind:'app_account_ref', app_id:'skyline', id:'skyline-daniel'},
    source_object:{app_id:'waypoint', account_id:'waypoint-daniel', object_type:'transfer', object_id:'transfer-2027-0007'},
    content:{kind:'partner_transfer', member_person_id:'person-daniel', member_number:'SK-48210377', points:120000, base_points:120000, bonus_pct:0},
    extensions:[]}}}});
const balance = f.call('skyline.balance').balance;

f.ctx.virtual_now = '2027-08-25T09:05:00-05:00';
const [option] = f.call('skyline.search', {origin:'HND', dest:'ORD', date:'2027-10-21', cabin:'business', pax:2}).options;
const booked = f.call('skyline.book', {option_id:option.option_id, passenger_ids:['pax-daniel', 'pax-mei'], payment_label:'card-travel',
  seats:[{flight_id:'PC12-2027-10-21', passenger_id:'pax-daniel', seat:'1D'}, {flight_id:'PC12-2027-10-21', passenger_id:'pax-mei', seat:'1F'},
    {flight_id:'LK480-2027-10-21', passenger_id:'pax-daniel', seat:'1A'}, {flight_id:'LK480-2027-10-21', passenger_id:'pax-mei', seat:'1B'}]});

f.event({event_id:'sold-pc12-2027-10-21', at:'2027-08-25T10:00:00-05:00', operation:'skyline.inventory.sold',
  payload:{flight_id:'PC12-2027-10-21', cabin:'business', seats:'all'}});
assert.equal(f.call('skyline.search', {origin:'HND', dest:'ORD', date:'2027-10-21', cabin:'business', pax:1}).options.length, 0);

f.event({event_id:'schedule-pc12-2027-10-21', at:'2027-08-26T07:00:00-05:00', operation:'skyline.schedule.changed', payload:{
  change_id:'chg-pc12-2027-10-21', flight_id:'PC12-2027-10-21', departs_at:'2027-10-21T20:30:00+09:00', arrives_at:'2027-10-21T14:20:00-07:00',
  alternatives:[{id:'alt-same-day', flight_ids:['PC12-2027-10-21', 'LK488-2027-10-21']}, {id:'alt-next-day', flight_ids:['PC12-2027-10-22', 'LK480-2027-10-22']}],
  deadline:'2027-09-01T23:59:00-05:00'}});
const change = f.call('skyline.trips', {id:booked.id}).trip.change;
assert.deepEqual([change.reason, change.status], ['illegal_connection', 'open']);

f.ctx.virtual_now = '2027-08-27T12:00:00-05:00';
const accepted = f.call('skyline.manage', {booking_id:booked.id, action:'accept_alternative', alternative_id:'alt-next-day'});
assert.deepEqual(accepted.reassigned, []);
const notice = f.data.notices.find(n => n.kind === 'schedule_change' && n.ref.booking_id === booked.id);
const message = f.call('skyline.notices.outbound', {id:notice.id}).message;

console.log(JSON.stringify({app:'skyline', scenario:require('./scenario.json').operation, balance_after_transfer:balance,
  booked:{locator:booked.locator, points:booked.points, charged_cents:booked.amount_cents, seats:booked.seats},
  schedule_change:{reason:change.reason, deadline:change.deadline, alternatives:change.alternatives.map(a => a.id)},
  accepted:{segments:f.call('skyline.trips', {id:booked.id}).trip.segments, seats:accepted.seats, reassigned:accepted.reassigned},
  balance:f.call('skyline.balance').balance, mail:{id:message.id, title:message.data.content.title, to:message.data.recipient.id}}, null, 2));
