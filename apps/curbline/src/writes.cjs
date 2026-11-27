'use strict';
// Agent writes. Each first commits what fell due at ctx.virtual_now (lapses, expired shares).
const {fail, copy, MIN, booking: getBooking, paymentMethod, place: getPlace, nextBookingId, nextShareId, nextCaseId, person} = require('./common.cjs');
const {render, ms} = require('./time.cjs');
const {POLICY} = require('./catalog.cjs');
const fare = require('./fare.cjs');
const B = require('./bookings.cjs');
const {notify, shareStarted} = require('./notify.cjs');
const {priceChange} = require('./reads.cjs');

const AGENT = 'agent';

function checkTripRef(ctx, ref) {
  if (!ref) return null;
  if (!ctx.binding.accounts.some(a => a.app_id === ref.app_id && a.account_id === ref.account_id) ||
      !(ctx.binding.objects[ref.app_id] || []).includes(ref.object_id)) fail('invalid_trip_ref', 'The external trip is not in this run\'s binding.');
  return copy(ref);
}

function create(ctx, data, args) {
  const q = fare.readQuote(args.quote_token), now = ms(ctx.virtual_now);
  if (ms(q.quoted_at) > now) fail('invalid_quote', 'The quote token is dated after the current time.');
  if (now >= fare.expiresAt(q.quoted_at, POLICY.quote_ttl_min)) fail('quote_expired', 'The quote expired; request a new quote.');
  const request = q.request, p = fare.price(ctx, data, request);
  if (p.fare.market_revision !== q.market_revision || !p.available) fail('quote_stale', 'Prices or supply changed since the quote; request a new quote.');
  if (p.fare.fare_cents !== q.fare_cents) fail('invalid_quote', 'The quote token does not match the published fare.');
  const method = paymentMethod(data, args.payment_method_id);
  if (method.declines) fail('payment_declined', 'The card was declined.');
  const rider = args.rider_person_id || data.owner_person_id;
  if (!person(ctx, rider)) fail('rider_not_found', 'The rider is not a person in this run.');
  const zone = p.route.pickup.time_zone, at = render(now, zone), pickupAt = render(request.pickup_at, zone);
  const b = {booking_id: nextBookingId(data), created_at: at, status: 'scheduled', attention: null,
    pickup_place_id: request.pickup_place_id, dropoff_place_id: request.dropoff_place_id, pickup_at: pickupAt, anchor_pickup_at: pickupAt,
    option: request.option, passengers: request.passengers, bags: request.bags, child_seats: request.child_seats,
    rider_person_id: rider, notes: args.notes ?? null, payment_method_id: method.payment_method_id,
    expense: {profile: method.profile, memo: null},
    fare: {fare_cents: p.fare.fare_cents, breakdown: p.fare.breakdown, distance_km: p.fare.km, minutes: p.fare.minutes, band: p.fare.band,
      fare_version: p.fare.fare_version, market_revision: p.fare.market_revision, quoted_at: render(q.quoted_at, zone)},
    flight: request.flight ? copy(request.flight) : null, flight_tracking: !!request.flight,
    pickup_buffer_min: request.flight ? request.pickup_buffer_min : null, external_trip_ref: checkTripRef(ctx, args.external_trip_ref),
    driver: null, vehicle: null, eta: null, arrived_at: null, pickup_point: null, started_at: null, completed_at: null, trip: null,
    wait_fee_cents: 0, overlaps_with: [], revision: 1, history: []};
  B.history(b, {at, actor: AGENT, action: 'created', to: 'scheduled', details: {option: b.option, fare_cents: b.fare.fare_cents, warnings: p.warnings}});
  data.bookings.push(b);
  const hold = B.entry(data, b, {type: 'hold', kind: 'fare', amount_cents: b.fare.fare_cents, status: 'authorized', at});
  notify(ctx, data, b, 'booking_confirmed');
  notify(ctx, data, b, 'pickup_details');
  B.flagOverlaps(data, at, AGENT);
  return {booking_id: b.booking_id, booking_status: b.status, pickup_at: b.pickup_at, fare_cents: b.fare.fare_cents, hold_entry_id: hold.entry_id,
    overlaps_with: [...b.overlaps_with], warnings: p.warnings};
}

