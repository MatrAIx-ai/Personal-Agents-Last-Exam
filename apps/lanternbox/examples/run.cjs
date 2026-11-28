'use strict';
// A short walk through real state changes: a new episode arrives (event), the account holder marks what
// one viewer has seen, a cheaper plan is asked for, and time alone brings it into effect.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture();
const before = f.data;
const nextUp = id => f.call('titles.get', {title_id: 'ttl-harbor-lights', id}).title.next_up?.playable_id ?? null;
const start = {dele: nextUp('prof-dele'), sana: nextUp('prof-sana')};
f.event(require('./scenario.json'));
assert.notDeepEqual(f.data, before);
f.call('progress.set', {id: 'prof-dele', playable_id: 'ep-harbor-s2e04', patch: {completed: true}});
const removed = f.call('profiles.delete', {id: 'prof-bisi'}).removed;
f.call('profiles.delete', {id: 'prof-timi'});
const change = f.call('plan.change', {id: 'basic'});
const pending = f.call('account.get').account;
f.advance('2026-12-03T00:00:00-05:00');
const due = f.call('account.get').account;
assert.equal(pending.plan_id, 'standard'); assert.equal(due.plan_id, 'basic'); assert.equal(due.status, 'past_due');
console.log(JSON.stringify({app: 'lanternbox', event: 'lanternbox.catalog.episode_released', next_up_before: start, next_up_after: {dele: nextUp('prof-dele'), sana: nextUp('prof-sana')},
  removed_with_profile: removed, plan_change: change, plan_while_pending: pending.plan_id, plan_at_paid_through: due.plan_id, status_at_paid_through: due.status, suspends_at: due.suspends_at,
  notifications_added: f.data.notifications.length - before.notifications.length, activity_rows_added: f.data.activity.length - before.activity.length}, null, 2));
