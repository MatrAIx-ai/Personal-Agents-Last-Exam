'use strict';
const { fail, newStep } = require('./util.cjs');
const { ms, toIso, clockInRange } = require('./time.cjs');
const { applyDueTimers } = require('./timers.cjs');
const { eventTargets } = require('./guards.cjs');
const { rxReceived, renewalReplied } = require('./rx.cjs');
const { planDecided } = require('./requests.cjs');
const { holdPlaced, holdReleased, storeRestocked } = require('./holds.cjs');
const { grantChanged } = require('./grants.cjs');
const { userConfirmed } = require('./approvals.cjs');
const { collectionAttempted } = require('./collection.cjs');

const HANDLERS = {
  'rx.received': rxReceived,
  'renewal.replied': renewalReplied,
  'plan.decided': planDecided,
  'fill.hold_placed': holdPlaced,
  'fill.hold_released': holdReleased,
  'store.restocked': storeRestocked,
  'grant.changed': grantChanged,
  'user.confirmed': userConfirmed,
  'fill.collection_attempted': collectionAttempted,
};

function applyEvent(ctx, data, event, handlers = HANDLERS) {
  if (!clockInRange(ctx.virtual_now)) fail('invalid_event', 'The App clock ' + ctx.virtual_now + ' is outside the supported range 2000-01-01 to 2199-12-31.');
  const local = { ...ctx, virtual_now: toIso(ms(ctx.virtual_now)) };
  applyDueTimers(data, local.virtual_now);
  eventTargets(data, event);
  const handler = handlers[event.operation];
  if (!handler) fail('invalid_event', 'Event ' + event.operation + ' is not available yet.');
  newStep(data);
  return handler(data, event.payload, local, event);
}

module.exports = { applyEvent, HANDLERS };
