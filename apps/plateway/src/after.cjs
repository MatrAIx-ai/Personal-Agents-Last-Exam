'use strict';
const { fail, textLength } = require('./util.cjs');
const { ms } = require('./time.cjs');
const { orderOf, refunded, view, addRefund, notBeforeHistory } = require('./orders.cjs');
const { appendNotice } = require('./notices.cjs');
const HOUR = 3600000;
const REPORT_WINDOW = 48 * HOUR;
const RATING_WINDOW = 30 * 24 * HOUR;
const RATING_TEXT_LIMIT = 500;

function deliveredWithin(order, now, window) {
  notBeforeHistory(order, now);
  if (order.status !== 'delivered') fail('invalid_state', 'The order has not been delivered.');
  const elapsed = ms(now) - ms(order.delivered_at);
  if (elapsed < 0) fail('invalid_state', 'The order is recorded as delivered after the current time.');
  if (elapsed > window) fail('window_closed', 'The window for this request has closed.');
}

function reportIssue(ctx, data, args) {
  const ids = args.lines.map(l => l.line_id);
  if (new Set(ids).size !== ids.length) fail('invalid_arguments', 'A line may be named once per report.');
  const order = orderOf(data, args.order_id);
  deliveredWithin(order, ctx.virtual_now, REPORT_WINDOW);
  const lines = args.lines.map(entry => {
    const line = order.lines.find(l => l.id === entry.line_id) || fail('not_found', 'Line ' + entry.line_id + ' is not on this order.');
    if (line.removed) fail('invalid_state', 'Line ' + line.id + ' was removed before delivery.');
    if (line.report) fail('duplicate_request', 'Line ' + line.id + ' was already reported.');
    return { line, kind: entry.kind };
  });
  let total = 0;
  for (const { line, kind } of lines) {
    const amount = Math.min(line.subtotal_cents + line.tax_cents, order.charge.amount_cents - refunded(order));
    line.report = { kind, at: ctx.virtual_now };
    addRefund(data, order, amount, 'line_reported', line.id, ctx.virtual_now);
    order.timeline.push({ at: ctx.virtual_now, status: null, note: 'Line ' + line.id + ' reported ' + kind + (amount ? ' and refunded' : '; no refund due') });
    appendNotice(data, 'notice.item_refunded', order, ctx.virtual_now, { line_id: line.id, line_name: line.name, amount_cents: amount, action: 'reported ' + kind });
    total += amount;
  }
  return { order_id: order.id, refunded_cents: total, order: view(data, order) };
}

function rate(ctx, data, args) {
  const order = orderOf(data, args.order_id);
  deliveredWithin(order, ctx.virtual_now, RATING_WINDOW);
  if (order.rating) fail('duplicate_request', 'The order was already rated.');
  if (args.text !== undefined && textLength(args.text) > RATING_TEXT_LIMIT) fail('invalid_arguments', 'Rating text has at most ' + RATING_TEXT_LIMIT + ' characters.');
  order.rating = { stars: args.stars, text: args.text ?? null, at: ctx.virtual_now };
  order.timeline.push({ at: ctx.virtual_now, status: null, note: 'Rated ' + args.stars + ' stars' });
  return { order_id: order.id, order: view(data, order) };
}
module.exports = { reportIssue, rate };
