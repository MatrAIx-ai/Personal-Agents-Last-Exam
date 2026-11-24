'use strict';
// Runnable without a host: Mei combines points into Daniel's account, Daniel transfers to his
// Skyline account during the bonus and to Harbor (released a day later). A host would publish each
// outbound message through Messaging; here the receiver receipts are simulated to show settlement.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const {deliverable, settleEvent} = require('../src/settlement.cjs');

const mei = fixture();
mei.load({account_id:'waypoint-mei', owner_person_id:'person-mei', member_name:'Mei Cho',
  household:[{person_id:'person-daniel', name:'Daniel Cho', waypoint_account_id:'waypoint-daniel'}], balance:200000,
  ledger:[{id:'ledger-1', at:'2026-02-01T09:00:00-06:00', kind:'opening', points:200000, balance_after:200000, description:'Opening balance', ref:null}],
  partners:[], bonuses:[], transfers:[]});
const combine = mei.call('waypoint.combine', {to_person_id:'person-daniel', points:120000});
const combineMessage = mei.call('waypoint.transfer.outbound', {id:combine.id}).message;

const daniel = fixture();
// Messaging delivers Mei's message to Daniel's account (receiver side), then Mei's side records the receipt.
daniel.event({event_id:'router-combine-1', at:'2027-08-24T21:00:02-05:00', operation:'waypoint.receive',
  payload:{recipient_account_id:'waypoint-daniel', message:combineMessage}});
mei.event(settleEvent(combine, {status:'committed', event_id:'router-combine-1', target:{app_id:'waypoint', account_id:'waypoint-daniel'}}, '2027-08-24T21:00:02-05:00'));

daniel.ctx.virtual_now = '2027-09-02T08:00:00-05:00'; // inside the 30% Skyline bonus
const sky = daniel.call('waypoint.transfer', {partner_id:'skyline', points:150000});
const hotel = daniel.call('waypoint.transfer', {partner_id:'harbor', points:30000});
assert.deepEqual([sky.bonus_pct, sky.points, hotel.available_at], [30, 195000, '2027-09-03T08:00:00-05:00']);
const now = deliverable(daniel.data, daniel.ctx.virtual_now).map(t => t.id);
daniel.event(settleEvent({id:sky.id}, {status:'committed', event_id:'router-sky-1', target:{app_id:'skyline', account_id:'skyline-daniel'}}, '2027-09-02T08:00:01-05:00'));
const after = daniel.data;
console.log(JSON.stringify({app:'waypoint',
  combine:{id:combine.id, message_id:combineMessage.id, mei_balance:mei.data.balance, daniel_credit:after.ledger.find(r => r.id === 'router-combine-1')},
  transfers:after.transfers.filter(t => t.id !== 'transfer-1').map(t => ({id:t.id, partner:t.partner_id, base_points:t.base_points, bonus_pct:t.bonus_pct,
    points:t.points, status:t.status, available_at:t.available_at})),
  deliverable_at_transfer_time:now, daniel_balance:after.balance}, null, 2));
