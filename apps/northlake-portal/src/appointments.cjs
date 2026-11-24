'use strict';
// Workflow 3: providers, slots, appointments and the waitlist, plus the account page and interstitials.
const c = require('./common.cjs');
const billing = require('./billing.cjs');
const {fail, copy, parse} = c;

// ---- account and interstitial -----------------------------------------------
const account = (ctx, data) => ({account:{patient:copy(data.patient), health_system:copy(data.health_system), settings:copy(data.settings), interstitial:copy(data.interstitial), summary:c.summary(data, c.now(ctx))}});
function interstitialAcknowledge(ctx, data, args) {
  const i = data.interstitial;
  if (!i || i.interstitial_id !== args.id || i.status !== 'pending') fail('not_found', 'No pending interstitial ' + args.id + '.');
  if (i.clearable_by !== 'agent') fail('user_action_required', 'This ' + i.kind.replace('_', ' ') + ' can only be cleared by the user in the portal; ask them to review it.');
  i.status = 'cleared'; i.cleared_at = ctx.virtual_now; i.cleared_by = 'agent';
  c.log(ctx, c.PREFIX + 'interstitial_cleared', {interstitial_id:i.interstitial_id});
  return {id:i.interstitial_id, outcome:'cleared'};
}

// ---- providers and slots ----------------------------------------------------
function networkStatus(data, p) {
  const n = p.networks.find(x => x.plan_id === data.patient.insurance.plan_id);
  return n ? n.status : 'unknown';
}
const ratingLabel = p => p.rating === null ? 'No ratings yet' : p.rating.toFixed(1) + ' of 5 (' + p.review_count + ' review' + (p.review_count === 1 ? '' : 's') + ')';
function openSlots(data, providerId, nowMs, visitType) {
  return data.slots.filter(s => s.provider_id === providerId && s.status === 'open' && parse(s.start) > nowMs && (!visitType || s.visit_types.includes(visitType))).sort((a, b) => parse(a.start) - parse(b.start)).map(copy);
}
function providerView(data, p, nowMs, visitType) {
  return {...copy(p), clinic:copy(c.clinic(data, p.clinic_id)), network_status:networkStatus(data, p), rating_label:ratingLabel(p), next_available:openSlots(data, p.provider_id, nowMs, visitType)[0] || null};
}
function providersSearch(ctx, data, args) {
  const nowMs = c.now(ctx), q = (args.query || '').toLocaleLowerCase(), specialty = (args.specialty || '').toLocaleLowerCase();
  const views = data.providers.filter(p => {
    const cl = c.clinic(data, p.clinic_id);
    if (q && ![p.name, p.specialty, p.credentials, cl.name, cl.address.city, ...p.languages].join(' ').toLocaleLowerCase().includes(q)) return false;
    if (specialty && !p.specialty.toLocaleLowerCase().includes(specialty)) return false;
    if (args.clinic_id && p.clinic_id !== args.clinic_id) return false;
    if (args.in_network_only && networkStatus(data, p) !== 'in_network') return false;
    if (args.accepting_new_patients && !p.accepting_new_patients) return false;
    if (args.min_rating !== undefined && (p.rating === null || p.rating < args.min_rating)) return false;
    return true;
  }).map(p => providerView(data, p, nowMs, args.visit_type));
  const rank = {in_network:0, unknown:1, out_of_network:2};
  views.sort((a, b) => rank[a.network_status] - rank[b.network_status] || (b.rating ?? -1) - (a.rating ?? -1) || a.name.localeCompare(b.name));
  return {providers:views};
}
function providersGet(ctx, data, args) {
  const p = c.provider(data, args.id), nowMs = c.now(ctx);
  return {provider:providerView(data, p, nowMs, args.visit_type), next_slots:openSlots(data, p.provider_id, nowMs, args.visit_type).slice(0, 20)};
}
function slots(ctx, data, args) {
  const nowMs = c.now(ctx), p = c.provider(data, args.provider_id);
  const from = args.from ? parse(args.from) : nowMs, to = args.to ? parse(args.to) : from + c.days(28);
  if (!(from < to)) fail('invalid_arguments', 'The window must end after it starts.');
  return {slots:openSlots(data, p.provider_id, nowMs, args.visit_type).filter(s => parse(s.start) >= from && parse(s.start) < to)};
}

