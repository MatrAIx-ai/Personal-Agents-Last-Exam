'use strict';
// Notification records: one per recipient, with an ID derived from the booking, kind, sequence and
// recipient. Title, body and time are frozen at creation so a delivery retry sends identical bytes.
// Riders get pickup details only (no fare, payment method or other bookings); sharees get status,
// plus vehicle and ETA only with scope status_and_eta.
const {dollars, personName, mailAccount, flightLabel} = require('./common.cjs');
const {render, human, ms} = require('./time.cjs');
const {NOTIFICATION_KINDS} = require('./catalog.cjs');
const {tz, freeUntil} = require('./bookings.cjs');

const short = personId => personId.replace(/^person-/, '');
const placeName = (data, id) => data.places.find(p => p.place_id === id)?.name || id;
const airportName = (data, id) => { const p = data.places.find(x => x.place_id === id); return p?.airport_name || p?.name || id; };
const card = (data, b) => { const m = data.payment_methods.find(x => x.payment_method_id === b.payment_method_id); return m ? m.brand + ' ••' + m.last4 : 'your card'; };
const vehicle = b => (b.vehicle ? `${b.vehicle.color} ${b.vehicle.make_model}, plate ${b.vehicle.plate}` : null);

function id(data, b, kind, recipient) {
  const word = NOTIFICATION_KINDS[kind].short;
  const seq = data.notifications.filter(n => n.booking_id === b.booking_id && n.kind === kind && n.recipient_person_id === recipient).length + 1;
  return {notification_id: 'n-' + b.booking_id.replace(/-/g, '') + '-' + word + '-' + seq + '-' + short(recipient), seq};
}

// Text for one recipient. `info` carries the event-specific facts.
function content(ctx, data, b, kind, role, info, share) {
  const zone = tz(data, b), when = v => human(v, zone);
  const from = placeName(data, b.pickup_place_id), to = placeName(data, b.dropoff_place_id);
  const booker = personName(ctx, data.owner_person_id), rider = personName(ctx, b.rider_person_id);
  const withEta = share?.scope === 'status_and_eta';
  switch (kind) {
    case 'booking_confirmed':
      return {title: `Ride booked: ${from} to ${to}`,
        body: `Booking ${b.booking_id}: ${b.rider_person_id === data.owner_person_id ? 'your' : rider + '\'s'} pickup at ${from} on ${when(b.pickup_at)} for ${to}. ` +
          `Option ${b.option}, ${b.passengers} passenger(s), ${b.bags} bag(s)${b.child_seats ? `, ${b.child_seats} child seat(s)` : ''}. ` +
          `Fare ${dollars(b.fare.fare_cents)}, held on ${card(data, b)}. Free cancellation until ${when(freeUntil(b))}.` +
          (b.flight ? ` Tracking flight ${flightLabel(b.flight)}.` : '')};
    case 'booking_changed':
      return {title: `Ride changed: pickup ${when(b.pickup_at)}`,
        body: `Booking ${b.booking_id} now picks up at ${from} on ${when(b.pickup_at)} for ${to}. ${info.reason || ''}`.trim() +
          ` Fare ${dollars(b.fare.fare_cents)}.`};
    case 'needs_attention': {
      const r = b.attention.reason, f = info.flight;
      if (r === 'airport_changed') {
        return {title: `Pickup needs attention: flight now arrives at ${f.arrival_code}`,
          body: `Your pickup ${b.booking_id} is booked at ${from} for ${when(b.pickup_at)}. Flight ${flightLabel(f)} now arrives at ` +
            `${airportName(data, f.arrival_place_id)} at ${human(f.estimated_arrival, zone).replace(/^\w+ \w+ \d+, /, '')} on ${human(f.estimated_arrival, zone).replace(/, .*$/, '')}. ` +
            'The booking has not been moved. You can cancel it free of charge or book a pickup at ' + f.arrival_code + '.'};
      }
      const why = {large_shift: `flight ${f && flightLabel(f)} now arrives more than ${Math.round(info.limit_min / 60)} hours from the booked pickup time`,
        no_vehicle_after_shift: `no ${b.option} vehicle is available at the new pickup time`,
        flight_cancelled: `flight ${f && flightLabel(f)} was cancelled`, driver_cancelled: 'the driver cancelled and no replacement was found'}[r];
      return {title: 'Pickup needs attention', body: `Your pickup ${b.booking_id} at ${from} on ${when(b.pickup_at)} needs attention: ${why}. ` +
        (b.attention.proposed_pickup_at ? `Proposed pickup: ${when(b.attention.proposed_pickup_at)}. ` : '') +
        'The booking has not been moved. You can cancel it free of charge' + (r === 'large_shift' ? ', confirm the proposed time,' : '') + ' or change it.'};
    }
    case 'booking_cancelled':
      return {title: `Ride cancelled: ${b.booking_id}`, body: `Booking ${b.booking_id} from ${from} on ${when(b.pickup_at)} was cancelled. ` +
        (info.fee_cents ? `A cancellation fee of ${dollars(info.fee_cents)} was charged to ${card(data, b)}.` : 'No cancellation fee was charged.')};
    case 'driver_assigned':
      return {title: `Driver assigned: ${b.driver.first_name}`, body: `${b.driver.first_name} is driving ${vehicle(b)}. ` +
        `Pickup at ${from} on ${when(b.pickup_at)}; estimated arrival ${when(b.eta)}.`};
    case 'driver_arrived':
      return {title: 'Your driver has arrived', body: `${b.driver.first_name} (${vehicle(b)}) is at ${b.pickup_point || from}.` +
        (info.free_wait_end ? ` Free waiting until ${when(info.free_wait_end)}.` : '')};
    case 'receipt': {
      const lines = info.lines.map(l => `${l.label}: ${dollars(l.amount_cents)}`).join('; ');
      return {title: `Receipt for ${b.booking_id}: ${dollars(info.total_cents)}`,
        body: `Ride ${b.booking_id} from ${from} to ${to} on ${when(b.pickup_at)}. ${lines}. Total ${dollars(info.total_cents)} on ${card(data, b)}. ` +
          `Profile: ${b.expense.profile}${b.expense.memo ? `; memo: ${b.expense.memo}` : ''}.`};
    }
    case 'refund_settled':
      return {title: `Refund settled: ${dollars(info.amount_cents)}`, body: `A refund of ${dollars(info.amount_cents)} for ride ${b.booking_id} was returned to ${card(data, b)}.`};
    case 'pickup_details':
      return info.cancelled
        ? {title: 'Your ride was cancelled', body: `${booker} cancelled your pickup at ${from} on ${when(b.pickup_at)}.`}
        : {title: `Pickup details from ${booker}`, body: `${booker} booked a ride for you: pickup at ${from} on ${when(b.pickup_at)}, to ${to}. ` +
          `Option ${b.option}${b.child_seats ? ` with ${b.child_seats} child seat(s)` : ''}.` + (b.vehicle ? ` Vehicle: ${vehicle(b)}.` : '')};
    case 'share_started':
      return {title: `${booker} is sharing a ride with you`, body: `You can follow ${rider}'s ride from ${from} to ${to}, pickup ${when(b.pickup_at)}. ` +
        `Updates until ${when(share.until)}.`};
    case 'share_update': {
      const status = {driver_assigned: 'A driver has been assigned', driver_arrived: 'The driver has arrived at the pickup', completed: 'The ride is complete'}[info.status];
      return {title: `Ride update: ${status.toLowerCase()}`, body: `${rider}'s ride from ${from} to ${to}: ${status}.` +
        (withEta && info.status !== 'completed' ? ` Vehicle: ${vehicle(b)}. ETA ${when(b.eta)}.` : '')};
    }
    default: throw new Error('unknown kind ' + kind);
  }
}

