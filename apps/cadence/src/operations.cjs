'use strict';
// Agent-facing operations. Core has already checked policy, arguments, version and request_id.
const c = require('./common.cjs');
const catalog = require('./catalog.cjs');
const booking = require('./booking.cjs');
const plan = require('./plan.cjs');
const OPS = {
  'account.get':catalog.account, 'plan.get':catalog.planGet, 'payment_methods.list':catalog.paymentMethods,
  'classes.search':catalog.classesSearch, 'classes.get':catalog.classesGet, 'studios.get':catalog.studiosGet, 'studios.image':catalog.studiosImage,
  'reservations.list':catalog.reservationsList, 'reservations.get':catalog.reservationsGet, 'waitlist.list':catalog.waitlistList,
  'reservations.preview':booking.preview, 'reservations.confirm':booking.confirm, 'reservations.cancel_preview':booking.cancelPreview, 'reservations.cancel':booking.cancel,
  'reservations.reschedule':booking.reschedule, 'reservations.checkin':booking.checkin, 'reservations.rate':booking.rate,
  'waitlist.join':booking.waitlistJoin, 'waitlist.leave':booking.waitlistLeave, 'waitlist.accept':booking.waitlistAccept, 'waitlist.decline':booking.waitlistDecline,
  'plan.preview':plan.preview, 'plan.change':plan.change, 'plan.cancel':plan.cancel
};
function handleTool(ctx, data, name, args) {
  c.guard(data);
  const op = name.startsWith(c.PREFIX) ? OPS[name.slice(c.PREFIX.length)] : null;
  if (!op) c.fail('unknown_tool', 'Unknown business operation.');
  const result = op(ctx, data, args);
  return {data, result};
}
module.exports = {handleTool};