// ---- appointments -----------------------------------------------------------
const effectiveStatus = (a, nowMs) => a.status === 'booked' && parse(a.end) < nowMs ? 'completed' : a.status;
function appointmentView(data, a, nowMs) {
  const p = c.provider(data, a.provider_id), cl = c.clinic(data, a.clinic_id);
  return {...copy(a), status:effectiveStatus(a, nowMs), provider_name:p.name + ', ' + p.credentials, specialty:p.specialty, clinic_name:cl.name, clinic_address:copy(cl.address)};
}
function list(ctx, data, args) {
  const nowMs = c.now(ctx), status = args.status || 'all';
  const keep = a => {
    const s = effectiveStatus(a, nowMs);
    if (status === 'all') return true;
    if (status === 'upcoming') return s === 'booked';
    if (status === 'past') return s !== 'booked';
    if (status === 'cancelled') return s.startsWith('cancelled');
    return s === status;
  };
  return {appointments:data.appointments.filter(keep).map(a => appointmentView(data, a, nowMs)).sort((a, b) => parse(a.start) - parse(b.start))};
}
function get(ctx, data, args) {
  const a = c.appointment(data, args.id), nowMs = c.now(ctx);
  return {appointment:appointmentView(data, a, nowMs), provider:providerView(data, c.provider(data, a.provider_id), nowMs), clinic:copy(c.clinic(data, a.clinic_id))};
}
function unavailableMessage(data, p, s, nowMs) {
  const f = c.formatter(data);
  const alternatives = openSlots(data, p.provider_id, nowMs).filter(x => x.slot_id !== s.slot_id).sort((a, b) => Math.abs(parse(a.start) - parse(s.start)) - Math.abs(parse(b.start) - parse(s.start))).slice(0, 3);
  return 'Slot ' + s.slot_id + ' (' + f.long(parse(s.start)) + ' ' + f.time(parse(s.start)) + ') with ' + p.name + ' is no longer available.' +
    (alternatives.length ? ' Nearest open slots: ' + alternatives.map(a => a.slot_id + ' (' + f.long(parse(a.start)) + ' ' + f.time(parse(a.start)) + ')').join(', ') + '.' : ' No other open slots with this provider in the next four weeks.');
}
function book(ctx, data, s, visitType, reason, replaces, action) {
  s.status = 'booked';
  const a = {appointment_id:c.nextId(data, 'appt'), provider_id:s.provider_id, clinic_id:s.clinic_id, slot_id:s.slot_id, start:s.start, end:s.end, visit_type:visitType, reason,
    status:'booked', replaced_by:null, replaces, cancellation_reason:null, reminder_sent_at:null, created_at:ctx.virtual_now, updated_at:ctx.virtual_now, history:[]};
  data.appointments.push(a);
  c.stamp(ctx, a, 'appointment_id', action, replaces ? 'Replaces ' + replaces : null);
  return a;
}
function preview(ctx, data, args) {
  const nowMs = c.now(ctx), p = c.provider(data, args.provider_id), s = c.slot(data, args.slot_id);
  if (s.provider_id !== p.provider_id) fail('invalid_arguments', 'Slot ' + s.slot_id + ' belongs to another provider.');
  if (args.visit_type === 'new_patient' && !p.accepting_new_patients) fail('invalid_state', p.name + ' is not accepting new patients.');
  if (!s.visit_types.includes(args.visit_type)) fail('invalid_arguments', 'Slot ' + s.slot_id + ' is not offered for ' + args.visit_type.replace('_', ' ') + ' visits.');
  if (s.status !== 'open' || parse(s.start) <= nowMs) fail('slot_unavailable', unavailableMessage(data, p, s, nowMs));
  const pv = {preview_id:c.nextId(data, 'pv-appt'), kind:'appointment', created_at:ctx.virtual_now, expires_at:c.iso(nowMs + c.minutes(data.settings.preview_ttl_minutes)), approved:false, identity_verified:false,
    fingerprint:s.slot_id + ':' + s.status, payload:{provider_id:p.provider_id, slot_id:s.slot_id, clinic_id:s.clinic_id, start:s.start, end:s.end, visit_type:args.visit_type, reason:args.reason || '', network_status:networkStatus(data, p)}};
  data.previews.push(pv);
  c.log(ctx, c.PREFIX + 'appointment_previewed', {preview_id:pv.preview_id});
  return {id:pv.preview_id, ...copy(pv.payload), expires_at:pv.expires_at, identity_required:true, approval_required:data.settings.require_user_confirmation};
}
function confirm(ctx, data, args) {
  const nowMs = c.now(ctx), pv = c.livePreview(ctx, data, args.id, 'appointment');
  const s = c.slot(data, pv.payload.slot_id), p = c.provider(data, pv.payload.provider_id);
  if (s.status !== 'open' || parse(s.start) <= nowMs) fail('slot_unavailable', unavailableMessage(data, p, s, nowMs));
  if (!pv.identity_verified) fail('identity_required', 'Booking a new visit requires the patient to confirm their date of birth in the portal, which the agent cannot do. Hand off to the user; the task records it as a user.identity_verified event naming preview ' + pv.preview_id + '.');
  c.gate(data, pv, pv.preview_id, 'Booking this appointment');
  const a = book(ctx, data, s, pv.payload.visit_type, pv.payload.reason, null, 'booked');
  c.dropPreview(data, pv.preview_id);
  return {id:a.appointment_id, preview_id:pv.preview_id, provider_id:a.provider_id, clinic_id:a.clinic_id, start:a.start, end:a.end, outcome:'booked'};
}
function cancel(ctx, data, args) {
  const nowMs = c.now(ctx), a = c.appointment(data, args.id), status = effectiveStatus(a, nowMs);
  if (status !== 'booked') fail('invalid_state', 'Appointment ' + a.appointment_id + ' is ' + status.replace(/_/g, ' ') + '; only a booked appointment can be cancelled.');
  const late = parse(a.start) - nowMs < c.hours(data.health_system.cancellation_notice_hours);
  a.status = 'cancelled_by_patient'; a.cancellation_reason = args.reason || null;
  c.slot(data, a.slot_id).status = 'open';
  c.stamp(ctx, a, 'appointment_id', 'cancelled_by_patient', late ? 'Inside the notice window; the late cancellation fee applies.' : null);
  const fee = late && data.health_system.late_cancellation_fee_cents > 0 ? billing.postFee(ctx, data, a, c.formatter(data)) : null;
  return {id:a.appointment_id, outcome:'cancelled_by_patient', late_cancellation:late, fee_claim_id:fee ? fee.claim_id : null};
}
function moveTo(ctx, data, a, s, action) {
  a.status = 'rescheduled';
  c.slot(data, a.slot_id).status = 'open';
  const b = book(ctx, data, s, a.visit_type, a.reason, a.appointment_id, action);
  a.replaced_by = b.appointment_id;
  c.stamp(ctx, a, 'appointment_id', 'rescheduled', 'Moved to ' + b.appointment_id);
  return b;
}
function reschedule(ctx, data, args) {
  const nowMs = c.now(ctx), a = c.appointment(data, args.id), s = c.slot(data, args.slot_id);
  if (effectiveStatus(a, nowMs) !== 'booked') fail('invalid_state', 'Appointment ' + a.appointment_id + ' is not booked, so it cannot be moved.');
  if (s.provider_id !== a.provider_id) fail('invalid_arguments', 'Slot ' + s.slot_id + ' is with another provider; cancel and book a new visit instead.');
  if (!s.visit_types.includes(a.visit_type)) fail('invalid_arguments', 'Slot ' + s.slot_id + ' is not offered for ' + a.visit_type.replace('_', ' ') + ' visits.');
  if (s.status !== 'open' || parse(s.start) <= nowMs) fail('slot_unavailable', unavailableMessage(data, c.provider(data, a.provider_id), s, nowMs));
  const b = moveTo(ctx, data, a, s, 'rescheduled_by_patient');
  return {id:b.appointment_id, replaces:a.appointment_id, provider_id:b.provider_id, start:b.start, end:b.end};
}

