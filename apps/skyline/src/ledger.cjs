'use strict';
// Points ledger and payment-label charges. Points are integers; money is integer cents in USD.
const c = require('./common.cjs');

function post(ctx, data, kind, points, ref, id = c.nextId(data, 'ledger')) {
  const after = data.balance + points;
  if (after < 0) c.fail('insufficient_points', 'The balance does not cover ' + -points + ' points.');
  data.ledger.push({id, at:ctx.virtual_now, kind, points, balance_after:after, ref});
  data.balance = after;
  c.log(ctx, 'skyline.ledger_' + kind, {record_id:id, points});
  return id;
}

function requireLabel(data, label) {
  if (!data.payment_labels.includes(label)) c.fail('invalid_payment_label', 'Unknown payment label.');
}

function charge(ctx, data, label, amount, description, ref) {
  requireLabel(data, label);
  const id = c.nextId(data, 'charge');
  data.charges.push({id, at:ctx.virtual_now, label, amount_cents:amount, currency:'USD', description, ref});
  c.log(ctx, 'skyline.charge', {record_id:id, amount_cents:amount});
  return id;
}

module.exports = {post, requireLabel, charge};
