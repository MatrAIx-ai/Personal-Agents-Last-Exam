'use strict';
// Runner helper, not an MCP tool. Core 1.2 exposes only the fixed Infra lifecycle operations,
// so the host finds transfers due for delivery in `env.snapshot`, reads each message with
// `waypoint.transfer.outbound`, publishes it with `router.publish`, and records the verified
// outcome with the event built here. Receiver credit and sender settlement are separate commits.
const ms = value => Date.parse(value);

// Pending transfers whose release time has come, oldest first.
function deliverable(snapshotData, now) {
  return snapshotData.transfers
    .filter(t => t.status === 'pending' && ms(t.available_at) <= ms(now))
    .sort((a, b) => ms(a.available_at) - ms(b.available_at) || a.id.localeCompare(b.id));
}

// Router outcomes that prove the credit was not applied anywhere, so a refund is safe.
const DEFINITIVE_REJECTIONS = ['receiver_rejected', 'recipient_unavailable', 'recipient_not_authorized', 'incompatible_contract'];

// The settle event for one publish result, or null when the outcome is not known: then the
// transfer stays pending and the run stops for reconciliation (no refund, no new message ID).
function settleEvent(transfer, receipt, at) {
  const base = {event_id:'settle-' + transfer.id, at, operation:'waypoint.transfer.settle'};
  if (receipt.status === 'committed') {
    return {...base, payload:{transfer_id:transfer.id, outcome:'credited',
      receipt:{event_id:receipt.event_id, target_app_id:receipt.target.app_id, target_account_id:receipt.target.account_id}}};
  }
  if (receipt.status === 'rejected' && DEFINITIVE_REJECTIONS.includes(receipt.code)) {
    return {...base, payload:{transfer_id:transfer.id, outcome:'rejected',
      rejection:{code:receipt.code, reason:typeof receipt.reason === 'string' ? receipt.reason : ''}}};
  }
  return null;
}

module.exports = {deliverable, settleEvent, DEFINITIVE_REJECTIONS};
