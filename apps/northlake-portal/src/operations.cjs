'use strict';
// Agent-facing operations. Core has already checked policy, arguments, version and request_id.
const c = require('./common.cjs');
const messaging = require('./messaging.cjs');
const billing = require('./billing.cjs');
const appointments = require('./appointments.cjs');
const OPS = {
  'account.get':appointments.account,
  'messages.list':messaging.list, 'messages.get':messaging.get, 'messages.export':messaging.exportThread, 'messages.attachment.get':messaging.attachmentGet,
  'billing.list':billing.list, 'billing.get_claim':billing.getClaim, 'billing.statement':billing.statement, 'billing.requests.list':billing.requestsList,
  'providers.search':appointments.providersSearch, 'providers.get':appointments.providersGet, 'appointments.slots':appointments.slots,
  'appointments.list':appointments.list, 'appointments.get':appointments.get, 'waitlist.list':appointments.waitlistList,
  'messages.send':messaging.send, 'messages.reply':messaging.reply, 'messages.flags':messaging.flags,
  'billing.pay.preview':billing.payPreview, 'billing.pay.confirm':billing.payConfirm, 'billing.question':billing.question, 'billing.requests.create':billing.requestCreate,
  'appointments.preview':appointments.preview, 'appointments.confirm':appointments.confirm, 'appointments.cancel':appointments.cancel, 'appointments.reschedule':appointments.reschedule,
  'waitlist.join':appointments.waitlistJoin, 'waitlist.leave':appointments.waitlistLeave, 'waitlist.accept':appointments.waitlistAccept, 'waitlist.decline':appointments.waitlistDecline,
  'interstitial.acknowledge':appointments.interstitialAcknowledge
};
function handleTool(ctx, data, name, args) {
  c.guard(data, name);
  const op = name.startsWith(c.PREFIX) ? OPS[name.slice(c.PREFIX.length)] : null;
  if (!op) c.fail('unknown_tool', 'Unknown business operation.');
  const result = op(ctx, data, args);
  return {data, result};
}
module.exports = {handleTool};
