'use strict';
// Workflows 2 and 3: booking previews and confirms, cancellations, reschedules, check-in, ratings and the waitlist.
const c = require('./common.cjs');
const {fail, copy, parse, money, credits} = c;

const describe = price => price.kind === 'included' ? 'included in your plan' : price.kind === 'credits' ? credits(price.credits) : 'not available on your plan (' + c.REASON[price.reason] + ')';
// The checks every booking shares. For the waitlist the class must be full; for a reschedule the old reservation is ignored.
function checks(ctx, data, x, nowMs, {forWaitlist = false, except = null} = {}) {
  const f = c.formatter(data), when = f.stamp(parse(x.start));
  if (x.status !== 'scheduled') fail('invalid_state', x.title + ' on ' + when + ' was cancelled by the studio' + (x.cancellation_reason ? ' (' + x.cancellation_reason.replace(/_/g, ' ') + ')' : '') + '.');
  if (parse(x.start) <= nowMs) fail('invalid_state', x.title + ' on ' + when + ' has already started.');
  if (parse(x.start) - nowMs > c.days(data.settings.booking_horizon_days)) fail('outside_horizon', 'Classes open for booking ' + data.settings.booking_horizon_days + ' days ahead; ' + x.title + ' on ' + when + ' is not open yet.');
  if (c.myHeld(data, x.class_instance_id, except).length) fail('invalid_state', 'You already hold a reservation for ' + x.title + ' on ' + when + '.');
  const price = c.price(data, x, except);
  if (price.kind === 'not_available') fail('not_included', x.title + ' at ' + c.studio(data, x.studio_id).name + ' is not available on your plan: ' + c.REASON[price.reason] + '.');
  if (price.kind === 'credits' && price.credits > data.account.credits_remaining) fail('insufficient_credits', x.title + ' costs ' + credits(price.credits) + '; you have ' + credits(data.account.credits_remaining) + ' until ' + f.dayLabel(data.account.renewal_date) + '.');
  const clash = c.myBookedUpcoming(data, nowMs).find(r => r.reservation_id !== except && c.overlap(c.instance(data, r.class_instance_id), x));
  if (clash) {const y = c.instance(data, clash.class_instance_id); fail('overlap', x.title + ' (' + when + ' to ' + f.time(parse(x.end)) + ') overlaps your reservation ' + clash.reservation_id + ': ' + y.title + ' at ' + c.studio(data, y.studio_id).name + ', ' + f.time(parse(y.start)) + ' to ' + f.time(parse(y.end)) + '.');}
  const spots = c.spotsLeft(data, x);
  if (!forWaitlist && spots === 0) fail('class_full', x.title + ' on ' + when + ' is full. Join the waitlist with waitlist.join; an offer arrives as a waitlist.promoted event and must be accepted before it expires.');
  if (forWaitlist && spots > 0) fail('not_full', x.title + ' on ' + when + ' still has ' + spots + ' spot' + (spots === 1 ? '' : 's') + '; book it with reservations.preview instead of waiting.');
  return {price, spots};
}
function book(ctx, data, x, price, {replaces = null, action = 'booked', charge = true} = {}) {
  const r = {reservation_id:c.nextId(data, 'rsv'), class_instance_id:x.class_instance_id, status:'booked', price:copy(price), credits_charged:price.kind === 'credits' ? price.credits : 0, fee_cents:0, time_changed:false,
    booked_at:ctx.virtual_now, updated_at:ctx.virtual_now, checked_in_at:null, rating:null, review:null, replaced_by:null, replaces, cancellation_reason:null, history:[]};
  if (charge) data.account.credits_remaining -= r.credits_charged;
  data.reservations.push(r);
  c.stamp(ctx, r, 'reservation_id', action, price.kind === 'included' ? 'Included in your plan' : price.kind === 'credits' ? credits(price.credits) + (charge ? ' charged' : ' carried over') : null);
  return r;
}