function update(ctx, data, args) {
  const b = getBooking(data, args.booking_id), now = ms(ctx.virtual_now);
  B.expect(b, ['scheduled', 'needs_attention'], 'modify_not_allowed');
  const c = fare.readChange(args.change_token);
  if (c.booking_id !== b.booking_id) fail('invalid_change_token', 'The change token is for another booking.');
  if (ms(c.quoted_at) > now) fail('invalid_change_token', 'The change token is dated after the current time.');
  if (now >= fare.expiresAt(c.quoted_at, POLICY.change_token_ttl_min)) fail('change_token_expired', 'The change token expired; preview the change again.');
  if (c.booking_revision !== b.revision) fail('change_token_stale', 'The booking changed after the preview; preview the change again.');
  const {request, priced} = priceChange(ctx, data, b, c.changes);
  if (priced.fare.market_revision !== c.market_revision || !priced.available) fail('change_token_stale', 'Prices or supply changed since the preview.');
  if (priced.fare.fare_cents !== c.fare_cents) fail('invalid_change_token', 'The change token does not match the published fare.');
  const zone = getPlace(data, request.pickup_place_id).time_zone, at = render(now, zone);
  const before = {pickup_at: b.pickup_at, fare_cents: b.fare.fare_cents};
  Object.assign(b, {pickup_place_id: request.pickup_place_id, dropoff_place_id: request.dropoff_place_id, option: request.option,
    passengers: request.passengers, bags: request.bags, child_seats: request.child_seats,
    pickup_at: render(request.pickup_at, zone), flight: request.flight ? copy(request.flight) : null, flight_tracking: !!request.flight,
    pickup_buffer_min: request.flight ? request.pickup_buffer_min : null, attention: null});
  b.anchor_pickup_at = b.pickup_at;
  b.fare = {fare_cents: priced.fare.fare_cents, breakdown: priced.fare.breakdown, distance_km: priced.fare.km, minutes: priced.fare.minutes,
    band: priced.fare.band, fare_version: priced.fare.fare_version, market_revision: priced.fare.market_revision, quoted_at: render(c.quoted_at, zone)};
  const released = B.releaseHold(data, b, at);
  const hold = B.entry(data, b, {type: 'hold', kind: 'fare', amount_cents: b.fare.fare_cents, status: 'authorized', at});
  B.transition(b, 'scheduled', {at, actor: AGENT, action: 'changed', details: {changes: copy(c.changes), previous: before,
    released_hold: released?.entry_id || null, new_hold: hold.entry_id}});
  notify(ctx, data, b, 'booking_changed', {reason: 'Changed at your request.'});
  notify(ctx, data, b, 'pickup_details');
  B.flagOverlaps(data, at, AGENT);
  return {booking_id: b.booking_id, booking_status: b.status, pickup_at: b.pickup_at, fare_cents: b.fare.fare_cents, hold_entry_id: hold.entry_id,
    overlaps_with: [...b.overlaps_with], warnings: priced.warnings};
}

function cancel(ctx, data, args) {
  const b = getBooking(data, args.booking_id);
  if (b.status === 'cancelled') fail('already_cancelled', 'The booking is already cancelled.');
  const fee = B.cancelFee(data, b, ctx.virtual_now);
  if (fee === null) fail('not_cancellable', 'A booking that is ' + b.status + ' cannot be cancelled.');
  const at = render(ctx.virtual_now, B.tz(data, b)), wait = b.status === 'driver_arrived' ? B.waitFee(data, b, ctx.virtual_now) : 0;
  B.releaseHold(data, b, at);
  const feeEntry = B.charge(data, b, 'cancellation_fee', fee - wait, at);
  const waitEntry = B.charge(data, b, 'wait_fee', wait, at);
  for (const s of data.shares) if (s.booking_id === b.booking_id && s.status === 'active') { s.status = 'expired'; s.ended_at = at; }
  B.transition(b, 'cancelled', {at, actor: AGENT, action: 'cancelled', details: {reason: args.reason, fee_cents: fee}});
  b.attention = null;
  notify(ctx, data, b, 'booking_cancelled', {fee_cents: fee});
  notify(ctx, data, b, 'pickup_details', {cancelled: true});
  B.flagOverlaps(data, at, AGENT);
  return {booking_id: b.booking_id, booking_status: b.status, fee_cents: fee, charge_entry_ids: [feeEntry, waitEntry].filter(Boolean).map(e => e.entry_id)};
}

