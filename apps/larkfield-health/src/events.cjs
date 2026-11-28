'use strict';
const { fail, newStep } = require('./util.cjs');
const { ms, toIso, clockInRange, runInRange } = require('./time.cjs');
const { eventTargets } = require('./guards.cjs');
const { applyDueTimers, EFFECTS } = require('./timers.cjs');
const { claimReceived } = require('./claims.cjs');
const { userConfirmed } = require('./approvals.cjs');
const P = require('./pa.cjs');
const A = require('./appeals.cjs');
const { grantChanged } = require('./grants.cjs');

const HANDLERS = {
  'claim.received': claimReceived, 'user.confirmed': userConfirmed, 'pa.submitted': P.paSubmitted, 'pa.info_requested': P.paInfoRequested, 'pa.info_provided': P.paInfoProvided,
  'pa.decided': P.paDecided, 'pa.withdrawn': P.paWithdrawn, 'pa.expedite_decided': P.paExpediteDecided,
  'appeal.info_requested': A.appealInfoRequested, 'appeal.decided': A.appealDecided, 'grant.changed': grantChanged,
};
const INTAKE = new Set(['claim.received', 'pa.submitted']);

function applyEvent(ctx, data, event, handlers = HANDLERS, effects = EFFECTS) {
  if (!runInRange(ctx.virtual_now)) fail('invalid_event', 'The App clock ' + ctx.virtual_now + ' is outside the supported range 2000-01-01 to 2200-12-31.');
  if (INTAKE.has(event.operation) && !clockInRange(ctx.virtual_now)) fail('invalid_event', 'New claims and PAs are accepted only until 2199-12-31; ' + event.operation + ' at ' + ctx.virtual_now + ' is refused.');
  const local = { ...ctx, virtual_now: toIso(ms(ctx.virtual_now)) };
  applyDueTimers(data, local.virtual_now, { effects, code: 'invalid_event' });
  eventTargets(data, event, ctx);
  const handler = handlers[event.operation];
  if (!handler) fail('invalid_event', 'Event ' + event.operation + ' is not available yet.');
  newStep(data);
  return handler(data, event.payload, local, event);
}

module.exports = { applyEvent, HANDLERS };
