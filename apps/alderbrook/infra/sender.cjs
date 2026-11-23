'use strict';
// The outbound adapter for Alderbrook notifications. Infra runs it with its own Infra and publisher connections.
// It reads Alderbrook and never writes to it, so a delivery problem leaves the claim data as it is.
// Infra keeps ONE sender for the whole run, like its one publisher connection. A second sender in the same run
// must get the first sender's `firstEpoch`, or it cannot tell an old lifecycle from the current one.

// After a reset or a new seed the App can make an old notification ID again, so a later lifecycle adds its epoch.
function dispatchId(notificationId, epoch, firstEpoch) {
  return epoch === firstEpoch ? notificationId : notificationId + '.e' + epoch;
}
// The router found no route to a mailbox, so Mail has no record and the next notification can go.
const NO_ROUTE = ['recipient_not_authorized', 'recipient_unavailable', 'ambiguous_recipient', 'unsupported_recipient'];
const done = receipt => receipt.status === 'committed' || receipt.status === 'rejected' && receipt.stop_run !== true && NO_ROUTE.includes(receipt.code);

// `infra` is Alderbrook's Infra connection and `router` is its Messaging publisher connection. Both have `call(name, args)`.
function createSender({infra, router, firstEpoch = null}) {
  let epoch = null, handled = new Set();

  async function publish(notification) {
    const id = dispatchId(notification.id, epoch, firstEpoch);
    const message = id === notification.id ? notification.email : {...notification.email, id};
    let receipt;
    // A router that gives no answer leaves the delivery unknown, like a receiver that gives none.
    try { receipt = await router.call('router.publish', {request_id: id, message}); }
    catch { receipt = null; }
    if (receipt === null || typeof receipt !== 'object') receipt = {status: 'unknown', code: 'router_unreachable'};
    // A delivery, or a refusal for lack of a route, is the final answer for a notification in this lifecycle.
    if (done(receipt)) handled.add(notification.id);
    return {receipt, row: {notification_id: notification.id, request_id: id, status: receipt.status, code: receipt.code ?? null,
      event_id: receipt.event_id ?? null, duplicate: receipt.duplicate === true}};
  }

  async function publishPending() {
    const read = await infra.call('env.snapshot');
    if (read.status !== 'ok') throw new Error('The sender cannot read Alderbrook: env.snapshot returned ' + read.status + '.');
    const {snapshot} = read, results = [];
    if (firstEpoch === null) firstEpoch = snapshot.epoch;
    if (snapshot.epoch !== epoch) { epoch = snapshot.epoch; handled = new Set(); }
    // What the loaded seed already held is history. It is read from this snapshot, so it is right after a reset or a new seed.
    const history = new Set(snapshot.initial_data.notifications.map(n => n.id));
    let stopped = false;
    for (const notification of snapshot.data.notifications) {
      if (history.has(notification.id) || !notification.email || handled.has(notification.id)) continue;
      const {receipt, row} = await publish(notification);
      results.push(row);
      // Any other answer needs a person: a halted run, an unknown outcome, or an identity or contract that the router refuses.
      if (!done(receipt)) { stopped = true; break; }
    }
    return {epoch, firstEpoch, lifecycle: epoch === firstEpoch ? 'first' : 'later', results, stopped};
  }
  return {publishPending};
}
module.exports = {createSender, dispatchId};
