'use strict';
// App-owned outbound adapter. Infra supplies trusted clients: an Infra connection to this Hopline
// instance and a Messaging connection fixed to this publisher. Reading through the Infra snapshot keeps
// these reads out of the Agent's audit. Hopline's own commit and Mail's receipt are separate commits.
const {copy} = require('./common.cjs');
const {materialize} = require('./derive.cjs');

// Notifications waiting for delivery at the virtual time (a quiet-hour hold reads as pending once released).
const pending = (data, now) => materialize(copy(data), now).notifications.filter(n => n.delivery === 'mail' && n.status === 'pending_delivery');

// Wire IDs allow [A-Za-z0-9_.:-]; a replacement card's '~' is written as '.'.
const wire = id => id.replace(/~/g, '.');

// Mail's receiver-owned channel.email message. Title, body and time are frozen on the notification,
// so a retry sends identical bytes (Messaging fingerprints the whole message).
function message(data, n) {
  return {specversion: '1.0', id: 'hopline-' + n.notification_id,
    source: 'urn:pale:app:hopline:account:' + encodeURIComponent(data.account_id),
    type: 'org.pale.mail.notification.v1', time: n.time, datacontenttype: 'application/json',
    dataschema: 'urn:pale:email-payload:1', subject: wire(n.source.id),
    data: {channel: 'channel.email', recipient: {kind: 'person_ref', id: n.recipient_person_id},
      source_object: {app_id: 'hopline', account_id: data.account_id, object_type: n.source.kind, object_id: wire(n.source.id)},
      content: {title: n.title, body: {format: 'text/plain', text: n.body}, asset_ids: []}, extensions: []}};
}

// Publish every pending notification once, then record each Messaging outcome on Hopline.
async function deliver({infra, router}) {
  const results = [];
  const snap = await infra.call('env.snapshot'), data = snap.snapshot.data, now = snap.snapshot.virtual_now;
  for (const n of pending(data, now)) {
    let receipt;
    // One notification that cannot be published must not block the others.
    try { receipt = await router.call('router.publish', {request_id: n.notification_id, message: message(data, n)}); }
    catch (error) { results.push({notification_id: n.notification_id, error: String(error && error.message || error)}); continue; }
    const status = ['committed', 'rejected', 'unknown', 'halted'].includes(receipt.status) ? receipt.status : 'unknown';
    const current = await infra.call('env.snapshot');
    const recorded = await infra.call('env.apply_event', {expected_version: current.version, event: {
      event_id: 'dlv-' + n.notification_id + '-' + current.version.revision, at: current.snapshot.virtual_now,
      operation: 'notification.delivery_recorded',
      payload: {notification_id: n.notification_id, status, code: receipt.code || null, stop_run: receipt.stop_run === true,
        router_event_id: receipt.event_id || null}}});
    results.push({notification_id: n.notification_id, receipt, recorded: recorded.status});
    if (receipt.stop_run) break; // the run halts for reconciliation, per the Messaging rules
  }
  return results;
}

module.exports = {pending, message, deliver};