function record(ctx, data, b, kind, recipient, role, info = {}, share = null) {
  const {notification_id, seq} = id(data, b, kind, recipient);
  const {title, body} = content(ctx, data, b, kind, role, info, share);
  const n = {notification_id, booking_id: b.booking_id, kind, seq, recipient_person_id: recipient, recipient_role: role,
    share_id: share ? share.share_id : null, created_at: render(ctx.virtual_now, tz(data, b)), title, body,
    status: mailAccount(ctx, recipient) ? 'pending_delivery' : 'no_recipient_channel', outcome: null};
  data.notifications.push(n);
  return n;
}

const activeShares = (ctx, data, b) => data.shares.filter(s => s.booking_id === b.booking_id && s.status === 'active' && ms(s.until) > ms(ctx.virtual_now));

// Send a notification kind to everyone who should receive it for this booking.
function notify(ctx, data, b, kind, info = {}) {
  const booker = data.owner_person_id, otherRider = b.rider_person_id !== booker ? b.rider_person_id : null;
  const out = [];
  if (['driver_assigned', 'driver_arrived'].includes(kind)) {
    out.push(record(ctx, data, b, kind, booker, 'booker', info));
    if (otherRider) out.push(record(ctx, data, b, kind, otherRider, 'rider', info));
  } else if (kind === 'pickup_details') {
    if (otherRider) out.push(record(ctx, data, b, kind, otherRider, 'rider', info));
  } else if (kind === 'share_update') {
    for (const s of activeShares(ctx, data, b)) out.push(record(ctx, data, b, kind, s.person_id, 'sharee', info, s));
  } else {
    out.push(record(ctx, data, b, kind, booker, 'booker', info));
  }
  return out;
}
const shareStarted = (ctx, data, b, share) => record(ctx, data, b, 'share_started', share.person_id, 'sharee', {}, share);

module.exports = {notify, shareStarted, record};
