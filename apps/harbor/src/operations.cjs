'use strict';
// Agent tools. Prices use the category in effect at ctx.virtual_now and are locked on the
// reservation; "today" is always the calendar date at the hotel.
const c = require('./common.cjs');
const d = require('./dates.cjs');
const p = require('./program.cjs');
const {notice, outbound} = require('./notices.cjs');

function ledger(ctx, data, kind, points, ref) {
  data.balance += points;
  const entry = {id:c.nextId(data.ledger, 'ledger'), at:ctx.virtual_now, kind, points, balance_after:data.balance, ref};
  data.ledger.push(entry);
  c.log(ctx, 'harbor.ledger_' + kind, {record_id:entry.id, reservation_id:ref?.reservation_id});
  return entry;
}

function charge(ctx, data, label, cents, description, reservationId) {
  const item = {id:c.nextId(data.charges, 'charge'), at:ctx.virtual_now, label, amount_cents:cents, currency:'USD', description,
    ref:{reservation_id:reservationId}};
  data.charges.push(item);
  c.log(ctx, 'harbor.charge', {record_id:item.id, reservation_id:reservationId});
  return item;
}

function search(ctx, data, args) {
  const nights = p.stay(args.check_in, args.check_out), city = args.city.trim().toLowerCase();
  const hotels = data.hotels.filter(h => h.city.toLowerCase() === city).map(hotel => {
    const category = p.categoryAt(hotel, ctx.virtual_now), blackout = p.blackoutNights(hotel, args.check_in, nights);
    const open = args.check_in > d.localDate(ctx.virtual_now, hotel.timezone);
    const eligible = blackout.length || !open ? [] : data.certificates
      .filter(cert => !p.certificateRule(cert, {nights, category, checkIn:args.check_in})).map(cert => cert.id);
    return {hotel_id:hotel.id, name:hotel.name, city:hotel.city, timezone:hotel.timezone, category,
      upcoming_category_change:c.copy(p.upcomingChange(hotel, ctx.virtual_now)),
      dates_open:open, award_available:!blackout.length,
      blackout_nights:blackout, prices:p.quote(data, hotel, category, nights), eligible_certificate_ids:eligible};
  }).sort((a, b) => a.category - b.category || a.hotel_id.localeCompare(b.hotel_id));
  return {city:args.city, check_in:args.check_in, check_out:args.check_out, nights, priced_at:ctx.virtual_now, hotels};
}

function paymentArgs(data, payment) {
  const has = key => payment[key] !== undefined;
  if (payment.method === 'certificate' && (!has('certificate_id') || has('payment_label'))) c.fail('invalid_arguments', 'A certificate stay takes certificate_id and no payment_label.');
  if (payment.method === 'points' && (has('certificate_id') || has('payment_label'))) c.fail('invalid_arguments', 'A points stay takes neither certificate_id nor payment_label.');
  if (['points_cash', 'cash'].includes(payment.method) && (!has('payment_label') || has('certificate_id'))) c.fail('invalid_arguments', 'Points + Cash and cash stays take payment_label and no certificate_id.');
  if (has('payment_label') && !data.payment_labels.includes(payment.payment_label)) c.fail('invalid_payment_label', 'Unknown payment label for this account.');
}

function book(ctx, data, args) {
  const hotel = c.find(data.hotels, args.hotel_id, 'Hotel'), nights = p.stay(args.check_in, args.check_out);
  const today = d.localDate(ctx.virtual_now, hotel.timezone);
  if (args.check_in <= today) c.fail('invalid_arguments', 'Check-in must be after today\'s date at the hotel (' + today + ').');
  const pay = args.payment, method = pay.method;
  paymentArgs(data, pay);
  if (method !== 'cash') {
    const blocked = p.blackoutNights(hotel, args.check_in, nights);
    if (blocked.length) c.fail('award_unavailable', 'No award nights on blackout dates: ' + blocked.join(', ') + '.');
  }
  const category = p.categoryAt(hotel, ctx.virtual_now), q = p.quote(data, hotel, category, nights);
  let points = 0, cash = 0, cert = null;
  if (method === 'certificate') {
    cert = c.find(data.certificates, pay.certificate_id, 'Certificate');
    const rule = p.certificateRule(cert, {nights, category, checkIn:args.check_in});
    if (rule) c.fail('certificate_invalid', p.ruleMessage(cert, rule));
  } else if (method === 'points') points = q.points.points;
  else if (method === 'points_cash') {
    if (!q.points_cash) c.fail('invalid_arguments', 'Points + Cash is not offered at category ' + category + '.');
    points = q.points_cash.points; cash = q.points_cash.cash_cents;
  } else cash = q.cash.cash_cents;
  if (points > data.balance) c.fail('insufficient_points', 'This stay needs ' + points + ' points; the balance is ' + data.balance + '.');

  const id = c.nextId(c.recordIds(data), 'res');
  const r = {id, confirmation:p.confirmation(data.account_id, id), hotel_id:hotel.id, check_in:args.check_in, check_out:args.check_out,
    nights, status:'confirmed', payment:{method, certificate_id:pay.certificate_id ?? null, payment_label:pay.payment_label ?? null},
    category_locked:category, points, cash_cents:cash, charge_ids:[], created_at:ctx.virtual_now, updated_at:ctx.virtual_now, history:[]};
  c.stamp(ctx, r, 'booked', {hotel_id:hotel.id, method});
  data.reservations.push(r);
  if (points) {
    ledger(ctx, data, 'redeem', -points, {reservation_id:id});
    data.last_activity_at = ctx.virtual_now; // a redemption is account activity
  }
  let chargeId = null;
  if (cash) {
    chargeId = charge(ctx, data, pay.payment_label, cash, hotel.name + ', ' + nights + (nights === 1 ? ' night' : ' nights'), id).id;
    r.charge_ids.push(chargeId);
  }
  if (cert) {
    cert.status = 'used'; cert.reservation_id = id;
    c.stamp(ctx, cert, 'used', {reservation_id:id});
  }
  const paid = method === 'certificate' ? 'Paid with a free-night certificate.' : method === 'points' ? 'Paid with ' + c.thousands(points) + ' points.' :
    method === 'points_cash' ? 'Paid with ' + c.thousands(points) + ' points and ' + c.usd(cash) + ' charged to ' + pay.payment_label + '.' :
    'Paid ' + c.usd(cash) + ', charged to ' + pay.payment_label + '.';
  const n = notice(ctx, data, 'booking_confirmed', 'Reservation confirmed: ' + hotel.name,
    'Confirmation ' + r.confirmation + '. Check-in ' + r.check_in + ', check-out ' + r.check_out + ' (' + nights + (nights === 1 ? ' night' : ' nights') +
    ', Category ' + category + '). ' + paid, {object_type:'reservation', object_id:id});
  return {id, confirmation:r.confirmation, category_locked:category, nights, points, cash_cents:cash, charge_id:chargeId,
    certificate_id:r.payment.certificate_id, balance:data.balance, last_activity_at:data.last_activity_at, notice_id:n.id};
}

