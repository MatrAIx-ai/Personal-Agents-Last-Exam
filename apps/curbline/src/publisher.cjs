'use strict';
// App-owned outbound adapter. Infra supplies trusted clients: an Infra connection to this Curbline
// instance and one Messaging connection per recipient Mail instance (the reference router binds one
// receiver instance per configuration). Reading through the Infra snapshot keeps these reads out of the
// Agent's audit. Curbline's own commit and Mail's receipt are separate commits.
//
// The planned runner will call deliver() after writes, events and clock advances. Until then a task's
// scenario script calls it at set points, between agent turns: each recorded outcome is an event that
// moves the App version, so the agent re-reads before its next write instead of meeting stale_version.

const pending = data => data.notifications.filter(n => n.status === 'pending_delivery');

// Mail's receiver-owned channel.email message. Title, body and time are frozen on the notification,
// so a retry sends identical bytes (Messaging fingerprints the whole message).
function message(data, n) {
  return {specversion: '1.0', id: 'curbline-' + n.notification_id,
    source: 'urn:pale:app:curbline:account:' + encodeURIComponent(data.account_id),
    type: 'org.pale.mail.notification.v1', time: n.created_at, datacontenttype: 'application/json',
    dataschema: 'urn:pale:email-payload:1', subject: n.booking_id,
    data: {channel: 'channel.email', recipient: {kind: 'person_ref', id: n.recipient_person_id},
      source_object: {app_id: 'curbline', account_id: data.account_id, object_type: 'booking', object_id: n.booking_id},
      content: {title: n.title, body: {format: 'text/plain', text: n.body}, asset_ids: []}, extensions: []}};
}

// Publish every pending notification once through its recipient's router, then record each outcome.
// `routers` maps a recipient person_id to its Messaging client; recipients without one are skipped.
async function deliver({infra, routers}) {
  const results = [];
  const snap = await infra.call('env.snapshot'), data = snap.snapshot.data;
  for (const n of pending(data)) {
    const router = routers[n.recipient_person_id];
    if (!router) continue;
    const receipt = await router.call('router.publish', {request_id: n.notification_id, message: message(data, n)});
    const status = ['committed', 'rejected', 'unknown', 'halted'].includes(receipt.status) ? receipt.status : 'unknown';
    const current = await infra.call('env.snapshot');
    const recorded = await infra.call('env.apply_event', {expected_version: current.version, event: {
      event_id: 'dlv-' + n.notification_id + '-' + current.version.revision, at: current.snapshot.virtual_now,
      operation: 'notification.delivery_recorded',
      payload: {notification_id: n.notification_id, status, code: receipt.code || null, stop_run: receipt.stop_run === true,
        router_event_id: receipt.event_id || null}}});
    results.push({notification_id: n.notification_id, recipient_person_id: n.recipient_person_id, receipt, recorded: recorded.status});
    if (receipt.stop_run) break; // the run halts for reconciliation, per the Messaging rules
  }
  return results;
}

module.exports = {pending, message, deliver};
