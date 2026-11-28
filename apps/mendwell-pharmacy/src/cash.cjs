'use strict';
const { fail, bump } = require('./util.cjs');
const { makeToken, businessArgs, fillFacts } = require('./tokens.cjs');
const { cashPrice } = require('./plans.cjs');
const L = require('./lifecycle.cjs');
const { confirmFlow } = require('./confirm.cjs');

function changes(data, f) {
  return { price_cents: cashPrice(data, f), store_id: f.store_id, resulting_state: L.hasStock(data, f) ? 'ready' : 'waiting_stock', cleared_resubmission: f.resubmission_due_at === null ? null : { due_at: f.resubmission_due_at } };
}

function token(ctx, data, g, args, f, c) {
  return makeToken({ ctx, data, actor: g.actor, action: 'cash', kind: 'fill', subject: fillFacts(data, f), args: businessArgs(args, ['fill_id']), targetVersion: f.fill_version, changes: c });
}

function stateCheck(f) {
  if (f.hold !== null && !L.TERMINAL.has(f.state)) fail('on_hold', 'Fill ' + f.fill_id + ' is on hold.');
  if (f.state !== 'claim_rejected') fail('invalid_state', 'Cash applies only to a fill whose claim was rejected; fill ' + f.fill_id + ' is ' + f.state + '.');
}

function preview(ctx, data, args, g) {
  stateCheck(g.fill);
  const c = changes(data, g.fill);
  return { preview: { token: token(ctx, data, g, args, g.fill, c), changes: c } };
}

function confirm(ctx, data, args, g) {
  const f = g.fill;
  return confirmFlow({
    data, now: g.now, at: g.at, token: args.token,
    currentToken: () => token(ctx, data, g, args, f, changes(data, f)),
    checkState: () => stateCheck(f),
    commit: () => {
      f.cash = { price_cents: cashPrice(data, f) };
      f.resubmission_due_at = null;
      bump(data, f);
      L.fundedOutcome(data, f, g.at);
      return f;
    },
  }).result;
}

module.exports = { preview, confirm };
