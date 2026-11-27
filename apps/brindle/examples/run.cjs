'use strict';
// Applies examples/scenario.json to the package fixture, without a host, and prints what changed.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const event = require('./scenario.json');
const f = fixture();
const before = f.data;
const purchase = before.disputes.find(d => d.id === event.payload.dispute_id).transaction_id;
const summary = () => f.call('transactions.get', {id: purchase}).recovery;
const balance = () => f.call('account.get').balance;
const was = {recovery: summary(), balance: balance()};
f.event(event);
const after = f.data;
assert.notDeepEqual(after, before);
// Only the dispute that the event names is printed, with the temporary credit and the notification that the event wrote.
const dispute = data => data.disputes.find(d => d.id === event.payload.dispute_id);
const credit = after.transactions.find(tx => tx.id === event.payload.provisional_credit.transaction_id);
const notification = after.notifications.find(n => n.event_id === event.event_id);
assert.ok(dispute(after) && credit && notification);
console.log(JSON.stringify({app: 'brindle', event, before: {dispute: dispute(before), ...was},
  after: {dispute: dispute(after), credit, recovery: summary(), balance: balance(), notification}}, null, 2));