function preview(ctx, data, args) {
  const nowMs = c.now(ctx), x = c.instance(data, args.class_instance_id), {price, spots} = checks(ctx, data, x, nowMs);
  const pv = {preview_id:c.nextId(data, 'pv-book'), kind:'booking', created_at:ctx.virtual_now, expires_at:c.iso(nowMs + c.minutes(data.settings.preview_ttl_minutes)), approved:false, fingerprint:c.fingerprint(data, x),
    payload:{class_instance_id:x.class_instance_id, price, cancel_by:c.cancelBy(data, x), spots_left:spots}};
  data.previews.push(pv);
  c.log(ctx, c.PREFIX + 'booking_previewed', {preview_id:pv.preview_id});
  return {id:pv.preview_id, class_instance_id:x.class_instance_id, price:copy(price), cancel_by:pv.payload.cancel_by, spots_left:spots, expires_at:pv.expires_at, approval_required:data.settings.require_user_confirmation};
}
function confirm(ctx, data, args) {
  const nowMs = c.now(ctx), pv = c.livePreview(ctx, data, args.id, 'booking'), x = c.instance(data, pv.payload.class_instance_id);
  if (c.fingerprint(data, x) !== pv.fingerprint) {
    const spots = c.spotsLeft(data, x), price = c.price(data, x), f = c.formatter(data);
    fail('preview_stale', 'The class changed since preview ' + pv.preview_id + ': ' + x.title + ' is now ' + (x.status === 'cancelled' ? 'cancelled by the studio' : f.stamp(parse(x.start)) + ', ' + describe(price) + ', ' + spots + ' spot' + (spots === 1 ? '' : 's') + ' left') + '. ' +
      (x.status === 'scheduled' && spots === 0 ? 'Join the waitlist with waitlist.join.' : 'Request a new preview.'));
  }
  checks(ctx, data, x, nowMs);
  c.gate(data, pv, pv.preview_id, 'Booking ' + x.title);
  const r = book(ctx, data, x, pv.payload.price);
  c.dropPreview(data, pv.preview_id);
  return {id:r.reservation_id, preview_id:pv.preview_id, class_instance_id:x.class_instance_id, price:copy(r.price), credits_charged:r.credits_charged, cancel_by:c.cancelBy(data, x), outcome:'booked'};
}
function bookedUpcoming(data, r, nowMs) {
  const x = c.instance(data, r.class_instance_id);
  if (r.status !== 'booked') fail('invalid_state', 'Reservation ' + r.reservation_id + ' is ' + r.status.replace(/_/g, ' ') + '.');
  if (parse(x.start) <= nowMs) fail('invalid_state', x.title + ' has already started; it can no longer be changed.');
  return x;
}
// Late cancellations forfeit the credits spent, or charge the late fee when the class was included.
function cancelTerms(data, r, x, nowMs) {
  const late = nowMs > parse(c.cancelBy(data, x));
  return {late, fee_cents:late && r.credits_charged === 0 ? data.settings.late_cancel_fee_cents : 0, credits_returned:late ? 0 : r.credits_charged, cancel_by:c.cancelBy(data, x)};
}
function cancelPreview(ctx, data, args) {
  const nowMs = c.now(ctx), r = c.reservation(data, args.id), x = bookedUpcoming(data, r, nowMs), terms = cancelTerms(data, r, x, nowMs);
  const pv = {preview_id:c.nextId(data, 'pv-cancel'), kind:'cancel', created_at:ctx.virtual_now, expires_at:c.iso(nowMs + c.minutes(data.settings.preview_ttl_minutes)), approved:false, fingerprint:c.short(JSON.stringify([r.reservation_id, r.status, terms.late])),
    payload:{reservation_id:r.reservation_id, ...terms}};
  data.previews.push(pv);
  return {id:pv.preview_id, reservation_id:r.reservation_id, ...terms, expires_at:pv.expires_at, approval_required:data.settings.require_user_confirmation && terms.late};
}
function cancel(ctx, data, args) {
  const nowMs = c.now(ctx), r = c.reservation(data, args.id), x = bookedUpcoming(data, r, nowMs), terms = cancelTerms(data, r, x, nowMs), f = c.formatter(data);
  if (terms.late) {
    if (!args.preview_id) fail('late_cancellation', 'The free cancellation window for ' + x.title + ' closed at ' + f.stamp(parse(terms.cancel_by)) + '. Cancelling now ' + (terms.fee_cents ? 'charges a ' + money(terms.fee_cents) + ' late fee' : 'forfeits ' + credits(r.credits_charged)) + '; prepare it with reservations.cancel_preview and pass preview_id.');
    const pv = c.livePreview(ctx, data, args.preview_id, 'cancel');
    if (pv.payload.reservation_id !== r.reservation_id) fail('invalid_arguments', 'Preview ' + pv.preview_id + ' is for another reservation.');
    if (!pv.payload.late) fail('preview_stale', 'Preview ' + pv.preview_id + ' was prepared inside the free window, which has since closed. Request a new preview.');
    c.gate(data, pv, pv.preview_id, 'Late-cancelling ' + x.title);
    if (terms.fee_cents > 0) {
      const m = c.paymentMethod(data, data.account.payment_method_id);
      if (!m || m.status === 'declined') fail('payment_declined', 'The late fee could not be charged: ' + (m ? m.brand + ' ending ' + m.last4 + ' was declined' : 'no payment method is on file') + '.');
      data.receipts.push({receipt_id:c.nextId(data, 'rcpt'), at:ctx.virtual_now, kind:'late_fee', amount_cents:terms.fee_cents, description:'Late cancellation fee, ' + x.title + ' on ' + f.stamp(parse(x.start)), payment_method_id:m.payment_method_id});
    }
    r.status = 'late_cancelled'; r.fee_cents = terms.fee_cents;
    c.dropPreview(data, pv.preview_id);
  } else {
    r.status = 'cancelled'; data.account.credits_remaining += terms.credits_returned;
  }
  r.cancellation_reason = args.reason || null;
  c.stamp(ctx, r, 'reservation_id', r.status, terms.late ? (terms.fee_cents ? money(terms.fee_cents) + ' late fee charged' : credits(r.credits_charged) + ' forfeited') : (terms.credits_returned ? credits(terms.credits_returned) + ' returned' : 'No charge'));
  return {id:r.reservation_id, outcome:r.status, fee_cents:terms.fee_cents, credits_returned:terms.credits_returned};
}
function reschedule(ctx, data, args) {
  const nowMs = c.now(ctx), r = c.reservation(data, args.id), old = bookedUpcoming(data, r, nowMs), x = c.instance(data, args.class_instance_id);
  if (x.class_instance_id === old.class_instance_id) fail('invalid_arguments', 'That is the class already booked.');
  if (x.studio_id !== old.studio_id) fail('invalid_arguments', 'Reschedule within the same studio; cancel and book instead to change studios.');
  const {price} = checks(ctx, data, x, nowMs, {except:r.reservation_id});
  if (price.kind !== r.price.kind || price.credits !== r.price.credits) fail('price_changed', x.title + ' would be ' + describe(price) + ' while the current reservation is ' + describe(r.price) + '; cancel and book instead.');
  const next = book(ctx, data, x, r.price, {replaces:r.reservation_id, action:'rescheduled_by_member', charge:false});
  r.status = 'rescheduled'; r.replaced_by = next.reservation_id;
  c.stamp(ctx, r, 'reservation_id', 'rescheduled', 'Moved to ' + next.reservation_id);
  return {id:next.reservation_id, replaces:r.reservation_id, class_instance_id:x.class_instance_id, outcome:'booked'};
}
function checkin(ctx, data, args) {
  const nowMs = c.now(ctx), r = c.reservation(data, args.id), x = c.instance(data, r.class_instance_id), f = c.formatter(data);
  if (r.status !== 'booked') fail('invalid_state', 'Reservation ' + r.reservation_id + ' is ' + r.status.replace(/_/g, ' ') + '.');
  const opens = parse(x.start) - c.minutes(data.settings.checkin_opens_minutes);
  if (nowMs < opens || nowMs > parse(x.end)) fail('checkin_window', 'Check-in for ' + x.title + ' opens at ' + f.stamp(opens) + ' and closes when the class ends at ' + f.time(parse(x.end)) + '.');
  r.status = 'attended'; r.checked_in_at = ctx.virtual_now;
  c.stamp(ctx, r, 'reservation_id', 'checked_in');
  return {id:r.reservation_id, outcome:'attended', checked_in_at:r.checked_in_at};
}
function rate(ctx, data, args) {
  const nowMs = c.now(ctx), r = c.reservation(data, args.id), x = c.instance(data, r.class_instance_id);
  if (r.status !== 'attended') fail('not_attended', 'Only an attended class can be rated; reservation ' + r.reservation_id + ' is ' + r.status.replace(/_/g, ' ') + '.');
  if (nowMs < parse(x.end)) fail('too_early', x.title + ' has not ended yet.');
  if (r.rating !== null) fail('already_rated', 'Reservation ' + r.reservation_id + ' was already rated ' + r.rating + '.');
  r.rating = args.rating; r.review = args.review ?? null;
  x.rating = Math.round(((x.rating ?? 0) * x.review_count + args.rating) / (x.review_count + 1) * 10) / 10; x.review_count += 1;
  c.stamp(ctx, r, 'reservation_id', 'rated', args.rating + ' of 5');
  return {id:r.reservation_id, outcome:'rated'};
}

