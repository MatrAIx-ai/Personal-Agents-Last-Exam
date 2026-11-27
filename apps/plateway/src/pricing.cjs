'use strict';
const TAX_PERCENT = 8;
const SERVICE_PERCENT = 12;
const SMALL_ORDER_FEE = 249;
const SMALL_ORDER_LIMIT = 1200;
const roundHalfUp = (numerator, denominator) => Math.floor((2 * numerator + denominator) / (2 * denominator));
const lineTax = subtotal => roundHalfUp(subtotal * TAX_PERCENT, 100);

function totals(lines, deliveryFeeCents, tipCents) {
  const subtotal = lines.reduce((sum, l) => sum + l.subtotal_cents, 0);
  const tax = lines.reduce((sum, l) => sum + lineTax(l.subtotal_cents), 0);
  const service = roundHalfUp(subtotal * SERVICE_PERCENT, 100);
  const small = subtotal < SMALL_ORDER_LIMIT ? SMALL_ORDER_FEE : 0;
  return {
    subtotal_cents: subtotal, tax_cents: tax, service_cents: service, small_order_cents: small,
    delivery_cents: deliveryFeeCents, tip_cents: tipCents,
    total_cents: subtotal + deliveryFeeCents + service + small + tax + tipCents,
  };
}
module.exports = { totals, lineTax, roundHalfUp };
