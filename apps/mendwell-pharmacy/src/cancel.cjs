'use strict';
const { fail, byId } = require('./util.cjs');
const { toIso, rxExpiry } = require('./time.cjs');
const { makeToken, businessArgs, fillFacts } = require('./tokens.cjs');
const { confirmFlow } = require('./confirm.cjs');
const { liveAuthorization } = require('./payment.cjs');
const L = require('./lifecycle.cjs');

function timers(data, f) {
  const out = [];
  if (L.UNMADE.has(f.state)) out.push({ kind: 'expiry', due_at: toIso(rxExpiry(L.rxOf(data, f).written_on)) });
  const remaining = f.hold ? f.hold.remaining : {};
  for (const [kind, field, rest] of [['review', 'review_due_at', 'review_ms'], ['resubmission', 'resubmission_due_at', null], ['warning', 'warning_due_at', 'warning_ms'], ['return', 'return_due_at', 'return_ms']]) {
    if (f[field] !== null) out.push({ kind, due_at: f[field] });
    else if (rest && remaining[rest] !== undefined) out.push({ kind, remaining_ms: remaining[rest] });
  }
  return out;
}

function changes(data, f) {
  const claim = L.claimOf(data, f), auth = liveAuthorization(data, f);
  const pr = f.plan_request_id === null ? null : byId(data.plan_requests, 'plan_request_id', f.plan_request_id);
  return {
    claim_reversal: claim && claim.result === 'paid' && !f.cash && claim.reversed_at === null ? { claim_id: claim.claim_id } : null,
    authorization_void: auth ? { authorization_id: auth.authorization_id, amount_cents: auth.amount_cents } : null,
    plan_request_withdrawal: pr && pr.state === 'pending' ? { plan_request_id: pr.plan_request_id } : null,
    cancelled_timers: timers(data, f),
  };
}

function token(ctx, data, g, args, f, c) {
  return makeToken({ ctx, data, actor: g.actor, action: 'cancel', kind: 'fill', subject: fillFacts(data, f), args: businessArgs(args, ['fill_id']), targetVersion: f.fill_version, changes: c });
}

function stateCheck(f) {
  if (L.TERMINAL.has(f.state)) fail('invalid_state', 'Fill ' + f.fill_id + ' is already ' + f.state + '.');
}

function cancelPreview(ctx, data, args, g) {
  stateCheck(g.fill);
  const c = changes(data, g.fill);
  return { preview: { token: token(ctx, data, g, args, g.fill, c), changes: c } };
}

function cancelConfirm(ctx, data, args, g) {
  const f = g.fill;
  return confirmFlow({
    data, now: g.now, at: g.at, token: args.token,
    currentToken: () => token(ctx, data, g, args, f, changes(data, f)),
    checkState: () => stateCheck(f),
    commit: () => { L.cancel(data, f, g.at, 'agent'); return f; },
  }).result;
}

module.exports = { cancelPreview, cancelConfirm, changes };