// ---- waitlist ---------------------------------------------------------------
function waitlistJoin(ctx, data, args) {
  c.expireOffers(ctx, data);
  const nowMs = c.now(ctx), x = c.instance(data, args.class_instance_id);
  const active = data.waitlist.find(e => e.class_instance_id === x.class_instance_id && ['waiting', 'offered'].includes(e.status));
  if (active) fail('invalid_state', 'Already on the waitlist for ' + x.title + ' (entry ' + active.waitlist_entry_id + ').');
  checks(ctx, data, x, nowMs, {forWaitlist:true});
  const e = {waitlist_entry_id:c.nextId(data, 'wl'), class_instance_id:x.class_instance_id, status:'waiting', offer:null, reservation_id:null, created_at:ctx.virtual_now, updated_at:ctx.virtual_now, history:[]};
  data.waitlist.push(e);
  c.stamp(ctx, e, 'waitlist_entry_id', 'joined');
  return {id:e.waitlist_entry_id, outcome:'waiting', position:1};
}
function waitlistLeave(ctx, data, args) {
  c.expireOffers(ctx, data);
  const e = c.entry(data, args.id);
  if (!['waiting', 'offered'].includes(e.status)) fail('invalid_state', 'Waitlist entry ' + e.waitlist_entry_id + ' is already ' + e.status + '.');
  e.status = 'left';
  c.stamp(ctx, e, 'waitlist_entry_id', 'left');
  return {id:e.waitlist_entry_id, outcome:'left'};
}
function openOffer(ctx, data, id) {
  c.expireOffers(ctx, data);
  const e = c.entry(data, id);
  if (e.status === 'expired') fail('offer_expired', 'The offer on waitlist entry ' + e.waitlist_entry_id + ' expired' + (e.offer ? ' at ' + e.offer.offer_expires_at : '') + '.');
  if (e.status !== 'offered') fail('invalid_state', 'Waitlist entry ' + e.waitlist_entry_id + ' has no open offer (status ' + e.status + ').');
  return e;
}
function waitlistAccept(ctx, data, args) {
  const nowMs = c.now(ctx), e = openOffer(ctx, data, args.id), x = c.instance(data, e.class_instance_id);
  const {price} = checks(ctx, data, x, nowMs);
  if (price.kind === 'credits') c.gate(data, e.offer, e.offer.offer_id, 'Accepting this offer and paying ' + credits(price.credits));
  const r = book(ctx, data, x, price, {action:'booked_from_waitlist'});
  e.status = 'booked'; e.reservation_id = r.reservation_id;
  c.stamp(ctx, e, 'waitlist_entry_id', 'offer_accepted', 'Booked ' + r.reservation_id);
  return {id:e.waitlist_entry_id, reservation_id:r.reservation_id, outcome:'booked'};
}
function waitlistDecline(ctx, data, args) {
  const e = openOffer(ctx, data, args.id);
  e.status = 'declined';
  c.stamp(ctx, e, 'waitlist_entry_id', 'offer_declined');
  return {id:e.waitlist_entry_id, outcome:'declined'};
}
module.exports = {checks, book, describe, preview, confirm, cancelPreview, cancel, reschedule, checkin, rate, waitlistJoin, waitlistLeave, waitlistAccept, waitlistDecline};