function setFlight(ctx, data, args) {
  const b = getBooking(data, args.booking_id);
  B.expect(b, ['scheduled', 'needs_attention'], 'modify_not_allowed');
  const at = render(ctx.virtual_now, B.tz(data, b));
  if (args.flight) {
    const warnings = fare.checkFlight(data, args.flight, getPlace(data, b.pickup_place_id), b.pickup_at);
    const buffer = args.pickup_buffer_min ?? b.pickup_buffer_min ?? POLICY.default_buffer_min;
    Object.assign(b, {flight: copy(args.flight), flight_tracking: true, pickup_buffer_min: buffer});
    b.revision++;
    B.history(b, {at, actor: AGENT, action: 'flight_linked', details: {flight: copy(args.flight), pickup_buffer_min: buffer, warnings}});
    return {booking_id: b.booking_id, flight: copy(b.flight), flight_tracking: true, pickup_buffer_min: buffer, warnings};
  }
  if (!b.flight) fail('invalid_flight', 'The booking has no linked flight.');
  Object.assign(b, {flight: null, flight_tracking: false, pickup_buffer_min: null});
  b.revision++;
  B.history(b, {at, actor: AGENT, action: 'flight_unlinked'});
  return {booking_id: b.booking_id, flight: null, flight_tracking: false, pickup_buffer_min: null, warnings: []};
}

function confirmAdjustment(ctx, data, args) {
  const b = getBooking(data, args.booking_id);
  if (b.status !== 'needs_attention') fail('not_in_needs_attention', 'The booking does not need attention.');
  if (b.attention.reason !== 'large_shift') fail('not_confirmable', 'Only a large flight shift can be confirmed; this one is ' + b.attention.reason + '.');
  const at = render(ctx.virtual_now, B.tz(data, b)), proposed = b.attention.proposed_pickup_at;
  const previous = b.pickup_at;
  b.pickup_at = proposed; b.anchor_pickup_at = proposed; b.attention = null;
  B.transition(b, 'scheduled', {at, actor: AGENT, action: 'adjustment_confirmed', details: {previous_pickup_at: previous, pickup_at: proposed}});
  notify(ctx, data, b, 'booking_changed', {reason: 'You confirmed the new pickup time.'});
  notify(ctx, data, b, 'pickup_details');
  B.flagOverlaps(data, at, AGENT);
  return {booking_id: b.booking_id, booking_status: b.status, pickup_at: b.pickup_at};
}

function shareCreate(ctx, data, args) {
  const b = getBooking(data, args.booking_id);
  if (B.isFinal(b)) fail('booking_terminal', 'The booking is ' + b.status + '.');
  if (!person(ctx, args.person_id)) fail('person_not_found', 'That person is not in this run.');
  if (ms(args.until) <= ms(ctx.virtual_now)) fail('invalid_until', 'A share must end after the current time.');
  const at = render(ctx.virtual_now, B.tz(data, b));
  const s = {share_id: nextShareId(data, b.booking_id), booking_id: b.booking_id, person_id: args.person_id, scope: args.scope,
    until: render(args.until, B.tz(data, b)), status: 'active', created_at: at, ended_at: null};
  data.shares.push(s);
  B.history(b, {at, actor: AGENT, action: 'share_created', details: {share_id: s.share_id, person_id: s.person_id, scope: s.scope}});
  shareStarted(ctx, data, b, s);
  return {share_id: s.share_id, share_status: s.status, until: s.until};
}

