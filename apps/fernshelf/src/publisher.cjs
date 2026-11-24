'use strict';
// Infra-run outbound adapter (the pattern of Mail's src/publisher.cjs). Infra runs it with two
// trusted connections it supplies: Fernshelf's Infra MCP connection (to read notifications through
// env.snapshot) and a Messaging publisher connection whose source is fixed to this Fernshelf
// account. It never writes back into Fernshelf, so no cross-App transaction is assumed: a rejected
// delivery creates no Mail record and leaves Fernshelf unchanged; an unknown acknowledgement halts
// the router for reconciliation. A delivery receipt says Mail stored the message, nothing more.
const {sourceURI} = require('./notify.cjs');

// Notifications whose wire message was stored because email notices were on at that moment.
function deliverable(snapshot) {
  const data = snapshot.data;
  return data.notifications.filter(n => n.wire !== null).map(n => ({notification_id: n.id, message: n.wire}));
}
// Stable per run epoch and notification, so a retry after an unconfirmed reply is deduplicated.
const requestIdFor = (snapshot, notificationId) => 'fernshelf-' + snapshot.epoch + '-' + notificationId;

async function send({infra, router, notificationId, requestId}) {
  const snap = await infra.call('env.snapshot');
  if (snap.status !== 'ok') return {stage: 'source_snapshot', result: snap};
  const s = snap.snapshot, n = s.data.notifications.find(x => x.id === notificationId);
  if (!n) return {stage: 'not_found', notification_id: notificationId};
  if (!n.wire) return {stage: 'email_notices_off', notification_id: notificationId};
  if (n.wire.source !== sourceURI(s.data.account_id) || n.wire.data.source_object.account_id !== s.data.account_id) {
    return {stage: 'source_mismatch', notification_id: notificationId};
  }
  const request_id = requestId || requestIdFor(s, notificationId);
  const receipt = await router.call('router.publish', {request_id, message: n.wire});
  return {stage: receipt.status === 'committed' ? 'delivered' : 'router_' + receipt.status, notification_id: notificationId, request_id, message: n.wire, result: receipt};
}
module.exports = {deliverable, send};
