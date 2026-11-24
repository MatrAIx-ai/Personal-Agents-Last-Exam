'use strict';
// Member notices and their Mail messages (Mail's receive contract urn:pale:email-payload:1).
// Notice text is plain and short and never carries secrets.
const crypto = require('node:crypto');
const c = require('./common.cjs');

const when = iso => iso.slice(0, 16).replace('T', ' ') + ' ' + iso.slice(-6).replace(/^z$/i, 'UTC');
const points = n => n.toLocaleString('en-US');
const dollars = cents => '$' + (cents / 100).toFixed(2);
const leg = f => f.flight_number + ' ' + f.origin + ' ' + when(f.departs_at) + ' to ' + f.dest + ' ' + when(f.arrives_at);

function create(ctx, data, kind, title, body, ref) {
  const n = {id:c.nextId(data, 'notice'), created_at:ctx.virtual_now, updated_at:ctx.virtual_now, history:[], kind, title, body, ref};
  c.stamp(ctx, n, 'notice_' + kind);
  data.notices.push(n);
  return n;
}

function confirmed(ctx, data, booking, flights) {
  const names = booking.passenger_ids.map(id => data.passengers.find(p => p.id === id).name).join(', ');
  const seats = flights.map(f => f.flight_number + ' ' + booking.seats.filter(s => s.flight_id === f.id).map(s => s.seat).join(' ')).join('; ');
  const body = ['Booking ' + booking.locator + ' is ticketed in ' + booking.cabin + ' for ' + names + '.',
    ...flights.map(leg), 'Seats: ' + seats + '.',
    'Paid ' + points(booking.points) + ' points and ' + dollars(booking.partner_fee_cents + booking.taxes_cents) +
      ' in partner fee and taxes to ' + booking.payment_label + '.'].join('\n');
  return create(ctx, data, 'booking_confirmed', 'Award ticketed: ' + flights[0].origin + ' to ' + flights.at(-1).dest + ', ' + booking.locator,
    body, {booking_id:booking.id, change_id:null});
}

function scheduleChange(ctx, data, booking, changed, flightOf) {
  const ch = booking.change;
  const why = ch.reason === 'illegal_connection' ? 'Your connection no longer works with the new times.' : 'Your flight times changed.';
  const options = ch.alternatives.length
    ? ch.alternatives.map(a => 'Option ' + a.id + ': ' + a.flight_ids.map(id => leg(flightOf(id))).join('; ') + '.')
    : ['No alternative flight is offered.'];
  const body = ['Flight ' + changed.flight_number + ' on booking ' + booking.locator + ' now departs ' + when(changed.departs_at) +
      ' and arrives ' + when(changed.arrives_at) + '.', why, ...options,
    'Accept a free alternative before ' + when(ch.deadline) + '. Until then you can also cancel with a refund of points, taxes and the partner booking fee.'].join('\n');
  return create(ctx, data, 'schedule_change', 'Schedule change for booking ' + booking.locator, body,
    {booking_id:booking.id, change_id:ch.change_id});
}

function outbound(data, notice) {
  if (data.mail_account_id === null) c.fail('invalid_state', 'This account has no Mail account for notices.');
  const payload = {channel:'channel.email', recipient:{kind:'app_account_ref', app_id:'mail', id:data.mail_account_id},
    source_object:{app_id:'skyline', account_id:data.account_id, object_type:'notice', object_id:notice.id},
    content:{title:notice.title, body:{format:'text/plain', text:notice.body}, asset_ids:[]}, extensions:[]};
  // Stable retries: the same notice and payload always produce the same event ID.
  const id = 'skyline-notice-' + crypto.createHash('sha256').update(JSON.stringify([notice.id, payload])).digest('hex').slice(0, 40);
  return {specversion:'1.0', id, source:'urn:pale:app:skyline:account:' + encodeURIComponent(data.account_id),
    type:'org.pale.mail.notification.v1', time:notice.created_at, datacontenttype:'application/json',
    dataschema:'urn:pale:email-payload:1', data:payload};
}

module.exports = {confirmed, scheduleChange, outbound};