function shareRevoke(ctx, data, args) {
  const s = data.shares.find(x => x.share_id === args.share_id);
  if (!s || s.status !== 'active') fail('share_not_found', 'No active share with that ID.');
  const b = getBooking(data, s.booking_id), at = render(ctx.virtual_now, B.tz(data, b));
  s.status = 'revoked'; s.ended_at = at;
  B.history(b, {at, actor: AGENT, action: 'share_revoked', details: {share_id: s.share_id}});
  return {share_id: s.share_id, share_status: s.status};
}

function completed(data, args) {
  const b = getBooking(data, args.booking_id);
  if (b.status !== 'completed') fail('not_completed', 'The ride has not been completed.');
  return b;
}

function tip(ctx, data, args) {
  const b = completed(data, args);
  if (ms(ctx.virtual_now) > ms(b.completed_at) + POLICY.tip_window_hours * 60 * MIN) fail('tip_window_closed', 'Tips are accepted within 72 hours of the ride.');
  if (!Number.isInteger(args.amount_cents) || args.amount_cents <= 0 || args.amount_cents > POLICY.max_tip_cents) fail('invalid_amount', 'A tip is between $0.01 and $100.00.');
  const at = render(ctx.virtual_now, B.tz(data, b)), e = B.charge(data, b, 'tip', args.amount_cents, at);
  B.history(b, {at, actor: AGENT, action: 'tipped', details: {amount_cents: args.amount_cents, entry_id: e.entry_id}});
  return {booking_id: b.booking_id, entry_id: e.entry_id, amount_cents: e.amount_cents};
}

function setExpense(ctx, data, args) {
  const b = completed(data, args);
  if (ms(ctx.virtual_now) > ms(b.completed_at) + POLICY.expense_window_days * 1440 * MIN) fail('expense_window_closed', 'The expense profile can be changed within 30 days of the ride.');
  const at = render(ctx.virtual_now, B.tz(data, b)), previous = copy(b.expense);
  b.expense = {profile: args.profile, memo: args.memo ?? null};
  B.history(b, {at, actor: AGENT, action: 'expense_set', details: {previous, expense: copy(b.expense)}});
  return {booking_id: b.booking_id, expense: copy(b.expense)};
}

function supportOpen(ctx, data, args) {
  const b = getBooking(data, args.booking_id);
  if (data.support_cases.some(c => c.booking_id === b.booking_id && c.status === 'submitted')) fail('case_already_open', 'A case for this ride is already open.');
  if (args.reason === 'driver_no_show') {
    const hadDriver = b.history.some(h => h.to === 'driver_assigned');
    if (!hadDriver || b.status === 'completed') fail('not_eligible', 'A driver no-show applies to a ride whose assigned driver did not complete it.');
  } else {
    if (b.status !== 'completed') fail('not_completed', 'The ride has not been completed.');
    if (args.reason === 'wait_fee_review' && !data.ledger.some(e => e.booking_id === b.booking_id && e.kind === 'wait_fee')) fail('not_eligible', 'No wait fee was charged for this ride.');
  }
  const at = render(ctx.virtual_now, B.tz(data, b));
  const c = {case_id: nextCaseId(data, b.booking_id), booking_id: b.booking_id, reason: args.reason, note: args.note, status: 'submitted',
    created_at: at, resolved_at: null, adjustment_cents: null, resolution_note: null, refund_entry_id: null};
  data.support_cases.push(c);
  B.history(b, {at, actor: AGENT, action: 'support_opened', details: {case_id: c.case_id, reason: c.reason}});
  return {case_id: c.case_id, case_status: c.status};
}

const WRITES = {
  'curbline.bookings.create': create, 'curbline.bookings.update': update, 'curbline.bookings.cancel': cancel,
  'curbline.bookings.set_flight': setFlight, 'curbline.bookings.confirm_adjustment': confirmAdjustment,
  'curbline.shares.create': shareCreate, 'curbline.shares.revoke': shareRevoke, 'curbline.trips.tip': tip,
  'curbline.trips.set_expense': setExpense, 'curbline.support.open': supportOpen
};

function write(ctx, data, name, args) {
  const handler = WRITES[name];
  if (!handler) fail('unknown_tool', 'Unknown business operation.');
  B.settle(data, ctx.virtual_now);
  return handler(ctx, data, args);
}

module.exports = {write, WRITES};
