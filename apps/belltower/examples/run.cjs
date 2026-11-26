'use strict';
// Local walkthrough with the App's real business functions and the package fixture.
// It shows one declared event changing business state. On Wednesday at 06:10 an aggregator
// republishes Monday's bridge notice, although Public Works corrected that notice on Tuesday.
// Belltower stores the copy as published: it names revision 1 of the original as its basis,
// the original lists it under referenced_by, and nothing is labelled as outdated. A follow
// rule matches the copy, so one notification is written; it is held by the quiet hours until
// 07:00 and reads released once the clock is there, with no further event.
// Platform MCP, permissions, versions and persistence are verified separately.
const { fixture } = require('../tests/harness.cjs');
const app = fixture(), event = require('./scenario.json');
const original = 'it-roads-0031', copy = event.payload.item_id;
const brief = () => {
  const item = app.call('items.get', { id: original }).item;
  return {
    clock: app.now,
    original: { status: item.status, latest_revision: item.latest_revision, headline: item.headline, effective: item.effective, referenced_by: item.referenced_by },
    notifications: app.call('notifications.list', { limit: 100 }).notifications.length,
  };
};
const before = brief();
app.event(event);
const after = brief(), stored = app.call('items.get', { id: copy }).item, written = app.call('notifications.list', { limit: 1 }).notifications[0];
const data = JSON.stringify(app.data);
app.advance('2026-11-18T07:00:00-06:00');
const at0700 = app.call('notifications.list', { limit: 1 }).notifications[0];
console.log(JSON.stringify({
  example: 'belltower', mode: 'local business functions', event: { event_id: event.event_id, at: event.at, operation: event.operation }, before, after,
  the_copy: { id: stored.id, source_name: stored.source_name, revision: stored.revision, headline: stored.headline, received_at: stored.received_at, effective: stored.effective, based_on: stored.based_on },
  new_notification: written, same_notification_at_0700: { clock: app.now, state: at0700.state },
}, null, 2));
const ok = before.original.latest_revision === 2 && before.original.status === 'corrected' && before.original.referenced_by.length === 0
  && after.original.latest_revision === 2 && after.original.referenced_by.length === 1 && after.original.referenced_by[0].item_id === copy && after.original.referenced_by[0].used_revision === 1
  && stored.based_on.item_id === original && stored.based_on.revision === 1 && stored.based_on.relation === 'copy' && !/outdated|stale|superseded/i.test(JSON.stringify(stored))
  && after.notifications === before.notifications + 1 && written.kind === 'item.published' && written.item_id === copy && written.state === 'held'
  && written.release_at === '2026-11-18T07:00:00-06:00' && at0700.state === 'released' && JSON.stringify(app.data) === data;
if (!ok) {
  console.error('FAIL: the example did not produce the expected state change.');
  process.exit(1);
}
console.log('PASS: local App event example. Platform MCP, permissions and persistence are validated separately.');
