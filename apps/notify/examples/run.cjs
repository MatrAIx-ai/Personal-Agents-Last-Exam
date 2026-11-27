'use strict';
// Runnable without a host: discover the reminders due in a window the way a runner would
// (from snapshot data), fire each one at its own time, and show the resulting phone feed.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const {due, fireEvent} = require('../src/due.cjs');
const f = fixture();
const before = f.data;
const window = {from:'2026-11-18T09:00:00-08:00', to:'2026-11-19T09:00:00-08:00'};
const list = due(before, window.from, window.to);
assert.deepEqual(list.map(r => r.reminder_id), ['reminder-pantry', 'reminder-plants']);
assert.deepEqual(fireEvent(list[0]), require('./scenario.json'));
for (const reminder of list) f.event(fireEvent(reminder));
const after = f.data;
const outcome = list.map(r => {
  const reminder = after.reminders.find(x => x.id === r.reminder_id);
  return {reminder_id:reminder.id, fire_at:reminder.fire_at, status:reminder.status, feed_item_id:reminder.feed_item_id};
});
assert.deepEqual(outcome.map(o => o.status), ['delivered', 'silenced']); // 23:00 falls inside the Sleep focus window
console.log(JSON.stringify({app:'notify', window, due:list, outcome,
  new_feed_items:after.feed.filter(x => !before.feed.some(y => y.id === x.id))}, null, 2));