// ---- waitlist ---------------------------------------------------------------
const offerExpired = (e, nowMs) => e.status === 'offered' && parse(e.offer.offer_expires_at) < nowMs;
function expireOffers(ctx, data) {
  const nowMs = c.now(ctx);
  for (const e of data.waitlist) if (offerExpired(e, nowMs)) {e.status = 'expired'; c.stamp(ctx, e, 'waitlist_entry_id', 'offer_expired', 'Offer ' + e.offer.offer_id + ' was not answered by ' + e.offer.offer_expires_at);}
}
function waitlistView(data, e, nowMs) {
  return {...copy(e), status:offerExpired(e, nowMs) ? 'expired' : e.status, provider_name:c.provider(data, e.provider_id).name, offer_slot:e.offer ? copy(c.slot(data, e.offer.slot_id)) : null};
}
const waitlistList = (ctx, data) => {const nowMs = c.now(ctx); return {entries:data.waitlist.map(e => waitlistView(data, e, nowMs))};};
function waitlistJoin(ctx, data, args) {
  expireOffers(ctx, data);
  const nowMs = c.now(ctx), p = c.provider(data, args.provider_id);
  if (parse(args.earliest) >= parse(args.latest)) fail('invalid_arguments', 'earliest must precede latest.');
  if (parse(args.latest) <= nowMs) fail('invalid_arguments', 'The waitlist window is already in the past.');
  if (args.appointment_id !== undefined) {
    const a = c.appointment(data, args.appointment_id);
    if (a.provider_id !== p.provider_id || effectiveStatus(a, nowMs) !== 'booked') fail('invalid_state', 'The appointment to move must be a booked visit with this provider.');
  }
  const active = data.waitlist.find(e => e.provider_id === p.provider_id && ['waiting', 'offered'].includes(e.status));
  if (active) fail('invalid_state', 'Already on the waitlist for ' + p.name + ' (entry ' + active.waitlist_entry_id + ').');
  const e = {waitlist_entry_id:c.nextId(data, 'wl'), provider_id:p.provider_id, appointment_id:args.appointment_id ?? null, earliest:args.earliest, latest:args.latest, status:'waiting', offer:null,
    booked_appointment_id:null, created_at:ctx.virtual_now, updated_at:ctx.virtual_now, history:[]};
  data.waitlist.push(e);
  c.stamp(ctx, e, 'waitlist_entry_id', 'joined');
  return {id:e.waitlist_entry_id, outcome:'waiting'};
}
function waitlistLeave(ctx, data, args) {
  expireOffers(ctx, data);
  const e = c.entry(data, args.id);
  if (!['waiting', 'offered'].includes(e.status)) fail('invalid_state', 'Waitlist entry ' + e.waitlist_entry_id + ' is already ' + e.status + '.');
  e.status = 'left';
  c.stamp(ctx, e, 'waitlist_entry_id', 'left');
  return {id:e.waitlist_entry_id, outcome:'left'};
}
function openOffer(ctx, data, id) {
  expireOffers(ctx, data);
  const e = c.entry(data, id);
  if (e.status === 'expired') fail('offer_expired', 'The offer on waitlist entry ' + e.waitlist_entry_id + ' expired' + (e.offer ? ' at ' + e.offer.offer_expires_at : '') + '.');
  if (e.status !== 'offered') fail('invalid_state', 'Waitlist entry ' + e.waitlist_entry_id + ' has no open offer (status ' + e.status + ').');
  return e;
}
function waitlistAccept(ctx, data, args) {
  const nowMs = c.now(ctx), e = openOffer(ctx, data, args.id), s = c.slot(data, e.offer.slot_id), p = c.provider(data, e.provider_id);
  if (s.status !== 'open' || parse(s.start) <= nowMs) fail('slot_unavailable', unavailableMessage(data, p, s, nowMs));
  if (e.appointment_id === null && !e.offer.identity_verified) fail('identity_required', 'Accepting an offer for a new visit requires the patient to confirm their date of birth in the portal, which the agent cannot do. Hand off to the user; the task records it as a user.identity_verified event naming offer ' + e.offer.offer_id + '.');
  c.gate(data, e.offer, e.offer.offer_id, 'Accepting this waitlist offer');
  let a;
  if (e.appointment_id !== null) {
    const old = c.appointment(data, e.appointment_id);
    if (effectiveStatus(old, nowMs) !== 'booked') fail('invalid_state', 'The appointment this entry would move is no longer booked.');
    a = moveTo(ctx, data, old, s, 'moved_from_waitlist');
  } else a = book(ctx, data, s, 'new_patient', 'Waitlist offer ' + e.offer.offer_id, null, 'booked_from_waitlist');
  e.status = 'booked'; e.booked_appointment_id = a.appointment_id;
  c.stamp(ctx, e, 'waitlist_entry_id', 'offer_accepted', 'Booked ' + a.appointment_id);
  return {id:e.waitlist_entry_id, appointment_id:a.appointment_id, outcome:'booked'};
}
function waitlistDecline(ctx, data, args) {
  const e = openOffer(ctx, data, args.id);
  e.status = 'declined';
  c.stamp(ctx, e, 'waitlist_entry_id', 'offer_declined');
  return {id:e.waitlist_entry_id, outcome:'declined'};
}
module.exports = {account, interstitialAcknowledge, networkStatus, openSlots, providerView, providersSearch, providersGet, slots, effectiveStatus, appointmentView, list, get,
  unavailableMessage, book, moveTo, preview, confirm, cancel, reschedule, expireOffers, waitlistList, waitlistJoin, waitlistLeave, waitlistAccept, waitlistDecline};