function cancel(ctx, data, args) {
  const r = c.find(data.reservations, args.reservation_id, 'Reservation');
  if (r.status !== 'confirmed') c.fail('invalid_state', 'Only a confirmed reservation can be cancelled.');
  const hotel = c.find(data.hotels, r.hotel_id, 'Hotel'), today = d.localDate(ctx.virtual_now, hotel.timezone);
  if (today >= r.check_in) c.fail('invalid_state', 'Cancellation closes on the check-in date at the hotel (today is ' + today + ').');
  // A refund returns points but is not account activity: last_activity_at stays.
  if (r.points) ledger(ctx, data, 'refund', r.points, {reservation_id:r.id});
  let refundId = null;
  if (r.cash_cents) {
    refundId = charge(ctx, data, r.payment.payment_label, -r.cash_cents, 'Refund: ' + hotel.name, r.id).id;
    r.charge_ids.push(refundId);
  }
  let certificate = null;
  if (r.payment.method === 'certificate') {
    const cert = c.find(data.certificates, r.payment.certificate_id, 'Certificate');
    cert.status = p.certificateAfterCancel(cert, today); cert.reservation_id = null;
    c.stamp(ctx, cert, cert.status === 'active' ? 'restored' : 'expired', {reservation_id:r.id});
    certificate = {id:cert.id, status:cert.status};
  }
  r.status = 'cancelled';
  c.stamp(ctx, r, 'cancelled');
  return {id:r.id, refunded_points:r.points, refunded_cash_cents:r.cash_cents, refund_charge_id:refundId, certificate, balance:data.balance};
}

function handleTool(ctx, data, name, args) {
  if (name === 'harbor.account') {
    return {data, result:{account_id:data.account_id, member_number:data.member_number, balance:data.balance,
      last_activity_at:data.last_activity_at, expires_at:p.expiresAt(data), forfeited_at:data.forfeited_at,
      inactivity_months:data.inactivity_months, payment_labels:c.copy(data.payment_labels), certificates:c.copy(data.certificates),
      ledger:c.copy(data.ledger), charges:c.copy(data.charges)}};
  }
  if (name === 'harbor.search') return {data, result:search(ctx, data, args)};
  if (name === 'harbor.reservations') {
    if (args.id !== undefined) {
      const r = c.find(data.reservations, args.id, 'Reservation');
      const match = !args.status || r.status === args.status;
      return {data, result:match ? {items:[c.copy(r)], item:c.copy(r)} : {items:[]}};
    }
    const items = data.reservations.filter(r => !args.status || r.status === args.status)
      .sort((a, b) => a.check_in.localeCompare(b.check_in) || a.id.localeCompare(b.id));
    return {data, result:{items:c.copy(items)}};
  }
  if (name === 'harbor.notices.list') {
    const items = [...data.notices].sort((a, b) => c.ms(b.created_at) - c.ms(a.created_at) || b.id.localeCompare(a.id));
    return {data, result:{items:c.copy(items)}};
  }
  if (name === 'harbor.notices.outbound') return {data, result:{message:outbound(data, c.find(data.notices, args.id, 'Notice'))}};
  if (name === 'harbor.book') return {data, result:book(ctx, data, args)};
  if (name === 'harbor.cancel') return {data, result:cancel(ctx, data, args)};
  c.fail('unknown_tool', 'Unknown harbor operation.');
}

module.exports = {handleTool};
