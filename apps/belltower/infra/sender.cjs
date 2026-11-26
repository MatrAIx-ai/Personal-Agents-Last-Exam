'use strict';
// Infra-run sender for Belltower notifications: an outbound adapter, in the pattern of Mail's
// src/publisher.cjs. It is not part of the App's business entrypoint and is never given to
// the Agent. Infra runs it with its own trusted connections and supplies both clients:
//
//   source  an Infra MCP client of this Belltower instance (`call(name, args)`)
//   router  a publisher client of Messaging for this package (`call('router.publish', ...)`)
//
// It imports nothing outside this file. It reads notifications through `env.snapshot` and
// dispatches one when three things hold in that snapshot:
//
//   1. its release time has been reached (the snapshot's `virtual_now` is at or after it);
//   2. it is not superseded;
//   3. its revision is still the latest revision of its item.
//
// The third rule is what keeps a replaced version out of Mail however late this adapter
// runs: a notification released at 18:00 whose item is corrected at 18:05 is skipped as
// `replaced` by a first run at 18:10, and the correction is dispatched instead once its own
// release time is reached. The guarantee therefore holds at first dispatch.
//
// It publishes the wire message that the App stored with the notification. Whether a
// message reaches Mail is decided by Messaging from the run's bindings and grants, and the
// receipt comes from the receiver. The sender never writes into Belltower or into another
// App, so no cross-App transaction is assumed: Belltower's state is the same before and
// after a run, and whether a notification has a Mail copy is read from Mail's records and
// from this adapter's report.
//
// Time needs no App event: a digest notification written at 10:00 with release time 18:00
// is published by the first run of this adapter after Infra has moved the clock to 18:00 or
// later, whether that was an event or Core's `env.advance_time`.
//
// What is left out of a run:
//   - Notifications that were in the loaded seed are history, unless they were still held
//     at the time the seed was loaded; those are handled like new ones.
//   - Notifications written while email notices were off have no wire message.
//   - `sent` is the caller's own log ({ [notification_id]: receipt summary }). Pass it back on
//     the next run so that nothing is published twice; Messaging also returns the first
//     receipt for an identical retry inside one router session.

const instant = value => Date.parse(value);

// What a run would do with the snapshot: the notifications to dispatch, in order of release
// time, and those it skips, each with the reason (`held`, `superseded` or `replaced`).
function plan(snapshot, sent = {}) {
  const now = instant(snapshot.virtual_now), loadedAt = instant(snapshot.initial_virtual_now ?? snapshot.virtual_now);
  const seeded = new Map(((snapshot.initial_data && snapshot.initial_data.notifications) || []).map(n => [n.id, n]));
  const latest = new Map(snapshot.data.items.map(item => [item.id, item.revisions[item.revisions.length - 1].number]));
  const dispatch = [], skipped = [], left_out = { history: 0, no_email: 0, already_sent: 0 };
  snapshot.data.notifications.forEach((n, order) => {
    const before = seeded.get(n.id);
    // History: the seed already had it, released by the time the seed was loaded or superseded in the seed.
    if (before && (before.superseded_by !== undefined || instant(before.release_at) <= loadedAt)) { left_out.history++; return; }
    if (n.wire === undefined) { left_out.no_email++; return; }
    if (sent[n.id] !== undefined) { left_out.already_sent++; return; }
    if (n.superseded_by !== undefined) skipped.push({ notification_id: n.id, reason: 'superseded', by: n.superseded_by });
    else if (instant(n.release_at) > now) skipped.push({ notification_id: n.id, reason: 'held', release_at: n.release_at });
    else if (latest.get(n.item_id) !== n.revision) skipped.push({ notification_id: n.id, reason: 'replaced', revision: n.revision, latest_revision: latest.get(n.item_id) });
    else dispatch.push({ n, order });
  });
  dispatch.sort((a, b) => instant(a.n.release_at) - instant(b.n.release_at) || a.order - b.order);
  return { dispatch: dispatch.map(({ n }) => n), skipped, left_out };
}

// Publishes every notification of the plan in order and stops at the first result that is
// not committed, so nothing is passed over silently. Returns the report and the updated log.
async function publishReleased({ source, router, sent = {} }) {
  const read = await source.call('env.snapshot');
  if (read.status !== 'ok') return { stage: 'source_read', result: read, dispatched: [], skipped: [], sent };
  const snapshot = read.snapshot, { dispatch, skipped, left_out } = plan(snapshot, sent), dispatched = [];
  const report = stage => ({ stage, virtual_now: snapshot.virtual_now, dispatched, skipped, left_out, sent });
  for (const notification of dispatch) {
    const request_id = 'belltower:' + snapshot.epoch + ':' + notification.id;
    const result = await router.call('router.publish', { request_id, message: notification.wire });
    dispatched.push({ notification_id: notification.id, item_id: notification.item_id, revision: notification.revision, request_id, result });
    if (result.status !== 'committed') return report('router_rejected');
    sent[notification.id] = { request_id, event_id: result.event_id, target: result.target, committed_at: result.committed_at };
  }
  return report(dispatched.length ? 'delivered' : 'nothing_pending');
}

module.exports = { plan, publishReleased };
