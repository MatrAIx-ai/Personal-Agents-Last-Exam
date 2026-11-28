'use strict';
const { fail, nextId, bump, byId } = require('./util.cjs');
const { fromLocal } = require('./time.cjs');
const { makeToken, businessArgs, fillFacts } = require('./tokens.cjs');
const { confirmFlow } = require('./confirm.cjs');
const L = require('./lifecycle.cjs');

function cardEnd(card) {
  const year = card.exp_month === 12 ? card.exp_year + 1 : card.exp_year, month = card.exp_month === 12 ? 1 : card.exp_month + 1;
  return fromLocal(year + '-' + String(month).padStart(2, '0') + '-01', '00:00', 'first');
}

const cardUsable = (card, now) => card.status === 'active' && now < cardEnd(card);
const liveAuthorization = (data, f) => {
  const auth = f.authorization_id === null ? null : byId(data.authorizations, 'authorization_id', f.authorization_id);
  return auth && auth.state === 'live' ? auth : null;
};

function ownCard(data, args, g) {
  const card = byId(data.cards, 'card_id', args.card_id);
  if (!card) fail('not_found', 'No card ' + args.card_id + '.');
  if (card.owner_id !== g.actor) fail('not_authorized', 'The account holder can prepay only with their own card.');
  return card;
}

function stateCheck(data, f) {
  if (f.hold !== null && !L.TERMINAL.has(f.state)) fail('on_hold', 'Fill ' + f.fill_id + ' is on hold.');
  if (f.state !== 'ready') fail('invalid_state', 'Prepay applies only to a ready fill; fill ' + f.fill_id + ' is ' + f.state + '.');
  if (!(f.amount_due_cents > 0)) fail('invalid_state', 'Fill ' + f.fill_id + ' has nothing to pay.');
  if (liveAuthorization(data, f)) fail('invalid_state', 'Fill ' + f.fill_id + ' already has a live prepayment.');
}

const changes = (args, f) => ({ card_id: args.card_id, amount_cents: f.amount_due_cents });

function token(ctx, data, g, args, f) {
  return makeToken({ ctx, data, actor: g.actor, action: 'prepay', kind: 'fill', subject: fillFacts(data, f), args: businessArgs(args, ['fill_id', 'card_id']), targetVersion: f.fill_version, changes: changes(args, f) });
}

function prepayPreview(ctx, data, args, g) {
  ownCard(data, args, g);
  stateCheck(data, g.fill);
  return { preview: { token: token(ctx, data, g, args, g.fill), required_confirmer: g.actor, changes: changes(args, g.fill) } };
}

function prepayConfirm(ctx, data, args, g) {
  const f = g.fill;
  let card = null;
  return confirmFlow({
    data, now: g.now, at: g.at, token: args.token, confirmer: g.actor,
    authorize: () => { card = ownCard(data, args, g); },
    currentToken: () => token(ctx, data, g, args, f),
    checkState: () => stateCheck(data, f),
    pay: () => { if (!cardUsable(card, g.now)) fail('payment_failed', 'The card ending ' + card.last4 + ' was declined or has expired; nothing was authorized.'); },
    commit: () => {
      const auth = { authorization_id: nextId(data, 'au'), fill_id: f.fill_id, card_id: card.card_id, amount_cents: f.amount_due_cents, state: 'live', at: g.at, ended_at: null };
      data.authorizations.push(auth);
      f.authorization_id = auth.authorization_id;
      bump(data, f);
      return f;
    },
  }).result;
}

module.exports = { cardUsable, cardEnd, liveAuthorization, prepayPreview, prepayConfirm };
